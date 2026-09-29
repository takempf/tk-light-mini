//! Screen capture.
//!
//! Windows: DXGI Desktop Duplication. The frame never leaves the GPU at full
//! size: we copy it into a mip-mapped texture, let the GPU box-filter it down
//! (GenerateMips), then read back one tiny mip (~120px wide). Readback is
//! deferred by one tick so the CPU never waits on the GPU.
//!
//! An HDR desktop is FP16 scRGB. We ask Windows for 8-bit frames, but it still
//! sends the odd FP16 one (and older setups send only those), so each format
//! gets its own textures and FP16 is converted to 8-bit sRGB on readback.

use serde::Serialize;

use crate::color::{linear_to_srgb, Frame};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub index: u32,
    pub name: String,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug)]
pub enum CaptureError {
    /// Duplication lost (mode change, UAC, fullscreen switch). Recreate.
    Lost,
    Other(String),
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CaptureError::Lost => write!(f, "capture lost"),
            CaptureError::Other(s) => write!(f, "{s}"),
        }
    }
}

/// Smallest mip level whose width stays at or above this.
const MIN_SAMPLE_WIDTH: u32 = 96;

pub fn pick_mip_level(width: u32) -> u32 {
    let mut level = 0;
    while (width >> (level + 1)) >= MIN_SAMPLE_WIDTH {
        level += 1;
    }
    level
}

/// A half float's bits as an f32.
fn f16_to_f32(h: u16) -> f32 {
    let sign = u32::from(h & 0x8000) << 16;
    let exp = u32::from((h >> 10) & 0x1f);
    let frac = u32::from(h & 0x3ff);
    match exp {
        // Subnormal: frac * 2^-24.
        0 => {
            let v = frac as f32 / (1u32 << 24) as f32;
            if sign != 0 {
                -v
            } else {
                v
            }
        }
        31 => f32::from_bits(sign | 0x7f80_0000 | (frac << 13)),
        _ => f32::from_bits(sign | ((exp + 112) << 23) | (frac << 13)),
    }
}

/// FP16 scRGB pixels (linear, 1.0 = 80 nits) as BGRA8 sRGB, with `white`
/// (scRGB) mapped to full. Brighter and out-of-gamut values clip.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn scrgb_to_bgra(
    src: &[u8],
    width: usize,
    height: usize,
    stride: usize,
    white: f32,
    out: &mut Vec<u8>,
) {
    let k = 1.0 / white.max(1e-3);
    let channel = |px: &[u8], c: usize| {
        let v = f16_to_f32(u16::from_le_bytes([px[c * 2], px[c * 2 + 1]])) * k;
        // NaN and negatives are black.
        if v > 0.0 {
            (linear_to_srgb(v) * 255.0 + 0.5) as u8
        } else {
            0
        }
    };
    out.clear();
    for y in 0..height {
        let row = &src[y * stride..y * stride + width * 8];
        for px in row.as_chunks::<8>().0 {
            out.extend_from_slice(&[channel(px, 2), channel(px, 1), channel(px, 0), 255]);
        }
    }
}

#[cfg(windows)]
pub use win::{list_monitors, Capturer};

#[cfg(not(windows))]
pub use stub::{list_monitors, Capturer};

#[cfg(windows)]
mod win {
    use super::*;
    use windows::core::Interface;
    use windows::Win32::Devices::Display::*;
    use windows::Win32::Foundation::{ERROR_SUCCESS, HMODULE};
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
    use windows::Win32::Graphics::Direct3D11::*;
    use windows::Win32::Graphics::Dxgi::Common::*;
    use windows::Win32::Graphics::Dxgi::*;

    /// What an HDR desktop is in: scRGB, linear, 1.0 = 80 nits.
    const HDR: DXGI_FORMAT = DXGI_FORMAT_R16G16B16A16_FLOAT;

