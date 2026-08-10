import { buildApiUrl } from '@/api/http'
import { getAuthHeaders } from '@/api/auth'

export interface AgentSession {
  session_id: string
  title: string
  status: string
  active_run_id: string | null
  summary?: string | null
  created_at: string
  updated_at: string
}

export interface AgentMessage {
  message_id: string
  sequence: number
  role: 'user' | 'assistant' | 'tool'
  content: { text?: string; [key: string]: unknown }
  created_at: string
}

export interface AgentAsset {
  task_type: string
  task_id: string
  asset_id: string
  content_type?: string
  filename?: string
  download_url?: string
}

export interface AgentEvent {
  id: number
  type: string
  data: Record<string, any>
}

export interface AgentAttachment {
  attachment_id: string
  filename: string
  content_type: string
  content_url: string
}

export interface AgentCanvas {
  nodes: Array<{ id: string; type: 'text' | 'image' | 'video'; data: Record<string, any> }>
  edges: Array<Record<string, any>>
  revision: number
  updated_at: string
}

export interface AgentCanvasRevision {
  revision: number
  mutation_id: string | null
  created_at: string
}

export class AgentApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail: unknown,
  ) {
    super(message)
  }
}

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    headers: {
      ...getAuthHeaders(),
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const detail = body.detail ?? body.error
    const message = typeof detail === 'string'
      ? detail
      : `请求失败 (${response.status})`
    throw new AgentApiError(message, response.status, detail)
  }
  return response.status === 204 ? undefined as T : response.json()
}

export const createAgentSession = (title = '未命名创作') => request<AgentSession>(
  '/api/agent/sessions',
  { method: 'POST', body: JSON.stringify({ title }) },
)

export const listAgentSessions = () => request<{ items: AgentSession[] }>(
  '/api/agent/sessions?limit=100',
)

export const getAgentSession = (sessionId: string) => request<AgentSession>(
  `/api/agent/sessions/${encodeURIComponent(sessionId)}`,
)

export const renameAgentSession = (sessionId: string, title: string) => request<AgentSession>(
  `/api/agent/sessions/${encodeURIComponent(sessionId)}`,
  { method: 'PATCH', body: JSON.stringify({ title }) },
)

export const deleteAgentSession = (sessionId: string) => request<void>(
  `/api/agent/sessions/${encodeURIComponent(sessionId)}`,
  { method: 'DELETE' },
)

export const getAgentCanvas = (sessionId: string) => request<AgentCanvas>(
  `/api/agent/sessions/${encodeURIComponent(sessionId)}/canvas`,
)

export const putAgentCanvas = (
  sessionId: string,
  canvas: { nodes: unknown[]; edges: unknown[]; base_revision: number; mutation_id: string },
) => request<AgentCanvas>(
  `/api/agent/sessions/${encodeURIComponent(sessionId)}/canvas`,
  { method: 'PUT', body: JSON.stringify(canvas) },
)

export const listAgentCanvasRevisions = (sessionId: string) => request<{ items: AgentCanvasRevision[] }>(
  `/api/agent/sessions/${encodeURIComponent(sessionId)}/canvas/revisions`,
)

export const getAgentCanvasRevision = (sessionId: string, revision: number) => request<AgentCanvas>(
  `/api/agent/sessions/${encodeURIComponent(sessionId)}/canvas/revisions/${revision}`,
)

export const listAgentMessages = (sessionId: string) => request<{ items: AgentMessage[] }>(
  `/api/agent/sessions/${encodeURIComponent(sessionId)}/messages?limit=100`,
)

export const submitAgentMessage = (
  sessionId: string,
  content: Record<string, unknown>,
  modelId?: string,
) => request<{ run_id: string; message_id: string; status: string }>(
  `/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`,
  {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ model_id: modelId || undefined, content }),
  },
)

export const resumeAgentRun = (
  runId: string,
  decision: 'approve' | 'reject' | 'modify',
  modifiedArguments?: Record<string, unknown>,
) => request(
  `/api/agent/runs/${encodeURIComponent(runId)}/resume`,
  {
    method: 'POST',
    body: JSON.stringify({ decision, modified_arguments: modifiedArguments }),
  },
)

export const cancelAgentRun = (runId: string) => request(
  `/api/agent/runs/${encodeURIComponent(runId)}/cancel`,
  { method: 'POST' },
)

export const uploadAgentAttachment = async (sessionId: string, file: File) => {
  const body = new FormData()
  body.append('files', file)
  const response = await request<{ items: AgentAttachment[] }>(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/attachments`,
    { method: 'POST', body },
  )
  return response.items[0]
}

export const deleteAgentAttachment = (sessionId: string, attachmentId: string) => request<void>(
  `/api/agent/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}`,
  { method: 'DELETE' },
)

export const assetUrl = (asset: Pick<AgentAsset, 'task_type' | 'task_id' | 'asset_id' | 'download_url'>) => buildApiUrl(
  asset.download_url || `/api/tasks/${encodeURIComponent(asset.task_type)}/${encodeURIComponent(asset.task_id)}/assets?asset_id=${encodeURIComponent(asset.asset_id)}`,
)

// <img>/<video> cannot attach the Bearer header; load protected media as a blob URL.
export const loadMediaPreview = async (url: string) => {
  const value = String(url || '').trim()
  if (!value || /^(blob|data):/i.test(value) || !/\/api\//i.test(value)) return value
  const response = await fetch(buildApiUrl(value), {
    headers: getAuthHeaders(),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`读取媒体失败 (${response.status})`)
  return URL.createObjectURL(await response.blob())
}

export const attachmentUrl = (attachment: Pick<AgentAttachment, 'content_url'>) => buildApiUrl(attachment.content_url)

export const streamAgentEvents = async (
  sessionId: string,
  onEvent: (event: AgentEvent) => void,
  options: { after?: number; follow?: boolean; signal?: AbortSignal } = {},
) => {
  const response = await fetch(buildApiUrl(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/events?follow=${options.follow ?? true}`,
  ), {
    headers: { ...getAuthHeaders(), 'Last-Event-ID': String(options.after || 0) },
    signal: options.signal,
  })
  if (!response.ok || !response.body) throw new Error(`事件连接失败 (${response.status})`)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const event = parseEvent(block)
      if (event) onEvent(event)
      boundary = buffer.indexOf('\n\n')
    }
  }
}

const parseEvent = (block: string): AgentEvent | null => {
  if (!block || block.startsWith(':')) return null
  let id = 0
  let type = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('id:')) id = Number(line.slice(3).trim()) || 0
    if (line.startsWith('event:')) type = line.slice(6).trim()
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (!data.length) return null
  return { id, type, data: JSON.parse(data.join('\n')) }
}

export const getImageInformation = () => request<{ models: Array<Record<string, any>> }>(
  '/api/image-flows/information',
)

export const getVideoInformation = () => request<{ models: Array<Record<string, any>> }>(
  '/api/video-flows/information',
)
