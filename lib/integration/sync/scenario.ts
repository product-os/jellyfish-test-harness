import { strict as assert } from 'assert';
import type { Contract } from '@balena/jellyfish-types/build/core';
import type { ExecuteContract } from '@balena/jellyfish-types/build/queue';
import {
	clone,
	cloneDeep,
	compact,
	difference,
	each,
	filter,
	findIndex,
	first,
	get,
	includes,
	isEqual,
	kebabCase,
	keys,
	last,
	map,
	merge,
	partial,
	pick,
	sortBy,
} from 'lodash';
import nock from 'nock';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
	TestContext,
	TestCaseOptions,
	Tester,
	TestSuite,
	Variation,
} from '../../types';
import { insertCards, loadPlugins, PermutationCombination } from '../utils';
import { worker } from '../worker/helpers';
import { JellyfishPluginConstructor } from '@balena/jellyfish-plugin-base';

const TRANSLATE_PREFIX = uuidv4();

const tailSort = [
	(card: Contract) => {
		return card.data.timestamp;
	},
	(card: Contract) => {
		return card.type;
	},
];

function getVariations(sequence: any, options: any): Variation[] {
	const invariant = last(sequence);
	return (
		Array.from(new PermutationCombination(sequence))
			.filter((combination) => {
				return includes(combination, invariant);
			})

			// Only consider the ones that preserve ordering for now
			.filter((combination) => {
				if (options.permutations) {
					return true;
				}

				return isEqual(
					combination,
					clone(combination).sort((left: any, right: any) => {
						return (
							findIndex(sequence, (element) => {
								return isEqual(element, left);
							}) -
							findIndex(sequence, (element) => {
								return isEqual(element, right);
							})
						);
					}),
				);
			})

			.map((combination) => {
				return {
					name: combination
						.map((element: any) => {
							return sequence.indexOf(element) + 1;
						})
						.join('-'),
					combination,
				};
			})
	);
}

/**
 * @summary Dynamically require stub path
 * @function
 *
 * @param basePath - require base path
 * @param offset - offset from base path
 * @param name - file name
 * @returns required file contents
 */
function requireStub(basePath: string, offset: any, name: string): any {
	if (offset === 0) {
		console.warn(
			'Stub not found (possibly to simulate a 404):',
			`\n\tName: ${name}`,
			`\n\tBase Path: ${basePath}`,
		);
		return null;
	}

	const stubPath = path.join(basePath, `${offset}`, `${name}.json`);
	try {
		return require(stubPath);
	} catch (error: any) {
		if (error.code === 'MODULE_NOT_FOUND') {
			return requireStub(basePath, offset - 1, name);
		}

		throw error;
	}
}

