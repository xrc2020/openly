'use client'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import RotationPanel from './RotationPanel'
import SpectatorGame from './SpectatorGame'
import { createClient } from '@/lib/supabase/client'
import s from './game-room.module.css'

type Player = { id:string; user_id:string; registration_status:string; payment_status:string; amount_due:number; profile: { display_name:string } | null }
type Proof = { id:string; registration_id:string; object_path:string; status:string; rejection_reason:string|null }
type Method = { id:string; provider:string; account_name:string; account_number:string; qr_path:string|null }
const message = (e:unknown) => e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Please check your connection and try again.'

function PrivateImage({ bucket, path, label }: { bucket:string; path:string; label:string }) {
  const [url,setUrl]=useState(''),[error,setError]=useState(''),[version,setVersion]=useState(0)
  useEffect(()=>{ let active=true
    void createClient().storage.from(bucket).createSignedUrl(path,300).then(({data,error})=>{if(active){setUrl(data?.signedUrl??'');setError(error?'Image unavailable. Try refreshing.':'')}})
    return ()=>{active=false}
  },[bucket,path,version])
  return <div>{url && <>
    {/* Private signed images must bypass the shared image optimizer. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className={s.image} src={url} alt={label} onError={()=>setError('Image expired or unavailable. Refresh below.')} />
  </>}{error && <p role="alert">{error}</p>}<button className={s.secondary} onClick={()=>setVersion(n=>n+1)}>Refresh image</button></div>
}

export default function GameRoom({eventId,children,onJoined}:{eventId:string;children:ReactNode;onJoined:()=>void}) {
  const [isHost,setIsHost]=useState(false),[ended,setEnded]=useState(false)
  const [tab,setTab]=useState('Game Details'),[uid,setUid]=useState(''),[manager,setManager]=useState(false)
  const [players,setPlayers]=useState<Player[]>([]),[proofs,setProofs]=useState<Proof[]>([]),[methods,setMethods]=useState<Method[]>([])
  const [status,setStatus]=useState(''),[started,setStarted]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [notice,setNotice]=useState(''),[file,setFile]=useState<File|null>(null),[uploaded,setUploaded]=useState(''),[reasons,setReasons]=useState<Record<string,string>>({})
  const [roster,setRoster]=useState<{display_name:string;registration_status:string}[]>([])
  const [chat,setChat]=useState<{id:string;body:string;user_id:string;created_at:string;profile:{display_name:string}|null}[]>([])
  const [body,setBody]=useState(''),[summary,setSummary]=useState(''),[draft,setDraft]=useState(''),[roomAccess,setRoomAccess]=useState(false)
  const lock=useRef(false),chatId=useRef<string|null>(null)
  const chatScroll=useRef<HTMLDivElement>(null),lastMessage=useRef('')
  const [rosterReady,setRosterReady]=useState(false)
  const [host,setHost]=useState({eventId:'',name:''})
  const hostName=host.eventId===eventId?host.name:''
  useEffect(()=>{let live=true;void (async()=>{
    const db=createClient()
    const game=await db.from('open_plays').select('host_id').eq('id',eventId).single()
    if(game.error)throw game.error
    const host=await db.from('profiles').select('display_name').eq('id',game.data.host_id).maybeSingle()
    if(host.error)throw host.error
    if(live)setHost({eventId,name:host.data?.display_name?.trim()||'Open Play host'})
  })().catch(()=>{if(live)setHost({eventId,name:'Host details unavailable'})});return()=>{live=false}},[eventId])
  const own=players.find(p=>p.user_id===uid)
  const load=useCallback(async()=>{
    const db=createClient();const auth=await db.auth.getUser()
    if(auth.error && auth.error.name!=='AuthSessionMissingError')throw auth.error
    const user=auth.data.user;setUid(user?.id??'')
    const game=await db.from('open_plays').select('host_id,status,starts_at,ends_at').eq('id',eventId).single()
    if(game.error)throw game.error
    setIsHost(!!user&&game.data.host_id===user.id);setEnded(new Date(game.data.ends_at).getTime()<=Date.now());setStatus(game.data.status);setStarted(new Date(game.data.starts_at).getTime()<=Date.now())
    if(!user){setManager(false);setPlayers([]);setProofs([]);setMethods([]);setRoomAccess(false);setChat([]);setSummary('');setReady(true);return}
    const admin=await db.rpc('openly_is_admin');if(admin.error)throw admin.error
    const manages=game.data.host_id===user.id||admin.data===true;setManager(manages)
    const result=await db.from('open_play_players').select('id,user_id,registration_status,payment_status,amount_due,profile:profiles!user_id(display_name)').eq('open_play_id',eventId).order('joined_at').limit(500)
    if(result.error)throw result.error
    const rows=(result.data??[]).map(p=>({...p,profile:Array.isArray(p.profile)?p.profile[0]:p.profile})) as Player[];setPlayers(rows)
    const self=rows.find(p=>p.user_id===user.id)
    const ids=manages?rows.map(p=>p.id):self?[self.id]:[]
    let proofQuery=db.from('payment_proofs').select('id,registration_id,object_path,status,rejection_reason').in('registration_id',ids).order('submitted_at',{ascending:false}).limit(1000)
    if(manages)proofQuery=proofQuery.eq('status','pending_review')
    const [payments,proofResult]=await Promise.all([
      db.from('open_play_payment_methods').select('id,provider,account_name,account_number,qr_path').eq('open_play_id',eventId),
      ids.length?proofQuery:Promise.resolve({data:[],error:null}),
    ])
    if(payments.error)throw payments.error;if(proofResult.error)throw proofResult.error
    setMethods(payments.data??[]);setProofs(proofResult.data??[]);setReady(true)
  },[eventId])
  useEffect(()=>{let active=true;queueMicrotask(()=>{if(active)void load().catch(e=>{if(active){setError(message(e));setReady(true)}})});return()=>{active=false}},[load])
  const loadRoster=useCallback(async()=>{
    const result=await createClient().rpc('openly_roster',{p_event:eventId})
    if(result.error)throw result.error
    setRoster(result.data??[]);setRosterReady(true)
  },[eventId])
  useEffect(()=>{
    if(tab!=='Participants')return
    let active=true
    const refresh=()=>{if(active&&document.visibilityState==='visible')void loadRoster().catch(e=>{if(active)setError(message(e))})}
    queueMicrotask(refresh)
    const timer=window.setInterval(refresh,10000)
    return()=>{active=false;window.clearInterval(timer)}
  },[tab,loadRoster])
  useEffect(()=>{
    if(tab!=='Chat')return
    const latest=chat.at(-1)?.id??''
    const box=chatScroll.current
    if(box&&latest!==lastMessage.current){
      const nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<150
      if(!lastMessage.current||nearBottom||chat.at(-1)?.user_id===uid)box.scrollTop=box.scrollHeight
      lastMessage.current=latest
    }
  },[tab,chat,uid])
  const loadRoom=useCallback(async()=>{
    const db=createClient();const access=await db.rpc('openly_room_access',{p_event:eventId});if(access.error)throw access.error
    setRoomAccess(access.data===true);if(!access.data){setChat([]);setSummary('');return}
    const [c,v]=await Promise.all([db.from('open_play_messages').select('id,body,user_id,created_at,profile:profiles!user_id(display_name)').eq('open_play_id',eventId).order('created_at',{ascending:false}).limit(100),db.from('open_play_results').select('summary').eq('open_play_id',eventId).maybeSingle()])
    if(c.error)throw c.error;if(v.error)throw v.error
    setChat((c.data??[]).map(m=>({...m,profile:Array.isArray(m.profile)?m.profile[0]:m.profile})).reverse());setSummary(v.data?.summary??'')
  },[eventId])
  useEffect(()=>{if(!uid||tab==='Game Details'||tab==='Participants'||tab==='Rotation')return
    let active=true;queueMicrotask(()=>{if(active)void loadRoom().catch(e=>{if(active)setError(message(e))})})
    const timer=tab==='Chat'?window.setInterval(()=>{if(document.visibilityState==='visible')void loadRoom().catch(e=>setError(message(e)))},10000):undefined
    return ()=>{active=false;if(timer)window.clearInterval(timer)}
  },[uid,tab,loadRoom])
  async function action(fn:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('')
    try{await fn();await load();if(tab==='Participants')await loadRoster()}catch(e){setError(message(e))}finally{lock.current=false;setBusy(false)}
  }
  async function join(){await action(async()=>{
    const next=`/?join=${eventId}`
    if(!uid){window.location.assign(`/login?next=${encodeURIComponent(next)}`);return}
    const result=await createClient().rpc('openly_join_event',{p_event:eventId})
    if(result.error){if(result.error.message.includes('ONBOARDING_REQUIRED')){window.location.assign(`/onboarding?next=${encodeURIComponent(next)}`);return}throw result.error}
    onJoined();setNotice('Registration saved. Check your status below.')
  })}
  async function hostPlayer(joining:boolean){
    if(!window.confirm(joining?'Join as a player? This uses 1 player slot. No payment is required for the host.':'Leave your player slot? You will remain the host.'))return
    await action(async()=>{const r=await createClient().rpc('openly_host_player',{p_event:eventId,p_join:joining});if(r.error)throw r.error;onJoined();setNotice(joining?'You’re hosting & playing. Your place is confirmed.':'Player slot released. You’re still hosting this game.')})
  }
  async function submit(){await action(async()=>{
    if(!own||(!file&&!uploaded))throw Error('Choose a payment receipt first.')
    const db=createClient();let path=uploaded
    if(!path&&file){const ex:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}
      if(!ex[file.type]||file.size===0||file.size>10*1024*1024)throw Error('Choose a PNG, JPG or WebP receipt up to 10 MB.')
      const bitmap=await createImageBitmap(file);const valid=bitmap.width<=10000&&bitmap.height<=10000;bitmap.close();if(!valid)throw Error('Image dimensions are too large.')
      path=`${uid}/${own.id}/${crypto.randomUUID()}.${ex[file.type]}`
      const upload=await db.storage.from('payment-proofs').upload(path,file,{upsert:false,contentType:file.type});if(upload.error)throw upload.error;setUploaded(path)
    }
    // Recover a successful submission whose response was lost before retrying.
    const existing=await db.from('payment_proofs').select('id').eq('object_path',path).maybeSingle();if(existing.error)throw existing.error
    if(!existing.data){const result=await db.rpc('openly_submit_proof',{p_registration:own.id,p_object_path:path});if(result.error)throw result.error}
    setFile(null);setUploaded('');setNotice('Awaiting for admin/host approval')
  })}
  const confirmed=own?.registration_status==='confirmed'&&status!=='cancelled'
  const ownProof=own?proofs.find(p=>p.registration_id===own.id):undefined
  return <div className={s.room}>
    <div className={s.tabs} aria-label="Game sections">{['Game Details','Participants','Rotation','Chat','Results'].map(t=><button key={t} aria-pressed={tab===t} onClick={()=>{setTab(t);setError('');setNotice('')}}>{t}</button>)}</div>
    {error&&<p role="alert" className={s.error}>{error}</p>}{notice&&<p role="status" className={s.status}>{notice}</p>}
    {tab==='Game Details'&&<><p className={s.muted}>Hosted by <strong>{hostName||'Loading host…'}</strong></p>{!confirmed&&children}
      {!ready?<p>Loading registration…</p>:<section className={`${s.placeCard} ${confirmed?s.placeConfirmed:''}`}><span className={s.eyebrow}>YOUR PLACE</span>
      {isHost?<><h3 className={s.placeHeading}>{confirmed?'You’re hosting & playing ✓':'You’re hosting this Open Play'}</h3><p className={s.muted}>{confirmed?'Your player slot is confirmed. You’re included in the crew and rotation.':'Manage your crew, or join them on court. Playing uses one slot.'}</p><div className={s.hostActions}>{status==='published'&&!ended&&<button className={s.secondary} disabled={busy} onClick={()=>hostPlayer(!confirmed)}>{confirmed?'Leave player slot':'Join as a player'}</button>}</div></>:!own?<><h3 className={s.placeHeading}>Meet your next court crew.</h3><p className={s.muted}>Reserve your spot, sort your payment, and get ready to play.</p><button className={s.primary} disabled={busy||status!=='published'||started} onClick={join}>{busy?'Please wait…':'Join Open Play'}</button></>:<>
      {confirmed?<div className={s.confirmation} role="status">
        <span className={s.confirmIcon} aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="m8 16 5 5 11-11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
        <span className={s.confirmLabel}>SPOT SECURED</span><h3>You’re confirmed!</h3><p>See you on court. Your crew is waiting.</p>
        <div className={s.confirmChips}><span>✓ {own.payment_status==='not_required'?'Free entry':'Payment verified'}</span><span>✓ Ready to play</span></div>
        <button className={s.confirmChat} onClick={()=>setTab('Chat')}>Say hello to the crew <span aria-hidden="true">↗</span></button>
      </div>:<div className={s.placeProgress}><span className={s.pendingIcon} aria-hidden="true">{own.registration_status==='cancelled'||status==='cancelled'?'×':own.payment_status==='rejected'?'!':'◷'}</span>
        <h3>{own.registration_status==='cancelled'||status==='cancelled'?'Registration unavailable':own.payment_status==='pending_review'?'You’re almost in!':own.payment_status==='rejected'?'Let’s check that receipt.':'Your next game is one step away.'}</h3>
        <p>{own.registration_status==='cancelled'||status==='cancelled'?'This game or registration has been cancelled.':own.payment_status==='pending_review'?'Awaiting for admin/host approval':own.payment_status==='rejected'?'Read the host’s feedback below and upload a corrected receipt.':'Pay the host, then upload your receipt to confirm your place.'}</p>
        {own.registration_status!=='cancelled'&&status!=='cancelled'&&<ol className={s.steps}><li data-done="true">Joined</li><li data-done={own.payment_status==='pending_review'}>Payment</li><li>Confirmed</li></ol>}
      </div>}
      {ownProof?.rejection_reason&&<p>{ownProof.rejection_reason}</p>}
      {own.registration_status==='reserved'&&['unpaid','rejected'].includes(own.payment_status)&&status==='published'&&<>
        <h3>Amount due: ₱{Number(own.amount_due).toFixed(2)}</h3><p>Pay using one of the host’s methods below. Uploading a receipt does not confirm payment until the host verifies it.</p>
        {methods.map(m=><div key={m.id} className={s.card}><strong>{m.provider.replaceAll('_',' ').toUpperCase()}</strong><p>{m.account_name}<br/>{m.account_number}</p>{m.qr_path&&<PrivateImage bucket="payment-qrs" path={m.qr_path} label="Host payment QR code"/>}</div>)}
        {!methods.length?<p>Payment details are unavailable. Contact the host before paying.</p>:<><label>Payment receipt<input disabled={busy||!!uploaded} type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>setFile(e.target.files?.[0]??null)}/></label><button className={s.primary} disabled={busy||(!file&&!uploaded)} onClick={submit}>{busy?'Submitting…':uploaded?'Retry receipt submission':'Submit payment proof'}</button></>}
      </>}
      {ownProof&&<details><summary>Your latest receipt</summary><PrivateImage bucket="payment-proofs" path={ownProof.object_path} label="Your payment receipt"/></details>}
      </>}
      <button className={s.secondary} disabled={busy} onClick={()=>action(async()=>{})}>Refresh status</button></section>}
      {confirmed&&children}
    </>}
    {tab==='Rotation'&&(uid&&(manager||own?.registration_status==='confirmed')?<RotationPanel eventId={eventId} onEnded={()=>{void load();onJoined();setTab('Results')}}/>:<SpectatorGame eventId={eventId} mode="rotation"/>)}
    {tab==='Participants'&&<>
      <div className={s.rosterHeading}><div><h3>Your court crew</h3><p className={s.muted}>{roster.filter(p=>p.registration_status==='confirmed').length} confirmed · {roster.filter(p=>p.registration_status!=='confirmed').length} pending</p></div><span className={s.rosterCount}>{roster.length}</span></div>
      {!rosterReady?<p role="status">Loading participants…</p>:!roster.length?<div className={s.emptyState}><span className={s.emptySymbol}>↗</span><h3>Be the first on court.</h3><p>Your crew starts with one player.</p></div>:<div className={s.roster}>{roster.map((p,i)=><div className={s.person} key={i}>
        <span className={`${s.avatar} ${p.registration_status==='confirmed'?s.avatarConfirmed:s.avatarPending}`} aria-hidden="true">{p.display_name.trim().split(/\s+/).map(n=>n[0]).slice(0,2).join('').toUpperCase()}</span>
        <strong>{p.display_name}</strong><span className={`${s.personState} ${p.registration_status==='confirmed'?s.personConfirmed:s.personPending}`}>{p.registration_status==='confirmed'?'Confirmed':'Pending'}</span>
      </div>)}</div>}
      <button className={s.secondary} disabled={busy} onClick={()=>action(loadRoster)}>↻ Refresh participants</button>
      {manager&&<section className={s.reviewSection}><span className={s.eyebrow}>HOST CONTROLS</span><h3>Payment review</h3>
        {!proofs.some(f=>f.status==='pending_review')&&<p className={s.muted}>All caught up. No receipts awaiting review.</p>}
        {players.filter(p=>proofs.some(f=>f.registration_id===p.id&&f.status==='pending_review')).map(p=><div key={p.id} className={s.card}><strong>{p.profile?.display_name??'Player'}</strong><p className={s.muted}>Pending approval · ₱{Number(p.amount_due).toFixed(2)}</p>
          {proofs.filter(f=>f.registration_id===p.id&&f.status==='pending_review').map(f=><div key={f.id}><PrivateImage bucket="payment-proofs" path={f.object_path} label={`Payment receipt for ${p.profile?.display_name??'player'}`}/><label>Reason if rejecting<textarea maxLength={1000} value={reasons[f.id]??''} onChange={e=>setReasons(r=>({...r,[f.id]:e.target.value}))}/></label><p className={s.muted}>Verify receipt against your actual received payment before accepting.</p>{[true,false].map(approve=><button key={String(approve)} className={approve?s.primary:s.secondary} disabled={busy||p.user_id===uid||(!approve&&!reasons[f.id]?.trim())} onClick={()=>action(async()=>{const r=await createClient().rpc('openly_review_proof',{p_proof:f.id,p_approve:approve,p_reason:approve?null:reasons[f.id]});if(r.error)throw r.error;setNotice(approve?'Player accepted.':'Proof rejected. Player is hidden from the participant list until resubmission.')})}>{approve?'Accept payment & player':'Reject proof'}</button>)}{p.user_id===uid&&<p>Another administrator must review your payment.</p>}</div>)}
        </div>)}
      </section>}
    </>}
    {tab==='Chat'&&(!roomAccess?<div className={s.emptyState}><span className={s.emptySymbol}>↗</span><h3>Your crew is right here.</h3><p>The game chat opens once your place is confirmed.</p><button className={s.secondary} onClick={()=>setTab('Game Details')}>View your place</button></div>:<section className={s.chatShell}>
      <header className={s.chatHeader}><span className={s.chatLogo} aria-hidden="true">o.</span><div><strong>Court crew</strong><span>Host & confirmed players</span></div><span className={s.chatPrivate}>Game chat</span></header>
      <div ref={chatScroll} className={s.chatMessages} role="log" aria-label="Game conversation" aria-live="polite">
        {!chat.length&&<div className={s.chatEmpty}><span aria-hidden="true">✦</span><h3>Good games start with a hello.</h3><p>Introduce yourself to your court crew.</p></div>}
        {chat.map((m,i)=>{const mine=m.user_id===uid;const day=new Date(m.created_at).toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric'});const previous=i?new Date(chat[i-1].created_at).toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric'}):'';return <div key={m.id}>
          {day!==previous&&<p className={s.chatDay}>{day}</p>}
          <div className={`${s.messageRow} ${mine?s.messageMine:''}`}><div className={s.messageGroup}>
            {!mine&&<span className={s.sender}>{m.profile?.display_name??'Player'}</span>}
            <p className={s.bubble}>{m.body}</p><time className={s.messageTime} dateTime={m.created_at}>{new Date(m.created_at).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'})}</time>
          </div></div>
        </div>})}
      </div>
      <form className={s.composer} onSubmit={e=>{e.preventDefault();if(!body.trim())return;void action(async()=>{chatId.current??=crypto.randomUUID();const db=createClient();const r=await db.from('open_play_messages').insert({id:chatId.current,open_play_id:eventId,user_id:uid,body:body.trim()});if(r.error&&r.error.code!=='23505')throw r.error;setBody('');chatId.current=null;await loadRoom()})}}>
        <textarea aria-label="Message" placeholder="Message your crew…" rows={1} value={body} maxLength={2000} disabled={busy} onChange={e=>{setBody(e.target.value);chatId.current=null}}/>
        <button type="submit" className={s.sendButton} aria-label="Send message" disabled={busy||!body.trim()||!['published','completed'].includes(status)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M12 19V5m-6 6 6-6 6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
      </form><p className={s.chatFootnote}>Messages refresh every 10 seconds · Philippine time</p>
    </section>)}
    {tab==='Results'&&<><SpectatorGame eventId={eventId} mode="results"/>{manager&&<details className={s.card}><summary>Write or edit the host recap</summary><p>Round scores appear automatically above. Use this optional recap for winners, highlights and notes.</p><button className={s.secondary} onClick={()=>setDraft(summary)}>Copy saved recap into editor</button><label>Host recap<textarea maxLength={5000} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Highlights from your Open Play…"/></label><button className={s.primary} disabled={busy||!started||!draft.trim()||!['published','completed'].includes(status)} onClick={()=>action(async()=>{const r=await createClient().from('open_play_results').upsert({open_play_id:eventId,summary:draft.trim()});if(r.error)throw r.error;await loadRoom();setNotice('Recap saved. Results refresh automatically within 10 seconds.')})}>Save recap</button>{!started&&<p>Recaps can be posted after the game starts.</p>}</details>}</>}

  </div>
}
