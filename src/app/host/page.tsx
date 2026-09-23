import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { safeNextPath } from '@/lib/auth/next-path'
import HostForm from './HostForm'
import type { DraftGame } from './types'
import styles from './host.module.css'

export default async function HostPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const { draft } = await searchParams
  const next = safeNextPath(`/host${draft ? `?draft=${encodeURIComponent(draft)}` : ''}`)
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`)
  const profile = await supabase.from('profiles').select('onboarding_completed_at').eq('id', user.id).single()
  if (!profile.error && !profile.data.onboarding_completed_at) redirect(`/onboarding?next=${encodeURIComponent(next)}`)
  const [venues, methods, game] = await Promise.all([
    supabase.from('venues').select('id,name,address,city,google_maps_url,is_official,is_active').eq('is_official', true).eq('is_active', true).order('name').limit(500),
    supabase.from('payment_methods').select('id,provider,account_name,account_number,qr_path').eq('owner_id', user.id).eq('is_active', true).order('created_at', { ascending: false }),
    draft ? supabase.from('open_plays').select('id,court_count,title,description,venue_id,court_name,starts_at,ends_at,max_players,fee,skill_level,cancellation_cutoff,cancellation_policy,draft_payment_method_id').eq('id', draft).eq('host_id', user.id).eq('status', 'draft').maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  let message = profile.error || venues.error || methods.error || game.error ? 'We could not load the hosting form. Please refresh and try again.' : ''
  if (draft && !game.data && !message) message = 'This draft is not available. It may already be published, or belong to another host.'
  // Always retain the current venue even if it falls outside the selection limit.
  if (game.data && venues.data && !venues.data.some(v => v.id === game.data?.venue_id)) {
    const venue = await supabase.from('venues').select('id,name,address,city,google_maps_url,is_official,is_active').eq('id', game.data.venue_id).single()
    if (venue.error) message = 'We could not load this draft’s venue. Please try again.'
    else venues.data.push(venue.data)
  }
  return <main className={styles.page}>
    <header className={styles.header}><Link href="/" className={styles.brand}><span aria-hidden="true" />openly<b>.</b></Link><Link href="/?tab=hosted">← Hosted by Me</Link></header>
    {message ? <section className={styles.panel}><h1>Let’s try that again</h1><p role="alert">{message}</p><Link href="/host">Start a new game</Link></section>
      : <HostForm venues={venues.data ?? []} methods={methods.data ?? []} draft={game.data as DraftGame | null} />}
    <footer className={styles.footer}>LESS PLANNING. MORE PLAYING.</footer>
  </main>
}
