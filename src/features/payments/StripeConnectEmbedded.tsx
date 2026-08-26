import { loadConnectAndInitialize } from '@stripe/connect-js'
import {
  ConnectAccountManagement,
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
  ConnectNotificationBanner,
} from '@stripe/react-connect-js'
import { useState } from 'react'
import { publicEnv } from '../../lib/env'
import type { ConnectAccountSession } from './payment.api'

type StripeConnectEmbeddedProps = {
  initialSession: ConnectAccountSession
  mode: 'onboarding' | 'management'
  onExit: () => void
  onLoadError: () => void
  refreshAccountSession: () => Promise<ConnectAccountSession>
}

function createClientSecretFetcher(
  initialClientSecret: string,
  refreshAccountSession: () => Promise<ConnectAccountSession>,
) {
  let initialSecretIsAvailable = true

  return async () => {
    if (initialSecretIsAvailable) {
      initialSecretIsAvailable = false
      return initialClientSecret
    }

    return (await refreshAccountSession()).clientSecret
  }
}

export default function StripeConnectEmbedded({
  initialSession,
  mode,
  onExit,
  onLoadError,
  refreshAccountSession,
}: StripeConnectEmbeddedProps) {
  const [connectInstance] = useState(() =>
    loadConnectAndInitialize({
      publishableKey: publicEnv.stripePublishableKey,
      fetchClientSecret: createClientSecretFetcher(initialSession.clientSecret, refreshAccountSession),
      appearance: {
        variables: {
          colorPrimary: '#6d4aff',
          colorBackground: '#ffffff',
          colorText: '#19162c',
          colorDanger: '#b42318',
          borderRadius: '12px',
          fontFamily: 'Manrope Variable, sans-serif',
        },
      },
    }),
  )

  return (
    <ConnectComponentsProvider connectInstance={connectInstance}>
      <ConnectNotificationBanner onLoadError={onLoadError} />
      {mode === 'onboarding' ? (
        <ConnectAccountOnboarding onExit={onExit} onLoadError={onLoadError} />
      ) : (
        <ConnectAccountManagement onLoadError={onLoadError} />
      )}
    </ConnectComponentsProvider>
  )
}
