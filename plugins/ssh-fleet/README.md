# bb-plugin-ssh-fleet

Инвентарь удалённых серверов. Пункт «Серверы» в боковой панели показывает последний снимок CPU, памяти и диска. Вход на сервер — `root` по пути к уже существующему ключу. Приватный ключ плагин не копирует и не читает: хранится только путь к нему.

- `bb ssh-fleet list [--group <группа>]` — последний снимок, группа, хостинг, стоимость и первая строка описания; с `--group` только одна группа
- `bb ssh-fleet add --name <имя> --host <хост> --key <абсолютный путь к ключу> [--port 22] [--description <текст>] [--hosting <хостер>] [--cost <₽/мес>] [--group <группа>]` — добавить сервер (группа по умолчанию `personal`)
- `bb ssh-fleet set --id <id> [--name] [--description] [--hosting] [--cost] [--group]` — изменить только переданные поля, снимок не сбрасывается
- `bb ssh-fleet group list` — группы и число серверов в каждой
- `bb ssh-fleet group add --label <название> [--id <id>]` — добавить группу (id по умолчанию из названия)
- `bb ssh-fleet group set --id <id> [--label <название>] [--position <n>]` — переименовать группу или поменять её место в списке
- `bb ssh-fleet group remove --id <id> [--yes]` — удалить группу; её серверы переходят в группу по умолчанию (если они есть, нужен `--yes`)
- `bb ssh-fleet add --name <имя> --host <хост> --password-stdin [--host-key SHA256:…] [--ssh-config] [...]` — добавить сервер по паролю root один раз (см. ниже)
- `bb ssh-fleet agent-prompt` — текст для агента, который сам найдёт серверы и добавит их
- `bb ssh-fleet check --all` или `bb ssh-fleet check --id <id>` — снять заново

Про каждый сервер хранятся группа, описание (до 500 символов), хостинг (до 80) и стоимость в ₽ в месяц.

Группы — это данные, а не код: пользователь сам добавляет и удаляет их. После установки есть одна группа `personal` («Personal»), её нельзя удалить. `<группа>` в командах — id или название группы без учёта регистра. Неизвестная группа в `add`, `set` или `list --group` даёт ошибку `invalid` со списком существующих групп. В форме сервера в выпадающем списке «Группа» есть пункты «Новая группа…» (поле для названия) и «Удалить группу «…»…» для выбранной группы; если в ней есть серверы, панель просит подтвердить и переносит их в группу по умолчанию. Над списком переключатель «Все» и по вкладке на каждую группу с числом серверов; выбор запоминается. Под ним итог по выбранной группе: сумма в месяц, в час (месячная / 720) и сколько серверов без цены. У каждого сервера цена показана как «4 858 ₽/мес · 6,75 ₽/час». Добавлять серверы можно в панели или командой `add`, импортировать из ssh config только в панели. Удаление серверов только в панели. Проверки идут, пока BB запущен.

При обновлении с 0.1.x каждая группа, которая уже встречается у серверов, становится строкой в списке групп с названием, равным её id; серверы и их группы не меняются. Названия можно поправить командой `group set`.

## Пароль root, один раз

В форме «Новый сервер» можно выбрать «У меня есть пароль root» вместо пути к ключу. Порядок:

1. `hostKeyScan`: `ssh-keyscan` берёт ключ хоста, панель показывает отпечаток SHA256. Пароль в этот момент никуда не уходит.
2. Пользователь подтверждает отпечаток. `createWithPassword` создаёт в `~/.ssh` пару ed25519 `ssh-fleet-<имя>` (600, существующий файл не перезаписывается), один раз входит root по паролю и дописывает публичный ключ в `/root/.ssh/authorized_keys` (`.ssh` 700 и файл 600 создаются, если их нет; повтор строки не добавляется).
3. Проверяется вход по новому ключу, подтверждённый ключ хоста дописывается в `~/.ssh/known_hosts`, сохраняется только путь к ключу и сразу идёт первая проверка. По галочке (по умолчанию выключена) в `~/.ssh/config` дописывается блок `Host`.

Пароль идёт из поля формы по RPC плагина в серверный процесс и оттуда в `ssh` только через помощник `SSH_ASKPASS` с `SSH_ASKPASS_REQUIRE=force`; значение лежит в окружении одного процесса `ssh`. В argv, файлы, базу, настройки, логи и ответы RPC он не попадает, stderr ssh очищается от него до разбора. Поле формы не связано с состоянием React и очищается после ответа. Ключ хоста проверяется строго (`StrictHostKeyChecking=yes` по подтверждённому ключу), без `StrictHostKeyChecking=no`. Нужен OpenSSH 8.4 или новее; на старом ssh плагин отказывает и пароль не отправляет. Ошибки различаются: неверный пароль, вход по паролю выключен, сервер недоступен, ключ хоста не совпал. При любой ошибке сервер не создаётся, новый ключ удаляется, а если ключ успел записаться на сервер, но вход по нему не прошёл, плагин убирает его из `authorized_keys`.

