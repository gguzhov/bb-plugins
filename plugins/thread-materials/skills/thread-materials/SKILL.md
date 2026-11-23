---
name: thread-materials
description: Register created results and user-provided sources in BB's upper-right Materials widget.
---
The widget stays at the upper-right, hides while the right panel is open, and returns on close. Narrow layouts use native context disclosure or Materials tab.

Sources are files/images/documents supplied by the USER. Results are meaningful documents/artifacts CREATED by the current chat. Never label an agent-created research document as a source. Do not infer creation merely from reading or linking an existing file.
Register created documents after they exist:
`bb materials add --group result --title 'Readable title' --href '/absolute/path/document.pdf'`
Only when a user-supplied reference is not already indexed, register --group source. Ordinary uploaded files/images are indexed automatically. Never register generated code/configs/README/AGENTS/SKILL/logs/test reports as results. Use --thread only for intentional assignment to another chat.
The Executors section lists every built-in subagent of the chat (Agent/Task launches; a launch and its SendMessage resumes are one row) and every child bb thread, from the thread's event history, with a state icon, model, time, tool calls and tokens. Pass `model` explicitly when launching a subagent: otherwise the row reads "как у ведущего (…)", because bb does not report a subagent's actual model. Child thread rows open the thread; subagent rows expand their final summary.
The top line shows git changes not yet on GitHub for the thread's working folder: branch, +added, −removed, files (uncommitted, untracked and unpushed together, exact `git diff --numstat` against the upstream fork point). The plugin only reads git.
Absolute local paths preserve host identity. Results win over Sources for the same object; different hosts remain separate. Removing a pin never deletes a file. Installation enables threadContextCard. See bb materials add --help.

Compact widget shows three files per section and five finished executors (the rest expand). Show all opens the full right tab. Archive/Delete change persistent visibility only; never disk files. Sources have no add button. Parent remains in Info.
