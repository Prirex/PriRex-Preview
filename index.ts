/**
 * PriRex Preview — сервис хоста.
 *
 * Запускает WebSocket-хаб на 127.0.0.1:3099 сразу при активации плагина.
 * Поддерживает два режима предпросмотра:
 *
 *  - static — выбранная папка раздаётся собственным HTTP-сервером (свободный
 *    порт), HTML получает инъектированный скрипт инспектора;
 *  - node — из package.json определяется dev/start-скрипт (npm/pnpm/yarn/bun)
 *    или Node.js-точка входа, процесс запускается в папке проекта, его порт
 *    определяется по выводу, а предпросмотр идёт через локальный обратный прокси
 *    со встроенным инспектором. WebSocket-апгрейды (Vite/Next HMR) и API-запросы
 *    пробрасываются на dev-сервер без изменений.
 *
 * chokidar следит за исходниками и шлёт {type:'reload'} в WebView; сообщения
 * страницы (console-error, inspector-prompt) пересылаются клиентам роли sidebar.
 */
import http from 'node:http'
import type { Server } from 'node:http'
import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import net from 'node:net'
import path from 'node:path'
import fs from 'node:fs/promises'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { WebSocketServer, WebSocket } from 'ws'
import { watch, type FSWatcher } from 'chokidar'

const HUB_HOST = '127.0.0.1'
const HUB_PORT = Number(process.env.PRIREX_HUB_PORT ?? 3099)
/** Сколько ждать готовности Node.js-сервера (мс). */
const NODE_START_TIMEOUT = Number(process.env.PRIREX_NODE_TIMEOUT ?? 120000)
/** Дополнительные Origin, которым разрешён доступ к хабу (через запятую). */
const EXTRA_ORIGINS = String(process.env.PRIREX_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean)

type Role = 'sidebar' | 'page'
type PreviewMode = 'static' | 'node'

/** Минимальная типизация клиентского сокета ws (пакет не тянет свои типы). */
interface WsClient {
  readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  on(event: 'message', cb: (raw: Buffer | string) => void): this
  on(event: 'close', cb: () => void): this
}

/** Результат разбора папки проекта — без запуска процессов. */
interface ProjectInfo {
  dir: string
  mode: PreviewMode
  command?: string
  manager?: string
  script?: string
  entry?: string
  files: string[]
  file: string
  reason: string
  portHints: number[]
}

interface RunState {
  runId: number
  dir: string
  mode: PreviewMode
  file: string
  previewPort: number
  devPort?: number
  command?: string
  files: string[]
  logs: string[]
  /** Порты, которые упомянул dev-сервер (ещё могут быть не готовы). */
  ports?: Set<number>
  /** Через прокси идёт HMR-сокет — полную перезагрузку по watcher не шлём. */
  hmrActive?: boolean
  ready: boolean
  starting: boolean
  watcher?: FSWatcher
  server?: Server
  sockets?: Set<Socket>
  child?: ChildProcess
  timer?: NodeJS.Timeout
}

interface StartOptions {
  mode?: PreviewMode
  file?: string
  command?: string
}

interface StartResult {
  ok: boolean
  error?: string
  canceled?: boolean
  info?: ProjectInfo
}

/** MIME-карта для локальной раздачи. */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
}

/** Заголовки, которые нельзя пробрасывать через прокси. */
const HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
])

/** Заголовки, которые снимаем с ответа dev-сервера (инъекция + iframe). */
const STRIPPED_RESPONSE_HEADERS = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
])

/** Каталоги, которые не сканируем и не отслеживаем. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.svelte-kit', '.output', 'out', 'coverage', '.cache'])

/** Кандидаты портов на случай, если dev-сервер ничего не напечатал. */
const DEFAULT_DEV_PORTS = [3000, 3001, 5173, 4173, 8080, 8000, 4000, 5000, 4200, 4321, 9000]

/** Порядок предпочтения npm-скриптов. */
const SCRIPT_PREFERENCE = ['dev', 'develop', 'start', 'serve', 'preview']

/** Возможные Node.js-точки входа, если в package.json нет скриптов. */
const ENTRY_CANDIDATES = [
  'server.js', 'server.mjs', 'server.cjs',
  'app.js', 'app.mjs', 'app.cjs',
  'src/server.js', 'src/server.mjs',
  'server/index.js', 'src/index.js', 'index.js',
]

/**
 * Скрипт, инъектируемый в HTML перед последним </body>.
 * Печатает: live-reload по WS-сигналу, перехват onerror/unhandledrejection/console.error,
 * hover-подсветку 2px dashed #ff007f и панель «Что изменить?» с отсылкой
 * outerHTML + computed-стилей в плагин.
 */
