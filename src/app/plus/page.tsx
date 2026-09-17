import Link from 'next/link'
import {redirect} from 'next/navigation'
import {createServerSupabaseClient} from '@/lib/supabase/server'
import BillingPanel from './BillingPanel'
import s from '@/app/components/platform.module.css'
import pricing from './pricing.module.css'
export default async function Page({searchParams}:{searchParams:Promise<{game?:string}>}){const params=await searchParams,game=params.game&&/^[0-9a-f-]{36}$/i.test(params.game)?params.game:'';const db=await createServerSupabaseClient(),auth=await db.auth.getUser();if(!auth.data.user)redirect('/login?next=%2Fplus');const p=await db.from('profiles').select('onboarding_completed_at').eq('id',auth.data.user.id).single();if(!p.error&&!p.data.onboarding_completed_at)redirect('/onboarding?next=%2Fplus');return <main className={`${s.page} ${pricing.page}`}><header className={s.header}><Link className={s.brand} href="/">openly<span>.</span></Link><Link href="/?tab=hosted">Hosted by Me</Link></header><div className={`${s.content} ${pricing.content}`}><BillingPanel uid={auth.data.user.id} initialEvent={game}/></div></main>}
