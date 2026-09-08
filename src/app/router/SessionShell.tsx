import { useQueryClient } from '@tanstack/react-query'
import { Outlet } from 'react-router-dom'
import { SessionProvider } from '../../features/auth/SessionProvider'

export function SessionShell() {
  const queryClient = useQueryClient()
  return (
    <SessionProvider queryClient={queryClient}>
      <Outlet />
    </SessionProvider>
  )
}
