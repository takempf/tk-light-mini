import { useEffect } from "react";
import { Calibrator } from "./components/Calibrator";
import { Canvas } from "./components/Canvas";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { useStore } from "./store";
import { startSync } from "./sync";
import "./App.css";

export default function App() {
  const enabled = useStore((s) => s.enabled);
  const error = useStore((s) => s.status.error);

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
        <main className="layout">
          <Canvas />
          <Sidebar />
        </main>
      </div>
      <Calibrator />
    </div>
  );
}
