'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { safeNextPath } from '@/lib/auth/next-path'

type Props = {
  nextPath?: string
  label?: string
}

export default function GoogleSignInButton({
  nextPath = '/',
  label = 'Continue with Google',
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function signIn() {
    setLoading(true)
    setError('')

    try {
    const supabase = createClient()
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNextPath(nextPath))}`

    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
      },
    })

    if (signInError) {
      setError(signInError.message)
      setLoading(false)
    }
    } catch {
      setError('Could not open Google. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={signIn}
        disabled={loading}
        className="inline-flex items-center justify-center gap-3 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 disabled:opacity-60"
      >
        {loading ? 'Opening Google…' : label}
      </button>

      {error && (
        <p className="mt-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
