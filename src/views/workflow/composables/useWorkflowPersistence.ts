import { computed, ref } from 'vue'
import { buildApiUrl } from '@/api/http'
import {
  AgentApiError,
  createAgentSession,
  getAgentCanvas,
  getAgentCanvasRevision,
  getAgentSession,
  listAgentCanvasRevisions,
  listAgentSessions,
  putAgentCanvas,
  renameAgentSession,
  type AgentSession,
} from '../api/agent'
import type {
  WorkflowDefinitionDetailResponse,
  WorkflowDefinitionListQuery,
  WorkflowDefinitionSummary,
  WorkflowDefinitionVersionDetail,
} from '../api/definitions'
import {
  applyCanvasSnapshot,
  canvasViewport,
  edges,
  nodes,
  type WorkflowCanvasEdge,
  type WorkflowCanvasNode,
} from './useWorkflowCanvas'

export const activeAgentSessionId = ref('')
export const activeAgentSession = ref<AgentSession | null>(null)
export const activeAgentCanvasRevision = ref(0)
export const agentSessionList = ref<AgentSession[]>([])
const currentWorkflowDetail = ref<WorkflowDefinitionDetailResponse | null>(null)
const workflowList = ref<WorkflowDefinitionSummary[]>([])

const geometryKey = (sessionId: string) => `adflow-canvas-geometry:${sessionId}`

const readGeometry = (sessionId: string) => {
  try {
    return JSON.parse(localStorage.getItem(geometryKey(sessionId)) || '{}') as {
      nodes?: Record<string, { position?: { x: number; y: number }; zIndex?: number }>
      viewport?: { x: number; y: number; zoom: number }
      canvas?: { nodes: WorkflowCanvasNode[]; edges: WorkflowCanvasEdge[] }
    }
  } catch {
    return {}
  }
}

const saveGeometry = (sessionId: string) => {
  if (!sessionId) return
  localStorage.setItem(geometryKey(sessionId), JSON.stringify({
    nodes: Object.fromEntries(nodes.value.map(node => [node.id, {
      position: node.position,
      zIndex: node.zIndex,
    }])),
    viewport: canvasViewport.value,
    canvas: { nodes: nodes.value, edges: edges.value },
  }))
}

const semanticData = (node: WorkflowCanvasNode) => {
  if (node.type === 'text') {
    return {
      content: String((node.data as any).content || ''),
      label: (node.data as any).label,
    }
  }
  const data = node.data as any
  return {
    label: data.label,
    prompt: String(data.prompt || ''),
    model: String(data.model || ''),
    mode: String(data.mode || ''),
    parameters: data.parameters && typeof data.parameters === 'object' ? data.parameters : {},
    ...(typeof data.loading === 'boolean' ? { loading: data.loading } : {}),
    ...(typeof data.error === 'string' ? { error: data.error } : {}),
    ...(data.media_ref ? { media_ref: data.media_ref } : {}),
    ...(Array.isArray(data.media_versions) ? {
      media_versions: data.media_versions.map((version: any) => ({
        id: version.id,
        media_ref: version.media_ref,
      })),
    } : {}),
    ...(data.execution ? { execution: data.execution } : {}),
  }
}

export const buildAgentCanvasSnapshot = () => ({
  nodes: nodes.value.filter(node => ['text', 'image', 'video'].includes(node.type)).map(node => ({
    id: node.id,
    type: node.type,
    data: semanticData(node),
  })),
  edges: edges.value.filter(edge => (
    ['promptOrder', 'imageOrder', 'imageRole'].includes(String(edge.type))
    && nodes.value.some(node => node.id === edge.source && ['text', 'image', 'video'].includes(node.type))
    && nodes.value.some(node => node.id === edge.target && ['image', 'video'].includes(node.type))
  )).map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.type,
    data: edge.data || {},
  })),
})

let canvasSaveQueue: Promise<unknown> = Promise.resolve()

export const saveAgentCanvasNow = () => {
  const operation = canvasSaveQueue.then(async () => {
    const sessionId = activeAgentSessionId.value
    if (!sessionId) return
    saveGeometry(sessionId)
    try {
      const saved = await putAgentCanvas(sessionId, {
        ...buildAgentCanvasSnapshot(),
        base_revision: activeAgentCanvasRevision.value,
        mutation_id: `browser:${crypto.randomUUID()}`,
      })
      if (activeAgentSessionId.value === sessionId) {
        activeAgentCanvasRevision.value = saved.revision
      }
      return saved
    } catch (error) {
      if (error instanceof AgentApiError && error.status === 409) {
        throw new Error('画布已被其他操作更新，本地内容未覆盖服务器；请刷新后重试')
      }
      throw error
    }
  })
  canvasSaveQueue = operation.catch(() => undefined)
  return operation
}

export const refreshAgentCanvasRevision = async () => {
  const sessionId = activeAgentSessionId.value
  if (!sessionId) return
  const canvas = await getAgentCanvas(sessionId)
  if (activeAgentSessionId.value === sessionId) {
    activeAgentCanvasRevision.value = canvas.revision
  }
  return canvas
}

