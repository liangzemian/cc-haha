import { useState, type ReactNode } from 'react'
import { usePluginStore } from '../../stores/pluginStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { Button } from '../shared/Button'
import type { PluginCapabilityKey } from '../../types/plugin'

const CAPABILITY_ORDER: PluginCapabilityKey[] = [
  'skills',
  'commands',
  'agents',
  'hooks',
  'mcpServers',
  'lspServers',
]

export function PluginDetail() {
  const {
    selectedPlugin,
    isDetailLoading,
    isApplying,
    clearSelection,
    enablePlugin,
    disablePlugin,
    updatePlugin,
    uninstallPlugin,
    reloadPlugins,
  } = usePluginStore()
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const addToast = useUIStore((s) => s.addToast)
  const t = useTranslation()
  const [actionKey, setActionKey] = useState<string | null>(null)

  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined

  if (isDetailLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin w-5 h-5 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!selectedPlugin) return null

  const canMutate = selectedPlugin.scope !== 'managed' && selectedPlugin.scope !== 'builtin'

  const runAction = async (key: string, fn: () => Promise<string>) => {
    setActionKey(key)
    try {
      const message = await fn()
      addToast({ type: 'success', message })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setActionKey(null)
    }
  }

  const handleReload = async () => {
    setActionKey('reload')
    try {
      const summary = await reloadPlugins(currentWorkDir)
      addToast({
        type: summary.errors > 0 ? 'warning' : 'success',
        message: t('settings.plugins.reloadToast', {
          enabled: String(summary.enabled),
          skills: String(summary.skills),
          errors: String(summary.errors),
        }),
      })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setActionKey(null)
    }
  }

  const confirmUninstall = () => {
    const label = t('settings.plugins.confirmUninstall', { name: selectedPlugin.name })
    return window.confirm(label)
  }

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <div>
        <button
          onClick={clearSelection}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          {t('settings.plugins.back')}
        </button>
      </div>

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] overflow-hidden">
        <div className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.9fr)] lg:items-start">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] mb-2">
              {t('settings.plugins.entryEyebrow')}
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h3 className="text-[22px] font-semibold leading-tight text-[var(--color-text-primary)] break-all">
                {selectedPlugin.name}
              </h3>
              <StatusPill enabled={selectedPlugin.enabled} hasErrors={selectedPlugin.hasErrors} />
              <MetaPill>{t(`settings.plugins.scope.${selectedPlugin.scope}`)}</MetaPill>
              <MetaPill>{selectedPlugin.marketplace}</MetaPill>
              {selectedPlugin.version && <MetaPill>v{selectedPlugin.version}</MetaPill>}
            </div>
            <p className="max-w-4xl text-sm leading-6 text-[var(--color-text-secondary)]">
              {selectedPlugin.description || t('settings.plugins.noDescription')}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[var(--color-text-tertiary)]">
              {selectedPlugin.authorName && (
                <span>{t('settings.plugins.author', { value: selectedPlugin.authorName })}</span>
              )}
              {selectedPlugin.projectPath && (
                <span>{t('settings.plugins.projectPath', { value: selectedPlugin.projectPath })}</span>
              )}
              {selectedPlugin.installPath && (
                <span>{t('settings.plugins.installPath', { value: selectedPlugin.installPath })}</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
            <DetailStat
              label={t('settings.plugins.summary.skills')}
              value={String(selectedPlugin.componentCounts.skills)}
              icon="auto_awesome"
            />
            <DetailStat
              label={t('settings.plugins.summary.agents')}
              value={String(selectedPlugin.componentCounts.agents)}
              icon="smart_toy"
            />
            <DetailStat
              label={t('settings.plugins.summary.mcp')}
              value={String(selectedPlugin.componentCounts.mcpServers)}
              icon="hub"
            />
            <DetailStat
              label={t('settings.plugins.summary.hooks')}
              value={String(selectedPlugin.componentCounts.hooks)}
              icon="bolt"
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
        <div className="flex flex-wrap gap-2">
          {canMutate && (
            selectedPlugin.enabled ? (
              <Button
                variant="secondary"
                size="sm"
                loading={isApplying && actionKey === 'disable'}
                onClick={() => void runAction('disable', () => disablePlugin(selectedPlugin.id, selectedPlugin.scope, currentWorkDir))}
              >
                {t('settings.plugins.disable')}
              </Button>
            ) : (
              <Button
                size="sm"
                loading={isApplying && actionKey === 'enable'}
                onClick={() => void runAction('enable', () => enablePlugin(selectedPlugin.id, selectedPlugin.scope, currentWorkDir))}
              >
                {t('settings.plugins.enable')}
              </Button>
            )
          )}

          {canMutate && (
            <Button
              variant="secondary"
              size="sm"
              loading={isApplying && actionKey === 'update'}
              onClick={() => void runAction('update', () => updatePlugin(selectedPlugin.id, selectedPlugin.scope, currentWorkDir))}
            >
              {t('settings.plugins.update')}
            </Button>
          )}

          <Button
            variant="secondary"
            size="sm"
            loading={isApplying && actionKey === 'reload'}
            onClick={() => void handleReload()}
          >
            {t('settings.plugins.apply')}
          </Button>

          {canMutate && (
            <Button
              variant="danger"
              size="sm"
              loading={isApplying && actionKey === 'uninstall'}
              onClick={() => {
                if (!confirmUninstall()) return
                void runAction('uninstall', () => uninstallPlugin(selectedPlugin.id, selectedPlugin.scope, false, currentWorkDir))
              }}
            >
              {t('settings.plugins.uninstall')}
            </Button>
          )}
        </div>

        {!canMutate && (
          <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">
            {selectedPlugin.scope === 'managed'
              ? t('settings.plugins.managedHint')
              : t('settings.plugins.builtinHint')}
          </p>
        )}

        <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">
          {t('settings.plugins.applyHint')}
        </p>
      </section>

      {selectedPlugin.errors.length > 0 && (
        <section className="rounded-2xl border border-[var(--color-error)]/20 bg-[var(--color-error)]/6 px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[18px] text-[var(--color-error)]">
              error
            </span>
            <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t('settings.plugins.errorsTitle')}
            </h4>
          </div>
          <div className="flex flex-col gap-2">
            {selectedPlugin.errors.map((error) => (
              <div
                key={error}
                className="rounded-xl border border-[var(--color-error)]/15 bg-[var(--color-surface)] px-3 py-3 text-sm text-[var(--color-text-secondary)]"
              >
                {error}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
          <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {t('settings.plugins.capabilitiesTitle')}
          </h4>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
            {t('settings.plugins.capabilitiesHint')}
          </p>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
          {CAPABILITY_ORDER.map((key) => {
            const items = selectedPlugin.capabilities[key]
            return (
              <div
                key={key}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {t(`settings.plugins.capabilityLabel.${key}`)}
                  </div>
                  <span className="text-[11px] text-[var(--color-text-tertiary)]">
                    {items.length}
                  </span>
                </div>
                {items.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {items.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)] break-all"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-[var(--color-text-tertiary)]">
                    {t('settings.plugins.capabilityEmpty')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
      {children}
    </span>
  )
}

function DetailStat({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: string
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
        <span className="material-symbols-outlined text-[14px]">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-2 text-base font-semibold text-[var(--color-text-primary)] break-all">
        {value}
      </div>
    </div>
  )
}

function StatusPill({
  enabled,
  hasErrors,
}: {
  enabled: boolean
  hasErrors: boolean
}) {
  const t = useTranslation()
  const classes = hasErrors
    ? 'bg-[var(--color-error)]/12 text-[var(--color-error)]'
    : enabled
      ? 'bg-[var(--color-success-container)] text-[var(--color-success)]'
      : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]'

  const label = hasErrors
    ? t('settings.plugins.status.attention')
    : enabled
      ? t('settings.plugins.status.enabled')
      : t('settings.plugins.status.disabled')

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${classes}`}>
      {label}
    </span>
  )
}
