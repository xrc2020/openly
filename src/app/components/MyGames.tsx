'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ShareOpenPlay from './ShareOpenPlay'
import GoogleSignInButton from './GoogleSignInButton'
import s from './game-room.module.css'
type Entry = { id: string; open_play_id: string; registration_status: string; payment_status: string; game: { title: string; starts_at: string; ends_at: string; status: string; venue_snapshot: { name?: string; city?: string } | null } | null }
type Filter = 'All games' | 'Confirmed' | 'Pending' | 'Past games'
const format = (v: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', ...options }).format(new Date(v))
function state(r: Entry) {
  if (r.registration_status === 'cancelled' || r.game?.status === 'cancelled') return 'Cancelled'
  if (r.registration_status === 'confirmed') return 'Confirmed'
  return r.payment_status === 'rejected' ? 'Action needed' : 'Pending'
}
export default function MyGames({ onExplore }: { onExplore: () => void }) {
  const [rows, setRows] = useState<Entry[]>([]), [ready, setReady] = useState(false), [signed, setSigned] = useState(false)
  const [error, setError] = useState(''), [version, setVersion] = useState(0), [filter, setFilter] = useState<Filter>('All games'), [now, setNow] = useState(0)
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const db = createClient(), auth = await db.auth.getUser()
        if (auth.error && auth.error.name !== 'AuthSessionMissingError') throw auth.error
        if (!active) return
        setSigned(!!auth.data.user)
        if (!auth.data.user) return
        const r = await db.from('open_play_players').select('id,open_play_id,registration_status,payment_status,game:open_plays!open_play_id(title,starts_at,ends_at,status,venue_snapshot)').eq('user_id', auth.data.user.id).order('joined_at', { ascending: false }).limit(100)
        if (r.error) throw r.error
        if (active) { setNow(Date.now()); setRows((r.data ?? []).map(p => ({ ...p, game: Array.isArray(p.game) ? p.game[0] : p.game }))) }
      } catch { if (active) setError('Could not load your games. Please retry.') }
      finally { if (active) setReady(true) }
    }
    void load(); return () => { active = false }
  }, [version])
  const isPast = (r: Entry) => !!r.game && (r.game.status === 'completed' || new Date(r.game.ends_at).getTime() < now)
  const visible = rows.filter(r => filter === 'All games' || (filter === 'Past games' ? isPast(r) : filter === 'Confirmed' ? state(r) === 'Confirmed' && !isPast(r) : ['Pending', 'Action needed'].includes(state(r)) && !isPast(r)))
  return <div className={s.room}>
    <div className={s.gamesIntro}><div><p className={s.muted}>Your court crew. Your next game.</p><p>Keep track of your places, payments and conversations.</p></div><button className={s.secondary} disabled={!ready} onClick={() => { setReady(false); setError(''); setVersion(n => n + 1) }}>↻ Refresh games</button></div>
    {error && <p role="alert" className={s.error}>{error}</p>}
    {!ready ? <div className={s.emptyState} role="status">Finding your games…</div> : !signed ? <div className={s.emptyState}><span className={s.emptySymbol}>↗</span><h3>Your next game starts here.</h3><p>Sign in to see the games you’ve joined.</p><GoogleSignInButton nextPath="/?tab=games" /></div> : <>
      <div className={s.gameFilters} aria-label="Filter your games">{(['All games', 'Confirmed', 'Pending', 'Past games'] as Filter[]).map(f => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>)}</div>
      {!visible.length && !error && <div className={s.emptyState}><span className={s.emptySymbol}>↗</span><h3>{rows.length ? 'No games in this view.' : 'Your court crew is waiting.'}</h3><p>{rows.length ? 'Try another filter to find your games.' : 'Find an Open Play and make your first connection.'}</p><button className={s.primary} onClick={onExplore}>Explore Open Plays →</button></div>}
      <div className={s.gamesGrid}>{visible.map(r => {
        const label = state(r), confirmed = label === 'Confirmed', past = isPast(r)
        return <article key={r.id} className={`${s.myGame} ${confirmed ? s.myGameConfirmed : ''}`}>
          <div className={s.gameTop}><span className={`${s.badge} ${confirmed ? s.badgeConfirmed : label === 'Cancelled' ? s.badgeMuted : s.badgePending}`}>{confirmed ? '✓ ' : ''}{label}</span><span className={s.muted}>{past ? 'Past game' : 'Open Play'}</span></div>
          <div className={s.gameIdentity}><div className={s.dateTile}>{r.game ? <><span>{format(r.game.starts_at, { month: 'short' })}</span><strong>{format(r.game.starts_at, { day: 'numeric' })}</strong><small>{format(r.game.starts_at, { weekday: 'short' })}</small></> : '—'}</div><div><h3>{r.game?.title ?? 'Open Play'}</h3><p>{r.game ? format(r.game.starts_at, { hour: 'numeric', minute: '2-digit' }) : 'Time unavailable'} <span className={s.muted}>· PH time</span></p><p className={s.muted}>{r.game?.venue_snapshot?.name ?? 'View game for location'}{r.game?.venue_snapshot?.city ? ` · ${r.game.venue_snapshot.city}` : ''}</p></div></div>
          <p className={s.gameNote}>{label === 'Cancelled' ? 'This game or registration has been cancelled.' : confirmed ? past ? 'Good games. Great connections.' : 'You’re in. Your place is confirmed.' : r.payment_status === 'pending_review' ? 'Awaiting for admin/host approval' : r.payment_status === 'rejected' ? 'Check the host’s feedback and update your receipt.' : 'Complete your payment to confirm your place.'}</p>
          <div className={s.gameActions}><a className={s.secondary} href={`/?join=${r.open_play_id}`}>Open Game <span aria-hidden="true">↗</span></a>{r.game&&<ShareOpenPlay eventId={r.open_play_id} title={r.game.title}/>}</div>
        </article>
      })}</div>
      {rows.length === 100 && <p className={s.muted}>Showing your latest 100 registrations.</p>}
    </>}
  </div>
}