const previewUrl = (sessionId: string, data: Record<string, any>) => {
  const mediaRef = data.media_ref
  if (!mediaRef || typeof mediaRef !== 'object') return ''
  if (mediaRef.attachment_id) {
    return buildApiUrl(`/api/agent/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(mediaRef.attachment_id)}/content`)
  }
  if (mediaRef.task_type && mediaRef.task_id && mediaRef.asset_id) {
    return buildApiUrl(`/api/tasks/${encodeURIComponent(mediaRef.task_type)}/${encodeURIComponent(mediaRef.task_id)}/assets?asset_id=${encodeURIComponent(mediaRef.asset_id)}`)
  }
  return ''
}

export const loadAgentCanvasSession = async (sessionId: string) => {
  const [session, canvas] = await Promise.all([
    getAgentSession(sessionId),
    getAgentCanvas(sessionId),
  ])
  const hydrated = hydrateSemanticCanvas(sessionId, canvas.nodes, canvas.edges)
  applyCanvasSnapshot(hydrated, hydrated.viewport)
  activeAgentSessionId.value = sessionId
  activeAgentSession.value = session
  activeAgentCanvasRevision.value = canvas.revision
  return session
}

const hydrateSemanticCanvas = (
  sessionId: string,
  semanticNodes: Array<{ id: string; type: 'text' | 'image' | 'video'; data: Record<string, any> }>,
  semanticEdges: Array<Record<string, any>>,
) => {
  const geometry = readGeometry(sessionId)
  const serverNodes = semanticNodes.map((node, index) => {
    const saved = geometry.nodes?.[node.id]
    const mediaVersions = node.type === 'image' && Array.isArray(node.data.media_versions)
      ? node.data.media_versions.map((version: Record<string, any>) => ({
          ...version,
          url: previewUrl(sessionId, { media_ref: version.media_ref }),
        }))
      : undefined
    const executionStatus = String(node.data.execution?.status || '')
    const data = {
      ...node.data,
      // 服务端的执行终态必须压过浏览器本地几何缓存里的旧 loading 状态。
      ...(executionStatus ? { loading: executionStatus === 'running' } : {}),
      ...(executionStatus === 'failed' && !node.data.error ? { error: '生成失败' } : {}),
      ...((node.type === 'image' || node.type === 'video') ? { url: previewUrl(sessionId, node.data) } : {}),
      ...(mediaVersions ? { media_versions: mediaVersions } : {}),
    }
    return {
      id: node.id,
      type: node.type,
      position: saved?.position || { x: 120 + (index % 3) * 440, y: 120 + Math.floor(index / 3) * 360 },
      zIndex: saved?.zIndex,
      data,
    } as WorkflowCanvasNode
  })
  const serverById = new Map(serverNodes.map(node => [node.id, node]))
  const canvasNodes = geometry.canvas?.nodes?.length
    ? geometry.canvas.nodes.filter(node => (
      ['text', 'image', 'video'].includes(node.type) && serverById.has(node.id)
    )).map(node => {
      const serverNode = serverById.get(node.id)
      if (!serverNode) return node
      serverById.delete(node.id)
      return {
        ...node,
        data: { ...node.data, ...serverNode.data },
      } as WorkflowCanvasNode
    }).concat([...serverById.values()])
    : serverNodes
  const nodeIds = new Set(canvasNodes.map(node => node.id))
  const canvasEdges = (semanticEdges as WorkflowCanvasEdge[])
    .filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target))
  return {
    nodes: canvasNodes,
    edges: canvasEdges,
    viewport: geometry.viewport || { x: 100, y: 50, zoom: 0.8 },
  }
}

const workflowVersion = (
  session: AgentSession,
  revision = activeAgentCanvasRevision.value,
  canvas = JSON.parse(JSON.stringify({ nodes: nodes.value, edges: edges.value })),
  updatedAt = session.updated_at,
): WorkflowDefinitionVersionDetail => ({
  id: `${session.session_id}:revision:${revision}`,
  workflowId: session.session_id,
  createdBy: null,
  versionNo: revision,
  versionName: null,
  changeSummary: null,
  status: 'DRAFT',
  definitionJson: {},
  nodesJson: canvas.nodes,
  edgesJson: canvas.edges,
  viewportJson: { ...canvasViewport.value },
  inputSchemaJson: {},
  outputSchemaJson: {},
  runtimeConfigJson: {},
  publishedAt: null,
  createdAt: session.created_at,
  updatedAt,
})

const workflowSummary = (
  session: AgentSession,
  version?: WorkflowDefinitionVersionDetail,
  versionCount = version ? 1 : 0,
): WorkflowDefinitionSummary => ({
  id: session.session_id,
  userId: null,
  code: session.session_id.slice(0, 8),
  name: session.title,
  description: session.summary ?? null,
  category: null,
  scene: 'WORKFLOW_CANVAS',
  sourceType: 'AGENT_SESSION',
  status: 'DRAFT',
  currentVersionId: version?.id || null,
  latestVersionNo: version?.versionNo || 0,
  isBuiltIn: false,
  isEnabled: true,
  sortOrder: 0,
  tagsJson: [],
  createdAt: session.created_at,
  updatedAt: session.updated_at,
  currentVersion: version || null,
  latestVersion: version || null,
  versionCount,
})

