/** Prevent an older response from replacing a newer screen/session. */
export class RequestScope {
  private current: AbortController | null = null;
  begin() {
    this.cancel();
    const controller = new AbortController();
    this.current = controller;
    return {
      signal: controller.signal,
      isCurrent: () =>
        this.current === controller && !controller.signal.aborted,
    };
  }
  cancel() {
    this.current?.abort();
    this.current = null;
  }
}
export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
