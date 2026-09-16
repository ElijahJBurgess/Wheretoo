import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useSession } from '../auth/SessionProvider'
import { useOptionalSignOut } from '../auth/SignOutProvider'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { changeAccountEmail, changeAccountPassword, getAccountIdentity, requestPasswordReauthentication, safeAccountError, updateAccountName, type AccountIdentity } from '../auth/account.api'
import { UnsavedSettingsGuard } from './UnsavedSettingsGuard'

const accountKey = (userId: string) => ['account', userId] as const

export function AccountSecurityPage() {
  const session = useSession()
  const signOut = useOptionalSignOut()
  if (session.status !== 'authenticated' || signOut?.pending) return <p role="status">Loading account…</p>
  return <AccountLoader key={`${session.user.id}:${session.identityVersion ?? 0}`} userId={session.user.id} />
}

function AccountLoader({ userId }: { userId: string }) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: accountKey(userId),
    queryFn: async () => {
      const current = captureIdentityLifetime(client, userId)
      const account = await getAccountIdentity(userId, current)
      if (!current()) throw new Error('Account session changed')
      return account
    },
    staleTime: 0, gcTime: 0, retry: false, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  if (query.isPending) return <p role="status">Loading account…</p>
  if (query.isError || !query.data) return <div className="settings-section"><p role="alert">{safeAccountError(query.error).message}</p><button className="ops-button" onClick={() => void query.refetch()}>Try again</button></div>
  return <AccountEditor userId={userId} account={query.data} refreshing={query.isFetching} refresh={() => void query.refetch()} />
}

