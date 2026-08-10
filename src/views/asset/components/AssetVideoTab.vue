<template>
  <div class="content-1rx" :class="{ 'hidden-w3p': !active }">
    <div class="tab-entry-mxq">
      <div class="image-yhz">
        <div class="history-vxc">
          <div class="header-2ov">
            <div class="container-c5d">
              <div class="operatePanel-rz9">
                <div class="categoryContainer-g3l">
                  <span
                    v-for="option in videoFilterOptions"
                    :key="option.value"
                    :class="{ [option.activeClass]: videoFilter === option.value }"
                    @click="emit('set-video-filter', option.value)"
                  >
                    {{ option.label }}
                  </span>
                </div>
                <div v-if="isBatchMode" class="operationWrap-oqo">
                  <div class="select-zkx text-5vo">已选择 {{ selectedCount }} 项内容</div>
                  <div class="style-ctWQJ"></div>
                  <button class="btn-7n1 btn-secondary-y4e btn-rec btn-3qb" type="button" :disabled="selectedCount === 0" @click="emit('batch-delete')">
                    <span class="text-5vo">删除</span>
                  </button>
                  <button class="btn-7n1 btn-secondary-y4e btn-rec btn-3qb" type="button" :disabled="selectedCount === 0" @click="emit('batch-download')">
                    <span class="text-5vo">下载</span>
                  </button>
                  <div class="select-rfs" @click="emit('exit-batch-mode')">取消选择</div>
                </div>
                <div v-else class="operationWrap-431">
                  <div class="operateArea-aqq">
                    <div class="btn-g4h" @click="emit('enter-batch-mode')">批量操作</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="videoGroups.length" class="image-s9z">
            <div class="vList-q9n">
              <template v-for="group in videoGroups" :key="group.date">
                <div class="container-c5d">
                  <div class="time-gcp" :class="{ 'first-fo4': group.isFirst }">{{ group.date }}</div>
                </div>
                <div class="row-zep">
                  <div class="container-c5d">
                    <div class="image-qvw">
                      <div
                        v-for="video in group.images"
                        :key="video.id"
                        class="image-bqm"
                        :class="{ 'select-1kz': isBatchMode && isSelected(video.id) }"
                        @click="emit('asset-click', video.id)"
                      >
                        <video class="image-w9g" :src="video.src" muted preload="metadata"></video>
                        <div v-if="isBatchMode" class="select-av5">
                          <span v-if="isSelected(video.id)">✓</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>
          <div v-else class="video-cv8">
            <div class="empty-page-ij3">
              <img src="https://lf3-lv-buz.vlabstatic.com/obj/image-lvweb-buz/ies/lvweb/dreamina_cn/static/image/empty-image-dark.6e788cae.png" class="image-eyv">
              <div class="description-96w">暂无相关资产</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { FilterOption, ImageGroup, VideoFilterType } from '@/views/asset/types'

defineProps<{
  active: boolean
  videoFilterOptions: FilterOption<VideoFilterType>[]
  videoFilter: VideoFilterType
  isBatchMode: boolean
  selectedCount: number
  videoGroups: ImageGroup[]
  isSelected: (itemId: string) => boolean
}>()

const emit = defineEmits<{
  'set-video-filter': [filter: VideoFilterType]
  'batch-delete': []
  'batch-download': []
  'enter-batch-mode': []
  'exit-batch-mode': []
  'asset-click': [itemId: string]
}>()
</script>
