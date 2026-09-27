import { api } from "./lib/api";
import { toEngineConfig, useStore, useZoneColors } from "./store";

/**
 * Wire the store to the Rust engine:
 * - push config on every relevant change (deduped)
 * - only stream preview colors while the window is visible
 * - mirror engine status / colors back into the stores
 */
export function startSync(): () => void {
  let last = "";
  const push = (s: ReturnType<typeof useStore.getState>) => {
    const cfg = toEngineConfig(s);
    const key = JSON.stringify(cfg);
    if (key === last) return;
    last = key;
    api.setConfig(cfg).catch((e) => console.error("set_config", e));
  };
  push(useStore.getState());
  const unsubStore = useStore.subscribe(push);

  const onVisibility = () => {
    const visible = document.visibilityState === "visible";
    if (!visible) useZoneColors.setState({ colors: null });
    api.setPreview(visible).catch(() => {});
  };
  onVisibility();
  document.addEventListener("visibilitychange", onVisibility);

  const unlisten = [
    api.onZones((colors) => useZoneColors.setState({ colors })),
    api.onStatus((status) => {
      useStore.setState({ status });
      if (!status.running) useZoneColors.setState({ colors: null });
    }),
  ];

  return () => {
    unsubStore();
    document.removeEventListener("visibilitychange", onVisibility);
    for (const p of unlisten) p.then((fn) => fn()).catch(() => {});
  };
}
