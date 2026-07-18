import { fireEvent, render, screen } from '@testing-library/react-native'

import { OnboardingCarousel } from '@/components/onboarding/OnboardingCarousel'

describe('OnboardingCarousel', () => {
  it('opens on the first slide with Skip and Next', () => {
    render(<OnboardingCarousel onDone={jest.fn()} />)
    expect(screen.getByText('A journal that thinks with you')).toBeTruthy()
    expect(screen.getByTestId('onboarding-skip')).toBeTruthy()
    expect(screen.getByText('Next')).toBeTruthy()
  })

  it('shows the inline confirm when Skip is pressed, then calls onDone on Continue', () => {
    const onDone = jest.fn()
    render(<OnboardingCarousel onDone={onDone} />)
    fireEvent.press(screen.getByTestId('onboarding-skip'))
    // Confirm dialog appears — Cancel and Continue visible.
    expect(screen.getByTestId('onboarding-skip-cancel')).toBeTruthy()
    expect(screen.getByTestId('onboarding-skip-confirm')).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()

    fireEvent.press(screen.getByTestId('onboarding-skip-confirm'))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('advances through the 6 slides and completes from the final CTA', () => {
    const onDone = jest.fn()
    render(<OnboardingCarousel onDone={onDone} />)

    // Five Next presses walk from slide 0 → 5 (6 slides total); the CTA then reads "Begin".
    for (let i = 0; i < 5; i++) fireEvent.press(screen.getByTestId('onboarding-next'))
    expect(screen.getByText('Begin')).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()

    fireEvent.press(screen.getByTestId('onboarding-next'))
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
