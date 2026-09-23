import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { supabase } from '../../lib/supabase/client'
import {
  editorSchema,
  safeExternalUrl,
  type StorefrontEditor,
} from './storefront.editor'
import { uploadOrganizerMedia } from './storefront.identity.api'
import { StorefrontMedia } from './StorefrontMedia'
type Item = {
  id: string
  imageId: string
  title: string
  price: string | null
  url: string
}
export function StorefrontMerchEditor({
  saved,
  userId,
  onSaved,
  onStateChange,
  disabled,
}: {
  saved: StorefrontEditor
  userId: string
  disabled: boolean
  onStateChange: (dirty: boolean, busy: boolean) => void
  onSaved: (value: StorefrontEditor) => void
}) {
  const [items, setItems] = useState<Item[]>(saved.merch)
  const [url, setUrl] = useState(saved.storeUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const client = useQueryClient()
  const live = useRef(true)
  const latch = useRef(false)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const dirty = JSON.stringify(items) !== JSON.stringify(saved.merch) ||
    url !== (saved.storeUrl ?? '')
  useEffect(() => onStateChange(dirty, busy), [dirty, busy, onStateChange])
  function change(id: string, key: 'title' | 'price' | 'url', value: string) {
    setItems((prior) =>
      prior.map((item) =>
        item.id === id
          ? { ...item, [key]: key === 'price' ? (value || null) : value }
          : item
      )
    )
  }
  async function add(file: File | undefined) {
    if (!file || latch.current || items.length >= 3) return
    const current = captureIdentityLifetime(client, userId)
    latch.current = true
    setBusy(true)
    setError('')
    try {
      const imageId = await uploadOrganizerMedia(
        file,
        userId,
        () => live.current && current(),
      )
      if (live.current && current()) {
        setItems(
          (prior) => [...prior, {
            id: crypto.randomUUID(),
            imageId,
            title: '',
            price: null,
            url: '',
          }],
        )
      }
    } catch (e) {
      if (live.current && current()) {
        setError(e instanceof Error ? e.message : 'Upload failed.')
      }
    } finally {
      latch.current = false
      if (live.current && current()) setBusy(false)
    }
  }
  async function save() {
    if (latch.current) return
    const current = captureIdentityLifetime(client, userId)
    latch.current = true
    setBusy(true)
    setError('')
    try {
      if (
        items.some((item) =>
          !item.title.trim() || item.title.length > 120 ||
          !safeExternalUrl(item.url)
        ) || (url && !safeExternalUrl(url))
      ) throw new Error('Add a title and valid HTTP/HTTPS link for each item.')
      const { data: auth } = await supabase.auth.getSession()
      if (!current() || auth.session?.user.id !== userId) {
        throw new Error('Your session changed.')
      }
      const { data, error: failure } = await supabase.rpc(
        'save_owned_storefront_merch',
        {
          p_items: items,
          p_store_url: url || undefined,
          p_expected_updated_at: saved.updatedAt,
        },
      ).setHeader('Authorization', `Bearer ${auth.session.access_token}`)
      if (!live.current || !current()) return
      if (failure) {
        throw new Error(
          failure.message === 'STOREFRONT_CONFLICT'
            ? 'Settings changed. Save or reload your storefront before retrying merch.'
            : 'Merch could not be saved. Your changes are still here.',
        )
      }
      onSaved(editorSchema.parse(data))
      void client.invalidateQueries({ queryKey: ['public-storefront'] })
    } catch (e) {
      if (live.current && current()) {
        setError(e instanceof Error ? e.message : 'Save failed.')
      }
    } finally {
      latch.current = false
      if (live.current && current()) setBusy(false)
    }
  }
  return (
    <section className='settings-panel'>
      <h3>Merch</h3>
      <p>Up to three items. Purchases happen on your external store.</p>
      {items.map((item, index) => (
        <fieldset
          className='settings-form'
          key={item.id}
          disabled={disabled || busy}
        >
          <legend>Item {index + 1}</legend>
          <StorefrontMedia
            id={item.imageId}
            ownerId={userId}
            alt='Merch preview'
            className='storefront-editor-image'
          />
          <label className='settings-field'>
            Title<input
              value={item.title}
              maxLength={120}
              onChange={(event) => change(item.id, 'title', event.target.value)}
            />
          </label>
          <label className='settings-field'>
            Display price (optional)<input
              value={item.price ?? ''}
              maxLength={60}
              onChange={(event) => change(item.id, 'price', event.target.value)}
            />
          </label>
          <label className='settings-field'>
            External item URL<input
              type='url'
              value={item.url}
              onChange={(event) => change(item.id, 'url', event.target.value)}
            />
          </label>
          <div className='settings-actions'>
            <button
              type='button'
              className='ops-button'
              disabled={index === 0}
              onClick={() =>
                setItems((previous) => {
                  const next = [...previous]
                  ;[next[index - 1], next[index]] = [
                    next[index],
                    next[index - 1],
                  ]
                  return next
                })}
            >
              Move up
            </button>
            <button
              type='button'
              className='ops-button'
              onClick={() =>
                setItems((previous) =>
                  previous.filter((row) => row.id !== item.id)
                )}
            >
              Remove item
            </button>
          </div>
        </fieldset>
      ))}
      <label className='settings-field'>
        Add merch image<input
          type='file'
          accept='image/jpeg,image/png,image/webp'
          disabled={disabled || busy || items.length >= 3}
          onChange={(event) => void add(event.target.files?.[0])}
        />
      </label>
      <label className='settings-field'>
        Visit Store URL (optional)<input
          value={url}
          type='url'
          disabled={disabled || busy}
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      {error ? <p role='alert'>{error}</p> : null}
      <button
        className='ops-button'
        disabled={disabled || busy || !dirty}
        onClick={() => void save()}
      >
        {busy ? 'Saving…' : 'Save merch'}
      </button>
    </section>
  )
}
