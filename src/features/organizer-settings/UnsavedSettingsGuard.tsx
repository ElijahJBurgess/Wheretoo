import { useCallback } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router-dom'
import { useSession } from '../auth/SessionProvider'
import { useOptionalSignOut } from '../auth/SignOutProvider'
import { OperationsDialog } from '../organizer-operations/OperationsDialog'

export function UnsavedSettingsGuard({ dirty }: { dirty: boolean }) {
  const session = useSession()
  const signOut = useOptionalSignOut()
  const shouldWarn = dirty && session.status === 'authenticated' && !signOut?.pending
  const blocker = useBlocker(shouldWarn)
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (shouldWarn) { event.preventDefault(); event.returnValue = '' }
  }, [shouldWarn]))
  if (blocker.state !== 'blocked') return null
  return <OperationsDialog title='Discard unsaved changes?' busy={false} onClose={() => blocker.reset()}>
    <p>Your unsaved changes will be lost if you leave this page.</p>
    <div className='settings-buttons'>
      <button className='ops-button ops-button--secondary' onClick={() => blocker.reset()}>Keep editing</button>
      <button className='ops-button' onClick={() => blocker.proceed()}>Discard changes</button>
    </div>
  </OperationsDialog>
}
