// Manual mock — @expo/vector-icons loads native fonts that break the Jest
// renderer. Every icon set (Ionicons, MaterialIcons, …) becomes a lightweight
// Text stub that renders its `name`, so icon-bearing components mount in tests.
const React = require('react')
const { Text } = require('react-native')

const Icon = ({ name, ...rest }) => React.createElement(Text, rest, name)

module.exports = new Proxy(
  {},
  {
    get: (_target, prop) => (prop === '__esModule' ? false : Icon),
  }
)
