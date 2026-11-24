Working Thread: the lead agent's work plan in one card above the composer,
with queues and tickets, who does what and how much is left.

## What you get

- One card above the prompt box. Closed, it is one line: a state dot, the
  plan and the ticket in work, and at most three pills: `2 / 18`,
  acceptance `92%`, the running time.
- Open: time left and acceptance, one tick per ticket, then the queues
  ("Queue 1: …", named as the agent wrote them) with their tickets. Each
  ticket shows who does it in full ("Lead: Fable 5.2", "Sonnet 5.5"), its
  title and one state word.
- Hover a ticket (or focus it, or press and hold on a phone): its description
  and its state with times in plain words — how long it waited, how long it
  has been in work, who does it.
- Background agents and background commands show under the ticket they work
  on: open the row to see what the agent is doing now, or a command's launch
  line and latest output. Background work tied to no ticket is listed at the
  bottom of the open card.
- English or Russian: the `language` setting (`auto`, `en`, `ru`).
- Agents keep the plan with `bb task-queue plan '<json>'` (or the
  `task_queue_plan` tool).

## How it works

Plans are stored per thread in BB's own database; background agents and
commands are read from the thread's timeline by the plugin itself. No other
plugin is needed. Nothing leaves the machine, and no account or key is needed.
