'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import styles from './host.module.css'

export default function PaymentQr({ path, editable, disabled, onChange, onBusy }: {
  path: string | null; editable: boolean; disabled: boolean;
  onChange: (path: string | null) => void; onBusy: (busy: boolean) => void;
}) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let active = true
    async function preview() {
      setUrl(''); setError('')
      if (!path) return
      try {
        const { data, error } = await createClient().storage.from('payment-qrs').createSignedUrl(path, 300)
        if (error || !data) throw error
        if (active) setUrl(data.signedUrl)
      } catch { if (active) setError('Could not load the QR preview. Retry below; the saved QR has not been removed.') }
    }
    void preview()
    return () => { active = false }
  }, [path, refresh])
  async function upload(file: File | undefined) {
    if (!file || busy || disabled) return
    setError('')
    const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
    if (!extensions[file.type] || file.size === 0 || file.size > 5 * 1024 * 1024) {
      setError('Choose a PNG, JPG or WebP image up to 5 MB.'); if (input.current) input.current.value = ''; return
    }
    setBusy(true); onBusy(true)
    try {
      const bitmap = await createImageBitmap(file)
      const valid = bitmap.width > 0 && bitmap.height > 0 && bitmap.width <= 10000 && bitmap.height <= 10000
      bitmap.close()
      if (!valid) throw Error('Choose a readable QR image no larger than 10,000 pixels on either side.')
      const supabase = createClient()
      const auth = await supabase.auth.getUser()
      if (auth.error || !auth.data.user) throw Error('Sign in again before uploading your QR.')
      const objectPath = `${auth.data.user.id}/${crypto.randomUUID()}.${extensions[file.type]}`
      const { error } = await supabase.storage.from('payment-qrs').upload(objectPath, file, { upsert: false, contentType: file.type })
      if (error) throw Error(error.message)
      onChange(objectPath)
    } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed. Try a different image.') }
    finally { setBusy(false); onBusy(false); if (input.current) input.current.value = '' }
  }
  return <div className={styles.qrBox}>
    <p className={styles.note}>Payment QR code <small>Optional</small></p>
    {url && <>
      {/* Preserve the original QR pixels and keep private URLs out of an optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Payment QR code preview — verify the account before publishing" className={styles.qrImage} onError={() => { setUrl(''); setError('QR preview expired or unavailable. Refresh the preview below.') }} />
    </>}
    {path && <button className={styles.secondary} type="button" disabled={disabled || busy} onClick={() => setRefresh(n => n + 1)}>Refresh QR preview</button>}
    {editable && <><label htmlFor="payment-qr">{path ? 'Replace QR image' : 'Upload QR image'}</label><input ref={input} id="payment-qr" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || busy} onChange={e => void upload(e.target.files?.[0])} />
      {path && <button type="button" className={styles.secondary} disabled={disabled || busy} onClick={() => onChange(null)} style={{ marginTop: 12 }}>Remove from this form</button>}
    </>}
    {busy && <p role="status">Uploading your QR…</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <p className={styles.hint}>PNG, JPG or WebP · up to 5 MB. Check the QR matches your payment account. Removing or replacing it does not alter past games.</p>
  </div>
}
