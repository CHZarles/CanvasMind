/**
 * 模型配置与前端模型注册表
 * 统一从后台公开模型目录读取，不再使用前端静态模型清单。
 */

import { ref } from 'vue'
import { buildApiUrl } from '@/api/http'
import { getAuthHeaders } from '@/api/auth'

export interface SizeOption {
  label: string
  key: string
}

export interface QualityOption {
  label: string
  key: string
}

export interface DurationOption {
  label: string
  key: number
}

export interface BaseCatalogModel {
  id: string
  key: string
  label: string
  modelKey: string
  providerId: string
  providerCode: string
  providerName: string
  description: string
  capabilityJson: Record<string, any> | null
  defaultParams: Record<string, unknown>
  sortOrder: number
  isDefault: boolean
}

export interface ImageModel extends BaseCatalogModel {
  sizes: string[]
  tips?: string
  qualities?: QualityOption[]
  getSizesByQuality?: (quality: string) => SizeOption[]
  /**
   * 单次请求最多返回多少张图（对应上游 n 参数的硬上限）。
   * 由后台配置在 capabilityJson.maxImagesPerRequest 中提供；
   * 不同上游限制不一样（gpt-image-2 = 4，部分模型 = 1，少数 = 10）。
   * 前端步进器与后端 normalize 均会以此为上限 clamp。
   */
  maxImagesPerRequest: number
}

export interface VideoModel extends BaseCatalogModel {
  ratios: string[]
  durs: DurationOption[]
}

export interface ChatModel extends BaseCatalogModel {}

export interface PublicModelCatalogItem {
  id: string
  selectionKey: string
  providerId: string
  providerCode: string
  providerName: string
  category: 'CHAT' | 'IMAGE' | 'VIDEO'
  label: string
  modelKey: string
  description: string
  capabilityJson: Record<string, any> | null
  defaultParamsJson: Record<string, any> | null
  sortOrder: number
  isDefault: boolean
}

export interface PublicModelCatalogResult {
  providers: Array<{
    id: string
    code: string
    name: string
    iconUrl: string
    supportedTypes: string[]
    sortOrder: number
  }>
  models: {
    chat: PublicModelCatalogItem[]
    image: PublicModelCatalogItem[]
    video: PublicModelCatalogItem[]
  }
  defaults: {
    chat: string
    image: string
    video: string
  }
}

interface RuntimeCatalogModel {
  id: string
  display_name?: string
  quality_tier?: string
  speed_tier?: string
  modes?: Record<string, Record<string, any>>
  parameters_schema?: Record<string, any>
  recommended_parameters?: Record<string, any>
  capabilities?: Record<string, any>
}

interface RuntimeCatalog {
  models?: RuntimeCatalogModel[]
}

// 豆包图片尺寸选项
export const SEEDREAM_SIZE_OPTIONS: SizeOption[] = [
  { label: '21:9', key: '3024x1296' },
  { label: '16:9', key: '2560x1440' },
  { label: '4:3', key: '2304x1728' },
  { label: '3:2', key: '2496x1664' },
  { label: '1:1', key: '2048x2048' },
  { label: '2:3', key: '1664x2496' },
  { label: '3:4', key: '1728x2304' },
  { label: '9:16', key: '1440x2560' },
  { label: '9:21', key: '1296x3024' },
]

export const SEEDREAM_4K_SIZE_OPTIONS: SizeOption[] = [
  { label: '21:9', key: '6198x2656' },
  { label: '16:9', key: '5404x3040' },
  { label: '4:3', key: '4694x3520' },
  { label: '3:2', key: '4992x3328' },
  { label: '1:1', key: '4096x4096' },
  { label: '2:3', key: '3328x4992' },
  { label: '3:4', key: '3520x4694' },
  { label: '9:16', key: '3040x5404' },
  { label: '9:21', key: '2656x6198' },
]

export const SEEDREAM_QUALITY_OPTIONS: QualityOption[] = [
  { label: '标准画质', key: 'standard' },
  { label: '4K 高清', key: '4k' },
]

