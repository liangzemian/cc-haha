import { sep } from 'node:path'
import { getBuiltinPluginDefinition } from '../../plugins/builtinPlugins.js'
import {
  disablePluginOp,
  enablePluginOp,
  type InstallableScope,
  uninstallPluginOp,
  updatePluginOp,
} from '../../services/plugins/pluginOperations.js'
import { getAgentDefinitionsWithOverrides } from '../../tools/AgentTool/loadAgentsDir.js'
import type { LoadedPlugin, PluginError } from '../../types/plugin.js'
import { getPluginErrorMessage } from '../../types/plugin.js'
import { clearAllCaches } from '../../utils/plugins/cacheUtils.js'
import {
  getMarketplaceSourceDisplay,
} from '../../utils/plugins/marketplaceHelpers.js'
import { loadInstalledPluginsV2 } from '../../utils/plugins/installedPluginsManager.js'
import {
  loadKnownMarketplacesConfig,
} from '../../utils/plugins/marketplaceManager.js'
import { loadPluginLspServers } from '../../utils/plugins/lspPluginIntegration.js'
import { loadPluginMcpServers } from '../../utils/plugins/mcpPluginIntegration.js'
import { parsePluginIdentifier } from '../../utils/plugins/pluginIdentifier.js'
import { loadAllPlugins } from '../../utils/plugins/pluginLoader.js'
import { loadPluginHooks } from '../../utils/plugins/loadPluginHooks.js'
import { getPluginCommands } from '../../utils/plugins/loadPluginCommands.js'
import { clearPluginCacheExclusions } from '../../utils/plugins/orphanedPluginFilter.js'
import type {
  PluginInstallationEntry,
  PluginScope,
} from '../../utils/plugins/schemas.js'
import { ApiError } from '../middleware/errorHandler.js'

export type ApiPluginCapabilitySet = {
  commands: string[]
  agents: string[]
  skills: string[]
  hooks: string[]
  mcpServers: string[]
  lspServers: string[]
}

export type ApiPluginSummary = {
  id: string
  name: string
  marketplace: string
  scope: PluginScope | 'builtin'
  enabled: boolean
  hasErrors: boolean
  isBuiltin: boolean
  version?: string
  description?: string
  authorName?: string
  installPath?: string
  projectPath?: string
  componentCounts: Record<keyof ApiPluginCapabilitySet, number>
  errors: string[]
}

export type ApiPluginDetail = ApiPluginSummary & {
  capabilities: ApiPluginCapabilitySet
}

export type ApiPluginMarketplaceSummary = {
  name: string
  source: string
  lastUpdated?: string
  autoUpdate: boolean
  installedCount: number
}

export type ApiPluginListResponse = {
  plugins: ApiPluginSummary[]
  marketplaces: ApiPluginMarketplaceSummary[]
  summary: {
    total: number
    enabled: number
    errorCount: number
    marketplaceCount: number
  }
}

export type ApiPluginActionResponse = {
  ok: true
  message: string
}

export type ApiPluginReloadResponse = {
  ok: true
  summary: {
    enabled: number
    disabled: number
    skills: number
    agents: number
    hooks: number
    mcpServers: number
    lspServers: number
    errors: number
  }
}

type HydratedPluginState = {
  enabled: LoadedPlugin[]
  disabled: LoadedPlugin[]
  errors: PluginError[]
}

export class PluginService {
  async listPlugins(cwd?: string): Promise<ApiPluginListResponse> {
    const { plugins, marketplaces } = await this.collectPluginState(cwd)
    return {
      plugins,
      marketplaces,
      summary: {
        total: plugins.length,
        enabled: plugins.filter((plugin) => plugin.enabled).length,
        errorCount: plugins.reduce((sum, plugin) => sum + plugin.errors.length, 0),
        marketplaceCount: marketplaces.length,
      },
    }
  }

  async getPluginDetail(
    pluginId: string,
    cwd?: string,
  ): Promise<ApiPluginDetail> {
    const { plugins, detailById } = await this.collectPluginState(cwd)
    const detail = detailById.get(pluginId)

    if (!detail) {
      throw ApiError.notFound(`Plugin not found: ${pluginId}`)
    }

    return detail
  }

