<script setup lang="ts">
/**
 * 图片节点（RunningHUB 风样板）
 *
 * 视觉对照 HTML 抽出的真实样式：
 *   - 卡片 380×280, border-radius 16
 *   - 标题外置（absolute bottom:100%）
 *   - 4 类状态：空态菜单 / ready-state（有上游连线）/ 加载 / 有图
 *   - 选中态：青绿描边 + 流光边框 + 模糊光晕
 *   - 节点外左右 -56px "+" 按钮
 *   - 选中后下方浮出 CanvasPromptInput（图片模型 + 尺寸/质量/价格 chip）
 *   - 保留批量生图组叠卡能力
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import {
  CopyDocument,
  Download,
  Delete,
  Picture,
  VideoCamera,
  PictureFilled,
  Upload as UploadIcon,
  ZoomIn,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import CanvasNodeHoverToolbar, { type NodeToolbarAction } from '@/components/canvas/CanvasNodeHoverToolbar.vue'
import CanvasNodeTopToolbar, { type NodeTopToolbarItem } from '@/components/canvas/CanvasNodeTopToolbar.vue'
import ContentGenerator from '@/components/generate/ContentGenerator.vue'
import CanvasNodeAddHandle from '@/components/canvas/CanvasNodeAddHandle.vue'
import { useNodeTitleEdit } from '@/composables/useNodeTitleEdit'
import {
  updateNode,
  removeNode,
  duplicateNode,
  addNode,
  addEdge,
  nodes,
  edges,
  type WorkflowImageNodeData,
} from '../../composables/useWorkflowCanvas'
import {
  generateCanvasNode,
  prepareImageNode,
  uploadNodeMedia,
} from '../../composables/useAgentRuntime'
import { loadMediaPreview } from '../../api/agent'
import { loadPublicModelCatalog } from '@/config/models'
import type { CanvasMediaReference } from '../../composables/imageVersions'

const props = defineProps<{
  id: string
  data: WorkflowImageNodeData & { selected?: boolean }
  selected?: boolean
}>()
const isSelected = computed(() => props.selected || props.data?.selected)
const titleEdit = useNodeTitleEdit(props.id, () => props.data?.label || 'Image')
const { updateNodeInternals, addSelectedNodes, removeSelectedNodes, getNodes } = useVueFlow()

const showActions = ref(false)
const imageUrl = ref(props.data?.url || '')
const isLoading = ref(!!props.data?.loading)
const errorMsg = ref(props.data?.error || '')
const fileInputRef = ref<HTMLInputElement | null>(null)
let ownedPreviewUrl = ''
const versionPreviewUrls = ref<Record<string, string>>({})
const ownedVersionPreviewUrls = new Set<string>()
let previewRequest = 0
let versionPreviewRequest = 0

const syncPreviewUrl = async (source: unknown) => {
  const request = ++previewRequest
  if (ownedPreviewUrl) {
    URL.revokeObjectURL(ownedPreviewUrl)
    ownedPreviewUrl = ''
  }
  const value = String(source || '')
  if (!value) {
    imageUrl.value = ''
    return
  }
  if (/\/api\//i.test(value) && !/^(blob|data):/i.test(value)) imageUrl.value = ''
  try {
    const resolved = await loadMediaPreview(value)
    if (request !== previewRequest) {
      if (resolved !== value && resolved.startsWith('blob:')) URL.revokeObjectURL(resolved)
      return
    }
    if (resolved !== value) ownedPreviewUrl = resolved
    imageUrl.value = resolved
  } catch {
    if (request === previewRequest) imageUrl.value = ''
  }
}

watch(
  [() => props.data?.loading, () => props.data?.error],
  ([loading, error]) => {
    if (loading !== undefined) isLoading.value = loading
    if (error !== undefined) errorMsg.value = error
  },
)
watch(() => props.data?.url, (url) => void syncPreviewUrl(url), { immediate: true })
watch(() => props.data?.media_versions, async versions => {
  const request = ++versionPreviewRequest
  ownedVersionPreviewUrls.forEach(url => URL.revokeObjectURL(url))
  ownedVersionPreviewUrls.clear()
  versionPreviewUrls.value = {}
  if (!Array.isArray(versions)) return
  const resolved = await Promise.all(versions.map(async version => {
    const source = String(version.url || '')
    try {
      const url = await loadMediaPreview(source)
      return [version.id, url, url !== source && url.startsWith('blob:')] as const
    } catch {
      return [version.id, '', false] as const
    }
  }))
  if (request !== versionPreviewRequest) {
    resolved.forEach(([, url, owned]) => {
      if (owned) URL.revokeObjectURL(url)
    })
    return
  }
  versionPreviewUrls.value = Object.fromEntries(resolved.map(([id, url]) => [id, url]))
  resolved.forEach(([, url, owned]) => {
    if (owned) ownedVersionPreviewUrls.add(url)
  })
}, { immediate: true })
onBeforeUnmount(() => {
  if (ownedPreviewUrl) URL.revokeObjectURL(ownedPreviewUrl)
  ownedVersionPreviewUrls.forEach(url => URL.revokeObjectURL(url))
})

// 上游连线检测：当 target=本节点 的边存在时，节点处于"已连接参考图片"状态
const hasUpstream = computed(() => edges.value.some((e) => e.target === props.id))

// 4 类状态优先级：加载 > 错误 > 有图 > ready-state（无图但有上游）> 空态菜单
const showLoading = computed(() => isLoading.value)
const showError = computed(() => !isLoading.value && !!errorMsg.value)
const showImage = computed(() => !isLoading.value && !errorMsg.value && !!imageUrl.value)
const showReady = computed(() => !showLoading.value && !showError.value && !showImage.value && hasUpstream.value)
const showEmpty = computed(() => !showLoading.value && !showError.value && !showImage.value && !showReady.value)

const triggerUpload = () => fileInputRef.value?.click()
const handleFileChange = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    isLoading.value = true
    updateNode(props.id, { loading: true })
    await uploadNodeMedia(props.id, file)
    imageUrl.value = URL.createObjectURL(file)
    autoCreateDownstreamImageNode()
  } catch (err) {
    ElMessage.error('图片上传失败')
    updateNode(props.id, { loading: false, error: '上传失败' })
    // eslint-disable-next-line no-console
    console.error('[ImageNode] upload failed', err)
  } finally {
    isLoading.value = false
    input.value = ''
  }
}

// 已有下游节点？
const hasDownstream = computed(() => edges.value.some((e) => e.source === props.id))

const createAdjacentImageNode = (side: 'left' | 'right') => {
  const node = nodes.value.find((item) => item.id === props.id)
  if (!node) return
  const siblings = edges.value.filter(edge => side === 'right' ? edge.source === props.id : edge.target === props.id)
  const newId = addNode('image', {
    x: node.position.x + (side === 'right' ? 480 : -480),
    y: node.position.y + siblings.length * 320,
  }, { label: 'Image' })
  addEdge({
    source: side === 'right' ? props.id : newId,
    target: side === 'right' ? newId : props.id,
    sourceHandle: 'right',
    targetHandle: 'left',
    type: 'imageOrder',
    data: { imageOrder: side === 'left' ? siblings.length + 1 : 1 },
  })
  setTimeout(() => {
    updateNodeInternals([newId])
    const allNodes = getNodes.value
    removeSelectedNodes(allNodes.filter((item) => item.selected))
    const target = allNodes.find((item) => item.id === newId)
    if (target) addSelectedNodes([target])
  }, 100)
}

/**
 * 自动创建一个下游 image 节点 + 连线，让画布进入 img_5 状态：
 * 「左侧已上传图片节点 → 右侧 ready-state Image 节点 + 底部 PromptInput（自动带 "图片1" 缩略 chip）」
 */
