'use client'

import SecretFeatureGate from './components/SecretFeatureGate'
import ShareOpenPlay from "@/app/components/ShareOpenPlay"
import GameRoom from "@/app/components/GameRoom"
import MyGames from "@/app/components/MyGames"
import AccountAccess from '@/app/components/AccountAccess'
import HostedGames from '@/app/components/HostedGames'
import Link from 'next/link'
import GameDetails from '@/app/components/GameDetails'
import { safeNextPath } from '@/lib/auth/next-path'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SVGProps } from 'react'
import { createClient } from '@/lib/supabase/client'
import styles from './discover.module.css'

type Venue = { name: string; address: string; city: string; latitude: number | null; longitude: number | null; google_maps_url?: string | null }
type Game = {
  id: string; title: string; description: string; starts_at: string; ends_at: string; status: string
  max_players: number; fee: number | string; skill_level: string; court_name: string | null
  cancellation_policy: string; venue: Venue | null
}
type Slots = { open_play_id: string; reserved_slots: number; remaining_slots: number }
type Tab = 'discover' | 'games' | 'hosted' | 'profile'
type DateFilter = 'all' | 'today' | 'tomorrow' | 'weekend'
type IconName = 'ball' | 'search' | 'pin' | 'calendar' | 'clock' | 'users' | 'arrow' | 'close' | 'plus' | 'profile' | 'compass'
const ZONE = 'Asia/Manila'
const SKILLS: Record<string, string> = { any: 'All levels', beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }
const NAV: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'discover', label: 'Discover', icon: 'compass' }, { id: 'games', label: 'My Games', icon: 'calendar' },
  { id: 'hosted', label: 'Hosted by Me', icon: 'users' }, { id: 'profile', label: 'Profile', icon: 'profile' },
]

function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    ball: <><circle cx="12" cy="12" r="9" /><circle cx="9" cy="8" r="1" /><circle cx="16" cy="10" r="1" /><circle cx="10" cy="16" r="1" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    calendar: <><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 11h16m-11 5h1m4 0h1" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m3 10v-2a6 6 0 0 0-3-5" /></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 22v-2a8 8 0 0 1 16 0v2" /></>,
    compass: <><circle cx="12" cy="12" r="9" /><path d="m16 8-2 6-6 2 2-6Z" /></>,
  }
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>
}
function dayKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)?.value).join('-')
}
function shiftDay(key: string, days: number) { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }
function formatTime(value: string) { return new Intl.DateTimeFormat('en-PH', { timeZone: ZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(value)) }
function formatDate(value: string) { return new Intl.DateTimeFormat('en-PH', { timeZone: ZONE, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(value)) }
function money(value: number | string) { return Number(value) === 0 ? 'Free' : new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: Number(value) % 1 ? 2 : 0 }).format(Number(value)) }
function errorMessage(error: unknown) { return typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : 'Please check your connection and try again.' }

export default function HomePage() {
  return <SecretFeatureGate><DiscoverPage /></SecretFeatureGate>
}

