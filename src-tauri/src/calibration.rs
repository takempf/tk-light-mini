//! Per-light color correction, so the wall matches the screen.
//!
//! The screen, the light's LEDs and the wall each shift colors, and none of
//! them can be measured from here. So the user matches the wall to the screen
//! by eye for a few test colors, and every color the light gets is mapped
//! through those matches:
//!
//! - `gamma` shapes the light's response, so a dim picture is as dim on the
//!   wall. It's applied first, so it leaves the test colors alone.
//! - The corners say what to send for full white, red, green, blue, yellow,
//!   cyan and magenta. Colors between them are interpolated on the RGB cube's
//!   tetrahedra, as 3D LUTs do: greys use white only, and any color uses only
//!   the corners around it. Each match holds exactly, and none move another.

use serde::Deserialize;

use crate::color::Rgb;

#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Calibration {
    /// Exponent on the color before mapping. 1 = unchanged.
    pub gamma: f32,
    pub white: Rgb,
    pub red: Rgb,
    pub green: Rgb,
    pub blue: Rgb,
    pub yellow: Rgb,
    pub cyan: Rgb,
    pub magenta: Rgb,
}

impl Default for Calibration {
    fn default() -> Self {
        Self {
            gamma: 1.0,
            white: [255, 255, 255],
            red: [255, 0, 0],
            green: [0, 255, 0],
            blue: [0, 0, 255],
            yellow: [255, 255, 0],
            cyan: [0, 255, 255],
            magenta: [255, 0, 255],
        }
    }
}

impl Calibration {
    /// What to send the light for `c`.
    pub fn apply(&self, c: Rgb) -> Rgb {
        if *self == Self::default() {
            return c;
        }
        let gamma = if self.gamma.is_finite() && self.gamma > 0.0 {
            self.gamma
        } else {
            1.0
        };
        let v = c.map(|x| (x as f32 / 255.0).powf(gamma));
        // Channels from largest to smallest.
        let mut order = [0, 1, 2];
        order.sort_by(|&a, &b| v[b].total_cmp(&v[a]));
        let [hi, mid, lo] = order;
        let primary = [self.red, self.green, self.blue][hi];
        let secondary = match hi + mid {
            1 => self.yellow,
            2 => self.magenta,
            _ => self.cyan,
        };
        let weights = [v[hi] - v[mid], v[mid] - v[lo], v[lo]];
        let corners = [primary, secondary, self.white];
        std::array::from_fn(|i| {
            let x: f32 = (0..3).map(|k| weights[k] * corners[k][i] as f32).sum();
            x.round().clamp(0.0, 255.0) as u8
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const COLORS: [Rgb; 6] = [
        [0, 0, 0],
        [255, 255, 255],
        [200, 100, 50],
        [10, 250, 128],
        [77, 77, 200],
        [1, 2, 3],
    ];

    fn warm_wall() -> Calibration {
        Calibration {
            white: [255, 220, 180],
            red: [255, 10, 0],
            green: [40, 255, 0],
            ..Calibration::default()
        }
    }

    #[test]
    fn default_changes_nothing() {
        for c in COLORS {
            assert_eq!(Calibration::default().apply(c), c);
        }
        // Also through the math, not just the shortcut.
        let near = Calibration {
            gamma: 1.000_001,
            ..Calibration::default()
        };
        for c in COLORS {
            assert_eq!(near.apply(c), c);
        }
    }

    #[test]
    fn corners_map_exactly() {
        let cal = Calibration {
            white: [250, 240, 230],
            red: [255, 10, 0],
            green: [40, 255, 0],
            blue: [0, 5, 255],
            yellow: [255, 200, 0],
            cyan: [0, 255, 200],
            magenta: [200, 0, 255],
            gamma: 2.2,
        };
        let pairs = [
            ([255, 255, 255], cal.white),
            ([255, 0, 0], cal.red),
            ([0, 255, 0], cal.green),
            ([0, 0, 255], cal.blue),
            ([255, 255, 0], cal.yellow),
            ([0, 255, 255], cal.cyan),
            ([255, 0, 255], cal.magenta),
            ([0, 0, 0], [0, 0, 0]),
        ];
        for (c, want) in pairs {
            assert_eq!(cal.apply(c), want, "{c:?}");
        }
    }

    #[test]
    fn greys_follow_white_only() {
        let cal = warm_wall();
        assert_eq!(cal.apply([128, 128, 128]), [128, 110, 90]);
    }

    #[test]
    fn gamma_dims_the_middle() {
        let cal = Calibration {
            gamma: 2.0,
            ..Calibration::default()
        };
        // (128/255)^2 * 255
        assert_eq!(cal.apply([128, 128, 128]), [64, 64, 64]);
        assert_eq!(cal.apply([255, 255, 255]), [255, 255, 255]);
        // NaN never equals the default, so this goes through the math.
        let bad = Calibration {
            gamma: f32::NAN,
            ..Calibration::default()
        };
        assert_eq!(bad.apply([128, 128, 128]), [128, 128, 128], "ignored");
    }

    #[test]
    fn nearby_colors_stay_nearby() {
        // Across the edge between two tetrahedra, where the channel order flips.
        let cal = warm_wall();
        let a = cal.apply([200, 199, 50]);
        let b = cal.apply([199, 200, 50]);
        for i in 0..3 {
            assert!(a[i].abs_diff(b[i]) <= 2, "{a:?} {b:?}");
        }
    }

    #[test]
    fn missing_fields_default() {
        let cal: Calibration = serde_json::from_str(r#"{"gamma":1.5,"red":[250,8,0]}"#).unwrap();
        assert_eq!(cal.gamma, 1.5);
        assert_eq!(cal.red, [250, 8, 0]);
        assert_eq!(cal.white, [255, 255, 255]);
    }
}
