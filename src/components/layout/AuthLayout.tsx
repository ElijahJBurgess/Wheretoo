import type { PropsWithChildren, ReactNode } from 'react'
import { OnboardingLayout } from '../../features/organizer-onboarding/OnboardingLayout'

export function AuthLayout({ children, hero = false, headerAction }: PropsWithChildren<{ hero?: boolean; headerAction?: ReactNode }>) {
  return (
    <OnboardingLayout headerAction={headerAction} hero={hero}>{children}</OnboardingLayout>
  )
}