export const BANANA_SIZE_OPTIONS: SizeOption[] = [
  { label: '21:9', key: '21x9' },
  { label: '16:9', key: '16x9' },
  { label: '4:3', key: '4x3' },
  { label: '3:2', key: '3x2' },
  { label: '1:1', key: '1x1' },
  { label: '2:3', key: '2x3' },
  { label: '3:4', key: '3x4' },
  { label: '9:16', key: '9x16' },
  { label: '9:21', key: '9x21' },
]

export const VIDEO_RATIO_LIST: SizeOption[] = [
  { label: '16:9 (横版)', key: '16x9' },
  { label: '4:3', key: '4x3' },
  { label: '1:1 (方形)', key: '1x1' },
  { label: '3:4', key: '3x4' },
  { label: '9:16 (竖版)', key: '9x16' },
]

export const VIDEO_DURATION_OPTIONS: DurationOption[] = [
  { label: '5 秒', key: 5 },
  { label: '10 秒', key: 10 },
]

// 兼容旧代码的导出，避免类型引用报错。
export const IMAGE_MODELS: ImageModel[] = []
export const VIDEO_MODELS: VideoModel[] = []
export const CHAT_MODELS: ChatModel[] = []
export const DEFAULT_IMAGE_MODEL = ''
export const DEFAULT_VIDEO_MODEL = ''
export const DEFAULT_CHAT_MODEL = ''

const emptyCatalog: PublicModelCatalogResult = {
  providers: [],
  models: {
    chat: [],
    image: [],
    video: [],
  },
  defaults: {
    chat: '',
    image: '',
    video: '',
  },
}

const modelCatalogRef = ref<PublicModelCatalogResult>(emptyCatalog)
let modelCatalogPromise: Promise<PublicModelCatalogResult> | null = null
let modelCatalogLoaded = false

const toImageModel = (item: PublicModelCatalogItem): ImageModel => {
  const defaultParams = item.defaultParamsJson || {}
  const normalizedSize = String(defaultParams.size || '').trim().toLowerCase()
  const hasSeedreamSize = /\d+x\d+/.test(normalizedSize)
  const modes = (item.capabilityJson?.modes || {}) as Record<string, any>
  const sizes = [...new Set(Object.values(modes).flatMap(mode => {
    const schema = mode?.parameters_schema?.properties?.size
    return (schema?.enum || schema?.anyOf?.flatMap((option: any) => option.enum || []) || []) as string[]
  }))]

  // 单次出图最大张数：从 capabilityJson.maxImagesPerRequest 读取，未配置时缺省 1（最保守，
  // 防止跨上游误差直接打穿；管理员可在后台模型配置里覆写为对应上游的真实上限）。
  const capability = (item.capabilityJson || {}) as Record<string, unknown>
  const rawMaxImages = Number(capability.maxImagesPerRequest)
  const maxImagesPerRequest = Number.isFinite(rawMaxImages) && rawMaxImages >= 1
    ? Math.floor(rawMaxImages)
    : 1

  return {
    id: item.id,
    key: item.selectionKey,
    label: item.label,
    modelKey: item.modelKey,
    providerId: item.providerId,
    providerCode: item.providerCode,
    providerName: item.providerName,
    description: item.description,
    capabilityJson: item.capabilityJson,
    defaultParams,
    sortOrder: item.sortOrder,
    isDefault: item.isDefault,
    sizes: sizes.length ? sizes : [String(defaultParams.size || '')].filter(Boolean),
    maxImagesPerRequest,
    qualities: hasSeedreamSize ? SEEDREAM_QUALITY_OPTIONS : undefined,
    getSizesByQuality: hasSeedreamSize
      ? (quality: string) => quality === '4k' ? SEEDREAM_4K_SIZE_OPTIONS : SEEDREAM_SIZE_OPTIONS
      : undefined,
    tips: sizes.length ? undefined : '当前模型请在提示词中描述尺寸',
  }
}

const toVideoModel = (item: PublicModelCatalogItem): VideoModel => ({
  id: item.id,
  key: item.selectionKey,
  label: item.label,
  modelKey: item.modelKey,
  providerId: item.providerId,
  providerCode: item.providerCode,
  providerName: item.providerName,
  description: item.description,
  capabilityJson: item.capabilityJson,
  defaultParams: item.defaultParamsJson || {},
  sortOrder: item.sortOrder,
  isDefault: item.isDefault,
  ratios: runtimeVideoRatios(item),
  durs: runtimeVideoDurations(item),
})

