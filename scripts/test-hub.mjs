// scripts/test-hub.mjs — сквозной тест хоста (без GUI): статический режим и Node.js.
// Запуск: PRIREX_HUB_PORT=30917 node scripts/test-hub.mjs
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawnSync } from 'node:child_process'
import WebSocket from 'ws'

const PORT = Number(process.env.PRIREX_HUB_PORT ?? 30917)
process.env.PRIREX_HUB_PORT = String(PORT) // до импорта index.js (порт читается при загрузке модуля)
const NODE_TIMEOUT = 45000

let failures = 0
function check(name, cond, extra = '') {
  if (cond) console.log(`PASS ${name}`)
  else { failures++; console.error(`FAIL ${name} ${extra}`.trim()) }
}

function canConnect(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port })
    let done = false
    const finish = (ok) => { if (done) return; done = true; try { sock.destroy() } catch { /* ignore */ } resolve(ok) }
    sock.setTimeout(500, () => finish(false))
    sock.once('connect', () => finish(true))
    sock.once('error', () => finish(false))
  })
}

// --- 1. временные проекты -------------------------------------------------
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prirex-test-'))
await fs.mkdir(path.join(tmp, 'sub'), { recursive: true })
await fs.writeFile(path.join(tmp, 'index.html'), '<!doctype html><title>ROOT</title><body>root-index</body>')
await fs.writeFile(path.join(tmp, 'sub', 'page.html'), '<html><body>sub-page</body></html>')
await fs.mkdir(path.join(tmp, 'node_modules', 'junk'), { recursive: true })
await fs.writeFile(path.join(tmp, 'node_modules', 'junk', 'skip.html'), '<html>x</html>')

const nodeTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prirex-node-test-'))
await fs.writeFile(path.join(nodeTmp, 'package.json'), JSON.stringify({
  name: 'prirex-node-fixture',
  private: true,
  scripts: { dev: 'node server.js' },
}, null, 2))
await fs.writeFile(path.join(nodeTmp, 'index.html'), '<!doctype html><body>fixture-static</body>')
await fs.writeFile(path.join(nodeTmp, 'server.js'), `
const http = require('node:http')
const server = http.createServer((req, res) => {
  if (req.url === '/api/health') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, method: req.method }))
    return
  }
  if (req.url === '/echo') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ body }))
    })
    return
  }
  if (req.url === '/go') {
    res.writeHead(302, { location: 'http://localhost:' + server.address().port + '/target' })
    res.end()
    return
  }
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end('<!doctype html><html><head><title>NODE FIXTURE</title></head><body><h1 id="title">node-index</h1></body></html>')
})
server.on('upgrade', (req, socket) => {
  socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: dGhlIHNhbXBsZSBub25jZQ==\\r\\n\\r\\n')
  socket.write('HELLO-HMR')
})
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port
  console.log('  Local: http://localhost:' + port + '/')
})
`)

const simpleServer = (marker) => `
const http = require('node:http')
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end('<!doctype html><body>${marker}</body>')
})
server.listen(0, '127.0.0.1', () => {
  console.log('  Local: http://localhost:' + server.address().port + '/')
})
`

// Родитель, в подпапке которого лежит обычный статический сайт.
const parentStatic = await fs.mkdtemp(path.join(os.tmpdir(), 'prirex-parent-static-'))
await fs.mkdir(path.join(parentStatic, 'site'), { recursive: true })
await fs.writeFile(path.join(parentStatic, 'site', 'index.html'), '<!doctype html><title>PS</title><body>parent-site-ok</body>')

// Родитель, в подпапке которого лежит Node.js-проект.
const parentNode = await fs.mkdtemp(path.join(os.tmpdir(), 'prirex-parent-node-'))
await fs.mkdir(path.join(parentNode, 'app'), { recursive: true })
await fs.writeFile(path.join(parentNode, 'app', 'package.json'), JSON.stringify({ name: 'parent-node', private: true, scripts: { dev: 'node server.js' } }))
await fs.writeFile(path.join(parentNode, 'app', 'server.js'), simpleServer('parent-node-ok'))

