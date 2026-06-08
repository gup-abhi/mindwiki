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

// SafeAreaProvider needs a layout pass to expose insets, which never fires in
// the test renderer. The library ships a mock that renders children with zero
// insets — use it so screens/layouts mount synchronously.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default
)

// Custom fonts: treat as already loaded in tests; splash no-op.
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
  hideAsync: jest.fn(() => Promise.resolve()),
}))
jest.mock('@expo-google-fonts/lora', () => ({
  useFonts: () => [true],
  Lora_400Regular: 'Lora_400Regular',
  Lora_500Medium: 'Lora_500Medium',
  Lora_600SemiBold: 'Lora_600SemiBold',
  Lora_700Bold: 'Lora_700Bold',
}))
jest.mock('@expo-google-fonts/nunito', () => ({
  Nunito_400Regular: 'Nunito_400Regular',
  Nunito_600SemiBold: 'Nunito_600SemiBold',
  Nunito_700Bold: 'Nunito_700Bold',
}))
