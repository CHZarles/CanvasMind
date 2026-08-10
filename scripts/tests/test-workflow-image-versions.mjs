import assert from 'node:assert/strict'
import { appendImageVersion } from '../../src/views/workflow/composables/imageVersions.ts'

const original = {
  task_type: 'image_flow',
  task_id: 'task-1',
  asset_id: 'asset-1',
}
const generated = {
  task_type: 'image_flow',
  task_id: 'task-2',
  asset_id: 'asset-2',
}

assert.deepEqual(appendImageVersion([], original, '/asset-1', generated, '/asset-2'), [
  { id: 'asset-1', media_ref: original, url: '/asset-1' },
  { id: 'asset-2', media_ref: generated, url: '/asset-2' },
])

console.log('workflow image version checks passed')