const autoCreateDownstreamImageNode = () => {
  if (hasDownstream.value) return
  createAdjacentImageNode('right')
}

const handleDownload = async () => {
  if (!imageUrl.value) return
  try {
    const res = await fetch(imageUrl.value)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `image_${Date.now()}.png`
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    window.open(imageUrl.value, '_blank')
  }
}

const handleDelete = () => removeNode(props.id)
const handleDuplicate = () => {
  const newId = duplicateNode(props.id)
  if (newId) setTimeout(() => updateNodeInternals([newId]), 50)
}

type ImageVersionItem = { id: string; url?: string; media_ref?: CanvasMediaReference }

const imageVersions = computed<ImageVersionItem[]>(() => (
  props.data?.media_versions?.length
    ? props.data.media_versions
    : props.data?.batchChildren || []
))

const activeImageId = computed(() => {
  const mediaRef = props.data?.media_ref
  return mediaRef && 'asset_id' in mediaRef
    ? mediaRef.asset_id
    : mediaRef?.attachment_id || props.data?.primaryImageId
})

// 多版本图片沿用节点已有的叠卡展示，不额外创建画布节点。
const isBatchGroupVisible = computed(() =>
  imageVersions.value.length > 1,
)
const batchChildCount = computed(() => imageVersions.value.length)
const toggleBatchExpanded = () => {
  if (!isBatchGroupVisible.value) return
  updateNode(props.id, { batchExpanded: !props.data?.batchExpanded })
}

