import { SignOutProvider } from '../../features/auth/SignOutProvider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type PropsWithChildren } from 'react'
import { ConnectivityHint } from '../connectivity/ConnectivityHint'

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  )

  return <QueryClientProvider client={queryClient}><SignOutProvider><ConnectivityHint />{children}</SignOutProvider></QueryClientProvider>
}
