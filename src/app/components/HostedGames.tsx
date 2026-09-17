'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ShareOpenPlay from './ShareOpenPlay'
import GoogleSignInButton from './GoogleSignInButton'
import styles from '../host/host.module.css'

type Game = { id: string; title: string; starts_at: string; ends_at: string; max_players: number; fee: string | number; status: string; venue: { name: string; city: string } | null }
const when = (value: string) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
export default function HostedGames() {
  const [games, setGames] = useState<Game[]>([])
  const [ready, setReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const supabase = createClient()
        const { data: { user }, error } = await supabase.auth.getUser()
        if (error && error.name !== 'AuthSessionMissingError') throw error
        if (!active) return
        setSignedIn(Boolean(user))
        if (!user) { setGames([]); return }
        const result = await supabase.from('open_plays').select('id,title,starts_at,ends_at,max_players,fee,status,venue_snapshot,venue:venues!venue_id(name,city)').eq('host_id', user.id).order('created_at', { ascending: false }).limit(100)
        if (result.error) throw result.error
        if (active) { setGames((result.data ?? []).map(g => ({ ...g, venue: g.venue_snapshot ?? (Array.isArray(g.venue) ? g.venue[0] ?? null : g.venue) }))) }
      } catch { if (active) setError('We could not load your hosted games. Please try again.') }
      finally { if (active) setReady(true) }
    }
    void load()
    return () => { active = false }
  }, [refresh])
  function reload() { setReady(false); setError(''); setRefresh(n => n + 1) }
  if (!ready) return <p role="status">Loading your hosted games…</p>
  if (error) return <div><p role="alert">{error}</p><button className={styles.secondary} onClick={reload}>Try again</button></div>
  if (!signedIn) return <div><p>Sign in to create a game and see your drafts.</p><GoogleSignInButton nextPath="/?tab=hosted" /></div>
  return <>
    <div className={styles.listHeader}><p>Your drafts and published games · Philippine time</p><Link className={styles.secondary} href="/plus">Openly Plus</Link><Link className={styles.primary} href="/host">+ Host a game</Link></div>
    {!games.length ? <div className={styles.game}><h3>Your first court crew starts here.</h3><p>Create a draft or publish an Open Play for players to discover.</p></div> : <div className={styles.list}>{games.map(game => <article className={styles.game} key={game.id}>
      <span className={styles.badge}>{game.status}</span><h3>{game.title}</h3><p>{game.venue?.name ?? 'Venue unavailable'}{game.venue?.city ? ` · ${game.venue.city}` : ''}</p><p>{when(game.starts_at)} → {when(game.ends_at)}</p><p>{game.max_players} player limit · {Number(game.fee) ? `₱${Number(game.fee).toLocaleString('en-PH', { minimumFractionDigits: 2 })} per player` : 'Free entry'}</p>
      <div className={styles.gameActions}>{game.status === 'draft' && <Link className={styles.primary} prefetch={false} href={`/host?draft=${game.id}`}>Edit & publish</Link>}{game.status !== 'draft' && <a className={styles.secondary} href={`/?join=${game.id}`}>Open game & review payments</a>}{game.status !== 'draft' && <ShareOpenPlay eventId={game.id} title={game.title}/>}</div>
    </article>)}</div>}
    {games.length === 100 && <p>Showing your latest 100 games.</p>}
    <button className={styles.secondary} onClick={reload} style={{ marginTop: 20 }}>Refresh games</button>
  </>
}
