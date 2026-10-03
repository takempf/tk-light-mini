//! Test CLI for the RGB lights inside this PC.
//!
//! `pc-lights scan` finds them. The other commands try to set their colors.
//! Nothing here is saved to a device's flash.

mod corsair_hydro;
mod corsair_node;
mod icue;
mod known;
mod lamparray;
mod mystic;
mod util;

use std::process::ExitCode;

use util::{parse_color, Rgb};

const USAGE: &str = "\
pc-lights: find and color the RGB lights inside this PC

USAGE:
  pc-lights scan                      known RGB controllers + Dynamic Lighting devices
  pc-lights hid                       every HID interface (vid, pid, usage page)

  pc-lights mystic dump               read the MSI Mystic Light report, show each zone
  pc-lights mystic set <color> [--zone NAME]
                                      static color on every zone (or one), not saved
  pc-lights mystic off                turn every zone off, not saved
  pc-lights mystic restore            write back the report from before the first change

  pc-lights node set <color> [--channel N] [--leds N] [--hold SECS]
                                      Corsair Lighting Node / Commander Pro, direct mode
  pc-lights node fans [--channel N] [--hold SECS]
                                      each fan port its own color, to map fan positions
  pc-lights node anim [fans|rainbow|chase] [--fps N] [--secs N] [--channel N] [--port-type N]
                                      animate the fans, report the rate the node kept up
  pc-lights node diag [--channel N] [--port-type N]
                                      numbered steps to find what makes the fans blink
                                      --port-type: LED chip, 1 WS2812B or 2 UCS1903 (saved on the node)
  pc-lights node off [--channel N]    save static black at brightness 0 as the node's own effect
  pc-lights node brightness <0-100> [--channel N]
                                      the node's brightness for a channel
  pc-lights hydro set <color> [--leds N] [--hold SECS]
                                      Corsair Hydro Platinum / PRO XT pump head
  pc-lights lamp set <color>          Windows Dynamic Lighting (LampArray) devices

  pc-lights icue list [--dll PATH]    devices iCUE sees (needs iCUE running, SDK on)
  pc-lights icue set <color> [--type ram|cooler|fans|WORD] [--hold SECS] [--dll PATH]
                                      color through iCUE, RAM included

  pc-lights cycle [TARGET] [--hold SECS]
                                      red, green, blue, white on each target
                                      TARGET: mystic | node | hydro | lamp (default: all)

COLORS: red, green, blue, white, off, ff8800, #ff8800, 255,136,0

Quit iCUE / MSI Center / SignalRGB first, or they will paint over the test.";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: &[String]) -> Result<(), String> {
    let (flags, pos) = util::split_flags(args);
    let pos: Vec<&str> = pos.iter().map(String::as_str).collect();
    let hold = flags.num("hold")?.unwrap_or(0);

    match pos.as_slice() {
        ["scan"] => scan(),
        ["hid"] => known::print_all_hid(),

        ["mystic", "dump"] => mystic::dump(),
        ["mystic", "set", c] => mystic::set(Some(parse_color(c)?), flags.str("zone")),
        ["mystic", "off"] => mystic::set(None, flags.str("zone")),
        ["mystic", "restore"] => mystic::restore(),

        ["node", "set", c] => {
            warn_rgb_software();
            let channel = flags.num("channel")?.unwrap_or(0) as u8;
            let leds = flags
                .num("leds")?
                .unwrap_or(corsair_node::DEFAULT_LEDS as u64) as usize;
            corsair_node::set(parse_color(c)?, channel, leds, hold)
        }
        ["node", "fans"] => {
            warn_rgb_software();
            let channel = flags.num("channel")?.unwrap_or(0) as u8;
            corsair_node::fans(channel, flags.num("hold")?.unwrap_or(20))
        }
        ["node", "anim", rest @ ..] if rest.len() <= 1 => {
            warn_rgb_software();
            corsair_node::anim(
                flags.num("channel")?.unwrap_or(0) as u8,
                rest.first().copied().unwrap_or("fans"),
                flags.num("fps")?.unwrap_or(30),
                flags.num("secs")?.unwrap_or(20),
                port_type(&flags)?,
            )
        }
        ["node", "diag"] => {
            warn_rgb_software();
            corsair_node::diag(flags.num("channel")?.unwrap_or(0) as u8, port_type(&flags)?)
        }
        ["node", "off"] => {
            warn_rgb_software();
            corsair_node::off(flags.num("channel")?.unwrap_or(0) as u8)
        }
        ["node", "brightness", n] => corsair_node::brightness(
            flags.num("channel")?.unwrap_or(0) as u8,
            n.parse()
                .map_err(|_| format!("brightness is 0 to 100, got {n}"))?,
        ),
        ["hydro", "set", c] => {
            warn_rgb_software();
            let leds = flags
                .num("leds")?
                .unwrap_or(corsair_hydro::DEFAULT_LEDS as u64) as usize;
            corsair_hydro::set(parse_color(c)?, leds, hold)
        }
        ["lamp", "set", c] => lamparray::set(parse_color(c)?),

        ["icue", "list"] => icue::list(flags.str("dll")),
        ["icue", "set", c] => icue::set(
            parse_color(c)?,
            flags.str("type"),
            hold.max(3),
            flags.str("dll"),
        ),

        ["cycle"] => cycle(None, hold),
        ["cycle", t] => cycle(Some(t), hold),

        [] | ["help"] | ["-h"] | ["--help"] => {
            println!("{USAGE}");
            Ok(())
        }
        _ => Err(format!("unknown command: {}\n\n{USAGE}", args.join(" "))),
    }
}

