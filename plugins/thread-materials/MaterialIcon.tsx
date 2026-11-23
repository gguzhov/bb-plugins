import {useEffect,useState} from "react";
import {useRpc} from "@get-bb/plugin-sdk/app";
import type {rpcContract} from "./server";
import type {Material} from "./model";
import {googleIcons} from './brand-icons';
import {Icon} from './components/ui/icon';
const previews=new Map<string,{url:string|null,time:number}>();
/** Thumbnail of a local image material (data URL), shared by the row icon and the hover preview. */
export function useThumbnail(href:string,item:Material,threadId:string,enabled=true):string|null{
 const rpc=useRpc<typeof rpcContract>();const [thumbnail,setThumbnail]=useState<string|null>(null);
 useEffect(()=>{let current=true;setThumbnail(null);if(!enabled||!/\.(png|jpe?g|webp)$/i.test(href)||href.startsWith("http"))return;
 const key=threadId+":"+(item.hostId||item.originThreadId||"")+":"+href;
 const cached=previews.get(key);if(cached&&Date.now()-cached.time<300000){setThumbnail(cached.url);return;}
 rpc.call("thumbnail",{threadId,item}).then(result=>{if(previews.size>=100)previews.delete(previews.keys().next().value!);previews.set(key,{url:result.dataUrl,time:Date.now()});if(current)setThumbnail(result.dataUrl);},()=>{});return()=>{current=false;};
 },[rpc,threadId,href,item.hostId,item.originThreadId,enabled]);
 return thumbnail;
}
export const isImageHref=(href:string)=>!/^https?:/i.test(href)&&/\.(png|jpe?g|webp)$/i.test(href);
export function MaterialIcon({href,item,threadId,compact=false}:{href:string;item:Material;threadId:string;compact?:boolean}){
 const thumbnail=useThumbnail(href,item,threadId);
 if(thumbnail)return <img className="tm-thumbnail" src={thumbnail} alt="" aria-hidden="true"/>;
 let service:keyof typeof googleIcons|null=null;
 try{const u=new URL(href);if(u.hostname==='drive.google.com')service='drive';else if(u.hostname==='docs.google.com')service=u.pathname.startsWith('/spreadsheets/')?'sheets':u.pathname.startsWith('/presentation/')?'slides':'docs';}catch{}
 if(service)return <span className="tm-file-icon"><img src={googleIcons[service]} alt="" aria-hidden="true"/></span>;
 const ext=(href.split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})(?::\d+)?$/i)?.[1]||'').toUpperCase();
 if(compact)return <span className={'tm-file-icon tm-file-'+ext.toLowerCase()} aria-hidden="true"><Icon name={href.startsWith('http')?'Link':/^(PNG|JPE?G|WEBP|GIF)$/.test(ext)?'Image':'FileText'}/></span>;
 return <span className={'tm-file-icon tm-file-'+ext.toLowerCase()} aria-hidden="true">{ext?<span>{ext==='JPEG'?'JPG':ext}</span>:<Icon name={href.startsWith('http')?'Link':'FileText'}/>}</span>;
}
