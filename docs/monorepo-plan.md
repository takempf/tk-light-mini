# Always-on lighting architecture

## Goal and ownership

The control server is the only process that discovers and sends commands to Govee lights. It owns the saved setup, source selection, power state, and the running color engine. Closing the admin browser or a screen sender does not stop the service. A Windows sender contributes small screen frames; it never sends light commands.

The first deployment target is a machine on the same LAN as the lights. Govee discovery uses multicast on UDP 4001 with replies on 4002, and control goes to device UDP 4003. The service must have LAN access even if senders connect over a different network.

## Workspace

| Location | Responsibility |
| --- | --- |
| `apps/control-server` | Node.js/TypeScript API, configuration persistence, source sessions, color loop, and Govee UDP |
| `apps/admin-web` | Browser shell for the existing editor, discovery, placement, calibration, source selection, and status |
| `apps/screen-sender` | Windows Tauri tray app for DXGI capture and frame publishing |
| `packages/light-core` | Shared pure TypeScript setup models and path geometry |
| `packages/protocol` | Sender frame version and source contracts |
| repository root | Original desktop controller and shared editor source during migration |
| `tools/pc-lights` | Existing standalone PC hardware probe |

pnpm manages the TypeScript workspace. Cargo is confined to the sender and the standalone hardware probe. The admin build is served by the Node service in production.

## Data and control flow

1. A sender authenticates and registers a stable sender ID and display name. It publishes downscaled BGRA frames with dimensions, sequence, and capture time over a binary WebSocket. The sender chooses a monitor locally.
2. The server retains only the latest valid frame per sender. Frames have size and rate limits; a disconnected or stale sender becomes unavailable. Queued frames are dropped to bound latency.
3. A light or section can use a fixed color, a built-in scene, or a named sender's screen. Existing paths and per-segment overrides apply to dynamic sources. Phthalo is an effect on a screen source.
4. The server samples paths, smooths and calibrates colors, and sends Govee LAN commands. Its existing retry and keepalive behavior is preserved.
5. The browser edits a versioned setup via HTTP and polls status and a reduced-rate preview. Conflicting browser edits receive a revision conflict rather than silently replacing another edit.

## Persistence and security

Store the setup in one server-owned, versioned JSON document with atomic replacement and a retained backup. Keep device IDs as stable keys and update IPs after discovery. Import the existing `light-mini-setup.json` format, including its migrations, through the admin panel. An imported setup starts with sync disabled until the server is confirmed as sole controller.

Bind the API to a configured LAN interface. Require an admin credential for mutations and preview, and a separate revocable token for each sender. Check browser origins for state-changing requests. Screen frames stay in memory and are never persisted. Use TLS when the API is reachable beyond a trusted LAN.

## Delivery steps

1. Establish pnpm workspaces and reuse the existing editor in `apps/admin-web` while keeping the original desktop app available for export and migration.
2. Port the Rust engine's sampling, scenes, smoothing, calibration, and Govee behavior to TypeScript. Compare output visually against the original app on the intended hardware. Move CPU processing to a worker thread if it delays API requests.
3. Implement server persistence, discovery, power, source registry, frame intake, preview, and the light loop. Add service installation documentation and restart behavior.
4. Connect the admin editor to the server. Support fixed colors, scenes, and selected remote screens at light/section level, with offline status and a scene fallback.
5. Strip the desktop app down to capture, connection settings, monitor choice, sender status, and start-at-login. Keep DXGI downscaling in Rust.
6. Add one-time setup migration and independent release/build scripts for the server and sender. Disable the old controller when the server takes ownership.

## Verification gates

- Unit tests cover frame validation, latest-frame behavior, stale-source fallback, source selection, geometry and color behavior, scene rendering, calibration, Govee packet construction, persistence, revision conflicts, and setup migration.
- Integration tests start the HTTP service with temporary storage and fake UDP output. They exercise discovery, configuration changes, publisher disconnect, and preview without real lights.
- Existing editor and Rust capture tests remain in the workspace. Hardware tests are opt-in.
- A manual LAN check confirms a sender can stream, light selection changes the right device, and fixed colors or scenes continue after the sender and browser close. A server restart restores the setup and resumes scene/fixed output.

## Main risks

Color parity is the largest migration risk because the current engine is in Rust. Golden scene fixtures are covered by automated tests; path sampling and light output still need visual comparison on real hardware. Multicast discovery depends on the host's LAN and firewall; manual IP entry and device ID reconciliation provide a fallback. The server must be the only active controller for a light to avoid competing UDP commands.

## Implementation state

The three apps, shared packages, versioned setup store, per-sender authentication, browser source controls, preview, and automated tests are implemented on the monorepo branch. The original controller remains runnable at the repository root so an existing setup can be exported. The six scene renderers match two golden Rust frames each, pixel for pixel. Automated checks run on macOS; the Windows DXGI sender and actual Govee LAN traffic still need a Windows/LAN acceptance run before retiring the old controller. Sampling comparison against Rust fixtures and a sustained load test on the intended server hardware remain release gates.
