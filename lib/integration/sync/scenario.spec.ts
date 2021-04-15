/*
 * Copyright (C) Balena.io - All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited.
 * Proprietary and confidential.
 */

import { getObjDifference } from './scenario';

describe('getObjDifference()', () => {
	test('get produce correct difference between two objects', () => {
		const expected = {
			name: 'foobar',
			version: '1.0.0',
		};
		const obtained = {
			name: 'foobar',
			version: '1.0.1',
			data: {},
		};
		const difference = getObjDifference(expected, obtained);
		expect(difference).toEqual(['data']);
	});
});
