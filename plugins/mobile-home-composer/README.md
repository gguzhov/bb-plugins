# bb-plugin-mobile-home-composer

A bb plugin that fits the project home composer onto phone-width screens.
Below 768 px of viewport width it turns the composer into one borderless card,
keeps the footer on a single line with icon-only project, environment and
branch buttons, and keeps the
project list clear of the composer. Wider screens are not touched.

## What it does

All of it is active only while the viewport is narrower than `47.99rem`
(`NARROW_MEDIA`). When the viewport gets
wider, the plugin removes its style element and every inline style it set.

- **One card.** The composer shell becomes a flex column with no border,
  background or shadow, and the footer loses its border and background.
- **Text box height.** The text area is capped at 5.5 rem and scrolls inside
  itself.
- **One-line footer, icons only.** The footer under the text box does not wrap
  and has no fixed height cap. Project, environment, branch and machine (when
  shown) lose their label and chevron and become icon buttons; the permission
  mode keeps its short text ("Full"). Every footer button is at least 44 x 44 px
  with a 4 px gap, so the row fits at 320 px without cutting anything. The
  buttons stay in the DOM with their `aria-label` and dropdowns; the content
  script adds a `title` such as "Environment: Project checkout" (updated when
  the value changes, removed when the plugin turns off). Their inner spans get
  `pointer-events: none` so hover and long-press show that title.
- **List spacing.** It sets the bottom of the scroll viewport to the composer
  height plus 8 px and the spacer to 8 px, and updates both when the composer
  resizes.
- **File tree panel.** Below the same width the panel respects the safe areas,
  and its **Hide file tree** button is 44 by 44 px.

## What it hides

On narrow screens it hides the **Show file tree** buttons in the new-thread
footer and in the follow-up composer. The follow-up composer footer is
also forced to one line.

## Depends on

bb markup the styles and the script rely on (a bb update that renames them can
break the footer):

- `data-testid="root-compose-compact-home"`, `root-compose-compact-composer`,
  `root-compose-compact-scroll-viewport`, `root-compose-compact-bottom-spacer`
- `data-new-thread-footer`, `data-promptbox-shell`, `data-composer-box`,
  `data-app-composer`, `data-follow-up-composer`
- `data-promptbox-project-control` (the project button; its `aria-label` is
  "Project: <name>")
- `data-promptbox-full-label` and `data-promptbox-compact-label` (label spans)
- `aria-label` values `Environment`, `Branch`, `Machine`, `Permission mode`,
  `Agent options`, `Show file tree`, `Hide file tree`, and the structure
  `button > span > span` for the branch label (it has no data attribute)
- The footer rules use the `:root:root:root` prefix to outrank the Beautiful
  Chat plugin's rule that hides compact labels at 640 px and below.

## What it does not do

No settings, no CLI command, no sidebar page, no agent skill. `server.ts` is an
empty backend that the plugin format requires. The layout depends on bb's
markup (`data-testid="root-compose-compact-*"`, `data-promptbox-*`,
`data-new-thread-footer`, aria labels such as `Environment` and `Branch`), so a
bb update can break it. Tested on bb 0.50.1 with a phone viewport (320, 375, 414 px) and 768 and 1280 px; `package.json` declares
`engines.bb >= 0.49`.

The footer rule in `mobile-home-composer-styles.ts` mentions
`:root:not([data-bui-off~="prompt"])`. `data-bui-off` is set on the page root
by the Beautiful Chat plugin to list features turned off. Without that plugin
the attribute is absent, the `:not()` is true, and the rule applies.

## Develop

```
npm install
npm run typecheck
bb plugin build
bb plugin install .
bb plugin reload mobile-home-composer
```

`components/`, `hooks/` and `lib/` are vendored scaffold helpers that the
plugin does not use. Ship `dist/` for git installs.
