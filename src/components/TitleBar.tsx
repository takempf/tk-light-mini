import { useEffect, useRef, useState } from "react";
import appIcon from "../../src-tauri/icons/32x32.png";
import bigIcon from "../../src-tauri/icons/128x128.png";
import { api } from "../lib/api";
import { flushSaves } from "../lib/storage";
import { useUpdates } from "../lib/updates";
import { useScreen, useStore } from "../store";
import { Button, Logo, Switch } from "../ui";
import { AppSettings } from "./AppSettings";

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

function TitleToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="titlebar-toggle">
      <span className="titlebar-toggle-name">{label}</span>
      <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange}>
        <span className="titlebar-toggle-state">{checked ? "On" : "Off"}</span>
      </Switch>
    </div>
  );
}

/** Shows once an update has downloaded. */
function UpdateButton() {
  const status = useUpdates((s) => s.status);
  const install = useUpdates((s) => s.install);
  if (status.kind !== "ready" && status.kind !== "installing") return null;
  const label = `Restart to update to version ${status.update.version}`;
  return (
    <Button
      size="sm"
      variant="primary"
      aria-label={label}
      title={label}
      disabled={status.kind === "installing"}
      onClick={() => void install()}
    >
      Update
    </Button>
  );
}

/** CSS pixels, as in `.titlebar-icon`. */
const ICON_SIZE = 24;
/** The app icon's screen in `icons/icon.svg` (1024 wide): x, y, width, height, radius. */
const SCREEN = [161, 213, 702, 486.2, 52] as const;

let iconImage: Promise<HTMLImageElement> | undefined;
const loadIcon = () => {
  if (!iconImage) {
    const img = new Image();
    img.src = bigIcon;
    iconImage = img.decode().then(() => img);
  }
  return iconImage;
};

/** The canvas on the app icon's screen, like the tray and taskbar icons. */
function TitleIcon() {
  const image = useScreen((s) => s.image);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = image && canvas?.getContext("2d");
    if (!image || !canvas || !ctx) return;
    let live = true;
    const frame = createImageBitmap(new ImageData(image.rgba, image.width, image.height));
    void Promise.all([loadIcon(), frame]).then(([icon, bmp]) => {
      if (live) {
        const size = canvas.width;
        const [x, y, w, h, r] = SCREEN.map((v) => (v * size) / 1024) as [
          number,
          number,
          number,
          number,
          number,
        ];
        ctx.clearRect(0, 0, size, size);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(icon, 0, 0, size, size);
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        ctx.clip();
        ctx.drawImage(bmp, x, y, w, h);
        ctx.restore();
      }
      bmp.close();
    });
    return () => {
      live = false;
    };
  }, [image]);
  if (!image) return <img className="titlebar-icon" src={appIcon} alt="" />;
  const px = Math.round(ICON_SIZE * window.devicePixelRatio);
  return <canvas ref={ref} className="titlebar-icon" width={px} height={px} aria-hidden />;
}

/**
 * The app's own title bar, in place of the native one (decorations are off).
 * Empty space drags the window; double-clicking it maximizes. Only elements with
 * `data-tauri-drag-region` drag, so decoration inside passes clicks through.
 */
export function TitleBar() {
  const enabled = useStore((s) => s.enabled);
  const setEnabled = useStore((s) => s.setEnabled);
  const setAllPower = useStore((s) => s.setAllPower);
  const hasLights = useStore((s) => s.devices.length > 0);
  const lightsOn = useStore((s) => s.devices.some((d) => d.on));
  const maximized = useMaximized();
  const focused = useWindowFocused();

  return (
    <header className="titlebar" data-tauri-drag-region data-focused={focused || undefined}>
      <div className="titlebar-brand">
        <TitleIcon />
        <span className="titlebar-name">
          <Logo label="" className="titlebar-logo" />
          <span>light mini</span>
        </span>
      </div>
      <div className="titlebar-actions">
        <UpdateButton />
        <TitleToggle
          label="Lights"
          checked={lightsOn}
          disabled={!hasLights}
          onChange={(on) => void setAllPower(on).catch((e) => console.error("set_all_power", e))}
        />
        <TitleToggle label="Syncing" checked={enabled} onChange={setEnabled} />
        <AppSettings />
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
          onClick={() => {
            // Edits still settling would be lost.
            flushSaves();
            api.close().catch(() => {});
          }}
        >
          <Glyph d={GLYPHS.close} />
        </button>
      </div>
    </header>
  );
}
