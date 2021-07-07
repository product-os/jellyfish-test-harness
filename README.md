# Jellyfish Test Harness

Test harness helpers for Jellyfish repos.

# Usage

Below are examples on how to use this library:

## Sync integration translate tests

```js
const ava = require('ava')
const {
	syncIntegrationScenario
} = require('@balena/jellyfish-test-harness')

syncIntegrationScenario.run(ava, {
  // The directory in which your sync integration test and webhooks directory are located
  basePath: '',

  // Optional additional test hooks
  before: (test) => {},
  beforeEach: (test) => {},
  after: (test) => {},
  afterEach: (test) => {},

  // An optional method to be called to prepare card data before inserting it
  prepareEvent: (data) => { return data },

  // Additional options to pass to the webhook scenario runner
  options: {},

  // A list of plugin classes required to run the tests
  plugins: [],

  // A list of card slugs that must be loaded before running any tests
	cards: [ ... ],

  // The sync integration code itself
	integration: require('../../../lib/integrations/<my-integration>'),

  // The scenarios that will be run
	scenarios: require('./webhooks/<my-integration>'),

  // The URL of the integration
	baseUrl: 'https://<my-integration-endpoint>',

  // The regular expression picking paths on the baseUrl to provide mock responses to
	stubRegex: /.*/,

  // The slug of the integration under test
	source: '<my-integration>',

  // A callback to verify if a request is authorized
	isAuthorized: (request) => {
		...
	}
})
```

# Documentation

[**Writing translate tests**](https://github.com/product-os/jellyfish-test-harness/blob/master/doc/writing-translate-tests.markdown)

[![Publish Documentation](https://github.com/product-os/jellyfish-test-harness/actions/workflows/publish-docs.yml/badge.svg)](https://github.com/product-os/jellyfish-test-harness/actions/workflows/publish-docs.yml)

Visit the website for complete documentation: https://product-os.github.io/jellyfish-test-harness