const selectImageVersion = (version: ImageVersionItem) => {
  updateNode(props.id, {
    ...(version.media_ref ? { media_ref: version.media_ref } : {}),
    url: String(version.url || ''),
    primaryImageId: version.id,
  })
}

// 「尝试」菜单：图生图 / 图生视频 / 首帧图生视频
const requireImage = (): boolean => {
  if (imageUrl.value) return true
  ElMessage.info('请先上传图片，再使用该能力')
  triggerUpload()
  return false
}

const handleImageToImage = () => {
  if (!requireImage()) return
  // 已有图：直接创建下游占位节点；没图时 requireImage 已触发上传，handleFileChange 上传成功后会调 autoCreate
  autoCreateDownstreamImageNode()
}
const handleImageToVideo = (role: 'first_frame_image' | 'input_reference' = 'input_reference') => {
  if (!requireImage()) return
  const node = nodes.value.find((n) => n.id === props.id)
  if (!node) return
  const newId = addNode('video', { x: node.position.x + 480, y: node.position.y })
  addEdge({
    source: props.id,
    target: newId,
    sourceHandle: 'right',
    targetHandle: 'left',
    type: 'imageRole',
    data: { imageRole: role === 'first_frame_image' ? 'first_frame' : 'reference' },
  })
  setTimeout(() => updateNodeInternals([newId]), 50)
}
const hoverActions = computed<NodeToolbarAction[]>(() => {
  const list: NodeToolbarAction[] = [
    { id: 'duplicate', label: '复制', icon: CopyDocument, onClick: handleDuplicate },
  ]
  if (imageUrl.value) {
    list.push({ id: 'download', label: '下载', icon: Download, onClick: handleDownload })
  }
  list.push({ id: 'delete', label: '删除', icon: Delete, danger: true, onClick: handleDelete })
  return list
})

const emptyMenuItems = [
  { id: 'i2i', label: '图生图', icon: Picture, onClick: handleImageToImage },
  { id: 'i2v', label: '图生视频', icon: VideoCamera, onClick: () => handleImageToVideo('input_reference') },
  { id: 'first-frame', label: '首帧图生视频', icon: PictureFilled, onClick: () => handleImageToVideo('first_frame_image') },
]

onMounted(() => {
  void loadPublicModelCatalog()
})

