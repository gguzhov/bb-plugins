import test from 'node:test';
import assert from 'node:assert/strict';
import { materialKey, type Material } from './model.ts';
import * as api from './disposition.ts';
const item:Material={id:'result:host:h:/work/report.pdf',title:'Report',href:'/work/report.pdf',group:'result',manual:false,hostId:'h',originThreadId:'thr_a'};
test('archive persists the full item and restores after history disappears',()=>{
 assert.equal(typeof api.changeDisposition,'function');
 const state=api.changeDisposition({},[item],item,'archive');
 const reloaded=JSON.parse(JSON.stringify(state));
 assert.deepEqual(api.projectDispositions([],reloaded).archived,[item]);
 const restored=api.changeDisposition(reloaded,[],item,'restore');
 assert.deepEqual(api.projectDispositions([],restored).materials,[item]);
 assert.equal(api.projectDispositions([],restored).archived.length,0);
});
test('delete suppresses automatic rediscovery across reloads',()=>{
 const state=api.changeDisposition({},[item],item,'delete');
 assert.deepEqual(api.projectDispositions([item],JSON.parse(JSON.stringify(state))),{materials:[],archived:[]});
});
test('unrelated thread state and same paths on other hosts stay isolated',()=>{
 const state=api.changeDisposition({},[item],item,'archive');
 assert.equal(api.projectDispositions([item],{}).materials.length,1);
 assert.equal(api.projectDispositions([{...item,hostId:'other'}],state).materials.length,1);
 assert.equal(state[materialKey(item)].item.hostId,'h');
});
test('actions reject unknown targets and use server metadata for known targets',()=>{
 assert.throws(()=>api.changeDisposition({},[item],{...item,href:'/private/secret.pdf'},'archive'));
 const state=api.changeDisposition({},[item],{...item,title:'forged',originThreadId:'thr_other'},'archive');
 assert.equal(state[materialKey(item)].item.title,'Report');
 assert.equal(state[materialKey(item)].item.originThreadId,'thr_a');
});
test('completed status requires idle with no queued work and a completed latest turn',()=>{
 const done={kind:'turn',status:'completed',children:[{kind:'conversation',role:'assistant',text:'Done'}]};
 assert.equal(api.hasCompletedLatestTurn([done],'idle','none'),true);
 for(const rows of [[],[done,{kind:'conversation',role:'user',text:'Next'}],[done,{kind:'turn',status:'pending',children:[]}],[{...done,status:'error'}],[{...done,children:[...done.children,{kind:'conversation',role:'user',text:'Next'}]}]]) assert.equal(api.hasCompletedLatestTurn(rows,'idle','none'),false);
 assert.equal(api.hasCompletedLatestTurn([done],'active','none'),false);
 assert.equal(api.hasCompletedLatestTurn([done],'idle','pending'),false);
});

test('deleting archived records removes them from archive and restoration remains durable',()=>{
 const archived=api.changeDisposition({},[item],item,'archive');
 const deleted=api.changeDisposition(archived,[],item,'delete');
 assert.deepEqual(api.projectDispositions([item],deleted),{materials:[],archived:[]});
 const restored=api.changeDisposition(deleted,[],item,'restore');
 assert.deepEqual(api.projectDispositions([item],restored).materials,[item]);
 assert.equal(archived[materialKey(item)].action,'archive');
});
