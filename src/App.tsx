import { useEffect } from "react";
import { Lights } from "./components/Lights";
import { Screen } from "./components/Screen";
import { TitleBar } from "./components/TitleBar";
import { useStore } from "./store";
import { startSync } from "./sync";
import "./App.css";

export default function App() {
  const enabled = useStore((s) => s.enabled);
  const error = useStore((s) => s.status.error);
  const lightCount = useStore((s) => s.devices.length);

  useEffect(() => {
    const stop = startSync();
    const { scan, loadMonitors } = useStore.getState();
    void scan();
    void loadMonitors();
    return stop;
  }, []);

  return (
    <div className="app">
      <TitleBar />
      <div className="content">
        {error && enabled && <p className="banner error">Capture: {error}</p>}
        {enabled && lightCount === 0 && (
          <p className="banner hint">Add a light to start painting your wall.</p>
        )}
        <main className="grid">
          <Screen />
          <Lights />
        </main>
      </div>
    </div>
  );
}
