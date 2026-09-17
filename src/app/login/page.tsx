'use client'
import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import GoogleSignInButton from '@/app/components/GoogleSignInButton'
import { EmailLoginForm } from '@/app/components/EmailAuthForms'
import { safeNextPath } from '@/lib/auth/next-path'
import styles from '@/app/auth.module.css'

function Content(){
  const params=useSearchParams(),next=safeNextPath(params.get('next')),callbackError=params.get('error')
  return <main className={styles.page}><section className={styles.card}>
    <Link href="/" className={styles.brand}>openly<span>.</span></Link>
    <h1>Welcome back</h1><p className={styles.intro}>Log in to join, host and keep up with your games.</p>
    <EmailLoginForm nextPath={next}/><div className={styles.divider}>or</div>
    <div className={styles.google}><GoogleSignInButton nextPath={next}/></div>
    {callbackError&&<p className={styles.error}>The sign-in link could not be completed. Please try again.</p>}
    <p className={styles.footer}>New to Openly? <Link href={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link></p>
    <Link className={styles.back} href="/">Continue browsing</Link>
  </section></main>
}
export default function Page(){return <Suspense fallback={null}><Content/></Suspense>}
