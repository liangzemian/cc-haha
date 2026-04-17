// desktop/src/components/settings/ClaudeOfficialLogin.tsx
//
// 显示当前 Claude Official OAuth 登录状态,提供 Login / Logout 按钮。
// 点击 Login 调 Tauri shell.open 打开浏览器走 OAuth flow;浏览器回 callback
// 到 haha server 后,store 的 polling 自动刷新 UI 展示"已登录"。

import { useEffect } from 'react'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { useHahaOAuthStore } from '../../stores/hahaOAuthStore'

export function ClaudeOfficialLogin() {
  const { status, isLoading, error, fetchStatus, login, logout, stopPolling } =
    useHahaOAuthStore()

  useEffect(() => {
    fetchStatus()
    return () => stopPolling()
  }, [fetchStatus, stopPolling])

  const handleLogin = async () => {
    try {
      const { authorizeUrl } = await login()
      await shellOpen(authorizeUrl)
    } catch {
      // error 已经在 store 里,不做额外处理
    }
  }

  if (status === null) {
    return (
      <div className="text-xs text-[var(--color-text-tertiary)]">加载中…</div>
    )
  }

  if (status.loggedIn) {
    const subTypeLabel = status.subscriptionType
      ? status.subscriptionType.toUpperCase()
      : '未知'
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-[var(--color-success)]">
          ✓ 已登录(Claude {subTypeLabel})
        </span>
        <button
          type="button"
          onClick={() => logout()}
          disabled={isLoading}
          className="px-3 py-1 text-xs rounded-md border border-[var(--color-border-separator)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 transition-colors"
        >
          {isLoading ? '处理中…' : '登出'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm text-[var(--color-text-secondary)]">
        使用官方 Claude 模型需要登录你的 Claude.ai 账号。点击下方按钮,浏览器会
        打开 Claude 官方登录页面,授权后自动回到这里。
      </div>
      <button
        type="button"
        onClick={handleLogin}
        disabled={isLoading || false}
        className="self-start px-4 py-2 text-sm rounded-md bg-[var(--color-accent,#c96342)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {isLoading ? '正在启动…' : '登录 Claude 账号'}
      </button>
      {error && (
        <div className="text-xs text-[var(--color-error,#dc2626)]">
          错误:{error}
        </div>
      )}
    </div>
  )
}