const RASTER_REFERENCE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'])
const isRasterReferenceUrl = (url: string) => {
  if (!url || url.startsWith('data:image/')) return Boolean(url)
  const cleanUrl = url.split('?')[0].split('#')[0]
  const dotIndex = cleanUrl.lastIndexOf('.')
  return dotIndex < 0 || RASTER_REFERENCE_EXTENSIONS.has(cleanUrl.slice(dotIndex + 1).toLowerCase())
}
const upstreamReferenceUrls = computed(() => edges.value
  .filter(edge => edge.target === props.id)
  .map(edge => nodes.value.find(node => node.id === edge.source))
  .filter(node => node?.type === 'image')
  .map(node => String((node?.data as { url?: string })?.url || ''))
  .filter(isRasterReferenceUrl))

// 顶部悬浮工具栏（参照 RunningHUB .image-toolbar）：仅在选中 + 有图时显示
const topToolbarItems = computed<NodeTopToolbarItem[]>(() => [
  { id: 'download-mini', label: '下载', icon: Download, iconOnly: true, onClick: handleDownload },
  { id: 'preview', label: '放大预览', icon: ZoomIn, iconOnly: true, onClick: () => imageUrl.value && window.open(imageUrl.value, '_blank') },
])

// ContentGenerator 发送：用上游图作为参考 + 用户 prompt 调图生图，结果回填到当前节点
const isGenerating = ref(false)
const handlePromptSend = async (
  message: string,
  _type: string,
  options?: { modelKey?: string; ratio?: string; resolution?: string; size?: string; count?: number; referenceImages?: string[] },
) => {
  if (!message?.trim() || isGenerating.value) return
  isGenerating.value = true
  updateNode(props.id, { loading: true, error: '' })
  try {
    prepareImageNode(props.id, message, {
      count: options?.count,
      model: options?.modelKey,
      size: options?.size,
    })
    await generateCanvasNode(props.id, 'image')
  } catch (err: unknown) {
    console.error('[ImageNode] generation failed', err)
    const msg = err instanceof Error ? err.message : '图片生成失败'
    updateNode(props.id, { loading: false, error: msg })
  } finally {
    isGenerating.value = false
  }
}
</script>

