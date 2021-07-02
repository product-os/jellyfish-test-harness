/*
 * Copyright (C) Balena.io - All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited.
 * Proprietary and confidential.
 */

// tslint:disable: no-var-requires
import Bluebird from 'bluebird';
import { v4 as uuidv4 } from 'uuid';
import type { ActionRequest, SetupOptions, TestContext } from '../../types';
import * as helpers from '../backend-helpers';
import { generateRandomID, generateRandomSlug, insertCards } from '../utils';

const Consumer = require('@balena/jellyfish-queue').Consumer;
const Producer = require('@balena/jellyfish-queue').Producer;
const Worker = require('@balena/jellyfish-worker').Worker;
const Sync = require('@balena/jellyfish-sync').Sync;
const queueErrors = require('@balena/jellyfish-queue').errors;
const errio = require('errio');

async function runBefore(
	context: TestContext,
	options: SetupOptions,
): Promise<void> {
	const integrations = context.plugins.syncIntegrations;

	await helpers.before(context, options);
	context.jellyfish = context.kernel;
	context.session = context.jellyfish.sessions.admin;

	const session = await context.jellyfish.getCardById(
		context.context,
		context.session,
		context.session,
	);

	context.actor = await context.jellyfish.getCardById(
		context.context,
		context.session,
		session.data.actor,
	);

	context.context.sync = new Sync({
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

	await insertCards(context, context.plugins.cards, cardsToInsert);

	context.queue = {};
	context.queue.errors = queueErrors;

	context.queue.consumer = new Consumer(context.jellyfish, context.session);

	const consumedActionRequests: ActionRequest[] = [];

	await context.queue.consumer.initializeWithEventHandler(
		context.context,
		(actionRequest: ActionRequest) => {
			consumedActionRequests.push(actionRequest);
		},
	);

	context.queueActor = uuidv4();

	context.dequeue = async (times = 50) => {
		if (consumedActionRequests.length === 0) {
			if (times <= 0) {
				return null;
			}

			await Bluebird.delay(10);
			return context.dequeue(times - 1);
		}

		return consumedActionRequests.shift();
	};

	context.queue.producer = new Producer(context.jellyfish, context.session);

	await context.queue.producer.initialize(context.context);
	context.generateRandomSlug = generateRandomSlug;
	context.generateRandomID = generateRandomID;
}

/**
 * @summary Tasks to execute after tests
 * @function
 *
 * @param context - test context
 */
async function after(context: TestContext): Promise<void> {
	if (context.queue) {
		await context.queue.consumer.cancel();
	}

	if (context.jellyfish) {
		await helpers.after(context);
	}
}

export const jellyfish = {
	before: async (context: TestContext) => {
		await runBefore(context, {
			suffix: '',
		});

		const workerCards = require('@balena/jellyfish-worker').CARDS;
		await insertCards(context, workerCards, [
			workerCards.update,
			workerCards.create,
			workerCards['triggered-action'],
		]);
	},

	after: async (context: TestContext) => {
		await after(context);
	},
};

export const worker = {
	before: async (context: TestContext, options: SetupOptions) => {
		await runBefore(context, {
			suffix: options.suffix,
		});

		context.worker = new Worker(
			context.jellyfish,
			context.session,
			context.plugins.actions,
			context.queue.consumer,
			context.queue.producer,
		);
		await context.worker.initialize(context.context);

		context.flush = async (session: string) => {
			const request = await context.dequeue();

			if (!request) {
				throw new Error('No message dequeued');
			}

			const result = await context.worker.execute(session, request);

			if (result.error) {
				const Constructor =
					context.worker.errors[result.data.name] ||
					context.queue.errors[result.data.name] ||
					context.jellyfish.errors[result.data.name] ||
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
				return;
			}
		};

		context.processAction = async (session: string, action: ActionRequest) => {
			const createRequest = await context.queue.producer.enqueue(
				context.worker.getId(),
				session,
				action,
			);
			await context.flushAll(session);
			return context.queue.producer.waitResults(context, createRequest);
		};
	},
	after,
};
