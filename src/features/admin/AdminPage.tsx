import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { ReadState } from '../../components/ui/ReadState'
import { useSession } from '../auth/SessionProvider'
import { useSignOut } from '../auth/SignOutProvider'
import { signInOrganizer } from '../auth/auth.api'
import { changeAccountPassword, requestPasswordReauthentication, safeAccountError } from '../auth/account.api'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { useStaffRole } from '../moderation/moderation.queries'
import { requestPasswordReset } from './admin.api'
import './admin.css'

export function AdminPasswordResetRequestPage() {
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setMessage(''); setError('')
    try {
      await requestPasswordReset(email)
      setMessage('If this account can receive password resets, check your email for a secure link.')
    } catch { setError('We could not send the reset email. Please try again later.') }
    finally { setPending(false) }
  }
  return <AuthLayout><section className="onboarding-form" aria-labelledby="admin-reset-title">
    <h1 id="admin-reset-title">Reset your password</h1>
    <p>Use the email address for your account. Your password is set through Supabase’s secure recovery flow.</p>
    {message ? <p role="status">{message}</p> : null}{error ? <p role="alert">{error}</p> : null}
    <form className="auth-form" onSubmit={event => void submit(event)}>
      <Field label="Email" name="email"><input id="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></Field>
      <Button type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send reset email'}</Button>
    </form><p><Link to="/admin">Back to admin sign in</Link></p>
  </section></AuthLayout>
}

export function AdminPage({ resetPassword = false }: { resetPassword?: boolean }) {
  const session = useSession()
  // Credential fields belong to one identity lifetime, including cross-tab account changes.
  const identityKey = `${session.status}:${session.user?.id ?? ''}:${session.identityVersion ?? 0}`
  return <AdminExperience key={identityKey} resetPassword={resetPassword} />
}

function AdminExperience({ resetPassword }: { resetPassword: boolean }) {
  const session = useSession()
  const role = useStaffRole(session.status === 'authenticated' ? session.user.id : '')
  const controller = useSignOut()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [nonce, setNonce] = useState('')
  const [needsReauthentication, setNeedsReauthentication] = useState(false)
  const mounted = useRef(true)
  const latch = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  function lifetime() {
    const current = captureIdentityLifetime(queryClient, session.user?.id ?? null)
    return () => mounted.current && current()
  }
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  async function signIn(event: FormEvent) {
    event.preventDefault(); setPending(true); setError('')
    try { await signInOrganizer({ email: email.trim(), password }); controller.dismissNotice() }
    catch { setError('Sign in failed. Check your email and password and try again.') }
    finally { setPassword(''); setPending(false) }
  }
  async function savePassword(event: FormEvent) {
    event.preventDefault(); if (latch.current) return; setError(''); setMessage('')
    if (session.status !== 'authenticated' || role.data !== 'admin') return
    if (password !== confirmation) { setError('Passwords must match.'); return }
    const isCurrent = lifetime()
    latch.current = true; setPending(true)
    try {
      await changeAccountPassword(session.user.id, password, nonce || undefined, isCurrent)
      if (isCurrent()) setMessage('Password updated. You can return to admin.')
    } catch (failure) {
      if (isCurrent()) {
        const safe = safeAccountError(failure)
        setError(safe.message)
        if (safe.code === 'reauthentication_required') setNeedsReauthentication(true)
      }
    } finally { latch.current = false; if (isCurrent()) { setPassword(''); setConfirmation(''); setNonce(''); setPending(false) } }
  }
  async function sendCode() {
    if (session.status !== 'authenticated' || latch.current) return
    const isCurrent = lifetime()
    latch.current = true; setPending(true); setError(''); setMessage('')
    try {
      await requestPasswordReauthentication(session.user.id, isCurrent)
      if (isCurrent()) setMessage('A verification code was requested. Check your verified contact method and enter the code below.')
    } catch (failure) { if (isCurrent()) setError(safeAccountError(failure).message) }
    finally { latch.current = false; if (isCurrent()) setPending(false) }

  }
  const signOut = async () => {
    if (session.status !== 'authenticated') return
    await controller.signOut(session.session)
  }
  let content
  if (session.status === 'loading') content = <ReadState status="loading" headingAs="h1" title="Loading admin" />
  else if (session.status === 'unavailable') content = <ReadState status="unavailable" headingAs="h1" title="Session unavailable" description="Reload this page to try again." />
  else if (session.status === 'anonymous') content = resetPassword ? <>
    <h1>Set your password</h1><p>Open the password-reset link from your email.</p><Link to="/admin/forgot-password">Request a new reset email</Link><p><Link to="/admin">Back to admin sign in</Link></p>
  </> : <>
    <h1>Admin sign in</h1><p>Sign in with your Wheretoo staff account.</p>
    <form className="auth-form" onSubmit={event => void signIn(event)}>
      <Field label="Email" name="email"><input id="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></Field>
      <Field label="Password" name="password"><input id="password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></Field>
      <Button type="submit" disabled={pending || controller.pending}>{pending ? 'Signing in…' : 'Sign in'}</Button>
    </form><p><Link to="/admin/forgot-password">Forgot your password?</Link></p>
  </>
  else if (role.isPending) content = <ReadState status="loading" headingAs="h1" title="Checking admin access" />
  else if (role.isError || role.data === undefined) content = <ReadState status="unavailable" headingAs="h1" title="Admin access could not be confirmed" action={<Button onClick={() => void role.refetch()}>Try again</Button>} />
  else if (role.data !== 'admin') content = <ReadState status="denied" headingAs="h1" title="Admin access required" description="An active admin role is required for this area." />
  else if (resetPassword) content = <>
    <h1>Set your password</h1>
    <form className="auth-form" onSubmit={event => void savePassword(event)}>
      <Field label="New password" name="new-password"><input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} /></Field>
      <Field label="Confirm password" name="confirm-password"><input id="confirm-password" type="password" autoComplete="new-password" required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></Field>
      <>{needsReauthentication ? <><Button type="button" disabled={pending} onClick={() => void sendCode()}>Send verification code</Button><Field label="Verification code" name="nonce"><input id="nonce" autoComplete="one-time-code" value={nonce} onChange={event => setNonce(event.target.value)} /></Field></> : null}</>
      <Button type="submit" disabled={pending || controller.pending}>{pending ? 'Saving…' : 'Save password'}</Button>
    </form><p><Link to="/admin">Return to admin</Link></p>
  </>
  else content = <>
    <h1>Wheretoo admin</h1><p>{session.user.email}</p>
    <section className="admin-section" aria-labelledby="admin-moderation"><h2 id="admin-moderation">Event moderation</h2><p>Review events, record decisions, and inspect their history.</p><Link className="ui-button ui-button--primary" to="/moderation">Open event moderation</Link></section>
    <section className="admin-section" aria-labelledby="admin-icons"><h2 id="admin-icons">Custom-icon approvals</h2><p>Coming later. Custom-icon submissions and approvals are not enabled.</p></section>
    <p><Link to="/admin/reset-password">Change password</Link></p>
  </>
  return <AuthLayout headerAction={session.status === 'authenticated' ? <Button disabled={controller.pending || pending} onClick={() => void signOut()}>Sign out</Button> : undefined}>
    <section className="onboarding-form">
      {error ? <p role="alert">{error}</p> : null}{controller.error ? <p role="alert">{controller.error}</p> : null}
      {message ? <p role="status">{message}</p> : null}{controller.notice ? <p role="status">{controller.notice}</p> : null}
      {content}
    </section>
  </AuthLayout>
}
export function AdminPasswordResetPage() { return <AdminPage resetPassword /> }
