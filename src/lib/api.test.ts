/**
 * The IPC contract: every call the page makes names a command the backend
 * registers, with the argument names its Rust function takes. Neither side's
 * own tests can see a mismatch, and it only fails at runtime.
 */
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import type { EngineConfig } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "1.2.3") }));

const rust = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../../src-tauri/src/*.rs", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ).map(([path, text]) => [path.split("/").pop(), text]),
);
const all = Object.values(rust).join("\n");

/** Commands in `generate_handler!`, without their module path. */
const registered = (() => {
  const list = /generate_handler!\[([^\]]*)\]/.exec(rust["lib.rs"] ?? "")?.[1] ?? "";
  return list
    .split(",")
    .map((c) => c.trim().split("::").pop() ?? "")
    .filter(Boolean);
})();

/** The arguments the page has to pass: a command's parameters, less what Tauri injects. */
function rustArgs(command: string): string[] {
  const m = new RegExp(
    `#\\[tauri::command\\]\\s*(?:pub )?(?:async )?fn ${command}\\(([^)]*)\\)`,
  ).exec(all);
  if (!m) throw new Error(`no #[tauri::command] fn ${command}`);
  return (m[1] ?? "")
    .split(/,(?![^<]*>)/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/:\s*(State<|Window|WebviewWindow|AppHandle)/.test(p))
    .map((p) => p.split(":")[0]?.trim() ?? "");
}

/** Tauri maps camelCase arguments to snake_case parameters. */
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Every call in `api` that goes through `invoke`, with sample arguments. */
const calls: [string, () => Promise<unknown>][] = [
  ["discoverDevices", () => api.discoverDevices()],
  ["listMonitors", () => api.listMonitors()],
  ["setConfig", () => api.setConfig({} as EngineConfig)],
  ["setPreview", () => api.setPreview(true)],
  ["identifyDevice", () => api.identifyDevice("10.0.0.2")],
  ["setPower", () => api.setPower("10.0.0.2", true)],
  ["lightsOff", () => api.lightsOff(["10.0.0.2"])],
  ["exportSetup", () => api.exportSetup("setup.json", "{}")],
  ["importSetup", () => api.importSetup()],
  ["autostart", () => api.autostart()],
  ["setAutostart", () => api.setAutostart(true)],
  ["checkUpdate", () => api.checkUpdate()],
  ["installUpdate", () => api.installUpdate()],
  ["icueStatus", () => api.icueStatus()],
  ["downloadIcueSdk", () => api.downloadIcueSdk()],
  ["chooseIcueSdk", () => api.chooseIcueSdk()],
  ["nextPreview", () => api.nextPreview(0)],
];

beforeEach(() => vi.mocked(invoke).mockClear());

describe("api", () => {
  it("finds the registered commands", () => {
    expect(registered.length).toBeGreaterThan(10);
    expect(registered).toContain("check_update");
  });

  it.each(calls)("%s calls a registered command with its argument names", async (name, call) => {
    // `nextPreview` decodes what comes back.
    if (name === "nextPreview") vi.mocked(invoke).mockResolvedValueOnce(new ArrayBuffer(0));
    await call().catch(() => {});
    expect(invoke).toHaveBeenCalledTimes(1);
    const [command, args] = vi.mocked(invoke).mock.calls[0] ?? [];
    expect(registered).toContain(command);
    const passed = Object.keys(args ?? {})
      .map(snake)
      .sort();
    expect(passed).toEqual(rustArgs(command as string).sort());
  });

  it("covers every registered command", () => {
    const used = new Set<string>();
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      used.add(cmd);
      return cmd === "next_preview" ? new ArrayBuffer(0) : null;
    });
    return Promise.all(calls.map(([, call]) => call().catch(() => {}))).then(() => {
      expect([...used].sort()).toEqual([...registered].sort());
    });
  });

  it("reads the app version", async () => {
    await expect(api.version()).resolves.toBe("1.2.3");
  });
});
