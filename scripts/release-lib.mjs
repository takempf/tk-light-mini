// @ts-check
/**
 * The pure parts of a release: version numbers, the changelog, the updater's
 * `latest.json`, and checking an installer's signature the way the app will.
 * `release.mjs` does the git, build and GitHub steps around these.
 */
import { createHash, createPublicKey, verify } from "node:crypto";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * @param {string} v
 * @returns {[number, number, number]}
 */
function parse(v) {
  const m = SEMVER.exec(v);
  if (!m) throw new Error(`not a version: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** @param {string} a @param {string} b */
export function compareVersions(a, b) {
  const [x, y] = [parse(a), parse(b)];
  const d = x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  return Math.sign(d);
}

/**
 * The version to release: `patch`, `minor` or `major` bumps `current`, and an
 * exact `x.y.z` must not be older. The same version is allowed, for a first
 * release; a tag that already exists stops it later.
 * @param {string} current @param {string} bump
 */
export function nextVersion(current, bump) {
  const [major, minor, patch] = parse(current);
  switch (bump) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "major":
      return `${major + 1}.0.0`;
  }
  if (!SEMVER.test(bump)) throw new Error(`expected patch, minor, major or x.y.z, got ${bump}`);
  if (compareVersions(bump, current) < 0) {
    throw new Error(`${bump} is older than the current ${current}`);
  }
  return bump;
}

/**
 * package.json with a new version, formatting kept.
 * @param {string} text @param {string} version
 */
export function setPackageVersion(text, version) {
  const field = /("version"\s*:\s*")[^"]*(")/;
  if (!field.test(text)) throw new Error("no version in package.json");
  return text.replace(field, `$1${version}$2`);
}

/**
 * Cargo.toml with a new version in `[package]`, and nowhere else.
 * @param {string} text @param {string} version
 */
export function setCargoVersion(text, version) {
  const m = /^\[package\][^[]*?^version\s*=\s*"[^"]*"/ms.exec(text);
  if (!m) throw new Error("no [package] version in Cargo.toml");
  const updated = m[0].replace(/(^version\s*=\s*")[^"]*(")/m, `$1${version}$2`);
  return text.slice(0, m.index) + updated + text.slice(m.index + m[0].length);
}

/**
 * The version in Cargo.toml's `[package]`.
 * @param {string} text
 */
export function cargoVersion(text) {
  const m = /^\[package\][^[]*?^version\s*=\s*"([^"]*)"/ms.exec(text);
  if (!m?.[1]) throw new Error("no [package] version in Cargo.toml");
  return m[1];
}

const UNRELEASED = /^## Unreleased[ \t]*\r?\n/m;

/**
 * What's listed under `## Unreleased`, trimmed. Empty if nothing is.
 * @param {string} changelog
 */
export function unreleasedNotes(changelog) {
  const m = UNRELEASED.exec(changelog);
  if (!m) throw new Error("CHANGELOG.md has no ## Unreleased section");
  const rest = changelog.slice(m.index + m[0].length);
  const end = rest.search(/^## /m);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

/**
 * Turn `## Unreleased` into `## version - date`, under a new empty one.
 * @param {string} changelog @param {string} version @param {string} date YYYY-MM-DD
 */
export function cutChangelog(changelog, version, date) {
  if (!unreleasedNotes(changelog)) throw new Error("nothing under ## Unreleased in CHANGELOG.md");
  const nl = changelog.includes("\r\n") ? "\r\n" : "\n";
  return changelog.replace(UNRELEASED, `## Unreleased${nl}${nl}## ${version} - ${date}${nl}`);
}

/**
 * The notes for one released version.
 * @param {string} changelog @param {string} version
 */
export function releaseNotes(changelog, version) {
  const heading = new RegExp(`^## ${version.replaceAll(".", "\\.")}\\b.*\\r?\\n`, "m");
  const m = heading.exec(changelog);
  if (!m) throw new Error(`CHANGELOG.md has no ## ${version} section`);
  const rest = changelog.slice(m.index + m[0].length);
  const end = rest.search(/^## /m);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

/** The repo releases go to. */
export const REPO = "takempf/tk-light-mini";

/**
 * Where GitHub serves a release's file.
 * @param {string} version @param {string} file
 */
export const assetUrl = (version, file) =>
  `https://github.com/${REPO}/releases/download/v${version}/${encodeURIComponent(file)}`;

/** Where the app looks for updates: the newest release's `latest.json`. */
export const FEED_URL = `https://github.com/${REPO}/releases/latest/download/latest.json`;

/**
 * The updater's static feed, as tauri-plugin-updater reads it.
 * @param {{ version: string, notes: string, pubDate: Date, signature: string, url: string }} r
 */
export function latestJson({ version, notes, pubDate, signature, url }) {
  return {
    version,
    notes,
    pub_date: pubDate.toISOString(),
    platforms: { "windows-x86_64": { signature: signature.trim(), url } },
  };
}

/** @param {string} b64 */
const decodeLines = (b64) =>
  Buffer.from(b64.trim(), "base64").toString("utf8").split(/\r?\n/).filter(Boolean);

/**
 * Whether `signature` (a `.sig` from `tauri build`) signs `file` with the key
 * `pubkey` (as in `tauri.conf.json`). Both are base64 of minisign's text
 * files. This is what the app checks before installing an update, so a
 * release that fails here would never install.
 * @param {Uint8Array} file @param {string} signature @param {string} pubkey
 */
export function verifySignature(file, signature, pubkey) {
  const keyLines = decodeLines(pubkey);
  const sigLines = decodeLines(signature);
  const key = Buffer.from(keyLines[1] ?? "", "base64");
  const sig = Buffer.from(sigLines[1] ?? "", "base64");
  const trusted = sigLines[2] ?? "";
  const global = Buffer.from(sigLines[3] ?? "", "base64");
  if (key.length !== 42 || sig.length !== 74 || global.length !== 64) return false;
  if (!trusted.startsWith("trusted comment: ")) return false;
  // Both name the same key.
  if (!key.subarray(2, 10).equals(sig.subarray(2, 10))) return false;
  const publicKey = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: key.subarray(10).toString("base64url") },
    format: "jwk",
  });
  const algorithm = sig.subarray(0, 2).toString("latin1");
  // "ED" signs a BLAKE2b-512 hash of the file, "Ed" the file itself.
  const message =
    algorithm === "ED"
      ? createHash("blake2b512").update(file).digest()
      : algorithm === "Ed"
        ? Buffer.from(file)
        : null;
  if (!message) return false;
  const signed = sig.subarray(10);
  return (
    verify(null, message, publicKey, signed) &&
    verify(
      null,
      Buffer.concat([signed, Buffer.from(trusted.slice("trusted comment: ".length), "utf8")]),
      publicKey,
      global,
    )
  );
}
