// TODO: Remove in favor of helpers.ts
import { defaultEnvironment } from '@balena/jellyfish-environment';
import { v4 as uuidv4 } from 'uuid';
import type { SetupOptions, TestContext } from '../types';
import { generateRandomID, generateRandomSlug } from './utils';

// TODO: Make the core easier to bootstrap!
import {
	Backend,
	MemoryCache as Cache,
	errors,
	Kernel,
} from '@balena/jellyfish-core';

/**
 * @summary Set up backend before running tests.
 * @function
 *
 * @param context - test context
 * @param options - set up options
 */
async function backendBefore(
	context: TestContext,
	options: SetupOptions,
): Promise<void> {
	const suffix = options.suffix ? options.suffix : uuidv4();
	const dbName = `test_${suffix.replace(/-/g, '_')}`;

	context.cache = new Cache(
		Object.assign({}, defaultEnvironment.redis, {
			namespace: dbName,
		} as any),
	);

	context.context = {
		id: `CORE-TEST-${uuidv4()}`,
	};

	if (context.cache) {
		await context.cache.connect(context.context);
	}

	context.backend = new Backend(
		context.cache,
		errors,
		Object.assign({}, defaultEnvironment.database.options, {
			database: dbName,
		}),
	);

	if (options.skipConnect) {
		return;
	}

	await context.backend.connect(context.context);
}

/**
 * @summary Clean up backend after tests complete
 * @function
 *
 * @param context - test context
 */
async function backendAfter(context: TestContext): Promise<void> {
	/*
	 * We can just disconnect and not destroy the whole
	 * database as test databases are destroyed before
	 * the next test run anyways.
	 */
	await context.backend.disconnect(context.context);

	if (context.cache) {
		await context.cache.disconnect();
	}
}

/**
 * @summary Work to execute before running tests
 * @function
 *
 * @param context - test context
 * @param options - set up options
 */
export async function before(
	context: TestContext,
	options: SetupOptions,
): Promise<void> {
	await backendBefore(context, {
		skipConnect: true,
		suffix: options.suffix,
	});

	if (options.suffix) {
		await context.backend.connect(context.context);
		await context.backend.reset(context.context);
	}

	context.kernel = new Kernel(context.backend);
	await context.kernel.initialize(context.context);
	context.generateRandomSlug = generateRandomSlug;
	context.generateRandomID = generateRandomID;
}

/**
 * @summary Clean up after tests
 * @function
 *
 * @param context - test context
 */
export async function after(context: TestContext): Promise<void> {
	await context.backend.drop(context.context);
	await context.kernel.disconnect(context.context);
	await backendAfter(context);
}
