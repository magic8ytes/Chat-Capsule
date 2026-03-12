import { WcdbService, wcdbService } from './wcdbService'

type WcdbReadonlySqlMethodName = 'execQuery'

export type WcdbReadonlySqlGateway = Pick<WcdbService, WcdbReadonlySqlMethodName>

export const wcdbReadonlySqlGateway: WcdbReadonlySqlGateway = {
  execQuery: wcdbService.execQuery.bind(wcdbService)
}
