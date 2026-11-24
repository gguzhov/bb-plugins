---
name: genidev-project-icons
description: Choose, add or remove BB project icons (the picture left of a project name in the sidebar, animated while the project works or waits) with the `bb genidev-project-icons` CLI, including generating a new icon picture and adding it. Use when the user asks to give a project an icon, change or remove it, make a new icon, or turn icon animation off.
---

# Иконки проектов

Плагин «Иконки проектов» ставит картинку слева от названия проекта в боковой
панели bb. В интерфейсе: три точки у проекта → «Icon» → одна сетка: «Без иконки»
(снимает иконку), вшитые иконки, свои картинки, «+» (добавить свою).

Библиотека = вшитые иконки плагина (`assets/icons/icons.json`) + свои картинки.
Вшитые и свои хранятся в WebP 96×96 (свои, добавленные без `cwebp`, — в PNG;
старые PNG тоже работают). Своих не больше 200. Свою картинку можно удалить; она
снимается со всех проектов.

Иконка оживает: пока в проекте работает агент — водит глазами (или чуть
качается, если кадров нет), пока агент ждёт владельца (вопрос, разрешение,
план) — озадачена или с жёлтой меткой «?». Выключить движение:
`bb plugin config genidev-project-icons set animation false` (метка «?» остаётся).

## Команды

| Команда | Что делает |
| --- | --- |
| `bb genidev-project-icons list [--json]` | Проекты и их иконки (`iconId` или «без иконки») |
| `bb genidev-project-icons icons [--json]` | Библиотека: `id`, `kind` (`builtin`/`custom`), название, `frames` (какие кадры есть) |
| `bb genidev-project-icons set <projectId> <iconId\|none>` | Назначить иконку проекту или снять (`none`) |
| `bb genidev-project-icons add <файл> --name <название> [--json]` | Добавить свою картинку с диска этой машины |
| `bb genidev-project-icons remove <iconId> [--json]` | Удалить свою картинку (`custom-…`) |

`add`: файл PNG, JPEG или WebP (проверяется по содержимому, не по имени), SVG не
принимается. Относительный путь считается от текущей папки. На macOS картинка
вписывается в прозрачный квадрат 96×96 и сохраняется в WebP, если установлен
`cwebp` (`brew install webp`), иначе в PNG; итог не больше 512 КБ и 512 px.
Название до 60 символов. Ответ `--json`: `{"id","name","kind"}`.

## Рецепт: сгенерировать иконку и добавить

1. Сгенерируйте квадратную картинку с прозрачным фоном тем инструментом
   генерации картинок, который у вас есть. Простой предмет или голова персонажа
   по центру, без текста, крупно: на экране она будет 16 px.
2. Добавьте исходник как есть, плагин сам приведёт его к 96×96 WebP:
   `bb genidev-project-icons add source.png --name "Ракета" --json`
   и запомните `id` из ответа.
3. Если иконка нужна конкретному проекту: найдите его id через
   `bb genidev-project-icons list`, затем
   `bb genidev-project-icons set <projectId> <id>`.

Все открытые окна bb обновляются сразу. Временные файлы картинок после добавления
можно удалить: плагин хранит свою копию.

## Кадры анимации вшитых иконок

Кадры есть только у вшитых иконок. В `assets/icons/icons.json` у записи —
необязательное `"frames": {"left": "<id>.left.webp", "right": "<id>.right.webp", "puzzled": "<id>.puzzled.webp"}`,
файлы рядом с основным, 96×96 WebP, тот же персонаж и ракурс. Любого кадра может
не быть. После правки: `bb plugin reload genidev-project-icons`; битые кадры
пропускаются с записью в `bb plugin logs genidev-project-icons`.
