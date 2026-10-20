import { afterEach, expect, it, vi } from "vitest";
import { browserApi } from "./browserApi";

/** A preview message numbered `seq`, with nothing new in it. */
function message(seq: number) {
  const buf = new ArrayBuffer(9);
  new DataView(buf).setBigUint64(0, BigInt(seq), true);
  return buf;
}

afterEach(() => {
  browserApi.setPreviewTarget(null);
  vi.unstubAllGlobals();
});

it("polls the preview from where it left off, and from scratch for a new target", async () => {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      asked.push(url);
      return new Response(message(5));
    }),
  );
  expect(await browserApi.nextPreview(0)).toEqual({ seq: 5 });
  await browserApi.nextPreview(5);
  browserApi.setPreviewTarget({ id: "one", section: 1 });
  await browserApi.nextPreview(5);
  expect(asked).toEqual([
    "/api/preview?after=0",
    "/api/preview?after=5",
    "/api/preview?device=one&section=1&after=0",
  ]);
});

it("asks for a new target at once, instead of waiting out the poll", async () => {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      asked.push(url);
      if (asked.length > 1) return Promise.resolve(new Response(message(9)));
      return new Promise((_, reject) =>
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        ),
      );
    }),
  );
  const next = browserApi.nextPreview(3);
  browserApi.setPreviewTarget({ id: "two", section: null });
  expect(await next).toEqual({ seq: 9 });
  expect(asked.at(-1)).toBe("/api/preview?device=two&after=0");
});
