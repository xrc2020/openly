'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import GoogleSignInButton from './GoogleSignInButton'
import styles from '../discover.module.css'
import Link from 'next/link'
import PlayerProfile from './PlayerProfile'

export default function AccountAccess({ tab }: { tab: string }) {
  const [email, setEmail] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState('')
  const [admin, setAdmin] = useState(false)
  const [avatar,setAvatar]=useState('')
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const supabase = createClient()
        const { data, error } = await supabase.auth.getUser()
        if (error && error.name !== 'AuthSessionMissingError') throw error
        if (!active) return
        if (data.user) {
          setEmail(data.user.email ?? 'Google account')
          setAvatar(typeof data.user.user_metadata?.avatar_url==='string'?data.user.user_metadata.avatar_url:'')
          const profile = await supabase.from('profiles').select('onboarding_completed_at').eq('id', data.user.id).single()
          if (profile.error) throw profile.error
          if (active) setComplete(Boolean(profile.data.onboarding_completed_at))
          const role = await supabase.rpc('openly_is_admin')
          if (active) setAdmin(!role.error && role.data === true)
        }
      } catch { if (active) setError('Could not load your account. Refresh to try again.') }
      finally { if (active) setReady(true) }
    }
    void load()
    return () => { active = false }
  }, [])
  async function signOut() {
    const { error } = await createClient().auth.signOut({ scope: 'local' })
    if (error) { setError('Could not sign out. Please try again.'); return }
    window.location.assign('/')
  }
  if (!ready) return <p>Checking your account...</p>
  if (error) return <p role="alert">{error}</p>
  if (!email) return <div style={{ marginBottom: 24 }}><p>Sign in when you are ready to join or host a game.</p><GoogleSignInButton nextPath={`/?tab=${tab}`} /></div>
  if (tab==='profile') return <PlayerProfile email={email} admin={admin} avatar={avatar} signOut={()=>void signOut()}/>
  return <div style={{ marginBottom: 24 }}>
    <p>Signed in as {email}</p>
    <p style={{ marginBottom: 20 }}><Link href="/support">Customer Support →</Link></p>
    <p style={{ marginBottom: 20 }}><Link href="/plus">Openly Plus & purchases →</Link></p>
    {admin && <p style={{ marginBottom: 20 }}><Link href="/admin/games">Manage Open Plays</Link> · <Link href="/admin/support">Support inbox</Link> · <Link href="/admin/venues">Manage venues</Link> · <Link href="/admin/settings">Payment settings</Link> · <Link href="/admin/payments">Premium payments</Link> · <Link href="/admin/transactions">Transactions</Link></p>}
    {!complete && <p>Complete your player profile before joining or publishing a game.</p>}
    <a className={styles.primaryButton} href={`/onboarding?edit=1&next=${encodeURIComponent(`/?tab=${tab}`)}`}>{complete ? 'Edit profile' : 'Complete profile'}</a>
    <button type="button" onClick={() => void signOut()} style={{ display: 'block', margin: '18px auto 0', background: 'transparent', border: 0, color: '#a6b3b7' }}>Sign out</button>
  </div>
}
