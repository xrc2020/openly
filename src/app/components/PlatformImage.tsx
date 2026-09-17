'use client'
import {useEffect,useState} from 'react'
import {createClient} from '@/lib/supabase/client'
import s from './platform.module.css'
export function paymentError(e:unknown){return e&&typeof e==='object'&&'message'in e?String(e.message):'Please check your connection and retry.'}
export async function uploadPlatformImage(bucket:'platform-qrs'|'platform-proofs',folder:string,file:File){
 const ext:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'},max=bucket==='platform-qrs'?5:10
 if(!ext[file.type]||!file.size||file.size>max*1024*1024)throw Error(`Choose a PNG, JPG or WebP image up to ${max} MB.`)
 const bitmap=await createImageBitmap(file),valid=bitmap.width>0&&bitmap.height>0&&bitmap.width<=10000&&bitmap.height<=10000;bitmap.close();if(!valid)throw Error('Choose an image no larger than 10,000 pixels per side.')
 const path=`${folder}/${crypto.randomUUID()}.${ext[file.type]}`,r=await createClient().storage.from(bucket).upload(path,file,{upsert:false,contentType:file.type})
 if(r.error)throw r.error;return path
}
export default function PlatformImage({bucket,path,alt}:{bucket:string;path:string;alt:string}){
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[version,setVersion]=useState(0)
 useEffect(()=>{let active=true;void createClient().storage.from(bucket).createSignedUrl(path,300).then(({data,error})=>{if(active){setUrl(data?.signedUrl??'');setError(error?'Could not load image. Refresh below.':'')}}).catch(()=>{if(active)setError('Could not load image. Refresh below.')});return()=>{active=false}},[bucket,path,version])
 return <div>{url&&<>
 {/* Keep private images out of the shared image optimizer. */}
 {/* eslint-disable-next-line @next/next/no-img-element */}
 <a href={url} target="_blank" rel="noopener noreferrer"><img className={s.image} src={url} alt={alt} onError={()=>setError('Image expired or unavailable. Refresh below.')}/>Open image full size ↗</a></>}{error&&<p role="alert">{error}</p>}<button type="button" className={s.secondary} onClick={()=>setVersion(v=>v+1)}>Refresh image</button></div>
}