const runtimeVideoSchema = (item: PublicModelCatalogItem) => {
  const modes = (item.capabilityJson?.modes || {}) as Record<string, any>
  return Object.values(modes)[0]?.parameters_schema?.properties || {}
}

const runtimeVideoRatios = (item: PublicModelCatalogItem): string[] => {
  const ratios = runtimeVideoSchema(item).ratio?.enum
  return Array.isArray(ratios) ? ratios.map(String) : VIDEO_RATIO_LIST.map(option => option.key)
}

const runtimeVideoDurations = (item: PublicModelCatalogItem): DurationOption[] => {
  const duration = runtimeVideoSchema(item).duration
  const minimum = Number(duration?.minimum ?? duration?.anyOf?.[0]?.minimum)
  const maximum = Number(duration?.maximum ?? duration?.anyOf?.[0]?.maximum)
  if (Number.isFinite(minimum) && Number.isFinite(maximum)) {
    return Array.from({ length: maximum - minimum + 1 }, (_, index) => {
      const value = minimum + index
      return { label: `${value} 秒`, key: value }
    })
  }
  return VIDEO_DURATION_OPTIONS
}

const toChatModel = (item: PublicModelCatalogItem): ChatModel => ({
  id: item.id,
  key: item.selectionKey,
  label: item.label,
  modelKey: item.modelKey,
  providerId: item.providerId,
  providerCode: item.providerCode,
  providerName: item.providerName,
  description: item.description,
  capabilityJson: item.capabilityJson,
  defaultParams: item.defaultParamsJson || {},
  sortOrder: item.sortOrder,
  isDefault: item.isDefault,
})

const sortModels = <T extends BaseCatalogModel>(models: T[]) => [...models].sort((first, second) => {
  if (first.sortOrder !== second.sortOrder) {
    return first.sortOrder - second.sortOrder
  }
  return first.label.localeCompare(second.label)
})

const applyModelCatalog = (value?: PublicModelCatalogResult) => {
  modelCatalogRef.value = value || emptyCatalog
  return modelCatalogRef.value
}

export const loadPublicModelCatalog = async (force = false) => {
  if (!force && modelCatalogLoaded) {
    return modelCatalogRef.value
  }
  if (!force && modelCatalogPromise) {
    return modelCatalogPromise
  }

  modelCatalogPromise = Promise.all([
    fetchRuntimeCatalog('/api/agent/models'),
    fetchRuntimeCatalog('/api/image-flows/information'),
    fetchRuntimeCatalog('/api/video-flows/information'),
  ])
    .then(([chat, image, video]) => {
      modelCatalogLoaded = true
      return applyModelCatalog(buildRuntimeCatalog(chat, image, video))
    })
    .catch(() => modelCatalogRef.value)

  return modelCatalogPromise
}

if (typeof window !== 'undefined') {
  window.addEventListener('auth:login-success', () => {
    void loadPublicModelCatalog(true)
  })
}

const fetchRuntimeCatalog = async (path: string): Promise<RuntimeCatalog> => {
  const response = await fetch(buildApiUrl(path), { cache: 'no-store', headers: getAuthHeaders() })
  if (!response.ok) throw new Error(`模型目录请求失败 (${response.status})`)
  return response.json()
}

const runtimeCatalogItem = (
  model: RuntimeCatalogModel,
  category: 'CHAT' | 'IMAGE' | 'VIDEO',
  index: number,
): PublicModelCatalogItem => {
  const modes = model.modes || {}
  const firstMode = Object.values(modes)[0] || {}
  const parametersSchema = model.parameters_schema || firstMode.parameters_schema || {}
  const sequential = parametersSchema.properties?.sequential_image_generation_options
  const maxImages = sequential?.properties?.max_images?.maximum
  return {
    id: model.id,
    selectionKey: model.id,
    providerId: 'adflow',
    providerCode: 'adflow',
    providerName: 'AdFlow',
    category,
    label: model.display_name || model.id,
    modelKey: model.id,
    description: [model.quality_tier, model.speed_tier].filter(Boolean).join(' / '),
    capabilityJson: {
      ...(model.capabilities || {}),
      modes,
      ...(maxImages ? { maxImagesPerRequest: maxImages } : {}),
    },
    defaultParamsJson: model.recommended_parameters || firstMode.recommended_parameters || {},
    sortOrder: index,
    isDefault: index === 0,
  }
}

