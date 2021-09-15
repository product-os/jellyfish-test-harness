/*
 * Copyright (C) Balena.io - All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited.
 * Proprietary and confidential.
 */

import * as _ from 'lodash';
import * as errio from 'errio';
import Bluebird from 'bluebird';
import { v4 as uuidv4 } from 'uuid';
import {
	ActionRequestContract,
	Context,
	Contract,
	ContractData,
	ContractDefinition,
	SessionContract,
	TypeContract,
	UserContract,
} from '@balena/jellyfish-types/build/core';
import * as queue from '@balena/jellyfish-queue';
import { defaultEnvironment } from '@balena/jellyfish-environment';
import {
	Backend,
	Kernel,
	errors,
	MemoryCache as Cache,
} from '@balena/jellyfish-core';
import { Cache as JellyfishCache } from '@balena/jellyfish-core/build/cache';
import { PostgresBackend } from '@balena/jellyfish-core/build/backend/postgres';
import { strict as assert } from 'assert';
import { v4 as uuid } from 'uuid';
import { cardMixins } from '@balena/jellyfish-core';
import { PluginManager } from '@balena/jellyfish-plugin-base';
import { Kernel as CoreKernel } from '@balena/jellyfish-core/build/kernel';
import { ActionLibrary as IActionLibrary } from '../../lib/types';
import { Worker, CARDS as WorkerCards } from '@balena/jellyfish-worker';
import { Sync } from '@balena/jellyfish-sync';
import randomWords from 'random-words';

const pluginContext = {
	id: 'jellyfish-worker-integration-test',
};

const generateRandomID = (): string => {
	return uuid();
};

const generateRandomSlug = (options: { prefix?: string } = {}): string => {
	const slug = generateRandomID();
	if (options.prefix) {
		return `${options.prefix}-${slug}`;
	}

	return slug;
};

const Consumer = queue.Consumer;
const Producer = queue.Producer;