export async function webhookScenario(
	context: TestContext,
	testCase: any,
	integration: any,
	stub: any,
): Promise<void> {
	let webhookOffset = testCase.offset;

	await nock(stub.baseUrl)
		.persist()
		.get(stub.uriPath)
		.query(true)
		.reply(function (uri: string, _request: any, callback: any) {
			if (!stub.isAuthorized(this.req)) {
				return callback(null, [401, this.req.headers]);
			}

			// Omit query parameters that start with "api" as
			// they contain secrets.
			const [baseUri, queryParams] = uri.split('?');
			const queryString = (queryParams || '')
				.split('&')
				.reduce((accumulator, part) => {
					const [key, value] = part.split('=');
					if (key.startsWith('api')) {
						return accumulator;
					}

					return [accumulator, key, value].join('-');
				}, '');

			const jsonPath = kebabCase(`${baseUri}-${queryString}`);
			const content = requireStub(
				path.join(stub.basePath, testCase.name, 'stubs'),
				webhookOffset,
				jsonPath,
			);
			const code = content ? 200 : 404;
			return callback(null, [code, content]);
		});

	const cards: any[] = [];
	for (const step of testCase.steps) {
		webhookOffset = Math.max(
			webhookOffset,
			findIndex(testCase.original, step) + 1,
		);

		const data = {
			source: integration.source,
			headers: step.headers,
			payload: step.payload,
		};

		const event = await context.kernel.insertCard(
			context.logContext,
			context.session,
			{
				type: 'external-event@1.0.0',
				slug: context.generateRandomSlug({
					prefix: 'external-event',
				}),
				version: '1.0.0',
				data: await testCase.prepareEvent(data),
			},
		);

		const request = await context.queue.producer.enqueue(
			context.worker.getId(),
			context.session,
			{
				logContext: context.logContext,
				action: 'action-integration-import-event@1.0.0',
				card: event.id,
				type: event.type,
				arguments: {},
			},
		);

		await context.flush(context.session);
		const result = await context.queue.producer.waitResults(
			context.logContext,
			request,
		);
		assert.ok(result.error === false);
		cards.push(...(result.data as ExecuteContract[]));
	}

	if (!testCase.expected.head) {
		assert.equal(cards.length, 0);
		return;
	}

	assert.ok(cards.length > 0);

	const head = await context.kernel.getCardById(
		context.logContext,
		context.session,
		cards[testCase.headIndex].id,
	);
	assert(head);

	// TODO: Remove once we fully support versioned
	// slug references in the sync module.
	if (!head.type.includes('@')) {
		head.type = `${head.type}@1.0.0`;
	}

	deleteExtraLinks(testCase.expected.head, head);
	Reflect.deleteProperty(head, 'markers');
	Reflect.deleteProperty(head.data, 'origin');
	Reflect.deleteProperty(head.data, 'translateDate');

	const timeline = await context.kernel.query(
		context.logContext,
		context.session,
		{
			type: 'object',
			additionalProperties: true,
			required: ['data'],
			properties: {
				data: {
					type: 'object',
					required: ['target'],
					additionalProperties: true,
					properties: {
						target: {
							type: 'string',
							const: head.id,
						},
					},
				},
			},
		},
		{
			sortBy: ['data', 'timestamp'],
		},
	);

	testCase.expected.head.slug = testCase.expected.head.slug || head.slug;

	let expectedHead = Object.assign(
		{},
		testCase.expected.head,
		pick(head, ['id', 'created_at', 'updated_at', 'linked_at']),
	);

	// Pick and merge any other fields explicitly marked to ignore
	// This should be used rarely, usually for unpredictable evaluated field values
	const headType = head.type.split('@')[0];
	if (integration.options?.head?.ignore[headType]) {
		expectedHead = merge(
			expectedHead,
			pick(head, integration.options.head.ignore[headType]),
		);
	}
	assert.deepEqual(head, expectedHead);

	const tailFilter = (card: any) => {
		const baseType = card.type.split('@')[0];
		if (testCase.ignoreUpdateEvents && baseType === 'update') {
			return false;
		}

		if (baseType === 'message' || baseType === 'whisper') {
			if (!card.active && card.data.payload.message.trim().length === 0) {
				return false;
			}
		}

		return true;
	};

	const actualTail = await Promise.all(
		sortBy(filter(timeline, tailFilter), tailSort).map(async (card: any) => {
			Reflect.deleteProperty(card, 'slug');
			Reflect.deleteProperty(card, 'links');
			Reflect.deleteProperty(card, 'markers');
			Reflect.deleteProperty(card, 'created_at');
			Reflect.deleteProperty(card, 'updated_at');
			Reflect.deleteProperty(card, 'linked_at');
			Reflect.deleteProperty(card.data, 'origin');
			Reflect.deleteProperty(card.data, 'translateDate');

			// TODO: Remove once we fully support versioned
			// slug references in the sync module.
			if (!card.type.includes('@')) {
				card.type = `${card.type}@1.0.0`;
			}

			const actorCard = await context.kernel.getCardById(
				context.logContext,
				context.session,
				card.data.actor,
			);
			card.data.actor = actorCard
				? {
						slug: actorCard.slug,
						active: actorCard.active,
				  }
				: card.data.actor;

			if (card.type.split('@')[0] === 'update') {
				card.data.payload = card.data.payload.filter((operation: any) => {
					return !['/data/origin', '/linked_at/has attached element'].includes(
						operation.path,
					);
				});

				if (card.data.payload.length === 0) {
					return null;
				}
			} else if (card.data.payload) {
				Reflect.deleteProperty(card.data.payload, 'slug');
				Reflect.deleteProperty(card.data.payload, 'links');
				Reflect.deleteProperty(card.data.payload, 'markers');
				Reflect.deleteProperty(card.data.payload, 'created_at');
				Reflect.deleteProperty(card.data.payload, 'updated_at');
				Reflect.deleteProperty(card.data.payload, 'linked_at');

				if (card.data.payload.data) {
					Reflect.deleteProperty(card.data.payload.data, 'origin');
					Reflect.deleteProperty(card.data.payload.data, 'translateDate');
				}

				// TODO: Remove once we fully support versioned
				// slug references in the sync module.
				if (card.data.payload.type && !card.data.payload.type.includes('@')) {
					card.data.payload.type = `${card.data.payload.type}@1.0.0`;
				}
			}

			return card;
		}),
	);

	const expectedTail = map(
		sortBy(filter(testCase.expected.tail, tailFilter), tailSort),
		(card, index) => {
			card.id = get(actualTail, [index, 'id']);
			card.name = get(actualTail, [index, 'name']);

			card.data.target = head.id;

			// If we have to ignore the update events, then we can't also
			// trust the create event to be what it should have been at
			// the beginning, as services might not preserve that information.
			if (testCase.ignoreUpdateEvents && card.type.split('@')[0] === 'create') {
				card.data.payload = get(actualTail, [index, 'data', 'payload']);
				card.data.timestamp = get(actualTail, [index, 'data', 'timestamp']);
			}

			return card;
		},
	);

	assert.deepEqual(compact(actualTail), expectedTail);
}

