import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { signInOrganizer, signUpOrganizer } = vi.hoisted(() => ({
  signInOrganizer: vi.fn(),
  signUpOrganizer: vi.fn(),
}))

vi.mock('./auth.api', () => ({ signInOrganizer, signUpOrganizer }))

import { SignInPage } from './SignInPage'
import { SignUpPage } from './SignUpPage'

function renderSignUp() {
  return render(
    <MemoryRouter initialEntries={['/auth/sign-up']}>
      <Routes>
        <Route path="/auth/sign-up" element={<SignUpPage />} />
        <Route path="/auth/check-email" element={<p>check-email destination</p>} />
        <Route path="/organizer/setup" element={<p>setup destination</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderSignIn() {
  return render(
    <MemoryRouter initialEntries={['/auth/sign-in']}>
      <Routes>
        <Route path="/auth/sign-in" element={<SignInPage />} />
        <Route path="/organizer/events" element={<p>events destination</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function fillSignup(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Full name'), 'Avery Stone')
  await user.type(screen.getByLabelText('Email'), 'organizer@example.com')
  await user.type(screen.getByLabelText('Password'), 'safe-password')
}

describe('organizer auth pages', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders accessible validation errors for invalid signup fields', async () => {
    const user = userEvent.setup()
    renderSignUp()

    await user.type(screen.getByLabelText('Full name'), 'A')
    await user.type(screen.getByLabelText('Email'), 'invalid')
    await user.type(screen.getByLabelText('Password'), '1234567')
    await user.click(screen.getByRole('button', { name: 'Create organizer account' }))

    expect(await screen.findAllByRole('alert')).toHaveLength(4)
    expect(screen.getByText('Check the highlighted fields')).toBeInTheDocument()
    expect(screen.getAllByText('Too small: expected string to have >=2 characters')).toHaveLength(2)
    expect(screen.getByLabelText('Full name')).toHaveAttribute('aria-invalid', 'true')
    expect(signUpOrganizer).not.toHaveBeenCalled()
  })

  it('retains entered signup values and shows a server error', async () => {
    const user = userEvent.setup()
    signUpOrganizer.mockRejectedValue(new Error('Email already registered'))
    renderSignUp()
    await fillSignup(user)

    await user.click(screen.getByRole('button', { name: 'Create organizer account' }))

    expect(await screen.findByText('Email already registered')).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toHaveValue('Avery Stone')
    expect(screen.getByLabelText('Email')).toHaveValue('organizer@example.com')
  })

  it('disables signup while pending and routes an immediate session to setup', async () => {
    const user = userEvent.setup()
    let resolveSignup!: (value: { needsEmailConfirmation: boolean }) => void
    signUpOrganizer.mockReturnValue(new Promise((resolve) => (resolveSignup = resolve)))
    renderSignUp()
    await fillSignup(user)

    await user.click(screen.getByRole('button', { name: 'Create organizer account' }))
    expect(screen.getByRole('button', { name: 'Creating account…' })).toBeDisabled()

    resolveSignup({ needsEmailConfirmation: false })
    expect(await screen.findByText('setup destination')).toBeInTheDocument()
  })

  it('routes signup without a session to check email', async () => {
    const user = userEvent.setup()
    signUpOrganizer.mockResolvedValue({ needsEmailConfirmation: true })
    renderSignUp()
    await fillSignup(user)

    await user.click(screen.getByRole('button', { name: 'Create organizer account' }))
    expect(await screen.findByText('check-email destination')).toBeInTheDocument()
  })

  it('signs in and routes to organizer events', async () => {
    const user = userEvent.setup()
    signInOrganizer.mockResolvedValue(undefined)
    renderSignIn()

    await user.type(screen.getByLabelText('Email'), 'organizer@example.com')
    await user.type(screen.getByLabelText('Password'), 'safe-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(signInOrganizer).toHaveBeenCalledWith({
      email: 'organizer@example.com',
      password: 'safe-password',
    })
    expect(await screen.findByText('events destination')).toBeInTheDocument()
  })

  it('retains sign-in values and renders a server error', async () => {
    const user = userEvent.setup()
    signInOrganizer.mockRejectedValue(new Error('Invalid login credentials'))
    renderSignIn()

    await user.type(screen.getByLabelText('Email'), 'organizer@example.com')
    await user.type(screen.getByLabelText('Password'), 'safe-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveValue('organizer@example.com')
    expect(screen.getByLabelText('Password')).toHaveValue('safe-password')
  })

  it('disables sign-in while the request is pending', async () => {
    const user = userEvent.setup()
    let resolveSignIn!: () => void
    signInOrganizer.mockReturnValue(new Promise<void>((resolve) => (resolveSignIn = resolve)))
    renderSignIn()

    await user.type(screen.getByLabelText('Email'), 'organizer@example.com')
    await user.type(screen.getByLabelText('Password'), 'safe-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled()
    resolveSignIn()
    expect(await screen.findByText('events destination')).toBeInTheDocument()
  })
})
