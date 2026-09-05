import { resolveTeachingInput } from "./teaching-dialogue.js";

/** Routes natural language only. Registered commands retain their authorization path. */
export function routeConversation(input: string, context: { teaching: boolean; planning: boolean }): "teaching" | "planning" | "answer" {
  const text = input.trim().replace(/^(?:请|麻烦)?(?:你)?(?:帮我|给我)?\s*/, "");
  const question = /^(?:先)?(?:请)?(?:解释|说明|讲解|举|给.{0,8}例子|什么|为什么|怎么|如何|能否解释|请教|对比|比较|简短|详细|展开|继续讲|换.{0,6}(?:说法|解释))/.test(text)
    || /(?:是什么|是什么意思|为什么|如何|怎么|[？?])/.test(text)
    || /^(?:用|使用|以).{0,16}(?:代码|表格|类比|例子|一句话)/.test(text)
    || /^(?:把|将).{0,8}(?:回答|解释|内容).{0,12}(?:表格|代码|简短|详细)/.test(text)
    || /^(?:暂时)?(?:不|不要|先不|先别).*(?:计划|课程)/.test(text);
  if (!question) {
    const request = text.replace(/^(?:我)?(?:想要|想|希望|需要|打算)(?:你|帮我)?\s*/, "");
    if (/^(?:调整|创建|新建|制定|规划|生成|设计|安排|做|修改|更改|切换|导入|删除|恢复|启用|设置|换)(?:一下|一份|一个|一套|当前|我的|这个|新的|本周|下周)?[^。！？?]{0,60}(?:计划|课程|主题|资料|提醒|学习安排|进度|周期|时间)/.test(request)
      || /^(?:切换|更换|设置|修改|换)(?:一下|当前|使用的)?模型/.test(request)
      || /^(?:把|将).{0,40}(?:计划|课程|主题|模型|周期|时间).{0,30}(?:改|调|换|设)/.test(request)
      || /^(?:学|学习)\S/.test(request) && /^(?:我)?(?:想|希望|打算|需要)/.test(text)) return "planning";
    if (context.teaching && resolveTeachingInput(input, true)?.source === "deterministic_request") return "teaching";
    if (context.planning) return "planning";
  }
  return context.teaching ? "teaching" : "answer";
}
