<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import ContentGenerator from '@/components/generate/ContentGenerator.vue'
import AssistantSessionList from '@/components/canvas/AssistantSessionList.vue'
import SidebarEmptyState from '@/components/canana/SidebarEmptyState.vue'
import type { PersistedGenerationSession } from '@/api/generation-sessions'
import {
  assetUrl,
  cancelAgentRun,
  createAgentSession,
  deleteAgentSession,
  listAgentMessages,
  listAgentSessions,
  loadMediaPreview,
  renameAgentSession,
  resumeAgentRun,
  streamAgentEvents,
  submitAgentMessage,
  uploadAgentAttachment,
  type AgentAsset,
  type AgentSession,
} from '../api/agent'
import { imageDefaults, loadAgentModelDefaults, videoDefaults } from '../composables/useAgentRuntime'
import { getAgentModel, setAgentModel } from '@/api/agent'
import {
  getAllImageModels,
  getAllVideoModels,
  loadPublicModelCatalog,
  type ImageModel,
  type VideoModel,
} from '@/config/models'

interface ComposerOptions {
  model?: string
  modelKey?: string
  referenceImages?: string[]
  capabilityFlags?: unknown
}

const props = defineProps<{
  sessionId: string
  title: string
  initialMessage?: string
  modelId?: string
}>()

const emit = defineEmits<{
  close: []
  addAsset: [asset: AgentAsset]
  canvasUpdated: [event: { revision: number; mutationId: string }]
  initialMessageConsumed: []
  sessionChange: [sessionId: string]
}>()

interface PanelMessage {
  id: string
  role: 'user' | 'assistant' | 'status'
  text: string
  assets?: AgentAsset[]
  targetNodeId?: string
}

interface AgentApproval {
  runId: string
  toolId: string
  summary: Record<string, unknown>
}

interface MediaApprovalDraft {
  prompt: string
  model: string
  mode: string
  parameters: Record<string, unknown>
}

interface ApprovalParameterField {
  key: string
  label: string
  schema: Record<string, any>
  options: unknown[]
}

const messages = ref<PanelMessage[]>([])
const busy = ref(false)
const listRef = ref<HTMLElement | null>(null)
const composerRef = ref<InstanceType<typeof ContentGenerator> | null>(null)
const selectedModelId = ref(props.modelId || getAgentModel())
const sessions = ref<AgentSession[]>([])
const sessionListVisible = ref(false)
const sessionListAnchor = ref<HTMLElement | null>(null)
const assetPreviewUrls = ref<Record<string, string>>({})
const ownedAssetPreviewUrls = new Set<string>()
const approval = ref<AgentApproval | null>(null)
const approvalDraft = ref<MediaApprovalDraft | null>(null)
const approvalModels = ref<Array<ImageModel | VideoModel>>([])
const approvalSubmitting = ref(false)
const activeRunId = ref('')
let streamController: AbortController | null = null
let connectGeneration = 0
const seen = new Set<string>()

const headerTitle = computed(() => {
  return sessions.value.find(session => session.session_id === props.sessionId)?.title
    || props.title
    || '未命名对话'
})

const approvalTitle = computed(() => {
  if (approval.value?.summary.kind === 'media_generation') {
    return approval.value.summary.node_type === 'video' ? '确认生成视频' : '确认生成图片'
  }
  return '确认创建卡片'
})

const approvalParameters = computed(() => {
  const parameters = approval.value?.summary.parameters
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return []
  const labels: Record<string, string> = {
    size: '尺寸',
    resolution: '分辨率',
    ratio: '比例',
    duration: '时长',
    output_image_count: '数量',
    output_format: '格式',
    quality: '画质',
  }
  return Object.entries(parameters).map(([key, value]) => ({
    key,
    label: labels[key] || key,
    value: typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : JSON.stringify(value),
  }))
})

const isMediaApproval = computed(() => approval.value?.summary.kind === 'media_generation' && approvalDraft.value !== null)

const selectedApprovalModel = computed(() => approvalModels.value.find(model => model.key === approvalDraft.value?.model))

const approvalModeOptions = computed(() => {
  const modes = selectedApprovalModel.value?.capabilityJson?.modes
  return modes && typeof modes === 'object' ? Object.keys(modes) : []
})

