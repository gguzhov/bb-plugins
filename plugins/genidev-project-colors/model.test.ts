import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createFakePluginHost} from '@get-bb/plugin-sdk/testing';
import plugin from './server';
import {decorateProjects} from './decoration';
import {FULL_WIDTH_SETTING,PALETTE,defaultColor,validColor} from './palette';
test('palette: valid, stable across Unicode forms',()=>{assert.equal(new Set(PALETTE.map(x=>x.hex)).size,8);assert(PALETTE.every(x=>validColor(x.hex)));assert.equal(defaultColor('Зимний сад'),defaultColor('Зимний сад'));assert(!validColor('red;display:none'));});
test('RPC validates, persists custom colors and explicit reset',async()=>{
 let {bb,harness}=createFakePluginHost({pluginId:'genidev-project-colors',sdk:{projects:{list:async()=>[{id:'p1',name:'Demo project'}] as any}}});
 await plugin(bb);
 const before:any=await harness.behavior.callRpc('state',null);assert.equal(before.projects[0].color,defaultColor('Demo project'));
 await harness.behavior.callRpc('set',{projectId:'p1',color:'#abcdef'});
 const after:any=await harness.behavior.callRpc('state',null);assert.equal(after.projects[0].color,'#ABCDEF');
 harness=(await harness.lifecycle.reload(plugin)).harness;
 const loaded:any=await harness.behavior.callRpc('state',null);assert.equal(loaded.projects[0].color,'#ABCDEF');
 await assert.rejects(()=>harness.behavior.callRpc('set',{projectId:'p1',color:'javascript:1'}));
 await assert.rejects(()=>harness.behavior.callRpc('set',{projectId:'missing',color:'#ffffff'}));
 await harness.behavior.callRpc('set',{projectId:'p1',color:null});
 const reset:any=await harness.behavior.callRpc('state',null);assert.equal(reset.projects[0].color,null);
 for(const color of ['#112233','#445566','#778899','#112233'])await harness.behavior.callRpc('set',{projectId:'p1',color});
 const history:any=await harness.behavior.callRpc('state',null);assert.deepEqual(history.recent,['#112233','#778899','#445566']);
 harness=(await harness.lifecycle.reload(plugin)).harness;
 const persisted:any=await harness.behavior.callRpc('state',null);assert.deepEqual(persisted.recent,history.recent);
 await harness.lifecycle.dispose();
});
test('chosenAt: saved on choice, absent for defaults and old records',async()=>{
 const {bb,harness}=createFakePluginHost({pluginId:'genidev-project-colors',sdk:{projects:{list:async()=>[{id:'p1',name:'A'},{id:'p2',name:'B'},{id:'p3',name:'C'}] as any}}});
 await plugin(bb);await bb.storage.kv.set('color:p2',{color:'#112233'});
 const s0:any=await harness.behavior.callRpc('state',null);assert.deepEqual(s0.projects.map((p:any)=>p.chosenAt),[null,null,null]);
 const t=Date.now();await harness.behavior.callRpc('set',{projectId:'p1',color:'#abcdef'});await harness.behavior.callRpc('set',{projectId:'p3',color:null});
 const s1:any=await harness.behavior.callRpc('state',null);
 assert(s1.projects[0].chosenAt>=t&&s1.projects[0].chosenAt<=Date.now());assert.equal(s1.projects[1].chosenAt,null);assert.equal(s1.projects[1].color,'#112233');assert(s1.projects[2].chosenAt>=t&&s1.projects[2].color===null);
 await harness.lifecycle.dispose();
});
test('sidebar underlines preserve empty sections and clean up on rerender',async()=>{
 const markup='<section><header><span><span>Demo project</span><button data-sidebar-rename-anchor aria-expanded="true">Collapse</button></span></header><div>No threads</div></section>';
 const dom=new JSDOM('<body><div data-sidebar-project-id="p1">'+markup+'</div></body>',{pretendToBeVisual:true});
 Object.assign(globalThis,{getComputedStyle:dom.window.getComputedStyle.bind(dom.window),document:dom.window.document,MutationObserver:dom.window.MutationObserver,CustomEvent:dom.window.CustomEvent,Event:dom.window.Event,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window)});
 const ctrl=new AbortController();const cleanup=decorateProjects(ctrl.signal);
 const send=(color:string|null='#28A99C',chosenAt:number|null=null)=>document.dispatchEvent(new CustomEvent('pc:state',{detail:[{id:'p1',name:'Demo project',color,chosenAt}]}));
 const settle=()=>new Promise(r=>setTimeout(r,45));send();await settle();send();await settle();
 assert.equal(document.querySelectorAll('.pc-project-label').length,1);
 assert.equal(document.querySelectorAll('button').length,1);
 assert.equal(document.querySelector('.pc-project-label')?.textContent,'Demo project');
 send(null);await settle();assert.equal(document.querySelectorAll('.pc-project-label').length,0);
 const header=document.querySelector<HTMLElement>('[data-sidebar-project-id]')!;header.innerHTML=markup;send();await settle();assert.equal(document.querySelectorAll('.pc-project-label').length,1);
 const label=()=>document.querySelector('[data-sidebar-project-id] span span')!;
 assert.equal(label().hasAttribute('data-pc-chosen-at'),false);
 send('#28A99C',1700000000000);await settle();assert.equal(label().getAttribute('data-pc-chosen-at'),'1700000000000');
 send(null,1700000000001);await settle();assert.equal(document.querySelectorAll('.pc-project-label').length,0);assert.equal(label().getAttribute('data-pc-chosen-at'),'1700000000001');
 send('#28A99C',1700000000002);await settle();
 ctrl.abort();cleanup();assert.equal(document.querySelectorAll('.pc-project-label').length,0);assert.equal(document.querySelectorAll('[data-pc-chosen-at]').length,0);dom.window.close();
});
test('header row gets the colour for the full-width underline and is cleaned up',async()=>{
 const header='<span class="row" style="padding-left:8px"><span class="flex"><span>Demo</span><button data-sidebar-rename-anchor aria-expanded="true">v</button></span></span>';
 const dom=new JSDOM('<body><div data-sidebar-project-id="p1"><div data-sidebar-rename-row>'+header+'<div class="mt-1">threads</div></div></div></body>',{pretendToBeVisual:true});
 Object.assign(globalThis,{getComputedStyle:dom.window.getComputedStyle.bind(dom.window),document:dom.window.document,MutationObserver:dom.window.MutationObserver,CustomEvent:dom.window.CustomEvent,Event:dom.window.Event,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window)});
 const ctrl=new AbortController();const cleanup=decorateProjects(ctrl.signal);
 const send=(color:string|null)=>document.dispatchEvent(new CustomEvent('pc:state',{detail:[{id:'p1',name:'Demo',color,chosenAt:null}]}));
 const settle=()=>new Promise(r=>setTimeout(r,45));
 const row=()=>document.querySelector<HTMLElement>('.row')!;
 send('#28A99C');await settle();
 assert(row().classList.contains('pc-project-header'));assert.equal(row().style.getPropertyValue('--pc-color'),'#28A99C');
 assert.equal(row().querySelectorAll(':scope > .pc-header-line').length,1);assert.equal(row().style.getPropertyValue('--pc-inset'),'8px');assert.equal(row().lastElementChild!.className,'pc-header-line');
 assert.equal(document.querySelectorAll('.pc-project-header').length,1);assert(!document.querySelector('.mt-1')!.classList.contains('pc-project-header'));
 send(null);await settle();assert(!row().classList.contains('pc-project-header'));
 send('#28A99C');await settle();
 document.querySelector('[data-sidebar-rename-row]')!.innerHTML=header;send('#4F8FF7');await settle();
 assert.equal(row().style.getPropertyValue('--pc-color'),'#4F8FF7');assert.equal(row().querySelectorAll('.pc-header-line').length,1);assert.equal(document.querySelectorAll('.pc-project-header').length,1);
 ctrl.abort();cleanup();assert.equal(document.querySelectorAll('.pc-project-header').length,0);assert.equal(row().style.getPropertyValue('--pc-color'),'');assert.equal(document.querySelectorAll('.pc-header-line').length,0);assert.equal(row().style.getPropertyValue('--pc-inset'),'');dom.window.close();
});
test('full-width setting is registered and off by default',async()=>{
 const {bb,harness}=createFakePluginHost({pluginId:'genidev-project-colors',sdk:{projects:{list:async()=>[] as any}}});
 await plugin(bb);const d:any=harness.registrations.settingsDescriptors[FULL_WIDTH_SETTING];
 assert.equal(d.type,'boolean');assert.equal(d.default,false);
 await harness.lifecycle.dispose();
});