const buildRuntimeCatalog = (
  chat: RuntimeCatalog,
  image: RuntimeCatalog,
  video: RuntimeCatalog,
): PublicModelCatalogResult => {
  const models = {
    chat: (chat.models || []).map((model, index) => runtimeCatalogItem(model, 'CHAT', index)),
    image: (image.models || []).map((model, index) => runtimeCatalogItem(model, 'IMAGE', index)),
    video: (video.models || []).map((model, index) => runtimeCatalogItem(model, 'VIDEO', index)),
  }
  return {
    providers: [{
      id: 'adflow',
      code: 'adflow',
      name: 'AdFlow',
      iconUrl: '',
      supportedTypes: ['CHAT', 'IMAGE', 'VIDEO'],
      sortOrder: 0,
    }],
    models,
    defaults: {
      chat: models.chat[0]?.selectionKey || '',
      image: models.image[0]?.selectionKey || '',
      video: models.video[0]?.selectionKey || '',
    },
  }
}

export const getPublicModelCatalog = () => modelCatalogRef.value

export const getAllImageModels = (): ImageModel[] => sortModels(modelCatalogRef.value.models.image.map(toImageModel))
export const getAllVideoModels = (): VideoModel[] => sortModels(modelCatalogRef.value.models.video.map(toVideoModel))
export const getAllChatModels = (): ChatModel[] => sortModels(modelCatalogRef.value.models.chat.map(toChatModel))

export const getDefaultImageModelKey = () => modelCatalogRef.value.defaults.image || getAllImageModels()[0]?.key || ''
export const getDefaultVideoModelKey = () => modelCatalogRef.value.defaults.video || getAllVideoModels()[0]?.key || ''
export const getDefaultChatModelKey = () => modelCatalogRef.value.defaults.chat || getAllChatModels()[0]?.key || ''

export const findCatalogModel = (key: string, category?: 'CHAT' | 'IMAGE' | 'VIDEO') => {
  const normalizedKey = String(key || '').trim()
  if (!normalizedKey) {
    return null
  }

  const groups = category
    ? [category === 'CHAT' ? modelCatalogRef.value.models.chat : category === 'IMAGE' ? modelCatalogRef.value.models.image : modelCatalogRef.value.models.video]
    : [modelCatalogRef.value.models.chat, modelCatalogRef.value.models.image, modelCatalogRef.value.models.video]

  for (const group of groups) {
    const matched = group.find(item => item.selectionKey === normalizedKey || item.modelKey === normalizedKey)
    if (matched) {
      return matched
    }
  }

  return null
}

export const resolveModelSelectionKey = (key: string, category?: 'CHAT' | 'IMAGE' | 'VIDEO') => {
  const matched = findCatalogModel(key, category)
  return matched?.selectionKey || ''
}

export const resolveRequestModelKey = (key: string, category?: 'CHAT' | 'IMAGE' | 'VIDEO') => {
  const matched = findCatalogModel(key, category)
  return matched?.modelKey || String(key || '').trim()
}

export const resolveRequestProviderId = (key: string, category?: 'CHAT' | 'IMAGE' | 'VIDEO') => {
  const matched = findCatalogModel(key, category)
  return matched?.providerId || ''
}

export const resolveModelLabel = (key: string, category?: 'CHAT' | 'IMAGE' | 'VIDEO') => {
  const matched = findCatalogModel(key, category)
  return matched?.label || String(key || '').trim()
}

export const getModelByName = (key: string) => {
  const matched = findCatalogModel(key)
  if (!matched) {
    return null
  }

  if (matched.category === 'IMAGE') {
    return toImageModel(matched)
  }

  if (matched.category === 'VIDEO') {
    return toVideoModel(matched)
  }

  return toChatModel(matched)
}
