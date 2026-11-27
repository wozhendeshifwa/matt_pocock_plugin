import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createSidebarServer} from './sidebar-server.mjs';
const temp=await mkdtemp(path.join(tmpdir(),'deck-resource-revision-'));
const server=await createSidebarServer({dataDirectory:temp,changeDirectory:false});
try {
 const list=await server.handle({method:'tools/list'});
 const uri=list.tools.find(t=>t.name==='open_deck_sidebar_probe')._meta.ui.resourceUri;
 const assets=await Promise.all(['theme.css','dist/client.js','sidebar-bridge.js'].map(name=>readFile(new URL(name,import.meta.url),'utf8')));
 const revision=createHash('sha256').update([...assets,JSON.stringify({ui:{permissions:{clipboardWrite:{}}}})].join('\n')).digest('hex').slice(0,16);
 assert.equal(uri,'ui://deck-sidebar/board-'+revision+'.html','MCP UI resource identity must change with the shipped assets and permission contract');
 const resource=await server.handle({method:'resources/read',params:{uri}});
 assert.deepEqual(resource.contents[0]._meta,{ui:{permissions:{clipboardWrite:{}}}},'the MCP App resource requests clipboard writing only, never clipboard reading or unrelated device access');
 assert.ok(resource.contents[0].text.includes('核对项目后推进'));
 const legacy=await server.handle({method:'resources/read',params:{uri:'ui://deck-sidebar/board.html'}});
 assert.equal(resource.contents[0].text,legacy.contents[0].text);
 assert.deepEqual(legacy.contents[0]._meta,resource.contents[0]._meta,'legacy aliases retain the same explicit clipboard-write contract');
 console.log('PASS content-revision MCP resource exposes the current native-draft UI; legacy resource link remains readable');
} finally {await server.dispose();await rm(temp,{recursive:true,force:true});}
