import { strict as assert } from 'assert';
import * as core from '@balena/jellyfish-core';
import { cardMixins, CoreKernel, MemoryCache } from '@balena/jellyfish-core';
import { defaultEnvironment } from '@balena/jellyfish-environment';
import type { LogContext } from '@balena/jellyfish-logger';
import { PluginManager } from '@balena/jellyfish-plugin-base';
import {
	Consumer,
	errors as queueErrors,
	Producer,
} from '@balena/jellyfish-queue';
import { Sync } from '@balena/jellyfish-sync';
import type {
	ActionRequestContract,
	Contract,
	SessionContract,
	TypeContract,
	UserContract,
} from '@balena/jellyfish-types/build/core';
import { CARDS as WorkerCards, Worker } from '@balena/jellyfish-worker';
import * as errio from 'errio';
import * as _ from 'lodash';
import randomWords from 'random-words';
import { v4 as uuidv4 } from 'uuid';
import type {
	ActionLibrary as IActionLibrary,
	SetupOptions,
} from '../../lib/types';

const pluginLogContext = {
	id: 'jellyfish-worker-integration-test',
};

const generateRandomID = (): string => {
	return uuidv4();
};

const generateRandomSlug = (options: { prefix?: string } = {}): string => {
	const slug = generateRandomID();
	if (options.prefix) {
		return `${options.prefix}-${slug}`;
	}

	return slug;
};

export interface IntegrationTestContext {
	cache: MemoryCache;
	logContext: LogContext;
	kernel: CoreKernel;
	session: string;
	actor: UserContract;
	dequeue: (times?: number) => Promise<ActionRequestContract | null>;
	queue: {
		consumer: Consumer;
		producer: Producer;
	};
	worker: InstanceType<typeof Worker>;
	flush: (session: string) => Promise<any>;
	flushAll: (session: string) => Promise<void>;
	processAction: (
		session: string,
		action: {
			action: string;
			logContext: LogContext;
			card: string;
			type: string;
			arguments: any;
		},
	) => Promise<{ error: boolean; data: any }>;
	waitForMatch: <T extends Contract>(query: any, times?: number) => Promise<T>;
	generateRandomSlug: typeof generateRandomSlug;
	generateRandomID: typeof generateRandomID;
	actionLibrary: IActionLibrary;
	generateRandomWords: (amount: number) => string;
	createUser: (
		username: string,
		hash?: string,
		roles?: string[],
	) => Promise<{ contract: UserContract; session: string }>;
	createEvent: (
		actor: string,
		session: string,
		target: Contract,
		body: string,
		type: 'message' | 'whisper',
	) => Promise<Contract>;
	createMessage: (
		actor: string,
		session: string,
		target: Contract,
		body: string,
	) => Promise<Contract>;
	createWhisper: (
		actor: string,
		session: string,
		target: Contract,
		body: string,
	) => Promise<Contract>;
	retry: (
		fn: any,
		checkResult: any,
		times?: number,
		delay?: number,
	) => Promise<any>;
	createLink: (
		actor: string,
		session: string,
		fromCard: Contract,
		toCard: Contract,
		verb: string,
		inverseVerb: string,
	) => Promise<Contract>;
	createSupportThread: (
		actor: string,
		session: string,
		name: string,
		data: any,
		markers?: any,
	) => Promise<Contract>;
	createIssue: (
		actor: string,
		session: string,
		name: string,
		data: any,
		markers?: any,
	) => Promise<Contract>;
	createContract: (
		actor: string,
		session: string,
		type: string,
		name: string,
		data: any,
		markers?: any,
	) => Promise<Contract>;
}

