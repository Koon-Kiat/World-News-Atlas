/** Enforces the actual byte count, including absent or dishonest Content-Length. */
export function boundedStream(body: ReadableStream<Uint8Array>, maximum: number,
  signal?: AbortSignal, finish: () => void = () => {}): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let bytes = 0;
  let ended = false;
  let abort: () => void;
  function close() { ended = true; signal?.removeEventListener("abort", abort); finish(); }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      abort = () => {
        if (ended) return;
        close(); controller.error(new Error("Stream deadline exceeded"));
        void reader.cancel().catch(() => undefined);
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (ended) return;
        if (chunk.done) { close(); controller.close(); return; }
        bytes += chunk.value.byteLength;
        if (bytes > maximum) {
          close(); controller.error(new Error("Stream byte limit exceeded"));
          void reader.cancel().catch(() => undefined); return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        if (!ended) { close(); controller.error(error); void reader.cancel().catch(() => undefined); }
      }
    },
    cancel(reason) { close(); return reader.cancel(reason); },
  });
}

export async function boundedText(body: ReadableStream<Uint8Array> | null, maximum: number, signal?: AbortSignal): Promise<string> {
  if (!body) return "";
  return new Response(boundedStream(body, maximum, signal)).text();
}
