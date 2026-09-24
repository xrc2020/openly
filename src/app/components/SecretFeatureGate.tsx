'use client'

import { useSyncExternalStore, type ReactNode } from 'react'

function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}
const getSnapshot = () => window.location.hash === '#Secretfeature'
const getServerSnapshot = () => false

// A hidden entry point, not an authorization boundary. The standalone tool has
// its own document so its scripts and styles cannot interfere with Openly.
export default function SecretFeatureGate({ children }: { children: ReactNode }) {
  const secret = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  if (!secret) return children
  return <iframe
    title="Openly Secret Feature"
    src="/secret-feature/index.html"
    sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
    style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0, background: '#090d16', zIndex: 100 }}
  />
}
