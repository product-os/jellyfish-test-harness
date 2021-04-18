/*
 * Copyright (C) Balena.io - All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited.
 * Proprietary and confidential.
 */

import { loadPlugins } from './utils';

describe('loadPlugins()', () => {
	test('should set test.context.plugins', () => {
		const test = {
			context: {
				plugins: {
					cards: {},
					actions: {},
					syncIntegrations: {},
				},
			},
		};
		loadPlugins(test, []);
		expect(test.context.plugins.cards).toEqual({});
		expect(test.context.plugins.actions).toEqual({});
		expect(test.context.plugins.syncIntegrations).toEqual({});
	});
});
