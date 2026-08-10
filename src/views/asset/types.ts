export type TabType = 'image' | 'video'

export type ImageFilterType = 'all' | 'hd'
export type VideoFilterType = 'all'

export interface FilterOption<T extends string> {
  value: T
  label: string
  activeClass: string
}

export interface ImageItem {
  id: string
  src: string
  taskType?: string
  taskId?: string
  url?: string
  filename?: string
  contentType?: string
  promptText?: string
  modelLabel?: string
  aspectRatioLabel?: string
  resolutionLabel?: string
  featureLabel?: string
  createDate?: string
}

export interface ImageGroup {
  date: string
  isFirst?: boolean
  images: ImageItem[]
}
