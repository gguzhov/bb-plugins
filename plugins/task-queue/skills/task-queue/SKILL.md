---
name: task-queue
description: Keep the thread's work plan in the Working Thread card (plugin id `task-queue`) above the BB composer with `bb task-queue plan '<json>'` or the `task_queue_plan` tool. Epics are "Queue N" (or "Очередь N" in Russian), tickets carry owner, desc, criteria and acceptance, and background agents and commands show under their ticket. Needs no other plugin.
---

# Working Thread (plugin id `task-queue`)

The lead agent's work plan in one card above the prompt box: task → epics
("Queue N: …", in Russian "Очередь N: …") → tickets. The card is up while
the thread has an unfinished plan; a finished one stays 30 s. While it is
up, the thread's background agents and commands show inside it; the plugin
reads them from the thread's timeline itself.

## Keep the plan (agents)

Any task gets a plan, even one ticket. Create it once, then move tickets as
they go. One JSON op per call, in single quotes. The thread is the current
one (`BB_THREAD_ID`); add `--thread <id>` for another.

```sh
# create: epics of tickets; points, owner, criteria, desc, agent are optional; no codes needed
bb task-queue plan '{"id":"v5","title":"Экраны v5","epics":[{"name":"Очередь 1: экраны","tickets":[{"title":"Карточка пациента","points":3,"owner":"Sonnet 5.5","criteria":6,"desc":"Карточка пациента с вкладками визитов и оплат; врач видит всё на одном экране."},{"title":"Справочники","points":2,"owner":"Lead: Fable 5.2","criteria":4,"desc":"Справочники врачей и услуг, правка без программиста."}]},{"name":"Очередь 2: выпуск","tickets":[{"title":"Выкладка","owner":"Haiku 5.5","desc":"Выпуск на сервер и проверка, что всё открывается."}]}]}'
# in work, with who does it: the subagent's description as given at launch (or a child thread id thr_…)
bb task-queue plan '{"id":"v5","start":[{"ticket":"Карточка пациента","agent":"Карточка пациента: вкладки визитов"},"Справочники"]}'
bb task-queue plan '{"id":"v5","assign":[{"ticket":"Выкладка","agent":"Карточка пациента: вкладки визитов"}]}'  # same agent, one more ticket
bb task-queue plan '{"id":"v5","review":["Карточка пациента"]}'         # executor handed it in
bb task-queue plan '{"id":"v5","accept":[{"ticket":"Карточка пациента","confirmed":5,"total":6}]}'  # lead only: done, 5/6
bb task-queue plan '{"id":"v5","rework":[{"ticket":"Карточка пациента","note":"overlap at 375"}]}'  # back to work, rework +1
bb task-queue plan '{"id":"v5","accept":["Справочники"]}'               # all stored criteria confirmed
bb task-queue plan '{"id":"v5","describe":[{"ticket":"Выкладка","desc":"Выпуск и проверка в бою."}]}'  # set or change desc ("" clears)
bb task-queue plan '{"id":"v5","state":"needs_input","note":"Which server?"}'  # before asking the user
bb task-queue plan '{"id":"v5","state":"done"}'                         # finish
bb task-queue plan show [--json] [--full]                               # plans with metrics; --full adds desc lines
bb task-queue plan clear [--id v5]                                      # delete the thread's plans, or one
```

- Create: `{id, title, epics:[{name, tickets:[ticket]}]}`; `stages`/`steps`
  are the same keys under the old names, and `tickets:[...]` alone is one flat
  list. A ticket is a title or `{title, status?, points?, owner?, desc?,
  criteria?, agent?}`: `agent` — who works on it (see Naming); `code` is an
  old optional field, never shown, not needed; `points` one of 1, 2, 3, 5, 8,
  13 (missing counts as 1; used only for the figures, never shown to the
  user), `owner` up to 40 characters, `desc` up to 300 characters,
  `criteria` 0-50. Give every ticket a one-two sentence `desc` in the
  user's language: what gets done and what comes of it — the user reads it
  on hover. `describe:[{ticket, desc}]` sets or changes it later.
  Statuses: `pending` (default), `active`, `review`, `done`, `error`,
  `skipped`; the first open ticket becomes current when none is in work or
  review.
