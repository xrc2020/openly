'use client'

import Link from 'next/link'
import RotationPanel from '@/app/components/RotationPanel'
import HostingPlan from './HostingPlan'
import ShareOpenPlay from '@/app/components/ShareOpenPlay'
import { useRef, useState, type FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { DraftGame, PaymentOption, VenueOption } from './types'
import styles from './host.module.css'
import { mapsLink } from '@/lib/maps-link'
import PaymentQr from './PaymentQr'

// All entered times belong to the Philippines, regardless of the device timezone.
function localTime(iso: string | null | undefined) {
  return iso ? new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16) : ''
}
function toISO(value: string) { return new Date(`${value}:00+08:00`).toISOString() }
const providerLabels: Record<string, string> = { gcash: 'GCash', maya: 'Maya', bank_transfer: 'Bank transfer' }

export default function HostForm({ venues, methods, draft }: { venues: VenueOption[]; methods: PaymentOption[]; draft: DraftGame | null }) {
  const [values, setValues] = useState({
    title: draft?.title ?? '', description: draft?.description ?? '', venue_id: draft?.venue_id ?? '',
    venue_name: '', address: '', city: '', google_maps_url: '', court_name: draft?.court_name ?? '',
    starts_at: localTime(draft?.starts_at), ends_at: localTime(draft?.ends_at),
    max_players: String(draft?.max_players ?? 16), fee: String(draft?.fee ?? 0),
    skill_level: draft?.skill_level ?? 'any', cancellation_cutoff: localTime(draft?.cancellation_cutoff),
    cancellation_policy: draft?.cancellation_policy ?? '', payment_method_id: draft?.draft_payment_method_id ?? '', provider: 'gcash', account_name: '', account_number: '', qr_path: '',
  })
  const [paid, setPaid] = useState(Number(draft?.fee ?? 0) > 0)
  const [busy, setBusy] = useState(false)
  const [qrBusy, setQrBusy] = useState(false)
  const [hostingBlocked, setHostingBlocked] = useState(false)
  const [planVersion, setPlanVersion] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<{ id: string; published: boolean } | null>(null)
  const lock = useRef(false)
  // Keep the exact request for safe retries after a network failure.
  const pending = useRef<{ signature: string; id: string } | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const lastAction = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  function set(key: keyof typeof values, value: string) { setValues(v => ({ ...v, [key]: value })) }
  async function save(publish: boolean) {
    if (lock.current || success || qrBusy) return
    setError('')
    if (!form.current?.reportValidity()) return
    try {
      const starts = toISO(values.starts_at), ends = toISO(values.ends_at)
      if (Date.parse(starts) <= Date.now() || Date.parse(ends) <= Date.parse(starts)) throw Error('Choose a future start and an end after the start.')
      if (values.cancellation_cutoff && Date.parse(toISO(values.cancellation_cutoff)) > Date.parse(starts)) throw Error('Cancellation deadline must be at or before the start.')
      if (!values.title.trim() || (!values.venue_id && (!values.venue_name.trim() || !values.city.trim() || !values.address.trim()))) throw Error('Enter a title and complete venue details.')
      if (!values.venue_id && values.google_maps_url.trim() && !mapsLink(values.google_maps_url)) throw Error('Paste a valid HTTPS Google Maps link, not an embed code or another website.')
      if (paid && (!Number.isFinite(Number(values.fee)) || Number(values.fee) <= 0)) throw Error('Enter an entry fee greater than zero, or select Free.')
      if (publish && paid && !values.payment_method_id && (!values.account_name.trim() || !values.account_number.trim())) throw Error('Add payment details before publishing a paid game.')
      const details = { ...values, title: values.title.trim(), starts_at: starts, ends_at: ends,
        cancellation_cutoff: values.cancellation_cutoff ? toISO(values.cancellation_cutoff) : null,
        max_players: Number(values.max_players), fee: paid ? Number(values.fee) : 0,
        google_maps_url: mapsLink(values.google_maps_url),
        payment_method_id: paid ? values.payment_method_id : '',
        provider: paid ? values.provider : null,
        account_name: paid ? values.account_name.trim() : '', account_number: paid ? values.account_number.trim() : '',
        qr_path: paid && !values.payment_method_id && ['gcash', 'bank_transfer'].includes(values.provider) ? values.qr_path : '',
      }
      const signature = JSON.stringify({ details, publish, event: draft?.id ?? null })
      if (!pending.current || pending.current.signature !== signature) pending.current = { signature, id: crypto.randomUUID() }
      lastAction.current = publish
      lock.current = true; setBusy(true)
      const { data, error } = await createClient().rpc('openly_save_hosted_game', {
        p_request_id: pending.current.id, p_details: details, p_publish: publish, p_event: draft?.id ?? null,
      }).then(result => result, () => {
        setUncertain(true)
        throw Error('We could not confirm the save. Retry the same request below.')
      })
      if (error) {
        setPlanVersion(v => v + 1)
        // PostgREST database errors have a code and roll back the whole request.
        // A network/gateway failure may arrive after commit; offer the same retry.
        const unknown = !error.code || !/^[0-9A-Z]{5}$/.test(error.code)
        setUncertain(unknown)
        throw Error(unknown ? 'We could not confirm the save. Retry below to check the same request without creating a second game.' : error.message)
      }
      if (typeof data !== 'string') { setUncertain(true); throw Error('We could not confirm the save. Please retry the same request below.') }
      setUncertain(false); setSuccess({ id: data, published: publish })
    } catch (err) {
      if (lock.current && !(err instanceof Error)) setUncertain(true)
      setError(err instanceof Error ? err.message : 'Could not save. Please try again.')
    } finally { lock.current = false; setBusy(false) }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void save(false) }
  const venue = venues.find(v => v.id === values.venue_id)
  const method = methods.find(m => m.id === values.payment_method_id)

  if (success) return <section className={styles.success}>
    <span className={styles.kicker}>{success.published ? 'YOU’RE ON THE COURT' : 'A GOOD START'}</span>
    <h1>{success.published ? 'Your Open Play is live.' : 'Your draft is saved.'}</h1>
    <p>{success.published ? 'Players can now find your game on Discover, even before signing in.' : 'Only you can see this draft. Come back to finish it and publish when you’re ready.'}</p>
    <div className={styles.actions}><a className={styles.primary} href={success.published ? `/?join=${success.id}` : `/host?draft=${success.id}`}>{success.published ? 'View your Open Play' : 'Continue editing'}</a><Link className={styles.secondary} href="/?tab=hosted" prefetch={false}>Hosted by Me</Link>{success.published && <ShareOpenPlay eventId={success.id} title={values.title}/>}</div>
    <p className={styles.hint}>Hosting does not take a player slot. Join separately if you’re playing too.</p>
  </section>

  return <>
    <div className={styles.intro}><span className={styles.kicker}>BRING YOUR COURT CREW TOGETHER</span><h1>{draft ? 'Finish your Open Play.' : 'Good games start with you.'}</h1><p>Set the place, pick a time, and make room for your people.</p></div>
    <HostingPlan version={planVersion} onBlocked={setHostingBlocked}/>
    <details className={styles.playStyle}><summary>Play style · Manual / Social / Competitive</summary>{draft?<RotationPanel eventId={draft.id}/>:<p>Manual Play is free. Save this game as a draft first to configure Social or Competitive Smart Rotation. You can also configure rotation from your published game’s Rotation tab.</p>}</details>
    <form ref={form} onSubmit={submit} className={styles.layout}>
      <fieldset disabled={busy || uncertain || qrBusy} className={styles.fields}>
        <section className={styles.panel}><h2><span>01</span> The game</h2>
          <label htmlFor="title">Open Play title</label><input id="title" required maxLength={160} value={values.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Friday night court crew" />
          <label htmlFor="description">About this game <small>Optional</small></label><textarea id="description" maxLength={5000} rows={4} value={values.description} onChange={e => set('description', e.target.value)} placeholder="What should players know? Balls, format, things to bring…" />
          <div className={styles.row}><div><label htmlFor="level">Skill level</label><select id="level" value={values.skill_level} onChange={e => set('skill_level', e.target.value)}><option value="any">Any skill level</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></div><div><label htmlFor="capacity">Player limit</label><input id="capacity" type="number" min={1} max={500} step={1} required value={values.max_players} onChange={e => set('max_players', e.target.value)} /></div></div>
        </section>
        <section className={styles.panel}><h2><span>02</span> The place</h2>
          <label htmlFor="venue">Venue</label><select id="venue" value={values.venue_id} onChange={e => set('venue_id', e.target.value)}><option value="">Not listed — enter a location</option>{venues.map(v => <option key={v.id} value={v.id}>{v.name} · {v.city}{!v.is_active ? ' (inactive — choose another)' : !v.is_official ? ' (this draft’s location)' : ''}</option>)}</select>
          {venue ? <><p className={styles.note}>{venue.address}, {venue.city}</p>{mapsLink(venue.google_maps_url) && <a href={mapsLink(venue.google_maps_url)!} target="_blank" rel="noopener noreferrer">Open in Google Maps ↗</a>}<button type="button" className={styles.secondary} style={{ display: 'block', marginTop: 12 }} onClick={() => setValues(v => ({ ...v, venue_id: '', venue_name: venue.name, address: venue.address, city: venue.city, google_maps_url: venue.google_maps_url ?? '' }))}>Use a different/custom location</button></> : <>
            <label htmlFor="venue-name">Venue name</label><input id="venue-name" required maxLength={160} value={values.venue_name} onChange={e => set('venue_name', e.target.value)} placeholder="Court or sports center name" />
            <label htmlFor="address">Street address</label><input id="address" required maxLength={500} value={values.address} onChange={e => set('address', e.target.value)} placeholder="Building, street, barangay" />
            <label htmlFor="city">City</label><input id="city" required maxLength={120} value={values.city} onChange={e => set('city', e.target.value)} placeholder="e.g. General Santos City" />
            <label htmlFor="maps-link">Google Maps link <small>Optional</small></label><input id="maps-link" type="url" maxLength={2048} value={values.google_maps_url} onChange={e => set('google_maps_url', e.target.value)} placeholder="https://maps.app.goo.gl/…" />
            <p className={styles.hint}>In Google Maps, open the venue → Share → Copy link. Your location can be used for this game right away; only admins can approve it for the official dropdown.</p>
            {mapsLink(values.google_maps_url) && <a href={mapsLink(values.google_maps_url)!} target="_blank" rel="noopener noreferrer">Check location in Google Maps ↗</a>}
          </>}
          <label htmlFor="court">Court name or number <small>Optional</small></label><input id="court" maxLength={120} value={values.court_name} onChange={e => set('court_name', e.target.value)} placeholder="e.g. Courts 1 and 2" />
          <p className={styles.hint}>Arrange your court booking with the venue. Publishing here does not reserve the physical court.</p>
        </section>
        <section className={styles.panel}><h2><span>03</span> The time</h2><p className={styles.note}>All times are Philippine time · UTC+8.</p>
          <div className={styles.row}><div><label htmlFor="start">Starts</label><input id="start" type="datetime-local" required value={values.starts_at} onChange={e => set('starts_at', e.target.value)} /></div><div><label htmlFor="end">Ends</label><input id="end" type="datetime-local" required value={values.ends_at} onChange={e => set('ends_at', e.target.value)} /></div></div>
        </section>
        <section className={styles.panel}><h2><span>04</span> Entry & payment</h2>
          <div className={styles.choices}><button type="button" aria-pressed={!paid} onClick={() => setPaid(false)}>Free<span>No entry fee</span></button><button type="button" aria-pressed={paid} onClick={() => setPaid(true)}>Paid<span>Per player · PHP</span></button></div>
          {paid && <><label htmlFor="fee">Fee per player (₱)</label><input id="fee" type="number" min="0.01" max="100000" step="0.01" required value={values.fee} onChange={e => set('fee', e.target.value)} />
            <label htmlFor="method">Receive payment through</label><select id="method" value={values.payment_method_id} onChange={e => set('payment_method_id', e.target.value)}><option value="">Add payment details</option>{methods.map(m => <option key={m.id} value={m.id}>{providerLabels[m.provider]} · {m.account_name} · ending {m.account_number.slice(-4)}</option>)}</select>
            {!values.payment_method_id && <><label htmlFor="provider">Payment type</label><select id="provider" value={values.provider} onChange={e => setValues(v => ({ ...v, provider: e.target.value, qr_path: '' }))}><option value="gcash">GCash</option><option value="maya">Maya</option><option value="bank_transfer">Bank transfer</option></select>
              <label htmlFor="account-name">Account name{values.provider === 'bank_transfer' ? ' and bank name' : ''}</label><input id="account-name" maxLength={160} value={values.account_name} onChange={e => set('account_name', e.target.value)} placeholder={values.provider === 'bank_transfer' ? 'e.g. Juan Dela Cruz · BDO' : 'Name on the payment account'} />
              <label htmlFor="account-number">Account number</label><input id="account-number" maxLength={80} value={values.account_number} onChange={e => set('account_number', e.target.value)} placeholder="Check carefully before publishing" />
            </>}
            {(!values.payment_method_id && ['gcash','bank_transfer'].includes(values.provider) || Boolean(method?.qr_path)) && <PaymentQr path={values.payment_method_id ? method?.qr_path ?? null : values.qr_path || null} editable={!values.payment_method_id} disabled={busy || uncertain} onChange={path => set('qr_path', path ?? '')} onBusy={setQrBusy} />}
            {values.payment_method_id && <p className={styles.hint}>To change a saved account or QR, choose “Add payment details.” Existing games keep their original payment instructions.</p>}
            <p className={styles.hint}>Account details are required to publish a paid game. Completed account details and QR references are saved with drafts too. They stay private to you and registered players/authorized managers.</p>
          </>}
        </section>
        <section className={styles.panel}><h2><span>05</span> House rules</h2>
          <label htmlFor="cutoff">Cancellation deadline <small>Optional</small></label><input id="cutoff" type="datetime-local" value={values.cancellation_cutoff} onChange={e => set('cancellation_cutoff', e.target.value)} /><p className={styles.hint}>Leave blank to allow cancellation until the game starts.</p>
          <label htmlFor="policy">Cancellation & refund policy <small>Optional</small></label><textarea id="policy" rows={3} maxLength={2000} value={values.cancellation_policy} onChange={e => set('cancellation_policy', e.target.value)} placeholder="Explain your cancellation and refund terms before players pay." />
        </section>
      </fieldset>
      <aside className={styles.sidebar}><section className={styles.panel}><span className={styles.kicker}>YOUR OPEN PLAY</span><h2 className={styles.previewTitle}>{values.title || 'Room for your next crew.'}</h2><p>{venue?.name || values.venue_name || 'Choose your venue'}</p><p>{venue?.city || values.city || 'Your city'}</p><div className={styles.summary}><span>Player limit</span><strong>{values.max_players || '—'}</strong><span>Entry per player</span><strong>{paid ? `₱${Number(values.fee || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : 'Free'}</strong></div>
        <p className={styles.hint}>Drafts are private. Publishing makes your game visible to everyone. Published details are locked in this version, so review them first.</p>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {uncertain ? <button type="button" disabled={busy || qrBusy} className={styles.primary} onClick={() => void save(lastAction.current)}>{busy ? 'Checking…' : 'Retry the same save'}</button> : <div className={styles.saveButtons}><button type="button" className={styles.primary} disabled={busy || qrBusy || hostingBlocked} onClick={() => void save(true)}>{qrBusy ? 'Uploading QR…' : busy ? 'Saving…' : 'Publish Open Play →'}</button><button type="submit" className={styles.secondary} disabled={busy || qrBusy}>{busy || qrBusy ? 'Please wait…' : 'Save as draft'}</button></div>}
        <Link className={styles.back} href="/?tab=hosted">Back to Hosted by Me</Link>
      </section></aside>
    </form>
  </>
}
