import { z } from "zod/v4";
import type { ModelMessage } from "./model.js";
export const MAX_IMAGE_BYTES = 512_000;
export const MAX_IMAGE_DIMENSION = 2048;
export const MAX_CONTEXT_IMAGES = 4;
export const IMAGE_TOKEN_RESERVE = 2048;

function inspect(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("image_size_limit");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 45 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
    if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) throw new Error("image_format_invalid");
    let offset = 8, ended = false, data = false;
    while (offset + 12 <= bytes.length) {
      const size = view.getUint32(offset), type = view.getUint32(offset + 4);
      if (size > bytes.length - offset - 12) throw new Error("image_format_invalid");
      if (type === 0x49444154) data = true;
      offset += size + 12;
      if (type === 0x49454e44) { ended = size === 0 && offset === bytes.length; break; }
    }
    if (!ended || !data) throw new Error("image_format_invalid");
    return { mimeType: "image/png" as const, width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length > 10 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 255) throw new Error("image_format_invalid");
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]!;
      if (marker === 218 || marker === 217) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) throw new Error("image_format_invalid");
      if ([192, 193, 194].includes(marker)) {
        if (size < 8) throw new Error("image_format_invalid");
        return { mimeType: "image/jpeg" as const, width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      }
      offset += size;
    }
  }
  throw new Error("image_format_invalid");
}
const dataSchema = z.string().min(4).max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
export const imageInputSchema = z.object({ name: z.string().trim().min(1).max(120).refine(value => Array.from(value).every(char => char.charCodeAt(0) >= 32 && !"/\\".includes(char))), mimeType: z.enum(["image/png", "image/jpeg"]), data: dataSchema, width: z.number().int().min(1).max(MAX_IMAGE_DIMENSION), height: z.number().int().min(1).max(MAX_IMAGE_DIMENSION) }).strict().superRefine((value, context) => {
  try {
    const bytes = Uint8Array.from(atob(value.data), char => char.charCodeAt(0)); const actual = inspect(bytes);
    if (actual.mimeType !== value.mimeType || actual.width !== value.width || actual.height !== value.height) throw new Error("mismatch");
  } catch { context.addIssue({ code: "custom", message: "image_format_invalid" }); }
});
export type ImageInput = z.infer<typeof imageInputSchema>;
export const imagesSchema = z.array(imageInputSchema).min(1).max(2);
export function imageFromBytes(name: string, bytes: Uint8Array): ImageInput {
  const dimensions = inspect(bytes); let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return imageInputSchema.parse({ name, ...dimensions, data: btoa(binary) });
}
/** Keep at most four recent images; omission is visible to the model, durable originals stay intact. */
export function imageContext(messages: readonly ModelMessage[]): ModelMessage[] {
  let remaining = MAX_CONTEXT_IMAGES;
  return [...messages].reverse().map(message => {
    if (!message.images?.length) return message;
    if (message.role !== "user") throw new Error("image_role_invalid");
    const images = message.images.map(image => imageInputSchema.parse(image));
    const kept = remaining ? images.slice(-remaining) : []; remaining -= kept.length;
    const rest = { ...message }; delete rest.images;
    return { ...rest, ...(kept.length ? { images: kept } : {}), content: message.content + (kept.length < images.length ? "\n[较早图片未加入本轮模型上下文，需要时请重新附图；不要猜测图片内容。]" : "") };
  }).reverse();
}
export function imageDataUrl(image: ImageInput): string { return `data:${image.mimeType};base64,${image.data}`; }
/** Binary bytes are not text tokens. Reserve conservatively per bounded image. */
export function imageBudgetView(value: unknown): { text: string; imageTokens: number } {
  let imageTokens = 0;
  const text = JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && "mimeType" in item && "data" in item && "width" in item && "height" in item) {
      const image = imageInputSchema.parse(item); imageTokens += IMAGE_TOKEN_RESERVE;
      return { mimeType: image.mimeType, width: image.width, height: image.height, name: image.name };
    }
    return item;
  });
  return { text, imageTokens };
}
