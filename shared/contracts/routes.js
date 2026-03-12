export const APP_SUPPORTED_ROUTES = [
  '/home',
  '/chat',
  '/contacts',
  '/analytics',
  '/group-analytics',
  '/annual-report',
  '/dual-report',
  '/export',
  '/sns',
  '/settings'
]

export const PUBLIC_ROUTE_PATHS = ['/', '/home', '/settings']

export function getTopLevelRoute(pathname) {
  const normalized = String(pathname || '').trim()
  return `/${normalized.split('/').filter(Boolean)[0] || ''}`.replace(/\/$/, '') || '/'
}

export function isPublicRoute(pathname) {
  const normalized = String(pathname || '').trim() || '/'
  return PUBLIC_ROUTE_PATHS.includes(normalized)
}

export function isRouteSupported(pathname, supportedRoutes) {
  if (isPublicRoute(pathname)) return true
  if (!supportedRoutes || supportedRoutes.length === 0) return true
  return supportedRoutes.includes(getTopLevelRoute(pathname))
}
