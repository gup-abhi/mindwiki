import { fireEvent, render, screen } from '@testing-library/react-native'

import NotificationSettings from '@/app/notification-settings'
import { useNotifications } from '@/hooks/useNotifications'

const mockBack = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }))
jest.mock('@/hooks/useNotifications', () => ({ useNotifications: jest.fn() }))

const mockNotifications = useNotifications as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockNotifications.mockReturnValue({
    preferences: {
      enabled: true,
      routineWeekdays: [1, 2, 3, 4, 5],
      routineHour: 20,
      retryDelayMinutes: 60,
      pausedUntil: null,
      firstPlanSavedAt: null,
      setupDismissed: false,
      challenge: false,
      insights: false,
      weeklyReview: false,
      journal: true,
      reengagement: true,
      momentum: false,
      patterns: false,
      quietStartHour: 21,
      quietEndHour: 9,
      reminderStartHour: 17,
      reminderEndHour: 21,
    },
    permission: 'granted',
    busy: false,
    update: jest.fn().mockResolvedValue({ success: true, data: undefined }),
    savePlan: jest.fn().mockResolvedValue({ success: true, data: undefined }),
    openSystemSettings: jest.fn(),
  })
})

describe('NotificationSettings', () => {
  it('renders the routine controls outside the main Settings screen', () => {
    render(<NotificationSettings />)
    expect(screen.getByText('Notification settings')).toBeTruthy()
    expect(screen.getByTestId('notification-settings-editor')).toBeTruthy()
    expect(screen.getByTestId('notification-settings-pause-tomorrow')).toBeTruthy()
  })

  it('saves an edited routine through the notification hook', async () => {
    const savePlan = jest.fn().mockResolvedValue({ success: true, data: undefined })
    mockNotifications.mockReturnValue({
      ...mockNotifications(),
      savePlan,
    })
    render(<NotificationSettings />)
    fireEvent.press(screen.getByTestId('notification-settings-editor-hour-picker-18'))
    fireEvent.press(screen.getByTestId('notification-settings-editor-save'))
    expect(savePlan).toHaveBeenCalledWith(expect.objectContaining({ routineHour: 18 }))
    const status = await screen.findByTestId('notification-settings-status')
    expect(status.props.children).toBe('Routine saved on this device.')
  })

  it('opens system settings when permission is blocked', () => {
    const openSystemSettings = jest.fn()
    mockNotifications.mockReturnValue({
      ...mockNotifications(),
      permission: 'blocked',
      openSystemSettings,
    })
    render(<NotificationSettings />)
    fireEvent.press(screen.getByTestId('notification-settings-system'))
    expect(openSystemSettings).toHaveBeenCalled()
  })
})