const approvalParameterFields = computed<ApprovalParameterField[]>(() => {
  const draft = approvalDraft.value
  if (!draft) return []
  const modes = selectedApprovalModel.value?.capabilityJson?.modes
  const mode = modes && typeof modes === 'object' ? modes[draft.mode] : null
  const properties = mode?.parameters_schema?.properties
  const keys = new Set([
    ...Object.keys(properties && typeof properties === 'object' ? properties : {}),
    ...Object.keys(draft.parameters),
  ])
  const labels: Record<string, string> = {
    size: '尺寸',
    resolution: '分辨率',
    ratio: '比例',
    duration: '时长',
    output_image_count: '数量',
    output_format: '格式',
    quality: '画质',
  }
  return [...keys].map(key => {
    const schema = properties?.[key] && typeof properties[key] === 'object' ? properties[key] : {}
    const options = Array.isArray(schema.enum)
      ? schema.enum
      : Array.isArray(schema.anyOf)
        ? schema.anyOf.flatMap((item: any) => Array.isArray(item?.enum) ? item.enum : [])
        : []
    return { key, label: labels[key] || key, schema, options }
  })
})

const approvalChanged = computed(() => {
  const current = approval.value?.summary
  const draft = approvalDraft.value
  if (!current || !draft) return false
  return draft.prompt.trim() !== String(current.prompt || '')
    || draft.model !== String(current.model || '')
    || draft.mode !== String(current.mode || '')
    || JSON.stringify(draft.parameters) !== JSON.stringify(current.parameters || {})
})

const approvalActionText = computed(() => {
  if (!isMediaApproval.value) return '确认创建'
  return approvalChanged.value ? '应用修改并生成' : '确认生成'
})

const sessionItems = computed<PersistedGenerationSession[]>(() => sessions.value.map((session, index) => ({
  id: session.session_id,
  source: 'agent-runtime',
  title: session.title || '未命名对话',
  isDefault: index === 0 && sessions.value.length === 1,
  sortOrder: index,
  recordCount: 0,
  coverImageUrl: '',
  createdAt: session.created_at,
  updatedAt: session.updated_at,
})))

const scrollBottom = () => nextTick(() => {
  if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight
})

const addMessage = (message: PanelMessage) => {
  if (seen.has(message.id)) return
  seen.add(message.id)
  messages.value.push(message)
  if (message.assets?.length) void resolveAssetPreviews(message.assets)
  scrollBottom()
}

const resolveAssetPreviews = async (assets: AgentAsset[]) => {
  await Promise.all(assets.map(async asset => {
    try {
      const url = await loadMediaPreview(assetUrl(asset))
      assetPreviewUrls.value[asset.asset_id] = url
      if (url.startsWith('blob:')) ownedAssetPreviewUrls.add(url)
    } catch {
      // A missing preview must not hide the rest of the conversation.
    }
  }))
}

const loadSessions = async () => {
  try {
    sessions.value = (await listAgentSessions()).items
  } catch {
    sessions.value = []
  }
}

const setApprovalDraft = (summary: Record<string, unknown>) => {
  if (summary.kind !== 'media_generation') {
    approvalDraft.value = null
    approvalModels.value = []
    return
  }
  approvalDraft.value = {
    prompt: String(summary.prompt || ''),
    model: String(summary.model || ''),
    mode: String(summary.mode || ''),
    parameters: summary.parameters && typeof summary.parameters === 'object' && !Array.isArray(summary.parameters)
      ? { ...summary.parameters as Record<string, unknown> }
      : {},
  }
  void loadPublicModelCatalog().then(() => {
    approvalModels.value = summary.node_type === 'video' ? getAllVideoModels() : getAllImageModels()
  })
}

const updateApprovalModel = (event: Event) => {
  if (!approvalDraft.value) return
  const model = (event.target as HTMLSelectElement).value
  approvalDraft.value.model = model
  const selected = approvalModels.value.find(item => item.key === model)
  const modes = selected?.capabilityJson?.modes
  if (modes && typeof modes === 'object' && !modes[approvalDraft.value.mode]) {
    approvalDraft.value.mode = Object.keys(modes)[0] || approvalDraft.value.mode
  }
}

