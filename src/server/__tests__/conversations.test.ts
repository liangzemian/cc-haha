/**
 * Tests for ConversationService and WebSocket chat integration
 *
 * ConversationService 管理 CLI 子进程的生命周期。
 * WebSocket 集成测试验证消息从客户端经过服务端到达 CLI 的完整流转。
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ConversationService } from '../services/conversationService.js'

// ============================================================================
// ConversationService unit tests
// ============================================================================

describe('ConversationService', () => {
  it('should report no session for unknown ID', () => {
    const svc = new ConversationService()
    const sid = crypto.randomUUID()
    expect(svc.hasSession(sid)).toBe(false)
  })

  it('should track active sessions as empty initially', () => {
    const svc = new ConversationService()
    expect(svc.getActiveSessions()).toEqual([])
  })

  it('should return false when sending message to non-existent session', () => {
    const svc = new ConversationService()
    const result = svc.sendMessage('no-such-session', 'hello')
    expect(result).toBe(false)
  })

  it('should return false when responding to permission for non-existent session', () => {
    const svc = new ConversationService()
    const result = svc.respondToPermission('no-such-session', 'req-1', true)
    expect(result).toBe(false)
  })

  it('should return false when sending interrupt to non-existent session', () => {
    const svc = new ConversationService()
    const result = svc.sendInterrupt('no-such-session')
    expect(result).toBe(false)
  })

  it('should not throw when stopping non-existent session', () => {
    const svc = new ConversationService()
    expect(() => svc.stopSession('no-such-session')).not.toThrow()
  })

  it('should not throw when registering callback for non-existent session', () => {
    const svc = new ConversationService()
    expect(() => svc.onOutput('no-such-session', () => {})).not.toThrow()
  })
})

// ============================================================================
// WebSocket integration tests (with real server, CLI falls back to echo)
// ============================================================================

describe('WebSocket Chat Integration', () => {
  let server: ReturnType<typeof Bun.serve>
  let baseUrl: string
  let wsUrl: string
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-conv-'))
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    await fs.mkdir(path.join(tmpDir, 'projects'), { recursive: true })

    const port = 15000 + Math.floor(Math.random() * 1000)
    const { startServer } = await import('../index.js')
    server = startServer(port, '127.0.0.1')
    baseUrl = `http://127.0.0.1:${port}`
    wsUrl = `ws://127.0.0.1:${port}`
  })

  afterAll(async () => {
    server?.stop()
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
    delete process.env.CLAUDE_CONFIG_DIR
  })

  it('should connect and receive connected event', async () => {
    const messages: any[] = []
    const ws = new WebSocket(`${wsUrl}/ws/chat-test-1`)

    await new Promise<void>((resolve) => {
      ws.onmessage = (e) => {
        messages.push(JSON.parse(e.data as string))
        if (messages.length >= 1) {
          ws.close()
          resolve()
        }
      }
      ws.onerror = () => {
        ws.close()
        resolve()
      }
      setTimeout(() => {
        ws.close()
        resolve()
      }, 3000)
    })

    expect(messages[0].type).toBe('connected')
    expect(messages[0].sessionId).toBe('chat-test-1')
  })

  it('should handle stop_generation and return idle status', async () => {
    const messages: any[] = []
    const ws = new WebSocket(`${wsUrl}/ws/chat-test-2`)

    await new Promise<void>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string)
        messages.push(msg)
        if (msg.type === 'connected') {
          ws.send(JSON.stringify({ type: 'stop_generation' }))
        }
        if (msg.type === 'status' && msg.state === 'idle') {
          ws.close()
          resolve()
        }
      }
      ws.onerror = () => {
        ws.close()
        resolve()
      }
      setTimeout(() => {
        ws.close()
        resolve()
      }, 3000)
    })

    expect(messages.some((m) => m.type === 'status' && m.state === 'idle')).toBe(true)
  })

  it('should send user_message and receive fallback echo response', async () => {
    const messages: any[] = []
    const ws = new WebSocket(`${wsUrl}/ws/chat-test-3`)

    await new Promise<void>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string)
        messages.push(msg)
        if (msg.type === 'connected') {
          ws.send(
            JSON.stringify({ type: 'user_message', content: 'Hello from test' })
          )
        }
        // Wait until we receive idle status after the echo
        if (
          msg.type === 'status' &&
          msg.state === 'idle' &&
          messages.length > 3
        ) {
          ws.close()
          resolve()
        }
      }
      ws.onerror = () => {
        ws.close()
        resolve()
      }
      setTimeout(() => {
        ws.close()
        resolve()
      }, 5000)
    })

    const types = messages.map((m) => m.type)
    expect(types).toContain('connected')
    expect(types).toContain('status')
    // Fallback echo produces content_start, content_delta, message_complete, status
    expect(types).toContain('content_start')
    expect(types).toContain('content_delta')
    expect(types).toContain('message_complete')

    // Verify thinking was first status
    const statusMsgs = messages.filter((m) => m.type === 'status')
    expect(statusMsgs[0].state).toBe('thinking')
  })

  it('should handle permission_response without error', async () => {
    const messages: any[] = []
    const ws = new WebSocket(`${wsUrl}/ws/chat-test-4`)

    await new Promise<void>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string)
        messages.push(msg)
        if (msg.type === 'connected') {
          // Send a permission response (no active session, should not crash)
          ws.send(
            JSON.stringify({
              type: 'permission_response',
              requestId: 'test-req-1',
              allowed: true,
            })
          )
          // Give a moment then close
          setTimeout(() => {
            ws.close()
            resolve()
          }, 500)
        }
      }
      ws.onerror = () => {
        ws.close()
        resolve()
      }
      setTimeout(() => {
        ws.close()
        resolve()
      }, 3000)
    })

    // Should have received connected and no error
    expect(messages[0].type).toBe('connected')
    expect(messages.some((m) => m.type === 'error')).toBe(false)
  })

  it('should handle ping/pong', async () => {
    const messages: any[] = []
    const ws = new WebSocket(`${wsUrl}/ws/chat-test-5`)

    await new Promise<void>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string)
        messages.push(msg)
        if (msg.type === 'connected') {
          ws.send(JSON.stringify({ type: 'ping' }))
        }
        if (msg.type === 'pong') {
          ws.close()
          resolve()
        }
      }
      ws.onerror = () => {
        ws.close()
        resolve()
      }
      setTimeout(() => {
        ws.close()
        resolve()
      }, 3000)
    })

    expect(messages.some((m) => m.type === 'pong')).toBe(true)
  })
})
