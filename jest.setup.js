/* eslint-disable @typescript-eslint/no-require-imports */
// Jest global setup. Mocks native modules that can't load in the test runner.

// react-native-reanimated ships a Jest mock; wire it up so animated components
// render (no-op) in tests.
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock')
  // The mock's `call` is deprecated and warns; stub it out.
  Reanimated.default.call = () => {}
  return Reanimated
})

// Silences a useNativeDriver / worklet warning under the mock.
global.__reanimatedWorkletInit = () => {}
