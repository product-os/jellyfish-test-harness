# Jellyfish Test Harness

Test harness helpers for Jellyfish repos.

# Usage

Below are examples on how to use this library:

## Sync integration translate tests

Below is an overview of how to call the scenario runner to execute translate tests.
Real world examples can be found in many Jellyfish plugins as well.

```js
import { syncIntegrationScenario } from '@balena/jellyfish-test-harness';
import webhooks from './webhooks/my-integration-name';

syncIntegrationScenario.run(
  {
    test,
    before: beforeAll,
    beforeEach,
    after: afterAll,
    afterEach,
  }, {
    // The directory in which your sync integration test and webhooks directory are located
    basePath: __dirname,

    // Optional additional test hooks
    before: (test) => {},
    beforeEach: (test) => {},
    after: (test) => {},
    afterEach: (test) => {},

    // An optional method to be called to prepare card data before inserting it
    prepareEvent: (event: any) => { return event },

    // Additional options to pass to the webhook scenario runner
    options: {},

    // A list of plugin classes required to run the tests
    plugins: [],

    // A list of card slugs that must be loaded before running any tests
    cards: [ ... ],

    // The scenarios that will be run
    scenarios: webhooks,

    // The URL of the integration
    baseUrl: 'https://<my-integration-endpoint>',

    // The regular expression picking paths on the baseUrl to provide mock responses to
    stubRegex: /.*/,

    // The slug of the integration under test
    source: '<my-integration>',

    // A callback to verify if a request is authorized
    isAuthorized: (request) => {
      ...
    },
  },
);
```

# Documentation

[**Writing translate tests**](https://github.com/product-os/jellyfish-test-harness/blob/master/doc/writing-translate-tests.markdown)

[![Publish Documentation](https://github.com/product-os/jellyfish-test-harness/actions/workflows/publish-docs.yml/badge.svg)](https://github.com/product-os/jellyfish-test-harness/actions/workflows/publish-docs.yml)

Visit the website for complete documentation: https://product-os.github.io/jellyfish-test-harness