function DiscoverPage() {
  const [tab, setTab] = useState<Tab>('discover')
  const [games, setGames] = useState<Game[]>([])
  const [slots, setSlots] = useState<Record<string, Slots>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [availabilityError, setAvailabilityError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [skill, setSkill] = useState('all')
  const [availableOnly, setAvailableOnly] = useState(false)
  const [selected, setSelected] = useState<Game | null>(null)
  const [now, setNow] = useState(() => new Date())
  const dialogRef = useRef<HTMLDialogElement>(null)
  const resumeHandled = useRef(false)
  const [returnMessage, setReturnMessage] = useState('')

  useEffect(() => {
    const timer = window.setInterval(() => { setNow(new Date()); setRefresh(x => x + 1) }, 60000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    async function load() {
      setLoading(true); setError(''); setAvailabilityError(false)
      try {
        const supabase = createClient()
        const result = await supabase.from('open_plays')
          .select('id,title,description,starts_at,ends_at,status,max_players,fee,skill_level,court_name,cancellation_policy,venue_snapshot,venue:venues!venue_id(name,address,city,latitude,longitude,google_maps_url)')
          .eq('status', 'published').gt('ends_at', new Date().toISOString())
          .order('starts_at', { ascending: true }).limit(100).abortSignal(controller.signal)
        if (result.error) throw result.error
        if (!active) return
        // A to-one relationship is an object; normalize array form defensively.
        const rows = (result.data ?? []).map(row => ({ ...row, venue: row.venue_snapshot ?? (Array.isArray(row.venue) ? row.venue[0] ?? null : row.venue) })) as Game[]
        const countResult = rows.length ? await supabase.rpc('openly_slot_counts', { p_events: rows.map(row => row.id) }).abortSignal(controller.signal) : { data: [], error: null }
        if (!active) return
        setGames(rows)
        if (countResult.error) { setSlots({}); setAvailabilityError(true) }
        else setSlots(Object.fromEntries((countResult.data as Slots[] ?? []).map(row => [row.open_play_id, row])))
      } catch (err) { if (active) { setError(errorMessage(err)); setGames([]); setSlots({}) } }
      finally { if (active) setLoading(false) }
    }
    void load()
    return () => { active = false; controller.abort() }
  }, [refresh])
  useEffect(() => {
    if (selected) dialogRef.current?.showModal()
    else dialogRef.current?.close()
  }, [selected])

  useEffect(() => {
    if (loading || error || resumeHandled.current) return
    resumeHandled.current = true
    const url = new URL(window.location.href)
    const safe = new URL(safeNextPath(url.pathname + url.search), url.origin)
    const requestedTab = safe.searchParams.get('tab') as Tab | null
    if (requestedTab) queueMicrotask(() => setTab(requestedTab))
    const id = safe.searchParams.get('join')
    if (!id) return
    // Reopen the game, but never mutate a booking just because a URL was opened.
    // A fresh Join click confirms intent after login/onboarding.
    url.searchParams.delete('join')
    window.history.replaceState(null, '', url.pathname + url.search)
    async function resumeGame() {
      try {
        let game = games.find(item => item.id === id)
        if (!game) {
          const { data, error } = await createClient().from('open_plays')
            .select('id,title,description,starts_at,ends_at,status,max_players,fee,skill_level,court_name,cancellation_policy,venue_snapshot,venue:venues!venue_id(name,address,city,latitude,longitude,google_maps_url)')
            .eq('id', id).neq('status', 'draft').maybeSingle()
          if (error) throw error
          if (data) {
            game = { ...data, venue: data.venue_snapshot ?? (Array.isArray(data.venue) ? data.venue[0] ?? null : data.venue) } as Game
            const extra = game
            setGames(current => current.some(item => item.id === extra.id) ? current : [...current, extra])
          }
        }
        if (!game) { setReturnMessage('That Open Play is no longer available. Please choose another game.'); return }
        const count = await createClient().rpc('openly_slot_counts', { p_events: [game.id] })
        const slot = count.data?.[0] as Slots | undefined
        if (!count.error && slot) setSlots(current => ({ ...current, [slot.open_play_id]: slot }))
        setTab('discover'); setSelected(game)
      } catch { setReturnMessage('Could not reopen your game. Please refresh and try again.') }
    }
    void resumeGame()
  }, [loading, error, games])

  const visibleGames = useMemo(() => {
    const today = dayKey(now)
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
    const weekendStart = weekday === 0 ? shiftDay(today, -1) : shiftDay(today, (6 - weekday + 7) % 7)
    const weekendEnd = shiftDay(weekendStart, 1)
    return games.filter(game => {
      if (game.status !== 'published' || new Date(game.ends_at) <= now) return false
      const date = dayKey(new Date(game.starts_at))
      if (dateFilter === 'today' && date !== today) return false
      if (dateFilter === 'tomorrow' && date !== shiftDay(today, 1)) return false
      if (dateFilter === 'weekend' && (date < weekendStart || date > weekendEnd)) return false
      if (skill !== 'all' && game.skill_level !== skill && game.skill_level !== 'any') return false
      if (availableOnly && (!slots[game.id] || Number(slots[game.id].remaining_slots) <= 0)) return false
      const haystack = `${game.title} ${game.venue?.name ?? ''} ${game.venue?.city ?? ''} ${game.venue?.address ?? ''}`.toLowerCase()
      return haystack.includes(search.trim().toLowerCase())
    })
  }, [games, slots, dateFilter, skill, availableOnly, search, now])
  const filtered = dateFilter !== 'all' || skill !== 'all' || availableOnly || search.trim() !== ''
  function clearFilters() { setSearch(''); setSkill('all'); setDateFilter('all'); setAvailableOnly(false) }
  function reload() { setNow(new Date()); setRefresh(x => x + 1) }
  const selectedSlots = selected ? slots[selected.id] : null

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <button className={styles.brand} onClick={() => setTab('discover')} aria-label="Openly home"><span className={styles.brandIcon} aria-hidden="true" />openly<span className={styles.brandDot}>.</span></button>
        <nav className={styles.desktopNav} aria-label="Main navigation">{NAV.map(item => <button key={item.id} aria-current={tab === item.id ? 'page' : undefined} className={tab === item.id ? styles.navActive : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
        <Link className={styles.hostButton} href="/host"><Icon name="plus" /><span>Host a game</span></Link>
      </header>

      <main className={styles.main}>
        {returnMessage && <p role="status" className={styles.notice}>{returnMessage}</p>}
        {tab === 'discover' ? <>
          <section className={styles.hero} aria-labelledby="hero-title">
            <div className={styles.heroCopy}><span className={styles.eyebrow}><span /> GOOD GAMES. NEW CONNECTIONS.</span>
              <h1 id="hero-title">Your next game.<br /><span>Your kind of people.</span></h1>
              <p>Find a pickleball Open Play, meet your next court crew,<br className={styles.desktopBreak} /> and make more time for the game.</p>
              <a className={styles.heroLink} href="#games">Explore Open Plays <Icon name="arrow" /></a>
            </div>
            <div className={styles.heroArtwork} aria-hidden="true" />
            <span className={styles.artLabel}>LESS PLANNING. MORE PLAYING.</span>
          </section>

          <section id="games" className={styles.discovery} aria-labelledby="games-title">
            <div className={styles.sectionHeading}><div><span className={styles.kicker}>FIND YOUR COURT CREW</span><h2 id="games-title">Explore Open Plays</h2></div><span className={styles.timezone}><Icon name="clock" /> Philippine time · UTC+8</span></div>
            <div className={styles.filterBox}>
              <label className={styles.search}><Icon name="search" /><input aria-label="Search by game, venue, or city" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search a game, venue, or city…" />{search && <button aria-label="Clear search" onClick={() => setSearch('')}><Icon name="close" /></button>}</label>
              <label className={styles.skill}><span>Skill level</span><select value={skill} onChange={e => setSkill(e.target.value)}><option value="all">Any skill level</option><option value="beginner">Beginner + all levels</option><option value="intermediate">Intermediate + all levels</option><option value="advanced">Advanced + all levels</option></select></label>
            </div>
            <div className={styles.filterRow}><div className={styles.dateTabs} aria-label="Filter games by date">{([['all','Live & Upcoming'],['today','Today'],['tomorrow','Tomorrow'],['weekend','This weekend']] as const).map(([id,label]) => <button key={id} aria-pressed={dateFilter === id} onClick={() => setDateFilter(id)} className={dateFilter === id ? styles.dateActive : ''}>{label}</button>)}</div><label className={styles.checkbox}><input type="checkbox" checked={availableOnly} onChange={e => setAvailableOnly(e.target.checked)} /> Available slots only</label></div>
            <div className={styles.resultsHeader}><span aria-live="polite">{loading ? 'Finding your next game…' : error ? 'Games unavailable' : `${visibleGames.length} ${visibleGames.length === 1 ? 'game' : 'games'} to explore`}</span><button onClick={reload} disabled={loading}>Refresh</button></div>
            {availabilityError && <div className={styles.notice} role="status">We couldn’t refresh slot counts. Availability is temporarily unavailable. <button onClick={reload}>Try again</button></div>}
            {error ? <div className={styles.empty} role="alert"><span className={styles.emptyIcon}><Icon name="compass" /></span><h3>We couldn’t load the games</h3><p>{error}</p><button className={styles.primaryButton} onClick={reload}>Try again</button></div>
            : loading ? <div className={styles.grid} aria-label="Loading games" aria-busy="true">{[1,2,3].map(n => <div className={styles.skeleton} key={n}><span /><span /><span /></div>)}</div>
            : visibleGames.length === 0 ? <div className={styles.empty}><span className={styles.emptyIcon}><Icon name={filtered ? 'search' : 'ball'} /></span><h3>{filtered ? 'No games match just yet' : 'The court is yours to start something'}</h3><p>{filtered ? 'Try another date, skill level, or nearby city.' : 'No Open Plays are scheduled yet. Check back soon for your next game.'}</p>{filtered ? <button className={styles.primaryButton} onClick={clearFilters}>Clear filters <Icon name="arrow" /></button> : <button className={styles.primaryButton} onClick={reload}>Check for games <Icon name="arrow" /></button>}</div>
            : <div className={styles.grid}>{visibleGames.map(game => {
              const live = new Date(game.starts_at) <= now && new Date(game.ends_at) > now; const counts = slots[game.id]; const remaining = counts ? Number(counts.remaining_slots) : null
              return <article className={styles.gameCard} key={game.id}>
                <div className={styles.cardTop}><span className={styles.skillBadge}>{SKILLS[game.skill_level] ?? game.skill_level}</span><span className={`${styles.slotBadge} ${remaining === 0 ? styles.full : ''}`}>{remaining === null ? 'Availability unavailable' : remaining === 0 ? 'Full' : `${remaining} ${remaining === 1 ? 'slot' : 'slots'} left`}</span></div>
                {live&&<span className={styles.liveBadge}>● Live</span>}<h3>{game.title}</h3><div className={styles.gameMeta}><p><Icon name="calendar" />{formatDate(game.starts_at)}</p><p><Icon name="clock" />{formatTime(game.starts_at)} – {formatTime(game.ends_at)}</p><p><Icon name="pin" /><span>{game.venue?.name ?? 'Venue details unavailable'}{game.venue?.city && <small>{game.venue.city}</small>}</span></p></div>
                <div className={styles.cardBottom}><div><strong>{money(game.fee)}</strong><small>{Number(game.fee) ? 'per player' : 'no entry fee'}</small></div><button aria-label={`View ${game.title}`} onClick={() => setSelected(game)}>View details <Icon name="arrow" /></button></div>
              </article>
            })}</div>}
            {games.length === 100 && <p className={styles.limitNote}>Showing the next 100 published games. Filters apply to these results.</p>}
          </section>
          <section className={styles.bottomBanner}><span className={styles.bannerIcon}><Icon name="users" /></span><div><h3>Good games start with good people.</h3><p>A place for players to connect, and organizers to bring everyone together.</p></div><span className={styles.bannerWord}>See you on court.</span></section>
        </> : <section className={styles.accountPanel}>
          <span className={styles.kicker}>YOUR OPENLY</span><h1>{NAV.find(item => item.id === tab)?.label}</h1>
          {tab === 'hosted' ? <HostedGames /> : tab === 'games' ? <MyGames onExplore={() => setTab('discover')} /> : <AccountAccess tab={tab} />}
        </section>}
      </main>
      <footer className={styles.footer}><span>openly.</span><p>Find your people. Play your game.</p><small>Made for the pickleball community.</small></footer>
      <nav className={styles.mobileNav} aria-label="Mobile navigation">{NAV.map(item => <button key={item.id} aria-current={tab === item.id ? 'page' : undefined} className={tab === item.id ? styles.mobileActive : ''} onClick={() => { setTab(item.id); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><Icon name={item.icon} /><span>{item.label}</span></button>)}</nav>
      <dialog ref={dialogRef} className={styles.dialog} onCancel={() => setSelected(null)} onClose={() => setSelected(null)} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) setSelected(null) } }} aria-labelledby="game-details-title">
        {selected && <><button autoFocus className={styles.dialogClose} aria-label="Close game details" onClick={() => setSelected(null)}><Icon name="close" /></button><span className={styles.skillBadge}>{SKILLS[selected.skill_level] ?? selected.skill_level}</span><h2 id="game-details-title">{selected.title}</h2><ShareOpenPlay eventId={selected.id} title={selected.title}/><GameRoom key={selected.id} eventId={selected.id} onJoined={reload}><GameDetails game={selected} remaining={selectedSlots ? Number(selectedSlots.remaining_slots) : null} /></GameRoom>
</>}
      </dialog>
    </div>
  )
}
