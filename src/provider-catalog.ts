import { apiConnectionInputSchema, type ApiConnectionInput } from "./api-connection-config.js";

export interface ProviderDefinition {
  id: string; name: string; protocol: ApiConnectionInput["protocol"]; baseUrl: string;
  accountNote: string; documentation: string; images?: boolean;
  reasoning?: ApiConnectionInput["reasoning"]; tokenField?: ApiConnectionInput["tokenField"];
}
/** Public, dated hints only. Models and entitlement are selected by the user, never inferred from a brand. */
export const providerCatalog: readonly ProviderDefinition[] = [
  { id: "openai", name: "OpenAI · GPT", protocol: "openai-responses", baseUrl: "https://api.openai.com/v1", images: true, reasoning: "openai", accountNote: "API 独立计费；ChatGPT 订阅须通过官方 Codex 登录，不能在此粘贴订阅凭证。", documentation: "https://learn.chatgpt.com/docs/auth" },
  { id: "anthropic", name: "Anthropic · Claude", protocol: "anthropic-messages", baseUrl: "https://api.anthropic.com/v1", images: true, accountNote: "使用 Claude 平台 API Key。Claude Code 订阅由官方客户端自行登录。", documentation: "https://code.claude.com/docs/en/authentication" },
  { id: "google", name: "Google · Gemini", protocol: "openai-chat-completions", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", images: true, accountNote: "使用 Gemini API Key；Google AI 订阅与 API 权益分别管理。", documentation: "https://ai.google.dev/gemini-api/docs/openai" },
  { id: "deepseek", name: "DeepSeek", protocol: "openai-chat-completions", baseUrl: "https://api.deepseek.com", reasoning: "deepseek", accountNote: "使用 DeepSeek 开放平台 API Key，按所选模型计费。", documentation: "https://api-docs.deepseek.com/" },
  { id: "qwen", name: "阿里百炼 · Qwen", protocol: "openai-chat-completions", baseUrl: "", accountNote: "从百炼控制台复制当前地域、工作空间的 Base URL。Coding Plan 限定用途，不作为知行通用 API 套餐。", documentation: "https://help.aliyun.com/zh/model-studio/models" },
  { id: "kimi", name: "Moonshot · Kimi", protocol: "openai-chat-completions", baseUrl: "https://api.moonshot.cn/v1", reasoning: "kimi", accountNote: "此处为 Moonshot 平台按量 API；Kimi Code 的套餐 Key、端点和适用范围独立。", documentation: "https://platform.moonshot.cn/docs" },
  { id: "glm", name: "智谱 · GLM", protocol: "openai-chat-completions", baseUrl: "https://open.bigmodel.cn/api/paas/v4", accountNote: "使用通用 API。Coding Plan 仅用于官方支持工具，不等于自建教学应用授权。", documentation: "https://docs.bigmodel.cn/cn/api/introduction" },
  { id: "minimax", name: "MiniMax", protocol: "anthropic-messages", baseUrl: "https://api.minimax.io/anthropic/v1", accountNote: "国际站地址；中国站按控制台修改。Token Plan 的 Subscription Key 与按量 API Key 不通用，请分别建连接。", documentation: "https://platform.minimax.io/docs/token-plan/quickstart" },
  { id: "doubao", name: "火山方舟 · 豆包", protocol: "openai-chat-completions", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", accountNote: "填写方舟控制台可用的模型 ID 或推理接入点 ID。豆包 App 会员不等于方舟 API 权益。", documentation: "https://www.volcengine.com/docs/82379/1494384" },
  { id: "hunyuan", name: "腾讯 · 混元", protocol: "openai-chat-completions", baseUrl: "https://tokenhub.tencentmaas.com/v1", accountNote: "新连接使用 TokenHub 的 API Key 与模型 ID；旧混元平台正在迁移，旧 Key 不自动通用。", documentation: "https://cloud.tencent.com/document/product/1823/131382" },
];
export function providerTemplate(id: string): ApiConnectionInput {
  const definition = providerCatalog.find(item => item.id === id);
  if (!definition) throw new Error("provider_not_found");
  // A draft deliberately leaves model and region-specific endpoints for the user's console.
  return { ...apiConnectionInputSchema.parse({ name: definition.name, protocol: definition.protocol, baseUrl: definition.baseUrl || "https://workspace.example/v1", model: "placeholder", images: definition.images ?? false, reasoning: definition.reasoning ?? "none", tokenField: definition.tokenField ?? "max_tokens" }), baseUrl: definition.baseUrl, model: "" };
}
