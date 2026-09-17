import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { safeNextPath } from '@/lib/auth/next-path'
import OnboardingForm from './OnboardingForm'

export default async function OnboardingPage({ searchParams }: {
  searchParams: Promise<{ next?: string; edit?: string }>
}) {
  const params = await searchParams
  const next = safeNextPath(params.next)
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`)
  const [profile, contact] = await Promise.all([
    supabase.from('profiles').select('display_name,city,skill_level,onboarding_completed_at').eq('id', user.id).single(),
    supabase.from('profile_private').select('first_name,last_name,phone').eq('user_id', user.id).maybeSingle(),
  ])
  if (profile.error || contact.error) return (
    <main style={{ minHeight: '100vh', background: '#08191e', color: 'white', padding: 40 }}>
      <h1>Your profile could not be loaded</h1>
      <p>Confirm migration 003 is installed, then refresh this page. Nothing has been saved.</p>
      <Link href="/">Continue browsing</Link>
    </main>
  )
  const editing = params.edit === '1'
  if (profile.data.onboarding_completed_at && !editing) redirect(next)
  const googleName = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.slice(0, 80) : ''
  return <OnboardingForm next={next} editing={editing} email={user.email ?? ''} initial={{
    displayName: profile.data.display_name === 'Player' ? googleName : profile.data.display_name,
    city: profile.data.city ?? '', skillLevel: profile.data.skill_level ?? '',
    firstName: contact.data?.first_name ?? '', lastName: contact.data?.last_name ?? '', phone: contact.data?.phone ?? '',
  }} />
}