const updateApprovalParameter = (field: ApprovalParameterField, event: Event) => {
  const draft = approvalDraft.value
  if (!draft) return
  const value = (event.target as HTMLInputElement | HTMLSelectElement).value
  if (field.schema.type === 'number' || field.schema.type === 'integer') {
    const parsed = Number(value)
    draft.parameters[field.key] = Number.isFinite(parsed) ? parsed : value
    return
  }
  if (field.schema.type === 'boolean') {
    draft.parameters[field.key] = value === 'true'
    return
  }
  if (field.schema.type === 'object' || typeof draft.parameters[field.key] === 'object') {
    try {
      draft.parameters[field.key] = JSON.parse(value)
      return
    } catch {
      // Keep the literal value so the server can return its validation error.
    }
  }
  draft.parameters[field.key] = value
}

const approvalParameterValue = (field: ApprovalParameterField) => {
  const value = approvalDraft.value?.parameters[field.key]
  return value === undefined || value === null
    ? ''
    : typeof value === 'object' ? JSON.stringify(value) : String(value)
}

const hasApprovalModel = (modelKey: string) => approvalModels.value.some(model => model.key === modelKey)

const handleEvent = (event: { id: number; type: string; data: Record<string, any> }) => {
  if (event.type === 'canvas.updated') {
    const revision = Number(event.data.revision)
    const mutationId = String(event.data.mutation_id || '')
    if (
      /^(agent-tool|tool-result|tool-status):/.test(mutationId)
      && Number.isInteger(revision)
      && revision > 0
    ) {
      emit('canvasUpdated', { revision, mutationId })
    }
  }
  if (event.type === 'message.completed') {
    addMessage({
      id: `message:${event.data.message_id}`,
      role: 'assistant',
      text: String(event.data.content?.text || ''),
    })
  }
  if (event.type === 'approval.required') {
    const nextApproval = {
      runId: String(event.data.run_id),
      toolId: String(event.data.tool_id || ''),
      summary: event.data.approval_summary && typeof event.data.approval_summary === 'object'
        ? event.data.approval_summary
        : {},
    }
    approval.value = nextApproval
    approvalSubmitting.value = false
    setApprovalDraft(nextApproval.summary)
  }
  if (
    approval.value?.runId === String(event.data.run_id || '')
    && ['approval.resolved', 'run.completed', 'run.cancelled', 'run.failed'].includes(event.type)
  ) {
    approval.value = null
    approvalDraft.value = null
    approvalSubmitting.value = false
  }
  if (event.type === 'tool.completed') {
    const assets: AgentAsset[] = Array.isArray(event.data.result?.assets) ? event.data.result.assets : []
    if (assets.length) {
      addMessage({
        id: `tool:${event.data.tool_call_id}`,
        role: 'assistant',
        text: '生成完成',
        assets,
        targetNodeId: String(event.data.result?.target_node_id || ''),
      })
      if (!event.data.result?.target_node_id) assets.forEach(asset => emit('addAsset', asset))
    }
  }
  if (event.type === 'run.failed') {
    addMessage({
      id: `run:${event.data.run_id}:failed`,
      role: 'status',
      text: `执行失败：${event.data.error_code || 'unknown'}`,
    })
    if (!activeRunId.value || activeRunId.value === String(event.data.run_id || '')) {
      activeRunId.value = ''
      busy.value = false
    }
  }
  if (event.type === 'run.completed' || event.type === 'run.cancelled') {
    if (!activeRunId.value || activeRunId.value === String(event.data.run_id || '')) {
      activeRunId.value = ''
      busy.value = false
    }
  }
}

const dataUrlToFile = (value: string, index: number) => {
  const match = value.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/)
  if (!match) return null
  const mime = match[1]
  const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0))
  const extension = mime.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'png'
  return new File([bytes], `reference-${index + 1}.${extension}`, { type: mime })
}

const uploadReferenceImages = async (referenceImages: string[]) => {
  const ids: string[] = []
  for (const [index, referenceImage] of referenceImages.entries()) {
    const file = dataUrlToFile(String(referenceImage || ''), index)
    if (!file || !props.sessionId) continue
    const uploaded = await uploadAgentAttachment(props.sessionId, file)
    ids.push(uploaded.attachment_id)
  }
  return ids
}