const INSPECTOR_SOURCE = `;(function () {
  if (window.__prirexStudio) return;
  window.__prirexStudio = true;
  var HUB = 'ws://127.0.0.1:__PRIREX_HUB_PORT__';
  var ws = null, retry = 0;
  var pending = [];

  function send(obj) {
    var data;
    try { data = JSON.stringify(obj); } catch (e) { return; }
    if (ws && ws.readyState === 1) {
      try { ws.send(data); return; } catch (e) {}
    }
    pending.push(data);
    while (pending.length > 50) pending.shift();
  }

  function flush() {
    while (pending.length && ws && ws.readyState === 1) ws.send(pending.shift());
  }
  function schedule() {
    setTimeout(connect, Math.min(1000 * (++retry), 5000));
  }
  function connect() {
    try { ws = new WebSocket(HUB); } catch (e) { schedule(); return; }
    ws.onopen = function () { retry = 0; send({ type: 'hello', role: 'page' }); flush(); };
    ws.onmessage = function (ev) {
      var msg, ms; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg) return;
      if (msg.type === 'reload') { location.reload(); return; }
      ms = Math.round(Number(msg.ms));
      if (ms >= 500 && ms <= 10000) hoverMs = ms;
    };
    ws.onerror = function () {};
    ws.onclose = function () { ws = null; schedule(); };
  }

  window.addEventListener('error', function (e) {
    send({
      type: 'console-error', level: 'error',
      message: String(e.message || 'Script error').slice(0, 2000),
      source: e.filename ? e.filename + ':' : '', line: e.lineno || 0, col: e.colno || 0,
    });
  });

  window.addEventListener('unhandledrejection', function (e) {
    var text = '';
    try {
      text = e.reason instanceof Error
        ? (e.reason.stack || e.reason.message)
        : JSON.stringify(e.reason);
    } catch (err) { text = String(e.reason); }
    send({ type: 'console-error', level: 'unhandledrejection', message: String(text).slice(0, 400) });
  });

  var origError = console.error;
  console.error = function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      try { parts.push(a instanceof Error ? (a.stack || a.message) : String(a)); } catch (e2) { parts.push('?'); }
    }
    send({ type: 'console-error', level: 'console.error', message: parts.join(' ').slice(0, 2000) });
    return origError.apply(console, arguments);
  };

  var panel = null, targetEl = null, hoverMs = 3000;

  // --- Механика в духе Paradox: наведение hoverMs -> редактор сам ----------
  var frozen = [];
  var freezeRaf = 0, freezeBadge = null, freezeTarget = null;

  function isFrozen(el) {
    for (var i = 0; i < frozen.length; i++) if (frozen[i] === el) return true;
    return false;
  }
  function inPanel(el) { return !!(panel && el instanceof Element && panel.contains(el)); }

  function clearFreezeTimer() {
    if (freezeRaf) { try { cancelAnimationFrame(freezeRaf); } catch (e2) {} freezeRaf = 0; }
    if (freezeBadge) { try { freezeBadge.wrap.remove(); } catch (e2) {} freezeBadge = null; }
    freezeTarget = null;
  }

  function badgeAt(el, text, cls) {
    var b = document.createElement('div');
    b.textContent = text;
    b.style.cssText = 'position:fixed;z-index:2147483647;min-width:22px;padding:2px 7px;' +
      'background:' + (cls === 'lock' ? '#ff007f' : '#3a3a40') + ';color:#fff;border-radius:11px;' +
      'font:bold 11px/1.6 system-ui,sans-serif;text-align:center;pointer-events:none;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.45)';
    var r = el.getBoundingClientRect();
    b.style.left = Math.min(Math.max(8, r.right - 30), window.innerWidth - 40) + 'px';
    b.style.top = Math.max(4, r.top - (r.top > 32 ? 26 : 0)) + 'px';
    document.body.appendChild(b);
    return b;
  }

  function armFreeze(el) {
    if (isFrozen(el) || !el.isConnected) return;
    frozen.push(el);
    el.style.outline = '3px solid #ff007f';
    var lock = badgeAt(el, '\uD83D\uDD12', 'lock');
    setTimeout(function () { try { lock.remove(); } catch (e2) {} }, 650);
  }

  // «Paradox»: пунктирный контур элемента за ~3с дорисовывается сплошной линией.
  function makeOutlineBadge(el) {
    var r = el.getBoundingClientRect();
    var w = Math.max(r.width + 4, 12), h = Math.max(r.height + 4, 12);
    var rw = w - 3, rh = h - 3;
    var p = 2 * (rw + rh);
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;left:' + (r.left - 2) + 'px;top:' + (r.top - 2) +
      'px;width:' + w + 'px;height:' + h + 'px;z-index:2147483647;pointer-events:none';
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.style.cssText = 'display:block;overflow:visible';
    var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '1.5'); rect.setAttribute('y', '1.5');
    rect.setAttribute('width', String(rw)); rect.setAttribute('height', String(rh));
    rect.setAttribute('rx', '8');
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', '#ff007f');
    rect.setAttribute('stroke-width', '2.5');
    rect.setAttribute('stroke-dasharray', String(p));
    rect.setAttribute('stroke-dashoffset', String(p));
    svg.appendChild(rect);
    wrap.appendChild(svg);
    document.body.appendChild(wrap);
    return { wrap: wrap, rect: rect, p: p };
  }

  function placeOutline(badge, el) {
    var r = el.getBoundingClientRect();
    badge.wrap.style.left = (r.left - 2) + 'px';
    badge.wrap.style.top = (r.top - 2) + 'px';
  }

  // Наведение удерживается hoverMs — контур плавно сходит в сплошную линию, редактор откроется сам.
  function startFreezeCountdown(el) {
    clearFreezeTimer();
    if (isFrozen(el)) return;
    var total = hoverMs, t0 = Date.now();
    freezeTarget = el;
    var badge = makeOutlineBadge(el);
    freezeBadge = badge;
    var tick = function () {
      var target = freezeTarget;
      if (!target) return;
      var remain = total - (Date.now() - t0);
      if (remain <= 0) {
        clearFreezeTimer();
        armFreeze(target);
        autoOpenFor(target);
        return;
      }
      badge.rect.setAttribute('stroke-dashoffset', String(badge.p * (1 - remain / total)));
      placeOutline(badge, target);
      freezeRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  // Панель открывается сама — рядом с элементом.
  function autoOpenFor(el) {
    var r = el.getBoundingClientRect();
    openPanel(el, r.left + r.width / 2, r.bottom + 6);
  }

  function unfreezeAll(silent) {
    var n = frozen.length;
    for (var i = 0; i < n; i++) { try { frozen[i].style.outline = ''; } catch (e2) {} }
    frozen = [];
    clearFreezeTimer();
    if (n > 0 && !silent) toast('\u0417\u0430\u043c\u043e\u0440\u043e\u0437\u043a\u0430 \u0441\u043d\u044f\u0442\u0430 (' + n + ')');
  }

  function isInsideFrozen(el) {
    var n = el;
    while (n instanceof Element) { if (isFrozen(n)) return true; n = n.parentElement; }
    return false;
  }

  document.addEventListener('mouseover', function (e) {
    var el = e.target;
    if (!(el instanceof Element) || inPanel(el)) return;
    if (isFrozen(el)) return; // уже заморожен — таймер не нужен
    startFreezeCountdown(el);
  }, true);

  document.addEventListener('mouseout', function (e) {
    var el = e.target;
    if (!(el instanceof Element)) return;
    // Уход внутри того же элемента не отменяет отсчёт.
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    if (freezeTarget === el) clearFreezeTimer();
  }, true);

  // Клик по замороженному месту глотается до страницы: страница не активируется.
  ['mousedown', 'mouseup', 'click'].forEach(function (name) {
    document.addEventListener(name, function (e) {
      if (!(e.target instanceof Element)) return;
      if (!isInsideFrozen(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  });

  // Инспектор открывается только по клику на ЗАМОРОЖЕННЫЙ элемент.
  document.addEventListener('click', function (e) {
    if (!(e.target instanceof Element) || inPanel(e.target)) return;
    var n = e.target, found = null;
    while (n instanceof Element) { if (isFrozen(n)) { found = n; break; } n = n.parentElement; }
    if (!found) return;
    openPanel(found, e.clientX, e.clientY);
  }, true);

  // R / к — снять все заморозки (вне панели и полей ввода).
  document.addEventListener('keydown', function (e) {
    if (panel || frozen.length === 0) return;
    var a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'r' || e.key.toLowerCase() === '\u043a') unfreezeAll();
  }, true);

  // Подсказка о механике — один раз после подключения.
  setTimeout(function () {
    toast('\u041d\u0430\u0432\u0435\u0434\u0438\u0442\u0435 \u043a\u0443\u0440\u0441\u043e\u0440 \u043d\u0430 \u044d\u043b\u0435\u043c\u0435\u043d\u0442 — \u0447\u0435\u0440\u0435\u0437 ' + Math.round(hoverMs / 1000) + '\u0441 \u043e\u0442\u043a\u0440\u043e\u0435\u0442\u0441\u044f \u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440');
  }, 1500);

  function openPanel(el, x, y) {
    closePanel();
    unfreezeAll(true); // чистим старые подсветки — активен только текущий элемент
    armFreeze(el);
    targetEl = el;
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:2147483647;background:#1c1c1f;color:#fff;' +
      'border:1px solid #ff007f;border-radius:10px;padding:10px 10px 8px;font:12px/1.45 system-ui,sans-serif;' +
      'box-shadow:0 8px 28px rgba(0,0,0,.55);min-width:240px;max-width:min(92vw,360px)';
    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:7px';
    var tag = document.createElement('span');
    tag.textContent = '<' + (el.tagName || '?').toLowerCase() + '>';
    tag.style.cssText = 'color:#ff007f;font-weight:700;font-family:ui-monospace,Consolas,monospace;font-size:11px';
    var q = document.createElement('span');
    q.textContent = '\u0427\u0442\u043e \u0438\u0437\u043c\u0435\u043d\u0438\u0442\u044c?';
    q.style.cssText = 'font-weight:600';
    var sp = document.createElement('span');
    sp.style.cssText = 'flex:1';
    var xBtn = document.createElement('button');
    xBtn.textContent = '\u2715';
    xBtn.title = 'Esc';
    xBtn.style.cssText = 'cursor:pointer;background:none;border:none;color:#fff;font-size:13px;line-height:1;padding:0 2px;opacity:.8';
    xBtn.addEventListener('click', function (ev) { ev.stopPropagation(); closePanel(); });
    head.appendChild(tag);
    head.appendChild(q);
    head.appendChild(sp);
    head.appendChild(xBtn);
    box.appendChild(head);
    var input = document.createElement('input');
    input.placeholder = '\u041d\u0430\u043f\u0440., \u0438\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u0446\u0432\u0435\u0442 \u043d\u0430 \u043a\u0440\u0430\u0441\u043d\u044b\u0439';
    input.style.cssText = 'width:100%;box-sizing:border-box;margin-top:2px;padding:7px 9px;border-radius:7px;' +
      'border:1px solid #555;background:#2a2a2e;color:#fff;font:inherit;outline:none';
    var hint = document.createElement('div');
    hint.textContent = '\u0415\u043d\u0442\u0435\u0440 \u2014 \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c, Esc \u2014 \u0437\u0430\u043a\u0440\u044b\u0442\u044c';
    hint.style.cssText = 'opacity:.55;margin-top:6px;font-size:11px';
    box.appendChild(input);
    box.appendChild(hint);
    document.body.appendChild(box);
    var bw = 240, bh = box.offsetHeight || 80;
    var px = Math.min(Math.max(8, x - bw / 2), window.innerWidth - bw - 8);
    var py = y + 16 > window.innerHeight - bh ? y - bh - 12 : y + 12;
    box.style.left = px + 'px';
    box.style.top = Math.max(8, py) + 'px';
    panel = box;
    input.focus();
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { closePanel(); ev.stopPropagation(); }
      if (ev.key !== 'Enter') return;
      var comment = input.value.trim();
      collect(el, comment);
      closePanel();
    });
  }

  function closePanel() {
    if (panel) { panel.remove(); panel = null; targetEl = null; }
  }

  var STYLE_KEYS = ['font-size', 'color', 'background-color', 'display', 'margin', 'padding', 'position'];
  function collect(el, comment) {
    var html = el.outerHTML || '';
    if (html.length > 20000) html = html.slice(0, 20000);
    var cs = getComputedStyle(el), styles = {};
    for (var i = 0; i < STYLE_KEYS.length; i++) {
      styles[STYLE_KEYS[i]] = cs.getPropertyValue(STYLE_KEYS[i]);
    }
    var live = !!(ws && ws.readyState === 1);
    send({ type: 'inspector-prompt', comment: comment, html: html, styles: styles });
    toast(live ? '\u041e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e \u0432 \u0447\u0430\u0442' : '\u041f\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u043e \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u044c');
  }

  function toast(text) {
    var t = document.createElement('div');
    t.textContent = text;
    t.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;background:#1c1c1f;color:#fff;' +
      'border:1px solid #ff007f;border-radius:6px;padding:6px 10px;font:12px/1.4 system-ui,sans-serif;opacity:.95';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2500);
  }

  connect();
})();`

