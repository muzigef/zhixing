/** Wait for an operation without trusting it to implement cancellation itself. */
export async function abortable<T>(operation: () => PromiseLike<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return await new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    // Invoke lazily so cancellation can prevent work, not just discard its result.
    void Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(
      (value) => { cleanup(); resolve(value); },
      (error: unknown) => { cleanup(); reject(error); },
    );
  });
}