const deleteExtraLinks = (expected: any, result: any) => {
	// If links is not present in expected we just remove the whole thing
	if (!expected.links) {
		Reflect.deleteProperty(result, 'links');
	}

	// Otherwise we recursively remove all relationships and links inside them
	// where the relationship does not match the relationship specified in expected
	const objDifference = getObjDifference(expected.links, result.links);

	each(objDifference, (rel) => {
		Reflect.deleteProperty(result.links, rel);
	});

	each(result.links, (links, relationship) => {
		each(links, (_link, index) => {
			const linkDiff = getObjDifference(
				expected.links[relationship][index],
				result.links[relationship][index],
			);
			each(linkDiff, (rel) => {
				Reflect.deleteProperty(result.links[relationship][index], rel);
			});
		});
	});
};

/**
 * @summary Get difference between two objects
 * @function
 *
 * @param expected - expected object
 * @param obtained - obtained object
 * @returns difference between the two provided objects
 */
export function getObjDifference(expected: any, obtained: any): string[] {
	const expectedKeys = keys(expected);
	const obtainedKeys = keys(obtained);
	return difference(obtainedKeys, expectedKeys);
}

/**
 * @summary Tasks to execute before a test suite
 * @function
 *
 * @param plugins - Jellyfish plugins to load
 * @param cards - list of contracts
 */
export async function before(
	pluginConstructors: JellyfishPluginConstructor[] = [],
	cards: any[] = [],
): Promise<TestContext> {
	const plugins = loadPlugins(pluginConstructors);
	const context = await worker.before({
		plugins: pluginConstructors,
		suffix: TRANSLATE_PREFIX,
	});

	/*
	const syncContext = context.logContext.sync.getActionContext(
		'test',
		context.worker.getActionContext(context.logContext),
		context.logContext,
		context.session,
	);
	*/

	await insertCards(context, context.session, plugins.cards, [
		'external-event',
		'action-integration-import-event',
		...cards,
	]);

	nock.cleanAll();
	nock.disableNetConnect();

	return context;
}

/**
 * @summary Tasks to execute after a test suite
 * @function
 *
 * @param context - test context
 */
export async function after(context: TestContext): Promise<void> {
	await worker.after(context);
}

/**
 * @summary Tasks to execute after each test
 * @function
 */
export async function afterEach(): Promise<void> {
	nock.cleanAll();
}

/**
 * @summary Get and return test case options for a given test suite
 * @function
 *
 * @param context - test context
 * @param suite - test suite
 * @returns suite test case options
 */
function getTestCaseOptions(
	context: TestContext,
	suite: TestSuite,
): TestCaseOptions {
	return {
		source: suite.source,
		options: Object.assign(
			{
				context: context.logContext,
				session: context.session,
				actor: context.sessionActor.id,
			},
			suite.options,
		),
	};
}

/**
 * @summary Run test suite
 * @function
 *
 * @param tester - test runner
 * @param suite - test suite
 */
export async function run(tester: Tester, suite: TestSuite): Promise<void> {
	let context: TestContext;

	tester.before(async () => {
		context = await before(suite.plugins, suite.cards);
		if (suite.before) {
			suite.before(context);
		}
	});

	tester.beforeEach(async () => {
		if (suite.beforeEach) {
			suite.beforeEach(context);
		}
	});

	tester.after(async () => {
		if (suite.after) {
			suite.after(context);
		}
		await after(context);
	});

	tester.afterEach(async () => {
		if (suite.afterEach) {
			suite.afterEach(context);
		}
		await afterEach();
	});

	const stubOptions = {
		baseUrl: suite.baseUrl,
		uriPath: suite.stubRegex,
		basePath: path.join(suite.basePath, 'webhooks', suite.source),
		isAuthorized: partial(suite.isAuthorized, suite),
	};

	for (const testCaseName of Object.keys(suite.scenarios)) {
		const testCase = suite.scenarios[testCaseName];
		const expected = {
			head: testCase.expected.head,
			tail: sortBy(testCase.expected.tail, tailSort),
		};

		for (const variation of getVariations(testCase.steps, {
			permutations: suite.source !== 'github' && suite.source !== 'flowdock',
		})) {
			// TODO: We should remove this check
			if (
				(suite.source === 'github' || suite.source === 'flowdock') &&
				variation.combination.length !== testCase.steps.length
			) {
				continue;
			}

			const prepareEventNoop = async (event: any): Promise<any> => {
				return event;
			};

			tester.test(`(${variation.name}) ${testCaseName}`, async () => {
				if (suite.pre) {
					suite.pre(context);
				}

				await webhookScenario(
					context,
					{
						steps: variation.combination,
						prepareEvent: suite.prepareEvent || prepareEventNoop,
						offset: findIndex(testCase.steps, first(variation.combination)) + 1,
						headIndex: testCase.headIndex || 0,
						original: testCase.steps,

						// If we miss events such as when a head card was archived,
						// we usually can't know the date this happened, but we can
						// still apply it with a date approximation. In those cases,
						// its helpful to omit the update events from the tail checks.
						ignoreUpdateEvents: !isEqual(variation.combination, testCase.steps),

						expected: cloneDeep(expected),
						name: testCaseName,
						variant: variation.name,
					},
					getTestCaseOptions(context, suite),
					stubOptions,
				);
			});
		}
	}
}
