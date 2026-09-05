import { z } from "zod";
export interface ReleaseInfo { available: boolean; version?: string; url?: string; message: string; }
/** User-initiated public metadata check; no credentials, automatic download or execution. */
export async function checkRelease(current: string, fetcher: typeof fetch = fetch): Promise<ReleaseInfo> {
  const response = await fetcher("https://api.github.com/repos/muzigef/zhixing/releases/latest", { headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (response.status === 404) return { available: false, message: "暂未找到公开的正式版本。" };
  if (!response.ok) throw new Error("release_unavailable");
  const raw: unknown = await response.json();
  const parsed = z.object({ tag_name: z.string().regex(/^v?\d{1,5}\.\d{1,5}\.\d{1,5}$/), html_url: z.string().max(300), draft: z.literal(false), prerelease: z.literal(false) }).safeParse(raw);
  if (!parsed.success) throw new Error("release_invalid");
  const value = parsed.data;
  if (value.html_url !== `https://github.com/muzigef/zhixing/releases/tag/${value.tag_name}`) throw new Error("release_invalid");
  const version = value.tag_name.replace(/^v/, "");
  const latest = version.split(".").map(Number), installed = current.split(".").map(Number);
  const difference = latest.map((part, index) => part - (installed[index] ?? 0)).find((part) => part !== 0) ?? 0;
  const available = difference > 0;
  return { available, version, url: value.html_url, message: available ? `发现新版本 ${version}，可查看发布说明和安装包。` : "当前已是最新正式版本。" };
}
