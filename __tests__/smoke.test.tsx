import { render, screen } from '@testing-library/react-native'

import Home from '@/app/index'

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}))

describe('Home screen', () => {
  it('renders the app name', () => {
    render(<Home />)
    expect(screen.getByText('MindWiki')).toBeTruthy()
  })
})
