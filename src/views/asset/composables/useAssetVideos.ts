import { computed, onScopeDispose, ref } from 'vue'
import { fetchAssetBlob, listAssetMedia, type AssetMedia } from '@/views/asset/api/assets'
import type { ImageGroup, ImageItem } from '@/views/asset/types'

const formatGroupDate = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知日期'
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export const useAssetVideos = () => {
  const videoGroups = ref<ImageGroup[]>([])
  const objectUrls = new Set<string>()

  const allVideos = computed(() => videoGroups.value.flatMap(group => group.images))

  const loadVideoAssets = async () => {
    try {
      const page = await listAssetMedia()
      const videos = await Promise.all(page.items
        .filter(item => item.content_type.startsWith('video/'))
        .map(async (item: AssetMedia): Promise<ImageItem | null> => {
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
            }
          } catch {
            return null
          }
        }))

      const groups = new Map<string, ImageItem[]>()
      videos.filter((item): item is ImageItem => item !== null).forEach((item) => {
        const key = formatGroupDate(item.createDate || '')
        const group = groups.get(key) || []
        group.push(item)
        groups.set(key, group)
      })
      videoGroups.value = Array.from(groups.entries()).map(([date, images], index) => ({
        date,
        isFirst: index === 0,
        images,
      }))
    } catch (error) {
      console.warn('读取视频资产失败。', error)
      videoGroups.value = []
    }
  }

  onScopeDispose(() => {
    objectUrls.forEach(URL.revokeObjectURL)
  })

  const resolvePreviewIndexByItemId = (itemId: string) => {
    return allVideos.value.findIndex(video => video.id === itemId)
  }

  return { allVideos, videoGroups, loadVideoAssets, resolvePreviewIndexByItemId }
}
