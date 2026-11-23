import type {ProjectColor} from './palette';
import {watchDocument} from './scoped-observer';
export function decorateProjects(signal:AbortSignal){
 let projects:ProjectColor[]=[];let frame=0;
 const labels=new Map<HTMLElement,HTMLElement>();
 const labelFor=(el:HTMLElement)=>el.querySelector<HTMLElement>('[data-sidebar-rename-anchor][aria-expanded]:not([aria-haspopup])')?.previousElementSibling as HTMLElement|null;
 const apply=()=>{
  frame=0;
  for(const[el,label]of labels)if(!el.isConnected||label!==labelFor(el)){label.classList.remove('pc-project-label');label.style.removeProperty('--pc-color');labels.delete(el);}
  for(const el of document.querySelectorAll<HTMLElement>('[data-sidebar-project-id]')){
   const project=projects.find(p=>p.id===el.dataset.sidebarProjectId);const label=labelFor(el);if(!project||!label||label.tagName==='INPUT')continue;
   labels.set(el,label);label.classList.toggle('pc-project-label',project.color!==null);
   const color=project.color??'transparent';if(label.style.getPropertyValue('--pc-color')!==color)label.style.setProperty('--pc-color',color);
  }
 };
 const schedule=()=>{if(!frame&&!signal.aborted)frame=requestAnimationFrame(apply);};
 const stopWatching=watchDocument(schedule,signal);
 const update=(e:Event)=>{projects=(e as CustomEvent<ProjectColor[]>).detail;schedule();};
 document.addEventListener('pc:state',update);document.dispatchEvent(new Event('pc:ready'));
 const clean=()=>{stopWatching();cancelAnimationFrame(frame);document.removeEventListener('pc:state',update);for(const label of labels.values()){label.classList.remove('pc-project-label');label.style.removeProperty('--pc-color');}labels.clear();};
 signal.addEventListener('abort',clean,{once:true});return clean;
}
