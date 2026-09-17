'use client'
import { useEffect,useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { PublicGame } from '@/lib/open-play/public-game'
import GameDetails from '@/app/components/GameDetails'
import SpectatorGame from '@/app/components/SpectatorGame'
import ShareOpenPlay from '@/app/components/ShareOpenPlay'
import s from '@/app/components/platform.module.css'
export default function PublicGameView({game}:{game:PublicGame}){
 const [joined,setJoined]=useState(false),[eventId,setEventId]=useState(''),[ready,setReady]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const [now,setNow]=useState(0),[isHost,setIsHost]=useState(false)
 const [spectatorTab,setSpectatorTab]=useState<'rotation'|'results'>('rotation')
 useEffect(()=>{let active=true;async function load(){try{const db=createClient(),auth=await db.auth.getUser();if(auth.error&&auth.error.name!=='AuthSessionMissingError')throw auth.error;if(!active)return
 if(auth.data.user){const r=await db.rpc('openly_resolve_public_game',{p_public:game.public_id});if(r.error)throw r.error;if(r.data){const owner=await db.from('open_plays').select('host_id').eq('id',r.data).single();if(owner.error)throw owner.error;if(active)setIsHost(owner.data.host_id===auth.data.user.id);const reg=await db.from('open_play_players').select('id').eq('open_play_id',r.data).eq('user_id',auth.data.user.id).maybeSingle();if(reg.error)throw reg.error;if(active){setEventId(r.data);setJoined(!!reg.data)}}}
 }catch{if(active)setError('Could not check your registration. Refresh to retry.')}finally{if(active){setNow(Date.now());setReady(true)}}}void load();const timer=window.setInterval(()=>setNow(Date.now()),30000);return()=>{active=false;window.clearInterval(timer)}},[game.public_id])
 const ended=game.status==='completed'||(now>0&&new Date(game.ends_at).getTime()<=now),cancelled=game.status==='cancelled',closed=now>0&&new Date(game.starts_at).getTime()<=now,full=game.remaining_slots<=0
 const label=cancelled?'This Open Play has been cancelled.':ended?'This Open Play has ended.':closed?'Registration Closed':full?'Open Play Full':'Join Open Play'
 async function join(){if(busy)return;setBusy(true);setError('');try{
 if(!eventId){window.location.assign(`/login?next=${encodeURIComponent(`/open-play/${game.public_id}`)}`);return}
 if(!joined&&!isHost){const r=await createClient().rpc('openly_join_event',{p_event:eventId});if(r.error){if(r.error.message.includes('ONBOARDING_REQUIRED')){window.location.assign(`/onboarding?next=${encodeURIComponent(`/open-play/${game.public_id}`)}`);return}throw r.error}}
 window.location.assign(`/?join=${eventId}`)
 }catch(e){setError(e&&typeof e==='object'&&'message'in e?String(e.message):'Please retry.')}finally{setBusy(false)}}
 return <section className={s.publicGame}><div className={s.gameHero}><span className={s.kicker}>FIND YOUR COURT CREW</span><h1>{game.title}</h1>{closed&&!ended&&!cancelled&&<span className={s.pill}>● Live</span>}<p>Hosted by <strong>{game.host_name}</strong></p><div className={s.actions}><span className={s.pill}>{game.play_style}</span><ShareOpenPlay publicId={game.public_id} title={game.title}/></div></div>
 <div className={s.publicColumns}><div className={s.card}><GameDetails game={game} remaining={game.remaining_slots}/></div><aside className={s.card}><span className={s.kicker}>SEE YOU ON COURT</span><h2>{game.reserved_slots} / {game.max_players} places reserved</h2><p>{game.remaining_slots} available · {game.play_style}</p>{(cancelled||ended||closed||full)&&<p role="status">{label}</p>}<button className={s.primary} disabled={!ready||busy||(!joined&&!isHost&&(cancelled||ended||closed||full))} onClick={join}>{busy?'Opening…':!ready?'Checking your place…':isHost?'You’re hosting · Open game':joined?'View my Open Play':label}</button><p className={s.muted}>Browse freely. Sign in with Google when you’re ready to join.</p>{error&&<p className={s.error} role="alert">{error}</p>}</aside></div>{!cancelled&&<section className={s.card}><div className={s.tabs}>{(['rotation','results'] as const).map(t=><button key={t} className={s.secondary} aria-pressed={spectatorTab===t} onClick={()=>setSpectatorTab(t)}>{t==='rotation'?'On court now':'Results'}</button>)}</div><SpectatorGame key={spectatorTab} publicId={game.public_id} mode={spectatorTab}/></section>}</section>
}
