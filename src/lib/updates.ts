/**
 * App updates. The backend checks GitHub releases and downloads a newer one;
 * this tracks where that's at and checks on a timer, if the user lets it.
 */
import { create } from "zustand";
import { api } from "./api";
import { flushSaves, readSaved, saveLater } from "./storage";
import type { UpdateInfo } from "./types";

/** The first check waits for launch to settle. */
export const FIRST_CHECK_MS = 10_000;
/** Then checks this often, since the app can sit in the tray for days. */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/** Whether to check on a timer, saved apart from the lights. */
export const AUTO_KEY = "tk-light-mini-auto-update";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest" }
  /** Downloaded. `error` says why the last install failed. */
  | { kind: "ready"; update: UpdateInfo; error?: string }
  | { kind: "installing"; update: UpdateInfo }
  | { kind: "error"; message: string };

interface UpdatesState {
  status: UpdateStatus;
  /** Check at launch and every few hours. */
  auto: boolean;
  setAuto: (on: boolean) => void;
  /** Look for an update and download it. Does nothing while busy or once one is ready. */
  check: () => Promise<void>;
  /** Install the ready update. The app restarts into it. */
  install: () => Promise<void>;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useUpdates = create<UpdatesState>()((set, get) => ({
  status: { kind: "idle" },
  auto: readSaved(AUTO_KEY) !== "false",
  setAuto: (on) => {
    set({ auto: on });
    saveLater(AUTO_KEY, () => String(on));
    if (on) void get().check();
  },
  check: async () => {
    const { kind } = get().status;
    if (kind === "checking" || kind === "ready" || kind === "installing") return;
    set({ status: { kind: "checking" } });
    try {
      const update = await api.checkUpdate();
      set({ status: update ? { kind: "ready", update } : { kind: "latest" } });
    } catch (e) {
      set({ status: { kind: "error", message: errorText(e) } });
    }
  },
  install: async () => {
    const status = get().status;
    if (status.kind !== "ready") return;
    // The app exits mid-install, before edits still settling would save.
    flushSaves();
    set({ status: { kind: "installing", update: status.update } });
    try {
      await api.installUpdate();
    } catch (e) {
      set({ status: { kind: "ready", update: status.update, error: errorText(e) } });
    }
  },
}));

/** Check soon after launch and then every few hours, while `auto` is on. */
export function startUpdateChecks(): () => void {
  const tick = () => {
    const { auto, check } = useUpdates.getState();
    if (auto) void check();
  };
  const first = setTimeout(tick, FIRST_CHECK_MS);
  const every = setInterval(tick, CHECK_EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
