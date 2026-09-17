import Link from 'next/link'
import {redirect} from 'next/navigation'
import {createServerSupabaseClient} from '@/lib/supabase/server'
import SupportConversation from './SupportConversation'
import s from '@/app/components/platform.module.css'
export default async function Page(){const db=await createServerSupabaseClient(),{data}=await db.auth.getUser();if(!data.user)redirect('/login?next=%2Fsupport');return <main className={s.page}><header className={s.header}><Link className={s.brand} href="/">openly<span>.</span></Link><Link href="/?tab=profile">My profile</Link></header><div className={s.content}><span className={s.kicker}>WE’RE HERE TO HELP</span><h1>Customer Support</h1><p>A private conversation with the Openly admin team. Include your game title when asking about an Open Play.</p><SupportConversation thread={data.user.id} uid={data.user.id}/></div></main>}
