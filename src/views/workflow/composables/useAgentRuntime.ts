import { ref } from 'vue'
import {
  assetUrl,
  getImageInformation,
  getVideoInformation,
  streamAgentEvents,
  submitAgentMessage,
  uploadAgentAttachment,
  type AgentAsset,
  type AgentEvent,
} from '../api/agent'
import { addNode, edges, nodes, updateEdge, updateNode } from './useWorkflowCanvas'
import { appendImageVersion, type CanvasMediaReference } from './imageVersions'
import { findCatalogModel } from '@/config/models'
import {
  activeAgentSessionId,
  refreshAgentCanvasRevision,
  saveAgentCanvasNow,
} from './useWorkflowPersistence'

export const imageDefaults = ref({
  model: 'image.seedream-5-pro',
  mode: 'text_to_image',
  parameters: { size: '2K', response_format: 'url', watermark: false, output_format: 'jpeg' } as Record<string, unknown>,
})

export const videoDefaults = ref({
  model: 'video.seedance-2',
  mode: 'text_to_video',
  parameters: { resolution: '720p', ratio: '16:9', duration: 5, watermark: false, generate_audio: true } as Record<string, unknown>,
})

let defaultsPromise: Promise<void> | null = null
export const loadAgentModelDefaults = () => {
  if (defaultsPromise) return defaultsPromise
  defaultsPromise = Promise.all([getImageInformation(), getVideoInformation()])
    .then(([image, video]) => {
      const imageModel = image.models?.[0]
      const imageMode = imageModel && Object.keys(imageModel.modes || {})[0]
      if (imageModel && imageMode) imageDefaults.value = {
        model: imageModel.id,
        mode: imageMode,
        parameters: { ...(imageModel.modes[imageMode]?.recommended_parameters || {}) },
      }
      const videoModel = video.models?.[0]
      const videoMode = videoModel && Object.keys(videoModel.modes || {})[0]
      if (videoModel && videoMode) videoDefaults.value = {
        model: videoModel.id,
        mode: videoMode,
        parameters: { ...(videoModel.modes[videoMode]?.recommended_parameters || {}) },
      }
    })
    .catch(() => undefined)
    .finally(() => { defaultsPromise = null })
  return defaultsPromise
}

export const waitForAgentRun = (
  sessionId: string,
  runId: string,
  onEvent: (event: AgentEvent) => void,
) => new Promise<void>((resolve, reject) => {
  const controller = new AbortController()
  void streamAgentEvents(sessionId, (event) => {
    if (event.data.run_id !== runId) return
    onEvent(event)
    if (event.type === 'run.completed' || event.type === 'run.cancelled') {
      controller.abort()
      resolve()
    } else if (event.type === 'run.failed') {
      controller.abort()
      reject(new Error(String(event.data.error_code || '执行失败')))
    }
  }, { signal: controller.signal }).catch((error) => {
    if (error?.name !== 'AbortError') reject(error)
  })
})

const applyAssetsToNode = (targetNodeId: string, assets: AgentAsset[]) => {
  const target = nodes.value.find(node => node.id === targetNodeId)
  if (!target || !assets.length) return
  const first = assets[0]
  const url = assetUrl(first)
  const mediaRef: CanvasMediaReference = {
    task_type: first.task_type,
    task_id: first.task_id,
    asset_id: first.asset_id,
  }
  const currentData = target.data as any
  updateNode(targetNodeId, {
    url,
    media_ref: mediaRef,
    ...(target.type === 'image' ? {
      media_versions: appendImageVersion(
        currentData.media_versions || [],
        currentData.media_ref,
        String(currentData.url || ''),
        mediaRef,
        url,
      ),
    } : {}),
    loading: false,
    error: '',
    executed: true,
  })
  assets.slice(1).forEach((asset, index) => {
    addNode('image', {
      x: target.position.x + (index + 1) * 420,
      y: target.position.y,
    }, {
      label: `${(target.data as any).label || '生成图片'} ${index + 2}`,
      url: assetUrl(asset),
      media_ref: { task_type: asset.task_type, task_id: asset.task_id, asset_id: asset.asset_id },
      model: (target.data as any).model,
      mode: (target.data as any).mode,
      parameters: (target.data as any).parameters,
      executed: true,
    })
  })
}

