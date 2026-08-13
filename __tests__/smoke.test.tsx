import { act, render, screen } from '@testing-library/react-native'

import Home from '@/app/(tabs)/index'

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useFocusEffect: () => {},
}))
jest.mock('@/services/storage/entries', () => ({
  listEntries: jest.fn().mockResolvedValue({ success: true, data: [] }),
}))
jest.mock('@/services/onboarding/first-run', () => ({
  getModelDownloadPreference: jest.fn().mockResolvedValue('undecided'),
  setModelDownloadPreference: jest.fn().mockResolvedValue(undefined),
}))

describe('Home screen', () => {
  it('renders the home screen', async () => {
    render(<Home />)
    expect(screen.getByTestId('home-new-entry')).toBeTruthy()
    // Home mounts ModelDownloadCard, whose async readiness check setStates after
    // render — flush it inside act() so it doesn't leak into the next suite.
    await act(async () => {})
  })
})