  async enablePlugin(
    pluginId: string,
    scope?: InstallableScope,
  ): Promise<ApiPluginActionResponse> {
    const result = await enablePluginOp(pluginId, scope)
    if (!result.success) {
      throw ApiError.badRequest(result.message)
    }
    return { ok: true, message: result.message }
  }

  async disablePlugin(
    pluginId: string,
    scope?: InstallableScope,
  ): Promise<ApiPluginActionResponse> {
    const result = await disablePluginOp(pluginId, scope)
    if (!result.success) {
      throw ApiError.badRequest(result.message)
    }
    return { ok: true, message: result.message }
  }

  async uninstallPlugin(
    pluginId: string,
    scope?: InstallableScope,
    keepData = false,
  ): Promise<ApiPluginActionResponse> {
    if (!scope) {
      throw ApiError.badRequest('Plugin uninstall requires a scope')
    }

    const result = await uninstallPluginOp(pluginId, scope, keepData)
    if (!result.success) {
      throw ApiError.badRequest(result.message)
    }
    return { ok: true, message: result.message }
  }

  async updatePlugin(
    pluginId: string,
    scope?: PluginScope,
  ): Promise<ApiPluginActionResponse> {
    if (!scope) {
      throw ApiError.badRequest('Plugin update requires a scope')
    }

    const result = await updatePluginOp(pluginId, scope)
    if (!result.success) {
      throw ApiError.badRequest(result.message)
    }
    return { ok: true, message: result.message }
  }

  async reloadPlugins(cwd?: string): Promise<ApiPluginReloadResponse> {
    clearAllCaches()
    clearPluginCacheExclusions()

    const pluginState = await this.loadPluginState()
    const { enabled, disabled, errors } = pluginState

    const [commands, agentDefinitions] = await Promise.all([
      getPluginCommands(),
      getAgentDefinitionsWithOverrides(cwd),
    ])

    const hookCount = await this.getHookCount(enabled)
    const mcpCounts = await Promise.all(
      enabled.map(async (plugin) => {
        const servers = plugin.mcpServers || await loadPluginMcpServers(plugin, errors)
        return servers ? Object.keys(servers).length : 0
      }),
    )
    const lspCounts = await Promise.all(
      enabled.map(async (plugin) => {
        const servers = plugin.lspServers || await loadPluginLspServers(plugin, errors)
        return servers ? Object.keys(servers).length : 0
      }),
    )

    return {
      ok: true,
      summary: {
        enabled: enabled.length,
        disabled: disabled.length,
        skills: commands.length,
        agents: agentDefinitions.allAgents.length,
        hooks: hookCount,
        mcpServers: mcpCounts.reduce((sum, count) => sum + count, 0),
        lspServers: lspCounts.reduce((sum, count) => sum + count, 0),
        errors: errors.length,
      },
    }
  }

