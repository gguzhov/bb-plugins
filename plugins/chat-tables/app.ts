import {definePluginApp} from '@get-bb/plugin-sdk/app';

// Wide tables (6+ columns) keep natural column widths and scroll sideways inside
// bb's own scroller. Long text cells are capped so rows are not blown up.
const WIDE = '[data-markdown-preview] table:has(> * > tr > :nth-child(6))';
const BREAKOUT = '[data-markdown-preview] div[style*="--md-table-breakout-max"]';

const CSS = `
  [data-markdown-preview] {
    min-width: 0;
    max-width: 100%;
  }
  ${BREAKOUT} {
    width: 100% !important;
    max-width: 100%;
    min-width: 0;
    margin-inline: 0 !important;
  }
  ${BREAKOUT} > div {
    width: 100%;
    max-width: 100%;
    min-width: 0 !important;
    margin-inline: 0 !important;
    overflow-x: auto;
  }
  ${WIDE} {
    width: max-content;
  }
  ${WIDE} :is(th, td) {
    max-width: 360px;
  }
`;

export default definePluginApp(app => {
  app.contentScripts.register({
    id: 'contained-tables',
    mount: ({signal}) => {
      const style = document.createElement('style');
      style.dataset.bbPlugin = 'chat-tables';
      style.textContent = CSS;
      document.head.append(style);
      const dispose = () => style.remove();
      signal.addEventListener('abort', dispose, {once: true});
      return dispose;
    },
  });
});
