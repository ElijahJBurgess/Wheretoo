import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
vi.mock('../organizers/OrganizerProfileEditor', () => ({ OrganizerProfileEditor: ({ settings }: { settings?: boolean }) => <p>{settings ? 'Settings context' : 'Onboarding context'}</p> }))
import { OrganizerProfilePage } from './OrganizerProfilePage'
it('uses the shared canonical Profile editor in Settings context', () => { render(<OrganizerProfilePage />); expect(screen.getByText('Settings context')).toBeInTheDocument() })