- Tickets are named by title, without case (old plans also by their code).
  An unknown one is refused (exit 1) with the plan's list; nothing changes.
- `start` puts tickets in work without touching others; an item may be
  `{"ticket":"…","agent":"…"}` to say who does it. `assign:[{ticket, agent}]`
  says it without moving the ticket; one agent may do several tickets.
  `review`: handed in.
  `accept` (the lead's call only): the ticket is `done` with `accepted` =
  `confirmed` and `criteria` = `total`; leave `total` out to use the stored
  criteria, send `"T"` alone when every criterion is confirmed. `confirmed`
  over `total`, or no criteria known, is refused. `rework` takes a ticket in
  `review` or `done` back to work, counts it and clears its acceptance; its
  note becomes the plan's note. Ops combine in one call.
- `accepted`, `rework` and the times (`createdAt`, `startedAt`, `reworkAt`,
  `reviewAt`, `doneAt`) are
  read-only: the plan keeps them; `accepted` sent on create counts only for a
  ticket sent as `done`.
- The old ops still work: `next` (current done, next current), `done:["T"]`
  (done without acceptance; it does not count in the acceptance figure),
  `active:"T"` (closes the tickets in work before it), `skipped`,
  `failed:"T"` with a note (plan `error`), `state`, `note`. Every ticket done
  or skipped makes the plan `done`; `state:"done"` does not change tickets.
- Resending epics under the same `id` replaces the plan; tickets sent without
  a status keep theirs, and their fields, by title. A finished plan resent
  without statuses starts a new run.
- The answer is one line, by titles, with the agent's name when the ticket
  has one: `v5: 3/18, running, active: Карточка пациента (Неон), Справочники ·
  review: Выкладка · accepted 92%`. `next` is not idempotent: if an answer is lost, run
  `plan show --json` instead of repeating it.
- `plan show` prints the checklist with a metrics line (`--full` adds each
  ticket's `desc` on an indented line under it); `plan show --json` carries
  `desc` and adds `metrics` to the plan and each epic, plus `displayTitle` and
  `displayName` (the names as the card prints them). Figures come from
  stored times, never sent: progress (done points / points, skipped left
  out), accepted (confirmed / criteria over accepted tickets), velocity
  (done points per hour since the first start), ETA (from 2 done tickets and
  5 minutes), cycle, first-pass, WIP. No data reads `n/a`, never 0%.
- The `task_queue_plan` agent tool takes the same JSON. It reaches a session
  only when the session next starts; the command works at once.
- Limits: 12 epics, 100 tickets, titles 120 characters, 10 plans per thread
  (the least recently updated one goes first). The card shows the most
  recently updated plan; if that one is finished, after 30 s no card shows.

## Naming (agents)

- Epics: `Queue N: <what the user gets>` in the user's language
  ("Queue 1: research", "Очередь 1: исследования"); the card prints them as
  written. A
  name that starts with "Волна" is printed as "Очередь" in the card and in
  `plan show`; the stored name, and addressing by it, stay as sent.
- `owner`: the executor's model, `Sonnet 5.5`, `Opus 5.5`, `Haiku 5.5`; a
  ticket the lead does itself: `Lead: <model>`, e.g. `Lead: Fable 5.2`
  (`lead` / `ведущий` alone reads `Lead`). The card prints it in full.
- `desc`: one or two sentences in the user's language, on every ticket.
- No codes anywhere: a ticket is called by its title. Name a subagent (its
  `description` at launch) or child thread in plain words in the user's
  language — what it does: `Close button of the panel`, `PDF: pinch zoom`.
  Tie it to its tickets with `start`/`assign` and `agent` set to that same
  description (compared without case and edge spaces; a child thread by its
  `thr_…` id). A background command is tied the same way: `agent` = the
  description the command was started with.
- The card names agents itself, by launch order in the thread's history:
  the first launched is Neon (Russian «Неон»), then Glitch, Cipher …
  (the same order as the Thread Materials plugin's agent list, when it is
  installed; without it, by order among the agents running now); resuming
  an agent keeps its name.
- Tying order: the ticket's `agent`; then, for old plans, a ticket code at
  the start of the agent's name (`UX · Крестик`); then, when exactly one
  ticket is in work and exactly one agent is left, that agent is the
  ticket's. Agents and commands tied to no ticket are listed at the bottom
  of the open card ("Other background work · N", one row each, opened like a
  ticket) and in the hint of the plan's state pill.
- Old plans whose fields sit in the title ("RH вместимость участка, 3 б.,
  Sonnet 5.5, 7 критериев") are read for display and figures when the
  ticket has no fields. New plans should use fields.

## What the user sees

- Language: the plugin setting `language` — `auto` (default: Russian when
  the page or browser language is Russian, English otherwise), `en`, `ru`
  (`bb plugin config task-queue set language ru`). Card words, hints and the
  command's messages for people follow it; the one-line answers for agents
  keep their fixed English format; plan, epic and ticket names stay as sent.
- Closed: one line, a state dot (green while work runs, grey while
  waiting for an answer, red on failure), "plan · ticket in work" (or "3
  tickets in progress"; no ticket codes) and at most three pills: `N / M`,
  acceptance `92%`, the time ("21 min").
- Open: the plan row (state word, `N / M`, time), then at most two figure
  pills — `~19 min` (time left at the pace of accepted tickets, from 2 done
  tickets and 5 minutes) and `accepted 92%` — or none without data; one tick
  per ticket (green done, blue in work, yellow review, red failed, grey
  queued); epics with `3 / 5`, a finished one folded to `✓ 5 / 5`.
- A ticket row: status icon, the owner pill (model) in full, the title, at
  most two pills. In work: the agent and its time on the ticket ("Neon · 12
  min", "1 command · 3 min"; the lead alone: "12 min"; on a phone the name
  only), then the state word. Otherwise the state word (`queued`, `running`,
  `waiting`, `rework`, `review`, `done`, `failed`, `cancelled`; in Russian
  «в очереди», «в работе», «ждёт», «доработка», «приёмка», «готов»,
  «ошибка», «отменён»), then `5/6` acceptance or `↺2` reworks. Rows in work
  have no grey fill; only hover and focus light up. A ticket in work with an
  agent or command on it has a chevron: a click (or Enter) opens what the
  agent does now (its running command, or "Thinking or writing: no command
  is running right now"), a command's launch line and last output lines, and
  "12 min · 959k tokens".
- Hover (keyboard focus; press and hold on touch) shows a hint: the `desc`
  (or the full title), the state with times ("In progress for 8 min · queued
  4 min before that · done by Opus 5.5", "Handed in for review 3 min ago ·
  the work took 15 min", "Accepted · the work took 21 min · 5 of 6 criteria
  confirmed"), and "Neon: subagent, Opus 5.5. Running for 12 min. Now:
  thinking" for a ticket with an agent. Epics, plan pills and the ticks have
  hints too.
- Open or closed is remembered per browser. In Liquid Glass's stack deck the
  deck sets the order. On phones (Liquid Glass "pills" mode) the card is not a
  pill: it stays a full-width card above the prompt box (collapsed row 44 px,
  opens in place, at most ~45% of the screen with its own scroll; rows 44 px;
  the model pill shrinks to "Opus"); an open card folds when the on-screen
  keyboard comes up.

## Storage and older setups

- Plans are stored in this plugin's kv, key `plan:<threadId>`.
- Background agents and commands are read from the thread's timeline by
  this plugin (RPC `activity`, shared 1.5 s cache, read only while bb shows
  its own background card in the composer). No other plugin is needed.
- Optional, only where the author's older companion plugin
  (`background-peek`) is installed: its `bb background-peek plan …` and
  `background_peek_plan` forward here over RPC (`cli`, `tool`) and answer
  the same; its card hides while a plan shows here; its plans kept up to its
  v0.5 were copied here once (`migration:v1`, `bb task-queue migrate`).

Turn it off with `bb plugin disable task-queue`.
