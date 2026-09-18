import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { ZhixingDatabase } from "../src/database.js";
import { previewBackup, restoreBackup } from "../src/backup-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { AgentExecutionStore } from "../src/agent-execution-store.js";
import { TeamBudget } from "../src/team-budget.js";
import { teamConfigurationSchema, type TeamSnapshot } from "../src/team-contracts.js";
import { teamBudgetAccounting } from "../src/team-budget-ledger.js";
import { LearningApplication } from "../src/learning-application.js";
import { DesktopStore } from "../desktop/core/store.js";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "../desktop/core/workspace-backup.js";
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const close of cleanups.splice(0).reverse()) await close();});
async function directory(){const root=await fs.mkdtemp(path.join(os.tmpdir(),"zhixing-fault-matrix-"));cleanups.push(()=>fs.rm(root,{recursive:true,force:true}));return root;}
async function backups(){const root=await directory(), source=path.join(root,"source.sqlite"),target=path.join(root,"target.sqlite");const db=new ZhixingDatabase(source);db.db.exec("CREATE TABLE synthetic(value TEXT); INSERT INTO synthetic VALUES ('backup');");db.close();const dest=new ZhixingDatabase(target);dest.db.exec("CREATE TABLE synthetic(value TEXT); INSERT INTO synthetic VALUES ('original');");dest.close();return {root,source,target};}
it("never deletes active/stale target SQLite sidecars during a restore",async()=>{
 const {source,target}=await backups(),before=await fs.readFile(target);await fs.writeFile(`${target}-wal`,"synthetic outstanding data");
 await expect(restoreBackup(source,target,true)).rejects.toThrow("restore_target_in_use");
 expect(await fs.readFile(target)).toEqual(before);expect(await fs.readFile(`${target}-wal`,"utf8")).toBe("synthetic outstanding data");
});
it("rejects a corrupted staged copy before replacement and cleans only its own temporary file",async()=>{
 const {root,source,target}=await backups(),before=await fs.readFile(target),copy=fs.copyFile.bind(fs);
 vi.spyOn(fs,"copyFile").mockImplementation(async(...args)=>{await copy(...args);if(String(args[1]).startsWith(`${target}.`))await fs.writeFile(args[1],"synthetic damaged copy");});
 await expect(restoreBackup(source,target,true)).rejects.toThrow();expect(await fs.readFile(target)).toEqual(before);expect((await fs.readdir(root)).filter(name=>name.includes(".restore"))).toEqual([]);
});
it("preserves the original database if final replacement fails and removes staging",async()=>{
 const {root,source,target}=await backups(),before=await fs.readFile(target),rename=fs.rename.bind(fs);
 vi.spyOn(fs,"rename").mockImplementation(async(from,to)=>{if(String(to)===target)throw new Error("injected_rename_failure");await rename(from,to);});
 await expect(restoreBackup(source,target,true)).rejects.toThrow("injected_rename_failure");expect(await fs.readFile(target)).toEqual(before);expect((await fs.readdir(root)).filter(name=>name.includes(".restore"))).toEqual([]);
});
it("rejects future database schemas and linked backup files before touching a target",async()=>{
 const {root,source,target}=await backups(),before=await fs.readFile(target);const db=new ZhixingDatabase(source);db.db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES (?,'synthetic')").run(999);db.close();
 await expect(previewBackup(source)).rejects.toThrow("storage_version_unsupported");const link=path.join(root,"linked.sqlite");await fs.symlink(source,link);
 await expect(restoreBackup(link,target,true)).rejects.toThrow("backup_link_denied");expect(await fs.readFile(target)).toEqual(before);
});
it("retains an unknown budget after failed settlement persistence, and forbids downgrade or a second paid call",async()=>{
 const root=await directory(),store=new AgentSessionStore(root),session=await store.create();
 const state:TeamSnapshot={id:randomUUID(),mode:"same-model-team",status:"running",lead:{provider:"mock",model:"fixture",connection:"fixture",reasoning:"quick"},members:[],modelTurns:0,toolCalls:0,reservedOutputTokens:0,estimatedInputTokens:0,inputTokens:0,outputTokens:0,unknownUsageRequests:0};
 session.messages.push({id:randomUUID(),role:"assistant",text:"synthetic",status:"running",createdAt:session.createdAt,team:state});await store.save(session);
 const target=path.join(root,"conversations",`${session.id}.json`),rename=fs.rename.bind(fs);let writes=0,calls=0;
 vi.spyOn(fs,"rename").mockImplementation(async(from,to)=>{if(String(to)===target && ++writes===2)throw new Error("injected_settlement_failure");await rename(from,to);});
 const config=teamConfigurationSchema.parse({maxOutputTokens:4096}),budget=new TeamBudget(config,state,()=>store.save(session));
 const client={async *stream(){calls++;yield {type:"usage" as const,usage:{inputTokens:20,outputTokens:10}};yield {type:"done" as const};}};
 const consume=async(b:TeamBudget)=>{for await(const event of b.wrap(client,"lead").stream("synthetic",new AbortController().signal))void event;};
 await expect(consume(budget)).rejects.toThrow("injected_settlement_failure");await expect(consume(budget)).rejects.toThrow("injected_settlement_failure");vi.restoreAllMocks();
 const reopened=await new AgentSessionStore(root).load(session.id);expect(reopened.version).toBe(14);const ledger=reopened.messages[0]!.team!;expect(teamBudgetAccounting(ledger)).toMatchObject({unknownUsageRequests:1,reservedOutputTokens:4096});
 await expect(consume(new TeamBudget(config,ledger,async()=>{}))).rejects.toThrow("team_budget_exhausted");expect(calls).toBe(1);
 const downgrade=structuredClone(reopened);downgrade.version=13;delete downgrade.messages[0]!.team!.budgetLedger;
 await expect(store.save(downgrade)).rejects.toThrow("storage_version_unsupported");
});
it("rolls back checkpoint advancement when the paired event write fails",async()=>{
 const root=await directory(),db=new ZhixingDatabase(path.join(root,"journal.sqlite"));cleanups.push(async()=>db.close());
 const journal=new AgentExecutionStore(db,{taskId:randomUUID(),sessionId:randomUUID(),topicId:"rag"}),release=journal.claim();
 const before={version:1 as const,status:"running" as const,prompt:"synthetic",history:[],decisions:{},containsMaterials:false,pending:{events:[{type:"tool_call" as const,tool:"mcp_fixture_write",callId:"operation",input:{id:"A"}}],toolResults:[],next:0,phase:"executing" as const}};
 journal.save(before,"tool_started");db.db.exec("CREATE TEMP TRIGGER injected_failure BEFORE INSERT ON agent_execution_events WHEN NEW.type='tool_completed' BEGIN SELECT RAISE(ABORT,'injected_event_failure'); END;");
 expect(()=>journal.save({...before,pending:{...before.pending,phase:"ready",next:1,toolResults:[{tool:"mcp_fixture_write",callId:"operation",result:{ok:true}}]}},"tool_completed")).toThrow("injected_event_failure");
 expect(journal.read()).toEqual(before);expect(journal.events().map(item=>item.type)).toEqual(["tool_started"]);release();
});
it("reports cancellation after partial workspace publication without deleting originals or claiming success",async()=>{
 const root=await directory(),app=await LearningApplication.open(path.join(root,"workspace"),process.cwd());cleanups.push(async()=>app.close());const store=new DesktopStore(path.join(root,"desktop")),session=await store.create();session.executionAllowed=true;await store.save(session);
 const backup=await createWorkspaceBackup(app,store,path.join(root,"exports"),"synthetic",new AbortController().signal),original=await fs.readFile(path.join(store.root,"conversations",`${session.id}.json`));
 const controller=new AbortController(),save=store.save.bind(store);vi.spyOn(store,"save").mockImplementationOnce(async chat=>{await save(chat);controller.abort(new Error("injected_cancel"));});
 const parent=path.join(root,"restored");await expect(restoreWorkspaceBackup(backup,parent,store,controller.signal)).rejects.toThrow("injected_cancel");
 expect(await fs.readFile(path.join(store.root,"conversations",`${session.id}.json`))).toEqual(original);
 const [partial]=await fs.readdir(parent);expect(await fs.readFile(path.join(parent,partial!,"RESTORE-INCOMPLETE.txt"),"utf8")).toContain("恢复未完成");
 const imported=(await store.list()).find(item=>item.id!==session.id)!;expect((await store.load(imported.id)).executionAllowed).toBe(false);
});
it("preserves source bytes and directory entries across repeated previews",async()=>{
 const {root,source}=await backups(),before=await fs.readFile(source),names=await fs.readdir(root);
 const first=await previewBackup(source),second=await previewBackup(source);expect(first.sha256).toBe(second.sha256);expect(await fs.readFile(source)).toEqual(before);expect(await fs.readdir(root)).toEqual(names);
});
it("rejects a valid but different staged database against the approved backup hash",async()=>{
 const {source,target}=await backups(),before=await fs.readFile(target),copy=fs.copyFile.bind(fs);
 vi.spyOn(fs,"copyFile").mockImplementation(async(from,to,flags)=>copy(String(to).startsWith(`${target}.`)?target:from,to,flags));
 await expect(restoreBackup(source,target,true)).rejects.toThrow("backup_changed");expect(await fs.readFile(target)).toEqual(before);
});
it("does not publish a successful backup if cancellation arrives while writing its manifest",async()=>{
 const root=await directory(),app=await LearningApplication.open(path.join(root,"workspace"),process.cwd());cleanups.push(async()=>app.close());const store=new DesktopStore(path.join(root,"desktop"));await store.create();
 const controller=new AbortController(),write=fs.writeFile.bind(fs);vi.spyOn(fs,"writeFile").mockImplementation(async(...args)=>{await write(...args);if(String(args[0]).endsWith("manifest.json"))controller.abort(new Error("injected_manifest_cancel"));});
 const exports=path.join(root,"exports");await expect(createWorkspaceBackup(app,store,exports,"synthetic",controller.signal)).rejects.toThrow("injected_manifest_cancel");expect(await fs.readdir(exports)).toEqual([]);
});
it("checks exactly the database snapshot bytes without creating sidecars beside it",async()=>{
 const {root,source}=await backups(),{inspectDatabaseSnapshot}=await import("../src/database.js"),names=await fs.readdir(root),before=await fs.readFile(source);
 inspectDatabaseSnapshot(source);expect(await fs.readFile(source)).toEqual(before);expect(await fs.readdir(root)).toEqual(names);
});
