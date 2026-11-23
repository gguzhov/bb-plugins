import test from 'node:test';
import assert from 'node:assert/strict';
import {createFakePluginHost} from '@get-bb/plugin-sdk/testing';
import plugin from './server';
import {canOpen} from './contract';
import {STRINGS,resolveLanguage,hostErrorText,HOST_ERRORS} from './strings';
const env={hostId:'hostA',path:'/Users/test/project',status:'ready'};
test('canOpen needs darwin, ready status, absolute path and a host',()=>{
 assert(canOpen(env,'darwin'));assert(!canOpen(env,'linux'));assert(!canOpen(env,'win32'));assert(!canOpen(env,null));
 assert(!canOpen({...env,status:'creating'},'darwin'));assert(!canOpen({...env,path:'relative'},'darwin'));assert(!canOpen({...env,path:null},'darwin'));assert(!canOpen({...env,hostId:null},'darwin'));
});
function setup(platformOf:(hostId:string)=>string|Error,e:any=env,settings:Record<string,string>={},openError?:Error){
 const calls:any[]=[];
 const made=createFakePluginHost({pluginId:'directory-finder',settings,sdk:{environments:{get:async()=>e as any}},experimental_callHostRpc:async (args:any)=>{calls.push(args);if(args.method==='platform'){const p=platformOf(args.hostId);if(p instanceof Error)throw p;return {platform:p};}if(args.method==='open'&&openError)throw openError;return {ok:true};}});
 plugin(made.bb);return {...made,calls};
}
test('darwin host: control shows, open is sent to that host with the path as-is',async()=>{
 const e={...env,path:'/Users/test/Folder with spaces'};const {harness,calls}=setup(()=>'darwin',e);
 assert.equal((await harness.behavior.callRpc('info',{environmentId:'e'}) as any).supported,true);
 await harness.behavior.callRpc('open',{environmentId:'e'});
 const open=calls.filter(c=>c.method==='open');assert.equal(open.length,1);assert.equal(open[0].hostId,'hostA');assert.equal(open[0].input.path,e.path);await harness.lifecycle.dispose();
});
test('linux host: control hidden and open is refused without dispatch',async()=>{
 const {harness,calls}=setup(()=>'linux');
 assert.equal((await harness.behavior.callRpc('info',{environmentId:'e'}) as any).supported,false);
 await assert.rejects(()=>harness.behavior.callRpc('open',{environmentId:'e'}));assert.equal(calls.filter(c=>c.method==='open').length,0);await harness.lifecycle.dispose();
});
test('platform lookup failure: control hidden and open refused',async()=>{
 const {harness,calls}=setup(()=>new Error('host offline'));
 assert.equal((await harness.behavior.callRpc('info',{environmentId:'e'}) as any).supported,false);
 await assert.rejects(()=>harness.behavior.callRpc('open',{environmentId:'e'}));assert.equal(calls.filter(c=>c.method==='open').length,0);await harness.lifecycle.dispose();
});
test('platform is cached per host, failures are not cached; unready env skips lookup',async()=>{
 let fail=true;const a=setup(()=>fail?new Error('x'):'darwin');
 assert.equal((await a.harness.behavior.callRpc('info',{environmentId:'e'}) as any).supported,false);fail=false;
 assert.equal((await a.harness.behavior.callRpc('info',{environmentId:'e'}) as any).supported,true);
 await a.harness.behavior.callRpc('info',{environmentId:'e'});assert.equal(a.calls.filter(c=>c.method==='platform').length,2);await a.harness.lifecycle.dispose();
 const b=setup(()=>'darwin',{...env,status:'creating'});assert.equal((await b.harness.behavior.callRpc('info',{environmentId:'e'}) as any).supported,false);assert.equal(b.calls.length,0);await b.harness.lifecycle.dispose();
});

test('resolveLanguage: explicit setting wins, auto follows the page language',()=>{
 assert.equal(resolveLanguage('ru','en-US'),'ru');assert.equal(resolveLanguage('en','ru-RU'),'en');
 assert.equal(resolveLanguage('auto','ru-RU'),'ru');assert.equal(resolveLanguage('auto','RU'),'ru');assert.equal(resolveLanguage('auto','en-GB'),'en');assert.equal(resolveLanguage('auto','en','ru-RU'),'ru');assert.equal(resolveLanguage('auto','ru','en-US'),'ru');assert.equal(resolveLanguage('auto','en','en-US'),'en');assert.equal(resolveLanguage('auto',''),'en');assert.equal(resolveLanguage(undefined,undefined),'en');
});
test('both languages define every string',()=>{
 assert.deepEqual(Object.keys(STRINGS.en).sort(),Object.keys(STRINGS.ru).sort());
 for(const k of Object.keys(STRINGS.en) as (keyof typeof STRINGS.en)[]){for(const l of ['en','ru'] as const){const v=STRINGS[l][k];assert((typeof v==='function'?v('/x'):v).length>0);}}
 assert(STRINGS.en.openTitle('/a').includes('/a')&&STRINGS.ru.openTitle('/a').includes('/a'));
 assert(!/[а-яё]/i.test(Object.values(STRINGS.en).map(v=>typeof v==='function'?v('/x'):v).join(' ')),'English strings contain no Cyrillic');
});
test('info reports the language setting, default auto',async()=>{
 const a=setup(()=>'darwin');assert.equal((await a.harness.behavior.callRpc('info',{environmentId:'e'}) as any).language,'auto');await a.harness.lifecycle.dispose();
 const b=setup(()=>'darwin',env,{language:'ru'});assert.equal((await b.harness.behavior.callRpc('info',{environmentId:'e'}) as any).language,'ru');await b.harness.lifecycle.dispose();
});
test('refusal text follows the setting; auto follows the language the page sent',async()=>{
 const msg=async(settings:Record<string,string>,language?:string)=>{const m=setup(()=>'linux',env,settings);try{await m.harness.behavior.callRpc('open',{environmentId:'e',language});assert.fail('should refuse');}catch(e:any){await m.harness.lifecycle.dispose();return String(e.message);}};
 assert((await msg({language:'ru'},'en')).includes(STRINGS.ru.unsupported));
 assert((await msg({language:'en'},'ru')).includes(STRINGS.en.unsupported));
 assert((await msg({},'ru')).includes(STRINGS.ru.unsupported));
 assert((await msg({},'en')).includes(STRINGS.en.unsupported));
 assert((await msg({})).includes(STRINGS.en.unsupported));
});
test('host errors are translated in both languages',async()=>{
 assert.equal(hostErrorText(new Error(HOST_ERRORS.notFound),'ru'),STRINGS.ru.notFound);assert.equal(hostErrorText(new Error(HOST_ERRORS.notFound),'en'),STRINGS.en.notFound);
 assert.equal(hostErrorText(new Error(HOST_ERRORS.onlyMac),'en'),STRINGS.en.onlyMac);assert.equal(hostErrorText(new Error('boom'),'ru'),STRINGS.ru.failed);
 const m=setup(()=>'darwin',env,{language:'ru'},new Error(HOST_ERRORS.notFound));
 await assert.rejects(()=>m.harness.behavior.callRpc('open',{environmentId:'e'}),(e:any)=>String(e.message).includes(STRINGS.ru.notFound));await m.harness.lifecycle.dispose();
});
