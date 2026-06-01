import { render, screen } from '@testing-library/react-native'

import Home from '@/app/index'

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useFocusEffect: () => {},
}))
jest.mock('@/services/storage/entries', () => ({
  listEntries: jest.fn().mockResolvedValue({ success: true, data: [] }),
}))

describe('Home screen', () => {
  it('renders the app name', () => {
    render(<Home />)
    expect(screen.getByText('MindWiki')).toBeTruthy()
  })
})