  private async collectPluginState(cwd?: string): Promise<{
    plugins: ApiPluginSummary[]
    detailById: Map<string, ApiPluginDetail>
    marketplaces: ApiPluginMarketplaceSummary[]
  }> {
    const [pluginState, installedData, marketplaceConfig] = await Promise.all([
      this.loadPluginState(),
      Promise.resolve(loadInstalledPluginsV2()),
      loadKnownMarketplacesConfig(),
    ])

    const allLoaded = [...pluginState.enabled, ...pluginState.disabled]
    const loadedById = new Map(
      allLoaded
        .filter((plugin) => !plugin.source.endsWith('@inline'))
        .map((plugin) => [plugin.source, plugin]),
    )

    const pluginIds = new Set<string>([
      ...Object.keys(installedData.plugins),
      ...allLoaded
        .filter((plugin) => !plugin.source.endsWith('@inline'))
        .map((plugin) => plugin.source),
    ])

    const detailById = new Map<string, ApiPluginDetail>()

    for (const pluginId of [...pluginIds].sort()) {
      const installation = this.pickInstallation(
        installedData.plugins[pluginId] ?? [],
        cwd,
      )
      const loaded = loadedById.get(pluginId)
      const detail = await this.serializePluginDetail(
        pluginId,
        installation,
        loaded,
        pluginState.errors,
      )
      detailById.set(pluginId, detail)
    }

    const plugins = [...detailById.values()].map((detail) =>
      this.toSummary(detail),
    )

    const marketplaces = Object.entries(marketplaceConfig.marketplaces ?? {})
      .map(([name, entry]) => ({
        name,
        source: getMarketplaceSourceDisplay(entry.source),
        lastUpdated: entry.lastUpdated,
        autoUpdate: entry.autoUpdate !== false,
        installedCount: plugins.filter((plugin) => plugin.marketplace === name).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return { plugins, detailById, marketplaces }
  }

  private async loadPluginState(): Promise<HydratedPluginState> {
    const result = await loadAllPlugins()
    await Promise.all(
      result.enabled.map(async (plugin) => {
        plugin.mcpServers = plugin.mcpServers || await loadPluginMcpServers(plugin, result.errors)
        plugin.lspServers = plugin.lspServers || await loadPluginLspServers(plugin, result.errors)
      }),
    )
    return result
  }

  private async serializePluginDetail(
    pluginId: string,
    installation: PluginInstallationEntry | null,
    loaded: LoadedPlugin | undefined,
    errors: PluginError[],
  ): Promise<ApiPluginDetail> {
    const { name, marketplace } = parsePluginIdentifier(pluginId)
    const pluginErrors = this.getErrorsForPlugin(pluginId, name, errors)

    if (!loaded) {
      return {
        id: pluginId,
        name,
        marketplace: marketplace || 'unknown',
        scope: installation?.scope ?? 'user',
        enabled: false,
        hasErrors: pluginErrors.length > 0,
        isBuiltin: false,
        installPath: installation?.installPath,
        projectPath: installation?.projectPath,
        errors: pluginErrors,
        componentCounts: this.countCapabilities(this.emptyCapabilities()),
        capabilities: this.emptyCapabilities(),
      }
    }

    const capabilities = await this.collectCapabilities(loaded)
    return {
      id: pluginId,
      name: loaded.name,
      marketplace: marketplace || 'unknown',
      scope: installation?.scope ?? 'user',
      enabled: loaded.enabled !== false,
      hasErrors: pluginErrors.length > 0,
      isBuiltin: Boolean(loaded.isBuiltin),
      version: loaded.manifest.version,
      description: loaded.manifest.description,
      authorName: loaded.manifest.author?.name,
      installPath: installation?.installPath,
      projectPath: installation?.projectPath,
      errors: pluginErrors,
      componentCounts: this.countCapabilities(capabilities),
      capabilities,
    }
  }

  private async collectCapabilities(
    plugin: LoadedPlugin,
  ): Promise<ApiPluginCapabilitySet> {
    if (plugin.isBuiltin) {
      const definition = getBuiltinPluginDefinition(plugin.name)
      return {
        commands: [],
        agents: [],
        skills: definition?.skills?.map((skill) => skill.name) ?? [],
        hooks: definition?.hooks ? Object.keys(definition.hooks) : [],
        mcpServers: definition?.mcpServers ? Object.keys(definition.mcpServers) : [],
        lspServers: [],
      }
    }

    return {
      commands: await this.collectMarkdownEntries([
        plugin.commandsPath,
        ...(plugin.commandsPaths ?? []),
      ]),
      agents: await this.collectMarkdownEntries([
        plugin.agentsPath,
        ...(plugin.agentsPaths ?? []),
      ]),
      skills: await this.collectSkillDirs([
        plugin.skillsPath,
        ...(plugin.skillsPaths ?? []),
      ]),
      hooks: plugin.hooksConfig ? Object.keys(plugin.hooksConfig) : [],
      mcpServers: plugin.mcpServers ? Object.keys(plugin.mcpServers) : [],
      lspServers: plugin.lspServers ? Object.keys(plugin.lspServers) : [],
    }
  }

  private async collectMarkdownEntries(paths: Array<string | undefined>): Promise<string[]> {
    const fs = await import('node:fs/promises')
    const names = new Set<string>()

    for (const dirPath of paths) {
      if (!dirPath) continue

      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue
          names.add(entry.name.replace(/\.md$/i, ''))
        }
      } catch {
        // Ignore unreadable plugin component directories and keep rendering.
      }
    }

    return [...names].sort()
  }

  private async collectSkillDirs(paths: Array<string | undefined>): Promise<string[]> {
    const fs = await import('node:fs/promises')
    const names = new Set<string>()

    for (const dirPath of paths) {
      if (!dirPath) continue

      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue

          try {
            const stat = await fs.stat(`${dirPath}/${entry.name}/SKILL.md`)
            if (stat.isFile()) {
              names.add(entry.name)
            }
          } catch {
            // Ignore non-skill directories.
          }
        }
      } catch {
        // Ignore unreadable plugin component directories and keep rendering.
      }
    }

