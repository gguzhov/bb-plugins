# Архитектура

Плагин bb из двух частей: сервер (`server.ts`, работает внутри bb-сервера) и
интерфейс (`app.tsx`, собирается в `dist/app.js` и грузится в окно bb).

```mermaid
flowchart LR
  subgraph Server["Сервер плагина (server.ts)"]
    Bundled["bundled.ts<br/>assets/icons/icons.json<br/>+ файлы и кадры"]
    Pack["pack.ts<br/>личный набор вне плагина<br/>(packDir, по умолчанию<br/>~/.bb/plugins_bb/project-icons-pack)"]
    DB[("SQLite плагина<br/>custom_icons<br/>project_icons (+auto)<br/>seen_projects<br/>icon_meta")]
    RPC["RPC: state, setIcon,<br/>addIcon, removeIcon"]
    HTTP["HTTP GET /icon?id=&frame=<br/>только id из библиотеки"]
    CLI["CLI bb genidev-project-icons<br/>list, icons, set, add, remove,<br/>reload-pack"]
    Import["import-file.ts<br/>sips → 96×96, cwebp → WebP"]
    Setting["Настройки Icon animation, Give new projects an icon,<br/>Personal icon pack folder (bb.settings)"]
    RT["realtime: changed"]
  end
  subgraph App["Интерфейс (app.tsx)"]
    Overlay["Оверлей icons<br/>useRpc, useRealtime,<br/>useSettings"]
    Threads["experimental_useSidebarThreads<br/>треды боковой панели"]
    State["project-state.ts<br/>idle / done / working / waiting / error<br/>+ отладочный ключ localStorage"]
    Store["store.ts<br/>menuTarget, sidebarIcons"]
    MenuWatch["menu-watch.ts<br/>контент-скрипт project-menus"]
    Picker["icon-menu.tsx + picker.tsx<br/>пункт Icon и окно выбора"]
    Deco["decoration.ts<br/>контент-скрипт sidebar-icons"]
  end
  Bundled --> RPC
  Pack --> Bundled
  Pack --> RPC
  DB --> RPC
  Import --> DB
  CLI --> Import
  CLI --> DB
  RPC --> RT
  RT --> Overlay
  RPC --> Overlay
  Setting --> Overlay
  Threads --> State --> Overlay
  Overlay --> Store
  MenuWatch --> Store
  Store --> Picker
  Store --> Deco
  Picker -- "<img src>" --> HTTP
  Deco -- "<img src> кадров" --> HTTP
  HTTP --> Bundled
  HTTP --> Pack
  HTTP --> DB
```

## Части

- **Хранилище.** SQLite плагина (`bb.storage.database()`): `custom_icons`
  (свои картинки: id `custom-…`, название, MIME, байты, хеш) и `project_icons`
  (проект → иконка, `assigned_at` — момент назначения, 0 у старых). Вшитые иконки и кадры не в базе: читаются из
  `assets/icons` при загрузке плагина. Личный набор тоже не в базе: папка вне плагина
  (настройка `packDir`), читается тем же `loadIconFolder` с проверкой, что настоящий путь
  файла внутри папки; порядок в библиотеке: вшитые, личный набор (`kind: pack`), свои.
  Перечитывается при загрузке, смене настройки и по `reload-pack`. Закрытые иконки
  живут только там; тест `pack.test.ts` следит, чтобы в `assets/icons` их не было.
- **HTTP.** `GET /api/v1/plugins/genidev-project-icons/http/icon?id=<id>[&frame=left|right|puzzled|alert|happy]&v=<хеш>`,
  `auth: local`. Отдаёт только id из библиотеки и только известные имена кадров
  (чужое имя кадра — 400, нет такой иконки или кадра — 404). Тип берётся из
  первых байтов файла, `nosniff`, кеш на год (хеш в адресе меняется вместе с файлом).
- **RPC.** `state` (проекты, библиотека с адресами кадров), `setIcon`,
  `addIcon` (base64 картинки, проверка по байтам), `removeIcon`. После изменения
  сервер шлёт realtime `changed`, все окна перечитывают `state`.
- **Вставка в меню.** У bb нет слота для пунктов меню проекта. `menu-watch.ts`
  находит меню (Radix-меню или нижний лист на телефоне) и держит в нём элемент,
  оверлей рисует туда пункт «Icon» через портал.
- **Пометка строк проекта.** `decoration.ts` ставит `<span class="pi-project-icon pi-stack">`
  перед названием каждого проекта с иконкой. Внутри — стопка `<img>` кадров и
  атрибут `data-pi-anim`; движение задаёт только CSS. Наблюдатель DOM
  (`scoped-observer.ts`) не смотрит в ленту чата.

## Откуда берётся состояние проекта

Из `experimental_useSidebarThreads()` — того же живого списка тредов, что
рисует боковая панель bb. Он обновляется по realtime-подпискам самого bb,
плагин не делает своих запросов и не опрашивает сервер. Правило в
`project-state.ts`:

- первое подходящее, сверху вниз:
  1. «ошибка» — у треда `status === "error"` и `isUnread`, либо `indicator === "unread-error"`;
  2. «ждёт владельца» — `hasPendingInteraction` (агент ждёт разрешения или ответа
     на вопрос) или `indicator === "waiting-for-input"`;
  3. «работает» — `status` равен `starting`, `active` или `stopping`;
  4. «готово, не просмотрено» — `indicator === "unread-success"`;
  5. иначе покой;
- в проекте с несколькими тредами показывается старшее состояние; скрытые
  (`isHidden`) и архивные треды не считаются.

Почему «ошибка» читается из двух полей: на живых данных (24.11.2026) у тредов со
`status: "error"` и `isUnread: true` bb оставлял `indicator: "none"`, а
`unread-error` ни разу не встретился. «Готово» живыми данными подтверждено:
`indicator: "unread-success"`, `isUnread: true`, `status: "idle"`.

На сервере те же поля есть у `bb.sdk.threads` (`status`, `hasPendingInteraction`),
но поля `indicator` там нет, а интерфейсу и так нужен живой список, поэтому
состояние считается только на клиенте.

## Технологии

TypeScript, React 19 из `@get-bb/plugin-sdk/app`, `@get-bb/plugin-sdk` 0.6.157,
zod 4, SQLite через хранилище плагина. Внешние программы для `add`: `/usr/bin/sips`
(macOS) и `cwebp` (Homebrew, необязательно). Docker-образов нет.

## Выпуск

- Репозиторий: локальная папка `~/.bb/plugins_bb/bb-plugin-genidev-project-icons`,
  ветка `main`. CI нет.
- Сборка и проверка: `npx tsc --noEmit`, `npm test`, `bb plugin build`.
- Обновление в bb: плагин установлен из этой папки (`source: path:`), новая
  сборка подхватывается командой `bb plugin reload genidev-project-icons`.
