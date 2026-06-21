import { fireEvent, render, screen } from '@testing-library/react-native'

import { OnboardingCarousel } from '@/components/onboarding/OnboardingCarousel'

describe('OnboardingCarousel', () => {
  it('opens on the first slide with Skip and Next', () => {
    render(<OnboardingCarousel onDone={jest.fn()} />)
    expect(screen.getByText('A journal that thinks with you')).toBeTruthy()
    expect(screen.getByTestId('onboarding-skip')).toBeTruthy()
    expect(screen.getByText('Next')).toBeTruthy()
  })

  it('finishes immediately when Skip is pressed', () => {
    const onDone = jest.fn()
    render(<OnboardingCarousel onDone={onDone} />)
    fireEvent.press(screen.getByTestId('onboarding-skip'))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('advances through the slides and completes from the final CTA', () => {
    const onDone = jest.fn()
    render(<OnboardingCarousel onDone={onDone} />)

    // Four Next presses walk to the last slide; the CTA then changes label.
    for (let i = 0; i < 4; i++) fireEvent.press(screen.getByTestId('onboarding-next'))
    expect(screen.getByText('Start journaling')).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()

    fireEvent.press(screen.getByTestId('onboarding-next'))
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
