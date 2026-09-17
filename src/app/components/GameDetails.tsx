import { mapsLink } from '@/lib/maps-link'
import s from './game-room.module.css'
type Details = {
  title: string; starts_at: string; ends_at: string; max_players: number
  fee: string | number; court_name: string | null; description: string; cancellation_policy: string
  venue: { name: string; address: string; city: string; latitude: number | null; longitude: number | null; google_maps_url?: string | null } | null
}
const date = (v: string) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(v))
const time = (v: string) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(new Date(v))
export default function GameDetails({ game, remaining }: { game: Details; remaining: number | null }) {
  const venue = game.venue
  const map = venue ? mapsLink(venue.google_maps_url) ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.latitude != null && venue.longitude != null ? `${venue.latitude},${venue.longitude}` : `${venue.name}, ${venue.address}, ${venue.city}`)}` : null
  return <div className={s.details}>
    <dl className={s.detailList}>
      <div><dt>Game Title:</dt><dd className={s.detailTitle}>{game.title}</dd></div>
      <div><dt>Date and Time:</dt><dd>{date(game.starts_at)}<span className={s.detailSub}>{time(game.starts_at)} – {date(game.ends_at) !== date(game.starts_at) ? `${date(game.ends_at)} · ` : ''}{time(game.ends_at)}<small>Philippine time · UTC+8</small></span></dd></div>
      <div><dt>Slot:</dt><dd><strong className={s.slotNumber}>{remaining == null ? '—' : remaining}</strong> <span className={s.muted}>of {game.max_players} available</span>{remaining == null && <small>Availability temporarily unavailable.</small>}</dd></div>
      <div className={s.locationRow}><dt>Location:</dt><dd>{venue?.name ?? 'Venue details unavailable'}{game.court_name && <span className={s.detailSub}>{game.court_name}</span>}<span className={s.detailSub}>{venue?.address}{venue?.city ? ` · ${venue.city}` : ''}</span>{map && <a className={s.mapLink} target="_blank" rel="noopener noreferrer" href={map}>Open in Google Maps <span aria-hidden="true">↗</span></a>}</dd></div>
    </dl>
    {game.description && <section className={s.detailNote}><h3>About this game</h3><p>{game.description}</p></section>}
    <section className={s.detailNote}><h3>Cancellation policy</h3><p>{game.cancellation_policy || 'Ask the host about cancellation and refund terms before paying.'}</p></section>
    <div className={s.feeRow}><div><span className={s.eyebrow}>ENTRY FEE</span><strong>{Number(game.fee) ? `₱${Number(game.fee).toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : 'Free'}</strong></div><span>{Number(game.fee) ? 'per player\nPay the host directly' : 'No payment required'}</span></div>
  </div>
}
