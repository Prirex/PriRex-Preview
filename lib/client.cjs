"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * PriRex Preview — клиентская часть (браузерный артефакт).
 *
 * Регистрирует вкладку «PriRex Preview» в правой панели DSH: выбор папки проекта,
 * запуск локального сервера через WS-хаб на 127.0.0.1:3099, адаптивная панель
 * устройств (1920/768/375), журнал ошибок консоли со страниц и DOM-инспектор
 * с вставкой CSS-метаданных в поле ввода активного чата (autoSubmit выключен).
 */
// Логотип PriRex (base64 PNG; инлайнён, чтобы обойти ограничение finalize на локальные require).
const LOGO_DATA_URI = "data:image/png;base64,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";
const TAB_ID = 'prirexstudio';
// Бренд: «R» в PriRex — красная.
const BRAND_RED = '#ff3b5c';
const VERSION = '1.0.0';
const STRINGS = {
    ru: {
        title: 'PriRex Preview',
        pickDir: 'Выбрать папку проекта',
        noFiles: 'В папке не найдено HTML-файлов.',
        filesHeader: 'HTML-файлы проекта:',
        deviceDesktop: '🖥️ Десктоп (1920px)',
        deviceTablet: '💻 Планшет (768px)',
        deviceMobile: '📱 Мобильный (375px)',
        stopServer: '⏹ Стоп сервера',
        exitProject: '✕ Выйти из проекта',
        serverOn: 'Сервер запущен',
        serverOff: 'Сервер не запущен',
        hubDown: 'WS-хаб недоступен (порт 3099)',
        errorsHeader: 'Ошибки консоли:',
        noErrors: 'Ошибок нет.',
        copyForAi: 'Скопировать для ИИ',
        copied: 'Скопировано',
        inspectorSent: 'Текст инспектора вставлен в чат (autoSubmit выключен).',
        insertFailed: 'Не удалось вставить текст в чат — скопируйте вручную.',
        loadingFiles: 'Поиск файлов…',
        pickUnavailable: 'Диалог выбора папки не открылся (сервис uiWorkspace недоступен) — введите путь вручную ниже.',
        pathPlaceholder: 'Путь к папке проекта, например D:\\game\\my-project',
        openDir: 'Открыть',
        whatTitle: 'Что такое PriRex Preview?',
        d1: 'Локальный сервер для папки вашего сайта — живое превью прямо в боковой панели.',
        d2: 'Наведите курсор на любой элемент на 3 секунды — откроется редактор, клики не нужны.',
        d3: 'Правки уходят в чат и применяются сразу; страница обновляется при сохранении файлов.',
        d2hint: 'изменить цвет…',
        devBy: 'Разработано:',
        openBrowser: '🌐 В браузере',
        settings: '⚙ Настройки',
        closeSettings: '✕ Закрыть настройки',
        hoverTimeout: 'Задержка ховера (сек):',
        hoverSec: 'с',
        restartServer: '↻ Перезапустить сервер',
        pickDirShort: 'Выбрать папку',
        launchBtn: 'Запустить проект',
        descIntro: 'Плагин интегрирует живое окно предпросмотра вашего интерфейса напрямую в рабочую среду DeepSeek Harness, связывая визуальные элементы с мощностью ИИ-чата.',
        f1t: 'Полный отказ от ручного копирования',
        f1d: 'Автоматизация процессов: плагин полностью избавляет от необходимости копировать ответы нейросети и вручную переносить их в файлы проекта.',
        f2t: 'Изоляция контекста компонента',
        f2d: 'Система автоматически определяет границы выбранного элемента и передает ИИ только нужный фрагмент кода. Это экономит токены и повышает точность генерации.',
        f3t: 'Изолированное точечное редактирование',
        f3d: 'Безопасная модификация: изменения вносятся строго в целевой компонент. Архитектура проекта и соседние функции полностью защищены от случайных поломок.',
        f4t: 'Прямая синхронизация правок (Hot Reload)',
        f4d: 'Мгновенное обновление: внесенные ИИ изменения сразу отображаются в окне превью в режиме реального времени при сохранении файлов.',
        versionNote: 'Версия v1.0.0 — базовый минимум. В следующих версиях будет добавлена поддержка Node.js-сайтов, после чего обновится дизайн.',
    },
    en: {
        title: 'PriRex Preview',
        pickDir: 'Pick project folder',
        noFiles: 'No HTML files found in the folder.',
        filesHeader: 'Project HTML files:',
        deviceDesktop: '🖥️ Desktop (1920px)',
        deviceTablet: '💻 Tablet (768px)',
        deviceMobile: '📱 Mobile (375px)',
        stopServer: '⏹ Stop server',
        exitProject: '✕ Leave project',
        serverOn: 'Server is running',
        serverOff: 'Server is stopped',
        hubDown: 'WS hub unavailable (port 3099)',
        errorsHeader: 'Console errors:',
        noErrors: 'No errors.',
        copyForAi: 'Copy for AI',
        copied: 'Copied',
        inspectorSent: 'Inspector text inserted into chat (autoSubmit is off).',
        insertFailed: 'Could not insert text into chat — copy it manually.',
        loadingFiles: 'Scanning files…',
        pickUnavailable: 'Folder picker dialog did not open (uiWorkspace service unavailable) — type the path manually below.',
        pathPlaceholder: 'Project folder path, e.g. D:\\game\\my-project',
        openDir: 'Open',
        whatTitle: 'What is PriRex Preview?',
        d1: 'A local server for your site folder — a live preview right in the sidebar.',
        d2: 'Hover any element for 3 seconds and an editor opens — no clicks needed.',
        d3: 'Changes go straight to chat and apply instantly; the page reloads on file save.',
        d2hint: 'change color…',
        devBy: 'Developed by:',
        openBrowser: '🌐 In browser',
        settings: '⚙ Settings',
        closeSettings: '✕ Close settings',
        hoverTimeout: 'Hover delay (sec):',
        hoverSec: 's',
        restartServer: '↻ Restart server',
        pickDirShort: 'Pick folder',
        launchBtn: 'Launch project',
        descIntro: 'The plugin integrates a live preview window of your interface directly into the DeepSeek Harness workspace, tying visual elements to the power of AI chat.',
        f1t: 'No more manual copying',
        f1d: 'Automation: the plugin removes the need to copy neural-network answers and move them into project files by hand.',
        f2t: 'Component context isolation',
        f2d: 'The system detects the bounds of the selected element and sends only the needed code fragment to AI. This saves tokens and improves generation accuracy.',
        f3t: 'Isolated pinpoint editing',
        f3d: 'Safe modification: changes are made strictly in the target component. Project architecture and neighboring features stay protected from accidental breakage.',
        f4t: 'Direct edit sync (Hot Reload)',
        f4d: 'Instant updates: AI-applied changes appear in the preview window in real time when files are saved.',
        versionNote: 'Version v1.0.0 is the basic minimum. Upcoming versions will add Node.js site support, then a design refresh.',
    },
    zh: {
        title: 'PriRex Preview',
        pickDir: '选择项目文件夹',
        noFiles: '该文件夹中未找到 HTML 文件。',
        filesHeader: '项目 HTML 文件：',
        deviceDesktop: '🖥️ 桌面 (1920px)',
        deviceTablet: '💻 平板 (768px)',
        deviceMobile: '📱 手机 (375px)',
        stopServer: '⏹ 停止服务器',
        exitProject: '✕ 退出项目',
        serverOn: '服务器已启动',
        serverOff: '服务器未启动',
        hubDown: 'WS 中心不可用（端口 3099）',
        errorsHeader: '控制台错误：',
        noErrors: '无错误。',
        copyForAi: '复制给 AI',
        copied: '已复制',
        inspectorSent: '检查器文本已插入聊天（autoSubmit 已关闭）。',
        insertFailed: '无法将文本插入聊天，请手动复制。',
        loadingFiles: '正在搜索文件…',
        pickUnavailable: '文件夹选择对话框未打开（uiWorkspace 服务不可用）——请在下方手动输入路径。',
        pathPlaceholder: '项目文件夹路径，例如 D:\\game\\my-project',
        openDir: '打开',
        whatTitle: '什么是 PriRex Preview？',
        d1: '为您的网站文件夹提供本地服务器 —— 实时预览就在侧边栏中。',
        d2: '将鼠标悬停在任意元素上 3 秒即可打开编辑器，无需点击。',
        d3: '修改直接发送到聊天并立即生效；保存文件时页面自动刷新。',
        d2hint: '修改颜色…',
        devBy: '开发者：',
        openBrowser: '🌐 在浏览器中打开',
        settings: '⚙ 设置',
        closeSettings: '✕ 关闭设置',
        hoverTimeout: '悬停延迟（秒）：',
        hoverSec: '秒',
        restartServer: '↻ 重启服务器',
        pickDirShort: '选择文件夹',
        launchBtn: '启动项目',
        descIntro: '该插件将您界面的实时预览窗口直接集成到 DeepSeek Harness 工作区，把视觉元素与 AI 聊天的能力紧密相连。',
        f1t: '彻底告别手动复制',
        f1d: '流程自动化：完全无需复制神经网络的回答并手动粘贴到项目文件中。',
        f2t: '组件上下文隔离',
        f2d: '系统自动识别所选元素的边界，只把需要的代码片段传给 AI，节省 token 并提高生成精度。',
        f3t: '独立的精准编辑',
        f3d: '安全修改：改动严格限定在目标组件内，项目架构和相邻功能完全不受影响。',
        f4t: '实时同步修改（Hot Reload）',
        f4d: '即时更新：AI 的修改在保存文件后立刻以实时方式显示在预览窗口中。',
        versionNote: '当前版本 v1.0.0 为基础功能。后续版本将支持 Node.js 网站，之后会更新界面设计。',
    },
};
function makeT(locale) {
    const table = STRINGS[locale] ?? STRINGS.ru;
    return (key) => table[key] ?? STRINGS.ru[key] ?? key;
}
// ---------------------------------------------------------------------------
// Стили на токенах темы DSH
// ---------------------------------------------------------------------------
const S = {
    root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 10, padding: 2 },
    row: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    // Брендовая шапка: иконка + название + статус-чип; справа — выход из проекта.
    header: {
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8,
        background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l2)',
        color: 'var(--dsw-alias-label-primary)', fontSize: 13, fontWeight: 700, letterSpacing: 0.2,
    },
    sectionTitle: {
        display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: 0.8, opacity: 0.75,
        color: 'var(--dsw-alias-label-secondary)', margin: '2px 0 -2px 2px',
    },
    statusChip: (ok) => ({
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 999,
        fontSize: 11, fontWeight: 600, border: `1px solid ${ok ? 'var(--dsw-alias-state-success)' : 'var(--dsw-alias-border-l2)'}`,
        color: ok ? 'var(--dsw-alias-state-success)' : 'var(--dsw-alias-label-secondary)',
    }),
    statusDot: (ok) => ({
        width: 7, height: 7, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
        background: ok ? 'var(--dsw-alias-state-success)' : 'var(--dsw-alias-state-error)',
    }),
    hdrStatus: {
        display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, opacity: 0.85,
    },
    langBtn: {
        padding: '2px 7px', borderRadius: 6, cursor: 'pointer', fontSize: 10.5, fontWeight: 700, flexShrink: 0,
        color: 'var(--dsw-alias-label-secondary)', background: 'transparent', border: '1px solid var(--dsw-alias-border-l2)',
    },
    button: {
        padding: '6px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 12, lineHeight: 1.3,
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l2)',
    },
    buttonActive: {
        padding: '6px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 12, lineHeight: 1.3, fontWeight: 600,
        color: '#fff', background: 'var(--dsw-alias-brand-primary)', border: '1px solid var(--dsw-alias-brand-primary)',
    },
    buttonDanger: {
        padding: '4px 8px', borderRadius: 7, cursor: 'pointer', fontSize: 11.5, lineHeight: 1.3, fontWeight: 600,
        color: 'var(--dsw-alias-state-error)', background: 'transparent',
        border: '1px solid var(--dsw-alias-state-error)', marginLeft: 'auto', flexShrink: 0,
    },
    card: {
        borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6,
        background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l2)',
    },
    listWrap: { overflowY: 'auto', minHeight: 40, maxHeight: 220, flex: '1 1 auto' },
    fileItem: (active) => ({
        display: 'block', width: '100%', textAlign: 'left', padding: '6px 9px', margin: '2px 0',
        borderRadius: 7, cursor: 'pointer', fontSize: 12, wordBreak: 'break-all',
        color: active ? '#fff' : 'var(--dsw-alias-label-primary)', fontWeight: active ? 600 : 400,
        background: active ? 'var(--dsw-alias-brand-primary)' : 'transparent',
        border: `1px solid ${active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)'}`,
    }),
    iframeBox: {
        flex: '1 1 auto', minHeight: 120, overflow: 'auto', borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l2)', background: '#fff', position: 'relative',
    },
    iframe: { display: 'block', height: '100%', width: '100%', border: 'none' },
    logWrap: {
        maxHeight: 180, overflowY: 'auto', borderRadius: 8, padding: '6px 10px', fontSize: 12,
        background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)',
    },
    logItem: {
        display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 0',
        borderBottom: '1px solid var(--dsw-alias-border-l1)', color: 'var(--dsw-alias-state-error)',
        wordBreak: 'break-all', fontSize: 12, whiteSpace: 'pre-wrap',
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    },
    note: { fontSize: 11, opacity: 0.75, color: 'var(--dsw-alias-label-secondary)' },
    // --- главное меню ---------------------------------------------------------
    heroCard: {
        borderRadius: 10, padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center',
        background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l2)', textAlign: 'center',
    },
    heroTitle: { fontSize: 13.5, fontWeight: 700, color: 'var(--dsw-alias-label-primary)' },
    descBlock: { display: 'flex', flexDirection: 'column', gap: 8 },
    descItem: {
        display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, lineHeight: 1.45,
        color: 'var(--dsw-alias-label-secondary)', textAlign: 'left',
    },
    descBullet: (i) => ({
        width: 7, height: 7, borderRadius: '50%', flexShrink: 0, marginTop: 4,
        background: i === 1 ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)',
    }),
    devLine: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
    logoImg: { height: 24, width: 'auto', display: 'block', cursor: 'pointer' },
    // --- запуск проекта + подсказка -------------------------------------------
    launchCard: { borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l2)' },
    pathInput: { flex: 1, minWidth: 0, padding: '7px 9px', fontSize: 12, color: 'inherit', background: 'transparent', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 7 },
    bigButton: { width: '100%', padding: '10px 0', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: '#fff', background: 'var(--dsw-alias-brand-primary)' },
    descCard: { borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', border: '1px solid var(--dsw-alias-border-l2)', background: 'rgba(127,127,139,.05)' },
    descIntro: { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)', marginBottom: 12 },
    featTitle: { fontSize: 12.5, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', marginBottom: 3 },
    featText: { fontSize: 12, lineHeight: 1.45, color: 'var(--dsw-alias-label-secondary)' },
    versionNote: { marginTop: 14, fontSize: 10.5, lineHeight: 1.4, color: 'var(--dsw-alias-label-secondary)', opacity: .72, textAlign: 'center', paddingBottom: 6 },
    footerLine: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 'auto', paddingTop: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
};
// ---------------------------------------------------------------------------
// React — из браузерной таблицы модулей хоста (без CDN)
// ---------------------------------------------------------------------------
let REACT_OVERRIDE = null;
function getReact() {
    if (!REACT_OVERRIDE) {
        try {
            const r = typeof require === 'function' ? require('react') : null;
            REACT_OVERRIDE = (r && typeof r.useState === 'function' && typeof r.createElement === 'function') ? r : null;
        }
        catch {
            REACT_OVERRIDE = null;
        }
    }
    return REACT_OVERRIDE;
}
// ---------------------------------------------------------------------------
// Фоновая анимация главного меню: «сайт собирается и редактируется»
// (светлые тона, мягкий бренд-акцент; вставляется один раз в head)
// ---------------------------------------------------------------------------
const ANIM_CSS = `
.prx-stage{position:relative;display:flex;justify-content:center;padding:10px 4px 2px;pointer-events:none;}
.prx-scene{width:min(340px,96%);animation:prx-loopfade 7s linear infinite;}
.prx-browser{border-radius:10px;border:1px solid rgba(255,0,127,.38);background:#fff;box-shadow:0 10px 26px rgba(80,20,60,.10);overflow:hidden;animation:prx-rise .9s ease both;}
.prx-bar{height:14px;display:flex;align-items:center;gap:4px;padding:0 8px;border-bottom:1px solid rgba(255,0,127,.25);}
.prx-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,0,127,.45);flex-shrink:0;}
.prx-body{padding:9px 10px;display:flex;flex-direction:column;gap:6px;}
.prx-row{height:10px;border-radius:4px;background:rgba(255,0,127,.16);animation:prx-block .6s ease both;}
.prx-hero{position:relative;height:34px;border-radius:6px;background:linear-gradient(90deg,rgba(255,0,127,.22),rgba(255,0,127,.07));animation:prx-block .6s ease both;animation-delay:.55s;}
.prx-cursor{position:absolute;left:63%;top:46px;width:9px;height:9px;border-radius:50% 50% 50% 0;background:#ff007f;transform:rotate(-45deg);animation:prx-cursor 7s linear infinite;}
.prx-ring{position:absolute;left:58%;top:36px;width:16px;height:16px;border-radius:50%;border:2px solid #ff007f;opacity:0;animation:prx-ring 7s linear infinite;}
.prx-pill{position:absolute;left:64%;top:33px;font-size:9px;line-height:1;padding:3px 7px;border-radius:6px;background:#2a2a2e;color:#fff;opacity:0;transform-origin:left center;white-space:nowrap;animation:prx-pill 7s linear infinite;}
@keyframes prx-loopfade{0%{opacity:0}5%,88%{opacity:.95}96%,100%{opacity:0}}
@keyframes prx-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes prx-block{from{opacity:0;transform:scaleX(.55)}to{opacity:1;transform:none}}
@keyframes prx-cursor{0%,20%{opacity:0;left:18%;top:74%}30%{opacity:1}36%{left:63%;top:46px}58%,90%{opacity:1;left:63%;top:46px}97%,100%{opacity:0}}
@keyframes prx-ring{0%,44%{opacity:0;transform:scale(.4)}48%{opacity:.9}56%{opacity:0;transform:scale(2.1)}100%{opacity:0}}
@keyframes prx-pill{0%,50%{opacity:0;transform:scale(.7)}54%,88%{opacity:1;transform:scale(1)}96%,100%{opacity:0}}
`;
let animCssInjected = false;
function ensureAnimStyles() {
    if (animCssInjected)
        return;
    try {
        const doc = typeof document === 'undefined' ? null : document;
        if (!doc || !doc.head)
            return;
        let node = doc.getElementById('prirexstudio-anim');
        if (!node) {
            node = doc.createElement('style');
            node.id = 'prirexstudio-anim';
            node.textContent = ANIM_CSS;
            doc.head.appendChild(node);
        }
        animCssInjected = true;
    }
    catch { /* ignore */ }
}
// ---------------------------------------------------------------------------
// Иконка «прицел» (та же, что icon.svg)
// ---------------------------------------------------------------------------
// Фирменный знак: курсор мыши + всплывающее окно правки.
function CrosshairIcon(props) {
    const React = getReact();
    if (!React)
        return null;
    const size = props?.size ?? 16;
    return React.createElement('svg', { width: size, height: size, viewBox: '0 0 64 64', style: { display: 'block' } }, 
    // окно редактирования со «строками кода» и хвостиком к курсору
    React.createElement('rect', { x: 21, y: 4, width: 39, height: 31, rx: 7, fill: 'rgba(255,0,127,.10)', stroke: '#ff007f', strokeWidth: 5 }), React.createElement('line', { x1: 31, y1: 14.5, x2: 50, y2: 14.5, stroke: '#ff007f', strokeWidth: 4.5, strokeLinecap: 'round' }), React.createElement('line', { x1: 31, y1: 24.5, x2: 43, y2: 24.5, stroke: '#ff007f', strokeWidth: 4.5, strokeLinecap: 'round', opacity: .65 }), React.createElement('path', { d: 'M31 35 L26 46 L39 38 Z', fill: '#ff007f' }), 
    // курсор мыши поверх угла окна
    React.createElement('path', { d: 'M12 28 L12 54 L19.5 48 L23.5 57.5 L28.5 55.6 L25 46.6 L33.5 45 Z', fill: '#fff', stroke: '#ff007f', strokeWidth: 3.5, strokeLinejoin: 'round' }));
}
// ---------------------------------------------------------------------------
// Утилиты
// ---------------------------------------------------------------------------
/** Деликатный парсер результата uiWorkspace.listDirectory (форма не зафиксирована). */
function parseListing(raw) {
    const out = [];
    const push = (name, dir) => {
        if (typeof name === 'string' && name.length > 0)
            out.push({ name, dir });
    };
    if (Array.isArray(raw)) {
        for (const item of raw) {
            if (typeof item === 'string')
                push(item, false);
            else if (item && typeof item.name === 'string')
                push(item.name, Boolean(item.isDirectory ?? item.dir ?? item.type === 'dir'));
        }
    }
    else if (raw && typeof raw === 'object') {
        if (Array.isArray(raw.entries))
            for (const e of raw.entries)
                push(e?.name, Boolean(e?.isDirectory ?? e?.dir));
        if (Array.isArray(raw.files))
            for (const f of raw.files)
                push(f, false);
        if (Array.isArray(raw.dirs))
            for (const d of raw.dirs)
                push(d, true);
    }
    return out;
}
function toPosix(p) {
    return p.replace(/\\/g, '/');
}
/**
 * Вставка текста в поле ввода чата текущей сессии. Реальный API DSH (паттерн
 * dsh-better-sidebar, lib/client.js:27033–27055): sessions.scope(sessionId) даёт
 * AgentContext, затем conversation.input.for(actx).setDraft(draft + текст).
 * autoSubmit НЕ включается никогда — пользователь отправит сам.
 *
 * Сервисы ищутся в трёх местах: diRefs (разрешены раз в factory через
 * доказанный путь ctx.inject) → прямые свойства ctx → ctx.get(...).
 */
function insertIntoChat(ctx, props, text) {
    try {
        const sid = resolveSid(props ?? {});
        if (!sid) {
            console.warn('[prirexstudio] insertIntoChat: не удалось определить id сессии', 'keys props=', Object.keys(props ?? {}), 'currentSessionId=', currentSessionId, 'diRefs.sidebarRight=', !!diRefs.sidebarRight);
            return false;
        }
        const sessions = diRefs.sessions ?? ctx?.sessions ?? (typeof ctx?.get === 'function' ? ctx.get('sessions') : undefined);
        const actx = typeof sessions?.scope === 'function' ? sessions.scope(sid) : undefined;
        if (actx === undefined || actx === null) {
            console.warn('[prirexstudio] insertIntoChat: нет scope сессии', sid, 'sources=', Object.keys(sessions ?? {}));
            return false;
        }
        const conversation = diRefs.conversation ?? ctx?.conversation ?? (typeof ctx?.get === 'function' ? ctx.get('conversation') : undefined);
        const input = conversation?.input?.for?.(actx);
        if (!input || typeof input.setDraft !== 'function') {
            console.warn('[prirexstudio] insertIntoChat: conversation.input недоступен', Object.keys(conversation ?? {}), 'input keys=', input ? Object.keys(input) : null);
            return false;
        }
        const draft = String(input.state?.getSnapshot?.()?.draft ?? '');
        const next = draft ? `${draft}\n\n${text}` : text;
        input.setDraft(next);
        return true;
    }
    catch (err) {
        console.warn('[prirexstudio] insertIntoChat не удалась:', err);
        return false;
    }
}
async function copyText(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    }
    catch { /* fallback ниже */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
    }
    catch {
        return false;
    }
}
/** Шаблон запроса к ИИ для DOM-инспектора (autoSubmit выключен — только вставка). */
function buildInspectorText(comment, html, styles) {
    const styleLines = Object.keys(styles)
        .filter((k) => ['font-size', 'color', 'background-color', 'display', 'margin', 'padding', 'position'].includes(k))
        .map((k) => `${k}: ${styles[k]}`)
        .join('\n');
    return `Элемент HTML:\n${html}\n\nComputed-стили:\n${styleLines}\n\nКомментарий: ${comment}\nЗадача: изменить этот элемент согласно комментарию.`;
}
function TabBody(props) {
    const React = getReact();
    if (!React)
        return null;
    const [locale, setLocale] = React.useState('ru');
    // Ручной переключатель языка (RU → EN → 中文) — переживает перезагрузку вкладки.
    React.useEffect(() => {
        try {
            const v = localStorage.getItem('prirex.lang');
            if (v === 'ru' || v === 'en' || v === 'zh')
                setLocale(v);
        }
        catch { /* ignore */ }
    }, []);
    const toggleLang = () => {
        const next = locale === 'ru' ? 'en' : locale === 'en' ? 'zh' : 'ru';
        try {
            localStorage.setItem('prirex.lang', next);
        }
        catch { /* ignore */ }
        setLocale(next);
    };
    // Настройки: задержка ховера (передаётся страницам через WS-хаб).
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    const [hoverMs, setHoverMs] = React.useState(() => { try {
        const v = Number(localStorage.getItem('prirex.hoverMs'));
        return (v === 1500 || v === 3000 || v === 5000) ? v : 3000;
    }
    catch {
        return 3000;
    } });
    const hoverMsRef = React.useRef(hoverMs);
    hoverMsRef.current = hoverMs;
    const changeHoverMs = (ms) => {
        setHoverMs(ms);
        try {
            localStorage.setItem('prirex.hoverMs', String(ms));
        }
        catch { /* ignore */ }
        try {
            wsRef.current?.send(JSON.stringify({ type: 'hover-ms', ms }));
        }
        catch { /* ignore */ }
    };
    const tRef = React.useRef(makeT('ru'));
    tRef.current = makeT(locale);
    const t = (k) => tRef.current(k);
    const [dir, setDir] = React.useState(null);
    const [files, setFiles] = React.useState([]);
    const [scanning, setScanning] = React.useState(false);
    const [file, setFile] = React.useState(null);
    const [running, setRunning] = React.useState(null);
    const [device, setDevice] = React.useState(1920);
    const [errors, setErrors] = React.useState([]);
    const [note, setNote] = React.useState(null);
    const wsRef = React.useRef(null);
    const manualRef = React.useRef(null);
    // --- локаль: снапшот + подписка (защитно, форма API может отличаться) ---
    React.useEffect(() => {
        const ctx = props.__ctx;
        if (!ctx)
            return;
        let current = 'ru';
        try {
            const locSvc = ctx.locale ?? null;
            if (locSvc && typeof locSvc.getCurrent === 'function')
                current = String(locSvc.getCurrent() || 'ru');
            else if (typeof locSvc?.current === 'string')
                current = locSvc.current;
        }
        catch { /* ru */ }
        const mapLocale = (code) => code.startsWith('zh') ? 'zh' : code.startsWith('en') ? 'en' : 'ru';
        setLocale(mapLocale(current));
        let off;
        try {
            const locSvc = ctx.locale ?? null;
            if (locSvc && typeof locSvc.subscribe === 'function') {
                const unsub = locSvc.subscribe((code) => setLocale(mapLocale(code)));
                if (typeof unsub === 'function')
                    off = unsub;
            }
            else if (typeof ctx.on === 'function') {
                const h = (e) => setLocale(mapLocale(String(e?.locale ?? e?.code ?? e)));
                ctx.on('locale/change', h);
                off = () => ctx.off('locale/change', h);
            }
        }
        catch { /* снапшот уже применён */ }
        return () => {
            try {
                off?.();
            }
            catch { /* ignore */ }
        };
    }, [props.__ctx]);
    // --- WebSocket-клиент к хабу ---
    // Полный разбор свойств слота — один раз, для диагностики (есть ли sessionId).
    if (!tabPropsLogged) {
        tabPropsLogged = true;
        console.log('[prirexstudio] TabBody props keys=', Object.keys(props), 'sessionId=', props.sessionId ?? null);
    }
    const sidKey = resolveSid(props);
    React.useEffect(() => {
        let disposed = false;
        let timer = null;
        // Сессия вкладки: цепочка resolveSid (props → openChip → строки панели).
        const sid = sidKey;
        const connect = () => {
            if (disposed)
                return;
            try {
                wsRef.current?.close();
            }
            catch { /* ignore */ }
            let ws;
            try {
                ws = new WebSocket('ws://127.0.0.1:3099');
            }
            catch {
                timer = setTimeout(connect, 2500);
                return;
            }
            wsRef.current = ws;
            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'hello', role: 'sidebar', ...(sid ? { sessionId: sid } : {}) }));
                try {
                    ws.send(JSON.stringify({ type: 'hover-ms', ms: hoverMsRef.current }));
                }
                catch { /* ignore */ }
            };
            ws.onmessage = (ev) => {
                let msg;
                try {
                    msg = JSON.parse(ev.data);
                }
                catch {
                    return;
                }
                if (!msg || typeof msg !== 'object')
                    return;
                switch (msg.type) {
                    case 'status':
                        if (msg.running && msg.port) {
                            setRunning({ port: Number(msg.port), dir: String(msg.dir ?? '') });
                            // Список файлов ведёт хост — клиент только отображает.
                            if (Array.isArray(msg.files))
                                setFiles(msg.files.map((x) => String(x)));
                            if (typeof msg.file === 'string' && msg.file)
                                setFile(msg.file);
                        }
                        else {
                            setRunning(null);
                        }
                        break;
                    case 'stopped':
                        setRunning(null);
                        break;
                    case 'started-error':
                        setScanning(false);
                        setNote(String(msg.error ?? tRef.current('insertFailed')));
                        break;
                    case 'console-error': {
                        const entry = {
                            id: Date.now() + Math.random(),
                            level: String(msg.level ?? 'error'),
                            message: String(msg.message ?? ''),
                            source: msg.source ? `${msg.source}` : undefined,
                            line: typeof msg.line === 'number' ? msg.line : undefined,
                        };
                        setErrors((prev) => [entry, ...prev].slice(0, 100));
                        break;
                    }
                    case 'inspector-prompt': {
                        const text = buildInspectorText(String(msg.comment ?? ''), String(msg.html ?? ''), (msg.styles && typeof msg.styles === 'object') ? msg.styles : {});
                        const ok = insertIntoChat(props.__ctx, props, text);
                        setNote(ok ? tRef.current('inspectorSent') : tRef.current('insertFailed'));
                        break;
                    }
                    default:
                        break;
                }
            };
            ws.onclose = () => {
                if (!disposed)
                    timer = setTimeout(connect, 2500);
            };
            ws.onerror = () => {
                try {
                    ws.close();
                }
                catch { /* ignore */ }
            };
        };
        connect();
        return () => {
            disposed = true;
            clearTimeout(timer);
            try {
                wsRef.current?.close();
            }
            catch { /* ignore */ }
        };
    }, [sidKey, props.__ctx]);
    // --- выбор папки проекта ---------------------------------------------
    const applyDir = React.useCallback((raw) => {
        const clean = raw.trim().replace(/\\/g, '/');
        if (!clean)
            return;
        setNote(null);
        setDir(clean);
        setFiles([]);
        setScanning(true);
        // Сканирование HTML ведёт хост; список придёт в статусе запуска.
        try {
            wsRef.current?.send(JSON.stringify({ type: 'start', dir: toPosix(clean), file: '' }));
        }
        catch { /* ignore */ }
    }, []);
    const pickAndScan = React.useCallback(() => {
        const ctx = props.__ctx;
        let uiWs = null;
        try {
            uiWs = (ctx && (ctx.uiWorkspace ?? (typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined))) || null;
        }
        catch { /* ignore */ }
        if (!uiWs) {
            console.warn('[prirexstudio] Сервис uiWorkspace недоступен. Ключи ctx:', Object.keys(ctx ?? {}));
            setNote(tRef.current('pickUnavailable'));
            return;
        }
        void (async () => {
            let chosen = null;
            try {
                chosen = await uiWs.pickDirectory();
            }
            catch (err) {
                console.warn('[prirexstudio] pickDirectory не открыл диалог:', err);
            }
            if (!chosen || typeof chosen !== 'string') {
                setNote(tRef.current('pickUnavailable'));
                return;
            }
            applyDir(chosen);
        })();
    }, [props.__ctx, applyDir]);
    // --- запуск / остановка сервера через WS-хаб ---
    const startServer = React.useCallback((f) => {
        setFile(f);
        try {
            wsRef.current?.send(JSON.stringify({ type: 'start', dir: toPosix(dir ?? ''), file: f }));
        }
        catch { /* ignore */ }
    }, [dir]);
    const stopServer = React.useCallback(() => {
        try {
            wsRef.current?.send(JSON.stringify({ type: 'stop' }));
        }
        catch { /* ignore */ }
        setRunning(null);
    }, []);
    // Перезапуск сервера: хаб сам остановит предыдущий прогон.
    const restartServer = React.useCallback(() => {
        try {
            wsRef.current?.send(JSON.stringify({ type: 'start', dir: toPosix(dir ?? ''), file }));
        }
        catch { /* ignore */ }
    }, [dir, file]);
    // Выход из проекта: останавливаем сервер и сбрасываем всё к экрану выбора папки.
    const exitProject = React.useCallback(() => {
        try {
            wsRef.current?.send(JSON.stringify({ type: 'stop' }));
        }
        catch { /* ignore */ }
        setRunning(null);
        setDir(null);
        setFiles([]);
        setFile(null);
        setErrors([]);
        setScanning(false);
        setNote(null);
    }, []);
    // --- копирование ошибки для ИИ ---
    const [copiedId, setCopiedId] = React.useState(null);
    const copyError = (entry) => {
        void copyText(`${entry.level}: ${entry.message}${entry.source ? ` (${entry.source})` : ''}`)
            .then(() => { setCopiedId(entry.id); setTimeout(() => setCopiedId(null), 1500); });
    };
    // --- рендер -----------------------------------------------------------
    const el = React.createElement;
    // Название бренда: красная R в PriRex.
    const brandName = () => el('span', null, 'Pri', el('span', { style: { color: BRAND_RED } }, 'R'), 'ex Preview');
    if (!running && !dir) {
        ensureAnimStyles();
        return el('div', { style: S.root }, 
        // шапка бренда — общая для обоих экранов; справа версия, язык и настройки
        el('div', { style: S.header }, el(CrosshairIcon, { size: 16 }), brandName(), el('span', { style: S.hdrStatus }, el('span', { style: S.statusDot(false) }), t('serverOff')), el('span', { style: { marginLeft: 'auto', fontSize: 10.5, opacity: .55 } }, `v${VERSION}`), el('button', { style: S.langBtn, onClick: toggleLang }, locale === 'ru' ? 'EN' : locale === 'en' ? '中文' : 'RU'), el('button', { style: S.langBtn, title: t('settings'), onClick: () => setSettingsOpen(!settingsOpen) }, settingsOpen ? '✕' : '⚙')), 
        // настройки (под шапкой): задержка ховера
        settingsOpen && el('div', { style: S.card }, el('div', { style: S.sectionTitle }, t('hoverTimeout')), el('div', { style: S.row }, [[1500], [3000], [5000]].map(([ms]) => el('button', { key: ms, style: hoverMs === ms ? S.buttonActive : S.button, onClick: () => changeHoverMs(ms) }, `${ms / 1000}${t('hoverSec')}`)))), 
        // фоновая анимация: «сайт собирается и редактируется»
        el('div', { className: 'prx-stage' }, el('div', { className: 'prx-scene' }, el('div', { className: 'prx-browser' }, el('div', { className: 'prx-bar' }, el('span', { className: 'prx-dot' }), el('span', { className: 'prx-dot' }), el('span', { className: 'prx-dot' })), el('div', { className: 'prx-body' }, el('div', { className: 'prx-hero', style: { animationDelay: '.55s' } }), el('div', { className: 'prx-row w80', style: { width: '82%', animationDelay: '.3s' } }), el('div', { className: 'prx-row', style: { width: '64%', animationDelay: '.45s' } })), el('span', { className: 'prx-cursor' }), el('span', { className: 'prx-ring' }), el('span', { className: 'prx-pill' }, t('d2hint'))))), 
        // запуск проекта: путь + папка в одну строку, ниже — большая кнопка запуска
        el('div', { style: S.launchCard }, el('div', { style: S.row }, el('input', {
            ref: manualRef,
            placeholder: t('pathPlaceholder'),
            onKeyDown: (e) => {
                if (e.key === 'Enter')
                    applyDir(manualRef.current?.value ?? '');
            },
            style: S.pathInput,
        }), el('button', { style: S.button, onClick: pickAndScan }, t('pickDirShort'))), el('button', { style: S.bigButton, onClick: () => applyDir(manualRef.current?.value ?? '') }, t('launchBtn')), note && el('div', { style: { ...S.note, color: 'var(--dsw-alias-state-warn)' } }, note)), 
        // подсказка о возможностях (onboarding)
        el('div', { style: S.descCard }, el('div', { style: S.descIntro }, t('descIntro')), ['f1', 'f2', 'f3', 'f4'].map((k, i) => el('div', { key: k, style: { marginBottom: i === 3 ? 0 : 11 } }, el('div', { style: S.featTitle }, t(`${k}t`)), el('div', { style: S.featText }, t(`${k}d`)))), 
        // примечание о версии (аккуратная мелкая строка над подвалом)
        el('div', { style: S.versionNote }, t('versionNote')), 
        // подвал строго по центру внизу: разработано + логотип + GitHub
        el('div', { style: S.footerLine }, t('devBy'), el('a', { href: 'https://github.com/Prirex', target: '_blank', rel: 'noreferrer' }, el('img', { src: LOGO_DATA_URI, alt: 'PriRex', style: S.logoImg })), el('span', { style: { opacity: .45 } }, '|'), el('a', { href: 'https://github.com/Prirex', target: '_blank', rel: 'noreferrer', style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', textDecoration: 'none' } }, 'github.com/Prirex'))));
    }
    const url = running ? `http://127.0.0.1:${running.port}/${file ?? ''}` : null;
    return el('div', { style: S.root }, 
    // шапка бренда со статусом сервера и выходом из проекта
    el('div', { style: S.header }, el(CrosshairIcon, { size: 16 }), brandName(), el('span', { style: S.hdrStatus }, el('span', { style: S.statusDot(Boolean(running)) }), t(running ? 'serverOn' : 'serverOff')), el('span', { style: { marginLeft: dir ? 8 : 'auto', fontSize: 10.5, opacity: .55 } }, `v${VERSION}`), el('button', { style: S.langBtn, onClick: toggleLang }, locale === 'ru' ? 'EN' : locale === 'en' ? '中文' : 'RU'), dir && el('button', { style: S.buttonDanger, onClick: exitProject }, t('exitProject'))), 
    // панель устройств — три кнопки ровно по спецификации
    el('div', { style: S.row }, el('button', { style: device === 1920 ? S.buttonActive : S.button, onClick: () => setDevice(1920) }, t('deviceDesktop')), el('button', { style: device === 768 ? S.buttonActive : S.button, onClick: () => setDevice(768) }, t('deviceTablet')), el('button', { style: device === 375 ? S.buttonActive : S.button, onClick: () => setDevice(375) }, t('deviceMobile')), url && el('button', { style: { ...S.button, marginLeft: 'auto' }, onClick: () => { try {
            window.open(url, '_blank');
        }
        catch { /* ignore */ } } }, t('openBrowser'))), 
    // WebView-контейнер: сайт всегда вписывается в ширину боковой панели
    url && el('div', { style: S.iframeBox }, el('div', { style: { width: device, maxWidth: '100%', margin: '0 auto', height: '100%' } }, el('iframe', { key: url, src: url, style: { ...S.iframe }, title: 'PriRex Preview' }))), 
    // список файлов (пока сервер не запущен или для смены файла)
    !url && el('div', { style: S.card }, el('div', { style: S.sectionTitle }, t('filesHeader')), el('div', { style: S.listWrap }, scanning && el('div', { style: S.note }, t('loadingFiles')), !scanning && files.length === 0 && dir && el('div', { style: S.note }, t('noFiles')), ...files.slice(0, 200).map((f) => el('button', { key: f, style: S.fileItem(f === file), onClick: () => startServer(f) }, f)))), 
    // журнал ошибок консоли
    el('div', { style: S.card }, el('div', { style: S.sectionTitle }, t('errorsHeader')), el('div', { style: S.logWrap }, errors.length === 0
        ? el('div', { style: S.note }, t('noErrors'))
        : errors.map((e) => el('div', { key: e.id, style: S.logItem }, el('span', null, `${e.level}${e.source ? ` — ${e.source}` : ''}${typeof e.line === 'number' ? `:${e.line}` : ''}: ${e.message}`), el('button', { style: { alignSelf: 'flex-start', ...S.button, fontSize: 11 }, onClick: () => copyError(e) }, copiedId === e.id ? t('copied') : t('copyForAi')))))), 
    // служебная строка заметок + стоп сервера
    el('div', { style: S.row }, running && el('button', { style: S.button, onClick: restartServer }, t('restartServer')), running && el('button', { style: S.button, onClick: stopServer }, t('stopServer')), note && el('span', { style: { ...S.note, color: 'var(--dsw-alias-state-warn)' } }, note)));
}
// ---------------------------------------------------------------------------
// Регистрация вкладки (паттерн templates/decoration/client.js: ctx.slots.inject
// + ctx.slots.register; keyed-слоты под нашим ключом TAB_ID)
// ---------------------------------------------------------------------------
function currentTitle(ctx) {
    try {
        const locSvc = ctx.locale ?? null;
        if (locSvc && typeof locSvc.getCurrent === 'function' && String(locSvc.getCurrent()) === 'en')
            return makeT('en')('title');
    }
    catch { /* ru */ }
    return makeT('ru')('title');
}
/** Безопасный вызов диспозера (паттерн disposeSafely из dsh-better-sidebar). */
function disposeSafely(dispose, what) {
    try {
        if (typeof dispose === 'function')
            dispose();
    }
    catch (err) {
        console.error(`[prirexstudio] ${what} release failed:`, err);
    }
}
/**
 * Автооткрытие чипа в правой панели — поток из dsh-better-sidebar
 * (lib/client.js:18357–18366): openTab → найти строку в openTabs → focus,
 * при свёрнутой панели — toggleExpanded. Всё под защитой: без сервиса
 * sidebarRight просто возвращаемся (чип останется доступным через guide).
 */
/** id сессии, к которой привязана вкладка — для автооткрытия папки проекта хостом. */
let currentSessionId = null;
/** Разовая диагностика свойств слота (есть ли у вкладки собственный sessionId). */
let tabPropsLogged = false;
/**
 * Сервисы, разрешённые один раз через доказанный DI-путь ctx.inject(...)
 * (тот же, что и tabs.register) — надёжнее прямых свойств ctx, которые на
 * разных версиях хоста могут не появиться.
 */
const diRefs = {};
/**
 * Единая цепочка разрешения id сессии для вставки текста в чат:
 * props (slot-контекст) → сохранённый из openChip/строк панели → строка нашей
 * вкладки в right.openTabs. Возвращает undefined, если сессию не найти.
 */
function resolveSid(props) {
    const p = props ?? {};
    if (typeof p.sessionId === 'string' && p.sessionId)
        return p.sessionId;
    for (const k of ['hookContext', 'slotProps', 'context']) {
        const v = p[k]?.sessionId;
        if (typeof v === 'string' && v)
            return v;
    }
    if (currentSessionId)
        return currentSessionId;
    try {
        const right = diRefs.sidebarRight ?? (typeof p.__ctx?.get === 'function' ? p.__ctx.get('sidebarRight') : undefined);
        const snap = Array.isArray(right?.openTabs?.getSnapshot?.()) ? right.openTabs.getSnapshot() : [];
        for (const row of snap) {
            if (!row || (row.kind !== TAB_ID && row.id !== TAB_ID))
                continue;
            const sid = typeof row.sessionId === 'string' ? row.sessionId : (typeof row.session?.id === 'string' ? row.session.id : '');
            if (sid) {
                currentSessionId = sid;
                return sid;
            }
        }
    }
    catch { /* нет right.openTabs — цепочка исчерпана */ }
    return undefined;
}
function openChip(ctx) {
    try {
        const right = typeof ctx.get === 'function' ? ctx.get('sidebarRight') : undefined;
        if (!right || typeof right.openTab !== 'function')
            return;
        const snapshot = () => {
            const s = right?.openTabs?.getSnapshot?.();
            return Array.isArray(s) ? s : [];
        };
        let row = snapshot().find((r) => r && r.kind === TAB_ID);
        if (!row) {
            right.openTab(TAB_ID);
            row = snapshot().find((r) => r && r.kind === TAB_ID);
        }
        // Вкладки сессионные — запоминаем id, чтобы хост сам открыл папку проекта.
        const sid = typeof row?.sessionId === 'string' ? row.sessionId : (typeof row?.session?.id === 'string' ? row.session.id : '');
        if (sid)
            currentSessionId = sid;
        console.log('[prirexstudio] openChip: tabId=', row?.tabId ?? null, 'sessionId=', currentSessionId, 'row keys=', Object.keys(row ?? {}));
        if (row?.tabId && typeof right.focus === 'function')
            right.focus(row.tabId);
        if (typeof right.isExpanded === 'function' && !right.isExpanded() && typeof right.toggleExpanded === 'function') {
            right.toggleExpanded();
        }
    }
    catch (err) {
        console.error('[prirexstudio] Не удалось открыть вкладку:', err);
    }
}
function factory(requireFn) {
    // require подменяется на браузерную таблицу модулей хоста; React берём оттуда.
    REACT_OVERRIDE = typeof requireFn === 'function' ? requireFn('react') : null;
    return {
        inject: ['slots', 'uiWorkspace', 'sessions', 'conversation'],
        apply(ctx) {
            const slots = ctx?.slots;
            if (!slots || typeof slots.inject !== 'function') {
                console.error('[prirexstudio] ctx.slots недоступен — вкладка не зарегистрирована', Object.keys(ctx ?? {}));
                return;
            }
            // Тело вкладки — keyed-слот sidebar.right.pane.tab под нашим ключом.
            const registerBody = () => slots.inject('sidebar.right.pane.tab', () => slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, (p) => TabBody({ ...p, __ctx: ctx })));
            // Название чипа — keyed-слот sidebar.right.pane.tab.title с тем же ключом.
            const registerTitle = () => slots.inject('sidebar.right.pane.tab.title', () => slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID }, () => currentTitle(ctx)));
            // Старый хост без DI-сидов — деградация до прежней регистрации слотов.
            if (typeof ctx.inject !== 'function') {
                try {
                    registerBody();
                }
                catch (err) {
                    console.error('[prirexstudio] Не удалось зарегистрировать тело вкладки:', err);
                }
                try {
                    registerTitle();
                }
                catch (err) {
                    console.error('[prirexstudio] Не удалось зарегистрировать название вкладки:', err);
                }
                return;
            }
            // Паттерн dsh-better-sidebar (lib/client.js:30120+): сначала ТИП вкладки
            // через tabs.register, затем слоты тела/названия; диспозеры собираются и
            // возвращаются одним эффектом — хост снимет всё при деактивации.
            ctx.inject(['sidebarRightTabs', 'sidebarRight', 'uiWorkspace', 'sessions', 'conversation'], (injected) => {
                // Запоминаем DI-ссылки для цепочки resolveSid / insertIntoChat —
                // надёжнее прямых свойств ctx, которые хост может не наполнить.
                try {
                    diRefs.sessions = injected?.get?.('sessions') ?? undefined;
                }
                catch { /* ignore */ }
                try {
                    diRefs.conversation = injected?.get?.('conversation') ?? undefined;
                }
                catch { /* ignore */ }
                try {
                    diRefs.sidebarRight = injected?.get?.('sidebarRight') ?? undefined;
                }
                catch { /* ignore */ }
                const tabs = injected?.get?.('sidebarRightTabs');
                if (!tabs || typeof tabs.register !== 'function') {
                    console.error('[prirexstudio] сервис sidebarRightTabs недоступен — тип вкладки не зарегистрирован', Object.keys(injected ?? {}));
                    return undefined;
                }
                let disposeType;
                try {
                    disposeType = tabs.register({
                        id: TAB_ID,
                        kind: TAB_ID,
                        keepMounted: true,
                        priority: 'extension',
                        title: () => currentTitle(ctx),
                        guide: [{ id: TAB_ID, order: 100, title: () => currentTitle(ctx) }],
                    });
                }
                catch (err) {
                    console.error('[prirexstudio] tabs.register не удался:', err);
                    return undefined;
                }
                const disposers = [];
                try {
                    disposers.push(registerBody());
                    disposers.push(registerTitle());
                }
                catch (err) {
                    for (const d of disposers)
                        disposeSafely(d, 'slot');
                    disposeSafely(disposeType, 'tab type');
                    console.error('[prirexstudio] Не удалось зарегистрировать слоты вкладки:', err);
                    return undefined;
                }
                openChip(ctx);
                // Один эффект: сначала слоты (в обратном порядке), затем тип вкладки.
                return () => {
                    for (const d of [...disposers].reverse())
                        disposeSafely(d, 'slot');
                    disposeSafely(disposeType, 'tab type');
                };
            });
        },
    };
}
// ---------------------------------------------------------------------------
// Точка входа артефакта: регистрация фабрики в таблице модулей хоста.
// id обязан совпадать с именем пакета (dsh-prirex-preview из package.json).
// ---------------------------------------------------------------------------
const loader = window.__ModuleLoader__;
if (loader && typeof loader.load === 'function') {
    loader.load({
        id: 'dsh-prirex-preview',
        factory,
    });
}
else {
    console.error('[prirexstudio] window.__ModuleLoader__ не найден — клиент не зарегистрирован');
}
