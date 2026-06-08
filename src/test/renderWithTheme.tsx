import { render } from '@testing-library/react-native'
import { type ReactElement } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { ThemeProvider } from '@/theme'

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

/** Render a component inside the SafeArea + Theme providers (for UI tests). */
export function renderWithTheme(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>{ui}</ThemeProvider>
    </SafeAreaProvider>
  )
}