const send = async (text: string, options: ComposerOptions = {}) => {
  const normalizedText = text.trim()
  if (!normalizedText || !props.sessionId || busy.value) return false

  const modelId = String(options.modelKey || options.model || props.modelId || selectedModelId.value || getAgentModel()).trim()
  if (modelId) {
    selectedModelId.value = modelId
    setAgentModel(modelId)
  }

  addMessage({ id: `local:${crypto.randomUUID()}`, role: 'user', text: normalizedText })
  busy.value = true
  try {
    const referenceIds = await uploadReferenceImages(Array.isArray(options.referenceImages) ? options.referenceImages : [])
    const attachmentIds = referenceIds
    const hasReferences = attachmentIds.length > 0
    const content: Record<string, unknown> = {
      text: normalizedText,
      mode: 'agent',
      attachment_ids: attachmentIds,
      constraints: {
        image: {
          ...imageDefaults.value,
          mode: hasReferences ? 'image_to_image' : 'text_to_image',
        },
        video: {
          ...videoDefaults.value,
          mode: hasReferences ? 'reference_to_video' : 'text_to_video',
        },
      },
    }
    if (options.capabilityFlags && typeof options.capabilityFlags === 'object' && !Array.isArray(options.capabilityFlags) && Object.keys(options.capabilityFlags).length) {
      content.capability_flags = options.capabilityFlags
    }
    const admitted = await submitAgentMessage(props.sessionId, content, modelId)
    activeRunId.value = admitted.run_id
    return true
  } catch (error) {
    busy.value = false
    ElMessage.error(error instanceof Error ? error.message : '发送失败')
    return false
  }
}

const connect = async (sessionId: string) => {
  const generation = ++connectGeneration
  streamController?.abort()
  messages.value = []
  seen.clear()
  approval.value = null
  approvalDraft.value = null
  activeRunId.value = ''
  await loadSessions()
  if (!sessionId || generation !== connectGeneration) return

  try {
    const history = await listAgentMessages(sessionId)
    if (generation !== connectGeneration) return
    history.items
      .filter(message => !message.content?.target_node_id && message.content?.text !== 'Media generation completed.')
      .forEach(message => addMessage({
        id: `message:${message.message_id}`,
        role: message.role === 'user' ? 'user' : 'assistant',
        text: String(message.content?.text || ''),
      }))
  } catch (error) {
    if (generation === connectGeneration) ElMessage.error(error instanceof Error ? error.message : '读取会话失败')
    return
  }

  streamController = new AbortController()
  void streamAgentEvents(sessionId, handleEvent, { signal: streamController.signal }).catch(error => {
    if (error?.name !== 'AbortError') ElMessage.error(error?.message || 'Agent 事件连接失败')
  })

  if (props.initialMessage?.trim()) {
    if (await send(props.initialMessage, { modelKey: selectedModelId.value })) {
      emit('initialMessageConsumed')
    }
  }
}

const handleComposerSend = (message: string, _type: unknown, options?: ComposerOptions) => {
  void send(message, options)
}

const focusComposer = () => {
  composerRef.value?.expand()
  composerRef.value?.openImageReferencePicker()
}

const toggleSessionList = () => {
  sessionListVisible.value = !sessionListVisible.value
}

const handleSessionCreate = async () => {
  try {
    const session = await createAgentSession('未命名创作')
    sessions.value = [session, ...sessions.value.filter(item => item.session_id !== session.session_id)]
    sessionListVisible.value = false
    emit('sessionChange', session.session_id)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '创建会话失败')
  }
}

const handleSessionSelect = (sessionId: string) => {
  sessionListVisible.value = false
  if (sessionId && sessionId !== props.sessionId) emit('sessionChange', sessionId)
}

const handleSessionRename = async (sessionId: string, title: string) => {
  try {
    const updated = await renameAgentSession(sessionId, title)
    sessions.value = sessions.value.map(session => session.session_id === sessionId ? updated : session)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '重命名会话失败')
  }
}

