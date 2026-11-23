import {watchDocument} from './scoped-observer';
/** Marks set by this script instead of :has() selectors. A measurement showed that the earlier rules
    `[data-thread-context-card]:has(.tm-widget)`, `…:has(.tm-git[data-tm-git-ready]) … :has([data-thread-context-card-row])`
    and `.tm-info li:has(.tm-exec-icon)` made the browser restyle the whole document (~1800 elements, 80-100 ms)
    on every hover change while the sidebar scrolled. Plain attribute selectors only restyle the marked elements. */
const MARK_CARD = "data-tm-card-widget", MARK_GIT = "data-tm-hide-git", MARK_EXEC = "data-tm-exec", MARK_SECONDARY = "data-tm-secondary";
function mark(el: Element, name: string, on: boolean) {
 // Writing an attribute that is already there still costs a style invalidation: touch only on change.
 if (on === el.hasAttribute(name)) return;
 if (on) el.setAttribute(name, ""); else el.removeAttribute(name);
}
export const CARD_SCAN_EVENT='tm-card-scan';
export function cardChrome(signal:AbortSignal){
 const style=document.createElement('style');style.dataset.bbPlugin='thread-materials';
 style.textContent='[data-thread-context-card]['+MARK_CARD+']{border-radius:14px;background:linear-gradient(155deg,var(--popover) 12%,color-mix(in srgb,var(--popover) 88%,var(--muted)) 100%)}[data-thread-context-card]['+MARK_CARD+'] ['+MARK_SECONDARY+']{display:none}[data-bb-plugin="bb--git"]['+MARK_GIT+']{display:none}';document.head.append(style);
 let frame=0;
 const scan=()=>{
  frame=0;
  document.querySelectorAll<HTMLElement>('[data-thread-context-card-row-frame]').forEach(row=>{
   mark(row,MARK_SECONDARY,/^(Parent:|Родитель:)/.test(row.textContent?.trim()||''));
  });
  document.querySelectorAll<HTMLElement>('[data-thread-context-card-section]').forEach(section=>{
   mark(section,MARK_SECONDARY,/^(Child threads|Дочерние чаты)$/i.test(section.getAttribute('aria-label')||''));
  });
  document.querySelectorAll<HTMLElement>('[data-thread-context-card]').forEach(card=>{
   mark(card,MARK_CARD,card.querySelector('.tm-widget')!==null);
   const gitReady=card.querySelector('[data-tm-git-ready]')!==null;
   card.querySelectorAll(':scope [data-thread-context-card-body] > [data-bb-plugin="bb--git"]').forEach(git=>{
    mark(git,MARK_GIT,gitReady&&git.querySelector('[data-thread-context-card-row]')!==null);
   });
  });
  document.querySelectorAll('.tm-info li').forEach(li=>mark(li,MARK_EXEC,li.querySelector('.tm-exec-icon')!==null));
 };
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(scan);};const stopWatching=watchDocument(schedule,signal);schedule();
 // A card pinned inside the chat timeline is outside the watched scope: the widget asks for a scan itself.
 window.addEventListener(CARD_SCAN_EVENT,schedule);signal.addEventListener('abort',()=>window.removeEventListener(CARD_SCAN_EVENT,schedule),{once:true});
 const dispose=()=>{stopWatching();cancelAnimationFrame(frame);style.remove();for(const name of [MARK_SECONDARY,MARK_CARD,MARK_GIT,MARK_EXEC])document.querySelectorAll('['+name+']').forEach(e=>e.removeAttribute(name));};signal.addEventListener('abort',dispose,{once:true});return dispose;
}
