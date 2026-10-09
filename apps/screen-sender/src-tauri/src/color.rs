//! Only the frame view and transfer function needed by screen capture.

/// A BGRA8 frame view, with possible padding after each row.
pub struct Frame<'a> {
    pub data: &'a [u8],
    pub width: usize,
    pub height: usize,
    pub stride: usize,
}

/// Map a linear scRGB channel into sRGB before publishing an HDR frame.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn linear_to_srgb(channel: f32) -> f32 {
    let channel = channel.clamp(0.0, 1.0);
    if channel <= 0.003_130_8 {
        channel * 12.92
    } else {
        1.055 * channel.powf(1.0 / 2.4) - 0.055
    }
}
