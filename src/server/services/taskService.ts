/**
 * TaskService — 后台任务的读取与查询
 *
 * 任务信息存储在 ~/.claude/tasks/ 目录下，每个任务一个 JSON 文件。
 * 支持嵌套子目录（例如按 team/project 分组）。
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

export type TaskInfo = {
  id: string
  type: 'local_shell' | 'local_agent' | 'in_process_teammate' | 'remote_agent' | 'workflow'
  status: 'running' | 'completed' | 'failed' | 'pending'
  name?: string
  description?: string
  createdAt?: number
  completedAt?: number
  teamName?: string
  agentName?: string
  metadata?: Record<string, unknown>
}

export class TaskService {
  private getConfigDir(): string {
    return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  }

  private getTasksDir(): string {
    return path.join(this.getConfigDir(), 'tasks')
  }

  /** 列出所有持久化任务 */
  async listTasks(): Promise<TaskInfo[]> {
    const tasksDir = this.getTasksDir()
    try {
      const result: TaskInfo[] = []
      await this.scanTasksRecursive(tasksDir, result)
      return result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    } catch (err: any) {
      if (err.code === 'ENOENT') return []
      throw err
    }
  }

  /** 递归扫描任务目录 */
  private async scanTasksRecursive(dir: string, result: TaskInfo[]): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await this.scanTasksRecursive(fullPath, result)
      } else if (entry.name.endsWith('.json')) {
        try {
          const raw = await fs.readFile(fullPath, 'utf-8')
          const data = JSON.parse(raw)
          const task = this.parseTaskFile(entry.name, data)
          if (task) result.push(task)
        } catch {
          // 跳过无法解析的文件
        }
      }
    }
  }

  /** 解析单个任务文件 */
  private parseTaskFile(filename: string, data: any): TaskInfo | null {
    if (!data || typeof data !== 'object') return null

    const id = filename.replace('.json', '')
    return {
      id: data.id || id,
      type: data.type || 'local_agent',
      status: data.status || 'completed',
      name: data.name || data.title,
      description: data.description || data.prompt,
      createdAt: data.createdAt,
      completedAt: data.completedAt,
      teamName: data.teamName,
      agentName: data.agentName || data.name,
      metadata: data.metadata,
    }
  }

  /** 获取单个任务详情 */
  async getTask(taskId: string): Promise<TaskInfo | null> {
    const tasks = await this.listTasks()
    return tasks.find(t => t.id === taskId) || null
  }
}

export const taskService = new TaskService()