// Проект, объявляющий pnpm, при отсутствии pnpm в PATH должен запускаться через npm.
const pnpmTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prirex-pnpm-'))
await fs.writeFile(path.join(pnpmTmp, 'package.json'), JSON.stringify({ name: 'pnpm-fixture', private: true, packageManager: 'pnpm@9.0.0', scripts: { dev: 'node server.js' } }))
await fs.writeFile(path.join(pnpmTmp, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
await fs.writeFile(path.join(pnpmTmp, 'server.js'), simpleServer('pnpm-ok'))

// Папка без сайта и Node.js-проекта.
const emptyTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prirex-empty-'))
await fs.writeFile(path.join(emptyTmp, 'README.md'), '# nothing here\n')

// --- 2. хост с фейковым ctx (cwd сессии = tmp) ----------------------------
const mod = await import('../lib/index.js')
let teardown = null
try {
  teardown = mod.apply({
    sessions: { get: () => ({ header: { cwd: tmp } }) },
    get: () => undefined,
  }) ?? null
} catch (err) {
  console.error('FAIL apply() бросил исключение:', err)
  process.exit(1)
}

// ждём, пока хаб начнёт принимать соединения
const deadline = Date.now() + 8000
for (;;) {
  const ok = await canConnect(PORT)
  if (ok) break
  if (Date.now() > deadline) { console.error('FAIL хаб не поднялся на порту ' + PORT); process.exit(1) }
  await new Promise((r) => setTimeout(r, 200))
}

// --- 3. сайдбар-клиент ----------------------------------------------------
// Чужой браузерный Origin не должен получать управление хабом.
{
  const rejected = await new Promise((resolve) => {
    const bad = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin: 'https://evil.example' })
    let gotMessage = false
    bad.on('message', () => { gotMessage = true })
    bad.on('close', (code) => resolve(!gotMessage && code === 1008))
    bad.on('error', () => { /* закрытие тоже придёт */ })
    setTimeout(() => resolve(false), 3000)
  })
  check('хаб: чужой Origin отклонён', rejected)
}

{
  const accepted = await new Promise((resolve) => {
    const good = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin: 'dsh-app://app' })
    let version = null
    good.on('open', () => good.send(JSON.stringify({ type: 'version' })))
    good.on('message', (d) => { try { const m = JSON.parse(String(d)); if (m.type === 'version') version = m.version } catch { /* ignore */ } })
    good.on('error', () => resolve(false))
    setTimeout(() => { try { good.close() } catch { /* ignore */ } resolve(version === '2.0.0') }, 1500)
  })
  check('хаб: Origin dsh-app://app разрешён (DSH Desktop)', accepted)
}

const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
const msgs = []
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))) } catch { /* ignore */ } })

function waitFor(name, pred, timeoutMs = 8000, from = 0) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const timer = setInterval(() => {
      const hit = msgs.slice(from).find(pred)
      if (hit) { clearInterval(timer); resolve(hit) }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(timer); check(name, false, 'таймаут; получено: ' + JSON.stringify(msgs.slice(-3))); resolve(null) }
    }, 50)
  })
}

