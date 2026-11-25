---
name: ssh-fleet
description: Список серверов в BB по группам, их стоимость и снимок CPU, памяти и диска по SSH-ключу root. Используй для bb ssh-fleet list, add (по ключу или один раз по паролю root), set, group, check и agent-prompt, и когда пользователь просит настроить его серверы.
---

# ssh-fleet

Инвентарь удалённых Linux-серверов. Строка — это сервер, не копия ключа. Вход всегда как `root` по пути к приватному ключу на машине, где запущен сервер BB.

Проверка идёт только пока BB запущен. Раз в час, при старте если снимок старше часа, и по явной команде. Открытие панели само по себе на сервер не заходит. Если полный проход ещё идёт, следующий час пропускается и пишется предупреждение в лог плагина.

Первый успешный заход записывает ключ хоста в `~/.ssh/known_hosts` этой машины. Смена ключа останавливает проверку. Обхода этой проверки нет.

Добавить сервер можно в панели «Серверы» или командой `bb ssh-fleet add --name <имя> --host <хост> --key <абсолютный путь к ключу> [--port] [--description] [--hosting] [--cost] [--group]` (проверки те же, что в панели; повтор host:port даёт ошибку `conflict`). Описание (до 500 символов, что лежит на сервере), хостинг (до 80) и стоимость в ₽ в месяц правятся командой `bb ssh-fleet set --id <id> [--name] [--description] [--hosting] [--cost] [--group]`; она меняет только переданные поля и не сбрасывает снимок. Удаление и импорт из ssh config только в панели.

Группа сервера (`group`) — одна из групп, которые завёл пользователь. После установки есть только `personal` («Personal»), она же группа по умолчанию, удалить её нельзя. Список: `bb ssh-fleet group list [--json]`. Добавить: `bb ssh-fleet group add --label <название> [--id <id>]`. Переименовать или переставить: `bb ssh-fleet group set --id <id> [--label] [--position]`. Удалить: `bb ssh-fleet group remove --id <id> [--yes]`; серверы группы переходят в группу по умолчанию, и если они есть, без `--yes` команда отказывает с кодом `confirm`. В `--group` команд `add`, `set`, `list` можно передать id или название; неизвестная группа — ошибка `invalid` со списком существующих. Смена группы через `set --group` снимок не сбрасывает.

`bb ssh-fleet list` показывает последний снимок, группу в квадратных скобках, хостинг, стоимость и первую строку описания (в `--json` поля `group`, `hosting`, `monthlyCostRub`, `description` целиком). `bb ssh-fleet list --group <группа>` оставляет только одну группу. Стоимость в час нигде не хранится: это месячная, делённая на 720. `bb ssh-fleet check` требует ровно один из флагов `--all` или `--id <id>`. Упавший сервер — это данные в ответе, команда при этом завершается успешно. `--json` отдаёт путь к ключу и короткую причину, но не байты ключа и не сырой stderr.

Проверка — это root SSH от пользователя сервера BB. Кто может открыть панель или вызвать команду, может её запустить.

## Добавление по паролю root, один раз

`bb ssh-fleet add --name <имя> --host <хост> [--port] --password-stdin [--group] [--hosting] [--cost] [--description] [--ssh-config]` читает пароль root только из stdin; не передавай пароль аргументом. Первый запуск показывает отпечаток ключа хоста (`SHA256:…`), ничего не отправляет на сервер и завершается с кодом `confirm_host_key`. Покажи отпечаток пользователю; после подтверждения повтори ту же команду с `--host-key <отпечаток>`. Тогда плагин создаёт в `~/.ssh` отдельный ключ ed25519 (`ssh-fleet-<имя>`, режим 600, существующие файлы не трогает), один раз входит по паролю через SSH_ASKPASS, дописывает публичный ключ в `/root/.ssh/authorized_keys`, проверяет вход по ключу и сохраняет только путь к ключу. Пароль не пишется на диск, в базу, в настройки и в логи и не возвращается. Ошибки: неверный пароль, вход по паролю выключен, сервер недоступен, ключ хоста не совпал, ssh без SSH_ASKPASS_REQUIRE (OpenSSH старше 8.4). При любой ошибке сервер не добавляется, а созданный ключ удаляется. `--ssh-config` дописывает блок Host в `~/.ssh/config`.

## Настройка через агента

`bb ssh-fleet agent-prompt` печатает текст для любого агента с доступом к shell на этой машине. Тот же текст показывает кнопка «Настроить через агента» в панели. Если пользователь просит настроить серверы, следуй ему:

```text
Register my servers in the bb "Servers" plugin (ssh-fleet). You have a shell on my machine; the bb command is available.

Rules for the whole task:
- Never print, echo, log, store or write to a file any password, and never print or read out the contents of a private key. Public keys and file paths are fine.
- Ask me before you change anything on a server, and before you edit ~/.ssh/config. Reading is fine.
- Log in only as root. Do not disable host key checking: when a host is new to this machine, show me its fingerprint and wait until I confirm it.

Steps:
1. Find my servers. Read ~/.ssh/config (Host, HostName, Port, User, IdentityFile) and ask me which of them to add and whether there are others. Run "bb ssh-fleet list" so you skip servers that are already registered, and "bb ssh-fleet group list" to see the groups.
2. After I confirm which servers to add, for each server check that key login as root works:
   ssh -o BatchMode=yes -o IdentitiesOnly=yes -i <private key path> -p <port> root@<host> true
3. Use existing SSH keys on this computer: inspect file names and permissions in ~/.ssh and IdentityFile entries in ~/.ssh/config. Never read private key contents. Match existing keys to the selected hosts; do not guess hosts from key names. Never ask for passwords in chat. If key access fails, report the problem and wait for the owner to arrange access outside chat.
4. Register each server whose key login works:
   bb ssh-fleet add --name <name> --host <host> --key <absolute path to the private key> [--port <port>] [--group <group>] [--hosting <provider>] [--cost <rubles per month>] [--description <what runs there>]
   Create a missing group first with: bb ssh-fleet group add --label <group name>
5. Finish with:
   bb ssh-fleet check --all
   and show me the short result for each server: name, status, and the error if there is one.
```
