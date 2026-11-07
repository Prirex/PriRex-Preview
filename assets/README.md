# Screenshots / Скриншоты

All images here are real captures of PriRex Preview inside DeepSeek Harness.
Все изображения — реальные кадры PriRex Preview в DeepSeek Harness.

The section reads as one loop: **before → inspector → chat draft → result**.
Раздел читается как один цикл: **до → инспектор → черновик чата → результат**.

| File / Файл           | Role in the story / Роль в сюжете                          | Content / Содержимое                                                |
| --------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `preview.png`         | hero, "before" / «до»                                      | Open tab: server running, device buttons, page, inspector panel      |
| `device-buttons.png`  | device frames / панель устройств                           | `Desktop (1920px)` / `Tablet (768px)` / `Mobile (375px)` + `In browser` |
| `inspector.png`       | inspector close-up / крупный план инспектора                | Frozen `<span>` with the «Что изменить?» panel                       |
| `chat-insertion.png`  | inspector → draft / из инспектора в чат                     | Chat draft with injected HTML + computed styles beside the live tab  |
| `result.png`          | "after" / «после»                                          | The requested edit applied: the `R` is red and large                 |
| `console-feed.png`    | optional / опционально                                      | Console error journal with a captured error (not captured yet)       |

Notes / Заметки:

- **Screenshots were captured on the v1.0.0 UI** — the version chip reads `v1.0.0` and the start
  screen still had a path field and a static/Node switch. Re-shoot `preview.png` for a v2.0.0
  release announcement (the start screen now has a single **Launch project** button).
  / **Скриншоты сняты на интерфейсе v1.0.0** — плашка версии показывает `v1.0.0`, а на стартовом
  экране ещё были поле пути и переключатель «статика/Node». Для анонса v2.0.0 переснимите
  `preview.png` (на стартовом экране теперь одна кнопка **Запустить проект**).

- `chat-insertion.png` documents the core loop: inspector payload → draft → you press send
  (auto-submit is always off). / Ключевой цикл: payload инспектора → черновик → отправляете вы.
- `result.png` must stay consistent with `preview.png`: same page, same request, "after" state.
  / `result.png` должен соответствовать `preview.png`: та же страница, тот же запрос, состояние «после».
- Keep screenshots free of personal paths, API keys and unrelated chat content. /
  Без личных путей, ключей и посторонней переписки.
- Replace a file in place to refresh the README — filenames are referenced directly. /
  Обновляйте картинки под теми же именами — README ссылается на них напрямую.
