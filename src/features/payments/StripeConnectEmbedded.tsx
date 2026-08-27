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

const connectInstances = new WeakMap<ConnectAccountSession, ReturnType<typeof loadConnectAndInitialize>>()

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

function connectInstanceForSession(
  initialSession: ConnectAccountSession,
  refreshAccountSession: () => Promise<ConnectAccountSession>,
) {
  const existing = connectInstances.get(initialSession)
  if (existing) return existing

  const instance = loadConnectAndInitialize({
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
  })
  connectInstances.set(initialSession, instance)
  return instance
}

export default function StripeConnectEmbedded({
  initialSession,
  mode,
  onExit,
  onLoadError,
  refreshAccountSession,
}: StripeConnectEmbeddedProps) {
  const [connectInstance] = useState(() => connectInstanceForSession(initialSession, refreshAccountSession))

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
