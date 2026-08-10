import { getAuthHeaders } from '@/api/auth'
import { buildApiUrl } from '@/api/http'

export interface AssetMedia {
  task_type: string
  task_id: string
  asset_id: string
  url: string
  prompt: string | null
  content_type: string
  filename: string
  created_at: string
}

export interface AssetMediaPage {
  items: AssetMedia[]
  total_count: number
  has_more: boolean
  next_offset: number | null
}

const authenticatedFetch = (path: string) => fetch(buildApiUrl(path), {
  headers: getAuthHeaders(),
  cache: 'no-store',
})

export const listAssetMedia = async (limit = 100, offset = 0) => {
  const response = await authenticatedFetch(`/api/assets/urls?limit=${limit}&offset=${offset}`)
  if (!response.ok) throw new Error(`读取资产失败 (${response.status})`)
  return response.json() as Promise<AssetMediaPage>
}

export const fetchAssetBlob = async (url: string) => {
  const response = await authenticatedFetch(url)
  if (!response.ok) throw new Error(`读取资产文件失败 (${response.status})`)
  return response.blob()
}

export const downloadAsset = async (asset: Pick<AssetMedia, 'url' | 'filename'>) => {
  const objectUrl = URL.createObjectURL(await fetchAssetBlob(asset.url))
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = asset.filename || 'asset'
  link.click()
  URL.revokeObjectURL(objectUrl)
}

export const deleteAsset = async (
  asset: Pick<AssetMedia, 'task_type' | 'task_id' | 'asset_id'>,
) => {
  const response = await fetch(buildApiUrl(
    `/api/tasks/${encodeURIComponent(asset.task_type)}/${encodeURIComponent(asset.task_id)}/assets?asset_id=${encodeURIComponent(asset.asset_id)}`,
  ), {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })
  if (!response.ok) throw new Error(`删除资产失败 (${response.status})`)
}
