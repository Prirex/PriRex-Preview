// finalize-client.mjs — превращает lib/client.cjs (emit tsc, CJS) в браузерный
// классический скрипт lib/client.js для DSH web boot.
//
// Почему: DSH выполняет клиентские записи плагинов как классические скрипты
// (не ES-модули и не CJS): ни `export`, ни `exports`/`module` в рантайме нет.
// tsc при emit из .cts всегда добавляет `"use strict"` и
// `Object.defineProperty(exports, "__esModule", ...)` — без `exports` это
// ReferenceError. Поэтому: 1) убираем CJS-маркеры, 2) оборачиваем всё в IIFE,
// чтобы топ-уровневые const/function не попадали в глобальную область видимости
// страницы (в combined bundle грузятся записи нескольких плагинов).
//
// Запуск после tsc:  node scripts/finalize-client.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url))); // <plugin>/ (scripts/..)
const cjsPath = join(root, 'lib', 'client.cjs');
const outPath = join(root, 'lib', 'client.js');

// tsc добавляет UTF-8 BOM в начало emit-файлов — для браузера уберём.
// Заодно срезаем хвостовые пробелы, которые tsc иногда оставляет в emit.
const raw = readFileSync(cjsPath, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/).map((line) => line.replace(/[ \t]+$/, ''));

const kept = [];
let droppedStrict = false;
let droppedMarker = false;
for (const line of lines) {
    if (!droppedStrict && line === '"use strict";') {
        droppedStrict = true; // уберём ровно первый маркер tsc, добавим свой внутри IIFE
        continue;
    }
    if (/^Object\.defineProperty\(exports,\s*"__esModule"/.test(line)) {
        droppedMarker = true;
        continue;
    }
    kept.push(line);
}

if (!droppedStrict || !droppedMarker) {
    console.error('ОШИБКА: неожиданный формат lib/client.cjs (не найден "use strict" или маркер __esModule).');
    console.error('Формат emit tsc мог измениться — проверьте скрипт.');
    process.exit(1);
}

// Убираем возможный пустой хвост, сохранив содержимое.
while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();

const body = kept.join('\n');
if (!body.includes('window.__ModuleLoader__')) {
    console.error('ОШИБКА: в lib/client.cjs не найдена регистрация window.__ModuleLoader__.');
    process.exit(1);
}

// Коммитим и CJS-промежуток, поэтому чистим его от хвостовых пробелов тоже,
// сохраняя маркеры tsc — скрипт остаётся повторно запускаемым без пересборки.
writeFileSync(cjsPath, lines.join('\n'), 'utf8');

const out = '(function () {\n\'use strict\';\n' + body + '\n})();\n';
writeFileSync(outPath, out, 'utf8');
console.log('OK: ' + outPath + ' (' + out.split('\n').length + ' строк)');
