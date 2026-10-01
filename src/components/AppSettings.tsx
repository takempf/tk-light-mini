import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { IcueStatus } from "../lib/types";
import { type UpdateStatus, useUpdates } from "../lib/updates";
import { useStore } from "../store";
import { Button, Dialog, Icon, Switch } from "../ui";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Start with Windows. Read fresh each time the dialog opens. */
function StartupSetting() {
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .autostart()
      .then((v) => live && setOn(v))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, []);

  const change = (next: boolean) => {
    setError(null);
    setOn(next);
    // Show what Windows ended up with, not what was asked.
    api
      .setAutostart(next)
      .then(() => api.autostart())
      .then(setOn)
      .catch((e) => {
        setOn(!next);
        setError(errorText(e));
      });
  };

  return (
    <div>
      <Switch checked={on ?? false} disabled={on === null} onCheckedChange={change}>
        Start with Windows
      </Switch>
      <p className="setting-hint">Opens in the tray when you sign in.</p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/**
 * Lights through iCUE need Corsair's SDK file, which the app can't ship.
 * Get it here, from Corsair's release or a copy the user has.
 */
function IcueSetting() {
  const [status, setStatus] = useState<IcueStatus | null>(null);
  const [busy, setBusy] = useState<"download" | "choose" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .icueStatus()
      .then((s) => live && setStatus(s))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, []);

  const get = async (how: "download" | "choose") => {
    setError(null);
    setBusy(how);
    try {
      if (how === "download") await api.downloadIcueSdk();
      // False if the user cancelled the dialog.
      const got = how === "download" || (await api.chooseIcueSdk());
      if (got) {
        setStatus(await api.icueStatus());
        // Find the lights it opens up.
        void useStore.getState().scan();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="icue-setting">
      <div>Corsair iCUE</div>
      {status?.sdk ? (
        <p className="setting-hint">Ready. Corsair lights show up when you scan.</p>
      ) : (
        status && (
          <>
            <p className="setting-hint">
              For Corsair fans, coolers and RAM, the app needs Corsair's SDK file,{" "}
              <code>iCUESDK.x64_2019.dll</code>. Corsair's license doesn't let the app include it.
              Download it from Corsair's GitHub release, or pick the file if you have it.
            </p>
            <div className="icue-actions">
              <Button size="sm" disabled={busy !== null} onClick={() => void get("download")}>
                {busy === "download" ? "Downloading…" : "Download from Corsair"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => void get("choose")}
              >
                Choose file…
              </Button>
            </div>
          </>
        )
      )}
      {status && !status.icue && (
        <p className="setting-hint">iCUE isn't installed. Install it from corsair.com too.</p>
      )}
      {error && <p className="setting-hint error">{error}</p>}
    </div>
  );
}

function updateText(status: UpdateStatus): string | null {
  switch (status.kind) {
    case "idle":
      return null;
    case "checking":
      return "Checking for updates…";
    case "latest":
      return "You have the latest version.";
    case "ready":
      return status.error
        ? `Couldn't install version ${status.update.version}: ${status.error}`
        : `Version ${status.update.version} is ready to install.`;
    case "installing":
      return `Installing version ${status.update.version}…`;
    case "error":
      return `Couldn't check for updates: ${status.message}`;
  }
}

/** This version, updates and whether to look for them on their own. */
function UpdateSetting() {
  const [version, setVersion] = useState<string | null>(null);
  const { status, auto, setAuto, check, install } = useUpdates();

  useEffect(() => {
    let live = true;
    api
      .version()
      .then((v) => live && setVersion(v))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const text = updateText(status);
  const failed = status.kind === "error" || (status.kind === "ready" && status.error);
  const notes = status.kind === "ready" ? status.update.notes : null;
  return (
    <div className="update-setting">
      <div className="update-row">
        <div>
          <div>Version {version ?? "…"}</div>
          {text && (
            <p className={failed ? "setting-hint error" : "setting-hint"} role="status">
              {text}
            </p>
          )}
        </div>
        {status.kind === "ready" || status.kind === "installing" ? (
          <Button
            size="sm"
            variant="primary"
            disabled={status.kind === "installing"}
            onClick={() => void install()}
          >
            Restart to update
          </Button>
        ) : (
          <Button size="sm" disabled={status.kind === "checking"} onClick={() => void check()}>
            Check for updates
          </Button>
        )}
      </div>
      {notes && <p className="update-notes">{notes}</p>}
      <Switch checked={auto} onCheckedChange={setAuto}>
        Check for updates automatically
      </Switch>
    </div>
  );
}

/** The settings button in the title bar, and its dialog. */
export function AppSettings() {
  return (
    <Dialog.Root>
      <Dialog.Trigger render={<Button variant="ghost" size="sm" square aria-label="Settings" />}>
        <Icon name="sliders" />
      </Dialog.Trigger>
      <Dialog.Popup size="sm" className="app-settings">
        <Dialog.Title>Settings</Dialog.Title>
        <StartupSetting />
        <IcueSetting />
        <UpdateSetting />
        <div className="app-settings-actions">
          <Dialog.Close render={<Button size="sm" />}>Done</Dialog.Close>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
