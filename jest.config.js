const base = require('@balena/jellyfish-config/config/jest.config')

module.exports = {
	...base,
	roots: [
		'lib'
	]
}