import {fromHsv,hex,toHsv} from './color';
test('RGB spectrum round-trips exact colors',()=>{for(const c of ['#000000','#FFFFFF','#FF0000','#00FF00','#0000FF','#1A7BC9']){const v=toHsv(c);assert.equal(hex(fromHsv(v.h,v.s,v.v)),c);}});
import {projectSurfaces} from './project-surfaces';
test('project settings mount below heading and dispose; creation only signals intent',async()=>{
 const dom=new JSDOM('<body><main><div><section><h1>Example</h1></section><section><h2>Checkouts</h2></section></div></main><button>Add a project</button></body>',{url:'http://localhost/settings/projects/p1',pretendToBeVisual:true});
 Object.assign(globalThis,{document:dom.window.document,location:dom.window.location,MutationObserver:dom.window.MutationObserver,CustomEvent:dom.window.CustomEvent,Event:dom.window.Event,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window)});
 let surface:any,creates=0;document.addEventListener('pc:surface',(e:any)=>surface=e.detail);document.addEventListener('pc:creating',()=>creates++);
 const ctrl=new AbortController();const dispose=projectSurfaces(ctrl.signal);await new Promise(r=>setTimeout(r,35));assert.equal(surface.id,'p1');assert.equal(surface.host.previousElementSibling.querySelector('h1').textContent,'Example');assert.equal(surface.host.nextElementSibling.querySelector('h2').textContent,'Checkouts');document.querySelector('button')!.click();assert.equal(creates,1);ctrl.abort();dispose();assert.equal(document.querySelector('.pc-project-surface'),null);dom.window.close();
});
test('project menu mounts palette for the clicked project and removes it on close',async()=>{
 const dom=new JSDOM('<body><div data-sidebar-project-id="p2"><button aria-haspopup="menu">Actions</button></div></body>',{url:'http://localhost/threads/t1',pretendToBeVisual:true});
 Object.assign(globalThis,{document:dom.window.document,location:dom.window.location,MutationObserver:dom.window.MutationObserver,CustomEvent:dom.window.CustomEvent,Event:dom.window.Event,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window)});
 let surface:any;document.addEventListener('pc:surface',(e:any)=>surface=e.detail);const ctrl=new AbortController();const dispose=projectSurfaces(ctrl.signal);
 document.querySelector('button')!.dispatchEvent(new Event('pointerdown',{bubbles:true}));
 const menu=document.createElement('div');menu.setAttribute('role','menu');menu.innerHTML='<div role="menuitem">Project settings</div>';document.body.append(menu);
 await new Promise(r=>setTimeout(r,50));assert.equal(surface.id,'p2');assert.equal(surface.host.parentElement,menu);assert.equal(menu.querySelectorAll('.pc-menu-surface').length,1);
 menu.remove();await new Promise(r=>setTimeout(r,50));assert.equal(surface,null);ctrl.abort();dispose();dom.window.close();
});