const handleSessionDelete = async (sessionId: string) => {
  try {
    await deleteAgentSession(sessionId)
    sessions.value = sessions.value.filter(session => session.session_id !== sessionId)
    if (sessionId === props.sessionId) {
      const fallback = sessions.value[0]
      if (fallback) emit('sessionChange', fallback.session_id)
      else await handleSessionCreate()
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除会话失败')
  }
}

const decide = async (decision: 'approve' | 'reject' | 'modify') => {
  if (!approval.value || approvalSubmitting.value) return
  try {
    approvalSubmitting.value = true
    const draft = approvalDraft.value
    await resumeAgentRun(
      approval.value.runId,
      decision,
      decision === 'modify' && draft
        ? {
            prompt: draft.prompt.trim(),
            proposal: {
              model: draft.model,
              mode: draft.mode,
              parameters: draft.parameters,
            },
          }
        : undefined,
    )
    approval.value = null
    approvalDraft.value = null
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    approvalSubmitting.value = false
  }
}

const approve = () => void decide(approvalChanged.value ? 'modify' : 'approve')

const cancelActiveRun = async () => {
  if (!activeRunId.value) return
  try {
    await cancelAgentRun(activeRunId.value)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '取消失败')
  }
}

void loadAgentModelDefaults()
watch(() => props.modelId, value => {
  if (value) selectedModelId.value = value
})
watch(() => props.sessionId, value => void connect(value), { immediate: true })
onBeforeUnmount(() => {
  streamController?.abort()
  ownedAssetPreviewUrls.forEach(url => URL.revokeObjectURL(url))
})
</script>

