import { computed, onScopeDispose, ref } from 'vue'
import { fetchAssetBlob, listAssetMedia, type AssetMedia } from '@/views/asset/api/assets'
import type { ImageGroup, ImageItem } from '@/views/asset/types'

const formatGroupDate = (value: string | Date) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知日期'
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

const buildImageGroups = (items: Array<ImageItem & { createdAt?: string }>) => {
  const groups = new Map<string, ImageItem[]>()

  items.forEach((item) => {
    const groupKey = formatGroupDate(item.createdAt || new Date().toISOString())
    const current = groups.get(groupKey) || []
    current.push(item)
    groups.set(groupKey, current)
  })

  return Array.from(groups.entries()).map(([date, images], index) => ({
    date,
    isFirst: index === 0,
    images,
  }))
}

export const useAssetImages = () => {
  const imageGroups = ref<ImageGroup[]>([])
  const objectUrls = new Set<string>()

  const allImages = computed(() => imageGroups.value.flatMap(group => group.images))

  const loadImageAssets = async () => {
    try {
      const page = await listAssetMedia()
      const images = await Promise.all(page.items
        .filter(item => item.content_type.startsWith('image/'))
        .map(async (item: AssetMedia) => {
          try {
            const src = URL.createObjectURL(await fetchAssetBlob(item.url))
            objectUrls.add(src)
            return {
              id: item.asset_id,
              src,
              taskType: item.task_type,
              taskId: item.task_id,
              url: item.url,
              filename: item.filename,
              contentType: item.content_type,
              promptText: item.prompt || '',
              modelLabel: item.task_type,
              createDate: item.created_at,
              createdAt: item.created_at,
            }
          } catch {
            return null
          }
        }))

      imageGroups.value = buildImageGroups(images.filter(item => item !== null))
    } catch (error) {
      console.warn('读取资产列表失败。', error)
      imageGroups.value = []
    }
  }

  onScopeDispose(() => {
    objectUrls.forEach(URL.revokeObjectURL)
  })

  const resolvePreviewIndexByItemId = (itemId: string) => {
    return allImages.value.findIndex(img => img.id === itemId)
  }

  return {
    allImages,
    imageGroups,
    loadImageAssets,
    resolvePreviewIndexByItemId,
  }
}
