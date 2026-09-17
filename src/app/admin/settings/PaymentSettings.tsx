'use client'
import {useEffect,useRef,useState} from 'react'
import {createClient} from '@/lib/supabase/client'
import PlatformImage,{paymentError,uploadPlatformImage} from '@/app/components/PlatformImage'
import {paymentMethodName,type PaymentMethod} from '@/app/plus/types'
import s from '@/app/components/platform.module.css'
import PaymongoSettings from './PaymongoSettings'
export default function PaymentSettings(){
 const [methods,setMethods]=useState<PaymentMethod[]>([]),[uid,setUid]=useState(''),[ready,setReady]=useState(false),[error,setError]=useState(''),[version,setVersion]=useState(0)
 useEffect(()=>{let live=true;void(async()=>{try{const db=createClient(),auth=await db.auth.getUser();if(auth.error||!auth.data.user)throw Error('Please sign in again.');const r=await db.from('platform_payment_methods').select('*').order('provider');if(r.error)throw r.error;if(live){setUid(auth.data.user.id);setMethods(r.data);setReady(true);setError('')}}catch(e){if(live)setError(paymentError(e))}})();return()=>{live=false}},[version])
 const providers=['gcash','maribank',...methods.filter(m=>!['gcash','maribank','paymongo'].includes(m.provider)).map(m=>m.provider)]
 return <><span className={s.kicker}>OPENLY ADMIN</span><h1>Payment settings</h1><p>Manage PayMongo payment links and separate GCash or MariBank QR accounts. Hosts choose from enabled methods when buying Plus or a session unlock.</p><p className={s.notice}>Each method is saved independently. Existing purchase requests keep their original account details and QR.</p>
 {error&&<p className={s.error} role="alert">{error}</p>}{!ready?<button className={s.secondary} onClick={()=>setVersion(v=>v+1)}>Load payment methods</button>:<div className={s.methodGrid}><PaymongoSettings initial={methods.find(m=>m.provider==='paymongo')}/>{providers.map(provider=><MethodEditor key={provider} uid={uid} initial={methods.find(m=>m.provider===provider)??{provider,enabled:false,account_name:'',account_number:'',qr_path:''}}/>)}</div>}</>
}
function MethodEditor({uid,initial}:{uid:string;initial:PaymentMethod}){
 const [values,setValues]=useState(initial),[saved,setSaved]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');const lock=useRef(false),name=paymentMethodName(initial.provider)
 async function run(fn:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await fn()}catch(e){setError(paymentError(e))}finally{lock.current=false;setBusy(false)}}
 return <form className={s.card} aria-label={`${name} payment settings`} onSubmit={e=>{e.preventDefault();void run(async()=>{const r=await createClient().rpc('openly_save_platform_method',{p_enabled:values.enabled,p_provider:values.provider,p_account_name:values.account_name,p_account_number:values.account_number,p_qr_path:values.qr_path});if(r.error)throw r.error;setSaved(values);setNotice(`${name} saved${values.enabled?' and accepting payments':'; new payments disabled'}.`)})}}>
 <div className={s.receiptHeading}><h2>{name}</h2><span className={s.pill}>{saved.enabled?'Accepting payments':'Not enabled'}</span></div>
 {error&&<p className={s.error} role="alert">{error}</p>}{notice&&<p className={s.notice} role="status">{notice}</p>}
 <fieldset disabled={busy} className={s.methodFields}><label>Account name<input required maxLength={160} value={values.account_name} onChange={e=>setValues(v=>({...v,account_name:e.target.value}))}/></label><label>Account number<input required maxLength={80} value={values.account_number} onChange={e=>setValues(v=>({...v,account_number:e.target.value}))}/></label>
 <label>{name} QR image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];if(file)void run(async()=>{const path=await uploadPlatformImage('platform-qrs',uid,file);setValues(v=>({...v,qr_path:path}));setNotice('Image uploaded. Save this method to publish it.')});e.target.value=''}}/></label>
 {values.qr_path?<PlatformImage bucket="platform-qrs" path={values.qr_path} alt={`${name} receiving QR`}/>:<div className={s.qrPlaceholder}>Upload your {name} QR</div>}
 <label><input type="checkbox" checked={values.enabled} onChange={e=>setValues(v=>({...v,enabled:e.target.checked}))}/>Accept payments through {name}</label>
 <button className={s.primary} disabled={!values.qr_path||busy}>{busy?'Saving…':`Save ${name}`}</button></fieldset></form>
}
