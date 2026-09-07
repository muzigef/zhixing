import { setTimeout as delay } from "node:timers/promises";
import type { ModelClient } from "../../src/model.js";
/** Explicit offline preview; it never claims to be a live model. */
export class DesktopDemoClient implements ModelClient {
  async *stream(_prompt: string, signal: AbortSignal) {
    const text =
      "这是**离线演示**，用来体验知行的桌面对话。切换到 Pi · Codex 或 DeepSeek API 后，会使用所选模型回答。\n\n我们可以从一个具体问题开始：先理解概念，再拆解例子，最后用小练习检验理解。\n\n```python\ndef learn(question):\n    return understand(question)\n```\n\n例如梯度下降的更新式：\n\n$$\n\\theta_{t+1} = \\theta_t - \\eta \\nabla L(\\theta_t)\n$$\n\n它表示：用当前参数减去「学习率 × 梯度」，得到下一步参数。梯度给出损失增大最快的方向，沿反方向走一小步，可以尝试降低损失。\n\n你可以停止生成、复制回答，或将这段会话导出为 Markdown。";
    for (const textPart of text.match(/.{1,12}|\n/gu) ?? []) {
      await delay(24, undefined, { signal });
      yield { type: "text_delta" as const, text: textPart };
    }
    yield { type: "done" as const };
  }
}
