import {useEffect,useRef,useState} from 'react';
import {definePluginApp,useRpc,type ExperimentalThreadInfoProps} from '@get-bb/plugin-sdk/app';
import type {rpcContract} from './contract';
import {STRINGS,resolveLanguage} from './strings';
import './style.css';
function Directory({environment}:ExperimentalThreadInfoProps){
 const rpc=useRpc<typeof rpcContract>();const ref=useRef<HTMLSpanElement>(null);const[error,setError]=useState('');
 useEffect(()=>{if(!environment)return;let disposed=false;const cleanups:(()=>void)[]=[];let observer:MutationObserver|undefined;let frame=0;
 rpc.call('info',{environmentId:environment.id}).then(info=>{if(disposed||!info.supported||!info.path)return;
  const language=resolveLanguage(info.language,document.documentElement.lang,navigator.language);const t=STRINGS[language];
  let owner:HTMLElement|null=ref.current?.parentElement??null;while(owner&&!owner.querySelector('button[aria-label="Copy directory"]'))owner=owner.parentElement;
  if(!owner||owner===document.body)return;const bound=new WeakSet<Element>();
  const bind=()=>{for(const button of owner!.querySelectorAll<HTMLButtonElement>('button[aria-label="Copy directory"]')){
   if(button.querySelector('[title]')?.getAttribute('title')!==info.path||bound.has(button))continue;bound.add(button);
   const openButton=button.cloneNode(true) as HTMLButtonElement;openButton.removeAttribute('id');openButton.querySelector('svg')?.remove();openButton.title=t.openTitle(info.path??"");openButton.setAttribute('aria-label',t.openLabel);openButton.classList.add('df-directory');button.classList.add('df-copy');const parent=button.parentElement!;parent.classList.add('df-actions');button.before(openButton);let pending=false;
   const click=(e:Event)=>{e.preventDefault();e.stopPropagation();if(pending)return;pending=true;setError('');rpc.call('open',{environmentId:environment.id,language}).catch(e=>{if(!disposed)setError(e instanceof Error?e.message:String(e));}).finally(()=>pending=false);};openButton.addEventListener('click',click);
   cleanups.push(()=>{openButton.remove();button.classList.remove('df-copy');parent.classList.remove('df-actions');});

  }};bind();observer=new MutationObserver(()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(!disposed)bind();});});observer.observe(owner,{childList:true,subtree:true});
 }).catch(()=>{if(!disposed)setError(STRINGS[resolveLanguage('auto',document.documentElement.lang,navigator.language)].failed);});
 return()=>{disposed=true;cancelAnimationFrame(frame);observer?.disconnect();cleanups.forEach(f=>f());};
 },[environment?.id,rpc]);
 return <span ref={ref}>{error&&<span role="alert">{error}</span>}</span>;
}
export default definePluginApp(app=>{app.slots.experimental_threadInfoRow({id:'finder-directory',group:'environment',component:Directory});});
