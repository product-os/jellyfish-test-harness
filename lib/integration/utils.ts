/* Copyright (C) Balena.io - All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited.
 * Proprietary and confidential.
 */

// tslint:disable: no-var-requires

import { PluginManager } from '@balena/jellyfish-plugin-base';
import type { JellyfishPluginConstructor } from '@balena/jellyfish-plugin-base';
import { v4 as uuidv4 } from 'uuid';
import type { TestContext } from '../types';

const combinatorics = require('js-combinatorics/commonjs/combinatorics');
const coreMixins = require('@balena/jellyfish-core/lib/cards/mixins');

/**
 * @summary Load Jellyfish plugins.
 * @function
 *
 * @param context - test context
 * @param plugins - Jellyfish plugin constructors
 */
export function loadPlugins(
	context: TestContext,
	plugins: JellyfishPluginConstructor[],
): void {
	if (context.plugins) {
		return;
	}

	const pluginManager = new PluginManager(context.context, {
		plugins: plugins || [],
	});
	context.plugins = {
		cards: pluginManager.getCards(context.context, coreMixins),
		actions: pluginManager.getActions(context.context),
		syncIntegrations: pluginManager.getSyncIntegrations(context.context),
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
	context: TestContext,
	allCards: any,
	cardSlugs: string[],
): Promise<void> {
	await Promise.all(
		cardSlugs.map((cardSlug: string) => {
			return context.jellyfish.insertCard(
				context.context,
				context.session,
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
export function generateRandomSlug(options: any): string {
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
				yield* new combinatorics.Permutation(it, index);
			}
		})(this.seed);
	}
}