type Editor = 'name' | 'email' | 'password' | null
function AccountEditor({ userId, account, refreshing, refresh }: { userId: string; account: AccountIdentity; refreshing: boolean; refresh: () => void }) {
  const client = useQueryClient()
  const mounted = useRef(false)
  const latch = useRef(false)
  const [editing, setEditing] = useState<Editor>(null)
  const [name, setName] = useState(account.fullName)
  const [email, setEmail] = useState(account.email ?? '')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [nonce, setNonce] = useState('')
  const [needsReauthentication, setNeedsReauthentication] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const dirty = editing === 'name' ? name !== account.fullName : editing === 'email' ? email !== (account.email ?? '') : editing === 'password' && !!(password || confirmation || nonce)
  function closeEditor() {
    setEditing(null)
    setPassword(''); setConfirmation(''); setNonce(''); setNeedsReauthentication(false)
  }
  function begin(editor: Editor) {
    setName(account.fullName); setEmail(account.email ?? '')
    setError(null); setNotice(null); closeEditor(); setEditing(editor)
  }
  function lifetime() {
    const current = captureIdentityLifetime(client, userId)
    return () => mounted.current && current()
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (latch.current || !editing) return
    if (editing === 'password' && password !== confirmation) { setError('The new passwords do not match.'); return }
    const current = lifetime()
    latch.current = true; setPending(true); setError(null); setNotice(null)
    try {
      if (editing === 'password') {
        await changeAccountPassword(userId, password, nonce || undefined, current)
        if (!current()) return
        closeEditor(); setNotice('Password updated.')
      } else {
        const result = editing === 'name' ? await updateAccountName(userId, name, current) : await changeAccountEmail(userId, email, current)
        if (!current()) return
        client.setQueryData(accountKey(userId), result)
        setNotice(editing === 'name' ? 'Account name updated.' : result.pendingEmail ? 'Email change requested. Follow the provider confirmation instructions; your current login email remains active until the change is confirmed.' : result.email === email.trim() ? 'Login email updated.' : 'Email change requested. Refresh account status to check the provider result.')
        closeEditor()
      }
    } catch (failure) {
      if (!current()) return
      const safe = safeAccountError(failure)
      setError(safe.message)
      if (safe.code === 'reauthentication_required') setNeedsReauthentication(true)
    } finally {
      latch.current = false
      if (current()) setPending(false)
    }
  }
  async function sendCode() {
    if (latch.current) return
    const current = lifetime()
    latch.current = true; setPending(true); setError(null); setNotice(null)
    try {
      await requestPasswordReauthentication(userId, current)
      if (current()) setNotice('A verification code was requested. Check your account’s verified contact method, then enter the code below.')
    } catch (failure) { if (current()) setError(safeAccountError(failure).message) }
    finally { latch.current = false; if (current()) setPending(false) }
  }
  return <div className="settings-stack">
    <UnsavedSettingsGuard dirty={dirty} />
    <h2>Account &amp; Security</h2>
    <p className="settings-muted">Manage your private login identity. Your account name is separate from the public organizer name.</p>
    {error && <p className="settings-error" role="alert">{error}</p>}
    {notice && <p className="settings-notice" role="status">{notice}</p>}
    <section className="settings-section" aria-labelledby="account-name-title">
      <h2 id="account-name-title">Account name</h2>
      <p>{account.fullName || 'No account name set'}</p>
      {editing !== 'name' && <button className="ops-button" disabled={editing !== null} onClick={() => begin('name')}>Edit account name</button>}
      {editing === 'name' && <form className="settings-form" onSubmit={save}>
        <label className="settings-field">Account name<input value={name} onChange={event => setName(event.target.value)} autoComplete="name" required maxLength={120} disabled={pending} /></label>
        <EditorActions pending={pending} label="Save account name" cancel={() => { setError(null); closeEditor() }} />
      </form>}
    </section>
    <section className="settings-section" aria-labelledby="account-email-title">
      <h2 id="account-email-title">Login email</h2>
      <p>{account.email ?? 'No login email available'}</p>
      <p className="settings-muted">{account.emailConfirmedAt ? 'Current email verified' : 'Current email not verified'}</p>
      {account.pendingEmail && <div className="settings-notice"><p>Email confirmation pending</p><p>{account.pendingEmail}</p><p>Follow the confirmation instructions sent by your account provider. Your current login email remains active until the change is confirmed.</p></div>}
      {editing !== 'email' && <button className="ops-button" disabled={editing !== null} onClick={() => begin('email')}>Change login email</button>}
      {editing === 'email' && <form className="settings-form" onSubmit={save}>
        <label className="settings-field">New login email<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required maxLength={254} disabled={pending} /></label>
        <p className="settings-muted">The provider may require confirmation at your current and new addresses.</p>
        <EditorActions pending={pending} label="Request email change" cancel={() => { setError(null); closeEditor() }} />
      </form>}
      <button className="ops-button" disabled={refreshing || editing !== null} onClick={refresh}>{refreshing ? 'Refreshing account…' : 'Refresh account status'}</button>
    </section>
    <section className="settings-section" aria-labelledby="account-password-title">
      <h2 id="account-password-title">Password</h2>
      <p className="settings-muted">Update the password used to sign in to your account.</p>
      {editing !== 'password' && <button className="ops-button" disabled={editing !== null} onClick={() => begin('password')}>Change password</button>}
      {editing === 'password' && <form className="settings-form" onSubmit={save}>
        <label className="settings-field">New password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" required minLength={8} maxLength={128} disabled={pending} /></label>
        <label className="settings-field">Confirm new password<input type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="new-password" required minLength={8} maxLength={128} disabled={pending} /></label>
        <p className="settings-muted">Use at least 8 characters. Your account provider may require additional security checks.</p>
        {needsReauthentication && <div className="settings-stack"><button type="button" className="ops-button" disabled={pending} onClick={() => void sendCode()}>Send verification code</button><label className="settings-field">Verification code<input value={nonce} onChange={event => setNonce(event.target.value)} autoComplete="one-time-code" disabled={pending} /></label></div>}
        <EditorActions pending={pending} label="Save password" cancel={() => { setError(null); closeEditor() }} />
      </form>}
    </section>
  </div>
}
function EditorActions({ pending, label, cancel }: { pending: boolean; label: string; cancel: () => void }) {
  return <div className="settings-buttons"><button type="submit" className="ops-button" disabled={pending}>{pending ? 'Saving…' : label}</button><button type="button" className="ops-button" disabled={pending} onClick={cancel}>Cancel</button></div>
}