<template>
  <div class="image-node-wrapper" @mouseenter="showActions = true" @mouseleave="showActions = false">
    <!-- 节点外置标题 -->
    <div class="image-node-title" :title="titleEdit.editing.value ? '' : '双击编辑名称'" @dblclick.stop="titleEdit.start">
      <el-icon class="image-node-title-icon"><Picture /></el-icon>
      <input
        v-if="titleEdit.editing.value"
        :ref="titleEdit.setInputRef"
        v-model="titleEdit.draft.value"
        class="image-node-title-input nodrag"
        :maxlength="40"
        @blur="titleEdit.commit"
        @keydown.enter.prevent="titleEdit.commit"
        @keydown.esc.prevent="titleEdit.cancel"
        @mousedown.stop
        @click.stop
      />
      <span v-else>{{ data?.label || 'Image' }}</span>
    </div>

    <!-- 节点本体 -->
    <div class="image-node-card" :class="{ 'is-selected': isSelected }">
      <!-- 选中态流光边框 -->
      <span v-if="isSelected" class="image-node-flow image-node-flow--ring" aria-hidden="true" />
      <span v-if="isSelected" class="image-node-flow image-node-flow--glow" aria-hidden="true" />

      <!-- 空态：尝试菜单 -->
      <div v-if="showEmpty" class="image-node-empty">
        <div class="image-node-empty-title">尝试：</div>
        <div class="image-node-empty-menu">
          <button
            v-for="item in emptyMenuItems"
            :key="item.id"
            type="button"
            class="image-node-empty-item nodrag nopan"
            @click.stop="item.onClick"
          >
            <el-icon class="image-node-empty-item-icon">
              <component :is="item.icon" />
            </el-icon>
            <span>{{ item.label }}</span>
          </button>
        </div>
        <button class="image-node-upload-pill nodrag nopan" @click.stop="triggerUpload">
          <el-icon><UploadIcon /></el-icon>
          <span>上传图片</span>
        </button>
      </div>

      <!-- ready-state：有上游连线但本节点没有图 -->
      <div v-else-if="showReady" class="image-node-ready">
        <div class="image-node-ready-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            <circle cx="8.5" cy="10" r="1.5" fill="currentColor" />
            <path d="M3 15L7 11L10 14L15 9L21 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
        <div class="image-node-ready-text">已连接参考图片</div>
        <div class="image-node-ready-hint">选中节点后在下方配置并生成</div>
      </div>

      <!-- 加载 -->
      <div v-else-if="showLoading" class="image-node-loading">
        <div class="image-node-spinner" />
        <span>生成中…</span>
      </div>

      <!-- 错误 -->
      <div v-else-if="showError" class="image-node-error" @click.stop="triggerUpload">
        <span>{{ errorMsg }}，点击重新上传</span>
      </div>

      <!-- 有图 -->
      <div
        v-else
        class="image-node-display"
        :class="{ 'is-batch-root': isBatchGroupVisible, 'is-batch-expanded': data?.batchExpanded }"
        @dblclick.stop="toggleBatchExpanded"
      >
        <template v-if="isBatchGroupVisible && !data?.batchExpanded">
          <div class="image-node-batch-frame image-node-batch-frame--2" aria-hidden="true" />
          <div class="image-node-batch-frame image-node-batch-frame--1" aria-hidden="true" />
        </template>
        <img :src="imageUrl" alt="生成图片" class="image-node-image" />
        <button
          class="image-node-replace-btn nodrag nopan"
          title="替换图片"
          @mousedown.stop
          @click.stop="triggerUpload"
        >
          <span class="image-node-replace-icon" aria-hidden="true">↑</span>
          <span>替换</span>
        </button>
        <span v-if="isBatchGroupVisible" class="image-node-batch-count" :title="`${batchChildCount} 个版本，双击展开/折叠`">
          {{ batchChildCount }}
        </span>
        <div v-if="isBatchGroupVisible && data?.batchExpanded" class="image-node-batch-grid">
          <div
            v-for="child in imageVersions"
            :key="child.id"
            class="image-node-batch-grid__item"
            :class="{ 'is-primary': child.id === activeImageId }"
            @click.stop
          >
            <img :src="versionPreviewUrls[child.id] || child.url" :alt="`图片版本 ${child.id}`" />
            <button
              class="image-node-batch-set-primary"
              title="切换到这个版本"
              @click.stop="selectImageVersion(child)"
            >
              ★
            </button>
          </div>
        </div>
      </div>

      <input
        ref="fileInputRef"
        type="file"
        accept="image/*"
        style="display: none"
        @change="handleFileChange"
      />
    </div>

    <CanvasNodeAddHandle side="left" :visible="isSelected" @click="createAdjacentImageNode" />
    <CanvasNodeAddHandle side="right" :visible="isSelected" @click="createAdjacentImageNode" />

    <CanvasNodeHoverToolbar :visible="showActions" :actions="hoverActions" />

    <!-- 选中态顶部悬浮工具栏（仅有图时显示） -->
    <CanvasNodeTopToolbar :visible="isSelected && showImage" :items="topToolbarItems" />

    <!-- 选中态下方浮出 prompt：节点只要不是生成中/报错，都可编辑自己的输入并生成或重生成。 -->
    <div v-if="isSelected && !showLoading && !showError" class="image-node-prompt-panel nodrag nopan" @mousedown.stop>
      <ContentGenerator
        layout="sidebar"
        :collapsible="false"
        :default-expanded="true"
        initial-creation-type="image"
        :hide-type-selector="true"
        :verbose-toolbar="true"
        :external-reference-images="upstreamReferenceUrls"
        placeholder-override="描述你想生成的图片内容，使用上游节点的图作为参考"
        popup-placement="top"
        @send="handlePromptSend"
      />
    </div>
  </div>
</template>

<style scoped>
.image-node-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
}

