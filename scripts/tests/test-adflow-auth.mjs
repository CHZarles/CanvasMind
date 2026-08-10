import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [source, agent, app, account, menu, router] = await Promise.all([
  readFile(new URL('../../src/api/auth.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../src/views/workflow/api/agent.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../../src/views/account/AccountManagement.vue', import.meta.url), 'utf8'),
  readFile(new URL('../../src/composables/useHomeSideMenuConfig.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../src/router/index.ts', import.meta.url), 'utf8'),
])

assert.match(source, /\/api\/emailLogin/, 'email/password login must use the AdFlow auth proxy')
assert.match(source, /\/api\/auth\/token\/verify/, 'saved bearer tokens must be verified by AdFlow')
assert.doesNotMatch(source, /AUTH_BASE_PATH}\/login/, 'the removed CanvasMind session API must not be called')
assert.match(agent, /getAuthHeaders/, 'Agent requests must carry the authenticated user token')
assert.match(app, /<LoginModal/, 'the retained account system needs a global login dialog')
assert.doesNotMatch(app, /<MarketingModal/, 'the removed benefits system must not remain mounted')
assert.match(app, /authStore\.loadSession\(\)/, 'saved login state must be restored on reload')
assert.doesNotMatch(account, /asset-items|已发布|赞过|AI短片/, 'account must not call the removed gallery backend')
assert.match(menu, /item\.key !== 'publish'/, 'the removed publish entry must be filtered from navigation')
assert.doesNotMatch(router, /path:\s*['"]\/publish['"]/, 'the removed publish page must not stay routable')

console.log('AdFlow auth adapter: ok')
