import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth/SessionProvider'
import { useSignOut } from '../auth/SignOutProvider'
import { getAccountIdentity } from '../auth/account.api'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { useOrganizer } from '../organizers/organizer.queries'
import { OperationsDialog } from '../organizer-operations/OperationsDialog'
import { readSettingsConfig, settingsMailto } from './settings.config'

export function AccountActionsPage() {
  const session = useSession()
  const controller = useSignOut()
  if (session.status !== 'authenticated' || controller.pending) return <p role='status'>Signing out…</p>
  return <Actions key={`${session.user.id}:${session.identityVersion ?? 0}`} userId={session.user.id} expectedSession={session.session} />
}
function Actions({ userId, expectedSession }: { userId: string; expectedSession: import('../auth/authTransitions').SignOutIdentity }) {
  const config = readSettingsConfig(import.meta.env)
  const client = useQueryClient()
  const controller = useSignOut()
  const navigate = useNavigate()
  const organizer = useOrganizer(userId)
  const [confirm, setConfirm] = useState(false)
  const [reason, setReason] = useState('')
  const [handoff, setHandoff] = useState(false)
  const account = useQuery({ queryKey: ['account', userId], queryFn: async () => {
    const current = captureIdentityLifetime(client, userId)
    const result = await getAccountIdentity(userId)
    if (!current()) throw new Error('Session changed')
    return result
  }, enabled: confirm, staleTime: 0, gcTime: 0, retry: false, refetchOnMount: 'always' })
  function close() { setConfirm(false); setReason('') }
  return <section className='settings-panel'><h2>Account Actions</h2>
    <div className='settings-row'><div><h3>Sign out</h3><p>Sign out here and request sign-out of your other organizer sessions.</p></div><button className='ops-button ops-button--secondary' disabled={controller.pending} onClick={() => void controller.signOut(expectedSession).then(result => { if (result.localSignedOut && result.isCurrent()) navigate('/auth/sign-in', { replace: true }) })}>Sign out</button></div>
    {controller.error && <p role='alert' className='settings-error'>{controller.error}</p>}
    <div className='settings-row'><div><h3>Request account closure</h3><p>Closure requires manual review. Events, orders, refunds, tickets and payment records are not deleted by this action.</p>{!config.closureEmail && <p>Account closure requests are currently unavailable.</p>}</div>{config.closureEmail && <button className='ops-button ops-button--secondary' onClick={() => { setHandoff(false); setConfirm(true) }}>Request account closure</button>}</div>
    {handoff && <p role='status' className='settings-notice'>Continue in your email app to send the request. No request has been submitted by Wheretoo.</p>}
    {confirm && <OperationsDialog title='Request manual account review?' busy={false} onClose={close}><p>Opening your email app prepares a request for review. It does not close your account. Human verification takes place outside Wheretoo.</p><label className='ops-field'>Reason (optional)<textarea value={reason} maxLength={1000} rows={4} onChange={event => setReason(event.target.value)} /></label>
      <div className='settings-buttons'>
      {account.isPending || account.isFetching || organizer.isPending ? <p role='status'>Checking current account details…</p> : account.isError || !account.data?.email || organizer.isError || !organizer.data ? <p role='alert'>Current account details could not load. Close this dialog and try again.</p> : <a className='ops-button' href={settingsMailto(config.closureEmail!, 'Account closure review', `Organizer: ${organizer.data.display_name}\nCurrent login email: ${account.data.email}\nReason: ${reason.trim()}`)} onClick={() => { setHandoff(true); close() }}>Open email app</a>}
      <button className='ops-button ops-button--secondary' onClick={close}>Cancel</button></div>
    </OperationsDialog>}
  </section>
}
