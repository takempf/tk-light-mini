# tk-light-mini

Makes your Govee lights match what's on your screen, so the wall behind the TV glows with the picture. Windows only.

It's built to stay out of the way. If you're gaming, it shouldn't cost you frames.

## Using it

1. In the Govee Home app, turn on **LAN Control** for each light, then unplug the light for about 10 seconds to restart it.
2. Open the app. It scans your network on launch. Click **Add** next to a light.
3. Pick a color for each light. The **Screen** colors follow the picture: **Top**, **Right**, **Bottom**, **Left**, **Center** (inside the edges) or **Average** (the whole screen). A strip behind the top of the TV gets Top, a lamp to the left gets Left, and so on. The **Rainbow** colors stay fixed.
4. Flip the switch in the title bar to **Syncing**.

Turning sync off leaves the lights on their last color. **Lights off**, next to the switch, stops syncing and switches them off. Turning sync back on turns them on again.

Each light has its own on/off switch. An off light is switched off and left out of syncing until you turn it back on.

Click a light to open it. Inside you can rename it, pick its color, set its own brightness, and **Identify** it (it pulses hot pink at full brightness so you can tell which one it is). The Tuning sliders adjust brightness, saturation, smoothing (how slowly colors fade), edge depth (how far in from the screen edge to sample) and sample rate.

Your lights and settings are saved between launches.

### Light not showing up?

- Make sure LAN Control is on in the Govee app, and restart the light afterwards.
- The light and the PC have to be on the same subnet. Guest networks, IoT networks and some mesh setups block this.
- Allow the app through Windows Firewall when it asks. Scan replies come in on UDP port 4002.

## How it works

About 30 times a second:

1. **Capture.** Windows' desktop duplication API grabs the screen. The frame stays on the GPU, which shrinks it to about 120px wide. Only that tiny image is copied back to the CPU, one frame later, so the CPU never waits on the GPU.
2. **Pick colors.** For each edge, the center, the whole screen, and each segment of each light's path, it:
   - ignores black letterbox bars
   - averages in linear light
   - lets bright, saturated pixels set the hue, so a dim background doesn't wash it out
   - keeps brightness true to the scene
3. **Smooth.** Colors fade toward their target at the same speed whatever the frame rate.
4. **Send.** Each light gets its color over UDP (Govee's LAN API). It only sends when the color changes, plus once a second in case a packet gets lost.

The capture thread and its GPU work both run at low priority, so the game always goes first. The preview in the window only updates while the window is visible.

## Stack

- **Tauri 2** (Rust) for the app and all the heavy lifting
- **React 19 + TypeScript + Vite** for the UI
- **[tk-design-system](https://github.com/takempf/tk-design-system)** (base theme) for components and styling. It has no build on git, so `src/ui.ts` imports its source
- A custom title bar (`src/components/TitleBar.tsx`): native decorations are off and the app draws its own, like VS Code and Discord
- **Zustand** for state, saved to local storage
- **Biome** for lint and formatting, **Vitest** for frontend tests, `cargo test` for Rust

```
src/                 React UI, store, IPC wrapper
src-tauri/src/
  capture.rs         DXGI capture + GPU downscale
  zones.rs           color extraction + smoothing
  paths.rs           per-segment sampling along drawn paths
  govee.rs           LAN discovery and control
  engine.rs          the capture -> color -> send loop
  lib.rs             Tauri commands
```

## Development

Needs Node 22+, pnpm and a recent Rust toolchain (via rustup).

```sh
pnpm install
pnpm tauri dev      # run the app
pnpm tauri build    # make an installer
pnpm check          # lint, typecheck, frontend tests and Rust tests
```

Tests that need real hardware are skipped by default:

```sh
cd src-tauri
cargo test -- --ignored live_capture --nocapture    # grab a real frame
cargo test -- --ignored live_scan_raw --nocapture   # print every Govee scan reply
```

## Experimental: razer streaming

Some lights fade slowly between colors on their own (the H61F5 takes about 3 seconds), so sync lags behind the picture.

Each light's panel has a **Razer streaming** switch. With it on, the app talks to the light in the mode Govee's DreamView and Razer Chroma use (undocumented, same as [LedFx](https://github.com/LedFx/LedFx)). Colors land at once, with no fade, so set Smoothing to taste. Lights that don't support it just stop changing, so switch it back off.

In razer mode each segment can have its own color. Set **Segments** to the light's segment count, and a bar shows one cell per segment. Click cells to select them (shift-click for a range), then pick a color: it goes to just those segments. With nothing selected, the color goes to the whole light and replaces any per-segment colors. Screen colors keep following the picture.

## Paths: sample exactly where the light is

Zones are broad. A path says exactly which part of the screen each segment of a light reflects.

Open a light and click **Draw path**. You get the screen as the app sees it (about 120 pixels wide), and you draw a line on it:

- Click to add points, starting where the strip starts. Drag a point to move it. Right-click it, or select it and press Delete, to remove it.
- **Thickness** sets how wide a band along the line is sampled.
- **Edge loop** draws a loop around the screen edge, starting at the bottom right and going up. **Reverse** flips the direction, and **Closed loop** joins the end back to the start.

The band is split along its length into one piece per segment, numbered from the start, each shown in its live color. A new path switches the light to the **Path** color (in the Screen palette), so segment 1 shows piece 1, and so on. You can still set single segments to other colors. Without razer streaming, the whole path is one color for the whole light.

Each pixel near the path goes to the nearest point on it, so at a corner a pixel counts once, for the nearer side. The editor keeps the screen capture running even while sync is off, but only sends to lights while syncing.

When sync stops or the switch goes off, the light goes back to its normal mode.

Found on a ~4.5 m H61F5: 10 segments, a 3 s built-in fade on normal commands, none in razer mode. Its firmware already uses the white LEDs for plain RGB colors.

Probes, with the light's IP in `GOVEE_IP`:

```sh
cd src-tauri
cargo test -- --ignored live_razer --nocapture      # red, green, blue, white in razer mode
cargo test -- --ignored live_pt_ruler --nocapture   # ptReal: segments 0-4 red, 5-9 green, 10-14 blue
cargo test -- --ignored live_pt_walk --nocapture    # ptReal: one segment walks the strip
```

## Limits

- Windows only for now. Capture uses DXGI.
- HDR screens get converted to 8-bit by Windows, so colors can look a bit flat with HDR on.
- Per-segment colors need razer streaming. Other lights get one color.