    return [...names].sort()
  }

  private getErrorsForPlugin(
    pluginId: string,
    pluginName: string,
    errors: PluginError[],
  ): string[] {
    return errors
      .filter((error) => {
        if (error.source === pluginId) return true
        if ('plugin' in error && error.plugin === pluginName) return true
        return error.source.startsWith(`${pluginName}@`)
      })
      .map(getPluginErrorMessage)
  }

  private pickInstallation(
    installations: PluginInstallationEntry[],
    cwd?: string,
  ): PluginInstallationEntry | null {
    if (!installations.length) return null

    const relevantForCwd = cwd
      ? installations.filter((entry) =>
          entry.projectPath ? this.isPathWithinProject(cwd, entry.projectPath) : false,
        )
      : []

    const localMatch = relevantForCwd.find((entry) => entry.scope === 'local')
    if (localMatch) return localMatch

    const projectMatch = relevantForCwd.find((entry) => entry.scope === 'project')
    if (projectMatch) return projectMatch

    const userMatch = installations.find((entry) => entry.scope === 'user')
    if (userMatch) return userMatch

    return installations[0] ?? null
  }

  private isPathWithinProject(cwd: string, projectPath: string): boolean {
    return cwd === projectPath || cwd.startsWith(`${projectPath}${sep}`)
  }

  private emptyCapabilities(): ApiPluginCapabilitySet {
    return {
      commands: [],
      agents: [],
      skills: [],
      hooks: [],
      mcpServers: [],
      lspServers: [],
    }
  }

  private countCapabilities(
    capabilities: ApiPluginCapabilitySet,
  ): Record<keyof ApiPluginCapabilitySet, number> {
    return {
      commands: capabilities.commands.length,
      agents: capabilities.agents.length,
      skills: capabilities.skills.length,
      hooks: capabilities.hooks.length,
      mcpServers: capabilities.mcpServers.length,
      lspServers: capabilities.lspServers.length,
    }
  }

  private toSummary(detail: ApiPluginDetail): ApiPluginSummary {
    return {
      id: detail.id,
      name: detail.name,
      marketplace: detail.marketplace,
      scope: detail.scope,
      enabled: detail.enabled,
      hasErrors: detail.hasErrors,
      isBuiltin: detail.isBuiltin,
      version: detail.version,
      description: detail.description,
      authorName: detail.authorName,
      installPath: detail.installPath,
      projectPath: detail.projectPath,
      componentCounts: detail.componentCounts,
      errors: detail.errors,
    }
  }

  private async getHookCount(plugins: LoadedPlugin[]): Promise<number> {
    try {
      await loadPluginHooks()
    } catch {
      // Hook loading failures are already represented in the shared plugin errors.
    }

    return plugins.reduce((sum, plugin) => {
      if (!plugin.hooksConfig) return sum
      return sum + Object.values(plugin.hooksConfig).reduce((hookSum, matchers) => (
        hookSum + (matchers?.reduce((matcherSum, matcher) => matcherSum + matcher.hooks.length, 0) ?? 0)
      ), 0)
    }, 0)
  }
}