const syncWorkflowDetail = (session: AgentSession) => {
  const version = workflowVersion(session)
  currentWorkflowDetail.value = {
    definition: workflowSummary(session, version),
    versions: [version],
  }
  return currentWorkflowDetail.value
}

export const useWorkflowPersistence = () => {
  const saving = ref(false)
  const loading = ref(false)
  const hasSession = computed(() => Boolean(activeAgentSessionId.value))

  const reloadSessionList = async () => {
    agentSessionList.value = (await listAgentSessions()).items
    workflowList.value = agentSessionList.value.map(session => workflowSummary(session))
    return agentSessionList.value
  }

  const createSession = async (title = '未命名创作') => {
    loading.value = true
    try {
      const session = await createAgentSession(title)
      activeAgentSessionId.value = session.session_id
      activeAgentSession.value = session
      activeAgentCanvasRevision.value = 0
      syncWorkflowDetail(session)
      return session
    } finally {
      loading.value = false
    }
  }

  const loadSession = async (sessionId: string) => {
    loading.value = true
    try {
      const session = await loadAgentCanvasSession(sessionId)
      syncWorkflowDetail(session)
      return session
    } finally {
      loading.value = false
    }
  }

  const renameSession = async (title: string) => {
    if (!activeAgentSessionId.value) return
    activeAgentSession.value = await renameAgentSession(activeAgentSessionId.value, title)
    syncWorkflowDetail(activeAgentSession.value)
  }

  const saveCanvas = async () => {
    saving.value = true
    try {
      await saveAgentCanvasNow()
      if (activeAgentSession.value) syncWorkflowDetail(activeAgentSession.value)
    } finally {
      saving.value = false
    }
  }

  const reloadWorkflowList = async (query: WorkflowDefinitionListQuery = {}) => {
    await reloadSessionList()
    if (query.keyword) {
      const keyword = query.keyword.toLowerCase()
      workflowList.value = workflowList.value.filter(item => (
        item.name.toLowerCase().includes(keyword) || item.code.includes(keyword)
      ))
    }
    return workflowList.value
  }

  const loadWorkflowDetail = async (workflowId: string) => {
    await loadSession(workflowId)
    currentWorkflowDetail.value = await fetchWorkflowDetail(workflowId)
    return currentWorkflowDetail.value
  }

  const fetchWorkflowDetail = async (workflowId: string) => {
    const [session, revisions] = await Promise.all([
      getAgentSession(workflowId),
      listAgentCanvasRevisions(workflowId),
    ])
    const versions = await Promise.all(revisions.items.map(async item => {
      const canvas = await getAgentCanvasRevision(workflowId, item.revision)
      const hydrated = hydrateSemanticCanvas(workflowId, canvas.nodes, canvas.edges)
      const version = workflowVersion(
        session,
        item.revision,
        hydrated,
        item.created_at,
      )
      version.createdAt = item.created_at
      return version
    }))
    if (!versions.length) {
      const canvas = await getAgentCanvas(workflowId)
      const hydrated = hydrateSemanticCanvas(workflowId, canvas.nodes, canvas.edges)
      versions.push(workflowVersion(session, canvas.revision, hydrated, canvas.updated_at))
    }
    return {
      definition: workflowSummary(session, versions[0], versions.length),
      versions,
    }
  }

  const applyWorkflowVersionToCanvas = (detail: WorkflowDefinitionDetailResponse, versionId?: string) => {
    const version = detail.versions.find(item => item.id === versionId) || detail.versions[0]
    if (!version) return
    applyCanvasSnapshot({
      nodes: version.nodesJson as WorkflowCanvasNode[],
      edges: version.edgesJson as WorkflowCanvasEdge[],
    }, version.viewportJson as { x: number; y: number; zoom: number })
  }

  const autosaveWorkflow = async (options: {
    workflowId?: string
    name?: string
    code?: string
    description?: string | null
    category?: string | null
    scene?: string
  }) => {
    if (!options.workflowId) await createSession(options.name)
    if (options.name && activeAgentSession.value?.title !== options.name) {
      await renameSession(options.name)
    }
    await saveCanvas()
    return currentWorkflowDetail.value!
  }

  const resetCurrentWorkflowState = () => {
    activeAgentSessionId.value = ''
    activeAgentSession.value = null
    activeAgentCanvasRevision.value = 0
    currentWorkflowDetail.value = null
  }

  return {
    saving,
    loading,
    hasSession,
    currentSessionId: activeAgentSessionId,
    currentSession: activeAgentSession,
    sessionList: agentSessionList,
    reloadSessionList,
    createSession,
    loadSession,
    renameSession,
    saveCanvas,
    currentWorkflowId: activeAgentSessionId,
    currentWorkflowDetail,
    workflowList,
    reloadWorkflowList,
    fetchWorkflowDetail,
    loadWorkflowDetail,
    applyWorkflowVersionToCanvas,
    autosaveWorkflow,
    resetCurrentWorkflowState,
  }
}
