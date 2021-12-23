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
		loadPlugins([]);
		expect(test.context.plugins.cards).toEqual({});
		expect(test.context.plugins.actions).toEqual({});
		expect(test.context.plugins.syncIntegrations).toEqual({});
	});
});
