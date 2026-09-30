# pc-lights

Test tools for the RGB lights inside this PC. Not part of the app build.

```
cd tools/pc-lights
cargo run -- scan                  # HID RGB controllers + Windows Dynamic Lighting
powershell -ExecutionPolicy Bypass -File scan.ps1   # board, GPU, RAM, USB, RGB apps
cargo run -- help                  # all commands
```

Quit iCUE and MSI Center first, or they paint over the test.

## This PC: Corsair VENGEANCE a7200

Stock lights (4000D AIRFLOW case):

- 6 SP120 RGB ELITE fans, 8 LEDs each, all on the Lighting Node CORE (channel 0).
  The ports run up the front, back across the top, then to the rear:

  | Port | LEDs | `node fans` color | Fan |
  | --- | --- | --- | --- |
  | 1 | 0..8 | red | front, bottom |
  | 2 | 8..16 | green | front, middle |
  | 3 | 16..24 | blue | front, top |
  | 4 | 24..32 | yellow | top, forward |
  | 5 | 32..40 | cyan | top, rear |
  | 6 | 40..48 | magenta | back |
- H100i RGB PRO XT pump head, 16 LEDs.
- VENGEANCE RGB PRO RAM: 2 sticks + 2 light-only dummies, 10 LEDs each.
- The RTX 4080 is not stock. Gigabyte cards use RGB Fusion.
- The MSI board headers are likely empty. The Lighting Node drives the fans.

| Light | Command | Status |
| --- | --- | --- |
| MSI Mystic Light (B550-A PRO, 1462:7C56) | `mystic dump`, `mystic set blue`, `mystic restore` | Works: writes read back. Not saved to flash. |
| Corsair Lighting Node CORE (1B1C:0C1A), fans | `node set blue --hold 10`, `node fans` | Works: seen by eye, each fan port its own color. |
| Corsair H100i RGB PRO XT (1B1C:0C20), pump | `hydro set blue --hold 10` | Works: seen by eye. |
| Windows Dynamic Lighting | `lamp set blue` | No devices on this PC. |
| Corsair Vengeance RGB Pro RAM | `icue list`, `icue set blue --type ram --hold 10` | Works through the iCUE SDK (seen by eye), but not in the app: we left the RAM off, set dark in iCUE's hardware lighting. Needs iCUE open and `iCUESDK.x64_2019.dll` (from [cue-sdk releases](https://github.com/CorsairOfficial/cue-sdk/releases)) next to the exe. Direct SMBus would need a kernel driver. |
| Gigabyte RTX 4080 | none | I2C over NVAPI. |

`cycle` steps each target through red, green, blue and white.

`icue list` prints each channel's devices (LED counts and types) and every LED
as `group.index@x,y`. On iCUE 5.51 the fans read 6 x 8 LEDs in port order and
the RAM 4 channels of 10. The pump ring's ids are out of order along iCUE's
layout (12-16, 5-11, 3-4, 1-2 left to right), so the app orders LEDs by layout.

Protocols come from OpenRGB (Mystic Light 185, Lighting Node) and liquidctl
(Hydro Platinum). `mystic set` saves the original report to
`%TEMP%\pc-lights-mystic-backup.bin` for `mystic restore`.