В CLI пароль читается только из stdin: `--password-stdin`. Первый запуск печатает отпечаток и завершается с кодом `confirm_host_key`, второй с `--host-key <отпечаток>` ставит ключ. Ограничение: bb CLI превращает `--password-stdin` в скрытый `--password <значение>` до того, как команда дойдёт до плагина, поэтому плагин не может запретить прямой `--password`; в справке его нет, и пользоваться им не нужно.

## Настройка через агента

Кнопка «Настроить через агента» создаёт и открывает тред в текущем проекте с инструкцией найти уже имеющиеся ключи; копирование доступно через «Текст для агента». Итог занимает всю ширину в трёх колонках; импортированные серверы помечены и недоступны для повторного выбора.

## UI components

`components/ui/` is vendored source you own (the shadcn model): edit the
files freely — they never update out from under you. Add more from the BB
component registry (the full shadcn set, version-matched to your BB install
via the pinned ref in `components.json`):

```
npx shadcn add @bb/select @bb/table
```

Run `npm install` once before `bb plugin build` — the vendored components'
npm deps bundle into your dist. React, and BB-shimmed packages like the
radix portal primitives and `sonner` (`import { toast } from "sonner"`
reaches BB's own toaster), are provided by the BB app at runtime and never
bundled. Every shimmed package is declared in `devDependencies` at the
host's version so those imports typecheck; keep them there (never in
`dependencies`, which would bundle a second copy), and `bb plugin types`
repins declared packages alongside the SDK; unused packages may be removed. Ship `dist/` (npm tarball or committed for
git installs) so people installing your plugin never need npm.

## Manifest

`package.json` is the plugin manifest. Notable fields:

- `bb.server` — backend entry (required).
- `bb.app` — frontend entry. Delete it, `app.tsx`, `components/`,
  `hooks/`, and `lib/` for a headless plugin.
- `bb.skills` — skill roots; omitted here, so BB reads `skills/`. Each
  directory with a `SKILL.md` is one skill, named after the directory.
- `bb.name` and `bb.description` — required human-facing identity.
- `bb.branding` — required; declare `icon` as a BB icon name or a
  plugin-relative compact SVG, or declare `logo.light` (with optional
  `logo.dark`). Logo assets must be relative `.svg`, `.png`, or
  `.webp` files.
- `engines.bb` — supported bb app version range.
- `engines.bbPluginSdk` — the lowest plugin SDK you need (scaffold:
  `>=0.6.132`). BB reads this as a floor, not a ceiling: a later
  SDK in the same major still loads your plugin.
- `dependencies` — every package your source imports that BB does not provide.
  `bb plugin build` inlines them into `dist/`, and git installs resolve this
  list alone, so a build-required package here rather than in
  `devDependencies` is what keeps your plugin installable. `devDependencies`
  is for types and tooling only (BB shims React, the portal primitives, and
  `@get-bb/plugin-sdk` at runtime — never bundle them).

Run `bb plugin build` before publishing git/npm installs. It writes
`dist/server.js` + `server.meta.json` and `app.js` / `app.css` /
`app.meta.json`. Each `*.meta.json` stamps SDK major/version,
`artifactFormatVersion`, `pluginId`, `pluginVersion`, and
`builtWith` so managed installs can verify the artifacts. `app.meta.json`
also lists `runtimeSlots`, the shimmed host modules the bundle imports.

## Store listing

Two texts describe the plugin in the store. `bb.description` in package.json
is the one-sentence hook on every browse card and the lead paragraph on the
detail page; keep it under about 140 characters. `PLUGIN_OVERVIEW.md` is the
same claim at length, shown in an Overview section under that paragraph.
Rewrite the scaffold's copy for your plugin, and update it whenever
`bb.description` changes, so the two never disagree.

The submission to the public BB Community marketplace requires the file. Keep
it under 4000 characters (aim for 700 to 1800) and use headings, paragraphs,
emphasis, code, blockquotes, lists, thematic breaks, and absolute https links
only — raw HTML, images, tables, footnotes, and task lists are rejected. Do
not open with a `#` title or repeat `bb.description` verbatim; the page
shows both directly above.

## Install

From this directory (`bb plugin new` already ran the install; a fresh clone
needs it):

```
npm install
bb plugin install .
```

After editing sources, reload:

```
bb plugin reload ssh-fleet
```

Or let `bb plugin dev` rebuild and reload on every save.

## Configure

```
bb plugin config ssh-fleet
bb plugin reload ssh-fleet
```

## Types & API reference

The plugin API ships as the npm package `@get-bb/plugin-sdk`, pinned to an
exact version in `devDependencies` (`0.6.132` — the SDK of the BB
that scaffolded this plugin). After `npm install`, the full surface is on disk
at:

```
node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts      # backend
node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-app.d.ts  # frontend
```

Your editor and `tsc` resolve `@get-bb/plugin-sdk` there through ordinary node
resolution — no path mapping. These are readable declarations: open them for an
exact signature.

The SDK surface grows with every BB release, so the pin has to track the BB you
actually run:

```
bb plugin types          # sync this plugin's SDK surface to the running BB
bb plugin types --check  # CI: fail when it does not match
```

Ask BB to write plugins for you: the `bb-plugin-authoring` skill documents
the whole surface with examples.

Confused by the API, or need something the types don't explain? Clone the BB
repo and read the source: <https://github.com/get-bb/bb>.
