import { z } from 'zod'
import { supabase } from '../../lib/supabase/client'
export type Selector = { kind: 'everyone' } | {
  kind: 'tier' | 'order' | 'registration'
  id: string
}
export type Intent = {
  eventId: string
  selector: Selector
  subject: string
  body: string
  fingerprint: string
  requestId: string
}
const receiptSchema = z.object({
  messageId: z.uuid(),
  requestId: z.uuid(),
  queuedRecipients: z.number().int().positive(),
  confirmedAt: z.string(),
})
const optionsSchema = z.object({
  eventId: z.uuid(),
  admissionType: z.enum(['paid', 'free']),
  deadline: z.string().nullable(),
  canSend: z.boolean(),
  reason: z.string().nullable(),
  replyTo: z.string().nullable(),
  tiers: z.array(
    z.object({ id: z.uuid(), name: z.string(), archived: z.boolean() }),
  ),
})
const previewSchema = z.object({
  recipientCount: z.number().int().nonnegative(),
  canSend: z.boolean(),
  reason: z.string().nullable(),
  audienceLabel: z.string(),
  deadline: z.string().nullable(),
  fingerprint: z.string(),
  subject: z.string(),
  body: z.string(),
  html: z.string(),
  text: z.string(),
  from: z.string(),
  replyTo: z.string(),
})
export type MessageOptions = z.infer<typeof optionsSchema>
export type MessagePreview = z.infer<typeof previewSchema>
export type MessageReceipt = z.infer<typeof receiptSchema>
export class MessageError extends Error {
  constructor(
    readonly code: string,
    readonly outcome: 'unknown' | 'not_queued' = 'unknown',
  ) {
    super(code)
  }
}
async function call<T>(
  ownerId: string,
  body: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  const { data: auth, error: authError } = await supabase.auth.getSession()
  if (authError || auth.session?.user.id !== ownerId) {
    // This attempt was not dispatched; it does not resolve an earlier unknown
    // attempt with the same request ID. The composer retains that protection.
    throw new MessageError('UNAUTHORIZED', 'not_queued')
  }
  try {
    const { data, error } = await supabase.functions.invoke(
      'organizer-message',
      {
        body,
        headers: { Authorization: `Bearer ${auth.session.access_token}` },
      },
    )
    let result: unknown = data
    if (error && error.context instanceof Response) {
      try {
        result = await error.context.json()
      } catch {
        throw new MessageError('SUBMISSION_UNKNOWN')
      }
    }
    const failure = z.object({
      error: z.object({
        code: z.string(),
        submissionOutcome: z.enum(['not_queued', 'unknown']).optional(),
      }),
    }).safeParse(result)
    if (failure.success) {
      throw new MessageError(
        failure.data.error.code,
        failure.data.error.submissionOutcome,
      )
    }
    if (error) throw new MessageError('UNAVAILABLE')
    const parsed = schema.safeParse(result)
    if (!parsed.success) throw new MessageError('SUBMISSION_UNKNOWN')
    return parsed.data
  } catch (error) {
    if (error instanceof MessageError) throw error
    throw new MessageError('SUBMISSION_UNKNOWN')
  }
}
export const messageApi = {
  options: async (owner: string, eventId: string) => {
    const r = await call(
      owner,
      { action: 'options', eventId },
      z.object({ options: optionsSchema }),
    )
    if (r.options.eventId !== eventId) throw new MessageError('UNAVAILABLE')
    return r.options
  },
  preview: async (
    owner: string,
    input: Omit<Intent, 'fingerprint' | 'requestId'>,
  ) =>
    (await call(
      owner,
      { action: 'preview', ...input },
      z.object({ preview: previewSchema }),
    )).preview,
  submit: async (owner: string, input: Intent) => {
    const r = (await call(
      owner,
      { action: 'submit', ...input },
      z.object({ receipt: receiptSchema }),
    )).receipt
    if (r.requestId !== input.requestId) {
      throw new MessageError('SUBMISSION_UNKNOWN')
    }
    return r
  },
  receipt: async (owner: string, eventId: string, requestId: string) => {
    const r = (await call(
      owner,
      { action: 'receipt', eventId, requestId },
      z.object({ receipt: receiptSchema.nullable() }),
    )).receipt
    if (r && r.requestId !== requestId) {
      throw new MessageError('SUBMISSION_UNKNOWN')
    }
    return r
  },
}
