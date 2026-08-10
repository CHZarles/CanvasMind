<template>
  <FrontstagePageShell>
    <!-- 资产管理容器 -->
    <div class="entryContainer-fe9">
      <div class="header-2ov">
        <div class="container-c5d">
          <div class="tabs-y6n">
            <div
                v-for="tab in tabs"
                :key="tab.id"
                class="tabItem-mls"
                :class="{ 'active-2nk': activeTab === tab.id }"
                @click="switchTab(tab.id)"
            >
              {{ tab.label }}
            </div>
          </div>
        </div>
      </div>
      <AssetImageTab
          v-if="activeTab === 'image'"
          :image-filter-options="imageFilterOptions"
          :image-filter="imageFilter"
          :is-batch-mode="isBatchMode"
          :selected-count="selectedCount"
          :image-groups="imageGroups"
          :is-selected="isSelected"
          @set-image-filter="setImageFilter"
          @batch-delete="handleBatchDelete"
          @batch-download="handleBatchDownload"
          @enter-batch-mode="enterBatchMode"
          @exit-batch-mode="exitBatchMode"
          @asset-click="handleAssetClick"
      />
      <AssetVideoTab
          :active="activeTab === 'video'"
          :video-filter-options="videoFilterOptions"
          :video-filter="videoFilter"
          :is-batch-mode="isBatchMode"
          :selected-count="selectedCount"
          :video-groups="videoGroups"
          :is-selected="isSelected"
          @set-video-filter="setVideoFilter"
          @batch-delete="handleBatchDelete"
          @batch-download="handleBatchDownload"
          @enter-batch-mode="enterBatchMode"
          @exit-batch-mode="exitBatchMode"
          @asset-click="handleAssetClick"
      />
    </div>

    <template #after>
      <ImagePreview
          v-model:visible="previewVisible"
          v-model:currentIndex="previewIndex"
          :images="previewItems"
          :show-favorite="false"
          :show-publish="false"
          @download="handlePreviewDownload"
          @generate-video="handlePreviewGenerateVideo"
          @edit-in-canvas="handlePreviewEditInCanvas"
      />
    </template>
  </FrontstagePageShell>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import ImagePreview from '@/components/ImagePreview.vue'
import FrontstagePageShell from '@/components/layout/FrontstagePageShell.vue'
import AssetImageTab from '@/views/asset/components/AssetImageTab.vue'
import AssetVideoTab from '@/views/asset/components/AssetVideoTab.vue'
import { useAssetImages } from '@/views/asset/composables/useAssetImages'
import { useAssetVideos } from '@/views/asset/composables/useAssetVideos'
import {
  tabs,
  imageFilterOptions,
  videoFilterOptions,
} from '@/views/asset/constants'
import { deleteAsset, downloadAsset } from '@/views/asset/api/assets'
import { AUTH_LOGIN_SUCCESS_EVENT } from '@/stores/auth'
import type {
  ImageFilterType,
  ImageItem,
  TabType,
  VideoFilterType,
} from '@/views/asset/types'

// 标签页状态
const activeTab = ref<TabType>('image')

// 筛选状态
const imageFilter = ref<ImageFilterType>('all')
const videoFilter = ref<VideoFilterType>('all')

// 批量操作模式状态
const isBatchMode = ref<boolean>(false)

// 选择状态管理
const selectedItems = ref<Set<string>>(new Set())

// 图片预览状态
const previewVisible = ref<boolean>(false)
const previewIndex = ref<number>(0)
const previewItems = ref<ImageItem[]>([])

const { imageGroups, allImages, loadImageAssets, resolvePreviewIndexByItemId } = useAssetImages()
const { videoGroups, allVideos, loadVideoAssets, resolvePreviewIndexByItemId: resolveVideoPreviewIndexByItemId } = useAssetVideos()

const activeItems = computed(() => activeTab.value === 'video' ? allVideos.value : allImages.value)

// 选中数量计算属性
const selectedCount = computed(() => selectedItems.value.size)

