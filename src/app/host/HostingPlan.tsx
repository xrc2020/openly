'use client'
import Link from 'next/link'
import {useEffect,useState} from 'react'
import {createClient} from '@/lib/supabase/client'
import styles from './host.module.css'
type Allowance={is_plus:boolean;published_today:number;daily_limit:number|null;remaining:number|null;resets_at:string}
export default function HostingPlan({version,onBlocked}:{version:number;onBlocked:(blocked:boolean)=>void}) {
 const [allowance,setAllowance]=useState<Allowance|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0)
 useEffect(()=>{
  let active=true
  async function load(){try{
   const result=await createClient().rpc('openly_hosting_allowance')
   if(result.error)throw result.error
   if(!result.data||typeof result.data.is_plus!=='boolean')throw Error('Invalid allowance')
   if(active){setAllowance(result.data);setError('');onBlocked(!result.data.is_plus&&result.data.remaining===0)}
  }catch{if(active){setError('Could not refresh your hosting allowance. Retry below.');onBlocked(false)}}}
  void load();const timer=window.setInterval(()=>void load(),60000)
  window.addEventListener('focus',load)
  return()=>{active=false;window.clearInterval(timer);window.removeEventListener('focus',load)}
 },[version,refresh,onBlocked])
 return <section className={`${styles.planPanel} ${allowance?.is_plus?styles.planPlus:''}`} aria-label="Your hosting plan">
  <div><span className={styles.kicker}>YOUR HOSTING PLAN</span><h2>{allowance?allowance.is_plus?'Openly Plus · Unlimited hosting':'Free · 3 Open Plays per day':'Checking your hosting plan…'}</h2>
  {allowance&&<><p role="status">{allowance.is_plus?`${allowance.published_today} published today · No daily limit`:`${allowance.published_today} published today · ${allowance.remaining} remaining`}</p>
  {!allowance.is_plus&&allowance.remaining===0&&<p className={styles.planLimit}>You’ve used today’s allowance. Save a draft for tomorrow or upgrade to Openly Plus.</p>}
  <p className={styles.hint}>Counts when you first publish, not the game’s scheduled date. Drafts don’t count. Resets at midnight Philippine time.</p></>}
  {error&&<p role="alert" className={styles.error}>{error}</p>}</div>
  <div className={styles.planActions}><Link href="/plus" target="_blank" rel="noopener noreferrer" className={styles.primary}>{allowance?.is_plus?'Manage Openly Plus ↗':'Openly Plus · ₱399/month ↗'}</Link><button type="button" className={styles.secondary} onClick={()=>setRefresh(v=>v+1)}>Refresh plan</button><small>Opens in another tab so your form stays here. The ₱39 session unlock does not remove the daily limit.</small></div>
 </section>
}