<template>
  <div class="agent-panel">
    <header class="agent-panel__header">
      <button
        ref="sessionListAnchor"
        class="agent-panel__session-trigger"
        type="button"
        :aria-expanded="sessionListVisible"
        @click="toggleSessionList"
      >
        <span>{{ headerTitle }}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <div class="agent-panel__header-actions">
        <button v-if="activeRunId" type="button" title="取消当前任务" @click="cancelActiveRun">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 7h10v10H7z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
          </svg>
        </button>
        <button type="button" title="新建对话" @click="handleSessionCreate">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
        <button type="button" title="收起" @click="emit('close')">→</button>
      </div>
    </header>

    <AssistantSessionList
      :visible="sessionListVisible"
      :sessions="sessionItems"
      :active-id="props.sessionId"
      :anchor="sessionListAnchor"
      @close="sessionListVisible = false"
      @create="handleSessionCreate"
      @select="handleSessionSelect"
      @rename="handleSessionRename"
      @delete="handleSessionDelete"
    />

    <div ref="listRef" class="agent-panel__messages">
      <SidebarEmptyState v-if="messages.length === 0" @upload="focusComposer" />
      <div v-for="message in messages" :key="message.id" class="agent-message" :class="`is-${message.role}`">
        <div v-if="message.text" class="agent-message__bubble">{{ message.text }}</div>
        <div v-if="message.assets?.length" class="agent-message__assets">
          <template v-for="asset in message.assets" :key="asset.asset_id">
            <div class="agent-message__asset">
              <video v-if="asset.content_type?.startsWith('video/') && assetPreviewUrls[asset.asset_id]" :src="assetPreviewUrls[asset.asset_id]" controls />
              <img v-else-if="assetPreviewUrls[asset.asset_id]" :src="assetPreviewUrls[asset.asset_id]" alt="生成结果" />
              <button v-if="!message.targetNodeId" type="button" title="添加到画布" @click="emit('addAsset', asset)">＋</button>
            </div>
          </template>
        </div>
      </div>
    </div>

    <section v-if="approval" class="agent-approval" aria-live="polite">
      <header class="agent-approval__header">
        <span class="agent-approval__icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M12 3 4.5 6v5.5c0 4.6 3.2 7.8 7.5 9.5 4.3-1.7 7.5-4.9 7.5-9.5V6L12 3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
            <path d="m8.5 12 2.2 2.2 4.8-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <span>
          <small>执行前确认</small>
          <strong>{{ approvalTitle }}</strong>
        </span>
      </header>
      <div v-if="isMediaApproval && approvalDraft" class="agent-approval__editor">
        <label class="agent-approval__field agent-approval__field--prompt">
          <span>提示词</span>
          <textarea v-model="approvalDraft.prompt" rows="3" />
        </label>
        <label class="agent-approval__field">
          <span>模型</span>
          <select :value="approvalDraft.model" @change="updateApprovalModel">
            <option v-if="!hasApprovalModel(approvalDraft.model)" :value="approvalDraft.model">
              {{ approvalDraft.model }}
            </option>
            <option v-for="model in approvalModels" :key="model.key" :value="model.key">{{ model.label }}</option>
          </select>
        </label>
        <label class="agent-approval__field">
          <span>模式</span>
          <select v-if="approvalModeOptions.length" v-model="approvalDraft.mode">
            <option v-if="!approvalModeOptions.includes(approvalDraft.mode)" :value="approvalDraft.mode">{{ approvalDraft.mode }}</option>
            <option v-for="mode in approvalModeOptions" :key="mode" :value="mode">{{ mode }}</option>
          </select>
          <input v-else v-model="approvalDraft.mode" type="text">
        </label>
        <label v-for="parameter in approvalParameterFields" :key="parameter.key" class="agent-approval__field">
          <span>{{ parameter.label }}</span>
          <select
            v-if="parameter.options.length"
            :value="approvalParameterValue(parameter)"
            @change="updateApprovalParameter(parameter, $event)"
          >
            <option v-for="option in parameter.options" :key="String(option)" :value="String(option)">{{ option }}</option>
          </select>
          <input
            v-else
            :value="approvalParameterValue(parameter)"
            type="text"
            @change="updateApprovalParameter(parameter, $event)"
          >
        </label>
        <p v-if="Number(approval.summary.reference_count || 0) > 0" class="agent-approval__references">
          参考素材 {{ approval.summary.reference_count }} 个
        </p>
      </div>
      <dl v-else class="agent-approval__details">
        <template v-if="approval.summary.prompt">
          <dt>提示词</dt>
          <dd>{{ approval.summary.prompt }}</dd>
        </template>
        <template v-if="approval.summary.model">
          <dt>模型</dt>
          <dd>{{ approval.summary.model }}</dd>
        </template>
        <template v-if="approval.summary.mode">
          <dt>模式</dt>
          <dd>{{ approval.summary.mode }}</dd>
        </template>
        <template v-for="parameter in approvalParameters" :key="parameter.key">
          <dt>{{ parameter.label }}</dt>
          <dd>{{ parameter.value }}</dd>
        </template>
        <template v-if="Number(approval.summary.reference_count || 0) > 0">
          <dt>参考素材</dt>
          <dd>{{ approval.summary.reference_count }} 个</dd>
        </template>
      </dl>
      <div class="agent-approval__actions">
        <button type="button" :disabled="approvalSubmitting" @click="decide('reject')">取消</button>
        <button type="button" class="is-primary" :disabled="approvalSubmitting" @click="approve">
          {{ approvalSubmitting ? '提交中…' : approvalActionText }}
        </button>
      </div>
    </section>

    <ContentGenerator
      ref="composerRef"
      class="agent-panel__generator"
      layout="sidebar"
      :collapsible="false"
      :default-expanded="true"
      popup-placement="top"
      initial-creation-type="agent"
      hide-type-selector
      hide-skill-selector
      hide-agent-actions
      @send="handleComposerSend"
    />
  </div>
</template>

