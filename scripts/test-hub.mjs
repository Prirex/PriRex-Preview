// scripts/test-hub.mjs — сквозной тест хоста протокола v2 (без GUI).
// Запуск: PRIREX_HUB_PORT=30917 node scripts/test-hub.mjs
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import WebSocket from 'ws'

const PORT = Number(process.env.PRIREX_HUB_PORT ?? 30917)
process.env.PRIREX_HUB_PORT = String(PORT) // до импорта index.js (порт читается при загрузке модуля)

let failures = 0
function check(name, cond, extra = '') {
  if (cond) console.log(`PASS ${name}`)
  else { failures++; console.error(`FAIL ${name} ${extra}`.trim()) }
}

// --- 1. временный проект -------------------------------------------------
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prirex-test-'))
await fs.mkdir(path.join(tmp, 'sub'), { recursive: true })
await fs.writeFile(path.join(tmp, 'index.html'), '<!doctype html><title>ROOT</title><body>root-index</body>')
await fs.writeFile(path.join(tmp, 'sub', 'page.html'), '<html><body>sub-page</body></html>')
await fs.mkdir(path.join(tmp, 'node_modules', 'junk'), { recursive: true })
await fs.writeFile(path.join(tmp, 'node_modules', 'junk', 'skip.html'), '<html>x</html>')

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
  const ok = await new Promise((res) => {
    const s = net.connect(PORT, '127.0.0.1')
    s.once('connect', () => { s.destroy(); res(true) })
    s.once('error', () => res(false))
  })
  if (ok) break
  if (Date.now() > deadline) { console.error('FAIL хаб не поднялся на порту ' + PORT); process.exit(1) }
  await new Promise((r) => setTimeout(r, 200))
}

// --- 3. сайдбар-клиент ----------------------------------------------------
const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
const msgs = []
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))) } catch { /* ignore */ } })

function waitFor(name, pred, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const timer = setInterval(() => {
      const hit = msgs.find(pred)
      if (hit) { clearInterval(timer); resolve(hit) }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(timer); check(name, false, 'таймаут; получено: ' + JSON.stringify(msgs.slice(-3))); resolve(null) }
    }, 50)
  })
}

// hello с sessionId → автозапуск папки сессии
ws.send(JSON.stringify({ type: 'hello', role: 'sidebar', sessionId: 'test-1' }))
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

try { ws.close() } catch { /* ignore */ }
if (typeof teardown === 'function') { try { teardown() } catch { /* ignore */ } }
await new Promise((r) => setTimeout(r, 300))
console.log(failures === 0 ? 'TEST-HUB OK' : `TEST-HUB FAILED (${failures})`)
process.exit(failures === 0 ? 0 : 1)
