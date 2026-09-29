import { api } from "./lib/api";
import { mergePaths, type Preview } from "./lib/preview";
import type { ScreenImage } from "./lib/types";
import { screenAspect, toEngineConfig, useLive, useScreen, useStore } from "./store";

/** Wait before polling again after a failed poll. */
const RETRY_MS = 1000;

const aspectOf = (image: ScreenImage | null) => (image ? image.width / image.height : undefined);

/**
 * Wire the store to the Rust engine:
 * - push config on every relevant change (deduped), and when the screen's
 *   shape changes, since fitted paths follow it
 * - only poll preview colors and the screen while the window is visible
 * - mirror engine status / colors back into the stores
 */
export function startSync(): () => void {
  let last = "";
  let active = true;
  const push = () => {
    const cfg = toEngineConfig(useStore.getState(), screenAspect());
    const key = JSON.stringify(cfg);
    if (key === last) return;
    last = key;
    api.setConfig(cfg).catch((e) => console.error("set_config", e));
  };
  push();
  const unsubStore = useStore.subscribe(push);
  // Frames arrive several times a second; only a new shape moves fitted paths.
  const unsubScreen = useScreen.subscribe((s, prev) => {
    if (aspectOf(s.image) !== aspectOf(prev.image)) push();
  });

  const apply = (msg: Preview) => {
    if (msg.status) {
      useStore.setState({ status: msg.status });
      if (!msg.status.running) useLive.setState({ paths: {} });
    }
    if (msg.paths) {
      const prev = useLive.getState().paths;
      const paths = mergePaths(prev, msg.paths);
      if (paths !== prev) useLive.setState({ paths });
    }
    if (msg.image) useScreen.setState({ image: msg.image });
  };

  let visible = false;
  let polling = false;
  /** The last message's number; 0 asks for everything. */
  let after = 0;
  const poll = async () => {
    if (polling) return;
    polling = true;
    while (active && visible) {
      const from = after;
      let msg: Preview;
      try {
        msg = await api.nextPreview(from);
      } catch (e) {
        console.error("next_preview", e);
        await new Promise((r) => setTimeout(r, RETRY_MS));
        continue;
      }
      // Hidden, or hidden and shown again, meanwhile: ask again from scratch.
      if (!active || !visible || after !== from) continue;
      after = msg.seq;
      apply(msg);
    }
    polling = false;
  };

  const onVisibility = () => {
    visible = document.visibilityState === "visible";
    // Hidden, nothing shows the colors. Shown, everything comes again.
    if (!visible) useLive.setState({ paths: {} });
    after = 0;
    api.setPreview(visible).catch(() => {});
    if (visible) void poll();
  };
  document.addEventListener("visibilitychange", onVisibility);
  onVisibility();

  return () => {
    active = false;
    unsubStore();
    unsubScreen();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
