import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const [api, images, videos, page, constants, imageTab, videoTab, preview] = await Promise.all([
  read('src/views/asset/api/assets.ts'),
  read('src/views/asset/composables/useAssetImages.ts'),
  read('src/views/asset/composables/useAssetVideos.ts'),
  read('src/views/asset/AssetManagement.vue'),
  read('src/views/asset/constants.ts'),
  read('src/views/asset/components/AssetImageTab.vue'),
  read('src/views/asset/components/AssetVideoTab.vue'),
  read('src/components/ImagePreview.vue'),
])

assert.match(api, /\/api\/assets\/urls/, 'asset media must come from AdFlow')
assert.match(api, /getAuthHeaders/, 'asset requests must use the AdFlow bearer token')
assert.match(api, /method: 'DELETE'/, 'asset deletion must use the AdFlow delete endpoint')
assert.match(images, /listAssetMedia/, 'the image list must use the AdFlow asset adapter')
assert.match(videos, /listAssetMedia/, 'the video list must use the AdFlow asset adapter')
assert.match(videos, /video\//, 'the video list must filter video assets')
assert.match(videoTab, /videoGroups|<video/, 'the video tab must render AdFlow video assets')
assert.match(videoTab, /batch-delete|batch-download/, 'the video tab must expose supported batch operations')
assert.match(preview, /controls/, 'media preview must provide native video playback controls')
assert.match(page, /useAssetVideos|allVideos/, 'the asset page must load AdFlow video assets')
assert.doesNotMatch(page, /@\/api\/asset-items/, 'the asset page must not call the legacy backend')
assert.match(page, /deleteAsset/, 'the asset page must use the AdFlow delete endpoint')
assert.doesNotMatch(page, /暂不支持删除资产/, 'asset deletion must be functional')
assert.doesNotMatch(constants, /favorite|收藏/, 'asset filters must not expose unsupported favorites')
assert.doesNotMatch(imageTab, /batch-favorite|收藏/, 'asset batch actions must not expose unsupported favorites')
assert.match(page, /:show-favorite="false"/, 'the asset preview must hide unsupported favorites')
assert.match(preview, /showFavorite/, 'the shared preview must support hiding favorites')
assert.doesNotMatch(imageTab, /batch-publish|提交审核/, 'asset batch actions must not expose unsupported publishing')
assert.doesNotMatch(page, /PublishArtworkModal|handleBatchPublish|handlePreviewPublish/, 'the asset page must not keep publishing handlers')
assert.match(page, /:show-publish="false"/, 'the asset preview must hide unsupported publishing')
assert.match(preview, /showPublish/, 'the shared preview must support hiding publishing')
assert.doesNotMatch(`${page}${imageTab}${videoTab}`, /剪映|capcut|edit-in-capcut/i, 'asset pages must not expose CapCut actions')
assert.doesNotMatch(page, /AssetAudioTab|audioFilter|音频/, 'asset page must not expose unsupported audio assets')
assert.doesNotMatch(constants, /audioFilterOptions|音频/, 'asset constants must not expose unsupported audio assets')
assert.doesNotMatch(page, /AssetStoryTab|storyFilter|故事/, 'asset page must not expose unsupported story assets')
assert.doesNotMatch(constants, /storyFilterOptions|故事/, 'asset constants must not expose unsupported story assets')
assert.doesNotMatch(page, /AssetEditorTab|editorFilter|图片编辑器/, 'asset page must not expose unsupported editor assets')
assert.doesNotMatch(constants, /editorFilterOptions|图片编辑器/, 'asset constants must not expose unsupported editor assets')
assert.doesNotMatch(page, /AssetCanvasTab|canvasFilter|无限画布/, 'asset page must not expose workflow canvases as assets')
assert.doesNotMatch(constants, /canvasFilterOptions|无限画布/, 'asset constants must not expose workflow canvases as assets')

console.log('AdFlow assets: ok')
