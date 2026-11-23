import test from "node:test";
import assert from "node:assert/strict";
import {extract,material,normalizeHref,isArtifact,mergeMaterials} from "./model.ts";
const message=(text:string)=>({kind:"conversation",role:"assistant",text});
const create=(path:string)=>({kind:"work",workKind:"file-change",status:"completed",change:{kind:"add",path}});
const final=(text:string)=>({kind:"turn",status:"completed",children:[message(text)]});
test("unsafe links are rejected",()=>{for(const s of ["javascript:alert(1)","data:text/html,x","//evil.com","/tmp/../secret","https://u:p@example.org","/tmp/\u0000x"])assert.equal(normalizeHref(s),null);});
test("technical generated files are excluded from results",()=>{for(const path of ["/tmp/README.md","/tmp/AGENTS.md","/tmp/app.tsx","/tmp/logs/report.md","/tmp/qa-report.html","/tmp/codex-history.md","/tmp/.impeccable/review.png"])assert.equal(isArtifact(path),false,path);assert.equal(isArtifact("/tmp/research.pdf"),true);});
test("successful creation produces a result even before final handoff",()=>{const r=extract([create("research.md")],{workspacePath:"/work"});assert.equal(r.materials[0].href,"/work/research.md");assert.equal(r.materials[0].group,"result");});
test("user attachments return as sources and preserve storage scope",()=>{const r=extract([{kind:"conversation",threadId:"thr_a",role:"user",text:"",attachments:{localImagePaths:["image-123.png"],localFilePaths:["input.xlsx"]}}]);assert.equal(r.materials.length,2);assert(r.materials.every(x=>x.group==="source"&&x.storage&&x.originThreadId==="thr_a"));});
test("read-only final links never prove creation",()=>{assert.equal(extract([final("Изучил исходный [отчёт](/tmp/existing-report.pdf). Изменений не делал.")]).materials.length,0);});
test("created working document remains a result with its readable label",()=>{const r=extract([create("research.md"),message("[Исследование](/work/research.md)")],{workspacePath:"/work"});assert.equal(r.materials.length,1);assert.equal(r.materials[0].group,"result");assert.equal(r.materials[0].title,"Исследование");});
test("known generated files may be linked without another creation event",()=>{const r=extract([final("[Расчёт](/work/calculation.xlsx)")],{createdPaths:["/work/calculation.xlsx"]});assert.equal(r.materials[0].group,"result");});
test("freshest results first",()=>{const r=extract([create("/tmp/one.pdf"),create("/tmp/two.pdf")]);assert.equal(r.materials[0].href,"/tmp/two.pdf");});
test("tool bodies and code examples do not become documents",()=>{assert.equal(extract([{kind:"work",text:"[Файл](/tmp/hidden.pdf)"},final("```md\n[Пример](/tmp/example.pdf)\n```")]).materials.length,0);assert.equal(material("Конфиг","/tmp/config.json","result",true),null);});
test("same path on different hosts does not collide",()=>{const base=material("Отчёт","/work/report.pdf","source",true)!;const r=mergeMaterials([{...base,hostId:"host_A",group:"result"},{...base,hostId:"host_B"}]);assert.equal(r.length,2);assert.notEqual(r[0].id,r[1].id);});
test("same storage path in separate threads does not collide",()=>{const base=material("Отчёт","/work/report.pdf","source",true)!;assert.equal(mergeMaterials([{...base,storage:true,originThreadId:"thr_a"},{...base,storage:true,originThreadId:"thr_b"}]).length,2);});
test("actual collaboration chats are discoverable",()=>{const r=extract([{kind:"conversation",role:"user",senderThreadId:"thr_peer",text:"[bb message from thread:thr_peer]\nРаботаю над цветами"},{kind:"work",workKind:"command",status:"completed",command:"bb thread tell thr_other 'Задача'"}]);assert.deepEqual(r.agents.map(x=>x.threadId),["thr_peer","thr_other"]);});
test("embedded reviewers remain visible with their actual work",()=>{const r=extract([{workKind:"delegation",childRef:"provider-id",description:"/root/impeccable_finish_reviewer",status:"completed",childRows:[message("Проверка завершена")]}]);assert.equal(r.agents.length,1);assert(r.agents[0].work?.includes("Проверка завершена"));assert.equal(r.agents[0].threadId,null);});
test("result wins over the same local source without cross-host collision",()=>{const base=material("Отчёт","/work/report.pdf","source",true)!;const r=mergeMaterials([{...base,hostId:"host_A"},{...base,group:"result",hostId:"host_A"}]);assert.equal(r.length,1);assert.equal(r[0].group,"result");});
test("running agents and unscoped attachments omit undefined optional fields",()=>{
 const r=extract([{workKind:"delegation",childRef:"agent-new",description:"New task",status:"running",childRows:[]},{kind:"conversation",role:"user",attachments:{localImagePaths:["image-999.png"]}}]);
 for(const item of [...r.agents,...r.materials])for(const [key,value] of Object.entries(item))assert.notEqual(value,undefined,key);
});

test("preview directives do not become agent summaries while work remains intact",()=>{const r=extract([{workKind:"delegation",childRef:"preview-agent",status:"running",childRows:[message("::browser-preview{session=\"example\"}")]}]);assert.equal(r.agents[0].summary,undefined);assert(r.agents[0].work?.includes("browser-preview"));});
