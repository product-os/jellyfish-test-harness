// TODO: Remove in favor of helpers.ts
import * as core from '@balena/jellyfish-core';
import { MemoryCache } from '@balena/jellyfish-core';
import { defaultEnvironment } from '@balena/jellyfish-environment';
import { v4 as uuidv4 } from 'uuid';
import type { BackendTestContext, SetupOptions } from '../types';
import { generateRandomID, generateRandomSlug } from './utils';

/**
 * @summary Work to execute before running tests
 * @function
 *
 * @param options - set up options
 */
export async function before(
	options: SetupOptions,
): Promise<BackendTestContext> {
	const suffix = options.suffix ? options.suffix : uuidv4();
	const dbName = `test_${suffix.replace(/-/g, '_')}`;

	const cache = new MemoryCache(
		Object.assign({}, defaultEnvironment.redis, {
			namespace: dbName,
		} as any),
	);
	await cache.connect();

	const logContext = {
		id: `CORE-TEST-${uuidv4()}`,
	};

	const kernel = await core.create(
		logContext,
		cache,
		Object.assign({}, defaultEnvironment.database.options, {
			database: dbName,
		}),
	);
	await kernel.initialize(logContext);

	if (options.suffix) {
		await kernel.reset(logContext);
	}

	return {
		cache,
		logContext,
		kernel,
		generateRandomSlug,
		generateRandomID,
	};
}

/**
 * @summary Clean up after tests
 * @function
 *
 * @param context - test context
 */
export async function after(context: BackendTestContext) {
	await context.kernel.drop(context.logContext);
	await context.kernel.disconnect(context.logContext);
	await context.cache.disconnect();
}
