import { vi } from "vitest";
import type { Preview } from "../lib/preview";
import type { UpdateInfo } from "../lib/types";

let seq = 0;
/** Messages no poll has taken yet, and polls waiting for one. */
const queued: Preview[] = [];
let waiting: ((p: Preview) => void)[] = [];

/** Answer the app's preview poll, as the engine would. */
export function sendPreview(msg: Omit<Preview, "seq">) {
  const full = { ...msg, seq: ++seq };
  const polls = waiting;
  waiting = [];
  if (polls.length === 0) queued.push(full);
  for (const resolve of polls) resolve(full);
}

/** Forget messages and polls from earlier tests. */
export function resetPreview() {
  queued.length = 0;
  waiting = [];
}

const nextPreview = (_after: number) =>
  new Promise<Preview>((resolve) => {
    const msg = queued.shift();
    if (msg) resolve(msg);
    else waiting.push(resolve);
  });

/** Mock for `src/lib/api`. Load it via dynamic import inside the `vi.mock` factory. */
export function mockApiModule() {
  return {
    api: {
      discoverDevices: vi.fn(async () => []),
      listMonitors: vi.fn(async () => []),
      setConfig: vi.fn(async () => {}),
      setPreview: vi.fn(async () => {}),
      identifyDevice: vi.fn(async () => {}),
      setPower: vi.fn(async () => {}),
      lightsOff: vi.fn(async () => {}),
      exportSetup: vi.fn(async (_name: string, _text: string) => true),
      importSetup: vi.fn(async (): Promise<string | null> => null),
      autostart: vi.fn(async () => false),
      setAutostart: vi.fn(async (_on: boolean) => {}),
      version: vi.fn(async () => "1.2.3"),
      checkUpdate: vi.fn(async (): Promise<UpdateInfo | null> => null),
      installUpdate: vi.fn(async () => {}),
      nextPreview: vi.fn(nextPreview),
      minimize: vi.fn(async () => {}),
      toggleMaximize: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      isMaximized: vi.fn(async () => false),
      onResized: vi.fn(async () => () => {}),
      fullscreen: vi.fn(async () => async () => {}),
    },
  };
}
