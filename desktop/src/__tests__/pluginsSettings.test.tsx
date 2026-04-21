import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import { Settings } from '../pages/Settings'
import { usePluginStore } from '../stores/pluginStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useSessionStore } from '../stores/sessionStore'

vi.mock('../api/agents', () => ({
  agentsApi: {
    list: vi.fn().mockResolvedValue({ activeAgents: [], allAgents: [] }),
  },
}))

vi.mock('../stores/providerStore', () => ({
  useProviderStore: () => ({
    providers: [],
    activeId: null,
    isLoading: false,
    fetchProviders: vi.fn(),
    deleteProvider: vi.fn(),
    activateProvider: vi.fn(),
    activateOfficial: vi.fn(),
    testProvider: vi.fn(),
    createProvider: vi.fn(),
    updateProvider: vi.fn(),
    testConfig: vi.fn(),
  }),
}))

vi.mock('../pages/AdapterSettings', () => ({
  AdapterSettings: () => <div>Adapter Settings Mock</div>,
}))

vi.mock('../stores/agentStore', () => ({
  useAgentStore: () => ({
    activeAgents: [],
    allAgents: [],
    isLoading: false,
    error: null,
    selectedAgent: null,
    fetchAgents: vi.fn(),
    selectAgent: vi.fn(),
  }),
}))

vi.mock('../stores/skillStore', () => ({
  useSkillStore: () => ({
    skills: [],
    selectedSkill: null,
    isLoading: false,
    isDetailLoading: false,
    error: null,
    fetchSkills: vi.fn(),
    fetchSkillDetail: vi.fn(),
    clearSelection: vi.fn(),
  }),
}))

const noop = vi.fn()

function switchToPluginsTab() {
  fireEvent.click(screen.getByText('Plugins'))
}

describe('Settings > Plugins tab', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-1',
          title: 'Active session',
          createdAt: '2026-04-20T00:00:00.000Z',
          modifiedAt: '2026-04-20T00:00:00.000Z',
          messageCount: 1,
          projectPath: '/workspace/project',
          workDir: '/workspace/project',
          workDirExists: true,
        },
      ],
      activeSessionId: 'session-1',
      isLoading: false,
      error: null,
    })
    usePluginStore.setState({
      plugins: [],
      marketplaces: [],
      summary: { total: 0, enabled: 0, errorCount: 0, marketplaceCount: 0 },
      selectedPlugin: null,
      lastReloadSummary: null,
      isLoading: false,
      isDetailLoading: false,
      isApplying: false,
      error: null,
      fetchPlugins: noop,
      fetchPluginDetail: noop,
      reloadPlugins: vi.fn().mockResolvedValue({
        enabled: 1,
        disabled: 0,
        skills: 2,
        agents: 1,
        hooks: 0,
        mcpServers: 1,
        lspServers: 0,
        errors: 0,
      }),
      enablePlugin: vi.fn().mockResolvedValue('enabled'),
      disablePlugin: vi.fn().mockResolvedValue('disabled'),
      updatePlugin: vi.fn().mockResolvedValue('updated'),
      uninstallPlugin: vi.fn().mockResolvedValue('uninstalled'),
      clearSelection: vi.fn(),
    })
  })

  it('renders plugin browser summary and grouped cards', () => {
    usePluginStore.setState({
      plugins: [
        {
          id: 'github@claude-plugins-official',
          name: 'github',
          marketplace: 'claude-plugins-official',
          scope: 'user',
          enabled: true,
          hasErrors: false,
          isBuiltin: false,
          version: '1.2.3',
          description: 'GitHub integration',
          authorName: 'Anthropic',
          componentCounts: {
            commands: 1,
            agents: 1,
            skills: 2,
            hooks: 0,
            mcpServers: 1,
            lspServers: 0,
          },
          errors: [],
        },
        {
          id: 'pyright-lsp@claude-plugins-official',
          name: 'pyright-lsp',
          marketplace: 'claude-plugins-official',
          scope: 'project',
          enabled: false,
          hasErrors: true,
          isBuiltin: false,
          description: 'Python language tooling',
          componentCounts: {
            commands: 0,
            agents: 0,
            skills: 0,
            hooks: 0,
            mcpServers: 0,
            lspServers: 1,
          },
          errors: ['Executable not found in $PATH'],
        },
      ],
      marketplaces: [
        {
          name: 'claude-plugins-official',
          source: 'github:anthropics/claude-plugins-official',
          autoUpdate: true,
          installedCount: 2,
        },
      ],
      summary: { total: 2, enabled: 1, errorCount: 1, marketplaceCount: 1 },
    })

    render(<Settings />)
    switchToPluginsTab()

    expect(screen.getByText('Browse installed plugins')).toBeInTheDocument()
    expect(screen.getByText('Plugin Manager')).toBeInTheDocument()
    expect(screen.getAllByText('Needs attention').length).toBeGreaterThan(0)
    expect(screen.getByText('github')).toBeInTheDocument()
    expect(screen.getByText('Python language tooling')).toBeInTheDocument()
    expect(screen.getByText('Known marketplaces')).toBeInTheDocument()
  })

  it('renders plugin detail with bundled capability sections', () => {
    usePluginStore.setState({
      selectedPlugin: {
        id: 'github@claude-plugins-official',
        name: 'github',
        marketplace: 'claude-plugins-official',
        scope: 'user',
        enabled: true,
        hasErrors: false,
        isBuiltin: false,
        version: '1.2.3',
        description: 'GitHub integration',
        authorName: 'Anthropic',
        installPath: '/Users/test/.claude/plugins/cache/github',
        componentCounts: {
          commands: 1,
          agents: 1,
          skills: 2,
          hooks: 1,
          mcpServers: 1,
          lspServers: 0,
        },
        capabilities: {
          commands: ['review-pr'],
          agents: ['pr-reviewer'],
          skills: ['commit', 'create-pr'],
          hooks: ['SessionStart'],
          mcpServers: ['github-api'],
          lspServers: [],
        },
        errors: [],
      },
    })

    render(<Settings />)
    switchToPluginsTab()

    expect(screen.getByText('Plugin Detail')).toBeInTheDocument()
    expect(screen.getByText('GitHub integration')).toBeInTheDocument()
    expect(screen.getByText('Bundled capabilities')).toBeInTheDocument()
    expect(screen.getByText('review-pr')).toBeInTheDocument()
    expect(screen.getByText('Apply changes')).toBeInTheDocument()
    expect(screen.getByText('Uninstall')).toBeInTheDocument()
  })
})
