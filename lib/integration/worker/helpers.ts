import { coreErrors } from '@balena/jellyfish-core';
import {
	Consumer,
	errors as queueErrors,
	Producer,
} from '@balena/jellyfish-queue';
import { Sync } from '@balena/jellyfish-sync';
import type {
	SessionContract,
	UserContract,
} from '@balena/jellyfish-types/build/core';
import { CARDS as workerCards, Worker } from '@balena/jellyfish-worker';
import errio from 'errio';
import { v4 as uuidv4 } from 'uuid';
import * as backendHelpers from '../backend-helpers';
import type { ActionRequest, SetupOptions, TestContext } from '../../types';
import { insertCards } from '../utils';

async function runBefore(options?: SetupOptions): Promise<TestContext> {
	const backendContext = await backendHelpers.before(options);
	const session = backendContext.kernel.sessions!.admin;

	const sessionCard = await backendContext.kernel.getCardById<SessionContract>(
		backendContext.logContext,
		session,
		session,
	);

	const sessionActor = await backendContext.kernel.getCardById<UserContract>(
		backendContext.logContext,
		session,
		sessionCard!.data.actor,
	);

	const integrations = options.plugins.syncIntegrations;
	backendContext.logContext.sync = new Sync({
		integrations,
	});

	const cardsToInsert = [
		'role-user-community',
		'action-create-card',
		'action-create-event',
		'action-set-add',
		'action-create-user',
		'action-create-session',
		'action-update-card',
		'action-delete-card',
	];
	await insertCards(
		backendContext,
		session,
		options.plugins.cards,
		cardsToInsert,
	);

	const queueActor = uuidv4();
	const consumedActionRequests: ActionRequest[] = [];

	const queueConsumer = new Consumer(backendContext.kernel, session);
	await queueConsumer.initializeWithEventHandler(
		backendContext.logContext,
		(actionRequest: ActionRequest) => {
			consumedActionRequests.push(actionRequest);

			return new Promise(null);
		},
	);

	const queueProducer = new Producer(backendContext.kernel, session);
	await queueProducer.initialize(backendContext.logContext);

	const dequeue = async (times = 50) => {
		for (let i = 0; i < times; i++) {
			if (consumedActionRequests.length > 0) {
				return consumedActionRequests.shift();
			}
		}

		return null;
	};

	return {
		session,
		sessionActor,
		flush: async (_session: string) => {
			/* empty */
		},
		flushAll: async (_ssn: string) => {
			/* empty */
		},
		processAction: async (_session: string, _action: ActionRequest) => {
			/* empty */
		},
		queue: {
			actor: queueActor,
			consumer: queueConsumer,
			producer: queueProducer,
		},
		dequeue,
		...backendContext,
	};
}

/**
 * @summary Tasks to execute after tests
 * @function
 *
 * @param context - test context
 */
async function after(context: TestContext): Promise<void> {
	await context.queue.consumer.cancel();
	await backendHelpers.after(context);
}

export const jellyfish = {
	before: async () => {
		const context = await runBefore();
		await insertCards(
			context,
			context.session,
			// TODO: remove these anys by fixing the worker
			workerCards as any,
			[
				workerCards.update,
				workerCards.create as any,
				workerCards['triggered-action'],
			],
		);

		return context;
	},

	after,
};

export const worker = {
	before: async (options: SetupOptions) => {
		const context = await runBefore({
			suffix: options.suffix,
		});

		context.worker = new Worker(
			context.kernel,
			context.session,
			options.plugins.actions,
			context.queue.consumer,
			context.queue.producer,
		);
		await context.worker.initialize(context.logContext);

		context.flush = async (session: string) => {
			const request = await context.dequeue();

			if (!request) {
				throw new Error('No message dequeued');
			}

			const result = await context.worker.execute(session, request);

			if (result.error) {
				const Constructor =
					context.worker.errors[result.data.name] ||
					queueErrors[result.data.name] ||
					coreErrors[result.data.name] ||
					Error;

				const error = new Constructor(result.data.message);
				error.stack = errio.fromObject(result.data).stack;
				throw error;
			}
		};

		context.flushAll = async (ssn: string) => {
			try {
				while (true) {
					await context.flush(ssn);
				}
			} catch {
				// Once an error is thrown, there are no more requests to dequeue
			}
		};

		context.processAction = async (session: string, action: ActionRequest) => {
			const createRequest = await context.queue.producer.enqueue(
				context.worker.getId(),
				session,
				// TODO: typing
				action as any,
			);
			await context.flushAll(session);

			return context.queue.producer.waitResults(
				context.logContext,
				createRequest,
			);
		};
	},
	after,
};