.image-node-title {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  margin-bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
  padding: 0 8px 0 2px;
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 15px;
  font-weight: 500;
  line-height: 22px;
  letter-spacing: 0.2px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.2s ease, color 0.2s ease;
}
.image-node-title:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}
.image-node-title-icon {
  font-size: 16px;
  color: var(--text-tertiary);
}
.image-node-title-input {
  flex: 1 1 0;
  min-width: 80px;
  max-width: 220px;
  background: transparent;
  border: 1px solid var(--brand-main-default);
  border-radius: 4px;
  padding: 1px 6px;
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 500;
  line-height: 22px;
  outline: none;
  box-sizing: border-box;
}

.image-node-card {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 380px;
  min-height: 280px;
  background: var(--canvas-node-bg);
  /*border: 1px solid var(--canvas-node-border);*/
  border-radius: 16px;
  padding: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  transition: border-color 0.16s, box-shadow 0.16s, min-width 0.2s ease;
}
/* 有图态：节点变宽，图片居中（参照 RunningHUB 生成结果布局 img_11） */
.image-node-card:has(.image-node-display) {
  min-width: 580px;
  min-height: 340px;
}
.image-node-card.is-selected {
  border-color: var(--canvas-selection-border);
  box-shadow: 0 0 0 2px var(--canvas-selection-border);
}

/* 流光边框 */
.image-node-flow {
  content: '';
  position: absolute;
  pointer-events: none;
  background-size: 200% 200%;
  animation: image-node-flowing 2.4s linear infinite;
}
.image-node-flow--ring {
  inset: -2px;
  border-radius: 18px;
  background: linear-gradient(
    90deg,
    transparent,
    transparent 20%,
    rgba(2, 219, 163, 0.45) 40%,
    #02dba3 50%,
    rgba(2, 219, 163, 0.45) 60%,
    transparent 80%,
    transparent
  );
  z-index: -1;
}
.image-node-flow--glow {
  inset: -6px;
  border-radius: 22px;
  background: linear-gradient(
    90deg,
    transparent,
    transparent 20%,
    rgba(2, 219, 163, 0.18) 40%,
    rgba(2, 219, 163, 0.42) 50%,
    rgba(2, 219, 163, 0.18) 60%,
    transparent 80%,
    transparent
  );
  filter: blur(8px);
  z-index: -2;
}
@keyframes image-node-flowing {
  0% { background-position: 100% 50%; }
  100% { background-position: -100% 50%; }
}

/* 空态菜单 */
.image-node-empty {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  justify-content: center;
  padding: 20px;
}
.image-node-empty-title {
  color: var(--text-tertiary);
  font-size: 13px;
  margin-bottom: 16px;
  margin-left: 10px;
}
.image-node-empty-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.image-node-empty-item {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  background: transparent;
  border: 0;
  color: var(--text-secondary);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  border-radius: 16px;
  width: fit-content;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.image-node-empty-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}
.image-node-empty-item-icon {
  font-size: 18px;
  width: 24px;
  text-align: center;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.image-node-empty-item:hover .image-node-empty-item-icon {
  color: var(--text-primary);
}
.image-node-upload-pill {
  margin-top: auto;
  margin-left: 10px;
  margin-right: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 0;
  background: var(--canvas-float-block-default);
  border: 0.5px solid var(--stroke-secondary);
  border-radius: 16px;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.12s, color 0.12s;
}
.image-node-upload-pill:hover {
  background: var(--canvas-float-block-hover);
  color: var(--brand-main-default);
}

/* ready-state（有上游连线但空图）*/
.image-node-ready {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-tertiary);
  padding: 24px;
}
.image-node-ready-icon {
  color: var(--text-tertiary);
  opacity: 0.6;
}
.image-node-ready-text {
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
}
.image-node-ready-hint {
  color: var(--text-tertiary);
  font-size: 12px;
}

/* 加载 / 错误 */
.image-node-loading,
.image-node-error {
  flex: 1 1 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-tertiary);
  font-size: 12px;
}
.image-node-error {
  color: #ef4444;
  cursor: pointer;
}
.image-node-spinner {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--stroke-secondary);
  border-top-color: var(--brand-main-default);
  animation: image-node-spin 0.8s linear infinite;
}
@keyframes image-node-spin {
  to { transform: rotate(360deg); }
}

