import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const [generator, toolbar, models, api, home, menu, centerMenu, topMenu, router, workflow, panel] = await Promise.all([
  read('src/components/generate/ContentGenerator.vue'),
  read('src/components/generate/toolbars/AgentToolbar.vue'),
  read('src/config/models.ts'),
  read('src/views/workflow/api/agent.ts'),
  read('src/components/home/components/HomeHeader.vue'),
  read('src/composables/useHomeSideMenuConfig.ts'),
  read('src/components/home/components/CenterMenu.vue'),
  read('src/components/home/components/TopMenuBar.vue'),
  read('src/router/index.ts'),
  read('src/views/workflow/index.vue'),
  read('src/views/workflow/components/AgentPanel.vue'),
])

assert.doesNotMatch(generator, /content-generator-submit/, 'Enter must not require login')
assert.match(home, /adflow:workflow:pending-message/, 'home must persist the pending Agent message')
assert.match(home, /path:\s*['"]\/workflow['"]/, 'home must open the Agent canvas')
assert.match(home, /initial-creation-type="agent"/, 'home must always submit through Agent mode')
assert.match(home, /hide-type-selector/, 'home must not expose skill or media modes')
assert.match(home, /hide-skill-selector/, 'home must not expose Agent skills')
assert.match(home, /hide-agent-actions/, 'home must not expose legacy Agent action switches')
assert.match(toolbar, /if \(props\.showAssistantSelector\) \{\s*void loadPublicSkillCatalog/s, 'hidden skills must not load the legacy catalog')
assert.match(models, /fetchRuntimeCatalog\(['"]\/api\/agent\/models['"]\)/, 'chat models must come from Agent Runtime')
assert.match(home, /model_id/, 'home must preserve the customer-selected model')
assert.match(api, /model_id:\s*modelId/, 'Agent requests must send the selected model')
assert.match(panel, /modelId/, 'Agent chat must keep using the selected model')
assert.match(menu, /title:\s*['"]创作['"]/s, 'legacy creation entries must be merged into one creation entry')
assert.match(menu, /actionValue:\s*['"]\/workflow['"]/s, 'the merged creation entry must open the AdFlow canvas')
assert.doesNotMatch(centerMenu, /agentic-assets-canvas/, 'side navigation must not open the legacy workflow gallery')
assert.doesNotMatch(topMenu, /agentic-assets-canvas/, 'top navigation must not open the legacy workflow gallery')
assert.match(router, /path:\s*['"]\/generate['"][\s\S]*redirect:\s*['"]\/workflow['"]/, 'legacy generate URLs must redirect to the canvas')
assert.doesNotMatch(home, /<TaskIndicator|import TaskIndicator/, 'home must not show the removed fake task button')
assert.match(workflow, /createSession/, 'workflow must create a session before sending')
assert.match(
  workflow,
  /if \(pendingAssistantMessage\.value \|\| !initialWorkflowId\)\s*\{[\s\S]*?createBareWorkflowSession\(/,
  'opening the bare canvas must create its Agent session immediately',
)
assert.match(workflow, /:session-id="currentWorkflowId \|\| ''"/, 'Agent panel must stay visible while a session is being created')
assert.match(workflow, /openLoginModal\(['"]workflow-session-create['"]\)/, 'unauthenticated canvas must show the existing login modal')
assert.match(panel, /ContentGenerator/, 'workflow Agent panel must reuse the original Chatbot composer')
assert.match(panel, /AssistantSessionList/, 'workflow Agent panel must preserve the original session menu')
assert.match(panel, /sessionChange/, 'workflow Agent panel must switch the shared Agent session')
assert.match(panel, /hide-type-selector/, 'workflow Agent panel must preserve the original composer without mode switching')
assert.match(panel, /modelKey/, 'workflow Agent panel must pass the selected model from the original toolbar')
assert.match(panel, /initialMessage/, 'Agent panel must consume the home message')

console.log('home Agent entry: ok')
