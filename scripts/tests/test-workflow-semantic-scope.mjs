import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [page, canvas, textNode, imageNode, videoNode] = await Promise.all([
  readFile(new URL('../../src/views/workflow/index.vue', import.meta.url), 'utf8'),
  readFile(new URL('../../src/views/workflow/composables/useWorkflowCanvas.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../src/views/workflow/components/nodes/TextNode.vue', import.meta.url), 'utf8'),
  readFile(new URL('../../src/views/workflow/components/nodes/ImageNode.vue', import.meta.url), 'utf8'),
  readFile(new URL('../../src/views/workflow/components/nodes/VideoNode.vue', import.meta.url), 'utf8'),
])

for (const source of [page, canvas, textNode, imageNode, videoNode]) {
  assert.doesNotMatch(source, /imageConfig|videoConfig|llmConfig/, '旧配置节点不能再出现在 Agent 画布')
  assert.doesNotMatch(source, /接入中|敬请期待/, '画布节点不能保留不可用的占位按钮')
}

assert.doesNotMatch(page, /WORKFLOW_TEMPLATES|工作流模板/, '强组合工作流模板入口必须移除')
assert.doesNotMatch(textNode, /图片反推提示词/, '未接入的反推提示词入口必须移除')
assert.doesNotMatch(imageNode, /图片换背景|全景图|HD 增强|编辑元素|角度|打光|裁剪|加入 Agent/, '未接入的图片操作必须移除')
assert.doesNotMatch(videoNode, /全能参考|首尾帧生视频/, '未接入的视频操作必须移除')
assert.match(
  imageNode,
  /v-if="isSelected && !showLoading && !showError"/,
  '图片节点选中后必须能编辑自己的生成输入，包括无上游输入的节点',
)

console.log('workflow semantic scope: ok')
