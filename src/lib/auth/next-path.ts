// Only existing Openly destinations are accepted. Never redirect to an
// arbitrary URL supplied by a query parameter, even after a successful login.
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return '/'
  try {
    const url = new URL(value, 'https://openly.invalid')
    if (url.origin !== 'https://openly.invalid') return '/'
    if (url.pathname === '/admin' || url.pathname === '/admin/venues') return '/admin/venues'
    if (['/plus', '/support', '/admin/games', '/admin/support', '/admin/settings', '/admin/payments', '/admin/transactions'].includes(url.pathname)) return url.pathname
    if (/^\/open-play\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.pathname)) return url.pathname
    if (url.pathname === '/host') {
      const draft = url.searchParams.get('draft')
      return draft && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draft) ? `/host?draft=${draft}` : '/host'
    }
    if (url.pathname !== '/') return '/'
    const query = new URLSearchParams()
    const join = url.searchParams.get('join')
    if (join && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(join)) query.set('join', join)
    const tab = url.searchParams.get('tab')
    if (tab && ['discover', 'games', 'hosted', 'profile'].includes(tab)) query.set('tab', tab)
    return query.size ? `/?${query}` : '/'
  } catch { return '/' }
}