export const before = async (
	options: SetupOptions,
): Promise<IntegrationTestContext> => {
	const pluginManager = new PluginManager(pluginLogContext, {
		plugins: options.plugins,
	});

	const suffix = options.suffix || generateRandomID();
	const dbName = `test_${suffix.replace(/-/g, '_')}`;

	const logContext: any = {
		id: `CORE-TEST-${generateRandomID()}`,
	};

	const testCache = new MemoryCache(
		Object.assign({}, defaultEnvironment.redis, {
			namespace: dbName,
		}) as any,
	);

	await testCache.connect();

	const kernel = await core.create(
		logContext,
		testCache,
		Object.assign({}, defaultEnvironment.database.options, {
			database: dbName,
		}),
	);

	if (!options.skipConnect) {
		await kernel.initialize(logContext);
	}

	if (options.suffix) {
		await kernel.initialize(logContext);
		await kernel.reset(logContext);
	}

	const integrations = pluginManager.getSyncIntegrations(
		pluginLogContext,
	) as any;
	logContext.sync = new Sync({
		integrations,
	});

	const allCards = pluginManager.getCards(pluginLogContext, cardMixins);
	const actionLibrary = pluginManager.getActions(pluginLogContext);
	if (options.actions) {
		for (const action of options.actions) {
			Object.assign(actionLibrary, {
				[action.card.slug]: {
					handler: action.handler,
				},
			});
		}
	}

	const adminSessionToken = kernel.sessions!.admin;

	const sessionContract = (await kernel.getCardById(
		logContext,
		adminSessionToken,
		adminSessionToken,
	)) as SessionContract;

	assert(sessionContract !== null);

	const actorContract = (await kernel.getCardById(
		logContext,
		adminSessionToken,
		sessionContract.data.actor,
	)) as UserContract;

	assert(actorContract !== null);

	const bootstrapContracts = [
		WorkerCards.create,
		WorkerCards.update,
		WorkerCards['triggered-action'],
		allCards['role-user-community'],
		allCards.message,
		// Make sure any loop contracts are initialized, as they can be a prerequisite
		..._.filter(allCards, (card) => {
			return card.slug.startsWith('loop-');
		}),
		..._.filter(allCards, (card) => {
			return card.slug.startsWith('action-');
		}),
	];

	// Any remaining contracts from plugins can now be added to the sequence
	const remainder = _.filter(allCards, (card) => {
		return !_.find(bootstrapContracts, { slug: card.slug });
	});

	for (const card of remainder) {
		bootstrapContracts.push(card);
	}

	if (options.cards) {
		for (const card of options.cards) {
			bootstrapContracts.push(card);
		}
	}

	for (const contract of bootstrapContracts) {
		await kernel.insertCard(logContext, adminSessionToken, contract);
	}

	const testQueue = {
		// TODO: Fix type casting
		consumer: new Consumer(kernel, adminSessionToken),
		producer: new Producer(kernel, adminSessionToken),
	};

	const consumedActionRequests: any[] = [];

	await testQueue.consumer.initializeWithEventHandler(
		logContext,
		async (actionRequest: any) => {
			consumedActionRequests.push(actionRequest);
		},
	);

	const dequeue = async (times = 50) => {
		if (consumedActionRequests.length === 0) {
			if (times <= 0) {
				return null;
			}

			await new Promise((resolve) => {
				setTimeout(resolve, 10);
			});
			return dequeue!(times - 1);
		}

		return consumedActionRequests.shift();
	};

	await testQueue.producer.initialize(logContext);

	const WorkerClass = options.worker || Worker;
	const testWorker = new WorkerClass(
		kernel,
		adminSessionToken,
		actionLibrary,
		testQueue.consumer,
		testQueue.producer,
	);
	await testWorker.initialize(logContext);

	const types = await kernel.query<TypeContract>(
		logContext,
		adminSessionToken,
		{
			type: 'object',
			properties: {
				type: {
					const: 'type@1.0.0',
				},
			},
		},
	);
	testWorker.setTypeContracts(logContext, types);

	// Update type cards through the worker for generated triggers, etc
	for (const contract of types) {
		await testWorker.replaceCard(
			logContext,
			adminSessionToken,
			testWorker.typeContracts['type@1.0.0'],
			{
				attachEvents: false,
			},
			contract,
		);
	}

	const triggers = await kernel.query<TypeContract>(
		logContext,
		adminSessionToken,
		{
			type: 'object',
			properties: {
				type: {
					const: 'triggered-action@1.0.0',
				},
			},
		},
	);
	testWorker.setTriggers(logContext, triggers);

	// The flush method gives us a way of manually executing enqueued action requests,
	// allowing fine grained control in test scenarios. In a production setting, the
	// worker would be dequeueing and executing automatically.
	const flush = async (ssn: string) => {
		const request = await dequeue();

		if (!request) {
			throw new Error('No message dequeued');
		}

		const result = await testWorker.execute(ssn, request);

		if (result.error) {
			const Constructor =
				testWorker.errors[result.data.name] ||
				queueErrors[result.data.name] ||
				kernel.errors[result.data.name] ||
				Error;

			const error = new Constructor(result.data.message);
			error.stack = errio.fromObject(result.data).stack;
			throw error;
		}
	};

	const waitForMatch = async <T extends Contract>(
		waitQuery: any,
		times = 20,
	): Promise<T> => {
		if (times === 0) {
			throw new Error('The wait query did not resolve');
		}
		const results = await kernel.query<T>(
			logContext,
			adminSessionToken,
			waitQuery,
		);
		if (results.length > 0) {
			return results[0];
		}
		await new Promise((resolve) => {
			setTimeout(resolve, 500);
		});
		return waitForMatch<T>(waitQuery, times - 1);
	};

	const flushAll = async (ssn: string) => {
		try {
			while (true) {
				await flush(ssn);
			}
		} catch {
			// Once an error is thrown, there are no more requests to dequeue
			return;
		}
	};

	const processAction = async (ssn: string, action: any) => {
		const createRequest = await testQueue.producer.enqueue(
			testWorker.getId(),
			ssn,
			action,
		);
		await flush(ssn);
		return testQueue.producer.waitResults(logContext, createRequest);
	};

	const generateRandomWords = (amount: number) => {
		return randomWords(amount).join(' ');
	};

	const createUser = async (
		username: string,
		hash = 'foobar',
		roles = ['user-community'],
	) => {
		// Create the user, only if it doesn't exist yet
		const contract =
			((await ctx.kernel.getCardBySlug(
				ctx.logContext,
				ctx.session,
				`user-${username}@latest`,
			)) as UserContract) ||
			(await ctx.kernel.insertCard<UserContract>(ctx.logContext, ctx.session, {
				type: 'user@1.0.0',
				slug: `user-${username}`,
				data: {
					email: `${username}@example.com`,
					hash,
					roles,
				},
			}));

		// Force login, even if we don't know the password
		const userSession = await ctx.kernel.insertCard(
			ctx.logContext,
			ctx.session,
			{
				slug: `session-${
					contract.slug
				}-integration-tests-${generateRandomID()}`,
				type: 'session@1.0.0',
				data: {
					actor: contract.id,
				},
			},
		);

		return {
			contract,
			session: userSession.id,
		};
	};

	const createEvent = async (
		actor: string,
		session: string,
		target: Contract,
		body: string,
		type: 'message' | 'whisper',
	) => {
		const req = await ctx.queue.producer.enqueue(actor, session, {
			action: 'action-create-event@1.0.0',
			logContext: ctx.logContext,
			card: target.id,
			type: target.type,
			arguments: {
				type,
				payload: {
					message: body,
				},
			},
		});

		await ctx.flushAll(session);
		const result: any = await ctx.queue.producer.waitResults(
			ctx.logContext,
			req,
		);
		expect(result.error).toBe(false);
		assert(result.data);
		await ctx.flushAll(session);
		const contract = (await ctx.kernel.getCardById(
			ctx.logContext,
			ctx.session,
			result.data.id,
		)) as Contract;
		assert(contract);

		return contract;
	};

	const createMessage = (
		actor: string,
		session: string,
		target: Contract,
		body: string,
	) => {
		return createEvent(actor, session, target, body, 'message');
	};

	const createWhisper = (
		actor: string,
		session: string,
		target: Contract,
		body: string,
	) => {
		return createEvent(actor, session, target, body, 'whisper');
	};

	const retry = async (fn: any, checkResult: any, times = 10, delay = 500) => {
		const result = await fn();
		if (!checkResult(result)) {
			if (times > 0) {
				await new Promise((resolve) => {
					setTimeout(resolve, delay);
				});
				return retry(fn, checkResult, times - 1);
			}
			throw new Error('Ran out of retry attempts');
		}
		return result;
	};

	const createLink = async (
		actor: string,
		session: string,
		fromCard: Contract,
		toCard: Contract,
		verb: string,
		inverseVerb: string,
	) => {
		const inserted = await ctx.worker.insertCard(
			ctx.logContext,
			session,
			ctx.worker.typeContracts['link@1.0.0'],
			{
				attachEvents: true,
				actor,
			},
			{
				slug: `link-${fromCard.id}-${verb.replace(/\s/g, '-')}-${
					toCard.id
				}-${generateRandomID()}`,
				tags: [],
				version: '1.0.0',
				links: {},
				requires: [],
				capabilities: [],
				active: true,
				name: verb,
				data: {
					inverseName: inverseVerb,
					from: {
						id: fromCard.id,
						type: fromCard.type,
					},
					to: {
						id: toCard.id,
						type: toCard.type,
					},
				},
			},
		);
		assert(inserted);
		await ctx.flushAll(session);

		const link = await ctx.kernel.getCardById(
			ctx.logContext,
			ctx.session,
			inserted.id,
		);
		assert(link);
		return link;
	};

	const createSupportThread = async (
		actor: string,
		session: string,
		name: string,
		data: any,
		markers = [],
	) => {
		const contract = await createContract(
			actor,
			session,
			'support-thread@1.0.0',
			name,
			data,
			markers,
		);
		return contract;
	};

	const createIssue = async (
		actor: string,
		session: string,
		name: string,
		data: any,
		markers = [],
	) => {
		const contract = await createContract(
			actor,
			session,
			'issue@1.0.0',
			name,
			data,
			markers,
		);
		return contract;
	};

	const createContract = async (
		actor: string,
		session: string,
		type: string,
		name: string,
		data: any,
		markers = [],
	) => {
		const inserted = await ctx.worker.insertCard(
			ctx.logContext,
			session,
			ctx.worker.typeContracts[type],
			{
				attachEvents: true,
				actor,
			},
			{
				name,
				slug: ctx.generateRandomSlug({
					prefix: type.split('@')[0],
				}),
				version: '1.0.0',
				markers,
				data,
			},
		);
		assert(inserted);
		await ctx.flushAll(session);

		const contract = await ctx.kernel.getCardById(
			ctx.logContext,
			ctx.session,
			inserted.id,
		);
		assert(contract);
		return contract;
	};

	const ctx: IntegrationTestContext = {
		actionLibrary,
		actor: actorContract,
		kernel,
		cache: testCache,
		logContext,
		dequeue,
		flush,
		flushAll,
		generateRandomID,
		generateRandomSlug,
		processAction,
		queue: testQueue,
		session: adminSessionToken,
		waitForMatch,
		worker: testWorker,
		generateRandomWords,
		createUser,
		createEvent,
		createMessage,
		createWhisper,
		retry,
		createLink,
		createSupportThread,
		createIssue,
		createContract,
	};

	return ctx;
};

export const after = async (ctx: IntegrationTestContext) => {
	await ctx.queue.consumer.cancel();

	await ctx.kernel.drop(ctx.logContext);
	await ctx.kernel.disconnect(ctx.logContext);

	await ctx.cache.disconnect();
};
