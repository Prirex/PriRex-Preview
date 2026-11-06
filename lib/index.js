/**
 * PriRex Studio — сервис хоста.
 *
 * Запускает WebSocket-хаб на 127.0.0.1:3099 сразу при активации плагина и
 * по первому сообщению {type:'start', dir, file} поднимает локальный HTTP-сервер
 * (свободный порт) для выбранной папки проекта: CORS открыт, HTML-отвety получают
 * инъектированный скрипт инспектора. chokidar следит за *.html|*.css|*.js и шлёт
 * {type:'reload'} в WebView; сообщения страницы (console-error, inspector-prompt)
 * пересылаются клиентам роли sidebar.
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { watch } from 'chokidar';
const HUB_HOST = '127.0.0.1';
const HUB_PORT = Number(process.env.PRIREX_HUB_PORT ?? 3099);
/** MIME-карта для локальной раздачи. */
const MIME = {
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
};
/**
 * Скрипт, инъектируемый в HTML перед последним </body>.
 * Печатает: live-reload по WS-сигналу, перехват onerror/unhandledrejection/console.error,
 * hover-подсветку 2px dashed #ff007f и панель «Что изменить?» с отсылкой
 * outerHTML + computed-стилей в плагин.
 */
const INSPECTOR_SOURCE = `;(function () {
  if (window.__prirexStudio) return;
  window.__prirexStudio = true;
  var HUB = 'ws://127.0.0.1:3099';
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
})();`;
export function apply(ctx, _config) {
    const roles = new Map();
    let state;
    let hubFailed = false;
    // Последняя выбранная задержка ховера — шлём каждой новой странице при подключении.
    let hoverMsSetting = 3000;
    // ---------- Разрешение «текущей папки» сессии (паттерн dsh-better-sidebar) ----------
    // sessionId → cwd: живой сервис workingDirectory, затем header.cwd сессии.
    // Всё через опциональные цепочки — отсутствие сервиса не должно ломать хаб.
    async function resolveSessionDir(sessionId) {
        if (!sessionId)
            return null;
        try {
            const sessions = ctx?.sessions;
            const session = typeof sessions?.get === 'function' ? sessions.get(String(sessionId)) : undefined;
            let cwd;
            try {
                const wd = typeof ctx?.get === 'function' ? ctx.get('workingDirectory') : undefined;
                if (wd && typeof wd.get === 'function' && session)
                    cwd = wd.get(session);
            }
            catch { /* сервис недоступен — идём дальше */ }
            if (typeof cwd !== 'string' || cwd === '')
                cwd = session?.header?.cwd;
            if (typeof cwd !== 'string' || cwd === '')
                return null;
            const resolved = path.resolve(cwd);
            const st = await fs.stat(resolved);
            return st.isDirectory() ? resolved : null;
        }
        catch {
            return null;
        }
    }
    // ---------- Скан HTML-файлов проекта (хост владеет файловой системой) ----------
    const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next']);
    async function scanHtmlFiles(dir) {
        const found = [];
        async function walk(rel, depth) {
            if (depth > 3 || found.length >= 500)
                return;
            let entries;
            try {
                entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true });
            }
            catch {
                return;
            }
            for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
                if (found.length >= 500)
                    return;
                const childRel = rel ? `${rel}/${e.name}` : e.name;
                if (e.isDirectory()) {
                    if (!SKIP_DIRS.has(e.name))
                        await walk(childRel, depth + 1);
                }
                else if (/\.(html?|htm)$/i.test(e.name)) {
                    found.push(childRel);
                }
            }
        }
        await walk('', 0);
        // Сначала корневые файлы, затем по глубине и имени.
        return found.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    }
    function pickDefaultFile(files) {
        if (files.includes('index.html'))
            return 'index.html';
        return files[0] ?? 'index.html';
    }
    // ---------- WebSocket-хаб ----------
    const wss = new WebSocketServer({ host: HUB_HOST, port: HUB_PORT });
    wss.on('listening', () => {
        console.log(`[prirexstudio] WS-хаб запущен на ws://${HUB_HOST}:${HUB_PORT}`);
    });
    wss.on('error', (err) => {
        hubFailed = true;
        console.error('[prirexstudio] Ошибка WS-хаба:', err.message);
    });
    function sendJson(ws, obj) {
        if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify(obj));
    }
    function broadcast(role, obj) {
        const data = JSON.stringify(obj);
        for (const [ws, r] of roles) {
            if ((role === undefined || r === role) && ws.readyState === WebSocket.OPEN)
                ws.send(data);
        }
    }
    wss.on('connection', (ws) => {
        // Новая вкладка плагина сразу получает актуальный статус.
        sendJson(ws, statusPayload());
        ws.on('message', (raw) => handleSocketMessage(ws, raw));
        ws.on('close', () => roles.delete(ws));
    });
    function statusPayload() {
        if (state)
            return { type: 'status', running: true, port: state.port, dir: state.dir, file: state.file, files: state.files ?? [] };
        return { type: 'status', running: false, hubFailed };
    }
    function assumeRole(ws, msg) {
        if (roles.has(ws))
            return;
        const raw = typeof msg.role === 'string' ? msg.role : inferRole(msg.type);
        if (raw === 'sidebar' || raw === 'page')
            roles.set(ws, raw);
    }
    function inferRole(type) {
        switch (type) {
            case 'start':
            case 'stop':
            case 'status':
                return 'sidebar';
            case 'hello':
            case 'console-error':
            case 'inspector-prompt':
                return 'page';
            default:
                return undefined;
        }
    }
    // ---------- HTTP-сервер ----------
    async function startRun(dir, file) {
        stopRun();
        const resolved = path.resolve(dir);
        try {
            const st = await fs.stat(resolved);
            if (!st.isDirectory())
                return { ok: false, error: `Путь не является папкой: ${resolved}` };
        }
        catch {
            return { ok: false, error: `Папка не найдена: ${resolved}` };
        }
        // Каталог HTML-страниц отдаём клиенту сам хост; если запрошенный файл
        // отсутствует — подбираем ближайший (index.html в приоритете).
        const files = await scanHtmlFiles(resolved).catch(() => []);
        let chosenFile = file;
        try {
            const st2 = await fs.stat(path.join(resolved, ...chosenFile.split('/')));
            if (!st2.isFile())
                chosenFile = pickDefaultFile(files);
        }
        catch {
            chosenFile = pickDefaultFile(files);
        }
        const server = http.createServer((req, res) => serveFile(resolved, req, res));
        const sockets = new Set();
        server.on('connection', (s) => {
            sockets.add(s);
            s.on('close', () => sockets.delete(s));
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, HUB_HOST, () => resolve());
        }).catch((err) => ({ error: err.message }));
        const addr = server.address();
        if (typeof addr !== 'object' || addr === null)
            return { ok: false, error: 'Не удалось получить порт сервера' };
        const port = addr.port;
        let watcher;
        try {
            watcher = watch(resolved, { ignoreInitial: true });
        }
        catch (err) {
            console.error('[prirexstudio] chokidar не запустился:', err);
        }
        if (watcher) {
            let timer;
            const onChange = (_event, fileChanged) => {
                if (!/\.(html?|css|js)$/i.test(fileChanged))
                    return;
                clearTimeout(timer);
                timer = setTimeout(() => broadcast('page', { type: 'reload', file: fileChanged }), 150);
            };
            watcher.on('add', onChange).on('change', onChange).on('unlink', onChange);
        }
        state = { dir: resolved, file: chosenFile, port, files, watcher, server, sockets };
        console.log(`[prirexstudio] Сервер запущен: http://${HUB_HOST}:${port}/${chosenFile} (HTML-файлов найдено: ${files.length})`);
        return { ok: true };
    }
    function stopRun() {
        const s = state;
        if (!s)
            return;
        state = undefined;
        try {
            s.watcher?.close();
        }
        catch { /* ignore */ }
        for (const sock of s.sockets ?? []) {
            try {
                sock.destroy();
            }
            catch { /* ignore */ }
        }
        s.sockets?.clear();
        try {
            s.server?.close();
        }
        catch { /* ignore */ }
    }
    function serveFile(dir, req, res) {
        const setCors = () => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', '*');
        };
        if (req.method === 'OPTIONS') {
            setCors();
            res.writeHead(204).end();
            return;
        }
        setCors();
        const url = new URL(req.url ?? '/', `http://${HUB_HOST}`);
        let rel = decodeURIComponent(url.pathname);
        if (rel === '/' || rel === '')
            rel = state?.file ?? 'index.html';
        if (!rel.startsWith('/'))
            rel = '/' + rel;
        const abs = path.normalize(path.join(dir, rel));
        if (abs !== dir && !abs.startsWith(dir + path.sep)) {
            res.writeHead(403).end('Forbidden');
            return;
        }
        fs.readFile(abs)
            .then((buf) => {
            const ext = path.extname(abs).toLowerCase();
            const mime = MIME[ext] ?? 'application/octet-stream';
            if (ext === '.html' || ext === '.htm') {
                let html = buf.toString('utf8');
                const marker = '</body>';
                const idx = html.toLowerCase().lastIndexOf(marker);
                const script = `<script>${INSPECTOR_SOURCE}</script>`;
                html = idx >= 0 ? html.slice(0, idx) + script + html.slice(idx) : html + script;
                res.writeHead(200, { 'Content-Type': mime });
                res.end(html);
            }
            else {
                res.writeHead(200, { 'Content-Type': mime });
                res.end(buf);
            }
        })
            .catch(() => {
            res.writeHead(404).end('Not Found');
        });
    }
    // ---------- Обработка сообщений хаб-сокетов ----------
    function handleSocketMessage(ws, raw) {
        let msg;
        try {
            const parsed = JSON.parse(raw.toString());
            if (typeof parsed !== 'object' || parsed === null)
                return;
            msg = parsed;
        }
        catch {
            return;
        }
        assumeRole(ws, msg);
        switch (msg.type) {
            case 'hello': {
                // Новая страница подхватила хаб — пересылаем актуальную задержку ховера,
                // иначе она останется 3000 по умолчанию до первой ручной смены.
                if (roles.get(ws) === 'page')
                    sendJson(ws, { type: 'hover-ms', ms: hoverMsSetting });
                // Подключилась вкладка плагина: если сервер ещё не запущен, а у сессии
                // есть рабочая папка — открываем её автоматически.
                if (roles.get(ws) !== 'sidebar')
                    break;
                const sid = typeof msg.sessionId === 'string' && msg.sessionId ? msg.sessionId : undefined;
                void resolveSessionDir(sid).then((dir) => {
                    if (!dir || state)
                        return;
                    console.log(`[prirexstudio] Автооткрытие папки сессии: ${dir}`);
                    void startRun(dir, '').then((r2) => {
                        sendJson(ws, statusPayload());
                        if (!r2.ok && r2.error)
                            sendJson(ws, { type: 'started-error', error: r2.error });
                    });
                });
                break;
            }
            case 'start': {
                const dir = typeof msg.dir === 'string' ? msg.dir : '';
                const file = typeof msg.file === 'string' && msg.file !== '' ? msg.file : 'index.html';
                void startRun(dir, file).then((res2) => {
                    if (res2.ok)
                        sendJson(ws, statusPayload());
                    else
                        sendJson(ws, { type: 'started-error', error: res2.error });
                });
                break;
            }
            case 'stop': {
                stopRun();
                sendJson(ws, { type: 'stopped' });
                broadcast('sidebar', { type: 'status', running: false, hubFailed });
                break;
            }
            case 'status': {
                sendJson(ws, statusPayload());
                break;
            }
            case 'hover-ms': {
                // Задержка ховера от вкладки плагина — пересылаем страницам.
                const ms = Math.round(Number(msg.ms));
                if (ms >= 500 && ms <= 10000) {
                    hoverMsSetting = ms;
                    broadcast('page', { type: 'hover-ms', ms });
                }
                break;
            }
            case 'console-error':
            case 'inspector-prompt': {
                // Сообщения страницы пересылаем вкладке плагина.
                broadcast('sidebar', msg);
                break;
            }
            default:
                break;
        }
    }
    console.log('[prirexstudio] Приостановка при деактивации не требуется — очистка по завершении apply');
    return () => {
        stopRun();
        for (const ws of wss.clients)
            try {
                ws.terminate();
            }
            catch { /* ignore */ }
        wss.close();
    };
}
