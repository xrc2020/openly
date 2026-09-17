'use client'
import { useRef,useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import s from './platform.module.css'
export default function ShareOpenPlay({eventId,publicId,title}:{eventId?:string;publicId?:string;title:string}) {
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null)
 const [url,setUrl]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[opened,setOpened]=useState(false)
 async function open(){if(busy)return;setBusy(true);setMessage('');try{
   let id=publicId
   if(!id){const r=await createClient().from('open_plays').select('public_id,status').eq('id',eventId).single();if(r.error)throw r.error;if(r.data.status==='draft')throw Error('Publish your draft before sharing it.');id=r.data.public_id}
   const origin=process.env.NEXT_PUBLIC_SITE_URL?new URL(process.env.NEXT_PUBLIC_SITE_URL).origin:window.location.origin
   setUrl(`${origin}/open-play/${id}`);dialog.current?.showModal();setOpened(true)
 }catch(e){setMessage(e&&typeof e==='object'&&'message'in e?String(e.message):'Could not create the share link.')}finally{setBusy(false)}}
 async function copy(){try{await navigator.clipboard.writeText(url);setMessage('Link copied.')}catch{input.current?.focus();input.current?.select();setMessage('Select and copy the link above.')}}
 async function nativeShare(){if(!navigator.share){await copy();return}try{await navigator.share({title,text:`Join ${title} on Openly.`,url})}catch(e){if(!(e instanceof Error&&e.name==='AbortError'))setMessage('Sharing is unavailable. Use Copy Link.')}}
 return <div className={s.shareWrap}><button type="button" className={s.secondary} disabled={busy} onClick={open}>↗ Share</button>{message&&!opened&&<span role="status">{message}</span>}
 <dialog onCancel={e=>e.stopPropagation()} onClose={e=>{e.stopPropagation();setOpened(false);setMessage('')}} ref={dialog} className={s.dialog} aria-label="Share Open Play"><button className={s.close} aria-label="Close sharing" onClick={()=>dialog.current?.close()}>×</button><span className={s.kicker}>SHARE OPEN PLAY</span><h2>{title}</h2><p>Bring your next court crew together.</p><label>Public game link<input ref={input} readOnly value={url} onFocus={e=>e.target.select()}/></label>
 <div className={s.actions}><button className={s.primary} onClick={copy}>Copy Link</button><button className={s.secondary} onClick={nativeShare}>Share using device</button></div><div className={s.actions}>
 <a target="_blank" rel="noopener noreferrer" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}>Facebook</a><a target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`${title}\n${url}`)}`}>WhatsApp</a><a target="_blank" rel="noopener noreferrer" href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`}>Telegram</a></div><p className={s.muted}>For Messenger, use your device’s share menu or paste the copied link.</p>{url.includes('localhost')&&<p className={s.muted}>This is a local test link. Publish Openly before sharing with other people.</p>}{message&&<p role="status">{message}</p>}</dialog></div>
}
