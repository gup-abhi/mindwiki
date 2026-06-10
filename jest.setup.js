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

// Biometric auth: succeed by default; report NO enrolled credential so the
// app-lock gate stays inert in unrelated tests (tests that exercise the lock
// override getEnrolledLevelAsync explicitly).
jest.mock('expo-local-authentication', () => ({
  authenticateAsync: jest.fn(async () => ({ success: true })),
  getEnrolledLevelAsync: jest.fn(async () => 0),
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC: 2 },
}))

// In-memory SecureStore so persisted preferences/tokens work in tests.
jest.mock('expo-secure-store', () => {
  const store = new Map()
  return {
    getItemAsync: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => {
      store.set(k, v)
    }),
    deleteItemAsync: jest.fn(async (k) => {
      store.delete(k)
    }),
  }
})
