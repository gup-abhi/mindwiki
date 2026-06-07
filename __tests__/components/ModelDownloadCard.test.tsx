import { fireEvent, render, screen } from '@testing-library/react-native'

import { ModelDownloadCard } from '@/components/ModelDownloadCard'
import { useModelDownload } from '@/hooks/useModelDownload'

jest.mock('@/hooks/useModelDownload', () => ({ useModelDownload: jest.fn() }))

const mockHook = useModelDownload as jest.Mock
const base = { ready: false, downloading: false, progress: 0, error: null, download: jest.fn() }

beforeEach(() => jest.clearAllMocks())

describe('ModelDownloadCard', () => {
  it('renders nothing while checking (ready null) or when ready', () => {
    mockHook.mockReturnValue({ ...base, ready: null })
    expect(render(<ModelDownloadCard />).toJSON()).toBeNull()
    mockHook.mockReturnValue({ ...base, ready: true })
    expect(render(<ModelDownloadCard />).toJSON()).toBeNull()
  })

  it('shows the prompt and triggers download', () => {
    const download = jest.fn()
    mockHook.mockReturnValue({ ...base, ready: false, download })
    render(<ModelDownloadCard />)
    expect(screen.getByText('Download AI models')).toBeTruthy()
    fireEvent.press(screen.getByTestId('model-download-card'))
    expect(download).toHaveBeenCalled()
  })

  it('shows progress while downloading and does not re-trigger', () => {
    const download = jest.fn()
    mockHook.mockReturnValue({ ...base, ready: false, downloading: true, progress: 0.42, download })
    render(<ModelDownloadCard />)
    expect(screen.getByText('Downloading… 42%')).toBeTruthy()
    fireEvent.press(screen.getByTestId('model-download-card'))
    expect(download).not.toHaveBeenCalled() // disabled mid-download
  })
})