<style scoped>
.agent-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--canvas-bg-block-default, var(--bg-page, #111315));
  color: var(--text-primary, #f5f5f5);
  border-left: 1px solid var(--stroke-secondary, #292c30);
  overflow: hidden;
}
.agent-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  padding: 0 16px;
  border-bottom: 1px solid var(--stroke-secondary, #292c30);
}
.agent-panel__session-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: calc(100% - 84px);
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
}
.agent-panel__session-trigger span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-panel__header-actions { display: inline-flex; gap: 4px; }
.agent-panel__header-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #aaa);
  cursor: pointer;
}
.agent-panel__header-actions button:hover { background: var(--canvas-float-block-hover, rgba(255,255,255,.06)); color: var(--text-primary, #fff); }
.agent-panel__messages { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 20px 16px 12px; }
.agent-panel__empty { display: grid; min-height: 100%; place-items: center; padding: 24px; color: var(--text-tertiary, #888); font-size: 13px; line-height: 1.6; text-align: center; }
.agent-message { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; margin-bottom: 14px; }
.agent-message.is-user { align-items: flex-end; }
.agent-message.is-status { align-items: center; color: #ef6b6b; font-size: 12px; }
.agent-message__bubble { max-width: 88%; white-space: pre-wrap; word-break: break-word; padding: 12px 16px; border-radius: 16px; background: var(--bg-block-secondary-default); font-size: 14px; line-height: 1.6; }
.agent-message.is-user .agent-message__bubble { background: var(--bg-block-primary-default); }
.agent-message__assets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; gap: 8px; }
.agent-message__asset { position: relative; min-width: 0; }
.agent-message__asset img, .agent-message__asset video { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; background: #000; }
.agent-message__asset button { position: absolute; right: 6px; bottom: 6px; width: 26px; height: 26px; border: 0; border-radius: 50%; background: rgba(0,0,0,.65); color: #fff; cursor: pointer; }
.agent-approval {
  flex: 0 1 auto;
  min-height: 0;
  margin: 0 12px 8px;
  padding: 12px;
  border: 1px solid var(--stroke-secondary, #3c4045);
  border-top: 2px solid #d6a84b;
  border-radius: 6px;
  background: var(--bg-block-secondary-default, #1b1e21);
  box-shadow: 0 -8px 24px rgba(0, 0, 0, .16);
  font-size: 13px;
}
.agent-approval__header { display: flex; align-items: center; gap: 9px; }
.agent-approval__header > span:last-child { min-width: 0; }
.agent-approval__header small { display: block; margin-bottom: 1px; color: var(--text-tertiary, #969696); font-size: 11px; line-height: 1.2; }
.agent-approval__header strong { display: block; color: var(--text-primary, #f5f5f5); font-size: 14px; line-height: 1.4; }
.agent-approval__icon { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 6px; background: rgba(214, 168, 75, .12); color: #d6a84b; }
.agent-approval__editor { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 8px; max-height: min(42vh, 420px); margin-top: 12px; padding-right: 2px; overflow: auto; }
.agent-approval__field { display: grid; min-width: 0; gap: 5px; color: var(--text-tertiary, #969696); }
.agent-approval__field--prompt { grid-column: 1 / -1; }
.agent-approval__editor input, .agent-approval__editor select, .agent-approval__editor textarea { width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid var(--stroke-secondary, #4a4d50); border-radius: 4px; outline: 0; background: var(--bg-block-primary-default, #121416); color: var(--text-primary, #f5f5f5); font: inherit; padding: 7px 8px; }
.agent-approval__editor input, .agent-approval__editor select { min-height: 34px; }
.agent-approval__editor textarea { min-height: 74px; resize: vertical; line-height: 1.45; }
.agent-approval__editor input:focus, .agent-approval__editor select:focus, .agent-approval__editor textarea:focus { border-color: #02a77f; box-shadow: 0 0 0 2px rgba(2, 167, 127, .14); }
.agent-approval__references { grid-column: 1 / -1; margin: 0; color: var(--text-tertiary, #969696); }
.agent-approval__details { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 6px 8px; margin: 10px 0 0; color: var(--text-secondary, #c0c0c0); }
.agent-approval__details dt { color: var(--text-tertiary, #969696); }
.agent-approval__details dd { min-width: 0; margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.agent-approval__actions { display: flex; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--stroke-secondary, #34373b); }
.agent-approval__actions button { min-height: 34px; padding: 6px 12px; border: 1px solid var(--stroke-secondary, #44484d); border-radius: 4px; background: transparent; color: var(--text-secondary, #c0c0c0); cursor: pointer; font: inherit; }
.agent-approval__actions button:hover:not(:disabled) { background: var(--canvas-float-block-hover, rgba(255,255,255,.06)); color: var(--text-primary, #fff); }
.agent-approval__actions button.is-primary { flex: 1; border-color: #02a77f; background: #02a77f; color: #fff; font-weight: 600; }
.agent-approval__actions button.is-primary:hover:not(:disabled) { background: #039b76; }
.agent-approval__actions button:disabled { cursor: not-allowed; opacity: .55; }
.agent-panel__generator { flex: 0 0 auto; border-top: 1px solid var(--stroke-secondary, #292c30); }
</style>
