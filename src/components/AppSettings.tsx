import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { type UpdateStatus, useUpdates } from "../lib/updates";
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
        <UpdateSetting />
        <div className="app-settings-actions">
          <Dialog.Close render={<Button size="sm" />}>Done</Dialog.Close>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