import {watchMenuExit} from './menu-lifecycle';
test('Colour flyout closes for sibling hover/focus and outside clicks, not inside controls',()=>{
 const dom=new JSDOM('<body><div role="menu"><button id="filter" role="menuitem">Filter</button><div id="anchor"><button>Colour</button><div><input id="rgb"></div></div></div><div id="outside"></div></body>');
 const d=dom.window.document;let closes=0;
 const dispose=watchMenuExit(d.querySelector<HTMLElement>('#anchor')!,()=>closes++);
 d.querySelector('#rgb')!.dispatchEvent(new dom.window.Event('pointerover',{bubbles:true}));
 d.querySelector('#rgb')!.dispatchEvent(new dom.window.Event('focusin',{bubbles:true}));assert.equal(closes,0);
 for(const type of ['pointerover','focusin'])d.querySelector('#filter')!.dispatchEvent(new dom.window.Event(type,{bubbles:true}));assert.equal(closes,2);
 d.querySelector('#outside')!.dispatchEvent(new dom.window.Event('pointerdown',{bubbles:true}));assert.equal(closes,3);
 dispose();d.querySelector('#filter')!.dispatchEvent(new dom.window.Event('pointerover',{bubbles:true}));assert.equal(closes,3);dom.window.close();
});

test('Colour grace cancels on flyout entry, preserves captures and disposes timers',async()=>{
 const dom=new JSDOM('<div role="menu"><button id="filter" role="menuitem" data-highlighted>Filter</button><div id="anchor"><button>Colour</button><div id="flyout"><input id="slider"></div></div></div><div id="gap"></div>');
 const d=dom.window.document;let closes=0;const anchor=d.querySelector<HTMLElement>('#anchor')!;const stop=watchMenuExit(anchor,()=>closes++,25);
 const fire=(id:string,type:string)=>d.querySelector(id)!.dispatchEvent(new dom.window.Event(type,{bubbles:true}));
 const wait=()=>new Promise(r=>setTimeout(r,40));
 fire('#gap','pointerover');fire('#flyout','pointerover');await wait();assert.equal(closes,0);
 fire('#slider','pointerdown');fire('#gap','pointerover');await wait();assert.equal(closes,0);
 fire('#slider','pointerup');fire('#filter','pointerover');assert.equal(closes,1);
 assert(d.querySelector('[role="menu"]')!.classList.contains('pc-colour-open'));assert(d.querySelector('#filter')!.hasAttribute('data-highlighted'));
 fire('#gap','pointerover');stop();await wait();assert.equal(closes,1);assert(!d.querySelector('[role="menu"]')!.classList.contains('pc-colour-open'));dom.window.close();
});
