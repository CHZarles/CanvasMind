import type {
  FilterOption,
  ImageFilterType,
  TabType,
  VideoFilterType,
} from './types'

export const tabs: Array<{ id: TabType; label: string }> = [
  { id: 'image', label: '图片' },
  { id: 'video', label: '视频' },
]

export const imageFilterOptions: FilterOption<ImageFilterType>[] = [
  { value: 'all', label: '所有图片', activeClass: 'active-rpp' },
  { value: 'hd', label: '超清', activeClass: 'active-rpp' },
]

export const videoFilterOptions: FilterOption<VideoFilterType>[] = [
  { value: 'all', label: '所有视频', activeClass: 'active-chb' },
]
