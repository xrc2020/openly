'use client'

import { useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { safeNextPath } from '@/lib/auth/next-path'
import styles from './onboarding.module.css'

type Values = { displayName: string; city: string; skillLevel: string; firstName: string; lastName: string; phone: string }
export default function OnboardingForm({ initial, next, email, editing }: { initial: Values; next: string; email: string; editing: boolean }) {
  const [values, setValues] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  function set(key: keyof Values, value: string) { setValues(current => ({ ...current, [key]: value })) }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      const { error } = await createClient().rpc('openly_complete_onboarding', {
        p_display_name: values.displayName.trim(), p_city: values.city.trim(), p_skill_level: values.skillLevel,
        p_first_name: values.firstName.trim() || null, p_last_name: values.lastName.trim() || null, p_phone: values.phone.trim() || null,
      })
      if (error) throw error
      window.location.assign(safeNextPath(next))
    } catch (err) {
      setError(typeof err === 'object' && err !== null && 'message' in err ? String(err.message) : 'Could not save your profile. Please try again.')
      lock.current = false; setBusy(false)
    }
  }
  return <main className={styles.page}>
    <Link href="/" className={styles.brand}><span aria-hidden="true" />openly<span className={styles.dot}>.</span></Link>
    <section className={styles.card} aria-labelledby="onboarding-title">
      <span className={styles.eyebrow}>YOUR PEOPLE. YOUR GAME.</span>
      <h1 id="onboarding-title">{editing ? 'Make yourself at home.' : 'A little about your game.'}</h1>
      <p className={styles.intro}>One profile to join Open Plays and host your own. Let your next court crew know what to call you.</p>
      <div className={styles.signedIn}>Signed in with Google <span>{email}</span></div>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>Display name <span>Public</span><input required maxLength={80} autoComplete="nickname" value={values.displayName} onChange={e => set('displayName', e.target.value)} placeholder="What should players call you?" /></label>
          <div className={styles.row}>
            <label>City<input required maxLength={120} autoComplete="address-level2" value={values.city} onChange={e => set('city', e.target.value)} placeholder="e.g. General Santos City" /></label>
            <label>Skill level<select required value={values.skillLevel} onChange={e => set('skillLevel', e.target.value)}><option value="" disabled>Select your level</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
          </div>
          <p className={styles.hint}>Your display name, city and skill level are visible to others. You can update them later.</p>
          <details className={styles.optional}>
            <summary>Optional personal details <span>Private</span></summary>
            <p>These are not shown on public profiles or rosters.</p>
            <div className={styles.row}><label>First name<input maxLength={100} autoComplete="given-name" value={values.firstName} onChange={e => set('firstName', e.target.value)} /></label><label>Last name<input maxLength={100} autoComplete="family-name" value={values.lastName} onChange={e => set('lastName', e.target.value)} /></label></div>
            <label>Phone number<input type="tel" maxLength={30} autoComplete="tel" value={values.phone} onChange={e => set('phone', e.target.value)} placeholder="Optional" /></label>
          </details>
          {error && <p role="alert" className={styles.error}>{error}</p>}
          <button className={styles.submit} type="submit">{busy ? 'Saving your profile...' : editing ? 'Save changes' : 'Save and continue'} <span aria-hidden="true">→</span></button>
        </fieldset>
      </form>
      <Link className={styles.browse} href="/">Keep browsing for now</Link>
    </section>
    <p className={styles.footer}>LESS PLANNING. MORE PLAYING.</p>
  </main>
}
