# tk-light-mini

Makes your Govee lights match what's on your screen, so the wall behind the TV glows with the picture. Windows only.

It's built to stay out of the way. If you're gaming, it shouldn't cost you frames.

## Using it

1. In the Govee Home app, turn on **LAN Control** for each light, then unplug the light for about 10 seconds to restart it.
2. Open the app. It scans your network on launch. Click **Add** next to a light.
3. Pick a zone for each light: **Top**, **Left**, **Bottom**, **Right** or **All**. A strip behind the top of the TV gets Top, a lamp to the left gets Left, and so on.
4. Flip the switch in the title bar to **Syncing**.

Turning sync off leaves the lights on their last color. **Lights off**, next to the switch, stops syncing and switches them off. Turning sync back on turns them on again.

Click a light to open it. Inside you can rename it, pick its zone, set its own brightness, and **Identify** it (it pulses hot pink at full brightness so you can tell which one it is). The Tuning sliders adjust brightness, saturation, smoothing (how slowly colors fade), edge depth (how far in from the screen edge to sample) and sample rate.

Your lights and settings are saved between launches.

### Light not showing up?

- Make sure LAN Control is on in the Govee app, and restart the light afterwards.
- The light and the PC have to be on the same subnet. Guest networks, IoT networks and some mesh setups block this.
- Allow the app through Windows Firewall when it asks. Scan replies come in on UDP port 4002.

## How it works

About 30 times a second:

1. **Capture.** Windows' desktop duplication API grabs the screen. The frame stays on the GPU, which shrinks it to about 120px wide. Only that tiny image is copied back to the CPU, one frame later, so the CPU never waits on the GPU.
2. **Pick colors.** For each edge and for the whole screen, it:
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

## Limits

- Windows only for now. Capture uses DXGI.
- HDR screens get converted to 8-bit by Windows, so colors can look a bit flat with HDR on.
- One color per light. Strips with separately controllable segments aren't used segment by segment yet.
