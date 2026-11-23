/** Watches the document for DOM changes without waking up on the chat stream.
    A plain MutationObserver on document.body with {subtree:true} calls back on every streamed token. Here the
    chat timeline is excluded: along the chain of ancestors of the timeline only direct child changes are watched
    (to notice a remount), every other branch of the page is watched in full, and the timeline subtree is never
    observed. With no timeline on the page the whole body is watched, as before. */
const SKIP='[data-panel-id="thread-detail-timeline-panel"]';
export function watchDocument(onChange:()=>void,signal?:AbortSignal):()=>void{
 let observer:MutationObserver|null=null;let path=new Set<Node>();let skipped=new Set<Node>();let off=false;
 const attach=()=>{
  observer?.disconnect();path=new Set();skipped=new Set<Node>(Array.from(document.querySelectorAll(SKIP)));
  for(const el of skipped)for(let n=el.parentNode;n;n=n.parentNode)path.add(n);
  observer=new MutationObserver(records=>{
   // A change among the direct children of the timeline's ancestors can move the timeline: rebuild the scope.
   if(records.some(r=>path.has(r.target))){
    const now=Array.from(document.querySelectorAll(SKIP));
    if(now.length!==skipped.size||now.some(n=>!skipped.has(n)))attach();
   }else if(skipped.size===0&&document.querySelector(SKIP))attach();
   onChange();
  });
  const walk=(node:Node)=>{
   if(skipped.has(node))return;
   if(path.has(node)){observer!.observe(node,{childList:true});for(const c of Array.from(node.childNodes))walk(c);}
   else observer!.observe(node,{childList:true,subtree:true});
  };
  walk(document);
 };
 attach();
 const stop=()=>{if(off)return;off=true;observer?.disconnect();observer=null;};
 signal?.addEventListener('abort',stop,{once:true});return stop;
}
