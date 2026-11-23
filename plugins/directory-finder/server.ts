import type {BbPluginApi} from '@get-bb/plugin-sdk';
import {hostContract,rpcContract,canOpen} from './contract';
import {STRINGS,hostErrorText,resolveLanguage,type LanguageSetting} from './strings';
export default function plugin(bb:BbPluginApi){
 const settings=bb.settings.define({language:{type:'select',label:'Language',description:'Language of the Finder button and its messages. Auto follows the page language: Russian for ru, English otherwise.',options:['auto','en','ru'],experimental_optionLabels:{auto:'Auto',en:'English',ru:'Русский'},default:'auto'}});
 const client=bb.hosts.experimental_client({contract:hostContract});
 const platforms=new Map<string,string>();
 // Platform of the machine that hosts the environment, asked from that machine and cached per host. Failures are not cached and mean "unsupported".
 const platformOf=async(hostId:string|null):Promise<string|null>=>{
  if(!hostId)return null;const known=platforms.get(hostId);if(known)return known;
  try{const {platform}=await client.call('platform',{},{hostId});platforms.set(hostId,platform);return platform;}catch{return null;}
 };
 const decide=async(env:{hostId:string|null;path:string|null;status:string})=>canOpen(env,env.status==='ready'&&env.path?await platformOf(env.hostId):null);
 bb.rpc.register(rpcContract,{
 info:async({environmentId})=>{const env=await bb.sdk.environments.get({environmentId});return {path:env.path,supported:await decide(env),language:(await settings.get()).language as LanguageSetting};},
 open:async({environmentId,language:pageLanguage})=>{
  const language=resolveLanguage((await settings.get()).language as LanguageSetting,pageLanguage);
  const env=await bb.sdk.environments.get({environmentId});
  if(!(await decide(env)))throw new Error(STRINGS[language].unsupported);
  try{return await client.call('open',{path:env.path!},{hostId:env.hostId!});}catch(e){throw new Error(hostErrorText(e,language));}
 }
 });
}
