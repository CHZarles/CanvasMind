import assert from 'node:assert/strict'

const api = process.env.ADFLOW_API_URL || 'http://127.0.0.1:8040'
const web = process.env.ADFLOW_WEB_URL || 'http://127.0.0.1:5010'
const cdp = process.env.ADFLOW_CDP_URL || 'http://127.0.0.1:9225'
const authHeaders = process.env.ADFLOW_AUTH_TOKEN
  ? { Authorization: `Bearer ${process.env.ADFLOW_AUTH_TOKEN}` }
  : {}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

let created
for (let attempt = 1; attempt <= 5; attempt += 1) {
  created = await fetch(`${api}/api/agent/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ title: 'canvas sync regression test' }),
  })
  if (created.ok || created.status < 500) break
  await sleep(attempt * 500)
}
assert.equal(created.ok, true, `create session failed: ${created.status}`)
const session = await created.json()

try {
  const [tab] = await (await fetch(`${cdp}/json/list`)).json()
  const socket = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })

  let callId = 0
  const pending = new Map()
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    if (!message.id) return
    const callback = pending.get(message.id)
    pending.delete(message.id)
    message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result)
  }
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++callId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (expression, timeout = 10000) => {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return
      await sleep(50)
    }
    assert.fail(`timeout: ${expression}`)
  }

  await call('Page.enable')
  if (process.env.ADFLOW_AUTH_TOKEN) {
    await call('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('adflow:auth-token', ${JSON.stringify(process.env.ADFLOW_AUTH_TOKEN)})`,
    })
  }
  await call('Page.navigate', { url: `${web}/workflow?workflowId=${session.session_id}` })
  await waitFor(`document.querySelector('.workflow-container')`)
  await waitFor(`document.querySelector('.wf-header-meta__title')?.textContent.trim() === 'canvas sync regression test'`)
  await waitFor(`document.querySelectorAll('.vue-flow__node').length === 0`)

  for (const [index, label] of ['文本节点', '图片节点', '视频节点'].entries()) {
    await evaluate(`document.querySelector('button[title="添加节点"]').click()`)
    await waitFor(`document.querySelector('.wf-node-menu')`)
    const clicked = await evaluate(`(() => {
      const button = [...document.querySelectorAll('.wf-node-menu-item')]
        .find(item => item.textContent.trim() === ${JSON.stringify(label)})
      button?.click()
      return Boolean(button)
    })()`)
    assert.equal(clicked, true, `missing node type: ${label}`)
    await waitFor(`document.querySelectorAll('.vue-flow__node').length === ${index + 1}`)
  }
  await sleep(1000)
  await waitFor(`[...document.querySelectorAll('.vue-flow__node')]
    .every(node => getComputedStyle(node).visibility === 'visible')`)

  await evaluate(`window.confirm=()=>true; document.querySelector('button[title="清空画布"]').click()`)
  await waitFor(`document.querySelectorAll('.vue-flow__node').length === 0`)
  socket.close()
  console.log('workflow canvas sync: ok')
} finally {
  await fetch(`${api}/api/agent/sessions/${session.session_id}`, { method: 'DELETE', headers: authHeaders })
}
