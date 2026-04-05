/**
 * ConversationService — CLI subprocess manager
 *
 * 每个会话（sessionId）对应一个 CLI 子进程，通过 stdin/stdout
 * 以 stream-json (NDJSON) 格式进行双向通信。
 *
 * 服务器仅做消息转发：
 *   用户 WebSocket → stdin (user message)
 *   stdout (assistant message) → WebSocket
 */

import * as path from 'path'

type SessionProcess = {
  proc: ReturnType<typeof Bun.spawn>
  outputCallbacks: Array<(msg: any) => void>
  workDir: string
}

export class ConversationService {
  private sessions = new Map<string, SessionProcess>()

  /**
   * 启动 CLI 子进程用于对话。
   * 如果该 sessionId 已有活跃进程，直接返回。
   */
  async startSession(sessionId: string, workDir: string): Promise<void> {
    if (this.sessions.has(sessionId)) return

    // 找到 CLI 入口点
    const cliPath = path.resolve(import.meta.dir, '../../entrypoints/cli.tsx')

    const proc = Bun.spawn(
      [
        'bun',
        cliPath,
        '--print',
        '--verbose',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--session-id',
        sessionId,
      ],
      {
        cwd: workDir,
        env: { ...process.env },
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      }
    )

    const session: SessionProcess = {
      proc,
      outputCallbacks: [],
      workDir,
    }
    this.sessions.set(sessionId, session)

    // 读取 stdout（NDJSON 格式，每行一个 JSON 对象）
    this.readOutputStream(sessionId, proc)

    // 读取 stderr 用于调试
    this.readErrorStream(sessionId, proc)

    // 进程退出时清理
    proc.exited.then((code) => {
      console.log(
        `[ConversationService] CLI process for ${sessionId} exited with code ${code}`
      )
      this.sessions.delete(sessionId)
    })

    // 等待一小段时间，检测进程是否立即崩溃退出。
    // 使用 Promise.race 直接竞争 proc.exited，比检查 sessions map 更可靠。
    const STARTUP_GRACE_MS = 1000
    const earlyExitCode = await Promise.race([
      proc.exited,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), STARTUP_GRACE_MS)),
    ])

    if (earlyExitCode !== null) {
      // 进程在启动窗口内退出了，确保清理并抛出错误
      this.sessions.delete(sessionId)
      throw new Error(
        `CLI process for ${sessionId} exited immediately with code ${earlyExitCode}`
      )
    }
  }

  private async readOutputStream(
    sessionId: string,
    proc: ReturnType<typeof Bun.spawn>
  ): Promise<void> {
    if (!proc.stdout) return

    const reader = (proc.stdout as ReadableStream).getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // 保留最后不完整的行

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line)
            const session = this.sessions.get(sessionId)
            if (session) {
              for (const cb of session.outputCallbacks) {
                cb(msg)
              }
            }
          } catch {
            // 非 JSON 行忽略
          }
        }
      }
    } catch (err) {
      console.error(
        `[ConversationService] stdout read error for ${sessionId}:`,
        err
      )
    }
  }

  private async readErrorStream(
    sessionId: string,
    proc: ReturnType<typeof Bun.spawn>
  ): Promise<void> {
    if (!proc.stderr) return

    const reader = (proc.stderr as ReadableStream).getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        if (text.trim()) {
          console.error(`[CLI:${sessionId}] ${text.trim()}`)
        }
      }
    } catch {
      // stderr 读取错误不影响主流程
    }
  }

  /**
   * 注册 stdout 消息回调。CLI 进程每输出一行 JSON，
   * 所有已注册的回调都会被调用。
   */
  onOutput(sessionId: string, callback: (msg: any) => void): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.outputCallbacks.push(callback)
    }
  }

  /**
   * 发送用户消息到 CLI stdin。
   * 消息格式遵循 stream-json 协议。
   */
  sendMessage(sessionId: string, content: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session || !session.proc.stdin) return false

    const msg =
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: content }],
        },
        parent_tool_use_id: null,
        session_id: '',
      }) + '\n'

    session.proc.stdin.write(msg)
    return true
  }

  /**
   * 回复权限请求（用户在 UI 中点击允许/拒绝）。
   */
  respondToPermission(
    sessionId: string,
    requestId: string,
    allowed: boolean
  ): boolean {
    const session = this.sessions.get(sessionId)
    if (!session || !session.proc.stdin) return false

    const response =
      JSON.stringify({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: allowed
            ? { behavior: 'allow' }
            : { behavior: 'deny', message: 'User denied via UI' },
        },
      }) + '\n'

    session.proc.stdin.write(response)
    return true
  }

  /**
   * 发送中断信号，停止当前生成。
   */
  sendInterrupt(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session || !session.proc.stdin) return false

    const request =
      JSON.stringify({
        type: 'control_request',
        request_id: crypto.randomUUID(),
        request: { subtype: 'interrupt' },
      }) + '\n'

    session.proc.stdin.write(request)
    return true
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.proc.kill()
      this.sessions.delete(sessionId)
    }
  }

  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys())
  }
}

// 导出全局单例
export const conversationService = new ConversationService()
