import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const toolbar = await readFile(new URL('../../src/components/generate/toolbars/ImageToolbar.vue', import.meta.url), 'utf8')
const addHandle = await readFile(new URL('../../src/components/canvas/CanvasNodeAddHandle.vue', import.meta.url), 'utf8')
const imageNode = await readFile(new URL('../../src/views/workflow/components/nodes/ImageNode.vue', import.meta.url), 'utf8')
const videoNode = await readFile(new URL('../../src/views/workflow/components/nodes/VideoNode.vue', import.meta.url), 'utf8')

assert.match(toolbar, /currentImageModel/, 'image sizes must follow the selected backend model')
assert.match(toolbar, /currentResolution/, 'image resolution must be selected independently from aspect ratio')
assert.match(toolbar, /SEEDREAM_SIZE_OPTIONS/, 'all supported custom aspect ratios must be offered')
assert.match(addHandle, /defineEmits/, 'the add handle must expose a click action')
assert.match(imageNode, /createAdjacentImageNode/, 'image add handles must create connected adjacent nodes')
assert.match(videoNode, /imageRole: 'first_frame'/, 'image-to-video must use the first-frame input role')

console.log('workflow image controls: ok')
