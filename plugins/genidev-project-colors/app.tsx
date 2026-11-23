import {createPortal} from 'react-dom';
import {watchMenuExit} from './menu-lifecycle';
import {projectSurfaces} from './project-surfaces';
import {useCallback,useEffect,useRef,useState} from 'react';
import {experimental_Icon as Icon,definePluginApp,useRpc,useRealtime,experimental_useSidebarThreads} from '@get-bb/plugin-sdk/app';
import type {rpcContract} from './server';
import {PALETTE,type ProjectColor} from './palette';
import {fromHsv,hex,toHsv} from './color';
import {decorateProjects} from './decoration';
import './style.css';
function useColors(){
 const {projects:catalog}=experimental_useSidebarThreads();const catalogKey=catalog.map(p=>p.id+':'+p.name).join('|');
 const rpc=useRpc<typeof rpcContract>();const[projects,setProjects]=useState<ProjectColor[]>([]);const[error,setError]=useState('');const[recent,setRecent]=useState<string[]>([]);
 const refresh=useCallback(()=>{rpc.call('state').then(s=>{setProjects(s.projects);setRecent(s.recent);setError('');}).catch(e=>setError(String(e)));},[rpc]);
 useEffect(refresh,[refresh,catalogKey]);useRealtime('changed',refresh);
 return {projects,recent,error,rpc,refresh};
}
function Colors(){
 const{projects,recent,rpc,refresh}=useColors();const[surface,setSurface]=useState<{id:string;host:HTMLElement}|null>(null);const[created,setCreated]=useState<string|null>(null);const baseline=useRef<{ids:Set<string>;time:number}|null>(null);const current=useRef(projects);current.current=projects;
 useEffect(()=>{const send=()=>document.dispatchEvent(new CustomEvent('pc:state',{detail:projects}));send();document.addEventListener('pc:ready',send);return()=>document.removeEventListener('pc:ready',send);},[projects]);
 useEffect(()=>{const change=(e:Event)=>setSurface((e as CustomEvent).detail);const creating=()=>{baseline.current={ids:new Set(current.current.map(p=>p.id)),time:Date.now()};};document.addEventListener('pc:surface',change);document.addEventListener('pc:creating',creating);document.dispatchEvent(new Event('pc:surfaces-ready'));return()=>{document.removeEventListener('pc:surface',change);document.removeEventListener('pc:creating',creating);};},[]);
 useEffect(()=>{const b=baseline.current;if(!b)return;if(Date.now()-b.time>300000){baseline.current=null;return;}const added=projects.filter(p=>!b.ids.has(p.id));if(added.length){baseline.current=null;if(added.length===1)setCreated(added[0].id);}},[projects]);
 const project=projects.find(p=>p.id===(created??surface?.id));
 const row=project?<ProjectRow key={project.id} project={project} recent={recent} initiallyOpen={!!surface?.host.classList.contains('pc-menu-surface')} save={async color=>{await rpc.call('set',{projectId:project.id,color});refresh();}}/>:null;
 if(created&&project)return <div className="pc-created-backdrop"><div className="pc-created pc-settings" role="dialog" aria-modal="true" aria-label="Оформление нового проекта" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setCreated(null);}if(e.key==='Tab'){const items=[...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')];const i=items.indexOf(document.activeElement as HTMLElement);if(e.shiftKey&&i===0){e.preventDefault();items.at(-1)?.focus();}else if(!e.shiftKey&&i===items.length-1){e.preventDefault();items[0]?.focus();}}}}><p>Проект добавлен</p>{row}<button type="button" className="pc-apply" autoFocus onClick={()=>setCreated(null)}>Готово</button></div></div>;
 return surface&&project?createPortal(surface.host.classList.contains('pc-menu-surface')?<MenuPalette>{row}</MenuPalette>:row,surface.host):null;
}
function MenuPalette({children}:{children:React.ReactNode}){
 const[open,setOpen]=useState(false);const[pos,setPos]=useState({left:0,top:0});const anchor=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open||!anchor.current)return;return watchMenuExit(anchor.current,()=>setOpen(false));},[open]);
 const show=()=>{anchor.current?.querySelector<HTMLButtonElement>('.pc-menu-trigger')?.focus({preventScroll:true});const r=anchor.current!.getBoundingClientRect();setPos({left:r.width+4,top:Math.min(0,window.innerHeight-r.top-280)});setOpen(true);};
 return <div ref={anchor} className="pc-menu-anchor" onMouseEnter={show} onKeyDown={e=>{if(e.key==='Escape'&&open){e.stopPropagation();setOpen(false);}if(e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();show();}}}>
 <button type="button" role="menuitem" className="pc-menu-trigger" aria-haspopup="true" aria-expanded={open} onFocus={show} onClick={show}><Icon name="Palette" aria-hidden="true" className="pc-menu-icon"/><span className="pc-menu-label">Colour</span><span className="pc-submenu-arrow" aria-hidden="true"/></button>
 {open&&<div className="pc-flyout pc-settings" style={pos}>{children}</div>}
 </div>;
}
function ProjectRow({project,recent,initiallyOpen=false,save}:{project:ProjectColor;recent:string[];initiallyOpen?:boolean;save:(color:string|null)=>Promise<void>}){
 const[busy,setBusy]=useState(false);const[error,setError]=useState('');const[hsv,setHsv]=useState(()=>toHsv(project.color??'#4F8FF7'));const root=useRef<HTMLDivElement>(null);const latest=useRef(hsv);
 useEffect(()=>{const next=toHsv(project.color??'#4F8FF7');setHsv(next);latest.current=next;},[project.color]);

 async function commit(color:string|null){setBusy(true);setError('');try{await save(color);}catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить цвет');}finally{setBusy(false);}}
 const rgb=fromHsv(hsv.h,hsv.s,hsv.v);
 const change=(next:typeof hsv)=>{latest.current=next;setHsv(next);};
 const choose=(e:React.PointerEvent<HTMLDivElement>)=>{const r=e.currentTarget.getBoundingClientRect();change({...latest.current,s:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),v:1-Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))});};
 return <div className="pc-setting-row" ref={root} onKeyDown={e=>{if(e.key!=='Escape')e.stopPropagation();}}>
  <div className="pc-project-name">Цвет проекта <span>{project.name}</span></div>
  <div className="pc-swatches" role="group" aria-label={'Цвет проекта '+project.name}>
   {[...new Set([...recent,...PALETTE.map(c=>c.hex)])].slice(0,3).map((color,i)=><button type="button" key={color} disabled={busy} aria-label={'Цвет '+(i+1)+': '+color} title={color} aria-pressed={project.color===color} onClick={()=>commit(color)}><span style={{background:color}}/></button>)}
   <button type="button" disabled={busy} aria-label="Без цвета" title="Без цвета" aria-pressed={project.color===null} onClick={()=>commit(null)}><span className="pc-no-color"/></button>
  </div>
  {<div className="pc-custom" role="group" aria-label={'Палитра RGB: '+project.name}>
   <div className="pc-spectrum" aria-label="Спектр насыщенности и яркости; точные значения доступны в полях RGB" style={{backgroundColor:`hsl(${hsv.h} 100% 50%)`}} onPointerDown={e=>{if(busy)return;e.currentTarget.setPointerCapture(e.pointerId);choose(e);}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))choose(e);}} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId)){choose(e);e.currentTarget.releasePointerCapture(e.pointerId);void commit(hex(fromHsv(latest.current.h,latest.current.s,latest.current.v)));}}}>
    <span style={{left:`${hsv.s*100}%`,top:`${(1-hsv.v)*100}%`}}/>
   </div>
   <label className="pc-hue"><span>Оттенок</span><input aria-label="Оттенок" type="range" min="0" max="359" value={Math.round(hsv.h)} disabled={busy} onChange={e=>change({...hsv,h:+e.target.value})}/></label>
   <div className="pc-rgb">{['R','G','B'].map((name,i)=><label key={name}>{name}<input type="number" min="0" max="255" aria-label={name} value={rgb[i]} disabled={busy} onChange={e=>{const next=[...rgb];next[i]=Math.max(0,Math.min(255,Number(e.target.value)));change(toHsv(hex(next)));}}/></label>)}<button type="button" className="pc-apply" disabled={busy} onClick={()=>commit(hex(rgb))}>Применить</button></div>
  </div>}
  {error&&<p role="alert">{error}</p>}<span className="pc-status" aria-live="polite">{busy?'Сохраняю…':''}</span>
 </div>;
}
export default definePluginApp(app=>{
 app.slots.experimental_appOverlay({id:'colors',component:Colors});
 app.contentScripts.register({id:'project-surfaces',mount:({signal})=>projectSurfaces(signal)});
 app.contentScripts.register({id:'project-underlines',mount:({signal})=>decorateProjects(signal)});
});
