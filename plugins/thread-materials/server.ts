import { defineRpcContract, defineCli, cliCommand, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { extract, material, materialKey, mergeMaterials, type Material } from "./model";
import { changeDisposition, projectDispositions, type Dispositions } from "./disposition";
import { SERVER_TEXT, resolveLang, type Lang } from "./i18n";
import { executorDeleteAction, visibleExecutors, AGENT_EVENT_TYPES, applyActions, applyEvents, deriveSubagents, emptyLog, ticketsFromPlans, sortExecutors, threadState, resolveModel, type Action, type AgentLog, type Executor, type PlanTicket, type ThreadEvent } from "./agents";
import { hostContract, gitChangesSchema } from "./host-contract";
import { agentName, ordinals } from "./agent-names";
import { readEventPage } from "./event-page";
const threadIdSchema=z.string().regex(/^thr_[a-z0-9]+$/);
const itemSchema=z.object({id:z.string(),title:z.string(),href:z.string(),group:z.enum(["result","source"]),manual:z.boolean(),storage:z.boolean().optional(),hostId:z.string().optional(),originThreadId:z.string().optional()});
const executorSchema=z.object({leaderModel:z.string().nullable().optional(),id:z.string(),title:z.string(),kind:z.enum(["subagent","thread"]),state:z.enum(["running","done","error","stopped"]),threadId:z.string().nullable(),model:z.string().nullable(),modelSource:z.enum(["actual","requested","inherited"]),startedAt:z.number().nullable(),endedAt:z.number().nullable(),activeSince:z.number().nullable(),durationMs:z.number().nullable(),toolUses:z.number().nullable(),tokens:z.number().nullable(),summary:z.string().nullable(),error:z.string().nullable().optional(),launchSeq:z.number().nullable().optional(),agentType:z.string().nullable(),name:z.string().optional(),ordinal:z.number().optional(),action:z.object({kind:z.string(),detail:z.string(),at:z.number()}).nullable().optional()});
const ticketSchema=z.object({code:z.string(),status:z.enum(["pending","active","review","done","error","skipped"]),accepted:z.number().optional(),criteria:z.number().optional(),startedAt:z.number().optional(),plan:z.string(),planUpdatedAt:z.number()});
const gitOutput=z.union([gitChangesSchema,z.object({kind:z.literal("no-env")})]);
const addSchema=z.object({threadId:threadIdSchema,title:z.string().trim().min(1).max(240),href:z.string().max(4096),group:z.enum(["result","source"])});
export const rpcContract=defineRpcContract({
 snapshot:{input:z.object({threadId:threadIdSchema,pages:z.number().int().min(1).max(20).default(1)}),output:z.object({materials:z.array(itemSchema),archived:z.array(itemSchema),executors:z.array(executorSchema),leaderModel:z.string().nullable(),executorsPartial:z.boolean(),tickets:z.array(ticketSchema),hasMore:z.boolean(),childrenTruncated:z.boolean(),hostId:z.string().nullable(),notice:z.string()})},
 deleteExecutor:{input:z.object({threadId:threadIdSchema,id:z.string().min(1).max(500)}),output:z.boolean()},
 thumbnail:{input:z.object({threadId:threadIdSchema,item:itemSchema}),output:z.object({dataUrl:z.string().nullable()})},
 disposition:{input:z.object({threadId:threadIdSchema,item:itemSchema,action:z.enum(["archive","delete","restore"])}),output:z.boolean()},
 git:{input:z.object({threadId:threadIdSchema}),output:gitOutput},
 /** Names of the thread's background executors by launch order (the same names the widget shows). For task-queue's card. */
 agentNames:{input:z.object({threadId:threadIdSchema}),output:z.object({agents:z.array(z.object({id:z.string(),title:z.string(),name:z.string(),ordinal:z.number(),kind:z.enum(["subagent","thread"]),state:z.enum(["running","done","error","stopped"]),model:z.string().nullable(),startedAt:z.number().nullable(),keys:z.array(z.string())}))})},
 add:{input:addSchema,output:itemSchema},remove:{input:z.object({threadId:threadIdSchema,id:z.string().max(5000)}),output:z.boolean()}
});
type MaterialIndex={materials:Material[];partial:boolean;limited:boolean};
type Page={rows:unknown[];timelinePage:{olderCursor:{anchorId:string;anchorSeq:number}|null};activeBackgroundCommands?:unknown[]};
/** Events read per page and pages per refresh; a longer history continues on the next refresh. */
const EVENT_PAGE=100,EVENT_PAGES=150;
export default function plugin(bb:BbPluginApi){
 bb.onInstall(async()=>{await bb.sdk.system.updateExperiments({threadContextCard:true});});
 /** Interface language: auto follows the page in the app and LANG here; en and ru pin it. */
 const settings=bb.settings.define({language:{type:"select",label:"Language",description:"Interface language. Auto follows the page or browser language: Russian for ru, English otherwise.",options:["auto","en","ru"],experimental_optionLabels:{auto:"Auto",en:"English",ru:"Русский"},default:"auto"}});
 const lang=async():Promise<Lang>=>{try{return resolveLang((await settings.get()).language,[process.env.LC_ALL,process.env.LANG]);}catch{return "en";}};
 const text=async()=>SERVER_TEXT[await lang()];
 /** Latest tool call of each running agent, by thread then launch id. Memory only: rebuilt from new events. */
 const actionsByThread=new Map<string,Record<string,Action>>();
 const read=async(id:string)=>(await bb.storage.kv.get<Material[]>("items:"+id))||[];
 const readDispositions=async(id:string)=>(await bb.storage.kv.get<Dispositions>("dispositions:"+id))||{};
 const readHidden=async(id:string)=>(await bb.storage.kv.get<string[]>("hidden-executors:"+id))||[];
 const readIndex=async(id:string)=>await bb.storage.kv.get<MaterialIndex>("material-index:"+id);
 const hydrating=new Map<string,Promise<{rows:unknown[];hasMore:boolean;active?:unknown[]}>>();
 const modelCache=new Map<string,{expires:number;model: {model?:string;reasoningEffort?:string}}>();
 const thumbnailCache=new Map<string,{expires:number;dataUrl:string|null}>();
 const host=bb.hosts.experimental_client({contract:hostContract});
 const gitCache=new Map<string,{expires:number;value:Promise<z.infer<typeof gitOutput>>}>();
 const agentSync=new Map<string,Promise<{log:AgentLog;partial:boolean}>>();
 /** Folds the thread's new events into its stored executor log; the log survives reloads. */
 function syncAgents(threadId:string){
  let pending=agentSync.get(threadId);
  if(pending)return pending;
  pending=(async()=>{
   const stored=await bb.storage.kv.get<AgentLog>("agent-log:"+threadId);
   // v1 logs written before leader-model tracking are re-read once from the start.
   const log=stored?.version===1&&stored.leaderModel!==undefined&&stored.msgAnchors&&stored.errAnchors?stored:emptyLog();
   const before=log.lastSeq;let partial=true;
   let pageSize=EVENT_PAGE;
   for(let page=0;page<EVENT_PAGES;page++){
    const result=await readEventPage(limit=>bb.sdk.threads.events.list({threadId,types:[...AGENT_EVENT_TYPES],afterSeq:String(log.lastSeq),limit:String(limit),order:"asc"}),pageSize);
    if(!result)break;
    const {rows,limit}=result;
    pageSize=limit;
    applyEvents(log,rows as unknown as ThreadEvent[]);
    let acts=actionsByThread.get(threadId);if(!acts){if(actionsByThread.size>=50)actionsByThread.delete(actionsByThread.keys().next().value!);acts={};actionsByThread.set(threadId,acts);}
    applyActions(acts,rows as unknown as ThreadEvent[]);
    if(rows.length<pageSize){partial=false;break;}
   }
   if(log.lastSeq!==before||!stored)await bb.storage.kv.set("agent-log:"+threadId,log);
   return {log,partial};
  })().finally(()=>agentSync.delete(threadId));
  agentSync.set(threadId,pending);return pending;
 }
 /** Tickets of the thread's task-queue plans, read only; any failure means "no plan data". */
 const planCache=new Map<string,{expires:number;value:Promise<PlanTicket[]>}>();
 function planTickets(threadId:string):Promise<PlanTicket[]>{
  const cached=planCache.get(threadId);if(cached&&cached.expires>Date.now())return cached.value;
  const value=(async()=>{
   try{
    const r=await bb.sdk.plugins.callRpc({pluginId:"task-queue",method:"plan",input:{threadId},outputSchema:z.object({plan:z.unknown().nullable()}).passthrough()});
    return ticketsFromPlans(r.plan?[r.plan]:[]);
   }catch{
    try{
     const {execFile}=await import("node:child_process");
     const out=await new Promise<string>((resolve,reject)=>execFile("bb",["task-queue","plan","show","--json","--thread",threadId],{timeout:6000,maxBuffer:2_000_000},(e,so)=>e?reject(e):resolve(so)));
     return ticketsFromPlans((JSON.parse(out) as {plans?:unknown}).plans);
    }catch{return [];}
   }
  })();
  if(planCache.size>=30)planCache.delete(planCache.keys().next().value!);
  planCache.set(threadId,{expires:Date.now()+30000,value});return value;
 }
 async function gitFor(threadId:string){
  const thread=await bb.sdk.threads.get({threadId});
  const env=thread.environmentId?await bb.sdk.environments.get({environmentId:thread.environmentId}):null;
  if(!env?.path||!env.hostId)return {kind:"no-env" as const};
  const key=env.hostId+":"+env.path,cached=gitCache.get(key);
  if(cached&&cached.expires>Date.now())return cached.value;
  const value=host.call("gitChanges",{path:env.path},{hostId:env.hostId,timeoutMs:15000}).catch(error=>({kind:"error" as const,message:error instanceof Error?error.message:String(error)}));
  if(gitCache.size>=50)gitCache.delete(gitCache.keys().next().value!);
  gitCache.set(key,{expires:Date.now()+5000,value});return value;
 }
 async function agentModel(threadId:string):Promise<{model?:string;reasoningEffort?:string}>{
  const cached=modelCache.get(threadId);if(cached&&cached.expires>Date.now())return cached.model;
  try{const execution=await bb.sdk.threads.defaultExecutionOptions({threadId});const model={...(execution?.model?{model:execution.model}:{}),...(execution?.reasoningLevel?{reasoningEffort:execution.reasoningLevel}:{})};
   if(modelCache.size>=200)modelCache.delete(modelCache.keys().next().value!);
   modelCache.set(threadId,{expires:Date.now()+30000,model});return model;
  }catch{return {};}
 }
 async function childrenOf(threadId:string){
  const [open,archived]=await Promise.all([bb.sdk.threads.list({parentThreadId:threadId,includeHidden:false,limit:200}),bb.sdk.threads.list({parentThreadId:threadId,includeHidden:false,archived:true,limit:200}).catch(()=>[])]);
  return [...open,...archived.filter(a=>!open.some(o=>o.id===a.id))].filter(x=>x.originPluginId!=="side-chat"&&!x.deletedAt);
 }
 /** Names by launch order over every executor the thread ever had (subagents from the stored log, child threads):
     the first launched is «Неон». Resuming an agent keeps its family id, so its name stays. */
 function nameExecutors<T extends {id:string;startedAt:number|null;launchSeq?:number|null}>(list:T[]):(T&{name:string;ordinal:number})[]{
  const order=ordinals(list.map(x=>({id:x.id,startedAt:x.startedAt,seq:x.launchSeq??null})));
  return list.map(x=>{const ordinal=order.get(x.id)??1;return {...x,ordinal,name:agentName(ordinal)};});
 }
 const namesCache=new Map<string,{at:number;value:Promise<{agents:{id:string;title:string;name:string;ordinal:number;kind:"subagent"|"thread";state:Executor["state"];model:string|null;startedAt:number|null;keys:string[]}[]}>}>();
 function agentNames(threadId:string){
  const hit=namesCache.get(threadId);if(hit&&Date.now()-hit.at<10000)return hit.value;
  const value=(async()=>{
   const [{log},children]=await Promise.all([syncAgents(threadId),childrenOf(threadId).catch(()=>[])]);
   const all=new Map<string,Executor>();
   for(const x of deriveSubagents(log))all.set(x.id,x);
   for(const c of children){const state=threadState(c.runtime.displayStatus);all.set(c.id,{id:c.id,title:c.title||c.titleFallback||"Дочерний тред",kind:"thread",state,threadId:c.id,model:null,modelSource:"inherited",startedAt:c.createdAt??null,endedAt:null,activeSince:null,durationMs:null,toolUses:null,tokens:null,summary:null,agentType:null});}
   all.delete(threadId);
   const runsByFamily=new Map<string,string[]>();
   for(const r of Object.values(log.runs))runsByFamily.set(r.familyId,[...(runsByFamily.get(r.familyId)??[]),r.id,r.parent]);
   const keysOf=(x:Executor)=>x.id.startsWith("agent:")?[x.id.slice(6),...(runsByFamily.get(x.id.slice(6))??[])]:x.id.startsWith("delegation:")?[x.id.slice(11)]:[x.id];
   // The model as the widget prints it («Opus 5.5»; inherited: «как у ведущего (…)»).
   return {agents:nameExecutors([...all.values()]).map(x=>({id:x.id,title:x.title,name:x.name,ordinal:x.ordinal,kind:x.kind,state:x.state,model:resolveModel(x,log.leaderModel??null)?.label??null,startedAt:x.startedAt,keys:keysOf(x)}))};
  })();
  value.catch(()=>namesCache.delete(threadId));
  if(namesCache.size>=30)namesCache.delete(namesCache.keys().next().value!);
  namesCache.set(threadId,{at:Date.now(),value});return value;
 }
 let writing=Promise.resolve();
 function write<T>(fn:()=>Promise<T>):Promise<T>{const result=writing.then(fn);writing=result.then(()=>{},()=>{});return result;}
 async function history(threadId:string,pages:number){
  const rows:unknown[]=[];let cursor:Page["timelinePage"]["olderCursor"]=null;let active:unknown[]|undefined;
  for(let i=0;i<pages;i++){
   const page=await bb.sdk.threads.timeline({threadId,segmentLimit:"100",summaryOnly:"false",deferContent:"false",includeNestedRows:"true",...(cursor?{beforeAnchorId:cursor.anchorId,beforeAnchorSeq:String(cursor.anchorSeq)}:{})}) as unknown as Page;
   if(i===0)active=page.activeBackgroundCommands;
   rows.unshift(...page.rows);cursor=page.timelinePage.olderCursor;if(!cursor)break;
  }
  return {rows,hasMore:!!cursor,active};
 }
 async function indexedHistory(threadId:string,pages:number,index:MaterialIndex|undefined|null){
  if(index)return history(threadId,pages);
  let pending=hydrating.get(threadId);
  if(!pending){pending=history(threadId,20);hydrating.set(threadId,pending);}
  try{return await pending;}catch(error){hydrating.delete(threadId);throw error;}
 }
 async function retainMaterials(threadId:string,fresh:Material[],partial:boolean,queueHeld:boolean){
  const commit=async()=>{
   const previous=await readIndex(threadId);
   const byKey=new Map((previous?.materials||[]).map(x=>[materialKey(x),x]));
   let nextImage=Math.max(0,...[...byKey.values()].map(x=>Number(/^Изображение (\d+)$/.exec(x.title)?.[1]||0)));
   const stable=fresh.slice().reverse().map(item=>{
    const existing=byKey.get(materialKey(item));
    if(!item.manual&&/^Изображение \d+$/.test(item.title)){
     if(existing)return {...item,title:existing.title};
     if(previous)return {...item,title:"Изображение "+(++nextImage)};
    }
    return item;
   });
   const merged=mergeMaterials([...(previous?.materials||[]).slice().reverse(),...stable]);
   const next:MaterialIndex={materials:merged.slice(0,1000),partial:previous?previous.partial:partial,limited:!!previous?.limited||merged.length>1000};
   if(JSON.stringify(previous)!==JSON.stringify(next))await bb.storage.kv.set("material-index:"+threadId,next);
   hydrating.delete(threadId);return next;
  };
  return queueHeld?commit():write(commit);
 }
 async function add(input:z.infer<typeof addSchema>){return write(async()=>{
  const thread=await bb.sdk.threads.get({threadId:input.threadId});
  const env=thread.environmentId?await bb.sdk.environments.get({environmentId:thread.environmentId}):null;
  const item=material(input.title,input.href,input.group,true);
  if(!item)throw new Error((await text()).notArtifact);
  item.originThreadId=input.threadId;if(env?.hostId)item.hostId=env.hostId;
  const items=await read(input.threadId);if(items.length>=200&&!items.some(x=>x.id===item.id))throw new Error((await text()).limit);
  await bb.storage.kv.set("items:"+input.threadId,[...items.filter(x=>x.id!==item.id),item]);
  const dispositions=await readDispositions(input.threadId);delete dispositions[materialKey(item)];await bb.storage.kv.set("dispositions:"+input.threadId,dispositions);
  dropSnap(input.threadId);bb.realtime.publish("changed",{threadId:input.threadId});return item;
 });}
 async function snapshot({threadId,pages}:{threadId:string;pages:number},withAgents=true,queueHeld=false){
   const thread=await bb.sdk.threads.get({threadId});
   const env=thread.environmentId?await bb.sdk.environments.get({environmentId:thread.environmentId}):null;
   const previousIndex=await readIndex(threadId);
   const listChildren=()=>childrenOf(threadId);
   const [current,children,manual,dispositions,agentLog,leader]=await Promise.all([indexedHistory(threadId,pages,previousIndex),(withAgents?listChildren():Promise.resolve([])),read(threadId),readDispositions(threadId),withAgents?syncAgents(threadId):Promise.resolve(null),withAgents?agentModel(threadId):Promise.resolve({} as {model?:string})]);
   const visibleChildren=children;
   const found=extract(current.rows,{workspacePath:env?.path||undefined,createdPaths:[...(previousIndex?.materials||[]),...manual].filter(x=>x.group==="result"&&(!x.hostId||x.hostId===env?.hostId)).map(x=>x.href)});
   const own=found.materials.map(x=>({...x,...(env?.hostId?{hostId:env.hostId}:{}),originThreadId:x.originThreadId||threadId}));
   // Background runs bb reports alive now; without that list no run is marked stale.
   const activeIds=Array.isArray(current.active)?new Set(current.active.flatMap(a=>{const r=a as Record<string,unknown>;return [r.id,r.itemId,r.familyId].filter((v):v is string=>typeof v==="string");})):undefined;
   const executors=new Map<string,Executor>();
   if(agentLog)for(const x of deriveSubagents(agentLog.log,activeIds,actionsByThread.get(threadId)))executors.set(x.id,x);
   const childModels=await Promise.all(visibleChildren.slice(0,60).map(child=>agentModel(child.id)));
   visibleChildren.forEach((x,i)=>{
    const state=threadState(x.runtime.displayStatus);
    const model=childModels[i]?.model??null;
    executors.set(x.id,{id:x.id,title:x.title||x.titleFallback||"Дочерний тред",kind:"thread",state,threadId:x.id,model,modelSource:model?"actual":"inherited",startedAt:x.createdAt??null,endedAt:state==="running"?null:(x.updatedAt??null),activeSince:null,durationMs:null,toolUses:null,tokens:null,summary:null,agentType:null});
   });
   executors.delete(threadId);
   const index=await retainMaterials(threadId,own,current.hasMore,queueHeld);
   const manualKeys=new Set(manual.map(materialKey));
   const merged=mergeMaterials([...index.materials.filter(x=>!manualKeys.has(materialKey(x))).slice().reverse(),...manual]);
   const projected=projectDispositions(merged,dispositions);
   return {hostId:env?.hostId||null,materials:projected.materials.slice(0,1000),archived:projected.archived,executors:sortExecutors(visibleExecutors(nameExecutors([...executors.values()]),await readHidden(threadId))),leaderModel:leader.model??null,executorsPartial:!!agentLog?.partial,tickets:withAgents?await planTickets(threadId):[],hasMore:index.partial,childrenTruncated:false,notice:await (async()=>{const t=await text();return [index.limited||merged.length>1000?t.indexLimited:"",index.partial?t.partialHistory:""].filter(Boolean).join(" ");})()};
 }
 /** Snapshot answers by thread: rebuilt only when the thread got a new event (its last seq moved),
     after a write here, or on a thread status change; a moving thread is rebuilt at most every SNAP_MIN_MS.
     Before: every widget poll re-read up to 100 timeline segments and re-parsed them (0.1-0.5 s a call). */
 const SNAP_MIN_MS=5000,SNAP_MAX_MS=120000;
 const snapCache=new Map<string,{at:number;seq:string|null;value:Promise<Awaited<ReturnType<typeof snapshot>>>}>();
 const dropSnap=(threadId:string)=>{for(const k of [...snapCache.keys()])if(k.startsWith(threadId+":"))snapCache.delete(k);};
 async function lastSeq(threadId:string):Promise<string|null>{
  try{const rows=await bb.sdk.threads.events.list({threadId,limit:"1",order:"desc"}) as unknown as {seq?:unknown}[];const seq=rows[0]?.seq;return seq===undefined||seq===null?null:String(seq);}catch{return null;}
 }
 async function cachedSnapshot(input:{threadId:string;pages:number}){
  const key=input.threadId+":"+input.pages,hit=snapCache.get(key),now=Date.now();
  if(hit&&now-hit.at<SNAP_MIN_MS)return hit.value;
  const seq=await lastSeq(input.threadId);
  if(hit&&seq!==null&&hit.seq===seq&&now-hit.at<SNAP_MAX_MS)return hit.value;
  const value=snapshot(input);
  value.catch(()=>{if(snapCache.get(key)?.value===value)snapCache.delete(key);});
  if(snapCache.size>=40)snapCache.delete(snapCache.keys().next().value!);
  snapCache.set(key,{at:now,seq,value});return value;
 }
 bb.rpc.register(rpcContract,{
  snapshot:input=>cachedSnapshot(input),add,
  deleteExecutor:async({threadId,id})=>{
   const current=await snapshot({threadId,pages:1});
   const executor=current.executors.find(x=>x.id===id);
   if(!executor)throw new Error("Executor no longer available");
   const action=executorDeleteAction(executor);
   if(action==="blocked")throw new Error("Executor is still running");
   if(action==="delete-thread"){
    // Authorize against live parentage, never a client-provided target or stale log.
    const child=await bb.sdk.threads.get({threadId:executor.threadId!});
    if(child.parentThreadId!==threadId||child.id===threadId)throw new Error("Not a child of this thread");
    await bb.sdk.threads.stop({threadId:child.id});
    const stopped=await bb.sdk.threads.get({threadId:child.id});
    if(threadState(stopped.runtime.displayStatus)==="running")throw new Error("Thread has not stopped yet");
    await bb.sdk.threads.delete({threadId:child.id,childThreadsConfirmed:true});
   }
   await write(async()=>{
    await bb.storage.kv.set("hidden-executors:"+threadId,[...new Set([...(await readHidden(threadId)),id])]);
    dropSnap(threadId);
   });
   bb.realtime.publish("changed",{threadId});return true;
  },
  git:({threadId})=>gitFor(threadId),
  agentNames:({threadId})=>agentNames(threadId),
  thumbnail:async({threadId,item})=>{
   // Validate the canonical record before consulting the cache or reading any bytes.
   const current=await snapshot({threadId,pages:1},false);
   const manual=await read(threadId);
   const known=[...current.materials,...current.archived,...manual].find(x=>materialKey(x)===materialKey(item));
   if(!known)throw new Error((await text()).notFound);
   const key=threadId+":"+materialKey(known),cached=thumbnailCache.get(key);
   if(cached&&cached.expires>Date.now())return {dataUrl:cached.dataUrl};
   let dataUrl:string|null=null;
   const path=known.href.replace(/:\d+(?::\d+)?$/,"");
   if(!/^https?:/i.test(path)&&/\.(?:png|jpe?g|webp)$/i.test(path))try{
    let hostId=known.hostId,absolutePath=path,rootPath:string|undefined;
    if(known.storage){
     if(path.startsWith("/")||path.includes("\\")||path.split("/").some(x=>x==="..")||/[\x00-\x1f]/.test(path))return {dataUrl:null};
     const location=await bb.sdk.threads.storageLocation({threadId:known.originThreadId||threadId});
     hostId=location.hostId;rootPath=location.storageRootPath;absolutePath=rootPath.replace(/\/$/,"")+"/"+path;
    }
    if(hostId){
     const file=await bb.sdk.files.read({hostId,path:absolutePath,...(rootPath?{rootPath}:{}),signal:AbortSignal.timeout(10000)});
     if(file.sizeBytes<=2*1024*1024&&file.contentEncoding==="base64"&&file.content.length<=Math.ceil(2*1024*1024/3)*4){
      const bytes=Buffer.from(file.content,"base64");
      const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?"image/png":bytes[0]===255&&bytes[1]===216&&bytes[2]===255?"image/jpeg":bytes.subarray(0,4).toString()==="RIFF"&&bytes.subarray(8,12).toString()==="WEBP"?"image/webp":null;
      if(mime&&bytes.length<=2*1024*1024)dataUrl="data:"+mime+";base64,"+bytes.toString("base64");
     }
    }
   }catch{/* Missing/offline images keep their file icon. */}
   // At most 16 entries (under 43 MiB of base64), each retained for 30 seconds.
   for(const [k,v] of thumbnailCache)if(v.expires<=Date.now())thumbnailCache.delete(k);
   if(thumbnailCache.size>=16)thumbnailCache.delete(thumbnailCache.keys().next().value!);
   thumbnailCache.set(key,{expires:Date.now()+30000,dataUrl});return {dataUrl};
  },
  disposition:async({threadId,item,action})=>write(async()=>{
   // Re-read canonical thread records under the same write queue as add/remove.
   const current=await snapshot({threadId,pages:1},false,true);
   const [manual,state]=await Promise.all([read(threadId),readDispositions(threadId)]);
   const next=changeDisposition(state,[...current.materials,...current.archived,...manual],item,action);
   await bb.storage.kv.set("dispositions:"+threadId,next);
   dropSnap(threadId);bb.realtime.publish("changed",{threadId});return true;
  }),
  remove:async({threadId,id})=>write(async()=>{const items=await read(threadId);await bb.storage.kv.set("items:"+threadId,items.filter(x=>x.id!==id && x.group+":"+materialKey(x)!==id));dropSnap(threadId);bb.realtime.publish("changed",{threadId});return true;})
 });
 bb.cli.register(defineCli({name:"materials",summary:"Register materials in the thread widget",commands:{
  add:cliCommand({summary:"Register a created result or user-provided source",options:{thread:{type:"string",description:"Thread ID; defaults to current thread"},title:{type:"string",required:true,description:"Document name"},href:{type:"string",required:true,description:"Absolute path or document URL"},group:{type:"enum",values:["result","source"],required:true,description:"result for created artifacts; source only for user-provided materials"}},async run(input,ctx){const item=await add(addSchema.parse({threadId:input.options.thread||ctx.threadId,title:input.options.title,href:input.options.href,group:input.options.group}));return {exitCode:0,stdout:JSON.stringify(item)};}})
 }}));
 // A finished turn or a child starting/finishing: widgets of the thread and its parent refresh (executors and git line).
 const touch=(thread:{id:string;parentThreadId?:string|null})=>{for(const key of [...gitCache.keys()])gitCache.delete(key);dropSnap(thread.id);if(thread.parentThreadId)dropSnap(thread.parentThreadId);bb.realtime.publish("changed",{threadId:thread.id});if(thread.parentThreadId)bb.realtime.publish("changed",{threadId:thread.parentThreadId});};
 bb.events.on("thread.idle",({thread})=>touch(thread));
 bb.events.on("thread.active",({thread})=>touch(thread));
 bb.events.on("thread.failed",({thread})=>touch(thread));
 bb.events.on("thread.deleted",async({thread})=>{await write(async()=>{await bb.storage.kv.delete("items:"+thread.id);await bb.storage.kv.delete("dispositions:"+thread.id);await bb.storage.kv.delete("material-index:"+thread.id);await bb.storage.kv.delete("agent-log:"+thread.id);await bb.storage.kv.delete("hidden-executors:"+thread.id);hydrating.delete(thread.id);});});
}
