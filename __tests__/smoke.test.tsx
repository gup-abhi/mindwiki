import { act, render, screen } from '@testing-library/react-native'

import Home from '@/app/(tabs)/index'

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useFocusEffect: () => {},
}))
jest.mock('@/services/storage/entries', () => ({
  listEntries: jest.fn().mockResolvedValue({ success: true, data: [] }),
}))

describe('Home screen', () => {
  it('renders the home screen', async () => {
    render(<Home />)
    expect(screen.getByText('New entry')).toBeTruthy()
    // Home mounts ModelDownloadCard, whose async readiness check setStates after
    // render — flush it inside act() so it doesn't leak into the next suite.
    await act(async () => {})
  })
})
