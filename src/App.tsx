import { useEffect } from "react";
import { Calibrator } from "./components/Calibrator";
import { Canvas } from "./components/Canvas";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { startUpdateChecks } from "./lib/updates";
import { useStore } from "./store";
import { startSync } from "./sync";
import "./App.css";

export default function App() {
  const enabled = useStore((s) => s.enabled);
  const error = useStore((s) => s.status.error);

  useEffect(() => {
    const stopSync = startSync();
    const stopUpdates = startUpdateChecks();
    const { scan, loadMonitors } = useStore.getState();
    void scan();
    void loadMonitors();
    return () => {
      stopSync();
      stopUpdates();
    };
  }, []);

  return (
    <div className="app">
      <TitleBar />
      <div className="content">
        {error && enabled && <p className="banner error">Capture: {error}</p>}
        <main className="layout">
          <Canvas />
          <Sidebar />
        </main>
      </div>
      <Calibrator />
    </div>
  );
}
