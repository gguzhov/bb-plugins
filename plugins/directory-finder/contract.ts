import {defineRpcContract} from '@get-bb/plugin-sdk';
import {z} from 'zod';
export const hostContract=defineRpcContract({
 open:{input:z.object({path:z.string().startsWith('/').max(8192)}),output:z.object({ok:z.boolean()})},
 platform:{input:z.object({}),output:z.object({platform:z.string()})}
});
const language=z.enum(['en','ru']);
export const rpcContract=defineRpcContract({
 info:{input:z.object({environmentId:z.string()}),output:z.object({path:z.string().nullable(),supported:z.boolean(),language:z.enum(['auto','en','ru'])})},
 // `language` is what the page resolved for "auto"; an explicit plugin setting wins over it.
 open:{input:z.object({environmentId:z.string(),language:language.optional()}),output:z.object({ok:z.boolean()})}
});
type Env={hostId:string|null;path:string|null;status:string};
/** Environment is ready, has an absolute path and a known host; platform is what that host reported (null if unknown). */
export function canOpen(env:Env,platform:string|null){return !!env.hostId&&platform==='darwin'&&env.status==='ready'&&!!env.path?.startsWith('/');}
