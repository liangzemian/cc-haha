export type PluginScope = 'user' | 'project' | 'local' | 'managed' | 'builtin'

export type PluginCapabilityKey =
  | 'commands'
  | 'agents'
  | 'skills'
  | 'hooks'
  | 'mcpServers'
  | 'lspServers'

export type PluginCapabilities = Record<PluginCapabilityKey, string[]>

export type PluginComponentCounts = Record<PluginCapabilityKey, number>

export type PluginSummary = {
  id: string
  name: string
  marketplace: string
  scope: PluginScope
  enabled: boolean
  hasErrors: boolean
  isBuiltin: boolean
  version?: string
  description?: string
  authorName?: string
  installPath?: string
  projectPath?: string
  componentCounts: PluginComponentCounts
  errors: string[]
}

export type PluginDetail = PluginSummary & {
  capabilities: PluginCapabilities
}

export type PluginMarketplaceSummary = {
  name: string
  source: string
  lastUpdated?: string
  autoUpdate: boolean
  installedCount: number
}

export type PluginListResponse = {
  plugins: PluginSummary[]
  marketplaces: PluginMarketplaceSummary[]
  summary: {
    total: number
    enabled: number
    errorCount: number
    marketplaceCount: number
  }
}

export type PluginReloadSummary = {
  enabled: number
  disabled: number
  skills: number
  agents: number
  hooks: number
  mcpServers: number
  lspServers: number
  errors: number
}
