import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { safeNextPath } from '@/lib/auth/next-path'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = safeNextPath(requestUrl.searchParams.get('next'))
  function fail(reason: string) {
    const url = new URL('/login', requestUrl.origin)
    url.searchParams.set('next', next)
    url.searchParams.set('error', reason)
    const response = NextResponse.redirect(url)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
  if (requestUrl.searchParams.has('error') || !code) return fail('oauth')
  try {
    const supabase = await createServerSupabaseClient(true)
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error || !data.user) return fail('oauth')
    const profile = await supabase.from('profiles').select('onboarding_completed_at').eq('id', data.user.id).single()
    if (profile.error) return fail('profile')
    const destination = profile.data.onboarding_completed_at ? next : `/onboarding?next=${encodeURIComponent(next)}`
    const response = NextResponse.redirect(new URL(destination, requestUrl.origin))
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch { return fail('oauth') }
}
