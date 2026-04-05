/**
 * WebSocket connection handler
 *
 * 管理 WebSocket 连接生命周期，处理消息路由。
 * 用户消息通过 CLI 子进程（stream-json 模式）处理，
 * CLI stdout 消息被转换为 ServerMessage 并转发到 WebSocket。
 */

import type { ServerWebSocket } from 'bun'
import type { ClientMessage, ServerMessage, WebSocketSession } from './events.js'
import { conversationService } from '../services/conversationService.js'

export type WebSocketData = {
  sessionId: string
  connectedAt: number
}

// Active WebSocket sessions
const activeSessions = new Map<string, ServerWebSocket<WebSocketData>>()

export const handleWebSocket = {
  open(ws: ServerWebSocket<WebSocketData>) {
    const { sessionId } = ws.data
    console.log(`[WS] Client connected for session: ${sessionId}`)

    activeSessions.set(sessionId, ws)

    const msg: ServerMessage = { type: 'connected', sessionId }
    ws.send(JSON.stringify(msg))
  },

  message(ws: ServerWebSocket<WebSocketData>, rawMessage: string | Buffer) {
    try {
      const message = JSON.parse(
        typeof rawMessage === 'string' ? rawMessage : rawMessage.toString()
      ) as ClientMessage

      switch (message.type) {
        case 'user_message':
          handleUserMessage(ws, message).catch((err) => {
            console.error(`[WS] Unhandled error in handleUserMessage:`, err)
          })
          break

        case 'permission_response':
          handlePermissionResponse(ws, message)
          break

        case 'stop_generation':
          handleStopGeneration(ws)
          break

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' } satisfies ServerMessage))
          break

        default:
          sendError(ws, `Unknown message type: ${(message as any).type}`, 'UNKNOWN_TYPE')
      }
    } catch (error) {
      sendError(ws, `Invalid message format: ${error}`, 'PARSE_ERROR')
    }
  },

  close(ws: ServerWebSocket<WebSocketData>, code: number, reason: string) {
    const { sessionId } = ws.data
    console.log(`[WS] Client disconnected from session: ${sessionId} (${code}: ${reason})`)
    activeSessions.delete(sessionId)

    // 断开连接时停止对应的 CLI 子进程
    if (conversationService.hasSession(sessionId)) {
      conversationService.stopSession(sessionId)
    }
  },

  drain(ws: ServerWebSocket<WebSocketData>) {
    // Backpressure handling - called when the socket is ready to receive more data
  },
}

// ============================================================================
// Message handlers
// ============================================================================

async function handleUserMessage(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'user_message' }>
) {
  const { sessionId } = ws.data

  // Send thinking status
  sendMessage(ws, { type: 'status', state: 'thinking', verb: 'Thinking' })

  // 启动 CLI 子进程（如果还没有）
  if (!conversationService.hasSession(sessionId)) {
    try {
      const workDir = process.cwd()
      await conversationService.startSession(sessionId, workDir)

      // 注册 CLI stdout → WebSocket 转发
      conversationService.onOutput(sessionId, (cliMsg) => {
        const serverMsg = translateCliMessage(cliMsg)
        if (serverMsg) {
          sendMessage(ws, serverMsg)
        }
      })
    } catch (err) {
      console.error(`[WS] CLI start failed for ${sessionId}, falling back to echo`)
      // CLI 启动失败时回退到 echo 模式，保证基本可用性
      sendFallbackEcho(ws, sessionId, message.content)
      return
    }
  }

  // 将用户消息写入 CLI stdin
  const sent = conversationService.sendMessage(sessionId, message.content)
  if (!sent) {
    // 消息发送失败（进程可能已退出），回退到 echo 模式
    sendFallbackEcho(ws, sessionId, message.content)
  }
}

function handlePermissionResponse(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'permission_response' }>
) {
  const { sessionId } = ws.data
  conversationService.respondToPermission(sessionId, message.requestId, message.allowed)
  console.log(`[WS] Permission response for ${message.requestId}: ${message.allowed}`)
}

function handleStopGeneration(ws: ServerWebSocket<WebSocketData>) {
  const { sessionId } = ws.data
  console.log(`[WS] Stop generation requested for session: ${sessionId}`)

  // 向 CLI 子进程发送中断信号
  if (conversationService.hasSession(sessionId)) {
    conversationService.sendInterrupt(sessionId)
  }

  sendMessage(ws, { type: 'status', state: 'idle' })
}

// ============================================================================
// CLI message translation
// ============================================================================

/**
 * 将 CLI stdout 的 stream-json 消息转换为 WebSocket ServerMessage。
 *
 * CLI 输出格式参考 src/bridge/sessionRunner.ts 中的 stream-json 协议。
 */
function translateCliMessage(cliMsg: any): ServerMessage | null {
  switch (cliMsg.type) {
    case 'assistant': {
      // 助手消息 - 提取文本内容
      if (cliMsg.message?.content) {
        const content = cliMsg.message.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') {
              return { type: 'content_delta', text: block.text }
            }
          }
        }
      }
      return null
    }

    case 'control_request': {
      // 权限请求 — CLI 需要用户授权才能执行工具
      if (cliMsg.request?.subtype === 'can_use_tool') {
        return {
          type: 'permission_request',
          requestId: cliMsg.request_id,
          toolName: cliMsg.request.tool_name || 'Unknown',
          input: cliMsg.request.input || {},
          description: cliMsg.request.description,
        }
      }
      return null
    }

    case 'result': {
      // 对话完成
      if (cliMsg.subtype === 'success') {
        return {
          type: 'message_complete',
          usage: {
            input_tokens: cliMsg.usage?.input_tokens || 0,
            output_tokens: cliMsg.usage?.output_tokens || 0,
          },
        }
      }
      return null
    }

    case 'system':
      return { type: 'status', state: 'idle' }

    default:
      return null
  }
}

// ============================================================================
// Fallback echo (for when CLI is not available)
// ============================================================================

/**
 * 当 CLI 子进程启动失败或不可用时，使用 echo 模式作为回退。
 * 保证 WebSocket 客户端始终能收到完整的消息流转。
 */
function sendFallbackEcho(
  ws: ServerWebSocket<WebSocketData>,
  sessionId: string,
  content: string
) {
  sendMessage(ws, { type: 'content_start', blockType: 'text' })
  sendMessage(ws, {
    type: 'content_delta',
    text: `[Server] Received message for session ${sessionId}: "${content}". Chat integration pending.`,
  })
  sendMessage(ws, {
    type: 'message_complete',
    usage: { input_tokens: 0, output_tokens: 0 },
  })
  sendMessage(ws, { type: 'status', state: 'idle' })
}

// ============================================================================
// Helpers
// ============================================================================

function sendMessage(ws: ServerWebSocket<WebSocketData>, message: ServerMessage) {
  ws.send(JSON.stringify(message))
}

function sendError(ws: ServerWebSocket<WebSocketData>, message: string, code: string) {
  sendMessage(ws, { type: 'error', message, code })
}

/**
 * Send a message to a specific session's WebSocket (for use by services)
 */
export function sendToSession(sessionId: string, message: ServerMessage): boolean {
  const ws = activeSessions.get(sessionId)
  if (!ws) return false
  ws.send(JSON.stringify(message))
  return true
}

export function getActiveSessionIds(): string[] {
  return Array.from(activeSessions.keys())
}
