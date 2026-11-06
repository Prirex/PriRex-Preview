// smoke-client.mjs — проверка клиентского артефакта как браузерного классического скрипта.
// Выполняет файл в чистом vm-контексте БЕЗ exports/module/require (условия браузера),
// с заглушкой window.__ModuleLoader__. Успех = скрипт отработал до конца и
// зарегистрировал модуль. Использование: node scripts/smoke-client.mjs <path-to-client.js>
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

if (!process.argv[2]) { console.error('usage: node scripts/smoke-client.mjs <path-to-client.js>'); process.exit(2); }
const src = readFileSync(process.argv[2], 'utf8');

let registered = null;
const sandbox = { console };
sandbox.window = sandbox; // как в браузере: window === глобальная область видимости
sandbox.__ModuleLoader__ = { load: function (m) { registered = m.id; } };
vm.createContext(sandbox);
try {
  vm.runInContext(src, sandbox, { filename: 'client.js' });
} catch (e) {
  console.error('SMOKE FAIL:', e && e.constructor ? e.constructor.name : '?', '-', e && e.message);
  process.exit(1);
}
if (!registered) { console.error('SMOKE FAIL: модуль не зарегистрировался в __ModuleLoader__'); process.exit(1); }
console.log('SMOKE OK — классический скрипт выполняется чисто; зарегистрирован id =', JSON.stringify(registered));
