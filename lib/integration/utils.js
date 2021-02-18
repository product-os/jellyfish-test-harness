/*
 * Copyright (C) Balena.io - All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited.
 * Proprietary and confidential.
 */

const combinatorics = require('js-combinatorics/commonjs/combinatorics')
const {
	v4: uuid
} = require('uuid')
const coreMixins = require('@balena/jellyfish-core/lib/cards/mixins')
const {
	PluginManager
} = require('@balena/jellyfish-plugin-base')

exports.loadPlugins = (test, plugins = []) => {
	if (test.context.plugins) {
		return
	}
	const pluginManager = new PluginManager(test.context.context, {
		plugins
	})
	test.context.plugins = {
		cards: pluginManager.getCards(test.context.context, coreMixins),
		actions: pluginManager.getActions(test.context.context),
		syncIntegrations: pluginManager.getSyncIntegrations(test.context.context)
	}
}

exports.insertCards = async (test, allCards, cardSlugs) => {
	await Promise.all(cardSlugs.map((cardSlug) => {
		return test.context.jellyfish.insertCard(
			test.context.context,
			test.context.session,
			allCards[cardSlug]
		)
	}))
}

exports.generateRandomID = () => {
	return uuid()
}

exports.generateRandomSlug = (options = {}) => {
	const slug = exports.generateRandomID()
	if (options.prefix) {
		return `${options.prefix}-${slug}`
	}

	return slug
}

exports.PermutationCombination = class PermutationCombination {
	constructor (seed) {
		this.seed = [ ...seed ]
	}

	[Symbol.iterator] () {
		return (function *(it) {
			// eslint-disable-next-line id-length
			for (let index = 1, l = it.length; index <= l; index++) {
				yield * new combinatorics.Permutation(it, index)
			}
		}(this.seed))
	}
}
