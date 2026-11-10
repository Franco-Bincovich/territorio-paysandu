/** Keep the HTTP image admission until consumption/cancellation, including slow clients. */
export function admittedImageResponse(response: Response, release: () => void, signal: AbortSignal) {
  if (!response.body) { release(); return response; }
  const reader = response.body.getReader();
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = () => { if (finished) return; finished = true; if(timer)clearTimeout(timer); signal.removeEventListener('abort', abort); release(); };
  const abort = () => { void reader.cancel().catch(() => {}); finish(); };
  timer=setTimeout(abort,15000);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try { const part = await reader.read(); if (part.done) { finish(); controller.close(); } else controller.enqueue(part.value); }
      catch (error) { finish(); controller.error(error); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { finish(); } },
  }), { status: response.status, statusText: response.statusText, headers: response.headers });
}
