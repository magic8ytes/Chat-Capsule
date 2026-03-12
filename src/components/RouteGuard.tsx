import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { usePlatformStore } from '../stores/platformStore'
import { getTopLevelRoute, isPublicRoute as isPublicRoutePath, isRouteSupported } from '../../shared/contracts/routes'

interface RouteGuardProps {
  children: React.ReactNode
}


function RouteGuard({ children }: RouteGuardProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const isDbConnected = useAppStore(state => state.isDbConnected)
  const capabilities = usePlatformStore(state => state.capabilities)

  useEffect(() => {
    const isPublicRoute = isPublicRoutePath(location.pathname)
    const topLevelRoute = getTopLevelRoute(location.pathname)
    const routeAllowed = isRouteSupported(topLevelRoute, capabilities?.supportedRoutes) || isPublicRoute

    if (!routeAllowed) {
      navigate('/home', { replace: true })
      return
    }

    // 未连接数据库且不在公开页面，跳转到欢迎页
    if (!isDbConnected && !isPublicRoute) {
      navigate('/', { replace: true })
    }
  }, [capabilities, isDbConnected, location.pathname, navigate])

  return <>{children}</>
}

export default RouteGuard
