import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import VenueManager from './VenueManager'
import styles from '@/app/host/host.module.css'

export default async function AdminVenuesPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=%2Fadmin%2Fvenues')
  const admin = await supabase.rpc('openly_is_admin')
  return <main className={styles.page}>
    <header className={styles.header}><Link href="/" className={styles.brand}><span aria-hidden="true" />openly<b>.</b></Link><Link href="/?tab=profile">← My profile</Link></header>
    {admin.error || admin.data !== true ? <section className={styles.panel}><h1>Admin access required</h1><p>{admin.error ? 'Unable to verify your admin access. Confirm migration 005 is installed and try again.' : 'This Google account is not assigned as an Openly administrator.'}</p><Link href="/">Continue browsing</Link></section> : <><nav style={{display:'flex',flexWrap:'wrap',gap:20,margin:'0 auto 24px',maxWidth:1120}}><Link href="/admin/games">Open Plays</Link><Link href="/admin/support">Support inbox</Link><Link href="/admin/settings">Payment settings</Link><Link href="/admin/payments">Premium payments</Link><Link href="/admin/transactions">Transactions</Link></nav><VenueManager /></>}
    <footer className={styles.footer}>LESS PLANNING. MORE PLAYING.</footer>
  </main>
}
