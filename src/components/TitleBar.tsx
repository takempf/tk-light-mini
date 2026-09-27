import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../store";
import { Button, Logo, Switch } from "../ui";

/** Windows caption glyphs, drawn on the same 16-unit grid as tk icons. */
const GLYPHS = {
  minimize: "M3 8.5h10",
  maximize: "M3.5 3.5h9v9h-9z",
  restore: "M3.5 5.5h7v7h-7zM5.5 5.5v-2h7v7h-2",
  close: "M3.5 3.5l9 9M12.5 3.5l-9 9",
} as const;

function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" width="1em" height="1em" className="tk-icon" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function useMaximized() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let live = true;
    const check = () =>
      api
        .isMaximized()
        .then((m) => live && setMaximized(m))
        .catch(() => {});
    void check();
    const unlisten = api.onResized(check).catch(() => undefined);
    return () => {
      live = false;
      void unlisten.then((stop) => stop?.());
    };
  }, []);
  return maximized;
}

function useWindowFocused() {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("focus", on);
      window.removeEventListener("blur", off);
    };
  }, []);
  return focused;
}

/**
 * The app's own title bar, in place of the native one (decorations are off).
 * Empty space drags the window; double-clicking it maximizes. Only elements with
 * `data-tauri-drag-region` drag, so decoration inside passes clicks through.
 */
export function TitleBar() {
  const enabled = useStore((s) => s.enabled);
  const setEnabled = useStore((s) => s.setEnabled);
  const lightsOff = useStore((s) => s.lightsOff);
  const hasLights = useStore((s) => s.devices.length > 0);
  const maximized = useMaximized();
  const focused = useWindowFocused();

  return (
    <header className="titlebar" data-tauri-drag-region data-focused={focused || undefined}>
      <div className="titlebar-brand">
        <Logo label="" size="0.7em" />
        <span>light mini</span>
      </div>
      <div className="titlebar-actions">
        <Button
          variant="ghost"
          size="sm"
          disabled={!hasLights}
          onClick={() => lightsOff().catch((e) => console.error("lights_off", e))}
        >
          Lights off
        </Button>
        <Switch checked={enabled} onCheckedChange={setEnabled}>
          {enabled ? "Syncing" : "Off"}
        </Switch>
      </div>
      <div className="window-controls">
        <button type="button" aria-label="Minimize" onClick={() => api.minimize().catch(() => {})}>
          <Glyph d={GLYPHS.minimize} />
        </button>
        <button
          type="button"
          aria-label={maximized ? "Restore" : "Maximize"}
          onClick={() => api.toggleMaximize().catch(() => {})}
        >
          <Glyph d={maximized ? GLYPHS.restore : GLYPHS.maximize} />
        </button>
        <button
          type="button"
          aria-label="Close"
          className="close"
          onClick={() => api.close().catch(() => {})}
        >
          <Glyph d={GLYPHS.close} />
        </button>
      </div>
    </header>
  );
}
