/** Give the pointer time to cross the flyout gap, without delaying real siblings. */
export function watchMenuExit(anchor:HTMLElement, close:()=>void, graceMs=320){
 const doc=anchor.ownerDocument;const menu=anchor.closest<HTMLElement>('[role="menu"]');
 let timer:ReturnType<typeof setTimeout>|undefined;let disposed=false;
 const held=new Set<number>();
 const cancel=()=>{if(timer!==undefined){clearTimeout(timer);timer=undefined;}};
 const finish=()=>{cancel();if(!disposed)close();};
 const delay=()=>{cancel();if(!held.size)timer=setTimeout(finish,graceMs);};
 const inside=(target:Node|null)=>!!target&&anchor.contains(target);
 const sibling=(target:Node|null)=>{const item=(target as Element|null)?.closest?.('[role^="menuitem"]');return !!item&&!anchor.contains(item)&&item.closest('[role="menu"]')===menu;};
 const hover=(event:Event)=>{const target=event.target as Node|null;if(inside(target)){cancel();return;}if(held.size)return;if(sibling(target))finish();else delay();};
 const focus=(event:Event)=>{if(inside(event.target as Node)){cancel();return;}if(!held.size)finish();};
 const down=(event:PointerEvent)=>{if(inside(event.target as Node)){held.add(event.pointerId);cancel();}else finish();};
 const capture=(event:PointerEvent)=>{if(inside(event.target as Node)){held.add(event.pointerId);cancel();}};
 const release=(event:PointerEvent)=>{held.delete(event.pointerId);if(held.size)return;const target=doc.elementFromPoint?.(event.clientX,event.clientY)??event.target as Node|null;if(inside(target))cancel();else if(sibling(target))finish();else delay();};
 const exit=(event:PointerEvent)=>{if(event.relatedTarget===null&&!held.size)delay();};
 // Suppress only stale native sibling highlighting while this custom flyout owns hover.
 // Do not remove Radix attributes: their own focus/hover state resumes on cleanup.
 menu?.classList.add('pc-colour-open');
 doc.addEventListener('pointerover',hover,true);doc.addEventListener('focusin',focus,true);
 doc.addEventListener('pointerdown',down,true);doc.addEventListener('pointerout',exit,true);
 doc.addEventListener('gotpointercapture',capture,true);doc.addEventListener('pointerup',release,true);doc.addEventListener('pointercancel',release,true);doc.addEventListener('lostpointercapture',release,true);
 return()=>{disposed=true;cancel();held.clear();menu?.classList.remove('pc-colour-open');doc.removeEventListener('pointerover',hover,true);doc.removeEventListener('focusin',focus,true);doc.removeEventListener('pointerdown',down,true);doc.removeEventListener('pointerout',exit,true);doc.removeEventListener('gotpointercapture',capture,true);doc.removeEventListener('pointerup',release,true);doc.removeEventListener('pointercancel',release,true);doc.removeEventListener('lostpointercapture',release,true);};
}
