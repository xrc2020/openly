'use client'
import {useRef,useState} from 'react'
import {createClient} from '@/lib/supabase/client'
import {paymentError} from '@/app/components/PlatformImage'
import {validPaymongoLink,type PaymentMethod} from '@/app/plus/types'
import s from '@/app/components/platform.module.css'
export default function PaymongoSettings({initial}:{initial?:PaymentMethod}){
 const [enabled,setEnabled]=useState(initial?.enabled??false),[session,setSession]=useState(initial?.session_url??''),[plus,setPlus]=useState(initial?.plus_url??''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');const lock=useRef(false)
 return <form className={s.card} aria-label="PayMongo payment settings" onSubmit={async e=>{e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{const r=await createClient().rpc('openly_save_paymongo_links',{p_enabled:enabled,p_session_url:session.trim(),p_plus_url:plus.trim()});if(r.error)throw r.error;setNotice(`PayMongo saved${enabled?' and accepting payments':'; new payments disabled'}.`)}catch(e){setError(paymentError(e))}finally{lock.current=false;setBusy(false)}}}>
 <h2>PayMongo · QR Ph</h2><p>One payment link per plan. Verify payment manually in PayMongo before approving the host’s receipt.</p>
 {error&&<p role="alert" className={s.error}>{error}</p>}{notice&&<p role="status" className={s.notice}>{notice}</p>}
 <fieldset disabled={busy} className={s.methodFields}><label>Session unlock payment link · ₱39<input type="url" required maxLength={500} value={session} onChange={e=>setSession(e.target.value)} placeholder="https://paymongo.page/l/openly-sessionunlock"/></label><label>Openly Plus payment link · ₱399<input type="url" required maxLength={500} value={plus} onChange={e=>setPlus(e.target.value)} placeholder="https://paymongo.page/l/openlyplus"/></label>
 <p className={s.muted}>Check that each PayMongo page charges the matching plan amount. Existing purchases keep the link saved when their request was created.</p>
 <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Accept payments through PayMongo</label><button className={s.primary} disabled={busy||!validPaymongoLink(session.trim())||!validPaymongoLink(plus.trim())}>{busy?'Saving…':'Save PayMongo'}</button></fieldset></form>
}
