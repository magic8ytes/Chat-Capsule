export type ProfileSourceMode = 'encrypted-sqlcipher' | 'decrypted-sqlite'

export interface MacProfileSummary {
  platform: 'macos'
  profilePath: string
  profileLoaded: boolean
  sourceMode: ProfileSourceMode
  error?: string
  wxid?: string
  accountRoot?: string
  dbStoragePath?: string
  cachePath?: string
  decryptedRoot?: string
  readOnly?: boolean
  databaseKeyCount?: number
  accountRootExists?: boolean
  dbStoragePathExists?: boolean
  decryptedRootExists?: boolean
  sqlcipherAvailable?: boolean
}

export interface AppCapabilities {
  platform: string
  mode: 'mac-profile' | 'mac-unconfigured'
  readOnly: boolean
  supportedRoutes: string[]
  sourceMode: ProfileSourceMode
  httpApi: {
    enabled: boolean
    authRequired: true
    defaultPort: number
  }
  messageMutation: boolean
  snsMutation: boolean
  rawSql: boolean
  securityMode: 'strict-local-readonly'
  profile: MacProfileSummary
}