// hello с sessionId → автозапуск папки сессии
ws.send(JSON.stringify({ type: 'hello', role: 'sidebar', sessionId: 'test-1' }))
const verFrom = msgs.length
ws.send(JSON.stringify({ type: 'version' }))
const ver = await waitFor('версия хаба', (m) => m.type === 'version', 5000, verFrom)
check('хаб: отвечает версией 2.0.0', ver?.version === '2.0.0', JSON.stringify(ver))
const auto = await waitFor('автооткрытие по hello+sessionId', (m) => m.type === 'status' && m.running === true)
check('автооткрытие: status running:true', !!auto, JSON.stringify(auto))
if (auto) {
  check('автооткрытие: dir = cwd сессии', auto.dir === tmp, `получено ${auto.dir}`)
  check('автооткрытие: file = index.html', auto.file === 'index.html', `получено ${auto.file}`)
  check('автооткрытие: files содержит index.html и sub/page.html', Array.isArray(auto.files) && auto.files.includes('index.html') && auto.files.includes('sub/page.html'), JSON.stringify(auto.files))
  check('автооткрытие: node_modules отфильтрован', !String(JSON.stringify(auto.files)).includes('node_modules'))

  // сервер отдаёт страницу с инжектом инспектора
  const res = await fetch(`http://127.0.0.1:${auto.port}/index.html`)
  const body = await res.text()
  check('HTTP: index.html 200', res.status === 200, `статус ${res.status}`)
  check('HTTP: содержимое страницы', body.includes('root-index'))
  check('HTTP: инжект инспектора', body.includes('__prirexStudio'))
  check('HTTP: порт хаба подставлен в инспектор', body.includes(`127.0.0.1:${PORT}`))

  // stop → stopped / running:false
  ws.send(JSON.stringify({ type: 'stop' }))
  const stopped = await waitFor('стоп', (m) => m.type === 'stopped' || (m.type === 'status' && m.running === false))
  check('стоп: остановлено', !!stopped, JSON.stringify(stopped))

  // явный start с dir и пустым file — путь applyDir клиента
  ws.send(JSON.stringify({ type: 'start', role: 'sidebar', dir: tmp.split(path.sep).join('/'), file: '' }))
  const manual = await waitFor('явный start по пути', (m) => m.type === 'status' && m.running === true, 8000)
  check('явный start: running:true с files', !!manual && Array.isArray(manual.files) && manual.files.length >= 2, JSON.stringify(manual))

  ws.send(JSON.stringify({ type: 'stop' }))
}

// --- 4. Node.js-проект: detect → start → прокси → stop --------------------
{
  const from = msgs.length
  ws.send(JSON.stringify({ type: 'detect', dir: nodeTmp.split(path.sep).join('/') }))
  const det = await waitFor('detect Node.js', (m) => m.type === 'detected' && m.dir === nodeTmp, 10000, from)
  check('detect: mode = node', det?.mode === 'node', JSON.stringify(det))
  check('detect: команда npm run dev', det?.command === 'npm run dev', `получено ${det?.command}`)
  check('detect: причина из package.json', String(det?.reason ?? '').includes('package.json'), `получено ${det?.reason}`)
}

let nodeStatus = null
{
  const from = msgs.length
  ws.send(JSON.stringify({ type: 'start', dir: nodeTmp.split(path.sep).join('/'), mode: 'node', command: '' }))
  nodeStatus = await waitFor('Node.js start', (m) => m.type === 'status' && m.mode === 'node' && m.running === true, NODE_TIMEOUT, from)
  check('node start: running:true, mode node', !!nodeStatus, JSON.stringify(nodeStatus))
  check('node start: порт предпросмотра', !!nodeStatus && Number(nodeStatus.port) > 0)
  check('node start: порт приложения найден', !!nodeStatus && Number(nodeStatus.devPort) > 0, `devPort=${nodeStatus?.devPort}`)
  check('node start: лог содержит Local:', Array.isArray(nodeStatus?.logs) && nodeStatus.logs.some((l) => String(l).includes('Local:')))
}

