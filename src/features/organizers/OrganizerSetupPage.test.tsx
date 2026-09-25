import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
vi.mock('./OrganizerProfileEditor', () => ({ OrganizerProfileEditor: ({ settings }: { settings?: boolean }) => <p>{settings ? 'Settings context' : 'Onboarding context'}</p> }))
import { OrganizerSetupPage } from './OrganizerSetupPage'
it('uses the shared Profile editor in onboarding context', () => { render(<OrganizerSetupPage />); expect(screen.getByText('Onboarding context')).toBeInTheDocument() })
