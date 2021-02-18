/*
 * Copyright (C) Balena.io - All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited.
 * Proprietary and confidential.
 */

const ava = require('ava')
const utils = require('./utils')

ava('.loadPlugins sets test.context.plugins', (test) => {
	utils.loadPlugins(test, [])
	test.deepEqual(test.context.plugins.cards, {})
	test.deepEqual(test.context.plugins.actions, {})
	test.deepEqual(test.context.plugins.syncIntegrations, {})
})