    /// Formats we can read back, besides `HDR`: 8-bit BGRA.
    fn is_bgra8(f: DXGI_FORMAT) -> bool {
        f == DXGI_FORMAT_B8G8R8A8_UNORM
            || f == DXGI_FORMAT_B8G8R8A8_UNORM_SRGB
            || f == DXGI_FORMAT_B8G8R8X8_UNORM
    }

    /// Where SDR white sits on the display named `name` (as in
    /// `DXGI_OUTPUT_DESC`), in scRGB. None when Windows won't say.
    fn sdr_white(name: &[u16; 32]) -> Option<f32> {
        unsafe {
            let (mut n_paths, mut n_modes) = (0u32, 0u32);
            if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut n_paths, &mut n_modes)
                != ERROR_SUCCESS
            {
                return None;
            }
            let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); n_paths as usize];
            let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); n_modes as usize];
            if QueryDisplayConfig(
                QDC_ONLY_ACTIVE_PATHS,
                &mut n_paths,
                paths.as_mut_ptr(),
                &mut n_modes,
                modes.as_mut_ptr(),
                None,
            ) != ERROR_SUCCESS
            {
                return None;
            }
            paths.truncate(n_paths as usize);
            for p in &paths {
                let mut source = DISPLAYCONFIG_SOURCE_DEVICE_NAME {
                    header: DISPLAYCONFIG_DEVICE_INFO_HEADER {
                        r#type: DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
                        size: std::mem::size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32,
                        adapterId: p.sourceInfo.adapterId,
                        id: p.sourceInfo.id,
                    },
                    viewGdiDeviceName: [0; 32],
                };
                if DisplayConfigGetDeviceInfo(&mut source.header) != 0
                    || source.viewGdiDeviceName != *name
                {
                    continue;
                }
                let mut white = DISPLAYCONFIG_SDR_WHITE_LEVEL {
                    header: DISPLAYCONFIG_DEVICE_INFO_HEADER {
                        r#type: DISPLAYCONFIG_DEVICE_INFO_GET_SDR_WHITE_LEVEL,
                        size: std::mem::size_of::<DISPLAYCONFIG_SDR_WHITE_LEVEL>() as u32,
                        adapterId: p.targetInfo.adapterId,
                        id: p.targetInfo.id,
                    },
                    SDRWhiteLevel: 0,
                };
                if DisplayConfigGetDeviceInfo(&mut white.header) != 0 || white.SDRWhiteLevel == 0 {
                    return None;
                }
                // 1000 = 80 nits = scRGB 1.0.
                return Some(white.SDRWhiteLevel as f32 / 1000.0);
            }
            None
        }
    }

    fn outputs() -> windows::core::Result<Vec<(IDXGIAdapter1, IDXGIOutput)>> {
        let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1()? };
        let mut out = Vec::new();
        let mut a = 0;
        while let Ok(adapter) = unsafe { factory.EnumAdapters1(a) } {
            let mut o = 0;
            while let Ok(output) = unsafe { adapter.EnumOutputs(o) } {
                out.push((adapter.clone(), output));
                o += 1;
            }
            a += 1;
        }
        Ok(out)
    }

    pub fn list_monitors() -> Vec<MonitorInfo> {
        outputs()
            .unwrap_or_default()
            .iter()
            .enumerate()
            .filter_map(|(i, (_, o))| {
                let d = unsafe { o.GetDesc() }.ok()?;
                let len = d
                    .DeviceName
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(d.DeviceName.len());
                let r = d.DesktopCoordinates;
                Some(MonitorInfo {
                    index: i as u32,
                    name: String::from_utf16_lossy(&d.DeviceName[..len]).replace(r"\\.\", ""),
                    width: r.right - r.left,
                    height: r.bottom - r.top,
                })
            })
            .collect()
    }

    struct Scaler {
        width: u32,
        height: u32,
        format: DXGI_FORMAT,
        mips: ID3D11Texture2D,
        srv: ID3D11ShaderResourceView,
        staging: ID3D11Texture2D,
        level: u32,
        small_w: u32,
        small_h: u32,
    }

    pub struct Capturer {
        device: ID3D11Device,
        ctx: ID3D11DeviceContext,
        dup: IDXGIOutputDuplication,
        /// The monitor's GDI name, to look up its SDR white.
        name: [u16; 32],
        /// One per frame format seen, at most two (8-bit and FP16).
        scalers: Vec<Scaler>,
        /// The scaler holding a frame to read back next tick.
        pending: Option<usize>,
        /// SDR white on an HDR desktop, in scRGB.
        white: f32,
        /// FP16 frames, converted to BGRA8.
        converted: Vec<u8>,
    }

    // D3D11 objects are free-threaded; the capturer lives on one thread anyway.
    unsafe impl Send for Capturer {}

    fn err(e: windows::core::Error) -> CaptureError {
        if e.code() == DXGI_ERROR_ACCESS_LOST || e.code() == DXGI_ERROR_DEVICE_REMOVED {
            CaptureError::Lost
        } else {
            CaptureError::Other(e.message().to_string())
        }
    }

    impl Capturer {
        pub fn new(monitor: u32) -> Result<Self, CaptureError> {
            let list = outputs().map_err(err)?;
            let (adapter, output) = list
                .get(monitor as usize)
                .or_else(|| list.first())
                .cloned()
                .ok_or_else(|| CaptureError::Other("no monitor found".into()))?;

            let mut device = None;
            let mut ctx = None;
            unsafe {
                D3D11CreateDevice(
                    &adapter,
                    D3D_DRIVER_TYPE_UNKNOWN,
                    HMODULE::default(),
                    D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                    None,
                    D3D11_SDK_VERSION,
                    Some(&mut device),
                    None,
                    Some(&mut ctx),
                )
                .map_err(err)?;
            }
            let device = device.ok_or_else(|| CaptureError::Other("no d3d device".into()))?;
            let ctx = ctx.ok_or_else(|| CaptureError::Other("no d3d context".into()))?;

            // Yield to the game on the GPU. Negative = lower priority.
            if let Ok(dxgi) = device.cast::<IDXGIDevice>() {
                let _ = unsafe { dxgi.SetGPUThreadPriority(-7) };
            }

            // Ask for 8-bit, so Windows tone maps an HDR desktop. That needs
            // Windows 10 1703+ and a DPI-aware process (the app is; tests
            // aren't), so fall back to whatever the desktop is in.
            let dup = output
                .cast::<IDXGIOutput5>()
                .and_then(|o| unsafe {
                    o.DuplicateOutput1(&device, 0, &[DXGI_FORMAT_B8G8R8A8_UNORM])
                })
                .or_else(|_| {
                    let o: IDXGIOutput1 = output.cast()?;
                    unsafe { o.DuplicateOutput(&device) }
                })
                .map_err(err)?;
            let name = unsafe { output.GetDesc() }
                .map(|d| d.DeviceName)
                .unwrap_or([0; 32]);
            Ok(Self {
                device,
                ctx,
                dup,
                name,
                scalers: Vec::new(),
                pending: None,
                white: 1.0,
                converted: Vec::new(),
            })
        }

        /// The scaler for frames like `src`, made if needed. None for formats
        /// we can't read.
        fn scaler_for(
            &mut self,
            src: &D3D11_TEXTURE2D_DESC,
        ) -> Result<Option<usize>, CaptureError> {
            if src.Format != HDR && !is_bgra8(src.Format) {
                return Ok(None);
            }
            let fits = |s: &Scaler| {
                s.width == src.Width && s.height == src.Height && s.format == src.Format
            };
            if let Some(i) = self.scalers.iter().position(fits) {
                return Ok(Some(i));
            }
            // A new size makes the old ones useless; keep one other format.
            self.scalers
                .retain(|s| s.width == src.Width && s.height == src.Height);
            self.scalers.truncate(1);
            self.pending = None;
            if src.Format == HDR {
                // Read now: the user may have moved the SDR brightness slider.
                self.white = sdr_white(&self.name).unwrap_or(1.0);
            }
            let level = pick_mip_level(src.Width);
            let mip_desc = D3D11_TEXTURE2D_DESC {
                Width: src.Width,
                Height: src.Height,
                MipLevels: level + 1,
                ArraySize: 1,
                Format: src.Format,
                SampleDesc: DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
                CPUAccessFlags: 0,
                MiscFlags: D3D11_RESOURCE_MISC_GENERATE_MIPS.0 as u32,
            };
            let small_w = (src.Width >> level).max(1);
            let small_h = (src.Height >> level).max(1);
            let staging_desc = D3D11_TEXTURE2D_DESC {
                Width: small_w,
                Height: small_h,
                MipLevels: 1,
                ArraySize: 1,
                Format: src.Format,
                SampleDesc: DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                Usage: D3D11_USAGE_STAGING,
                BindFlags: 0,
                CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                MiscFlags: 0,
            };
            let mut mips = None;
            let mut staging = None;
            let mut srv = None;
            unsafe {
                self.device
                    .CreateTexture2D(&mip_desc, None, Some(&mut mips))
                    .map_err(err)?;
                let mips_ref = mips.as_ref().unwrap();
                self.device
                    .CreateShaderResourceView(mips_ref, None, Some(&mut srv))
                    .map_err(err)?;
                self.device
                    .CreateTexture2D(&staging_desc, None, Some(&mut staging))
                    .map_err(err)?;
            }
            self.scalers.push(Scaler {
                width: src.Width,
                height: src.Height,
                format: src.Format,
                mips: mips.unwrap(),
                srv: srv.unwrap(),
                staging: staging.unwrap(),
                level,
                small_w,
                small_h,
            });
            Ok(Some(self.scalers.len() - 1))
        }

        /// Read back the previous tick's frame (if any) and queue the next.
        /// Returns `Some(f(frame))` when a new frame was read.
        pub fn poll<R>(&mut self, f: impl FnOnce(&Frame) -> R) -> Result<Option<R>, CaptureError> {
            let mut result = None;
            if let Some(s) = self.pending.take().and_then(|i| self.scalers.get(i)) {
                let (w, h) = (s.small_w as usize, s.small_h as usize);
                let bytes = if s.format == HDR { 8 } else { 4 };
                let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                unsafe {
                    self.ctx
                        .Map(&s.staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                        .map_err(err)?;
                    let stride = mapped.RowPitch as usize;
                    let len = stride * (h - 1) + w * bytes;
                    let data = std::slice::from_raw_parts(mapped.pData as *const u8, len);
                    let frame = if s.format == HDR {
                        scrgb_to_bgra(data, w, h, stride, self.white, &mut self.converted);
                        Frame {
                            data: &self.converted,
                            width: w,
                            height: h,
                            stride: w * 4,
                        }
                    } else {
                        Frame {
                            data,
                            width: w,
                            height: h,
                            stride,
                        }
                    };
                    result = Some(f(&frame));
                    self.ctx.Unmap(&s.staging, 0);
                }
            }

            let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut res: Option<IDXGIResource> = None;
            match unsafe { self.dup.AcquireNextFrame(0, &mut info, &mut res) } {
                Ok(()) => {}
                Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => return Ok(result),
                Err(e) => return Err(err(e)),
            }
            // Only cursor moved: nothing new to sample.
            let queued = if info.LastPresentTime != 0 {
                self.queue(res)
            } else {
                Ok(())
            };
            unsafe { self.dup.ReleaseFrame() }.map_err(err)?;
            queued?;
            Ok(result)
        }

        fn queue(&mut self, res: Option<IDXGIResource>) -> Result<(), CaptureError> {
            let Some(res) = res else { return Ok(()) };
            let tex: ID3D11Texture2D = res.cast().map_err(err)?;
            let mut desc = D3D11_TEXTURE2D_DESC::default();
            unsafe { tex.GetDesc(&mut desc) };
            let Some(i) = self.scaler_for(&desc)? else {
                return Ok(());
            };
            let s = &self.scalers[i];
            unsafe {
                self.ctx
                    .CopySubresourceRegion(&s.mips, 0, 0, 0, 0, &tex, 0, None);
                self.ctx.GenerateMips(&s.srv);
                self.ctx
                    .CopySubresourceRegion(&s.staging, 0, 0, 0, 0, &s.mips, s.level, None);
                // Kick the GPU now; we read it back next tick.
                self.ctx.Flush();
            }
            self.pending = Some(i);
            Ok(())
        }
    }
}

#[cfg(not(windows))]
mod stub {
    use super::*;

    pub fn list_monitors() -> Vec<MonitorInfo> {
        Vec::new()
    }

    pub struct Capturer;

    impl Capturer {
        pub fn new(_monitor: u32) -> Result<Self, CaptureError> {
            Err(CaptureError::Other(
                "screen capture is only supported on Windows".into(),
            ))
        }

        pub fn poll<R>(&mut self, _f: impl FnOnce(&Frame) -> R) -> Result<Option<R>, CaptureError> {
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{f16_to_f32, pick_mip_level, scrgb_to_bgra};

    #[test]
    fn half_floats_decode() {
        assert_eq!(f16_to_f32(0x3c00), 1.0);
        assert_eq!(f16_to_f32(0x4000), 2.0);
        assert_eq!(f16_to_f32(0xbc00), -1.0);
        assert_eq!(f16_to_f32(0x3800), 0.5);
        assert_eq!(f16_to_f32(0x0001), 2f32.powi(-24), "subnormal");
        assert!(f16_to_f32(0x7c00).is_infinite());
        assert!(f16_to_f32(0x7e00).is_nan());
    }

    #[test]
    fn scrgb_maps_sdr_white_to_full() {
        let px = |r: u16, g: u16, b: u16| -> Vec<u8> {
            [r, g, b, 0x3c00]
                .iter()
                .flat_map(|c| c.to_le_bytes())
                .collect()
        };
        // Two pixels, with row padding: white at 2.5 (200 nits), then a dim
        // red, a negative (out-of-gamut) green and a NaN blue.
        let mut src = px(0x4100, 0x4100, 0x4100); // 2.5
        src.extend(px(0x3800, 0xbc00, 0x7e00)); // 0.5, -1, NaN
        src.extend([0xAB; 8]);
        let mut out = Vec::new();
        scrgb_to_bgra(&src, 2, 1, 24, 2.5, &mut out);
        assert_eq!(&out[..4], &[255, 255, 255, 255]);
        // 0.5 / 2.5 = 0.2 linear, about 124 in sRGB.
        assert_eq!(&out[4..], &[0, 0, 124, 255]);
    }

    #[test]
    fn mip_levels_target_small_width() {
        assert_eq!(pick_mip_level(3840), 5); // 120
        assert_eq!(pick_mip_level(2560), 4); // 160
        assert_eq!(pick_mip_level(1920), 4); // 120
        assert_eq!(pick_mip_level(1280), 3); // 160
        assert_eq!(pick_mip_level(64), 0);
    }

    /// Needs a real desktop: `cargo test -- --ignored live_capture --nocapture`
    #[test]
    #[ignore]
    fn live_capture() {
        use super::Capturer;
        use crate::color::content_rect;
        let mut c = Capturer::new(0).expect("create capturer");
        let mut got = None;
        for _ in 0..60 {
            if let Some(r) = c.poll(|f| (f.width, f.height, content_rect(f))).unwrap() {
                got = Some(r);
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(33));
        }
        let (w, h, rect) = got.expect("no frame within 2s");
        println!("sampled {w}x{h}, picture {rect:?}");
        assert!(w >= 96);
    }
}
