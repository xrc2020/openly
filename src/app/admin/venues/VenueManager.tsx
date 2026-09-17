'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { mapsLink } from '@/lib/maps-link'
import type { VenueOption } from '@/app/host/types'
import styles from '@/app/host/host.module.css'

const empty = { id: '', name: '', address: '', city: '', google_maps_url: '', is_official: true, is_active: true }
export default function VenueManager() {
  const [values, setValues] = useState(empty)
  const [venues, setVenues] = useState<VenueOption[]>([])
  const [filter, setFilter] = useState('official')
  const [page, setPage] = useState(0)
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const lock = useRef(false)
  const newId = useRef('')
  const editor = useRef<HTMLElement>(null)
  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true); setLoadError('')
      try {
        const supabase = createClient()
        const check = await supabase.rpc('openly_is_admin')
        if (check.error || check.data !== true) throw Error('Admin access could not be verified.')
        let query = supabase.from('venues').select('id,name,address,city,google_maps_url,is_official,is_active').order('name').order('id')
        query = filter === 'inactive' ? query.eq('is_active', false) : query.eq('is_active', true).eq('is_official', filter === 'official')
        const { data, error } = await query.range(page * 30, page * 30 + 30)
        if (error) throw error
        if (active) { setVenues((data ?? []).slice(0, 30)); setMore((data ?? []).length > 30) }
      } catch { if (active) setLoadError('Could not load venues. Check your admin access and try again.') }
      finally { if (active) setLoading(false) }
    }
    void load()
    return () => { active = false }
  }, [filter, page, refresh])
  function edit(venue: VenueOption) {
    if (busy) return
    setValues({ ...venue, google_maps_url: venue.google_maps_url ?? '' }); setMessage(''); setError('')
    editor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (lock.current) return
    setMessage(''); setError('')
    if (![values.name, values.address, values.city].every(v => v.trim())) { setError('Enter the venue name, address and city.'); return }
    if (values.google_maps_url.trim() && !mapsLink(values.google_maps_url)) { setError('Paste an HTTPS Google Maps share link. Other websites and embed codes are not accepted.'); return }
    lock.current = true; setBusy(true)
    if (!newId.current) newId.current = crypto.randomUUID()
    const id = values.id || newId.current
    try {
      const { error } = await createClient().rpc('openly_admin_save_venue', {
        p_id: id, p_name: values.name.trim(), p_address: values.address.trim(), p_city: values.city.trim(),
        p_google_maps_url: mapsLink(values.google_maps_url), p_is_official: values.is_official, p_is_active: values.is_active,
      })
      if (error) throw Error(error.message)
      setValues(v => ({ ...v, id })); setRefresh(n => n + 1)
      setMessage(values.is_official && values.is_active ? 'Venue saved. Hosts can now select it from the official dropdown.' : 'Venue saved. It is not shown in the official dropdown.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Save could not be confirmed. Retry this form; the venue ID is preserved to avoid duplicates.') }
    finally { lock.current = false; setBusy(false) }
  }
  return <>
    <div className={styles.intro}><span className={styles.kicker}>OPENLY ADMIN</span><h1>Good places. Great games.</h1><p>Manage official venues and review locations submitted by hosts.</p></div>
    <div className={styles.adminLayout}>
      <section ref={editor} className={styles.panel}>
        <h2>{values.id ? 'Review / edit venue' : 'Add an official venue'}</h2>
        <form onSubmit={save}><fieldset disabled={busy} className={styles.fields} style={{ display: 'block' }}>
          <label htmlFor="admin-name">Venue / court name</label><input id="admin-name" required maxLength={160} value={values.name} onChange={e => setValues(v => ({ ...v, name: e.target.value }))} />
          <label htmlFor="admin-address">Street address</label><input id="admin-address" required maxLength={500} value={values.address} onChange={e => setValues(v => ({ ...v, address: e.target.value }))} />
          <label htmlFor="admin-city">City</label><input id="admin-city" required maxLength={120} value={values.city} onChange={e => setValues(v => ({ ...v, city: e.target.value }))} />
          <label htmlFor="admin-map">Google Maps link <small>Optional</small></label><input id="admin-map" type="url" maxLength={2048} placeholder="https://maps.app.goo.gl/…" value={values.google_maps_url} onChange={e => setValues(v => ({ ...v, google_maps_url: e.target.value }))} />
          {mapsLink(values.google_maps_url) && <a className={styles.back} href={mapsLink(values.google_maps_url)!} target="_blank" rel="noopener noreferrer">Check in Google Maps ↗</a>}
          <label className={styles.checkRow}><input type="checkbox" checked={values.is_official} onChange={e => setValues(v => ({ ...v, is_official: e.target.checked }))} />Approved for the official dropdown</label>
          <label className={styles.checkRow}><input type="checkbox" checked={values.is_active} onChange={e => setValues(v => ({ ...v, is_active: e.target.checked }))} />Active — allow new games here</label>
          <p className={styles.hint}>To approve a host submission, check both boxes and save. To reject or deactivate it, uncheck Active. Existing published games keep their original location details.</p>
          <div className={styles.actions}><button type="submit" className={styles.primary}>{busy ? 'Saving…' : 'Save venue'}</button><button type="button" className={styles.secondary} onClick={() => { setValues(empty); newId.current = ''; setMessage(''); setError('') }}>New venue</button></div>
        </fieldset></form>
        {message && <p className={styles.note} role="status">{message}</p>}{error && <p className={styles.error} role="alert">{error}</p>}
      </section>
      <section className={styles.panel}>
        <h2>Venue directory</h2><div className={styles.directoryTabs}>{[['official','Official'],['pending','Host submissions'],['inactive','Inactive']].map(([id,label]) => <button key={id} type="button" aria-pressed={filter === id} className={filter === id ? styles.primary : styles.secondary} onClick={() => { setFilter(id); setPage(0) }}>{label}</button>)}</div>
        <p className={styles.hint}>Host submissions are not automatically official. Review the name, address and map link before approving.</p>
        {loading ? <p role="status">Loading venues…</p> : loadError ? <p role="alert" className={styles.error}>{loadError}</p> : !venues.length ? <p className={styles.note}>No venues in this view.</p> : <div className={styles.list} style={{ marginTop: 20 }}>{venues.map(venue => <article key={venue.id} className={styles.venueCard}><span className={styles.badge}>{!venue.is_active ? 'Inactive' : venue.is_official ? 'Official' : 'Host submitted'}</span><h3>{venue.name}</h3><p>{venue.address}</p><p>{venue.city}</p><button type="button" disabled={busy} className={styles.secondary} onClick={() => edit(venue)}>Review / edit</button></article>)}</div>}
        <div className={styles.actions}><button type="button" className={styles.secondary} disabled={loading || page === 0} onClick={() => setPage(n => n - 1)}>Previous</button><button type="button" className={styles.secondary} disabled={loading || !more} onClick={() => setPage(n => n + 1)}>Next</button><button type="button" className={styles.secondary} disabled={loading} onClick={() => setRefresh(n => n + 1)}>Refresh</button></div>
      </section>
    </div>
  </>
}
