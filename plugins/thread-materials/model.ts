export type Material = { id: string; title: string; href: string; group: "result" | "source"; manual: boolean; storage?: boolean; hostId?: string; originThreadId?: string };
export type Agent = { id: string; title: string; status: string; threadId: string | null; summary?: string; model?:string; reasoningEffort?:string; work?:string; relation?:"child"|"peer"|"embedded" };
export function normalizeHref(value: string): string | null {
  const s=value.trim().replace(/^<|>$/g, "");
  if(!s || /[\x00-\x1f]/.test(s)) return null;
  if(/^https?:\/\//i.test(s)){try{const u=new URL(s);return u.username||u.password?null:u.href;}catch{return null;}}
  if(s.startsWith("/")&&!s.startsWith("//")&&!s.split("/").includes(".."))return s;
  return null;
}
export function isArtifact(href:string):boolean {
  let path=href.split(/[?#]/)[0].replace(/:\d+(?::\d+)?$/, "");
  try{path=decodeURIComponent(path);}catch{return false;}
  if(/(?:^|[/\\])(?:node_modules|\.git|\.codex|\.impeccable|__pycache__|coverage|test-results|playwright-report|logs?)(?:[/\\]|$)/i.test(path))return false;
  const name=path.split("/").pop()||"";
  if(/^(?:README|AGENTS|SKILL|PLAN|TICKET|CHANGELOG|LICENSE|package-lock|tsconfig|validation|test|smoke|debug)(?:[._-]|$)/i.test(name))return false;
  if(/(?:codex.*(?:history|import|rollout)|(?:history|import|rollout).*codex|verification|qa-report)/i.test(name))return false;
  if(/\.(?:pdf|docx?|xlsx?|pptx?|csv|md|html|png|jpe?g|webp|svg|mp4|mov|wav|mp3|zip)$/i.test(path))return true;
  return /^https:\/\/(?:docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/|[^/]+\.notion\.site\/)/i.test(href);
}
export function material(title:string,href:string,group:Material["group"],manual=false):Material|null{
 const safe=normalizeHref(href);if(!safe||(group==="result"&&!isArtifact(safe)))return null;
 return {id:group+":"+safe,title:title.trim().slice(0,240)||safe.split("/").pop()||safe,href:safe,group,manual};
}
export function materialKey(item:Material):string{
 const path=item.href.replace(/:\d+(?::\d+)?$/,"");
 if(/^https?:/.test(path))return "url:"+path;
 if(item.storage)return "storage:"+(item.originThreadId||"unknown")+":"+path;
 return "host:"+(item.hostId||"unknown")+":"+path;
}
export function mergeMaterials(items:Material[]):Material[]{
 const byHref=new Map<string,Material>();
 for(const item of items){if(item.group==="result"&&!isArtifact(item.href))continue;const key=materialKey(item);const previous=byHref.get(key);if(previous?.group==="result"&&item.group!=="result")continue;byHref.delete(key);byHref.set(key,{...item,id:item.group+":"+key});}
 return [...byHref.values()].reverse();
}
export function publicAgent(title:string):boolean{return !/side.chat/i.test(title);}
export function extract(rows:unknown[], options:{workspacePath?:string;child?:boolean;createdPaths?:string[]}={}):{materials:Material[];agents:Agent[]}{
 const items:Material[]=[],agents=new Map<string,Agent>(),created=new Set<string>(options.createdPaths||[]);
 const abs=(path:string)=>path.startsWith("/")?path:options.workspacePath?options.workspacePath.replace(/\/$/,"")+"/"+path:path;
 function walk(value:unknown,finalRow?:unknown){
  if(!value||typeof value!=="object")return;const r=value as Record<string,unknown>;
  if(r.kind==="turn"&&Array.isArray(r.children)){
   const last=r.status==="completed"?[...r.children].reverse().find(x=>x?.kind==="conversation"&&x?.role==="assistant"):undefined;
   r.children.forEach(x=>walk(x,last));return;
  }
  if(r.workKind==="file-change"&&r.status==="completed"){
   const c=r.change as {kind?:string;path?:string}|undefined;
   if(c?.path&&/^(?:add|create|added)$/i.test(c.kind||"")){
    const path=abs(c.path);created.add(path);
    const item=material(path.split("/").pop()||path,path,"result");if(item)items.push(item);
   }return;
  }
  if(r.workKind==="command"&&r.status==="completed"&&typeof r.command==="string"){
   for(const m of r.command.matchAll(/(?:^|\n)bb\s+thread\s+tell\s+(thr_[a-z0-9]+)/g))if(!agents.has(m[1]))agents.set(m[1],{id:m[1],title:"Совместная работа",status:"unknown",threadId:m[1],relation:"peer"});
  }
  if(r.workKind==="delegation"){
   const rawTitle=String(r.description||r.subagentType||"Субагент");if(!publicAgent(rawTitle))return;
   const title=rawTitle.includes("impeccable_finish_reviewer")?"Проверка интерфейса и плагина":rawTitle.replace(/^\/root\//,"");
   const id=String(r.childRef||r.callId||r.id);
   const messages=Array.isArray(r.childRows)?r.childRows.filter(x=>x?.kind==="conversation"&&typeof x?.text==="string"):[];
   const latestWork=messages.map(x=>(x.role==="assistant"?"### Ответ агента":"### Задача")+"\n\n"+x.text).join("\n\n");
   const work=[agents.get(id)?.work,latestWork].filter(Boolean).join("\n\n").slice(-24000);
   const finalMessage=[...messages].reverse().find(x=>x.role==="assistant");
   const summary=finalMessage?.text?.replace(/[*#`]/g,"").split("\n").find((line:string)=>line.trim()&&!line.trim().startsWith("::"))?.slice(0,140);
   const explicitModel=typeof r.model==="string"&&r.model.trim()?r.model:messages.slice().reverse().find(x=>x.role==="assistant"&&typeof x.model==="string"&&x.model.trim())?.model||agents.get(id)?.model;
   const effort=typeof r.reasoningEffort==="string"?r.reasoningEffort:agents.get(id)?.reasoningEffort;
   agents.set(id,{id,title,...(effort?{reasoningEffort:effort}:{}),...(explicitModel?{model:explicitModel}:{}),status:String(r.status||"unknown"),threadId:typeof r.childRef==="string"&&r.childRef.startsWith("thr_")?r.childRef:null,relation:"embedded",work,...(summary!==undefined?{summary}:{})});return;
  }
  if(r.kind!=="conversation")return;
  if(r.role==="user"){
   if(typeof r.senderThreadId==="string"){
    const id=r.senderThreadId;
    agents.set(id,{id,title:"Совместная работа",status:"unknown",threadId:id,relation:"peer",summary:String(r.text||"").replace(/^\[bb message[^\]]*\]\s*/,"").slice(0,160)});return;
   }
   const a=r.attachments as Record<string,unknown>|null;
   if(a){
    const details=Array.isArray(a.localFileDetails)?a.localFileDetails as {path:string;name:string}[]:[];
    for(const key of ["localFilePaths","localImagePaths","imageUrls"]){
     if(!Array.isArray(a[key]))continue;
     for(const href of a[key])if(typeof href==="string"){
      const basename=href.split("/").pop()||href;
      const title=details.find(x=>x.path===href)?.name||(/^image-\d/.test(basename)?"Изображение "+(items.filter(x=>x.group==="source").length+1):basename);
      if(!href.startsWith("/")&&!href.includes(":")&&!href.split("/").includes("..")){
       const path=href.startsWith("Attachments/")?href:"Attachments/"+href;
       items.push({id:"source:"+path,title,href:path,group:"source",manual:false,storage:true,...(typeof r.threadId==="string"?{originThreadId:r.threadId}:{})});
      }else{const item=material(title,href,"source");if(item)items.push(item);}
     }
    }
   }
   // Explicit document links supplied by the user are attached references.
   for(const m of String(r.text||"").matchAll(/\[([^\]\n]+)\]\((<[^>]+>|[^\s)]+)\)/g)){
    const href=m[2].replace(/^<|>$/g,"");if(!isArtifact(href))continue;const item=material(m[1],href,"source");if(item)items.push(item);
   }
   return;
  }
  if(r.role!=="assistant")return;
  const text=String(r.text||"").replace(/```[\s\S]*?```/g,"").replace(/`[^`]*`/g,"");
  for(const m of text.matchAll(/\[([^\]\n]+)\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)){
   const href=m[2].replace(/^<|>$/g,"");
   // Only a completed turn's final answer is an explicit handoff. Other
   // documents need a successful creation event; read/search outputs never qualify.
   // A final answer alone does not establish provenance either.
   const isFinal=value===finalRow;
   if(!created.has(href))continue;
   const item=material(m[1],href,"result");if(item)items.push(item);
  }
 }
 rows.forEach(x=>walk(x));return {materials:mergeMaterials(items),agents:[...agents.values()]};
}
