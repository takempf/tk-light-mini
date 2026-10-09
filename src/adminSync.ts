import { browserApi, type ServerSetup } from "./lib/browserApi";
import { testColor } from "./lib/calibration";
import { rgbHex } from "./lib/colors";
import type { CanvasSource, LightFrameSource, Settings } from "./lib/types";
import { DEFAULT_SETTINGS, useStore } from "./store";
import { startSync } from "./sync";

const scenes = new Set(["forest", "sunset", "aurora", "sea", "lava", "fire"]);

export function startAdminSession(
  onError: (message: string) => void,
  onReady: () => void,
): () => void {
  let active = true;
  let stopPreview = () => {};
  let unsubscribe = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: ServerSetup;
  let saving = false;
  let blocked = false;
  let calibrationTimer: ReturnType<typeof setInterval> | undefined;

  const publishCalibration = () => {
    const calibration = useStore.getState().calibrating;
    void browserApi
      .setCalibrationOverride(
        calibration?.id,
        calibration ? rgbHex(testColor(calibration.step)) : undefined,
        calibration?.raw,
      )
      .catch((error) => onError(error instanceof Error ? error.message : String(error)));
  };

  const snapshot = (): ServerSetup => {
    const state = useStore.getState();
    const { canvas, senderId } = state.settings;
    const source: ServerSetup["source"] = scenes.has(canvas)
      ? { kind: "scene", scene: canvas as Extract<LightFrameSource, { kind: "scene" }>["scene"] }
      : senderId
        ? {
            kind: "remote",
            senderId,
            ...(canvas === "phthalo" ? { filter: "phthalo" as const } : {}),
          }
        : current.source;
    return {
      ...current,
      devices: state.devices,
      enabled: state.enabled,
      source,
      fps: state.settings.fps,
      tuning: state.settings.tuning,
    };
  };

  const save = async () => {
    if (!active || blocked || saving) return;
    const next = snapshot();
    if (JSON.stringify({ ...next, revision: 0 }) === JSON.stringify({ ...current, revision: 0 }))
      return;
    saving = true;
    try {
      current = await browserApi.saveSetup(next, current.revision);
      onError("");
    } catch (error) {
      blocked = true;
      onError(
        error instanceof Error
          ? `${error.message}. Reload to restore the server setup.`
          : String(error),
      );
    } finally {
      saving = false;
      if (active && !blocked) timer = setTimeout(() => void save(), 100);
    }
  };

  void browserApi
    .getSetup()
    .then((setup) => {
      if (!active) return;
      current = setup;
      const canvas: CanvasSource =
        setup.source.kind === "scene" && scenes.has(setup.source.scene)
          ? (setup.source.scene as CanvasSource)
          : setup.source.kind === "remote" && setup.source.filter === "phthalo"
            ? "phthalo"
            : "screen";
      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        fps: setup.fps,
        canvas,
        tuning: setup.tuning,
        senderId: setup.source.kind === "remote" ? setup.source.senderId : undefined,
      };
      useStore.setState({ devices: setup.devices, enabled: setup.enabled, settings });
      browserApi.setPreviewTarget(useStore.getState().selection);
      stopPreview = startSync();
      unsubscribe = useStore.subscribe((state, previous) => {
        if (state.selection !== previous.selection) browserApi.setPreviewTarget(state.selection);
        if (state.calibrating !== previous.calibrating) publishCalibration();
        if (
          state.devices === previous.devices &&
          state.enabled === previous.enabled &&
          state.settings === previous.settings
        )
          return;
        clearTimeout(timer);
        timer = setTimeout(() => void save(), 250);
      });
      calibrationTimer = setInterval(() => {
        if (useStore.getState().calibrating) publishCalibration();
      }, 2000);
      onReady();
    })
    .catch((error) => onError(error instanceof Error ? error.message : String(error)));

  return () => {
    active = false;
    clearTimeout(timer);
    stopPreview();
    browserApi.setPreviewTarget(null);
    clearInterval(calibrationTimer);
    if (useStore.getState().calibrating) void browserApi.setCalibrationOverride();
    unsubscribe();
  };
}
