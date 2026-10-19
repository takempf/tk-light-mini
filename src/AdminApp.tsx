import { useEffect, useState } from "react";
import { startAdminSession } from "./adminSync";
import { Calibrator } from "./components/Calibrator";
import { Canvas } from "./components/Canvas";
import { Sidebar } from "./components/Sidebar";
import { browserApi } from "./lib/browserApi";
import { useStore } from "./store";
import "./App.css";

export default function AdminApp() {
  const [token, setToken] = useState(() => localStorage.getItem("tk-light-admin-token") ?? "");
  const [draft, setDraft] = useState(token);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [probeIp, setProbeIp] = useState("");
  const enabled = useStore((s) => s.enabled);
  const setEnabled = useStore((s) => s.setEnabled);
  const canvas = useStore((s) => s.settings.canvas);
  const senderId = useStore((s) => s.settings.senderId ?? "");
  const addDevice = useStore((s) => s.addDevice);

  useEffect(() => {
    if (!token) return;
    return startAdminSession(setError, () => setReady(true));
  }, [token]);

  if (!token)
    return (
      <main className="admin-login">
        <h1>Light control</h1>
        <p>Enter the admin token configured on the control server.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            localStorage.setItem("tk-light-admin-token", draft);
            setToken(draft);
          }}
        >
          <input
            aria-label="Admin token"
            type="password"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            required
          />
          <button type="submit">Connect</button>
        </form>
      </main>
    );
  return (
    <div className="app">
      <header className="admin-header">
        <strong>Light control</strong>
        {ready && (
          <>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void browserApi
                  .probeDevice(probeIp)
                  .then((device) => {
                    addDevice(device);
                    setProbeIp("");
                    setError("");
                  })
                  .catch((failure) => setError(String(failure)));
              }}
            >
              <input
                aria-label="Light IP"
                placeholder="Light IP"
                value={probeIp}
                onChange={(event) => setProbeIp(event.target.value)}
              />
              <button type="submit">Add by IP</button>
            </form>
            <label>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />{" "}
              Sync lights
            </label>
          </>
        )}
        <button
          type="button"
          onClick={() => {
            localStorage.removeItem("tk-light-admin-token");
            setToken("");
            setReady(false);
          }}
        >
          Disconnect
        </button>
      </header>
      {error && (
        <div className="banner error" role="alert">
          {error}{" "}
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}
      {ready && (
        <>
          {(canvas === "screen" || canvas === "phthalo") && !senderId && (
            <div className="banner">Choose a screen sender under Canvas to use this canvas.</div>
          )}
          <div className="content">
            <main className="layout">
              <Canvas />
              <Sidebar />
            </main>
          </div>
          <Calibrator />
        </>
      )}
    </div>
  );
}
