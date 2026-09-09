/** Runs inside an isolated acceptance renderer, not the user's active app. */
export async function observePiAcceptanceTurn(task) {
  const call = async command => {
    const result = await window.zhixing.invoke(command);
    if (!result.ok) throw new Error(result.error);
    return result.data;
  };
  const session = task.sessionId ? { id: task.sessionId } : await call({ type: "new" });
  const phases = []; let cancelAt; let settledAt; let receivedText = false;
  await new Promise((resolve, reject) => {
    let finished = false;
    const finish = error => {
      if (finished) return;
      finished = true; clearTimeout(timer); unsubscribe();
      if (error) reject(error); else { settledAt = Date.now(); resolve(); }
    };
    const timer = setTimeout(() => {
      finish(new Error("live_check_timeout"));
      void call({ type: "stop" }).catch(() => {}); // The deadline failure is already reported.
    }, task.timeoutMs ?? 190_000);
    const unsubscribe = window.zhixing.subscribe(event => {
      const current = event.type === "session" ? event.session.id === session.id : event.sessionId === session.id;
      if (!current || finished) return;
      if (event.type === "delta" && event.text) receivedText = true;
      const activities = event.type === "session" ? event.session.messages.at(-1)?.activities
        : event.type === "message_patch" ? event.changes.activities : undefined;
      for (const activity of activities ?? []) if (!phases.includes(activity.label)) phases.push(activity.label);
      if (task.cancel && cancelAt === undefined && (task.cancel === "stream" ? receivedText : phases.includes("正在请求模型"))) {
        cancelAt = Date.now(); void call({ type: "stop" }).catch(finish);
      }
      if (event.type === "settled") finish();
    });
    void call({ type: "send", sessionId: session.id, text: task.text, provider: "pi-codex", style: "adaptive", reasoning: "balanced",
      ...(task.context ? { topicId: "agent-development", contextAllowed: true } : {}) }).catch(finish);
  });
  const message = (await call({ type: "load", sessionId: session.id })).messages.at(-1);
  return { id: task.id, sessionId: session.id, receivedText, text: message.text, status: message.status, error: message.error,
    durationMs: message.durationMs, firstTokenMs: message.firstTokenMs, timings: message.timings,
    modelTimings: message.modelTimings, phases, cancelRequested: cancelAt !== undefined,
    ...(cancelAt !== undefined ? { cancelMs: settledAt - cancelAt } : {}) };
}
