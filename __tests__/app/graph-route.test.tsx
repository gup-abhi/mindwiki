import { render, waitFor } from '@testing-library/react-native'

import GraphRedirect from '@/app/graph'

const mockReplace = jest.fn()
let mockParams: Record<string, string> = {}
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => mockParams,
}))

const NODE_ID = '123e4567-e89b-42d3-a456-426614174000'

describe('/graph privacy redirect', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockParams = {}
  })

  it('forwards only validated opaque node IDs', async () => {
    mockParams = { nodeId: NODE_ID }
    render(<GraphRedirect />)
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/(tabs)/you',
      params: { nodeId: NODE_ID },
    }))
  })

  it('drops private or malformed route values', async () => {
    mockParams = { nodeId: 'Work stress / private label' }
    render(<GraphRedirect />)
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/(tabs)/you',
      params: {},
    }))
  })
})