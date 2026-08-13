import { fireEvent, render, screen } from '@testing-library/react-native'

import { ModelDownloadCard } from '@/components/ModelDownloadCard'
import { useModelDownload } from '@/hooks/useModelDownload'

jest.mock('@/hooks/useModelDownload', () => ({ useModelDownload: jest.fn() }))

const mockHook = useModelDownload as jest.Mock
const base = { ready: false, canStart: false, downloading: false, progress: 0, deepProgress: null, error: null, preference: 'undecided', download: jest.fn(), defer: jest.fn() }

beforeEach(() => jest.clearAllMocks())

describe('ModelDownloadCard', () => {
  it('renders nothing while checking (both null) or when ready', () => {
    mockHook.mockReturnValue({ ...base, ready: null, canStart: null })
    expect(render(<ModelDownloadCard />).toJSON()).toBeNull()
    mockHook.mockReturnValue({ ...base, ready: true, canStart: true })
    expect(render(<ModelDownloadCard />).toJSON()).toBeNull()
  })

  it('shows an explicit private-AI choice and starts only after consent', () => {
    const download = jest.fn()
    const defer = jest.fn()
    mockHook.mockReturnValue({ ...base, ready: false, canStart: false, download, defer })
    render(<ModelDownloadCard />)
    expect(screen.getByText('Private on-device AI')).toBeTruthy()
    expect(screen.getByText(/about 3.2 GB/)).toBeTruthy()
    fireEvent.press(screen.getByTestId('model-download-start'))
    expect(download).toHaveBeenCalled()
    fireEvent.press(screen.getByTestId('model-download-defer'))
    expect(defer).toHaveBeenCalled()
  })

  it('does not make the deferred choice disappear from the re-entry surface', () => {
    const defer = jest.fn()
    mockHook.mockReturnValue({ ...base, preference: 'deferred', defer })
    render(<ModelDownloadCard />)
    expect(screen.getByText('Private on-device AI')).toBeTruthy()
    fireEvent.press(screen.getByTestId('model-download-defer'))
    expect(defer).toHaveBeenCalled()
  })

  it('shows a retry action after a failed download', () => {
    const download = jest.fn()
    mockHook.mockReturnValue({ ...base, preference: 'consented', error: 'Download failed', download })
    render(<ModelDownloadCard />)
    expect(screen.getByText('AI setup needs attention')).toBeTruthy()
    fireEvent.press(screen.getByTestId('model-download-retry'))
    expect(download).toHaveBeenCalled()
  })

  it('shows progress while downloading and does not re-trigger', () => {
    const download = jest.fn()
    mockHook.mockReturnValue({ ...base, ready: false, canStart: false, downloading: true, progress: 0.42, download })
    render(<ModelDownloadCard />)
    expect(screen.getByText('Downloading on-device models… 42%')).toBeTruthy()
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
