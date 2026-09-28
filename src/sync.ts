import { api } from "./lib/api";
import { toEngineConfig, useScreen, useStore, useZoneColors } from "./store";

/**
 * Wire the store to the Rust engine:
 * - push config on every relevant change (deduped)
 * - only stream preview colors while the window is visible
 * - send the screen image only while a path editor wants it
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

  let screenOn = false;
  const unsubScreen = useScreen.subscribe(({ watchers }) => {
    if (watchers > 0 === screenOn) return;
    screenOn = watchers > 0;
    api.setScreenPreview(screenOn).catch(() => {});
  });

  const onVisibility = () => {
    const visible = document.visibilityState === "visible";
    if (!visible) useZoneColors.setState({ colors: null, paths: {} });
    api.setPreview(visible).catch(() => {});
  };
  onVisibility();
  document.addEventListener("visibilitychange", onVisibility);

  const unlisten = [
    api.onZones((colors) => useZoneColors.setState({ colors })),
    api.onPaths((list) =>
      useZoneColors.setState({ paths: Object.fromEntries(list.map((p) => [p.ip, p.colors])) }),
    ),
    api.onScreen((image) => useScreen.setState({ image })),
    api.onStatus((status) => {
      useStore.setState({ status });
      if (!status.running) useZoneColors.setState({ colors: null, paths: {} });
    }),
  ];

  return () => {
    unsubStore();
    unsubScreen();
    document.removeEventListener("visibilitychange", onVisibility);
    for (const p of unlisten) p.then((fn) => fn()).catch(() => {});
  };
}