if (nodeStatus) {
  const proxy = `http://127.0.0.1:${nodeStatus.port}`
  const page = await fetch(`${proxy}/`)
  const html = await page.text()
  check('node HTTP: главная 200', page.status === 200, `статус ${page.status}`)
  check('node HTTP: HTML dev-сервера', html.includes('node-index'))
  check('node HTTP: инспектор внедрён в HTML', html.includes('__prirexStudio'))

  const api = await fetch(`${proxy}/api/health`)
  check('node HTTP: API проброшен', api.status === 200 && (await api.json()).ok === true, `статус ${api.status}`)

  const post = await fetch(`${proxy}/echo`, { method: 'POST', body: 'hello-node' })
  check('node HTTP: POST с телом проброшен', post.status === 200 && String((await post.json()).body).includes('hello-node'))

  const redirect = await fetch(`${proxy}/go`, { redirect: 'manual' })
  const location = redirect.headers.get('location') ?? ''
  check('node HTTP: redirect переписан на прокси', redirect.status === 302 && location.startsWith(proxy), `Location=${location}`)

  // Live-reload: watcher видит правку исходников и шлёт reload странице.
  const pageMsgs = []
  const pageWs = new WebSocket(`ws://127.0.0.1:${PORT}`)
  await new Promise((res, rej) => { pageWs.on('open', res); pageWs.on('error', rej) })
  pageWs.on('message', (d) => { try { pageMsgs.push(JSON.parse(String(d))) } catch { /* ignore */ } })
  pageWs.send(JSON.stringify({ type: 'hello', role: 'page' }))
  await new Promise((r) => setTimeout(r, 300))
  await fs.writeFile(path.join(nodeTmp, 'index.html'), '<!doctype html><body>fixture-static-2</body>')
  const reload = await new Promise((resolve) => {
    const t0 = Date.now()
    const timer = setInterval(() => {
      if (pageMsgs.some((m) => m.type === 'reload')) { clearInterval(timer); resolve(true) }
      else if (Date.now() - t0 > 6000) { clearInterval(timer); resolve(false) }
    }, 100)
  })
  check('node watcher: reload доставлен странице', reload)

  // HMR-апгрейд: сырой WS-хендшейк проходит через прокси.
  const hmrOk = await new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port: Number(nodeStatus.port) })
    let data = ''
    const finish = (ok) => { try { sock.destroy() } catch { /* ignore */ } resolve(ok) }
    sock.setTimeout(5000, () => finish(false))
    sock.once('connect', () => {
      sock.write(
        `GET /hmr HTTP/1.1\r\nHost: 127.0.0.1:${nodeStatus.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
      )
    })
    sock.on('data', (chunk) => {
      data += chunk.toString('latin1')
      if (data.includes('101 Switching Protocols') && data.includes('HELLO-HMR')) finish(true)
    })
    sock.once('error', () => finish(false))
  })
  check('node WS: HMR-апгрейд проброшен', hmrOk)

  // После подключения HMR полный reload по watcher не дублирует точечные обновления.
  pageMsgs.length = 0
  await fs.writeFile(path.join(nodeTmp, 'index.html'), '<!doctype html><body>fixture-static-3</body>')
  await new Promise((r) => setTimeout(r, 1800))
  check('node watcher: при активном HMR полный reload не шлётся', !pageMsgs.some((m) => m.type === 'reload'))
  try { pageWs.close() } catch { /* ignore */ }

  const devPort = Number(nodeStatus.devPort)
  const fromStop = msgs.length
  ws.send(JSON.stringify({ type: 'stop' }))
  const stopped = await waitFor('node stop', (m) => m.type === 'stopped' || (m.type === 'status' && m.running === false), 10000, fromStop)
  check('node stop: остановлено', !!stopped)
  await new Promise((r) => setTimeout(r, 800))
  check('node stop: dev-сервер остановлен', !(await canConnect(devPort)), `порт ${devPort} всё ещё слушается`)
  check('node stop: прокси остановлен', !(await canConnect(Number(nodeStatus.port))), `порт ${nodeStatus.port} всё ещё слушается`)
}

// --- 5. Автопоиск проекта в подпапках -------------------------------------
function commandExists(name) {
  const res = process.platform === 'win32'
    ? spawnSync('where', [name], { stdio: 'ignore', windowsHide: true })
    : spawnSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' })
  return res.status === 0
}

{
  const from = msgs.length
  ws.send(JSON.stringify({ type: 'detect', dir: parentStatic.split(path.sep).join('/') }))
  const det = await waitFor('detect: сайт в подпапке', (m) => m.type === 'detected' && m.dir === path.join(parentStatic, 'site'), 15000, from)
  check('detect: корень статического сайта найден в подпапке', det?.mode === 'static' && Array.isArray(det.files) && det.files.includes('index.html'), JSON.stringify(det))
}

{
  const from = msgs.length
  ws.send(JSON.stringify({ type: 'start', dir: parentStatic.split(path.sep).join('/'), file: '' }))
  const st = await waitFor('start auto: статика из подпапки', (m) => m.type === 'status' && m.running === true && m.mode === 'static', 15000, from)
  check('start auto: запустился найденный статический сайт', !!st && st.dir === path.join(parentStatic, 'site'), JSON.stringify({ dir: st?.dir }))
  if (st) {
    const res = await fetch(`http://127.0.0.1:${st.port}/`)
    const body = await res.text()
    check('start auto: статика из подпапки отдаётся', res.status === 200 && body.includes('parent-site-ok'), `статус ${res.status}`)
  }
  const fromStop = msgs.length
  ws.send(JSON.stringify({ type: 'stop' }))
  await waitFor('start auto: статика остановлена', (m) => m.type === 'stopped' || (m.type === 'status' && m.running === false), 8000, fromStop)
}

{
  const from = msgs.length
  ws.send(JSON.stringify({ type: 'detect', dir: parentNode.split(path.sep).join('/') }))
  const det = await waitFor('detect: Node.js в подпапке', (m) => m.type === 'detected' && m.dir === path.join(parentNode, 'app'), 15000, from)
  check('detect: корень Node.js-проекта найден в подпапке', det?.mode === 'node' && det.command === 'npm run dev', JSON.stringify(det))
}

{
  const from = msgs.length
  ws.send(JSON.stringify({ type: 'start', dir: parentNode.split(path.sep).join('/'), file: '' }))
  const st = await waitFor('start auto: Node.js из подпапки', (m) => m.type === 'status' && m.running === true && m.mode === 'node', NODE_TIMEOUT, from)
  check('start auto: запустился найденный Node.js-проект', !!st && st.dir === path.join(parentNode, 'app') && Number(st.devPort) > 0, JSON.stringify({ dir: st?.dir, devPort: st?.devPort }))
  if (st) {
    const res = await fetch(`http://127.0.0.1:${st.port}/`)
    const body = await res.text()
    check('start auto: Node.js из подпапки отдаётся через прокси', res.status === 200 && body.includes('parent-node-ok'), `статус ${res.status}`)
  }
  const fromStop = msgs.length
  ws.send(JSON.stringify({ type: 'stop' }))
  await waitFor('start auto: Node.js остановлен', (m) => m.type === 'stopped' || (m.type === 'status' && m.running === false), 10000, fromStop)
}

{
  const from = msgs.length
  ws.send(JSON.stringify({ type: 'detect', dir: pnpmTmp.split(path.sep).join('/') }))
  const det = await waitFor('detect: pnpm fallback', (m) => m.type === 'detected' && m.dir === pnpmTmp, 10000, from)
  const expected = commandExists('pnpm') ? 'pnpm run dev' : 'npm run dev'
  check('detect: отсутствующий pnpm заменён на npm', det?.command === expected, `получено ${det?.command}, ожидалось ${expected}`)
  check('detect: менеджер соответствует команде', det?.manager === (expected.startsWith('npm') ? 'npm' : 'pnpm'), `менеджер ${det?.manager}`)
}

{
  const from = msgs.length
  ws.send(JSON.stringify({ type: 'start', dir: emptyTmp.split(path.sep).join('/'), file: '' }))
  const err = await waitFor('start: пустая папка', (m) => m.type === 'started-error', 10000, from)
  check('start: пустая папка даёт понятную ошибку', !!err && String(err.error).includes('не найдено'), JSON.stringify(err))
}

try { ws.close() } catch { /* ignore */ }
if (typeof teardown === 'function') { try { teardown() } catch { /* ignore */ } }
await new Promise((r) => setTimeout(r, 300))
console.log(failures === 0 ? 'TEST-HUB OK' : `TEST-HUB FAILED (${failures})`)
process.exit(failures === 0 ? 0 : 1)
