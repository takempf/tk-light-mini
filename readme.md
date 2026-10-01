# tk-light-mini

Makes your Govee lights match what's on your screen, so the wall behind the TV glows with the picture. Windows only.

It's built to stay out of the way. If you're gaming, it shouldn't cost you frames.

## Install

Download `tk-light-mini_x.y.z_x64-setup.exe` from the [latest release](https://github.com/takempf/tk-light-mini/releases/latest) and run it. It installs for your user only, with no admin prompt. The installer isn't code-signed, so Windows SmartScreen may warn about an unknown publisher: click **More info**, then **Run anyway**.

### Updates

The app checks for a new version shortly after it starts, then every 6 hours. A new version downloads in the background, and then **Update** shows in the title bar. Click it to restart into the new version. In **Settings** you can see your version, check now, and switch automatic checks off. The app only installs updates signed with its own key.

## Using it

1. In the Govee Home app, turn on **LAN Control** for each light, then unplug the light for about 10 seconds to restart it.
2. Open the app. It scans your network on launch. Click **Add** next to a light. It starts out as a loop around the edge of the screen.
3. Place each light on the screen where it sits in the room. A strip behind the top of the TV goes along the top edge, a lamp to the left goes on the left, and so on. The light takes its color from the picture under its band.
4. Flip the switch in the title bar to **Syncing**.

Turning sync off leaves the lights on their last color. **Lights off**, next to the switch, stops syncing and switches them off. Turning sync back on turns them on again.

Each light has its own on/off switch. An off light is switched off and left out of syncing until you turn it back on. While syncing, the app keeps its other lights on: one switched off in the Govee app or with its own button comes back on within 10 seconds, so use the switch here instead.

Click a light, in the list or on the screen, to open it. Inside you can rename it, set its own brightness, and **Identify** it (it pulses hot pink at full brightness so you can tell which one it is). **Canvas** makes it follow the canvas: your screen, unless you pick a scene. The other colors stay fixed.

### Placing lights

The big canvas shows every light as a band over a live copy of your screen (or the scene you picked), with its name in a tag.

- **Zoom and pan:** the wheel zooms in and out where the pointer is. Hold **Space** and drag, or drag with the middle button, to pan. The zoom buttons above the screen (or **Ctrl+=**, **Ctrl+−** and **Ctrl+0**) zoom in, out and back to fit.

- **Move:** drag a light's band. Hold **Shift** to move it straight across or straight up and down.
- **Pick points:** click a point. **Shift**+click adds or removes points, dragging a box on empty space picks the points inside it, and **Ctrl+A** picks them all. **Esc** unpicks.
- **Reshape:** drag a point to move every picked point with it. **Arrow keys** nudge them (**Shift** for bigger steps), and **Delete** or right-click removes them. Double-click the band to add a point there, or **Ctrl**+click to add one after the last. The big point is where the strip starts.
- **Exact spots:** with one point picked, type its X and Y. On a loop, **Start here** makes it the first point.
- **Draw from scratch:** **Draw**, then click out the points. **Backspace** takes back the last one, and clicking the first point closes the loop. Double-click, **Enter** or **Done drawing** finishes.
- **Presets:** **Edge loop** goes all the way around the screen. **Line** is a short line to drag into place. **Flip** mirrors a path across the middle, handy for a pair of bars.
- **Thickness** sets how wide a band of the picture the light looks at, in `vh`: 40vh is 40% of the screen's height, edge to edge. An open band's ends are cut square, and the light looks only inside the band as drawn.
- **Horizontal** and **Vertical** set how a path sizes to the screen on each axis. **Exact** keeps it where its points are. **Fit** stretches it to fill the screen, with the band's edges flush against the screen's edges. **Auto** scales it along with the other axis (when that one is on Fit), so the shape keeps its proportions, even on a screen of another shape. **Edge loop** fits both ways.
- Points snap to other points and to the screen's edges and middle, with a guide line. A band's edges snap too, so it can sit flush inside the screen's edge or right against another band. Hold **Shift** while dragging a single point to keep its line at 0, 45 or 90 degrees, and **Alt** to turn snapping off.
- **Undo** and **Redo** (**Ctrl+Z**, **Ctrl+Shift+Z**) cover placement, sections and colors. **Shortcuts** above the screen lists all of these.

### Segments and sections

With **Razer streaming** on, a light colors each of its segments on its own. The first segment follows the start of the band. Set **Segments** to the real count for the light (the app knows the H61F5 and H6056).

- **Split** a light into sections to place its parts apart. For example, split the H6056's 12 segments into 6 + 6 and put one bar on each side of the TV. Pick a segment first to split before it, or split in half.
- Each section can follow the screen or have its own fixed color.
- Pick segments in the bar to give just those a fixed color. **Follow section** undoes it.

### Canvas

The **Canvas** pane at the bottom of the sidebar picks what the lights follow. It's your **Screen** by default. The others:

- **Phthalo:** the screen in four dithered shades of phthalo green.
- Scenes the app paints itself, with no screen capture at all: **Night forest** (clouds drifting over dark pines), **Sunset**, **Aurora**, **Deep sea**, **Lava lamp** and **Fireplace**.

Scenes are drawn at about 128 pixels wide, in your monitor's shape, from a small palette with ordered dithering. They cost well under a millisecond a frame, and keep going with the window minimized. Lights sit on a scene the same way they sit on the screen.

The pane also has the monitor, brightness, saturation, smoothing (how slowly colors fade) and sample rate.

Your lights and settings are saved between launches. To back them up or move them to another PC, use the menu next to **Scan**: **Export setup…** saves your lights (placement, sections, colors and calibration) and canvas settings to a file, and **Import setup…** loads one in place of what you have. Files from older versions of the app still import.

### Matching the wall to the screen

The screen, the light's LEDs and the wall each change colors their own way. A light blue wall makes white look cool. Govee green often leans blue next to a screen's green. The app can't measure any of this, so you match them by eye.

Open a light and click **Calibrate**. The screen fills with a test color, and the light shows the same color. Change the light until the wall looks like the screen:

1. **White:** lower the color the wall has too much of. Then set **Brightness** so the wall is about as bright as the screen. Over 100% only lifts dim colors: bright ones are already at full, and they keep their balance instead of clipping to white. Do this first. Colors you don't match later keep white's balance.
2. **Dark grey:** set **Gamma** so the wall is as dim as the screen. Higher is darker.
3. **Red, green, blue, yellow, cyan, magenta:** add a little of another color to shift the hue, or lower it if it's too strong. Skip any that already match.

Click a step to jump to it. **Calibrated** switches the light between the calibrated and the plain color, to compare. **Reset** undoes one step. **Esc** or **Done** closes.

Tips:

- Do it in the light you watch in, with the lights where they'll stay.
- Calibrate in the mode you use. Razer streaming can show colors differently.
- Lights without razer streaming may fade for a few seconds after each change. Wait before judging.
- While syncing, the other lights go dark, so only this light's glow is on the wall.
- The test color fills the monitor picked in **Canvas**.

The calibration applies to everything the light shows, fixed colors too. In the light's panel, **Reset** clears it, and **Copy to other** gives it to your other lights of the same model.

How it works: each test color is a corner of the RGB color cube. The app sends the light your matched color for each corner, and blends between the nearest corners for everything else (like a 3D LUT). Greys use only white, so each match holds exactly and none of them moves another. Gamma is applied first, so it doesn't move the corners either.

### Light not showing up?

- Make sure LAN Control is on in the Govee app, and restart the light afterwards.
- The light and the PC have to be on the same subnet. Guest networks, IoT networks and some mesh setups block this.
- Allow the app through Windows Firewall when it asks. Scan replies come in on UDP port 4002.

### Lights inside the PC

Corsair fans, coolers, LED strips and RAM can join in through iCUE, which has to be installed. So can anything else iCUE lights: Corsair keyboards, mice and headset stands, and the boards and graphics cards iCUE supports.

1. **Scan**. They show up marked "Through iCUE".

The build fetches `iCUESDK.x64_2019.dll` from [Corsair's cue-sdk releases](https://github.com/CorsairOfficial/cue-sdk/releases) into `src-tauri/vendor/` (not in git) and puts it next to the exe and in the installers. With the DLL there, the app starts iCUE hidden in the tray whenever it needs it (the first scan waits a few seconds for it), and closes it on quit if the app started it. Without the DLL, the app leaves iCUE alone.

Each light starts with a segment per fan, strip or pump (in the order they're chained) or per RAM stick, and anything else as one. With a segment each, a fan gets all its LEDs even when fans of different sizes share a hub. Other counts spread evenly over the LEDs, in the order iCUE draws them: around a pump's ring, and left to right across a keyboard. While the app runs, iCUE's own effects stay off the lights it drives. **Off** turns a light black, since it has no power switch of its own, and it stays black. After the app quits, the lights show their built-in effects.

## How it works

About 30 times a second:

1. **Capture.** Windows' desktop duplication API grabs the screen. The frame stays on the GPU, which shrinks it to about 120px wide. Only that tiny image is copied back to the CPU, one frame later, so the CPU never waits on the GPU. A painted scene skips this and draws its own small frame instead.
2. **Pick colors.** For each segment of each light's path, it:
   - ignores black letterbox bars (a path along the screen edge follows the picture's edge)
   - averages in linear light
   - lets bright, saturated pixels set the hue, so a dim background doesn't wash it out
   - keeps brightness true to the scene
3. **Smooth.** Colors fade toward their target at the same speed whatever the frame rate.
4. **Send.** Each light gets its color over UDP (Govee's LAN API). It only sends when the color changes, plus once a second in case a packet gets lost. Lights inside the PC go through iCUE's SDK on their own thread, so a slow reply never holds up the rest.

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
  color.rs           color averaging, letterbox bars, smoothing
  calibration.rs     per-light color matching
  paths.rs           per-segment sampling along drawn paths
  visuals.rs         painted scenes and the phthalo filter
  govee.rs           LAN discovery and control
  engine.rs          the capture -> color -> send loop
  updates.rs         updates from GitHub releases
  lib.rs             Tauri commands
scripts/release.mjs  version, build, sign and publish
```

## Development

Needs Node 22+, pnpm and a recent Rust toolchain (via rustup).

```sh
pnpm install
pnpm tauri dev      # run the app
pnpm tauri build    # make an installer
pnpm check          # lint, typecheck, frontend tests and Rust tests
pnpm coverage       # frontend tests with a coverage report
```

`pnpm install` also turns on a pre-push hook (`.githooks/pre-push`) that runs `pnpm check`, standing in for CI. Besides each module's own tests, `src/lib/api.test.ts` checks that every call the page makes matches a registered Rust command and its argument names.

Tests that need real hardware are skipped by default:

```sh
cd src-tauri
cargo test -- --ignored live_capture --nocapture    # grab a real frame
cargo test -- --ignored live_scan_raw --nocapture   # print every Govee scan reply
cargo test -- --ignored render_canvases --nocapture # save each scene as an image
```

## Releasing

There's no CI: releases are built and published from your PC. Write what changed under **Unreleased** in `CHANGELOG.md` as you go. Then:

```sh
pnpm release patch             # or minor, major, or an exact x.y.z
pnpm release patch --dry-run   # build and check, but publish nothing
```

The release script:

1. checks you're on a clean `main` that's up to date with GitHub
2. runs `pnpm check`
3. sets the version in `package.json` (which the app reads) and `Cargo.toml`, and moves the changelog's **Unreleased** notes under it
4. builds the installer, signs it with the updater key, and checks the signature the way the app will
5. commits, tags `vX.Y.Z` and pushes
6. publishes a GitHub release with the installer, its signature and `latest.json`, the feed the app checks
7. downloads the feed and installer back, to confirm the app will find a good update

A dry run stops after step 4 and puts the version back.

The updater key is at `~/.tauri/tk-light-mini.key` (or set `TAURI_SIGNING_PRIVATE_KEY` to the key or its path). **Back it up.** Its public half is built into the app, and installed copies accept only updates signed with it. To try an update against another `latest.json`, set `TK_LIGHT_MINI_UPDATE_URL` to its URL before starting the app (`https`, or `http` in a dev build).

Windows locks a running exe, so quit a copy running from `src-tauri/target/release` before releasing, or set `CARGO_TARGET_DIR` to build somewhere else.

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

The band is split along its length into one piece per segment, numbered from the start, each shown in its live color. A new path switches the light to the **Canvas** color, so segment 1 shows piece 1, and so on. You can still set single segments to other colors. Without razer streaming, the whole path is one color for the whole light.

Each pixel near the path goes to the nearest point on it, so at a corner a pixel counts once, for the nearer side. While the window is visible, the app keeps capturing even with sync off, so the editor always has the screen. It only sends to lights while syncing, and stops capturing when minimized.

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
