import { fireEvent, render, screen } from '@testing-library/react-native'

import { ModelDownloadCard } from '@/components/ModelDownloadCard'
import { useModelDownload } from '@/hooks/useModelDownload'

jest.mock('@/hooks/useModelDownload', () => ({ useModelDownload: jest.fn() }))

const mockHook = useModelDownload as jest.Mock
const base = { ready: false, canStart: false, downloading: false, progress: 0, deepProgress: null, error: null, download: jest.fn() }

beforeEach(() => jest.clearAllMocks())

describe('ModelDownloadCard', () => {
  it('renders nothing while checking (both null) or when ready', () => {
    mockHook.mockReturnValue({ ...base, ready: null, canStart: null })
    expect(render(<ModelDownloadCard />).toJSON()).toBeNull()
    mockHook.mockReturnValue({ ...base, ready: true, canStart: true })
    expect(render(<ModelDownloadCard />).toJSON()).toBeNull()
  })

  it('shows the prompt and triggers download', () => {
    const download = jest.fn()
    mockHook.mockReturnValue({ ...base, ready: false, canStart: false, download })
    render(<ModelDownloadCard />)
    expect(screen.getByText('Download AI models')).toBeTruthy()
    fireEvent.press(screen.getByTestId('model-download-card'))
    expect(download).toHaveBeenCalled()
  })

  it('shows progress while downloading and does not re-trigger', () => {
    const download = jest.fn()
    mockHook.mockReturnValue({ ...base, ready: false, canStart: false, downloading: true, progress: 0.42, download })
    render(<ModelDownloadCard />)
    expect(screen.getByText('Downloading… 42%')).toBeTruthy()
    fireEvent.press(screen.getByTestId('model-download-card'))
    expect(download).not.toHaveBeenCalled() // disabled mid-download
  })

  it('shows the almost-ready card when fast model is present but deep is still downloading', () => {
    mockHook.mockReturnValue({ ...base, ready: false, canStart: true, deepProgress: 0.6 })
    render(<ModelDownloadCard />)
    expect(screen.getByText('Almost ready…')).toBeTruthy()
    expect(screen.getByText('Finishing up the deep model… 60%')).toBeTruthy()
  })
})
