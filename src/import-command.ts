import fs from "node:fs/promises";
import path from "node:path";
import { DocumentLibrary, type ImportResult } from "./library.js";
import { topicIdSchema, type TopicId } from "./contracts.js";

export interface ImportCommandResult extends ImportResult { readonly topicId: TopicId; }
const MAX_IMPORT_BYTES = 250 * 1024 * 1024;

/** Imports one staged file only after its path and topic directory are verified. */
export async function importStagedDocument(root: string, library: DocumentLibrary, suppliedPath: string): Promise<ImportCommandResult> {
  if (path.isAbsolute(suppliedPath)) throw new Error("denied: 仅接受 inbox 下的相对路径");
  const inbox = path.resolve(root, "zhixing", "inbox");
  const requested = path.resolve(inbox, suppliedPath);
  if (!requested.startsWith(`${inbox}${path.sep}`)) throw new Error("denied: 文件必须位于 inbox");
  // macOS may expose /var through /private/var, so compare canonical paths.
  const [realInbox, realFile] = await Promise.all([fs.realpath(inbox), fs.realpath(requested)]);
  if (!realFile.startsWith(`${realInbox}${path.sep}`)) throw new Error("denied: 符号链接越界");
  if ((await fs.stat(realFile)).size > MAX_IMPORT_BYTES) throw new Error("file_too_large");
  const relative = path.relative(realInbox, realFile).split(path.sep);
  const topicId = topicIdSchema.parse(relative[0]);
  if (relative.length < 2) throw new Error("denied: 文件必须放在 inbox/<topicId>/ 中");
  return { topicId, ...(await library.importFile(topicId, realFile)) };
}