/* 批量组叠卡 / 有图态：图片居中，最大尺寸限制让节点周围有黑色边距（参照 img_11） */
.image-node-display {
  position: relative;
  flex: 1 1 0;
  display: inline-flex;
  justify-content: center;
  overflow: hidden;
}
.image-node-image {
  max-width: 320px;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  position: relative;
  z-index: 1;
  border-radius: var(--lv-border-radius-medium);
}
.image-node-batch-frame {
  position: absolute;
  inset: 0;
  background: var(--canvas-bg-block-default);
  border: 0.5px solid var(--stroke-secondary);
  border-radius: var(--lv-border-radius-medium);
  pointer-events: none;
}
.image-node-batch-frame--1 {
  transform: translate(-4px, -4px) rotate(-2deg);
  z-index: 0;
  opacity: 0.6;
}
.image-node-batch-frame--2 {
  transform: translate(-8px, -8px) rotate(-4deg);
  z-index: -1;
  opacity: 0.32;
}
.image-node-batch-count {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  padding: 1px 8px;
  background: var(--brand-main-default);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  pointer-events: none;
}
.image-node-batch-grid {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
  gap: 6px;
  padding: 8px;
  background: var(--canvas-float-block-default);
  border-radius: var(--lv-border-radius-medium);
  overflow-y: auto;
  z-index: 3;
}
.image-node-batch-grid__item {
  position: relative;
  aspect-ratio: 1 / 1;
  background: var(--canvas-image-loading-start);
  border-radius: var(--lv-border-radius-small);
  overflow: hidden;
  border: 1.5px solid transparent;
  transition: border-color 0.12s;
}
.image-node-batch-grid__item:hover,
.image-node-batch-grid__item.is-primary {
  border-color: var(--brand-main-default);
}
.image-node-batch-grid__item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.image-node-batch-set-primary {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  background: var(--canvas-float-block-default);
  border: 0.5px solid var(--stroke-secondary);
  border-radius: 50%;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.image-node-batch-grid__item.is-primary .image-node-batch-set-primary {
  background: var(--brand-main-default);
  color: #fff;
  border-color: var(--brand-main-default);
}

/* 替换按钮（有图态右上角） */
.image-node-replace-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--canvas-float-block-default, rgba(30, 30, 30, 0.9));
  border: 1px solid var(--stroke-secondary);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: background-color 0.2s, border-color 0.2s, color 0.2s;
}
.image-node-replace-btn:hover {
  background: var(--canvas-float-block-hover, var(--bg-block-primary-hover, rgba(50, 50, 50, 0.95)));
  border-color: var(--brand-main-default);
  color: var(--brand-main-default);
}
.image-node-replace-icon {
  font-size: 14px;
  line-height: 1;
}

/* 左右 Handle 隐藏（用 .image-node-add-btn 替代） */
.image-node-handle {
  width: 1px !important;
  height: 1px !important;
  opacity: 0 !important;
  pointer-events: none !important;
  border: 0 !important;
  background: transparent !important;
}

/* 外置 "+" 按钮 */
.image-node-add-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 56px;
  height: 56px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  border-radius: 50%;
  color: var(--text-tertiary);
  cursor: pointer;
  z-index: 10;
  transition: transform 0.2s, color 0.2s;
}
.image-node-add-btn--left { left: -56px; }
.image-node-add-btn--right { right: -56px; }
.image-node-add-btn__icon {
  width: 20px;
  height: 20px;
  padding: 3px;
  border: 1px solid currentColor;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: content-box;
}
.image-node-add-btn:hover { color: var(--text-primary); }
.image-node-add-btn:active { transform: translateY(-50%) scale(0.95); }

/* 节点下方浮出 prompt */
.image-node-prompt-panel {
  position: absolute;
  top: calc(100% + 12px);
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  min-width: 540px;
  max-width: 760px;
  z-index: 5;
}
</style>
