import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os'; import assert from 'node:assert/strict';
import { McpConnection, attachMcpTools, McpSettings } from '../src/mcp-tools.js';
import { ZhixingDatabase } from '../src/database.js';
import { ToolHarness } from '../src/tool-harness.js';
const dependencies=process.argv.find(arg=>arg.startsWith('--mcp-root='))?.slice(11);
if(!dependencies || !path.isAbsolute(dependencies)) throw new Error('explicit_mcp_node_modules_root_required');
const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'zhixing-mcp-real-')));
const db=new ZhixingDatabase(':memory:');
try {
 await fs.writeFile(path.join(root,'synthetic.txt'),'合成校验：37');
 const config={id:'official-files',enabled:true,consent:'local-process-and-topic-inputs' as const,command:process.execPath,args:[path.join(dependencies,'@modelcontextprotocol/server-filesystem/dist/index.js'),root],isolation:'restricted' as const,readPaths:[dependencies,root],tools:[{name:'read_text_file',risk:'read' as const,replaySafe:true}]};
 const server=await McpConnection.open(config,AbortSignal.timeout(15000));
 try {assert.ok(server.tools.some(t=>t.name==='read_text_file'));}finally{await server.close();}
 const settings=new McpSettings(db);settings.replace('rag',0,[config]);
 const connection=await attachMcpTools({harness:new ToolHarness(),definitions:[]},settings,'rag',AbortSignal.timeout(15000));
 try {
  const definitions=connection.tools.definitions;assert.equal(definitions.length,1);assert.ok(!definitions[0]!.name.includes('connection_status'));
  const result=await connection.tools.harness.execute(definitions[0]!.name,{path:path.join(root,'synthetic.txt')},{topicId:'rag',signal:AbortSignal.timeout(5000)});
  assert.equal(result.ok,true);assert.match(JSON.stringify(result.output),/合成校验：37/);
  const denied=await connection.tools.harness.execute('write_file',{path:path.join(root,'synthetic.txt'),content:'bad'},{topicId:'rag',signal:AbortSignal.timeout(5000)});assert.equal(denied.ok,false);
  assert.equal(await fs.readFile(path.join(root,'synthetic.txt'),'utf8'),'合成校验：37');
  console.log(JSON.stringify({passed:true,server:'@modelcontextprotocol/server-filesystem@2026.8.31',isolation:'restricted',checks:['real upstream handshake and schema','ToolHarness whitelisted read','unlisted write denied','source intact']}));
 }finally{await connection.close();}
} finally {db.close();await fs.rm(root,{recursive:true,force:true});}
