import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import {defaultColor} from './palette';
const color=z.string().regex(/^#[\da-f]{6}$/i).nullable();
const selection=z.object({projectId:z.string().min(1).max(160),color});
export const rpcContract=defineRpcContract({
 state:{input:z.null(),output:z.object({recent:z.array(z.string()),projects:z.array(z.object({id:z.string(),name:z.string(),color,chosenAt:z.number().nullable()}))})},
 set:{input:selection,output:z.object({ok:z.boolean()})}
});
export default function plugin(bb:BbPluginApi){
 const state=async()=>{
  const projects=await bb.sdk.projects.list();
  return {recent:(await bb.storage.kv.get<string[]>('recent-colors'))??[],projects:await Promise.all(projects.map(async p=>{
   const saved=await bb.storage.kv.get<{color:string|null;chosenAt?:number}>('color:'+p.id);
   return {id:p.id,name:p.name,color:saved?saved.color:defaultColor(p.name),chosenAt:saved&&typeof saved.chosenAt==='number'?saved.chosenAt:null};
  }))};
 };
 const set=async(input:z.infer<typeof selection>)=>{
  const {projectId,color}=selection.parse(input);
  if(!(await bb.sdk.projects.list()).some(p=>p.id===projectId))throw new Error('Проект больше не существует');
  await bb.storage.kv.set('color:'+projectId,{color:color?.toUpperCase()??null,chosenAt:Date.now()});
  if(color){const recent=(await bb.storage.kv.get<string[]>('recent-colors'))??[];await bb.storage.kv.set('recent-colors',[color.toUpperCase(),...recent.filter(c=>c!==color.toUpperCase())].slice(0,3));}
  bb.realtime.publish('changed',{projectId});return {ok:true};
 };
 bb.rpc.register(rpcContract,{state,set});
 bb.cli.register({name:'genidev-project-colors',summary:'Цветовые метки проектов bb',commands:[{name:'list',usage:'list',summary:'Показать палитру проектов'},{name:'set',usage:'set PROJECT_ID HEX | none',summary:'Задать цвет: set PROJECT_ID HEX | none'}],async run(argv){
  const [cmd,id,value]=argv.filter(x=>x!=='--json');
  if(cmd==='list')return {exitCode:0,stdout:JSON.stringify(await state())};
  if(cmd==='set'&&id&&value){await set({projectId:id,color:value==='none'?null:value});return {exitCode:0,stdout:JSON.stringify({ok:true})};}
  return {exitCode:1,stderr:'bb genidev-project-colors list | set PROJECT_ID "#4F8FF7" | set PROJECT_ID none'};
 }});
}
