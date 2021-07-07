# How to write tests

Tests follow this file structure:

```
[test-name]/
    stubs/
        user-[username].json
    expected.json
    01.json
    02.json
    ...
```

Tests also have to be included in the appropriate `tests/integration/sync/webhooks/[source]/index.js` such as:

```js
'check-run': {
  expected: require('./check-run/expected.json'),
  steps: [
    require('./check-run/01.json')
  ]
},
```

As well as in the `cards` in `tests/integration/sync/[source]-translate.spec.js` such as:

```js
syncIntegrationScenario.run(ava, {
	basePath: __dirname,
	plugins: [ ActionLibrary, DefaultPlugin ],
	cards: [ 'issue', 'pull-request', 'message', 'repository', 'gh-push', 'check-run' ]
  ...
```

### `expected.json`

What are `head` and `tail`?

`head` is main contract being synced. _don't know entirely what this means but it seems to be what you want it to start as_

`tail` is the actions that are taken to make the contract, so `create` and `update` contracts that are the operations that create or update your contract.
