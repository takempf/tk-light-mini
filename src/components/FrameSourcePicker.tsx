import { useEffect, useState } from "react";
import { browserApi, type SenderStatus } from "../lib/browserApi";
import type { LightFrameSource } from "../lib/types";

const SCENES = ["forest", "sunset", "aurora", "sea", "lava", "fire"] as const;

export function FrameSourcePicker({
  value,
  onChange,
  label,
}: {
  value?: LightFrameSource;
  onChange: (value?: LightFrameSource) => void;
  label: string;
}) {
  const [senders, setSenders] = useState<SenderStatus[]>([]);
  useEffect(() => {
    const poll = () => {
      void browserApi
        .getStatus()
        .then((status) => setSenders(status.senders))
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, []);
  const selected = !value
    ? "room"
    : value.kind === "remote"
      ? `remote:${value.senderId}`
      : value.kind === "scene"
        ? `scene:${value.scene}`
        : "color";
  return (
    <div className="stack">
      <label>
        <span>{label}</span>
        <select
          value={selected}
          onChange={(event) => {
            const choice = event.target.value;
            if (choice === "room") onChange(undefined);
            else if (choice.startsWith("remote:"))
              onChange({
                kind: "remote",
                senderId: choice.slice(7),
                ...(value?.kind === "remote"
                  ? { filter: value.filter, fallback: value.fallback }
                  : {}),
              });
            else if (choice.startsWith("scene:")) {
              const scene = SCENES.find((s) => s === choice.slice(6));
              if (scene) onChange({ kind: "scene", scene });
            } else if (choice === "color") onChange({ kind: "color", color: "#ffffff" });
          }}
        >
          <option value="room">Room canvas</option>
          {value?.kind === "remote" && !senders.some((sender) => sender.id === value.senderId) && (
            <option value={`remote:${value.senderId}`}>{value.senderId} screen (offline)</option>
          )}
          {senders.map((sender) => (
            <option key={sender.id} value={`remote:${sender.id}`}>
              {sender.name} screen {sender.online ? "●" : "(offline)"}
            </option>
          ))}
          {SCENES.map((scene) => (
            <option key={scene} value={`scene:${scene}`}>
              {scene}
            </option>
          ))}
          <option value="color">Fixed color</option>
        </select>
      </label>
      {value?.kind === "color" && (
        <input
          aria-label="Source color"
          type="color"
          value={value.color}
          onChange={(event) =>
            onChange({ kind: "color", color: event.target.value as `#${string}` })
          }
        />
      )}
      {value?.kind === "remote" && (
        <>
          <label>
            <input
              type="checkbox"
              checked={value.filter === "phthalo"}
              onChange={(event) =>
                onChange({
                  ...value,
                  filter: event.target.checked ? "phthalo" : undefined,
                })
              }
            />{" "}
            Phthalo effect
          </label>
          <label>
            When offline
            <select
              value={value.fallback?.kind === "scene" ? value.fallback.scene : "forest"}
              onChange={(event) => {
                const scene = SCENES.find((s) => s === event.target.value);
                if (scene) onChange({ ...value, fallback: { kind: "scene", scene } });
              }}
            >
              {SCENES.map((scene) => (
                <option key={scene} value={scene}>
                  {scene}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </div>
  );
}