fn port_type(flags: &util::Flags) -> Result<Option<u8>, String> {
    match flags.num("port-type")? {
        Some(t @ 1..=2) => Ok(Some(t as u8)),
        Some(t) => Err(format!("--port-type is 1 or 2, got {t}")),
        None => Ok(None),
    }
}

fn scan() -> Result<(), String> {
    println!("== HID RGB controllers ==");
    known::print_known_hid()?;
    println!();
    println!("== Windows Dynamic Lighting (LampArray) ==");
    if let Err(e) = lamparray::list() {
        println!("  failed: {e}");
    }
    println!();
    println!("== RGB software running ==");
    let running = util::rgb_software_running();
    if running.is_empty() {
        println!("  none");
    }
    for name in running {
        println!("  {name}  (may fight direct writes)");
    }
    println!();
    println!("RAM and GPU lights sit on SMBus / I2C, not HID. Run scan.ps1 for those.");
    Ok(())
}

fn cycle(target: Option<&str>, hold: u64) -> Result<(), String> {
    const STEPS: [(&str, Rgb); 4] = [
        ("red", Rgb(255, 0, 0)),
        ("green", Rgb(0, 255, 0)),
        ("blue", Rgb(0, 0, 255)),
        ("white", Rgb(255, 255, 255)),
    ];
    let hold = hold.max(2);
    let all = ["mystic", "node", "hydro", "lamp"];
    let targets: Vec<&str> = match target {
        Some(t) if all.contains(&t) => vec![t],
        Some(t) => return Err(format!("unknown target: {t}")),
        None => all.to_vec(),
    };
    warn_rgb_software();

    for t in targets {
        println!("--- {t} ---");
        for (name, c) in STEPS {
            println!("{name}, {hold} s");
            let r = match t {
                "mystic" => mystic::set(Some(c), None).map(|()| util::sleep_secs(hold)),
                "node" => corsair_node::set(c, 0, corsair_node::DEFAULT_LEDS, hold),
                "hydro" => corsair_hydro::set(c, corsair_hydro::DEFAULT_LEDS, hold),
                _ => lamparray::set(c).map(|()| util::sleep_secs(hold)),
            };
            if let Err(e) = r {
                println!("  skipped: {e}");
                break;
            }
        }
    }
    Ok(())
}

fn warn_rgb_software() {
    let running = util::rgb_software_running();
    if !running.is_empty() {
        eprintln!(
            "warning: {} running, it may paint over this test",
            running.join(", ")
        );
    }
}
