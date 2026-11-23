/** Injected only while compact-home layout is active (see content script). */
export const MOBILE_HOME_COMPOSER_STYLE_ID = "mobile-home-composer-styles";

export const mobileHomeComposerCss = `
@media (max-width: 47.99rem) {
  [data-testid="root-compose-compact-composer"] [data-promptbox-shell] {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    overflow: visible;
    border: none;
    background: transparent;
    box-shadow: none;
  }

  [data-testid="root-compose-compact-composer"] [data-new-thread-footer] {
    margin-top: 0 !important;
    border: none !important;
    background: transparent !important;
    box-shadow: none !important;
  }

  [data-testid="root-compose-compact-home"] [data-composer-box] > div > div:nth-child(1) {
    max-height: 5.5rem;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  [data-testid="root-compose-compact-home"] [data-new-thread-footer],
  :root:not([data-bui-off~="prompt"]) [data-testid="root-compose-compact-home"] [data-app-composer]:not(:has([data-follow-up-composer])) > [data-new-thread-footer]:has(> div [data-promptbox-project-control]) {
    display: flex !important;
    flex-wrap: nowrap !important;
    align-items: center;
    justify-content: flex-start !important;
    gap: 0.25rem;
    overflow: hidden !important;
    box-sizing: border-box;
    padding: 0 0.125rem calc(0.25rem + env(safe-area-inset-bottom, 0px));
    min-height: 0;
    max-height: none !important;
  }

  [data-testid="root-compose-compact-home"] [data-new-thread-footer] > div {
    display: contents !important;
  }

  /* Every footer control is a 44 x 44 px touch target. */
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button {
    flex: 0 0 auto !important;
    box-sizing: border-box;
    width: auto !important;
    max-width: none !important;
    min-width: 2.75rem;
    height: 2.75rem !important;
    min-height: 2.75rem;
    justify-content: center !important;
    align-items: center;
  }

  /* Project, environment, branch and machine: icon only. The label and the
     chevron are hidden; the button, its aria-label and its menu stay. */
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] [data-promptbox-project-control],
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Environment"],
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Branch"],
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Machine"] {
    width: 2.75rem !important;
    max-width: 2.75rem !important;
    padding-inline: 0 !important;
  }

  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] [data-promptbox-project-control] [data-promptbox-full-label],
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] [data-promptbox-project-control] [data-promptbox-compact-label],
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Environment"] [data-promptbox-full-label],
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Environment"] [data-promptbox-compact-label],
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Branch"] [data-promptbox-full-label],
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Branch"] [data-promptbox-compact-label],
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Machine"] [data-promptbox-full-label],
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Machine"] [data-promptbox-compact-label],
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] [data-promptbox-project-control] > svg:last-child,
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Environment"] > svg:last-child,
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Branch"] > svg:last-child,
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Machine"] > svg:last-child {
    display: none !important;
  }

  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] [data-promptbox-project-control] [data-icon-root],
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Environment"] [data-icon-root],
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Branch"] [data-icon-root],
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Machine"] [data-icon-root] {
    flex: 0 0 auto;
  }

  /* The branch label has no data attribute: it is the span after the icon. */
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Branch"] > span > span {
    display: none !important;
  }

  /* Hover and long-press reach the button, so its title names the control. */
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] :is([data-promptbox-project-control], button[aria-label="Environment"], button[aria-label="Branch"], button[aria-label="Machine"]) > span {
    pointer-events: none;
  }

  /* Environment gets its own glyph (stacked layers) so it differs from the
     project folder. Drawn as a mask: 1.5 px stroke, no network request. */
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Environment"] [aria-hidden="true"] > svg {
    display: none !important;
  }

  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Environment"] [aria-hidden="true"] {
    display: block !important;
    flex: 0 0 auto;
    width: 1rem;
    height: 1rem;
    background-color: currentColor;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 3 3 7.5l9 4.5 9-4.5z'/%3E%3Cpath d='m3 12 9 4.5 9-4.5'/%3E%3Cpath d='m3 16.5 9 4.5 9-4.5'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 3 3 7.5l9 4.5 9-4.5z'/%3E%3Cpath d='m3 12 9 4.5 9-4.5'/%3E%3Cpath d='m3 16.5 9 4.5 9-4.5'/%3E%3C/svg%3E") center / contain no-repeat;
  }

  /* Permission mode sits at the right edge of the row. */
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Permission mode"] {
    margin-left: auto !important;
  }

  /* Permission mode keeps its text (the short label, "Full"). */
  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Permission mode"] {
    min-width: max-content;
    padding-inline: 0.5rem;
  }

  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Permission mode"] [data-promptbox-full-label] {
    display: none !important;
  }

  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Permission mode"] [data-promptbox-compact-label] {
    display: block !important;
    overflow: visible;
    text-overflow: clip;
    white-space: nowrap;
  }

  :root:root:root [data-testid="root-compose-compact-home"] [data-new-thread-footer] button[aria-label="Agent options"] {
    min-width: max-content;
  }

  aside[aria-label="File tree"] {
    top: env(safe-area-inset-top, 0px) !important;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  aside[aria-label="File tree"] button[aria-label="Hide file tree"] {
    width: 44px !important;
    height: 44px !important;
    min-width: 44px !important;
    min-height: 44px !important;
  }

  aside[aria-label="File tree"] button[aria-label="File tree folder"] {
    margin-left: auto !important;
  }

  [data-testid="root-compose-compact-home"] [data-composer-box] [data-promptbox-shrinkable-control] {
    flex-shrink: 1 !important;
    min-width: 0;
  }

  [data-testid="root-compose-compact-home"] [data-composer-box] [data-promptbox-shrinkable-control] [data-promptbox-full-label] {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  [data-follow-up-composer-footer] {
    flex-wrap: nowrap !important;
    overflow: hidden !important;
    max-height: 2.75rem !important;
  }

  [data-promptbox-shell] [data-promptbox-hide-branch-compact],
  [data-new-thread-footer] button[aria-label="Show file tree"],
  [data-follow-up-composer] button[aria-label="Show file tree"] {
    display: none !important;
  }
}
`;