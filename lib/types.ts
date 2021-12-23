import type { CoreKernel, MemoryCache } from '@balena/jellyfish-core';
import type { LogContext } from '@balena/jellyfish-logger';
import type {
	ActionFile,
	JellyfishPluginConstructor,
} from '@balena/jellyfish-plugin-base';
import type {
	Consumer,
	Producer,
	ProducerResults,
} from '@balena/jellyfish-queue';
import type {
	ContractDefinition,
	UserContract,
} from '@balena/jellyfish-types/build/core';
import type { Action } from '@balena/jellyfish-types/build/worker';
import type { RandomSlugOptions } from './integration/utils';

export interface BackendTestContext {
	kernel: CoreKernel;
	logContext: LogContext;
	cache: MemoryCache;
	generateRandomSlug: (options: RandomSlugOptions) => string;
	generateRandomID: () => string;
}

export interface TestContext {
	session: string;
	sessionActor: UserContract;
	// TODO: proper type
	worker?: any;
	flush: (session: string) => Promise<void>;
	flushAll: (ssn: string) => Promise<void>;
	processAction: (
		session: string,
		action: ActionRequest,
	) => Promise<ProducerResults>;
	queue: {
		actor: string;
		consumer: Consumer;
		producer: Producer;
	};
	dequeue: (times?: number) => Promise<ActionRequest | null>;
	kernel: CoreKernel;
	logContext: LogContext;
	cache: MemoryCache;
	generateRandomSlug: (options: RandomSlugOptions) => string;
	generateRandomID: () => string;
}

export interface ActionRequest {
	[key: string]: any;
}

// TS-TODO: Use proper type for worker
export interface SetupOptions {
	plugins: JellyfishPluginConstructor[];
	suffix?: string;
	skipConnect?: boolean;
	cards?: ContractDefinition[];
	actions?: ActionFile[];
	worker?: any;
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

export interface TestSuiteOptions {
	token?: any;
	head?: {
		ignore: {
			[key: string]: string[];
		};
	};
}

export interface TestSuite {
	basePath: string;
	plugins: any[];
	cards: string[];
	scenarios: {
		[key: string]: {
			expected: any;
			steps: any[];
			headIndex?: number;
		};
	};
	baseUrl: string | RegExp;
	stubRegex: object;
	source: string;
	isAuthorized: any;
	options?: TestSuiteOptions;
	before?: (context: TestContext) => void;
	beforeEach?: (context: TestContext) => void;
	after?: (context: TestContext) => void;
	afterEach?: (context: TestContext) => void;
	pre?: (context: TestContext) => void;
	prepareEvent?: (event: any) => Promise<any>;
}

export interface TestCaseOptions {
	constructor: any;
	source: string;
	options: TestSuiteOptions;
}

export interface ActionLibrary {
	[key: string]: Action;
}
