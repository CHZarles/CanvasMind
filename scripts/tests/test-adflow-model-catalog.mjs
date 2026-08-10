import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const models = await readFile(new URL('../../src/config/models.ts', import.meta.url), 'utf8')

assert.match(models, /auth:login-success/, 'model catalog must refresh after a successful login')
assert.match(models, /loadPublicModelCatalog\(true\)/, 'login refresh must bypass a failed catalog request')
assert.match(models, /modelCatalogLoaded/, 'a successful catalog request must be reused across mounted toolbars')

console.log('AdFlow model catalog refresh: ok')
