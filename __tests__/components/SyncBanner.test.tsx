import { render, screen } from '@testing-library/react-native'

import { SyncBanner } from '@/components/SyncBanner'
import { useSyncStore } from '@/store/sync.store'

describe('SyncBanner', () => {
  afterEach(() => useSyncStore.setState({ restoring: false }))

  it('renders nothing when not restoring', () => {
    useSyncStore.setState({ restoring: false })
    render(<SyncBanner />)
    expect(screen.queryByTestId('sync-banner')).toBeNull()
  })

  it('shows the restoring message during a fresh-login pull', () => {
    useSyncStore.setState({ restoring: true })
    render(<SyncBanner />)
    expect(screen.getByTestId('sync-banner')).toBeTruthy()
    expect(screen.getByText('Restoring your data…')).toBeTruthy()
  })
})
