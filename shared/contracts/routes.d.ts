export declare const APP_SUPPORTED_ROUTES: readonly [
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

export declare const PUBLIC_ROUTE_PATHS: readonly ['/', '/home', '/settings']

export type SupportedRoutePath = (typeof APP_SUPPORTED_ROUTES)[number]
export type PublicRoutePath = (typeof PUBLIC_ROUTE_PATHS)[number]

export declare function getTopLevelRoute(pathname: string): string
export declare function isPublicRoute(pathname: string): boolean
export declare function isRouteSupported(pathname: string, supportedRoutes?: readonly string[] | null): boolean
