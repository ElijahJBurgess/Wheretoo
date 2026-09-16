import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { getDelivery, getResendStatus, requestResend } from './delivery.api'
import { clearResend, readResend, rememberResend, retireResend } from './delivery.session'
import type { OwnedDeliverySource } from './delivery.schemas'
import { isOperationsAccessDenied } from '../organizer-operations/operations.errors'
export const deliveryKeys = {
  source: (s: OwnedDeliverySource) => ['organizer-operations', s.ownerId, s.eventId, 'ticket-delivery', s.sourceKind, s.sourceId] as const,
}
export function useTicketResend(source: OwnedDeliverySource) {
  const client = useQueryClient()
  const [requestId, setRequestId] = useState(() => readResend(source))
  const [ack, setAck] = useState<'queued' | 'unknown' | 'not_enabled' | 'ineligible' | 'rate_limited' | null>(null)
  const [busy, setBusy] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const latch = useRef(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const summary = useQuery({ queryKey: deliveryKeys.source(source), queryFn: ({ signal }) => getDelivery(source, signal), enabled: !!source.ownerId, retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always' })
  const status = useQuery({
    queryKey: [...deliveryKeys.source(source), 'request', requestId], queryFn: ({ signal }) => getResendStatus(source, requestId!, signal), enabled: !!source.ownerId && !!requestId, retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always',
    refetchInterval: query => isOperationsAccessDenied(query.state.error) ? false : query.state.data && ['queued', 'sending', 'unknown'].includes(query.state.data.state) ? 5000 : false,
  })
  const terminalState = status.isFetchedAfterMount && !status.isError ? status.data?.state : undefined
  useEffect(() => {
    if (!requestId || (terminalState !== 'accepted' && terminalState !== 'failed' && terminalState !== 'suppressed')) return
    try { retireResend(source, requestId, terminalState) } catch { /* Keep unresolved identity if storage becomes unavailable. */ }
  }, [source, requestId, terminalState])
  const canRequestFresh = (terminalState === 'accepted' || terminalState === 'failed' || terminalState === 'suppressed') && status.data?.observation !== 'bounced' && status.data?.observation !== 'complained'
  async function send(fresh = false) {
    if (latch.current || !summary.isFetchedAfterMount || summary.isError || !summary.data?.eligible || !summary.data.configured) return
    if (fresh && !canRequestFresh) return
    latch.current = true
    setStorageError(false)
    let id: string
    try {
      if (fresh) clearResend(source)
      id = rememberResend(source)
    } catch { setStorageError(true); latch.current = false; return }
    setRequestId(id); setBusy(true)
    try {
      const result = await requestResend(source, id)
      if (!active.current) return
      setAck(result.kind)
      if (result.kind !== 'queued') { clearResend(source); setRequestId(null) }
    } catch {
      if (active.current) setAck('unknown')
    } finally {
      latch.current = false
      if (active.current) {
        setBusy(false)
        void client.invalidateQueries({ queryKey: deliveryKeys.source(source) })
      }
    }
  }
  return { summary, status, requestId, ack, busy, storageError, canRequestFresh, send }
}
