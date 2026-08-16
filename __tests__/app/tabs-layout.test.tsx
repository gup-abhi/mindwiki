import { type ReactNode } from 'react'

import { renderWithTheme } from '@/test/renderWithTheme'
import TabsLayout from '@/app/(tabs)/_layout'

const mockTabs = jest.fn()
const mockScreens = jest.fn()

jest.mock('expo-router', () => {
  const React = require('react') as typeof import('react')
  const Screen = (props: { name: string; options: Record<string, unknown> }) => {
    mockScreens(props)
    return null
  }
  const Tabs = ({ children, ...props }: { children?: ReactNode }) => {
    mockTabs(props)
    return React.createElement(React.Fragment, null, children)
  }
  return { Tabs: Object.assign(Tabs, { Screen }) }
})

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }))
jest.mock('@/lib/haptics', () => ({ haptics: { select: jest.fn() } }))

describe('TabsLayout', () => {
  beforeEach(() => mockTabs.mockClear())

  it('keeps the four labeled destinations in order and reserves safe-area space', () => {
    renderWithTheme(<TabsLayout />)

    const props = mockTabs.mock.calls[0][0] as { screenOptions: { tabBarStyle: Record<string, unknown> } }
    const screens = mockScreens.mock.calls.map(([screen]) => screen as { name: string; options: Record<string, unknown> })
    const names = screens.map((screen) => screen.name)
    const options = screens.map((screen) => screen.options)

    expect(names).toEqual(['index', 'you', 'query', 'settings'])
    expect(options.map((item) => item.title)).toEqual(['Home', 'You', 'Reflect', 'Settings'])
    expect(options.map((item) => item.tabBarAccessibilityLabel)).toEqual(['Home', 'You', 'Reflect', 'Settings'])
    expect(props.screenOptions.tabBarStyle).toEqual(expect.objectContaining({ minHeight: 90, paddingBottom: 34 }))
  })
})
