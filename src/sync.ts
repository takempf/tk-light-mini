import { api } from "./lib/api";
import { screenAspect, toEngineConfig, useLive, useScreen, useStore } from "./store";

/**
 * Wire the store to the Rust engine:
 * - push config on every relevant change (deduped), and when the screen's
 *   shape changes, since fitted paths follow it
 * - only stream preview colors while the window is visible
 * - mirror engine status / colors back into the stores
 */
export function startSync(): () => void {
  let last = "";
  const push = () => {
    const cfg = toEngineConfig(useStore.getState(), screenAspect());
    const key = JSON.stringify(cfg);
    if (key === last) return;
    last = key;
    api.setConfig(cfg).catch((e) => console.error("set_config", e));
  };
  push();
  const unsubStore = useStore.subscribe(push);
  const unsubScreen = useScreen.subscribe(push);

  const onVisibility = () => {
    const visible = document.visibilityState === "visible";
    if (!visible) useLive.setState({ paths: {} });
    api.setPreview(visible).catch(() => {});
  };
  onVisibility();
  document.addEventListener("visibilitychange", onVisibility);

  const unlisten = [
    api.onPaths((list) =>
      useLive.setState({ paths: Object.fromEntries(list.map((p) => [p.ip, p.colors])) }),
    ),
    api.onScreen((image) => useScreen.setState({ image })),
    api.onStatus((status) => {
      useStore.setState({ status });
      if (!status.running) useLive.setState({ paths: {} });
    }),
  ];

  return () => {
    unsubStore();
    unsubScreen();
    document.removeEventListener("visibilitychange", onVisibility);
    for (const p of unlisten) p.then((fn) => fn()).catch(() => {});
  };
}