export function apply(ctx: any, _config?: unknown): () => void {
  const roles = new Map<WsClient, Role>()
  let state: RunState | undefined
  let hubFailed = false
  /** Растёт при каждом старте/остановке: устаревшие async-шаги сами сворачиваются. */
  let runSeq = 0
  // Последняя выбранная задержка ховера — шлём каждой новой странице при подключении.
  let hoverMsSetting = 3000

  // ---------- Разрешение «текущей папки» сессии (паттерн dsh-better-sidebar) ----------
  // sessionId → cwd: живой сервис workingDirectory, затем header.cwd сессии.
  // Всё через опциональные цепочки — отсутствие сервиса не должно ломать хаб.
  async function resolveSessionDir(sessionId: string | undefined): Promise<string | null> {
    if (!sessionId) return null
    try {
      const sessions = ctx?.sessions
      const session = typeof sessions?.get === 'function' ? sessions.get(String(sessionId)) : undefined
      let cwd: unknown
      try {
        const wd = typeof ctx?.get === 'function' ? ctx.get('workingDirectory') : undefined
        if (wd && typeof wd.get === 'function' && session) cwd = wd.get(session)
      } catch { /* сервис недоступен — идём дальше */ }
      if (typeof cwd !== 'string' || cwd === '') cwd = session?.header?.cwd
      if (typeof cwd !== 'string' || cwd === '') return null
      const resolved = path.resolve(cwd)
      const st = await fs.stat(resolved)
      return st.isDirectory() ? resolved : null
    } catch {
      return null
    }
  }

  // ---------- Скан HTML-файлов проекта (хост владеет файловой системой) ----------
  async function scanHtmlFiles(dir: string): Promise<string[]> {
    const found: string[] = []
    async function walk(rel: string, depth: number): Promise<void> {
      if (depth > 3 || found.length >= 500) return
      let entries: import('node:fs').Dirent[]
      try {
        entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true })
      } catch {
        return
      }
      for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
        if (found.length >= 500) return
        const childRel = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) await walk(childRel, depth + 1)
        } else if (/\.(html?|htm)$/i.test(e.name)) {
          found.push(childRel)
        }
      }
    }
    await walk('', 0)
    // Сначала корневые файлы, затем по глубине и имени.
    return found.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
  }

  function pickDefaultFile(files: string[]): string {
    if (files.includes('index.html')) return 'index.html'
    return files[0] ?? 'index.html'
  }

  // ---------- Определение типа проекта ----------
  async function fileExists(abs: string): Promise<boolean> {
    try {
      const st = await fs.stat(abs)
      return st.isFile()
    } catch {
      return false
    }
  }

  async function readPackageJson(dir: string): Promise<any> {
    try {
      const raw = await fs.readFile(path.join(dir, 'package.json'), 'utf8')
      const parsed = JSON.parse(raw) as unknown
      return typeof parsed === 'object' && parsed !== null ? parsed : undefined
    } catch {
      return undefined
    }
  }

  type Manager = 'npm' | 'pnpm' | 'yarn' | 'bun'

  /** Есть ли исполняемый файл в PATH процесса DSH (кэш на сессию). */
  const executableCache = new Map<string, boolean>()
  function executableAvailable(name: string): boolean {
    const cached = executableCache.get(name)
    if (cached !== undefined) return cached
    let ok = false
    try {
      const res = process.platform === 'win32'
        ? spawnSync('where', [name], { windowsHide: true, stdio: 'ignore' })
        : spawnSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' })
      ok = res.status === 0
    } catch {
      ok = false
    }
    executableCache.set(name, ok)
    return ok
  }

  async function detectManager(dir: string, pkg: any): Promise<Manager> {
    const declared = typeof pkg?.packageManager === 'string' ? pkg.packageManager.split('@')[0]?.trim() : ''
    if (declared === 'pnpm' || declared === 'yarn' || declared === 'bun' || declared === 'npm') return declared
    if (await fileExists(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
    if (await fileExists(path.join(dir, 'yarn.lock'))) return 'yarn'
    if (await fileExists(path.join(dir, 'bun.lockb')) || await fileExists(path.join(dir, 'bun.lock'))) return 'bun'
    return 'npm'
  }

  /**
   * Предпочитаемый менеджер по lock-файлу, но только если он есть в PATH
   * процесса DSH. Иначе — npm: `npm run <script>` использует уже установленные
   * node_modules и работает, даже если проект ставился через pnpm/yarn.
   */
  async function pickManager(dir: string, pkg: any): Promise<Manager> {
    const preferred = await detectManager(dir, pkg)
    if (executableAvailable(preferred)) return preferred
    if (preferred !== 'npm' && executableAvailable('npm')) return 'npm'
    return preferred
  }

  function runCommandFor(manager: Manager, script: string): string {
    switch (manager) {
      case 'pnpm': return `pnpm run ${script}`
      case 'yarn': return `yarn ${script}`
      case 'bun': return `bun run ${script}`
      default: return `npm run ${script}`
    }
  }

  /** Подсказки порта из текста скрипта: --port 5173 / PORT=3000 / port: 8080. */
  function portHintsFromText(text: string): number[] {
    const out = new Set<number>()
    const patterns = [
      /--port[=\s]+(\d{2,5})/gi,
      /\bPORT\s*=\s*(\d{2,5})/gi,
      /\bport\s*[:=]\s*(\d{2,5})/gi,
    ]
    for (const re of patterns) {
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        const n = Number(m[1])
        if (Number.isInteger(n) && n >= 1 && n <= 65535) out.add(n)
      }
    }
    return [...out]
  }

  /** Нормализует относительный путь из package.json (./src/index.js → src/index.js). */
  function normalizeRel(value: unknown): string | undefined {
    if (typeof value !== 'string' || value === '') return undefined
    const rel = value.replace(/\\/g, '/').replace(/^\.\//, '')
    if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel.split('/').includes('..')) return undefined
    return rel
  }

  /** Собирает команду Node.js-проекта из package.json или точки входа. */
  async function nodePlanFor(dir: string, pkg: any): Promise<{ command: string; manager: Manager; script?: string; entry?: string; portHints: number[]; reason: string } | undefined> {
    if (!pkg) return undefined
    const scripts: Record<string, unknown> = typeof pkg.scripts === 'object' && pkg.scripts !== null ? pkg.scripts : {}
    let script: string | undefined
    for (const name of SCRIPT_PREFERENCE) {
      const body = scripts[name]
      if (typeof body === 'string' && body.trim() !== '') { script = name; break }
    }
    const manager = await pickManager(dir, pkg)
    let command: string | undefined
    let entry: string | undefined
    let reason = ''
    if (script) {
      command = runCommandFor(manager, script)
      reason = `package.json → ${command}`
    } else {
      const main = normalizeRel(pkg?.main)
      if (main && /\.(c|m)?js$/i.test(main) && await fileExists(path.join(dir, ...main.split('/')))) {
        entry = main
      } else {
        for (const candidate of ENTRY_CANDIDATES) {
          if (await fileExists(path.join(dir, ...candidate.split('/')))) { entry = candidate; break }
        }
      }
      if (entry) {
        command = `node ${entry.includes(' ') ? `"${entry}"` : entry}`
        reason = `точка входа → ${command}`
      }
    }
    if (!command) return undefined
    const scriptBody = script ? String(scripts[script] ?? '') : ''
    return { command, manager, script, entry, portHints: portHintsFromText(`${scriptBody}\n${command}`), reason }
  }

  function staticInfo(root: string, files: string[]): ProjectInfo {
    return {
      dir: root,
      mode: 'static',
      files,
      file: pickDefaultFile(files),
      reason: files.length ? 'статические HTML-файлы' : 'не найдено ни HTML, ни Node.js-проекта',
      portHints: [],
    }
  }

  async function nodeInfo(root: string, pkg: any): Promise<ProjectInfo | undefined> {
    const plan = await nodePlanFor(root, pkg)
    if (!plan) return undefined
    const files = await scanHtmlFiles(root).catch(() => [] as string[])
    return { dir: root, mode: 'node', ...plan, files, file: pickDefaultFile(files) }
  }

  /** Прямые (не рекурсивные) HTML-файлы каталога — для поиска сайта в подпапке. */
  async function directHtmlInfo(dir: string): Promise<{ count: number; hasIndex: boolean }> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      let count = 0
      let hasIndex = false
      for (const entry of entries) {
        if (!entry.isFile() || !/\.(html?|htm)$/i.test(entry.name)) continue
        count++
        if (/^index\.html?$/i.test(entry.name)) hasIndex = true
      }
      return { count, hasIndex }
    } catch {
      return { count: 0, hasIndex: false }
    }
  }

  async function listSubdirs(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name))
        .map((entry) => path.join(dir, entry.name))
        .sort()
        .slice(0, 40)
    } catch {
      return []
    }
  }

  /** Ищет проект в подпапках (до двух уровней): статический сайт приоритетнее Node.js. */
  async function findChildProject(selected: string): Promise<ProjectInfo | undefined> {
    const levelOne = (await listSubdirs(selected)).slice(0, 30)
    const inspectLevel = async (dirs: string[]): Promise<ProjectInfo | undefined> => {
      const staticHits: Array<{ dir: string; count: number; hasIndex: boolean }> = []
      const nodeHits: ProjectInfo[] = []
      for (const dir of dirs) {
        const html = await directHtmlInfo(dir)
        if (html.count > 0) staticHits.push({ dir, ...html })
        const pkg = await readPackageJson(dir)
        if (!pkg) continue
        const info = await nodeInfo(dir, pkg)
        if (info && info.mode === 'node') nodeHits.push(info)
      }
      staticHits.sort((a, b) => Number(b.hasIndex) - Number(a.hasIndex) || b.count - a.count)
      if (staticHits.length > 0) {
        const hit = staticHits[0]
        const files = await scanHtmlFiles(hit.dir).catch(() => [] as string[])
        if (files.length > 0) return staticInfo(hit.dir, files)
      }
      if (nodeHits.length > 0) return nodeHits[0]
      return undefined
    }

    const first = await inspectLevel(levelOne)
    if (first) return first
    for (const dir of levelOne.slice(0, 10)) {
      const levelTwo = (await listSubdirs(dir)).slice(0, 10)
      if (levelTwo.length === 0) continue
      const second = await inspectLevel(levelTwo)
      if (second) return second
    }
    return undefined
  }

  /** Есть ли в каталоге прямые веб-ассеты (css/js/картинки/шрифты). */
  async function hasDirectWebAssets(dir: string): Promise<boolean> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      return entries.some((entry) => entry.isFile() && /\.(css|js|mjs|cjs|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|php)$/i.test(entry.name))
    } catch {
      return false
    }
  }

  /**
   * Определение проекта: выбранная папка → её подпапки (2 уровня).
   * Приоритет: package.json с dev/start в выбранной папке (фреймворк),
   * затем HTML прямо в выбранной папке, затем статический сайт в подпапке,
   * затем Node.js-проект в подпапке.
   */
  async function detectProject(dirRaw: string): Promise<ProjectInfo> {
    const dir = path.resolve(dirRaw)
    const pkg = await readPackageJson(dir)
    if (pkg) {
      const node = await nodeInfo(dir, pkg)
      if (node) return node
    }
    const files = await scanHtmlFiles(dir).catch(() => [] as string[])
    const directHtml = await directHtmlInfo(dir)
    // HTML прямо здесь — это и есть корень сайта.
    if (directHtml.count > 0) return staticInfo(dir, files)
    // Есть вложенные страницы и свои css/js — тоже корень сайта, не спускаемся.
    if (files.length > 0 && await hasDirectWebAssets(dir)) return staticInfo(dir, files)
    // Иначе выбранная папка может быть контейнером: ищем проект внутри.
    const child = await findChildProject(dir)
    if (child) return child
    return staticInfo(dir, files)
  }

  function detectedPayload(info: ProjectInfo): Record<string, unknown> {
    return {
      type: 'detected',
      dir: info.dir,
      mode: info.mode,
      command: info.command ?? null,
      manager: info.manager ?? null,
      script: info.script ?? null,
      entry: info.entry ?? null,
      reason: info.reason,
      files: info.files,
      file: info.file,
    }
  }

  // ---------- WebSocket-хаб ----------
  const wss = new WebSocketServer({ host: HUB_HOST, port: HUB_PORT })
  wss.on('listening', () => {
    console.log(`[prirexstudio] WS-хаб запущен на ws://${HUB_HOST}:${HUB_PORT}`)
  })
  wss.on('error', (err: Error) => {
    hubFailed = true
    console.error('[prirexstudio] Ошибка WS-хаба:', err.message)
  })

  function sendJson(ws: WsClient, obj: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
  }
  function broadcast(role: Role | undefined, obj: unknown): void {
    const data = JSON.stringify(obj)
    for (const [ws, r] of roles) {
      if ((role === undefined || r === role) && ws.readyState === WebSocket.OPEN) ws.send(data)
    }
  }

  wss.on('connection', (ws: WsClient, req: http.IncomingMessage) => {
    // Хаб управляет запуском процессов и раздачей файлов, поэтому браузерные
    // страницы с чужим Origin не пускаем (защита от drive-by с произвольного сайта).
    // Локальные клиенты без Origin (тесты, CLI) разрешены: у них уже есть доступ к машине.
    const rawOrigin = req?.headers?.origin
    const origin = Array.isArray(rawOrigin) ? '__invalid__' : typeof rawOrigin === 'string' ? rawOrigin : undefined
    if (!isOriginAllowed(origin)) {
      console.warn('[prirexstudio] Отклонено WS-подключение с Origin:', origin)
      try { ws.close(1008, 'origin not allowed') } catch { /* ignore */ }
      return
    }
    // Новая вкладка плагина сразу получает актуальный статус.
    sendJson(ws, statusPayload())
    ws.on('message', (raw: Buffer | string) => handleSocketMessage(ws, raw))
    ws.on('close', () => roles.delete(ws))
  })

  function isOriginAllowed(origin: string | undefined): boolean {
    if (!origin) return true
    if (EXTRA_ORIGINS.includes(origin)) return true
    // DSH Desktop открывает UI через собственный привилегированный протокол
    // (dsh-app://app), а не по http://127.0.0.1 — его тоже пускаем.
    if (origin === 'null' || origin.startsWith('file:')) return true
    try {
      const url = new URL(origin)
      if (url.protocol === 'dsh-app:') return url.hostname === 'app' || url.hostname === 'shell'
      const host = url.hostname.toLowerCase()
      return url.protocol === 'http:' || url.protocol === 'https:'
        ? host === '127.0.0.1' || host === 'localhost' || host === '[::1]'
        : false
    } catch {
      return false
    }
  }

  function statusPayload(): Record<string, unknown> {
    const s = state
    if (!s) return { type: 'status', running: false, hubFailed }
    return {
      type: 'status',
      running: s.ready,
      starting: s.starting && !s.ready,
      mode: s.mode,
      port: s.previewPort,
      devPort: s.devPort ?? null,
      dir: s.dir,
      file: s.file,
      files: s.files,
      command: s.command ?? null,
      logs: s.logs.slice(-80),
      hubFailed,
    }
  }

  function assumeRole(ws: WsClient, msg: Record<string, unknown>): void {
    if (roles.has(ws)) return
    const raw: string | Role | undefined = typeof msg.role === 'string' ? msg.role : inferRole(msg.type)
    if (raw === 'sidebar' || raw === 'page') roles.set(ws, raw)
  }
  function inferRole(type: unknown): Role | undefined {
    switch (type) {
      case 'start':
      case 'stop':
      case 'status':
      case 'detect':
        return 'sidebar'
      case 'hello':
      case 'console-error':
      case 'inspector-prompt':
        return 'page'
      default:
        return undefined
    }
  }

  // ---------- Здоровье порта и запуск процессов ----------
  function canConnect(port: number, timeoutMs = 350): Promise<boolean> {
    return new Promise((resolve) => {
      const sock = net.connect({ host: HUB_HOST, port })
      let done = false
      const finish = (ok: boolean) => {
        if (done) return
        done = true
        try { sock.destroy() } catch { /* ignore */ }
        resolve(ok)
      }
      sock.setTimeout(timeoutMs, () => finish(false))
      sock.once('connect', () => finish(true))
      sock.once('error', () => finish(false))
    })
  }

  function listen(server: Server): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => reject(err)
      server.once('error', onError)
      server.listen(0, HUB_HOST, () => {
        server.removeListener('error', onError)
        const addr = server.address()
        if (typeof addr === 'object' && addr !== null) resolve(addr.port)
        else reject(new Error('Не удалось получить порт сервера'))
      })
    })
  }

  function killTree(child: ChildProcess): void {
    const pid = child.pid
    if (!pid) return
    if (process.platform === 'win32') {
      try {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      } catch { /* процесс уже завершён */ }
      return
    }
    try { process.kill(-pid, 'SIGTERM') } catch { /* группы уже нет */ }
    setTimeout(() => {
      try { process.kill(-pid, 'SIGKILL') } catch { /* уже завершён */ }
    }, 1500).unref?.()
  }

  function stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\u001b\[[0-9;]*m/g, '')
  }

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function inspectorSource(): string {
    return INSPECTOR_SOURCE.replace('__PRIREX_HUB_PORT__', String(HUB_PORT))
  }

  function injectIntoHtml(html: string): string {
    const marker = '</body>'
    const idx = html.toLowerCase().lastIndexOf(marker)
    const script = `<script>${inspectorSource()}</script>`
    return idx >= 0 ? html.slice(0, idx) + script + html.slice(idx) : html + script
  }

  // ---------- Управление прогоном ----------
  function stopRun(): void {
    runSeq += 1
    const s = state
    if (!s) return
    state = undefined
    if (s.timer) clearTimeout(s.timer)
    try { s.watcher?.close() } catch { /* ignore */ }
    for (const sock of s.sockets ?? []) { try { sock.destroy() } catch { /* ignore */ } }
    s.sockets?.clear()
    try { s.server?.close() } catch { /* ignore */ }
    if (s.child) killTree(s.child)
  }

  function failRun(s: RunState, message: string): void {
    if (state !== s) return
    const detail = s.logs.slice(-10).join('\n')
    const error = detail ? `${message}\n${detail}` : message
    console.error('[prirexstudio] ' + error)
    stopRun()
    broadcast('sidebar', { type: 'started-error', error })
    broadcast('sidebar', { type: 'status', running: false, hubFailed })
  }

  async function startRun(dirRaw: string, opts: StartOptions = {}): Promise<StartResult> {
    stopRun()
    const seq = runSeq
    const alive = () => seq === runSeq
    if (!dirRaw || !dirRaw.trim()) return { ok: false, error: 'Укажите путь к папке проекта.' }
    const resolved = path.resolve(dirRaw || '')
    try {
      const st = await fs.stat(resolved)
      if (!st.isDirectory()) return { ok: false, error: `Путь не является папкой: ${resolved}` }
    } catch {
      return { ok: false, error: `Папка не найдена: ${resolved}` }
    }
    if (!alive()) return { ok: false, canceled: true }

    const info = await detectProject(resolved)
    if (!alive()) return { ok: false, canceled: true }

    // info.dir — реальный корень проекта: выбранная папка могла быть родителем сайта.
    const root = info.dir
    const mode: PreviewMode = opts.mode === 'static' || opts.mode === 'node' ? opts.mode : info.mode
    const command = (opts.command ?? '').trim() || info.command

    if (mode === 'node' && !command) {
      return {
        ok: false,
        info,
        error: 'Не найден Node.js-запуск: в package.json нет dev/start-скрипта, а точка входа не найдена. Укажите команду вручную.',
      }
    }
    if (mode === 'static' && info.files.length === 0) {
      return {
        ok: false,
        info,
        error: 'В выбранной папке не найдено ни HTML-сайта, ни Node.js-проекта. Выберите папку сайта или укажите команду вручную.',
      }
    }

    return mode === 'node'
      ? await startNodeRun(root, info, command as string, seq, alive)
      : await startStaticRun(root, info, opts.file, seq, alive)
  }

  async function startStaticRun(
    dir: string,
    info: ProjectInfo,
    requestedFile: string | undefined,
    seq: number,
    alive: () => boolean,
  ): Promise<StartResult> {
    const files = info.files
    let chosenFile = typeof requestedFile === 'string' ? requestedFile.trim() : ''
    if (chosenFile) {
      try {
        const st2 = await fs.stat(path.join(dir, ...chosenFile.split('/')))
        if (!st2.isFile()) chosenFile = pickDefaultFile(files)
      } catch {
        chosenFile = pickDefaultFile(files)
      }
    } else {
      chosenFile = pickDefaultFile(files)
    }
    if (!alive()) return { ok: false, canceled: true }

    const s: RunState = {
      runId: seq, dir, mode: 'static', file: chosenFile, previewPort: 0,
      files, logs: [], ready: true, starting: false,
    }
    const server = http.createServer((req, res) => serveFile(s, req, res))
    s.server = server
    bindSockets(s, server)

    try {
      s.previewPort = await listen(server)
    } catch (err) {
      try { server.close() } catch { /* ignore */ }
      return { ok: false, error: `Не удалось поднять HTTP-сервер: ${(err as Error).message}` }
    }
    if (!alive()) {
      try { server.close() } catch { /* ignore */ }
      return { ok: false, canceled: true }
    }

    state = s
    watchSources(s, /\.(html?|htm|css|js|mjs|cjs)$/i, 150)
    console.log(`[prirexstudio] Статический сервер: http://${HUB_HOST}:${s.previewPort}/${chosenFile} (HTML-файлов: ${files.length})`)
    return { ok: true, info }
  }

  async function startNodeRun(
    dir: string,
    info: ProjectInfo,
    command: string,
    seq: number,
    alive: () => boolean,
  ): Promise<StartResult> {
    const s: RunState = {
      runId: seq, dir, mode: 'node', file: '', previewPort: 0,
      command, files: info.files, logs: [], ports: new Set<number>(info.portHints),
      ready: false, starting: true,
    }

    // Прокси поднимаем первым: клиент сразу получает порт предпросмотра.
    const server = http.createServer((req, res) => handleProxyRequest(s, req, res))
    server.on('upgrade', (req, socket, head) => handleProxyUpgrade(s, req, socket, head))
    s.server = server
    bindSockets(s, server)

    try {
      s.previewPort = await listen(server)
    } catch (err) {
      try { server.close() } catch { /* ignore */ }
      return { ok: false, error: `Не удалось поднять прокси-сервер: ${(err as Error).message}` }
    }
    if (!alive()) {
      try { server.close() } catch { /* ignore */ }
      return { ok: false, canceled: true }
    }

    state = s

    // Свободные «стандартные» порты запоминаем до старта: после запуска их
    // займёт dev-сервер, и мы сможем отличить его от чужого сервиса.
    const candidates = new Set<number>(info.portHints)
    for (const port of DEFAULT_DEV_PORTS) {
      if (!(await canConnect(port))) candidates.add(port)
    }
    for (const port of info.portHints) s.ports?.add(port)
    if (!alive()) return { ok: false, canceled: true }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      BROWSER: 'none',
      BROWSER_OPEN: '0',
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    }

    let child: ChildProcess
    try {
      child = spawn(command, {
        cwd: dir,
        shell: true,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      })
    } catch (err) {
      failRun(s, `Не удалось запустить «${command}»: ${(err as Error).message}`)
      return { ok: false, error: (err as Error).message }
    }
    s.child = child

    attachStream(s, child.stdout, 'stdout')
    attachStream(s, child.stderr, 'stderr')

    child.once('error', (err: Error) => failRun(s, `Ошибка процесса «${command}»: ${err.message}`))
    child.once('exit', (code, signal) => {
      if (state !== s) return
      if (!s.ready) {
        failRun(s, `Процесс «${command}» завершился до запуска (${code ?? signal ?? 'без кода'}).`)
        return
      }
      s.ready = false
      s.starting = false
      const detail = s.logs.slice(-6).join('\n')
      broadcast('sidebar', {
        type: 'node-exit',
        code: code ?? null,
        signal: signal ?? null,
        error: detail ? `Процесс «${command}» завершился (${code ?? signal ?? '?'}).\n${detail}` : `Процесс «${command}» завершился (${code ?? signal ?? '?'}).`,
      })
      broadcast('sidebar', statusPayload())
    })

    s.timer = setTimeout(() => {
      failRun(s, `Dev-сервер не сообщил порт за ${Math.round(NODE_START_TIMEOUT / 1000)} с. Проверьте команду и лог ниже.`)
    }, NODE_START_TIMEOUT)
    s.timer.unref?.()

    // Слежение за исходниками: даже без HMR dev-сервера страница обновится.
    watchSources(s, /\.(html?|htm|css|js|mjs|cjs|jsx|ts|tsx|vue|svelte|astro|json)$/i, 350)

    void pollPorts(s, candidates, seq)
    console.log(`[prirexstudio] Node.js: «${command}» в ${dir}; прокси на http://${HUB_HOST}:${s.previewPort}/`)
    return { ok: true, info }
  }

  function bindSockets(s: RunState, server: Server): void {
    const sockets = new Set<Socket>()
    server.on('connection', (sock) => {
      sockets.add(sock)
      sock.on('close', () => sockets.delete(sock))
    })
    s.sockets = sockets
  }

  function watchSources(s: RunState, pattern: RegExp, debounceMs: number): void {
    let watcher: FSWatcher
    try {
      watcher = watch(s.dir, {
        ignoreInitial: true,
        ignored: (p: string) => {
          const norm = p.replace(/\\/g, '/')
          return /(^|\/)(node_modules|\.git|dist|build|out|coverage|\.cache|\.next|\.nuxt|\.svelte-kit|\.output)(\/|$)/.test(norm)
        },
      })
    } catch (err) {
      console.error('[prirexstudio] chokidar не запустился:', err)
      return
    }
    s.watcher = watcher
    let timer: NodeJS.Timeout | undefined
    // chokidar v3 для 'add'/'change'/'unlink' передаёт (path, stats) — второй
    // аргумент не путь; поэтому подписываемся на событие через обёртку с одним аргументом.
    const onChange = (changed: string) => {
      if (typeof changed !== 'string') return
      const rel = path.relative(s.dir, changed).replace(/\\/g, '/')
      if (!pattern.test(rel)) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        // Если у dev-сервера есть HMR, он сам обновит страницу точечно;
        // полный reload нужен только сайтам без HMR (Express, EJS и т.п.).
        if (state === s && s.ready && !s.hmrActive) broadcast('page', { type: 'reload', file: rel })
      }, debounceMs)
    }
    const handle = (changed: string) => onChange(changed)
    watcher.on('add', handle).on('change', handle).on('unlink', handle)
  }

  function attachStream(s: RunState, stream: NodeJS.ReadableStream | null, name: string): void {
    if (!stream) return
    let buffer = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk: string) => {
      buffer += chunk
      const parts = buffer.split(/\r?\n/)
      buffer = parts.pop() ?? ''
      for (const part of parts) ingestLine(s, part, name)
    })
    stream.on('end', () => {
      if (buffer) ingestLine(s, buffer, name)
      buffer = ''
    })
  }

  function ingestLine(s: RunState, raw: string, stream: string): void {
    if (state !== s) return
    const line = stripAnsi(raw).replace(/\s+$/, '')
    if (line === '') return
    const clipped = line.length > 2000 ? line.slice(0, 2000) : line
    s.logs.push(clipped)
    if (s.logs.length > 400) s.logs.splice(0, s.logs.length - 400)
    broadcast('sidebar', { type: 'node-log', line: clipped, stream })

    if (!s.devPort) {
      const found = portFromLine(clipped)
      if (found && found !== s.previewPort) {
        s.ports?.add(found)
        void adoptPort(s, found)
      }
    }
  }

  function portFromLine(line: string): number | undefined {
    const url = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\]):(\d{2,5})/i.exec(line)
    if (url) return validPort(Number(url[1]))
    const explicit = /\bport\s*[:=]?\s*(\d{2,5})/i.exec(line)
    if (explicit && /\b(port|listen|local|server|running|started|http)\b/i.test(line)) {
      return validPort(Number(explicit[1]))
    }
    const listening = /(?:listening|running|started|serving|available)[^\d]{0,24}(\d{2,5})\b/i.exec(line)
    if (listening) return validPort(Number(listening[1]))
    return undefined
  }

  function validPort(n: number): number | undefined {
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : undefined
  }

  async function adoptPort(s: RunState, port: number): Promise<void> {
    if (state !== s || s.devPort || s.ready) return
    if (!validPort(port) || port === s.previewPort) return
    if (await canConnect(port)) markReady(s, port)
  }

  async function pollPorts(s: RunState, candidates: Set<number>, seq: number): Promise<void> {
    while (state === s && !s.ready && seq === runSeq) {
      const all = new Set<number>(candidates)
      for (const port of s.ports ?? []) all.add(port)
      for (const port of all) {
        if (state !== s || s.ready) return
        if (port === s.previewPort) continue
        if (await canConnect(port, 250)) {
          markReady(s, port)
          return
        }
      }
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  function markReady(s: RunState, port: number): void {
    if (state !== s || s.ready) return
    s.devPort = port
    s.ready = true
    s.starting = false
    if (s.timer) { clearTimeout(s.timer); s.timer = undefined }
    console.log(`[prirexstudio] Dev-сервер готов: ${HUB_HOST}:${port} → прокси ${s.previewPort}`)
    broadcast('sidebar', statusPayload())
  }

  // ---------- Статическая раздача ----------
  function serveFile(s: RunState, req: http.IncomingMessage, res: http.ServerResponse): void {
    const setCors = () => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', '*')
    }
    if (req.method === 'OPTIONS') {
      setCors()
      res.writeHead(204).end()
      return
    }
    setCors()

    const url = new URL(req.url ?? '/', `http://${HUB_HOST}`)
    let rel = decodeURIComponent(url.pathname)
    if (rel === '/' || rel === '') rel = s.file
    if (!rel.startsWith('/')) rel = '/' + rel
    const abs = path.normalize(path.join(s.dir, rel))
    if (abs !== s.dir && !abs.startsWith(s.dir + path.sep)) {
      res.writeHead(403).end('Forbidden')
      return
    }
    void fs.readFile(abs)
      .then((buf) => {
        const ext = path.extname(abs).toLowerCase()
        const mime = MIME[ext] ?? 'application/octet-stream'
        if (ext === '.html' || ext === '.htm') {
          res.writeHead(200, { 'Content-Type': mime })
          res.end(injectIntoHtml(buf.toString('utf8')))
        } else {
          res.writeHead(200, { 'Content-Type': mime })
          res.end(buf)
        }
      })
      .catch(() => {
        res.writeHead(404).end('Not Found')
      })
  }

  // ---------- Обратный прокси для Node.js-сайтов ----------
  function handleProxyRequest(s: RunState, req: http.IncomingMessage, res: http.ServerResponse): void {
    const target = s.devPort
    if (!target) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(startingPage(s))
      return
    }

    const headers: http.OutgoingHttpHeaders = { ...req.headers }
    for (const name of HOP_HEADERS) delete headers[name]
    // identity: иначе HTML придёт сжатым и инъекция не сработает.
    delete headers['accept-encoding']
    headers.host = `${HUB_HOST}:${target}`
    // Dev-серверы (Vite/Next) сверяют Origin/Host апгрейда; предпросмотр живёт
    // на другом порту, поэтому выдаём запрос за same-origin dev-сервера.
    if (typeof headers.origin === 'string') headers.origin = `http://${HUB_HOST}:${target}`

    const upstream = http.request(
      { host: HUB_HOST, port: target, path: req.url ?? '/', method: req.method, headers, agent: false },
      (up) => {
        const status = up.statusCode ?? 502
        const outHeaders = filterResponseHeaders(up.headers)
        if (status >= 300 && status < 400 && typeof outHeaders.location === 'string') {
          outHeaders.location = rewriteLocation(outHeaders.location, s)
        }
        const contentType = String(up.headers['content-type'] ?? '')
        const encoded = Boolean(up.headers['content-encoding'])
        if (/text\/html/i.test(contentType) && (req.method === 'GET' || req.method === 'HEAD')) {
          const chunks: Buffer[] = []
          up.on('data', (chunk: Buffer) => chunks.push(chunk))
          up.on('end', () => {
            let body = Buffer.concat(chunks)
            if (!encoded) {
              body = Buffer.from(injectIntoHtml(body.toString('utf8')), 'utf8')
              delete outHeaders['content-length']
            }
            res.writeHead(status, outHeaders)
            res.end(body)
          })
          up.on('error', () => { try { res.destroy() } catch { /* ignore */ } })
          return
        }
        res.writeHead(status, outHeaders)
        up.pipe(res)
      },
    )
    upstream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(errorPage(s, 'Dev-сервер не отвечает. Проверьте лог сервера.'))
      } else {
        try { res.destroy() } catch { /* ignore */ }
      }
    })
    req.on('aborted', () => { try { upstream.destroy() } catch { /* ignore */ } })
    req.pipe(upstream)
  }

  function handleProxyUpgrade(s: RunState, req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const target = s.devPort
    if (!target) { try { socket.destroy() } catch { /* ignore */ } return }

    const headers: http.OutgoingHttpHeaders = { ...req.headers }
    delete headers.host
    headers.host = `${HUB_HOST}:${target}`
    if (typeof headers.origin === 'string') headers.origin = `http://${HUB_HOST}:${target}`

    const upstream = http.request({
      host: HUB_HOST, port: target, path: req.url ?? '/', method: req.method, headers, agent: false,
    })
    upstream.on('upgrade', (up, upSocket, upHead) => {
      if (isHmrUpgrade(req)) s.hmrActive = true
      const lines = ['HTTP/1.1 101 Switching Protocols']
      for (let i = 0; i < up.rawHeaders.length; i += 2) {
        lines.push(`${up.rawHeaders[i]}: ${up.rawHeaders[i + 1]}`)
      }
      try { socket.write(lines.join('\r\n') + '\r\n\r\n') } catch { /* ignore */ }
      if (upHead && upHead.length) { try { socket.write(upHead) } catch { /* ignore */ } }
      if (head && head.length) { try { upSocket.write(head) } catch { /* ignore */ } }
      upSocket.pipe(socket)
      socket.pipe(upSocket)
      upSocket.on('error', () => { try { socket.destroy() } catch { /* ignore */ } })
      socket.on('error', () => { try { upSocket.destroy() } catch { /* ignore */ } })
    })
    upstream.on('error', () => { try { socket.destroy() } catch { /* ignore */ } })
    upstream.on('response', (res) => {
      // Апгрейд не поддержан upstream: закрываем сокет, не оставляя его висеть.
      try { socket.write(`HTTP/1.1 ${res.statusCode ?? 502} ${res.statusMessage ?? 'Bad Gateway'}\r\n\r\n`) } catch { /* ignore */ }
      try { socket.destroy() } catch { /* ignore */ }
    })
    upstream.end()
  }

  function isHmrUpgrade(req: http.IncomingMessage): boolean {
    const url = String(req.url ?? '')
    const protocol = String(req.headers['sec-websocket-protocol'] ?? '')
    return /hmr|vite|webpack|sockjs/i.test(protocol) || /hmr|vite|webpack|sockjs|hot-update/i.test(url)
  }

  function filterResponseHeaders(input: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
    const out: http.OutgoingHttpHeaders = {}
    for (const [name, value] of Object.entries(input)) {
      if (value === undefined) continue
      const lower = name.toLowerCase()
      if (HOP_HEADERS.has(lower) || STRIPPED_RESPONSE_HEADERS.has(lower) || lower === 'content-length') continue
      out[name] = value
    }
    return out
  }

  function rewriteLocation(location: string, s: RunState): string {
    if (!s.devPort) return location
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const prefix = `http://${host}:${s.devPort}`
      if (location.startsWith(prefix)) return `http://${HUB_HOST}:${s.previewPort}${location.slice(prefix.length)}`
      const secure = `https://${host}:${s.devPort}`
      if (location.startsWith(secure)) return `http://${HUB_HOST}:${s.previewPort}${location.slice(secure.length)}`
    }
    return location
  }

  function startingPage(s: RunState): string {
    const log = s.logs.slice(-14).join('\n')
    return `<!doctype html><html><head><meta charset="utf-8"><title>PriRex Preview</title>
<style>
  html,body{margin:0;height:100%;font:13px/1.5 system-ui,sans-serif;background:#111114;color:#eee}
  main{max-width:560px;margin:0 auto;padding:34px 20px}
  h1{font-size:16px;margin:0 0 6px;color:#ff007f}
  code{font-family:ui-monospace,Consolas,monospace;font-size:12px;background:#1c1c1f;padding:2px 6px;border-radius:5px}
  pre{margin-top:14px;padding:12px;border-radius:8px;background:#1c1c1f;font:11px/1.45 ui-monospace,Consolas,monospace;color:#bbb;white-space:pre-wrap;max-height:220px;overflow:auto}
  .muted{opacity:.6}
</style></head><body><main>
<h1>PriRex Preview</h1>
<p class="muted">Запускаем Node.js-сервер, ждём порт…</p>
<p><code>${escapeHtml(s.command ?? '')}</code></p>
${log ? `<pre>${escapeHtml(log)}</pre>` : ''}
<p class="muted">Страница обновится сама.</p>
</main><script>setTimeout(function(){location.reload()},1200)</script></body></html>`
  }

  function errorPage(s: RunState, message: string): string {
    return `<!doctype html><html><head><meta charset="utf-8"><title>PriRex Preview</title>
<style>html,body{margin:0;height:100%;font:13px/1.5 system-ui,sans-serif;background:#111114;color:#eee}main{max-width:560px;margin:0 auto;padding:34px 20px}h1{font-size:16px;color:#ff3b5c}</style>
</head><body><main><h1>PriRex Preview</h1><p>${escapeHtml(message)}</p><p style="opacity:.6">${escapeHtml(s.command ?? '')}</p></main></body></html>`
  }

  // ---------- Обработка сообщений хаб-сокетов ----------
  function handleSocketMessage(ws: WsClient, raw: Buffer | string): void {
    let msg: Record<string, unknown>
    try {
      const parsed = JSON.parse(raw.toString()) as unknown
      if (typeof parsed !== 'object' || parsed === null) return
      msg = parsed as Record<string, unknown>
    } catch {
      return
    }
    assumeRole(ws, msg)

    switch (msg.type) {
      case 'hello': {
        // Новая страница подхватила хаб — пересылаем актуальную задержку ховера,
        // иначе она останется 3000 по умолчанию до первой ручной смены.
        if (roles.get(ws) === 'page') sendJson(ws, { type: 'hover-ms', ms: hoverMsSetting })
        // Подключилась вкладка плагина: если сервер ещё не запущен, а у сессии
        // есть рабочая папка — определяем проект. Статический сайт открываем
        // сразу (как раньше), Node.js-проект только показываем: запуск
        // произвольного скрипта требует явного действия пользователя.
        if (roles.get(ws) !== 'sidebar') break
        const sid = typeof msg.sessionId === 'string' && msg.sessionId ? msg.sessionId : undefined
        void resolveSessionDir(sid).then(async (dir) => {
          if (!dir || state) return
          const info = await detectProject(dir)
          if (state) return
          if (info.mode === 'static' && info.files.length > 0) {
            console.log(`[prirexstudio] Автооткрытие папки сессии: ${info.dir}`)
            const r2 = await startRun(info.dir, { mode: 'static' })
            if (r2.ok) broadcast('sidebar', statusPayload())
            else if (!r2.canceled && r2.error) sendJson(ws, { type: 'started-error', error: r2.error })
          } else {
            sendJson(ws, detectedPayload(info))
          }
        })
        break
      }
      case 'detect': {
        const dir = typeof msg.dir === 'string' ? msg.dir.trim() : ''
        if (!dir) { sendJson(ws, { type: 'started-error', error: 'Укажите путь к папке проекта.' }); break }
        void detectProject(dir)
          .then((info) => sendJson(ws, detectedPayload(info)))
          .catch((err: Error) => sendJson(ws, { type: 'started-error', error: err.message }))
        break
      }
      case 'start': {
        const dir = typeof msg.dir === 'string' ? msg.dir.trim() : ''
        if (!dir) { sendJson(ws, { type: 'started-error', error: 'Укажите путь к папке проекта.' }); break }
        const file = typeof msg.file === 'string' ? msg.file : ''
        const mode = msg.mode === 'node' || msg.mode === 'static' ? (msg.mode as PreviewMode) : undefined
        const command = typeof msg.command === 'string' ? msg.command : ''
        void startRun(dir, { mode, file, command }).then((res2) => {
          if (res2.canceled) return
          if (res2.ok) {
            broadcast('sidebar', statusPayload())
          } else {
            sendJson(ws, { type: 'started-error', error: res2.error ?? 'Не удалось запустить проект' })
            sendJson(ws, statusPayload())
          }
        })
        break
      }
      case 'stop': {
        stopRun()
        sendJson(ws, { type: 'stopped' })
        broadcast('sidebar', { type: 'status', running: false, hubFailed })
        break
      }
      case 'status': {
        sendJson(ws, statusPayload())
        break
      }
      case 'version': {
        sendJson(ws, { type: 'version', version: '2.0.0' })
        break
      }
      case 'hover-ms': {
        // Задержка ховера от вкладки плагина — пересылаем страницам.
        const ms = Math.round(Number(msg.ms))
        if (ms >= 500 && ms <= 10000) { hoverMsSetting = ms; broadcast('page', { type: 'hover-ms', ms }) }
        break
      }
      case 'console-error':
      case 'inspector-prompt': {
        // Сообщения страницы пересылаем вкладке плагина.
        broadcast('sidebar', msg)
        break
      }
      default:
        break
    }
  }

  console.log('[prirexstudio] Приостановка при деактивации не требуется — очистка по завершении apply')
  // Если DSH закрывается, не оставляем dev-сервер сиротой.
  const onProcessExit = () => {
    if (state?.child) killTree(state.child)
  }
  process.once('exit', onProcessExit)
  return () => {
    process.removeListener('exit', onProcessExit)
    stopRun()
    for (const ws of wss.clients) try { ws.terminate() } catch { /* ignore */ }
    wss.close()
  }
}