// 切换选择状态
const toggleSelection = (itemId: string) => {
  if (!isBatchMode.value) return

  if (selectedItems.value.has(itemId)) {
    selectedItems.value.delete(itemId)
  } else {
    selectedItems.value.add(itemId)
  }
  // 触发响应式更新
  selectedItems.value = new Set(selectedItems.value)
}

// 清空选择
const clearSelection = () => {
  selectedItems.value.clear()
  selectedItems.value = new Set()
}

// 进入批量操作模式
const enterBatchMode = () => {
  isBatchMode.value = true
}

// 退出批量操作模式
const exitBatchMode = () => {
  isBatchMode.value = false
  clearSelection()
}

// 检查是否选中
const isSelected = (itemId: string) => {
  return selectedItems.value.has(itemId)
}

// 处理资产项点击（区分批量模式和正常模式）
const handleAssetClick = (itemId: string) => {
  if (isBatchMode.value) {
    // 批量操作模式：切换选择状态
    toggleSelection(itemId)
  } else {
    // 正常模式：打开预览
    openPreview(itemId)
  }
}

// 打开图片预览
const openPreview = (itemId: string) => {
  const index = activeTab.value === 'video'
    ? resolveVideoPreviewIndexByItemId(itemId)
    : resolvePreviewIndexByItemId(itemId)
  if (index !== -1) {
    previewItems.value = activeItems.value
    previewIndex.value = index
    previewVisible.value = true
  }
}

const loadAssets = async () => {
  await Promise.all([loadImageAssets(), loadVideoAssets()])
}

// 登录成功后的页面数据刷新监听器。
let authLoginSuccessListener: (() => void) | null = null

onMounted(async () => {
  await loadAssets()

  authLoginSuccessListener = () => {
    void loadAssets()
  }
  window.addEventListener(AUTH_LOGIN_SUCCESS_EVENT, authLoginSuccessListener)
})

onBeforeUnmount(() => {
  if (authLoginSuccessListener) {
    window.removeEventListener(AUTH_LOGIN_SUCCESS_EVENT, authLoginSuccessListener)
    authLoginSuccessListener = null
  }
})

// 切换标签页
const switchTab = (tab: TabType) => {
  activeTab.value = tab
}

// 设置筛选条件
const setImageFilter = (filter: ImageFilterType) => {
  imageFilter.value = filter
}

const setVideoFilter = (filter: VideoFilterType) => {
  videoFilter.value = filter
}

// 批量操作处理函数
const handleBatchDelete = async () => {
  const itemIds = Array.from(selectedItems.value)
  if (!itemIds.length) return

  const items = activeItems.value.filter(item => selectedItems.value.has(item.id) && item.taskType && item.taskId && item.url)
  await Promise.all(items.map(item => deleteAsset({
    task_type: item.taskType!,
    task_id: item.taskId!,
    asset_id: item.id,
  })))
  await loadAssets()
  exitBatchMode()
  ElMessage.success(`已删除 ${items.length} 项内容`)
}

const handleBatchDownload = async () => {
  const itemIds = Array.from(selectedItems.value)
  if (!itemIds.length) return

  const items = activeItems.value.filter(item => selectedItems.value.has(item.id) && item.url)
  await Promise.all(items.map(item => downloadAsset({ url: item.url!, filename: item.filename || item.id })))
  ElMessage.success(`已下载 ${items.length} 项内容`)
}

// 监听标签页切换，退出批量操作模式
watch(activeTab, () => {
  exitBatchMode()
})

// 图片预览事件处理
const handlePreviewDownload = (image: ImageItem) => {
  if (!image.url) return
  void downloadAsset({ url: image.url, filename: image.filename || image.id }).then(() => ElMessage.success('下载完成'))
}

const handlePreviewGenerateVideo = (image: ImageItem) => {
  console.log('生成视频:', image)
  ElMessage.info('开始生成视频')
  // TODO: 实现生成视频逻辑
}

const handlePreviewEditInCanvas = (image: ImageItem) => {
  console.log('去画布编辑:', image)
  ElMessage.info('打开画布编辑器')
  // TODO: 实现画布编辑逻辑
}
</script>

<style>
@import "./AssetManagement.css";
</style>
