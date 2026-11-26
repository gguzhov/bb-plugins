import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { definePluginApp,useRpc,useRealtime,useBbNavigate,useSettings, experimental_usePanelTabs, experimental_useAppPanel, experimental_useFixedTabTarget, Markdown, experimental_FileLink as FileLink, experimental_FilePreview as FilePreview, experimental_InfoSection as InfoSection, experimental_InfoList as InfoList, experimental_InfoListRow as InfoListRow, UrlLink, type ExperimentalThreadActionTabProps, type ExperimentalThreadTabProps } from "@get-bb/plugin-sdk/app";
import { isPreviewPayload, previewRequest, sidecarPath, type PreviewPayload } from "./preview-target";
import type { PluginFileOpenerProps } from "@get-bb/plugin-sdk/app";
import { Icon } from "./components/ui/icon";
import type { rpcContract } from "./server";
import type { Material } from "./model";
import { explainError } from "./agent-error";
import { acceptanceLines, metaParts, resolveModel, stateLabel, summaryPreview, ticketCodes, type Executor, type PlanTicket } from "./agents";
import "./style.css";
import {MaterialIcon} from "./MaterialIcon";
import {cardChrome} from "./card-chrome";
import {MaterialDialog} from "./MaterialDialog";
import {dict, displayAgentName, resolveLang, type Dict, type Lang} from "./i18n";
import {ChatWidget, GitCommitList, type GitState} from "./widget";
import {isSectionId, type SectionId} from "./widget-state";
type Snapshot={materials:Material[];archived:Material[];executors:Executor[];leaderModel:string|null;executorsPartial:boolean;hasMore:boolean;childrenTruncated:boolean;hostId:string|null;notice:string;tickets:PlanTicket[]};
/** Interface language from the plugin's `language` setting; auto follows the page, then the browser. */
function useLang():{lang:Lang;t:Dict}{
 const settings=useSettings();
 const lang=resolveLang(settings.values?.language,[typeof document!=="undefined"?document.documentElement.lang:null,typeof navigator!=="undefined"?navigator.language:null]);
 return {lang,t:dict(lang)};
}
const forThread=(payload:unknown,threadId:string)=>{const id=payload&&typeof payload==="object"?(payload as {threadId?:unknown}).threadId:undefined;return typeof id!=="string"||id===threadId;};
/** Seconds tick only while something runs, so finished lists stay still. */
function useNow(active:boolean){const [now,setNow]=useState(()=>Date.now());useEffect(()=>{if(!active)return;const t=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(t);},[active]);return active?now:Date.now();}
function StateIcon({state}:{state:Executor["state"]}){
 return <span className={"tm-exec-icon tm-exec-"+state} aria-hidden="true">{state==="running"?<span className="tm-spinner"/>:state==="done"?<Icon name="Check"/>:state==="error"?<Icon name="CircleAlert"/>:<Icon name="CircleStop"/>}</span>;
}
/** Panel: the full list in bb's own Info-tab sections (heading, count, "N more" after 30). */
const PANEL_ROWS=30;
/** bb has no plugin API to jump to a message; the timeline itself follows a `#msg=<seq>` hash (checked live). */
function showInChat(seq:number){const hash="msg="+seq;if(location.hash==="#"+hash)history.replaceState(history.state,"",location.pathname+location.search);location.hash=hash;}
const execTitle=(x:Executor,t:Dict)=>x.title==="Субагент"?t.subagent:x.title==="Дочерний тред"?t.childThread:ticketCodes(x.title).name;
function PanelAgentRow({x,leaderModel,now,tickets,lang,t}:{x:Executor;leaderModel:string|null;now:number;tickets:PlanTicket[];lang:Lang;t:Dict}){
 const navigate=useBbNavigate();const [open,setOpen]=useState(false),[full,setFull]=useState(false);const mark=useRef<HTMLSpanElement>(null);
 const name=execTitle(x,t);const model=resolveModel(x,leaderModel,lang);const agent=displayAgentName(x.name,x.ordinal,lang);
 const reason=x.state==="error"?explainError(x.error,lang):null;
 const ctx=[model?.label,...metaParts(x,now,lang),reason?.text].filter(Boolean).join(" · ");
 const title=(agent?agent+" — ":"")+name+" — "+stateLabel(x.state,lang)+(model?.hint?" · "+model.hint:"");
 /** The native row is a button without aria-expanded: set it on that button. */
 useEffect(()=>{mark.current?.closest("li")?.querySelector("button")?.setAttribute("aria-expanded",String(open));},[open]);
 const preview=x.summary?summaryPreview(x.summary):null,accept=acceptanceLines(x.title,tickets,x.startedAt,lang);
 const started=x.startedAt?new Date(x.startedAt).toLocaleTimeString(lang==="ru"?"ru-RU":"en-US",{hour:"2-digit",minute:"2-digit"}):null;
 return <>
  <InfoListRow leading={<StateIcon state={x.state}/>} leadingLabel={stateLabel(x.state,lang)} name={<><span ref={mark} className="tm-mark"/>{agent&&<span className="tm-agent-name">{agent}</span>}{name}</>} title={title} context={ctx} onSelect={()=>setOpen(v=>!v)}/>
  {open&&<li className="tm-p-expand">
   {reason&&<div className="tm-ex-sec"><span className="tm-ex-h">{t.errReason}</span><p className="tm-ex-text tm-ex-err" data-testid="tm-panel-reason">{reason.text}</p>{reason.full&&<p className="tm-ex-text tm-ex-none">{reason.full}</p>}</div>}
   <div className="tm-ex-sec"><span className="tm-ex-h">{t.whatWasDone}</span>{preview?<><p className="tm-ex-text">{full?x.summary:preview.head}</p>{preview.truncated&&<button type="button" className="tm-textact" aria-expanded={full} onClick={()=>setFull(v=>!v)}>{full?t.collapse:t.showFull}</button>}</>:<p className="tm-ex-text tm-ex-none">{t.noSummary}</p>}</div>
   {accept.length>0&&<div className="tm-ex-sec"><span className="tm-ex-h">{t.acceptance}</span>{accept.map(l=><p key={l} className="tm-ex-text">{l}</p>)}</div>}
   <div className="tm-ex-go">{x.threadId?<button type="button" className="tm-textact" onClick={()=>navigate.toThread(x.threadId!)}>{t.openThread}</button>:x.launchSeq!=null?<button type="button" className="tm-textact" onClick={()=>showInChat(x.launchSeq!)}>{t.showInChat}</button>:started?<span className="tm-ex-text">{t.startedAt(started)}</span>:null}</div>
  </li>}
 </>;
}
function PanelExecutors({data,lang,t}:{data:Snapshot|null;lang:Lang;t:Dict}){
 const list=data?.executors||[];const running=list.filter(x=>x.state==="running");
 const now=useNow(running.length>0);
 const all=[...running,...list.filter(x=>x.state!=="running")];
 return <InfoSection label={t.executors} count={list.length||undefined} accessory={running.length>0?<span className="tm-running">{running.length+" "+t.running}</span>:undefined}>
  {!data?<p className="tm-empty" role="status">{t.loading}</p>:!list.length?<p className="tm-empty">{t.emptyExecutors}</p>:<InfoList items={all} limit={PANEL_ROWS} getKey={x=>x.id} renderItem={x=><PanelAgentRow x={x} leaderModel={data.leaderModel} now={now} tickets={data.tickets} lang={lang} t={t}/>}/>}
  {data?.executorsPartial&&<p className="tm-empty">{t.partial}</p>}
 </InfoSection>;
}
/** Last answers per thread for the page's lifetime: a widget that bb mounts again (the right panel closed)
    shows them at once and asks the server only when they are older than the poll period. */
