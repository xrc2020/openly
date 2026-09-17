'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import GoogleSignInButton from '@/app/components/GoogleSignInButton'
import { safeNextPath } from '@/lib/auth/next-path'

function LoginContent() {
  const searchParams = useSearchParams()
  const next = safeNextPath(searchParams.get('next'))
  const error = searchParams.get('error')

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#08191e] px-6 text-white">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#10252b] p-8 text-center">
        <p className="mb-6 text-sm font-bold tracking-[0.25em] text-[#c0f65c]">
          OPENLY.
        </p>

        <h1 className="text-2xl font-bold">{next.startsWith('/admin') ? 'Admin sign-in' : next.startsWith('/host') || next.includes('tab=hosted') ? 'Sign in to host' : 'Sign in to join'}</h1>

        <p className="mt-3 mb-7 text-sm leading-6 text-[#a6b3b7]">
          {next.startsWith('/admin') ? 'Use your authorized Google account to manage Openly venues.' : next.startsWith('/host') || next.includes('tab=hosted') ? 'Sign in with Google to bring your court crew together.' : 'Sign in with Google to reserve your place in this Open Play.'}
        </p>

        <GoogleSignInButton
          nextPath={next}
          label="Continue with Google"
        />
        {error && <p role="alert" className="mt-4 text-sm text-red-300">
          {error === 'profile' ? 'Google sign-in worked, but your Openly profile could not be loaded. Confirm migration 003 is installed, then try again.' : 'Sign-in was cancelled or could not finish. Please try again.'}
        </p>}

        <Link
          href="/"
          className="mt-6 block text-sm text-[#a6b3b7] hover:text-[#c0f65c]"
        >
          Continue browsing
        </Link>
      </section>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  )
}
