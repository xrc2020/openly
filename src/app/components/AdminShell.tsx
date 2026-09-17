import Link from 'next/link'
import {redirect} from 'next/navigation'
import type {ReactNode} from 'react'
import {createServerSupabaseClient} from '@/lib/supabase/server'
import s from './platform.module.css'
export default async function AdminShell({children,next}:{children:ReactNode;next:string}){
 const db=await createServerSupabaseClient(),auth=await db.auth.getUser()
 if(!auth.data.user)redirect(`/login?next=${encodeURIComponent(next)}`)
 const access=await db.rpc('openly_is_admin')
 return <main className={s.page}><header className={s.header}><Link className={s.brand} href="/">openly<span>.</span></Link><Link href="/?tab=profile">My profile</Link></header><div className={s.content}>{access.error||access.data!==true?<section className={s.card}><h1>Admin access required</h1><p>This account could not be verified as an Openly administrator.</p></section>:<><nav className={s.nav}><Link href="/admin/games">Open Plays</Link><Link href="/admin/support">Support inbox</Link><Link href="/admin/venues">Venues</Link><Link href="/admin/settings">Payment settings</Link><Link href="/admin/payments">Premium payments</Link><Link href="/admin/transactions">Transactions</Link></nav>{children}</>}</div></main>
}