export const generateCanvasNode = async (targetNodeId: string, mode: 'image' | 'video') => {
  const sessionId = activeAgentSessionId.value
  if (!sessionId) throw new Error('画布会话尚未就绪')
  await saveAgentCanvasNow()
  updateNode(targetNodeId, { loading: true, error: '' })
  const admitted = await submitAgentMessage(sessionId, {
    text: '执行当前节点',
    mode,
    target_node_id: targetNodeId,
  })
  try {
    let assets: AgentAsset[] = []
    await waitForAgentRun(sessionId, admitted.run_id, (event) => {
      if (event.type === 'tool.completed') {
        assets = Array.isArray(event.data.result?.assets) ? event.data.result.assets : []
      }
    })
    await refreshAgentCanvasRevision()
    applyAssetsToNode(targetNodeId, assets)
    if (assets.length > 1) await saveAgentCanvasNow()
  } catch (error) {
    updateNode(targetNodeId, { loading: false, error: error instanceof Error ? error.message : '生成失败' })
    throw error
  }
}

export const runAgentText = async (prompt: string, modelId?: string) => {
  const sessionId = activeAgentSessionId.value
  if (!sessionId) throw new Error('画布会话尚未就绪')
  const admitted = await submitAgentMessage(
    sessionId,
    { text: prompt, mode: 'agent' },
    modelId,
  )
  let output = ''
  await waitForAgentRun(sessionId, admitted.run_id, (event) => {
    if (event.type === 'message.completed') {
      output = String(event.data.content?.text || '')
    }
  })
  if (!output) throw new Error('Agent 未返回文本')
  return output
}

export const uploadNodeMedia = async (nodeId: string, file: File) => {
  const sessionId = activeAgentSessionId.value
  if (!sessionId) throw new Error('画布会话尚未就绪')
  const attachment = await uploadAgentAttachment(sessionId, file)
  const url = URL.createObjectURL(file)
  updateNode(nodeId, {
    url,
    media_ref: { attachment_id: attachment.attachment_id },
    loading: false,
    error: '',
  })
  await saveAgentCanvasNow()
  return attachment
}

export const prepareImageNode = (
  nodeId: string,
  prompt: string,
  options: { count?: number; model?: string; size?: string } = {},
) => {
  const current = nodes.value.find(node => node.id === nodeId)?.data as any
  const hasReferences = Boolean(current?.media_ref) || edges.value.some(edge => edge.target === nodeId && edge.type === 'imageOrder')
  const parameters = { ...(current?.parameters || imageDefaults.value.parameters) }
  if (options.size) parameters.size = options.size
  parameters.output_image_count = Math.max(1, Math.min(15, Number(options.count) || 1))
  updateNode(nodeId, {
    prompt,
    model: options.model || current?.model || imageDefaults.value.model,
    mode: hasReferences ? 'image_to_image' : 'text_to_image',
    parameters,
  })
}

export const prepareVideoNode = (
  nodeId: string,
  prompt: string,
  options: { model?: string; ratio?: string; duration?: string } = {},
) => {
  const referenceEdges = edges.value.filter(edge => edge.target === nodeId && edge.type === 'imageRole')
  const roleAliases: Record<string, string> = {
    first_frame_image: 'first_frame',
    last_frame_image: 'last_frame',
    input_reference: 'reference',
  }
  const roles = referenceEdges.map(edge => {
    const role = String((edge.data as any)?.imageRole || 'reference')
    return roleAliases[role] || role
  })
  const current = nodes.value.find(node => node.id === nodeId)?.data as any
  const model = options.model || current?.model || videoDefaults.value.model
  let mode = !referenceEdges.length
    ? 'text_to_video'
    : roles.includes('last_frame')
      ? 'first_last_frame_to_video'
      : referenceEdges.length === 1 && roles[0] === 'first_frame'
        ? 'image_to_video'
        : 'reference_to_video'
  const parameters = { ...(current?.parameters || videoDefaults.value.parameters) }
  const modes = findCatalogModel(model, 'VIDEO')?.capabilityJson?.modes || {}
  if (
    mode === 'reference_to_video'
    && referenceEdges.length === 1
    && !modes.reference_to_video
    && modes.image_to_video
  ) {
    mode = 'image_to_video'
    updateEdge(referenceEdges[0].id, { data: { imageRole: 'first_frame' } })
  }
  if (Object.keys(modes).length && !modes[mode]) {
    const label = findCatalogModel(model, 'VIDEO')?.label || model
    throw new Error(`${label} 不支持${mode === 'first_last_frame_to_video' ? '首尾帧' : '当前'}生视频模式`)
  }
  if (options.ratio) parameters.ratio = options.ratio
  const duration = Number.parseInt(String(options.duration || ''), 10)
  if (Number.isFinite(duration) && duration > 0) parameters.duration = duration
  updateNode(nodeId, {
    prompt,
    model,
    mode,
    parameters,
  })
}
