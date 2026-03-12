import { WcdbService, wcdbService } from './wcdbService'

type WcdbConnectionMethodName =
  | 'isMacBackendActive'
  | 'setMonitor'
  | 'isReady'
  | 'isConnected'
  | 'open'
  | 'close'
  | 'testConnection'

export type WcdbConnectionGateway = Pick<WcdbService, WcdbConnectionMethodName>

export const wcdbConnectionGateway: WcdbConnectionGateway = {
  isMacBackendActive: wcdbService.isMacBackendActive.bind(wcdbService),
  setMonitor: wcdbService.setMonitor.bind(wcdbService),
  isReady: wcdbService.isReady.bind(wcdbService),
  isConnected: wcdbService.isConnected.bind(wcdbService),
  open: wcdbService.open.bind(wcdbService),
  close: wcdbService.close.bind(wcdbService),
  testConnection: wcdbService.testConnection.bind(wcdbService)
}