export interface IntegrationTestContext {
	cache: JellyfishCache;
	context: Context;
	backend: PostgresBackend;
	session: string;
	actor: UserContract;
	dequeue: (times?: number) => Promise<ActionRequestContract | null>;
	queue: {
		consumer: queue.Consumer;
		producer: queue.Producer;
	};
	jellyfish: CoreKernel;
	worker: InstanceType<typeof Worker>;
	flush: (session: string) => Promise<any>;
	flushAll: (session: string) => Promise<void>;
	processAction: (
		session: string,
		action: {
			action: string;
			context: any;
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
	) => Promise<Contract>;
	createIssue: (
		actor: string,
		session: string,
		name: string,
		data: any,
	) => Promise<Contract>;
	createContract: (
		actor: string,
		session: string,
		type: string,
		name: string,
		data: any,
	) => Promise<Contract>;
}

export interface BackendTestOptions {
	suffix?: string;
	skipConnect?: boolean;
}

export const before = async (
	plugins: any[],
	cards: Array<ContractDefinition<ContractData>> = [],
	options: any = {},
): Promise<IntegrationTestContext> => {
	const pluginManager = new PluginManager(pluginContext, {
		plugins,
	});

	const suffix = options.suffix || uuidv4();
	const dbName = `test_${suffix.replace(/-/g, '_')}`;

	const context: any = {
		id: `CORE-TEST-${uuidv4()}`,
	};

	const testCache = new Cache(
		Object.assign({}, defaultEnvironment.redis, {
			namespace: dbName,
		}) as any,
	);

	await testCache.connect();

	const backend = new Backend(
		testCache,
		errors,
		Object.assign({}, defaultEnvironment.database.options, {
			database: dbName,
		}),
	);

	if (!options.skipConnect) {
		await backend.connect(context);
	}

	if (options.suffix) {
		await backend.connect(context);
		await backend.reset(context);
	}

	const jellyfish = new Kernel(backend);
	await jellyfish.initialize(context);

	const integrations = pluginManager.getSyncIntegrations(pluginContext) as any;
	context.sync = new Sync({
		integrations,
	});

	const allCards = pluginManager.getCards(pluginContext, cardMixins);
	const actionLibrary = pluginManager.getActions(pluginContext);

	const adminSessionToken = jellyfish.sessions!.admin;

	const sessionContract = (await jellyfish.getCardById(
		context,
		adminSessionToken,
		adminSessionToken,
	)) as SessionContract;

	assert(sessionContract !== null);

	const actorContract = (await jellyfish.getCardById(
		context,
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

	for (const card of cards) {
		bootstrapContracts.push(card);
	}

	for (const contract of bootstrapContracts) {
		await jellyfish.insertCard(context, adminSessionToken, contract);
	}

	const testQueue = {
		// TODO: Fix type casting
		consumer: new Consumer(jellyfish as any, adminSessionToken),
		producer: new Producer(jellyfish as any, adminSessionToken),
	};

	const consumedActionRequests: any[] = [];

	await testQueue.consumer.initializeWithEventHandler(
		context,
		async (actionRequest: any) => {
			consumedActionRequests.push(actionRequest);
		},
	);

	const dequeue = async (times = 50) => {
		if (consumedActionRequests.length === 0) {
			if (times <= 0) {
				return null;
			}

			await Bluebird.delay(10);
			return dequeue!(times - 1);
		}

		return consumedActionRequests.shift();
	};

	await testQueue.producer.initialize(context);

	const testWorker = new Worker(
		jellyfish as any,
		adminSessionToken,
		actionLibrary,
		testQueue.consumer,
		testQueue.producer,
	);
	await testWorker.initialize(context);

	const types = await jellyfish.query<TypeContract>(
		context,
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
	testWorker.setTypeContracts(context, types);

	const triggers = await jellyfish.query<TypeContract>(
		context,
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
	testWorker.setTriggers(context, triggers);

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
				queue.errors[result.data.name] ||
				jellyfish.errors[result.data.name] ||
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
		const results = await jellyfish.query<T>(
			context,
			adminSessionToken,
			waitQuery,
		);
		if (results.length > 0) {
			return results[0];
		}
		await Bluebird.delay(500);
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
		return testQueue.producer.waitResults(context, createRequest);
	};

	const generateRandomWords = (amount: number) => {
		return randomWords(amount).join(' ');
	};

	const createUser = async (username: string) => {
		// Create the user, only if it doesn't exist yet
		const contract =
			((await ctx.jellyfish.getCardBySlug(
				ctx.context,
				ctx.session,
				`user-${username}@latest`,
			)) as UserContract) ||
			(await ctx.jellyfish.insertCard<UserContract>(ctx.context, ctx.session, {
				type: 'user@1.0.0',
				slug: `user-${username}`,
				data: {
					email: `${username}@example.com`,
					hash: 'foobar',
					roles: ['user-community'],
				},
			}));

		// Force login, even if we don't know the password
		const userSession = await ctx.jellyfish.insertCard(
			ctx.context,
			ctx.session,
			{
				slug: `session-${contract.slug}-integration-tests-${uuid()}`,
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
			context: ctx.context,
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
		const result: any = await ctx.queue.producer.waitResults(ctx.context, req);
		expect(result.error).toBe(false);
		assert(result.data);
		await ctx.flushAll(session);
		const contract = (await ctx.jellyfish.getCardById(
			ctx.context,
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
				await Bluebird.delay(delay);
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
			ctx.context,
			session,
			ctx.worker.typeContracts['link@1.0.0'],
			{
				attachEvents: true,
				actor,
			},
			{
				slug: `link-${fromCard.id}-${verb.replace(/\s/g, '-')}-${
					toCard.id
				}-${uuid()}`,
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

		const link = await ctx.jellyfish.getCardById(
			ctx.context,
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
	) => {
		const contract = await createContract(
			actor,
			session,
			'support-thread@1.0.0',
			name,
			data,
		);
		return contract;
	};

	const createIssue = async (
		actor: string,
		session: string,
		name: string,
		data: any,
	) => {
		const contract = await createContract(
			actor,
			session,
			'issue@1.0.0',
			name,
			data,
		);
		return contract;
	};

	const createContract = async (
		actor: string,
		session: string,
		type: string,
		name: string,
		data: any,
	) => {
		const inserted = await ctx.worker.insertCard(
			ctx.context,
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
				data,
			},
		);
		assert(inserted);
		await ctx.flushAll(session);

		const contract = await ctx.jellyfish.getCardById(
			ctx.context,
			ctx.session,
			inserted.id,
		);
		assert(contract);
		return contract;
	};

	const ctx: IntegrationTestContext = {
		actionLibrary,
		actor: actorContract,
		backend,
		cache: testCache,
		context,
		dequeue,
		flush,
		flushAll,
		generateRandomID,
		generateRandomSlug,
		// TS-TODO: fix this casting
		jellyfish,
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
	if (ctx.queue) {
		await ctx.queue.consumer.cancel();
	}

	if (ctx.jellyfish) {
		await ctx.backend.drop(ctx.context);
		await ctx.jellyfish.disconnect(ctx.context);
		/*
		 * We can just disconnect and not destroy the whole
		 * database as test databases are destroyed before
		 * the next test run anyways.
		 */
		await ctx.backend.disconnect(ctx.context);

		if (ctx.cache) {
			await ctx.cache.disconnect();
		}
	}
};
