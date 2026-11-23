import {experimental_defineHostEntry} from '@get-bb/plugin-sdk/host';
import {stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {hostContract} from './contract';
import {HOST_ERRORS} from './strings';
export default experimental_defineHostEntry({contract:hostContract,handlers:{platform:async()=>({platform:process.platform}),open:async({path})=>{
 if(process.platform!=='darwin')throw new Error(HOST_ERRORS.onlyMac);
 if(path.includes('\0')||!(await stat(path).catch(()=>null))?.isDirectory())throw new Error(HOST_ERRORS.notFound);
 await promisify(execFile)('/usr/bin/open',['-a','Finder',path],{timeout:10000});return {ok:true};
}}});
