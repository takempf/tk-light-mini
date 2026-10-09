import { invoke } from "@tauri-apps/api/core";
import { FRAME_HEADER_BYTES } from "../../../packages/protocol/src/index";
import "./style.css";

interface Monitor {
  index: number;
  name: string;
  width: number;
  height: number;
}
interface Settings {
  server: string;
  token: string;
  id: string;
  name: string;
  monitor: number;
}
const key = "tk-light-screen-sender";
let saved: Partial<Settings> = {};
try {
  saved = JSON.parse(localStorage.getItem(key) ?? "{}") as Partial<Settings>;
} catch {
  /* A damaged local preference should not prevent connecting. */
}
const settings: Settings = {
  server: saved.server ?? "http://127.0.0.1:8787",
  token: saved.token ?? "",
  id: saved.id ?? "office-pc",
  name: saved.name ?? "Office PC",
  monitor: saved.monitor ?? 0,
};
const app = document.getElementById("app") as HTMLElement;
app.innerHTML = `
  <h1>Screen sender</h1>
  <p>Publish a small copy of one screen to your light control server.</p>
  <form id="settings">
    <label>Server URL <input name="server" type="url" required /></label>
    <label>Sender token <input name="token" type="password" required /></label>
    <label>Sender ID <input name="id" pattern="[A-Za-z0-9_-]{1,64}" required /></label>
    <label>Display name <input name="name" maxlength="80" required /></label>
    <label>Monitor <select name="monitor"></select></label>
    <label class="check"><input name="autostart" type="checkbox" /> Start with Windows</label>
    <button type="submit">Save and connect</button>
  </form>
  <p id="status" role="status">Connecting…</p>
`;
const form = document.getElementById("settings") as HTMLFormElement;
const status = document.getElementById("status") as HTMLElement;
const monitorSelect = form.elements.namedItem("monitor") as HTMLSelectElement;
const autostart = form.elements.namedItem("autostart") as HTMLInputElement;
void invoke<boolean>("autostart").then((enabled) => {
  autostart.checked = enabled;
});
for (const [name, value] of Object.entries(settings)) {
  const field = form.elements.namedItem(name) as HTMLInputElement | null;
  if (field && name !== "monitor") field.value = String(value);
}

let socket: WebSocket | null = null;
let lastSeq = 0;
let active = true;
let polling = false;
let availableMonitors: Monitor[] = [];

function setStatus(value: string) {
  status.textContent = value;
}
function endpoint(url: string) {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/api/publish";
  parsed.search = "";
  return parsed.toString();
}
function connect() {
  socket?.close();
  void invoke("stop_capture");
  if (!settings.token) {
    setStatus("Enter a sender token to connect.");
    return;
  }
  try {
    socket = new WebSocket(endpoint(settings.server));
  } catch (error) {
    setStatus(String(error));
    return;
  }
  const ws = socket;
  setStatus("Connecting…");
  ws.onopen = () =>
    ws.send(JSON.stringify({ token: settings.token, id: settings.id, name: settings.name }));
  ws.onmessage = (event) => {
    try {
      if (JSON.parse(String(event.data)).ok) {
        if (availableMonitors.length) {
          setStatus("Connected and publishing");
          void chooseMonitor(settings.monitor).catch((error) =>
            setStatus(`Capture error: ${error}`),
          );
        } else setStatus("Connected; no monitor available.");
      }
    } catch {
      /* Only the first server message is JSON. */
    }
  };
  ws.onclose = () => {
    if (active && socket === ws) {
      void invoke("stop_capture");
      setStatus("Disconnected; retrying…");
      setTimeout(connect, 2000);
    }
  };
  ws.onerror = () => setStatus("Connection error");
}

async function chooseMonitor(index: number) {
  await invoke("set_monitor", { index });
  lastSeq = 0;
}

void invoke<Monitor[]>("list_monitors")
  .then((monitors) => {
    availableMonitors = monitors;
    monitorSelect.replaceChildren(
      ...monitors.map((m) => {
        const option = document.createElement("option");
        option.value = String(m.index);
        option.textContent = `${m.name} (${m.width}×${m.height})`;
        return option;
      }),
    );
    if (monitors.some((m) => m.index === settings.monitor))
      monitorSelect.value = String(settings.monitor);
    else if (monitors[0]) settings.monitor = monitors[0].index;
    if (!monitors.length) setStatus("No Windows monitors available.");
  })
  .catch((error) => setStatus(`Capture unavailable: ${error}`))
  .finally(() => {
    if (settings.token && !socket) connect();
  });

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  settings.server = String(data.get("server") ?? "");
  settings.token = String(data.get("token") ?? "");
  settings.id = String(data.get("id") ?? "");
  settings.name = String(data.get("name") ?? "");
  settings.monitor = Number(data.get("monitor") ?? 0);
  localStorage.setItem(key, JSON.stringify(settings));
  void invoke("set_autostart", { on: autostart.checked }).catch((error) =>
    setStatus(`Startup setting: ${error}`),
  );
  connect();
});

setInterval(async () => {
  const ws = socket;
  if (polling || !ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 300_000) return;
  polling = true;
  try {
    const data = await invoke<ArrayBuffer>("next_frame", { after: lastSeq });
    if (data.byteLength < FRAME_HEADER_BYTES || ws.readyState !== WebSocket.OPEN) return;
    const view = new DataView(data);
    lastSeq = view.getUint32(8, true);
    ws.send(data);
  } catch (error) {
    setStatus(`Capture error: ${error}`);
  } finally {
    polling = false;
  }
}, 33);

window.addEventListener("beforeunload", () => {
  active = false;
  socket?.close();
  void invoke("stop_capture");
});
