/*
 * Copyright (C) Balena.io - All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited.
 * Proprietary and confidential.
 */

export interface TestContext {
	[key: string]: any;
}

export interface ActionRequest {
	[key: string]: any;
}

export interface SetupOptions {
	suffix?: string;
	skipConnect?: boolean;
}

export interface Variation {
	name: string;
	combination: any[];
}

export interface Tester {
	before(fn: () => Promise<void>): void;
	beforeEach: (fn: () => Promise<void>) => void;
	after: (fn: () => Promise<void>) => void;
	afterEach: (fn: () => Promise<void>) => void;
	test: (title: string, fn: () => Promise<void>) => void;
}

export interface TestSuite {
	basePath: string;
	plugins: any[];
	cards: string[];
	integration: any;
	scenarios: {
		[key: string]: {
			expected: any;
			steps: any[];
			headIndex?: number;
		};
	};
	baseUrl: string;
	stubRegex: object;
	source: string;
	isAuthorized: any;
	options?: any;
	before?: (context: TestContext) => void;
	beforeEach?: (context: TestContext) => void;
	after?: (context: TestContext) => void;
	afterEach?: (context: TestContext) => void;
	pre?: (context: TestContext) => void;
	prepareEvent?: () => void;
}

export interface TestCaseOptions {
	constructor: any;
	source: string;
	options: {
		context: TestContext;
	};
}
