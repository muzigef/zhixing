/** Playwright's synchronous predicate poll treats a Promise as truthy. Await
 * each IPC result on the host instead, including a deadline for a stuck IPC. */
export async function waitForIpc(page, predicate, argument, timeoutMs = 20_000) {
  let stopped = false, timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { stopped = true; reject(new Error("ipc_condition_timeout")); }, timeoutMs);
  });
  try {
    await Promise.race([deadline, (async () => {
      while (!stopped) {
        if (await page.evaluate(predicate, argument)) return;
        if (!stopped) await new Promise(resolve => setTimeout(resolve, 50));
      }
    })()]);
  } finally { stopped = true; clearTimeout(timer); }
}
