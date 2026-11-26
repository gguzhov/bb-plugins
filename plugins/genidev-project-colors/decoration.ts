import type {ProjectColor} from './palette';
import {watchDocument} from './scoped-observer';
/** Data attribute on <html> set by the app from the «Full-width underline» setting; the CSS reads it. */
export const UNDERLINE_ATTRIBUTE='data-pc-underline';
/** The project's header row in the sidebar (the full-width row that holds the name, chevron and «…»). */
export const headerFor=(label:HTMLElement)=>label.closest<HTMLElement>('[data-sidebar-rename-row] > *');
export function decorateProjects(signal:AbortSignal){
 let projects:ProjectColor[]=[];let frame=0;
 const labels=new Map<HTMLElement,HTMLElement>();const headers=new Map<HTMLElement,HTMLElement>();
 const labelFor=(el:HTMLElement)=>el.querySelector<HTMLElement>('[data-sidebar-rename-anchor][aria-expanded]:not([aria-haspopup])')?.previousElementSibling as HTMLElement|null;
 const clear=(label:HTMLElement)=>{label.classList.remove('pc-project-label');label.style.removeProperty('--pc-color');label.removeAttribute('data-pc-chosen-at');};
 // The row is rounded (rounded-md) and bb uses its ::before/::after and background-image, so the full-width line is a child element of its own.
 const clearHeader=(header:HTMLElement)=>{header.classList.remove('pc-project-header');header.style.removeProperty('--pc-color');header.style.removeProperty('--pc-inset');header.querySelector(':scope > .pc-header-line')?.remove();};
 const ensureLine=(header:HTMLElement)=>{if(header.lastElementChild?.classList.contains('pc-header-line'))return;header.querySelector(':scope > .pc-header-line')?.remove();const line=document.createElement('span');line.className='pc-header-line';line.setAttribute('aria-hidden','true');header.append(line);};
 // Inset both ends by the row's left padding so the line lines up with where the text starts, not the rounded row's edges.
 const setInset=(header:HTMLElement)=>{const inset=getComputedStyle(header).paddingLeft;if(inset&&header.style.getPropertyValue('--pc-inset')!==inset)header.style.setProperty('--pc-inset',inset);};
 const apply=()=>{
  frame=0;
  for(const[el,label]of labels)if(!el.isConnected||label!==labelFor(el)){clear(label);labels.delete(el);}
  for(const[el,header]of headers){const label=labels.get(el);if(!label||header!==headerFor(label)){clearHeader(header);headers.delete(el);}}
  for(const el of document.querySelectorAll<HTMLElement>('[data-sidebar-project-id]')){
   const project=projects.find(p=>p.id===el.dataset.sidebarProjectId);const label=labelFor(el);if(!project||!label||label.tagName==='INPUT')continue;
   labels.set(el,label);label.classList.toggle('pc-project-label',project.color!==null);
   if(project.chosenAt!=null){if(label.getAttribute('data-pc-chosen-at')!==String(project.chosenAt))label.setAttribute('data-pc-chosen-at',String(project.chosenAt));}else label.removeAttribute('data-pc-chosen-at');
   const color=project.color??'transparent';if(label.style.getPropertyValue('--pc-color')!==color)label.style.setProperty('--pc-color',color);
   const header=headerFor(label);if(header){headers.set(el,header);header.classList.toggle('pc-project-header',project.color!==null);ensureLine(header);setInset(header);if(header.style.getPropertyValue('--pc-color')!==color)header.style.setProperty('--pc-color',color);}
  }
 };
 const schedule=()=>{if(!frame&&!signal.aborted)frame=requestAnimationFrame(apply);};
 const stopWatching=watchDocument(schedule,signal);
 const update=(e:Event)=>{projects=(e as CustomEvent<ProjectColor[]>).detail;schedule();};
 document.addEventListener('pc:state',update);document.dispatchEvent(new Event('pc:ready'));
 const clean=()=>{stopWatching();cancelAnimationFrame(frame);document.removeEventListener('pc:state',update);for(const label of labels.values())clear(label);labels.clear();for(const header of headers.values())clearHeader(header);headers.clear();};
 signal.addEventListener('abort',clean,{once:true});return clean;
}
