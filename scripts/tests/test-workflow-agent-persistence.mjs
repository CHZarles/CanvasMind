import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(
  new URL('../../src/views/workflow/composables/useWorkflowPersistence.ts', import.meta.url),
  'utf8',
)

assert.doesNotMatch(
  source,
  /structuredClone\((?:nodes|edges)\.value\)/,
  'Vue reactive canvas state must be serialized before cloning',
)

assert.match(source, /typeof data\.loading === 'boolean'/, 'canvas snapshots must persist node loading state')
assert.match(source, /executionStatus === 'running'/, 'a terminal server execution must clear stale local loading state')

console.log('workflow Agent persistence: ok')
