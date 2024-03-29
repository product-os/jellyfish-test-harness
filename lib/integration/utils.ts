import { cardMixins as coreMixins } from '@balena/jellyfish-core';
import { PluginManager } from '@balena/jellyfish-plugin-base';
import type { JellyfishPluginConstructor } from '@balena/jellyfish-plugin-base';
import type { Contract } from '@balena/jellyfish-types/build/core';
import * as Combinatorics from 'js-combinatorics/commonjs/combinatorics';
import { v4 as uuidv4 } from 'uuid';
import type { BackendTestContext } from '../types';

/**
 * @summary Load Jellyfish plugins.
 * @function
 *
 * @param pluginConstructors - Jellyfish plugin constructors
 */
export function loadPlugins(
	pluginConstructors: JellyfishPluginConstructor[],
): any {
	const context = {
		id: `test-harness-${uuidv4()}`,
	};
	const pluginManager = new PluginManager(context, {
		plugins: pluginConstructors || [],
	});
	return {
		cards: pluginManager.getCards(context, coreMixins),
		actions: pluginManager.getActions(context),
		syncIntegrations: pluginManager.getSyncIntegrations(context),
	};
}

/**
 * @summary Insert plugin cards into backend
 * @function
 *
 * @param context - test context
 * @param allCards - plugin cards to insert
 * @param cardSlugs - plugin card slugs
 */
export async function insertCards(
	context: BackendTestContext,
	session: string,
	allCards: Contract[],
	cardSlugs: string[],
): Promise<void> {
	await Promise.all(
		cardSlugs.map((cardSlug: string) => {
			return context.kernel.insertCard(
				context.logContext,
				session,
				allCards[cardSlug],
			);
		}),
	);
}

/**
 * @summary Generate and return random ID
 * @function
 *
 * @returns UUID string
 * @example
 * ```typescript
 *   const id = generateRandomID();
 * ```
 */
export function generateRandomID(): string {
	return uuidv4();
}

export interface RandomSlugOptions {
	prefix: string;
}

/**
 * @summary Generate and return random slug
 * @function
 *
 * @param options - optional generation options
 * @returns slug string
 * @example
 * ```typescript
 *   const slug = generateRandomSlug();
 * ```
 */
export function generateRandomSlug(options: RandomSlugOptions): string {
	const slug = generateRandomID();
	if (options && options.prefix) {
		return `${options.prefix}-${slug}`;
	}

	return slug;
}

export class PermutationCombination {
	public seed: string[];

	constructor(seed: string[]) {
		this.seed = [...seed];
	}

	[Symbol.iterator]() {
		return (function* (it) {
			for (let index = 1, l = it.length; index <= l; index++) {
				yield* new Combinatorics.Permutation(it, index);
			}
		})(this.seed);
	}
}
