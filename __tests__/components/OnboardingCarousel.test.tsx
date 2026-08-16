import { fireEvent, render, screen } from '@testing-library/react-native'

import { OnboardingCarousel } from '@/components/onboarding/OnboardingCarousel'

describe('OnboardingCarousel', () => {
  it('opens on the first slide with accessible progress', () => {
    render(<OnboardingCarousel onDone={jest.fn()} onSignIn={jest.fn()} />)
    const introduction = screen.getByTestId('onboarding')
    expect(screen.getByText('A journal that thinks with you')).toBeTruthy()
    expect(introduction).toBeTruthy()
    expect(screen.getByLabelText('Introduction slide 1 of 6')).toBeTruthy()
    expect(screen.getByTestId('onboarding-sign-in')).toBeTruthy()
    expect(screen.getByTestId('onboarding-skip')).toBeTruthy()
    expect(screen.getByText('Next')).toBeTruthy()
  })

  it('opens returning-user authentication from Sign in', () => {
    const onSignIn = jest.fn()
    render(<OnboardingCarousel onDone={jest.fn()} onSignIn={onSignIn} />)
    fireEvent.press(screen.getByTestId('onboarding-sign-in'))
    expect(onSignIn).toHaveBeenCalledTimes(1)
  })

  it('shows the inline confirm when Skip is pressed, then calls onDone on Continue', () => {
    const onDone = jest.fn()
    render(<OnboardingCarousel onDone={onDone} onSignIn={jest.fn()} />)
    fireEvent.press(screen.getByTestId('onboarding-skip'))
    expect(screen.getByText(/Skip the introduction and continue to account setup/)).toBeTruthy()
    expect(screen.getByText(/on-device AI remains optional/)).toBeTruthy()
    // Confirm dialog appears — Cancel and Continue visible.
    expect(screen.getByTestId('onboarding-skip-cancel')).toBeTruthy()
    expect(screen.getByTestId('onboarding-skip-confirm')).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()

    fireEvent.press(screen.getByTestId('onboarding-skip-confirm'))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('explains that skipping before account entry only closes the introduction', () => {
    render(<OnboardingCarousel onDone={jest.fn()} />)
    fireEvent.press(screen.getByTestId('onboarding-skip'))
    expect(screen.getByText(/You can replay it later in Settings/)).toBeTruthy()
  })

  it('advances through the 6 slides and completes from the final CTA', () => {
    const onDone = jest.fn()
    render(<OnboardingCarousel onDone={onDone} onSignIn={jest.fn()} />)

    // Five Next presses walk from slide 0 → 5 (6 slides total).
    for (let i = 0; i < 5; i++) fireEvent.press(screen.getByTestId('onboarding-next'))
    expect(screen.getByText('Create your account')).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()

    fireEvent.press(screen.getByTestId('onboarding-next'))
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