const snapMemo=new Map<string,{at:number;data:unknown}>(),gitMemo=new Map<string,{at:number;data:unknown}>();
const sameJson=(a:unknown,b:unknown)=>a===b||JSON.stringify(a)===JSON.stringify(b);
/** bb--git's own "Changes" row in the thread context card. */
const GIT_ROW='[data-bb-plugin="bb--git"] button[data-thread-context-card-row]';
/** Git numbers for the thread's working folder: polled every 25 s while visible, and on this thread's signals. */
function useGit(threadId:string,visibleRef:{current:boolean}):GitState{
 const rpc=useRpc<typeof rpcContract>();const [git,setGit]=useState<GitState>(()=>(gitMemo.get(threadId)?.data as GitState)??null);
 const busy=useRef(false),stale=useRef(false);
 const load=useCallback(async()=>{if(busy.current)return;busy.current=true;try{const next=await rpc.call("git",{threadId}) as GitState;gitMemo.set(threadId,{at:Date.now(),data:next});setGit(prev=>sameJson(prev,next)?prev:next);}catch(e){setGit({kind:"error",message:e instanceof Error?e.message:String(e)});}finally{busy.current=false;}},[rpc,threadId]);
 useEffect(()=>{const m=gitMemo.get(threadId);setGit((m?.data as GitState)??null);if(visibleRef.current&&(!m||Date.now()-m.at>25000))void load();else if(!visibleRef.current)stale.current=true;const t=setInterval(()=>{if(!document.hidden&&visibleRef.current)void load();},25000);return()=>clearInterval(t);},[load]);
 // Signals for this thread only; while hidden, remember and reread when it shows.

 useRealtime("changed",payload=>{if(!forThread(payload,threadId))return;if(visibleRef.current)void load();else stale.current=true;});
 const visibleNow=visibleRef.current;
 useEffect(()=>{if(visibleNow&&stale.current){stale.current=false;void load();}},[visibleNow,load]);
 return git;
}
/** bb's Diff tab belongs to bb--git and the SDK cannot open another plugin's tab: select it when open, otherwise run bb--git's own card row. */
function useOpenChanges(){
 const panel=experimental_useAppPanel(),tabs=experimental_usePanelTabs();
 return (from:Element|null)=>{
  const open=tabs.tabs.find(t=>t.detail.kind==="plugin"&&t.detail.pluginId==="bb--git");
  if(open&&panel.selectTab(open.key))return;
  const card=from?.closest("[data-thread-context-card]")??document;
  card.querySelector<HTMLButtonElement>(GIT_ROW)?.click();
 };
}
/** The panel's git row (bb's Info-list row look). */
function GitLine({git,t}:{git:GitState;t:Dict}){
 const self=useRef<HTMLUListElement>(null);const openChanges=useOpenChanges();
 const plain=(text:string,title?:string)=><ul className="tm-ul"><InfoListRow leading={<Icon name="GitBranch" aria-hidden/>} name={<span className="tm-git-muted">{text}</span>} title={title}/></ul>;
 if(!git)return plain(t.gitLoading);if(git.kind==="not-git")return plain(t.notGit);if(git.kind==="no-env")return plain(t.noEnv);if(git.kind==="error")return plain(t.gitError,git.message);
 const ge=git.truncated?"≥":"";const clean=git.files===0&&git.unpushedCommits===0;
 const hint=t.gitHint({added:git.uncommitted.added,removed:git.uncommitted.removed,commits:git.unpushedCommits,base:git.base,baseRef:git.baseRef,truncated:git.truncated});
 return <ul ref={self} className="tm-ul"><InfoListRow leading={<Icon name="GitBranch" aria-hidden/>} name={git.branch} title={hint+" · "+t.openChanges} trailing={clean?<span className="tm-git-muted">{t.noChanges}</span>:<span className="tm-git-stats"><span className="tm-git-add">{ge}+{git.added}</span><span className="tm-git-del">{ge}−{git.removed}</span><span className="tm-git-muted">{ge}{t.files(git.files)}</span></span>} onSelect={()=>openChanges(self.current)}/></ul>;
}
const tab={id:"materials",context:{kind:"thread" as const},availability:"fixed" as const,experimental_target:{validate:isSectionId}};
const previewTab={id:"file-preview",context:{kind:"thread" as const},availability:"fixed" as const,experimental_target:{validate:isPreviewPayload}};
function PreviewBody({path,content,url}:{path:string;content:string;url:string}){
 const ext=path.split(".").pop()?.toLowerCase()||"";
 if(ext==="md"||ext==="markdown")return <div className="tm-preview-doc"><Markdown content={content}/></div>;
 if(ext==="html"||ext==="htm")return <iframe className="tm-preview-frame" title={path} src={url} sandbox="allow-same-origin"/>;
 return <pre className="tm-preview-raw">{content}</pre>;
}
function FilePreviewTab(){
 const state=experimental_useFixedTabTarget<PreviewPayload>(previewTab);const {t}=useLang();
 if(!state)return <div className="tm-panel" data-bb-plugin="thread-materials" data-bb-plugin-root="thread-materials"><p className="tm-empty">{t.pickFile}</p></div>;
 return <div className="tm-file-preview" data-bb-plugin="thread-materials" data-bb-plugin-root="thread-materials"><FilePreview target={state.target.target} renderPreview={file=><PreviewBody path={state.target.target.path} content={file.content} url={file.url}/>}/></div>;
}
function SidecarFile({path,source,Original}:PluginFileOpenerProps){
 const {t}=useLang();
 const sibling=sidecarPath(path);
 const target=sibling&&source.kind==="workspace"&&source.environmentId?{kind:"workspace" as const,environmentId:source.environmentId,path:sibling}:sibling&&source.kind==="thread-storage"&&source.threadId?{kind:"thread-storage" as const,threadId:source.threadId,path:sibling}:sibling&&source.kind==="host"&&source.experimental_hostId&&sibling.startsWith("/")?{kind:"host" as const,hostId:source.experimental_hostId,path:sibling}:null;
 if(!sibling||!target)return <Original/>;
 const name=sibling.split("/").pop()||sibling;
 return <div className="tm-file-preview" data-bb-plugin="thread-materials" data-bb-plugin-root="thread-materials"><p className="tm-sidecar-note">{t.sidecar(name)}</p><FilePreview target={target} renderPreview={file=><PreviewBody path={sibling} content={file.content} url={file.url}/>}/></div>;
}
/** Opens a material the way its link does: the preview tab, bb's file preview, or the browser for a URL. */
function useOpenMaterial(threadId:string,hostId:string|null){
 const panel=experimental_useAppPanel(),navigate=useBbNavigate();
 return (item:Material)=>{
  if(/^https?:\/\//i.test(item.href)){window.open(item.href,"_blank","noopener,noreferrer");return;}
  const file=previewRequest(item,threadId,hostId);if(!file)return;
  if(!panel.openTab({tab:previewTab,target:file}))navigate.experimental_openFilePreview({target:file.target,location:file.location});
 };
}
function MaterialLink({item,threadId,hostId,t,bare=false}:{item:Material;threadId:string;hostId:string|null;t:Dict;bare?:boolean}){
 const openMaterial=useOpenMaterial(threadId,hostId);
 const request=previewRequest(item,threadId,hostId);
 const icon=bare?null:<MaterialIcon href={item.href} item={item} threadId={threadId}/>,name=<span className="tm-file-name">{item.title}</span>;
 if(/^https?:\/\//i.test(item.href))return <UrlLink className="tm-file" href={item.href} title={item.title}>{icon}{name}</UrlLink>;
 if(!request)return <span className="tm-file" title={t.noEnvironment}>{icon}{name}</span>;
 const file=request;
 function open(event:MouseEvent<HTMLAnchorElement>){
  if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();openMaterial(item);
 }
 return <FileLink className="tm-file" target={file.target} location={file.location} title={item.title} aria-label={t.previewAria(item.title)} onClick={open}>{icon}{name}</FileLink>;
}
function Materials({threadId,environment,widget=false,archiveOnly=false}:ExperimentalThreadTabProps & {widget?:boolean;archiveOnly?:boolean}){
 const rpc=useRpc<typeof rpcContract>(),navigate=useBbNavigate(),panel=experimental_useAppPanel();const {lang,t}=useLang();
 const panelState=experimental_usePanelTabs(); const visibleRef=useRef(true);
 const sectionTarget=experimental_useFixedTabTarget<SectionId>(tab);
 visibleRef.current=widget ? !panelState.open : panelState.open && panelState.tabs.some(t=>t.key===panelState.selectedKey && t.detail.kind==="plugin" && t.detail.pluginId==="thread-materials");
 const [data,setData]=useState<Snapshot|null>(()=>(snapMemo.get(threadId+":1")?.data as Snapshot|undefined)??null),[error,setError]=useState(""),[pages,setPages]=useState(1),[busy,setBusy]=useState(false);
 const [removing,setRemoving]=useState<Material|null>(null),[actionBusy,setActionBusy]=useState(false),[actionError,setActionError]=useState("");

 const openArchive=()=>{panel.openTab({tab:{id:"archive",context:{kind:"thread"},availability:"action"},title:t.archive});};
 const deletedExecutors=useRef(new Set<string>());
 const generation=useRef(0),inflight=useRef(false),stale=useRef(false);
 const load=useCallback(async()=>{
  if(inflight.current)return; inflight.current=true; const g=generation.current; setBusy(true);
  try{const next=await rpc.call("snapshot",{threadId,pages});snapMemo.set(threadId+":"+pages,{at:Date.now(),data:next});if(g===generation.current){setData(prev=>{const filtered={...next,executors:next.executors.filter(x=>!deletedExecutors.current.has(x.id))};return sameJson(prev,filtered)?prev:filtered;});setError("");}}
  catch(e){if(g===generation.current)setError(e instanceof Error?e.message:String(e));}
  finally{if(g===generation.current){inflight.current=false;setBusy(false);}}
 },[rpc,threadId,pages]);
 // Every 10 s while visible; every 4 s in the widget while an executor runs, so its current action stays fresh.
 const live=widget&&!!data?.executors.some(x=>x.state==="running");
 useEffect(()=>{generation.current++;inflight.current=false;const m=snapMemo.get(threadId+":"+pages);setData((m?.data as Snapshot|undefined)??null);if(visibleRef.current&&(!m||Date.now()-m.at>10000))void load();else if(!visibleRef.current)stale.current=true;return()=>{generation.current++;};},[load]);
 useEffect(()=>{const timer=setInterval(()=>{if(!document.hidden && visibleRef.current)void load();},live?4000:10000);return()=>clearInterval(timer);},[load,live]);
 useEffect(()=>{setPages(1);setRemoving(null);setActionError("");},[threadId]);

 // Signals for this thread only (bb publishes them for every thread's turn); hidden: reread when shown.
 useRealtime("changed",payload=>{if(!forThread(payload,threadId))return;if(visibleRef.current)void load();else stale.current=true;});
 const visibleNow=visibleRef.current;
 useEffect(()=>{if(visibleNow&&stale.current){stale.current=false;void load();}},[visibleNow,load]);
 const git=useGit(threadId,visibleRef);const openMaterial=useOpenMaterial(threadId,data?.hostId??null);
 const archivedRows=(entries:Material[])=>!entries.length?<p className="tm-empty">{t.archiveEmpty}</p>:<ul className="tm-wlist">{entries.map(item=><li key={item.id}>
  <MaterialLink item={item} threadId={threadId} hostId={data?.hostId??null} t={t}/>
  <button type="button" className="tm-textact" disabled={actionBusy} onClick={async()=>{
   setActionBusy(true);
   try{await rpc.call("disposition",{threadId,item,action:"restore"});await load();}
   catch(e){setError(e instanceof Error?e.message:String(e));}
   finally{setActionBusy(false);}
  }}>{t.restore}</button>
 </li>)}</ul>;
 function panelList(group:Material["group"]){
  const entries=data?.materials.filter(x=>x.group===group)||[],name=group==="result"?t.results:t.sources;
  const archived=data?.archived?.length||0,archiveLabel=t.archiveCount(archived);
  const archive=group==="result"?<button type="button" className="tm-textact" title={archiveLabel} onClick={openArchive}>{archiveLabel}</button>:undefined;
  return <InfoSection label={name} count={entries.length||undefined} trailing={archive}>
   {!data?<p className="tm-empty" role="status">{t.loading}</p>:!entries.length?<p className="tm-empty">{group==="result"?t.emptyResults:t.emptySources}</p>:<InfoList items={entries} limit={PANEL_ROWS} getKey={item=>item.id} renderItem={item=><InfoListRow leading={<MaterialIcon compact href={item.href} item={item} threadId={threadId}/>} name={<MaterialLink item={item} threadId={threadId} hostId={data.hostId} t={t} bare/>} trailing={(!item.originThreadId||item.originThreadId===threadId)?<button type="button" className="tm-act tm-row-act" aria-label={t.removeAria(item.title)} title={t.remove} onClick={()=>{setActionError("");setRemoving(item);}}><Icon name="X"/></button>:undefined}/>}/>}
  </InfoSection>;
 }
 const native=!widget&&!archiveOnly;
 const rootRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!native||!visibleNow||!sectionTarget)return;
  const frame=requestAnimationFrame(()=>rootRef.current?.querySelector('[data-tm-section="'+sectionTarget.target+'"]')?.scrollIntoView({block:"start"}));
  return ()=>cancelAnimationFrame(frame);
 },[native,visibleNow,sectionTarget,!!data]);
 if(widget && panelState.open) return null;
 const errorBox=error?<div role="alert" className="tm-error">{t.updateFailed}{error}<button onClick={()=>void load()}>{t.retry}</button></div>:null;
 return <div ref={rootRef} lang={lang} data-bb-plugin="thread-materials" data-bb-plugin-root="thread-materials" className={widget?"tm-panel tm-widget":native?"tm-info":"tm-panel"}>
 {!widget&&errorBox}
 {native&&<>
 <div data-tm-section="git">
  <GitLine git={git} t={t}/>
  {git?.kind==="ok"&&<GitCommitList commits={git.recentCommits} t={t}/>}
 </div>
 <div data-tm-section="result">{panelList("result")}</div>
 <div data-tm-section="agents"><PanelExecutors data={data} lang={lang} t={t}/></div>
 <div data-tm-section="source">{panelList("source")}</div>
 </>}
 {widget&&<ChatWidget threadId={threadId} data={data} git={git} lang={lang} t={t} visible={visibleNow} error={errorBox}
  openAll={section=>{panel.openTab({tab,target:section});}} openThread={id=>navigate.toThread(id)} showInChat={showInChat}
  onDeleteExecutor={async id=>{await rpc.call("deleteExecutor",{threadId,id});deletedExecutors.current.add(id);for(const key of snapMemo.keys())if(key.startsWith(threadId+":"))snapMemo.delete(key);setData(prev=>prev?{...prev,executors:prev.executors.filter(x=>x.id!==id)}:prev);await load();}}
  openMaterial={openMaterial} onRemove={item=>{setActionError("");setRemoving(item);}} renderLink={item=><MaterialLink item={item} threadId={threadId} hostId={data?.hostId??null} t={t}/>}/>}
 {archiveOnly&&<section className="tm-archive"><h2>{t.archive}</h2>{archivedRows(data?.archived??[])}</section>}

 {removing&&<MaterialDialog t={t} item={removing} busy={actionBusy} error={actionError} onCancel={()=>setRemoving(null)} onAction={async action=>{setActionBusy(true);setActionError("");try{await rpc.call("disposition",{threadId,item:removing,action});setRemoving(null);await load();}catch(e){setActionError(e instanceof Error?e.message:String(e));}finally{setActionBusy(false);}}}/>}
 {!widget&&data?.notice&&<p className="tm-empty" role="status">{data.notice}</p>}
 {!widget&&data?.hasMore&&<div className="tm-history"><p>{t.olderMaybe}</p>{pages<20?<button disabled={busy} onClick={()=>setPages(p=>Math.min(p+2,20))}>{t.loadOlder}</button>:<p>{t.historyLimit}</p>}</div>}
 </div>;
}
function AgentWork({threadId,params}:ExperimentalThreadActionTabProps){
 const rpc=useRpc<typeof rpcContract>();const {lang,t}=useLang();
 const [agent,setAgent]=useState<Executor|null>(null),[error,setError]=useState("");
 const id=params&&typeof params==="object"&&!Array.isArray(params)&&typeof params.agentId==="string"?params.agentId:null;
 useEffect(()=>{let cancelled=false;setAgent(null);setError("");if(!id){setError(t.agentNotChosen);return;}rpc.call("snapshot",{threadId,pages:1}).then(r=>{if(cancelled)return;const a=r.executors.find(x=>x.id===id);if(a)setAgent(a);else setError(t.agentNotFound);},e=>{if(!cancelled)setError(String(e));});return()=>{cancelled=true;};},[rpc,threadId,id,t]);
 return <div className="tm-panel tm-work" data-bb-plugin="thread-materials" data-bb-plugin-root="thread-materials">{error?<p role="alert">{error}</p>:agent?<><h2>{agent.title}</h2><p className="tm-summary">{stateLabel(agent.state,lang)}</p>{agent.summary?<Markdown content={agent.summary}/>:<p className="tm-empty">{t.summaryPending}</p>}</>:<p role="status">{t.loading}</p>}</div>;
}
export default definePluginApp(app=>{
 // Tab titles are fixed strings at registration: they follow the page or browser language (the setting is not readable here).
 const boot=dict(resolveLang("auto",[document.documentElement.lang,navigator.language]));
 app.contentScripts.register({id:"card-chrome",mount:({signal})=>cardChrome(signal)});
 app.slots.experimental_tab({id:"archive",context:{kind:"thread"},availability:"action",title:boot.archive,icon:"Files",layout:"flush",component:props=><Materials {...props} archiveOnly/>});
 app.slots.experimental_tab({...tab,title:"Chat widget",icon:"MessageSquare",layout:"flush",component:Materials});
 app.slots.experimental_tab({...previewTab,title:boot.previewTab,icon:"FileText",layout:"flush",component:FilePreviewTab,useVisible:()=>experimental_useFixedTabTarget(previewTab)!==null});
 app.slots.fileOpener({id:"sidecar-preview",title:boot.previewTab,extensions:["json","jsonc"],component:SidecarFile});
 app.slots.experimental_tab({id:"agent-work",context:{kind:"thread"},availability:"action",title:boot.agentWork,icon:"Workflow",layout:"flush",component:AgentWork});
 app.slots.experimental_threadContextCardRow({id:"materials-widget",group:"zz_materials",order:0,component:props=><Materials {...props} widget/>});
});
