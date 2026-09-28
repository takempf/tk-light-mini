//! Screen capture.
//!
//! Windows: DXGI Desktop Duplication. The frame never leaves the GPU at full
//! size: we copy it into a mip-mapped texture, let the GPU box-filter it down
//! (GenerateMips), then read back one tiny mip (~120px wide). Readback is
//! deferred by one tick so the CPU never waits on the GPU.

use serde::Serialize;

use crate::color::Frame;

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

#[cfg(windows)]
pub use win::{list_monitors, Capturer};

#[cfg(not(windows))]
pub use stub::{list_monitors, Capturer};

#[cfg(windows)]
mod win {
    use super::*;
    use windows::core::Interface;
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
    use windows::Win32::Graphics::Direct3D11::*;
    use windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC;
    use windows::Win32::Graphics::Dxgi::*;

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
        scaler: Option<Scaler>,
        pending: bool,
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

            let output1: IDXGIOutput1 = output.cast().map_err(err)?;
            let dup = unsafe { output1.DuplicateOutput(&device) }.map_err(err)?;
            Ok(Self {
                device,
                ctx,
                dup,
                scaler: None,
                pending: false,
            })
        }

        fn scaler_for(&mut self, src: &D3D11_TEXTURE2D_DESC) -> Result<&Scaler, CaptureError> {
            let stale = match &self.scaler {
                Some(s) => s.width != src.Width || s.height != src.Height,
                None => true,
            };
            if stale {
                self.pending = false;
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
                self.scaler = Some(Scaler {
                    width: src.Width,
                    height: src.Height,
                    mips: mips.unwrap(),
                    srv: srv.unwrap(),
                    staging: staging.unwrap(),
                    level,
                    small_w,
                    small_h,
                });
            }
            Ok(self.scaler.as_ref().unwrap())
        }

        /// Read back the previous tick's frame (if any) and queue the next.
        /// Returns `Some(f(frame))` when a new frame was read.
        pub fn poll<R>(&mut self, f: impl FnOnce(&Frame) -> R) -> Result<Option<R>, CaptureError> {
            let mut result = None;
            if self.pending {
                self.pending = false;
                if let Some(s) = &self.scaler {
                    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                    unsafe {
                        self.ctx
                            .Map(&s.staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                            .map_err(err)?;
                        let stride = mapped.RowPitch as usize;
                        let len = stride * (s.small_h as usize - 1) + s.small_w as usize * 4;
                        let data = std::slice::from_raw_parts(mapped.pData as *const u8, len);
                        result = Some(f(&Frame {
                            data,
                            width: s.small_w as usize,
                            height: s.small_h as usize,
                            stride,
                        }));
                        self.ctx.Unmap(&s.staging, 0);
                    }
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
            let ctx = self.ctx.clone();
            let s = self.scaler_for(&desc)?;
            unsafe {
                ctx.CopySubresourceRegion(&s.mips, 0, 0, 0, 0, &tex, 0, None);
                ctx.GenerateMips(&s.srv);
                ctx.CopySubresourceRegion(&s.staging, 0, 0, 0, 0, &s.mips, s.level, None);
                // Kick the GPU now; we read it back next tick.
                ctx.Flush();
            }
            self.pending = true;
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
    use super::pick_mip_level;

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
