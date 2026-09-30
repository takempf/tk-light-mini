import { useEffect, useState } from "react";
import { api } from "../lib/api";
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
        <div className="app-settings-actions">
          <Dialog.Close render={<Button size="sm" />}>Done</Dialog.Close>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
