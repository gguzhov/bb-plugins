import {useEffect,useRef} from 'react';
import type {Material} from './model';
import type {Dict} from './i18n';
export function MaterialDialog({item,busy,error,onAction,onCancel,t}:{item:Material;busy:boolean;error:string;t:Dict;onAction:(action:'archive'|'delete')=>void;onCancel:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const d=ref.current!;const focus=document.activeElement as HTMLElement|null;d.showModal();d.querySelector<HTMLButtonElement>("[data-cancel]")?.focus();return()=>{d.close();focus?.focus();};},[]);
 return <dialog ref={ref} className="tm-confirm" data-bb-plugin="thread-materials" data-bb-plugin-root="thread-materials" onCancel={e=>{e.preventDefault();if(!busy)onCancel();}} onKeyDown={e=>e.stopPropagation()} aria-labelledby="tm-confirm-title" aria-describedby="tm-confirm-description">
 <h2 id="tm-confirm-title">{t.removeTitle}</h2><p className="tm-confirm-name">{item.title}</p><p id="tm-confirm-description">{t.removeText}</p>
 {error&&<p role="alert" className="tm-error">{error}</p>}
 <div className="tm-confirm-actions"><button type="button" disabled={busy} onClick={()=>onAction('archive')}>{t.toArchive}</button><button type="button" disabled={busy} className="tm-delete" onClick={()=>onAction('delete')}>{t.deleteFromList}</button><button type="button" data-cancel autoFocus disabled={busy} onClick={onCancel}>{t.cancel}</button></div>
 </dialog>;
}
