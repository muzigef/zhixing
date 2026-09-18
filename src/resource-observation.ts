import { z } from "zod/v4";
import type { McpServer } from "./mcp-settings.js";
import type { ToolResultMessage } from "./model.js";
import { mcpRequestHash } from "./mcp-operation.js";
export interface ResourceObservation { resource: string; version: string; }
export interface ResourceObservationAdapter {
  observationScope?: (input: unknown) => string | undefined;
  observe?: (input: unknown, output: unknown) => ResourceObservation | undefined;
}
const scalar = z.union([z.string().trim().min(1).max(256).refine(value => !/[\0\r\n]/.test(value)), z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)]);
const receipt = z.object({resource:z.string().min(1).max(300),version:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
function own(value: unknown, key: string): unknown { return value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value,key) ? (value as Record<string,unknown>)[key] : undefined; }
export function mcpObservation(policy: McpServer["tools"][number], resource: string): ResourceObservationAdapter {
  const rule=policy.observation; if(!rule) return {};
  const observationScope=(input:unknown) => scalar.safeParse(own(input,rule.identity)).success ? `${resource}:${mcpRequestHash(own(input,rule.identity))}` : undefined;
  return { observationScope, observe(input,output) {
    const scope=observationScope(input), body=own(output,"structuredContent"), revision=own(body,rule.version);
    if(!scope || own(output,"isError") === true || own(body,rule.resultIdentity) !== own(input,rule.identity) || !scalar.safeParse(revision).success) return;
    return {resource:scope,version:mcpRequestHash(revision)};
  } };
}
/** Rebuild from durable host receipts; model text and unbound resource identities never advance state. */
export function resourceObservationState(results: readonly ToolResultMessage[], resourceFor: (tool:string)=>string|undefined, scope?:string): string {
  const versions=new Map<string,string>();
  for(const item of results){
    const base=resourceFor(item.tool); if(!base || own(item.result,"ok") !== true) continue;
    const parsed=receipt.safeParse(own(item.result,"observation")); if(!parsed.success) continue;
    const observed=parsed.data;
    if(!observed.resource.startsWith(`${base}:`) || observed.resource.slice(base.length+1).length !== 64 || !/^[a-f0-9]{64}$/.test(observed.resource.slice(base.length+1))) continue;
    if(scope && scope !== base && scope !== observed.resource) continue;
    versions.set(observed.resource,observed.version);
  }
  return versions.size ? mcpRequestHash([...versions].sort(([a],[b])=>a<b?-1:a>b?1:0)) : "";
}
