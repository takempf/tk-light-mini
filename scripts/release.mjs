// @ts-check
/**
 * Release to GitHub from this PC, with no CI: checks, tests, version bump,
 * signed build, then commit, tag, push and a GitHub release the app updates
 * from.
 *
 *   pnpm release patch|minor|major|x.y.z [--dry-run]
 *
 * --dry-run builds and checks everything, then puts the version back and
 * stops before anything leaves this PC.
 *
 * Signs with the updater key at ~/.tauri/tk-light-mini.key, or the key (or its
 * path) in TAURI_SIGNING_PRIVATE_KEY. Its password, if it has one, goes in
 * TAURI_SIGNING_PRIVATE_KEY_PASSWORD.
 */
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assetUrl,
  cutChangelog,
  FEED_URL,
  latestJson,
  nextVersion,
  REPO,
  releaseNotes,
  setCargoVersion,
  setPackageVersion,
  unreleasedNotes,
  verifySignature,
} from "./release-lib.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const at = (/** @type {string[]} */ ...p) => join(root, ...p);
const FILES = {
  pkg: at("package.json"),
  cargo: at("src-tauri", "Cargo.toml"),
  lock: at("src-tauri", "Cargo.lock"),
  changelog: at("CHANGELOG.md"),
  conf: at("src-tauri", "tauri.conf.json"),
};
const KEY_FILE = join(homedir(), ".tauri", "tk-light-mini.key");

/** Where cargo builds, which CARGO_TARGET_DIR can move. */
const TARGET = process.env.CARGO_TARGET_DIR
  ? resolve(root, process.env.CARGO_TARGET_DIR)
  : at("src-tauri", "target");
const BUNDLE = join(TARGET, "release", "bundle");

// Prefer rustup's cargo over any other on PATH.
const cargoBin = join(homedir(), ".cargo", "bin");
const env = {
  ...process.env,
  PATH: existsSync(cargoBin) ? `${cargoBin}${delimiter}${process.env.PATH}` : process.env.PATH,
  // Absolute: tauri runs cargo from src-tauri, not from here.
  ...(process.env.CARGO_TARGET_DIR ? { CARGO_TARGET_DIR: TARGET } : {}),
};

/**
 * Run a command, streaming its output, and stop the release if it fails.
 * @param {string} cmd @param {string[]} args @param {{ quiet?: boolean, env?: NodeJS.ProcessEnv }} [o]
 */
function run(cmd, args, o = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    env: o.env ?? env,
    stdio: o.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    // pnpm is a .cmd shim on Windows, which only runs through a shell. Its
    // arguments here have no spaces to quote.
    shell: process.platform === "win32" && cmd === "pnpm",
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed${o.quiet ? `:\n${r.stderr}` : ""}`);
  }
  return (r.stdout ?? "").trim();
}
const git = (/** @type {string[]} */ ...args) => run("git", args, { quiet: true });
const step = (/** @type {string} */ s) => console.log(`\n== ${s}`);

function signingKey() {
  const fromEnv = process.env.TAURI_SIGNING_PRIVATE_KEY;
  if (fromEnv) return existsSync(fromEnv) ? readFileSync(fromEnv, "utf8") : fromEnv;
  if (existsSync(KEY_FILE)) return readFileSync(KEY_FILE, "utf8");
  throw new Error(
    `no signing key: put it at ${KEY_FILE} or in TAURI_SIGNING_PRIVATE_KEY. ` +
      "Without the key the app was built with, installed copies can't update.",
  );
}

/** @param {string} version */
function preflight(version) {
  step("Checking the repo");
  if (git("branch", "--show-current") !== "main") throw new Error("release from main");
  if (git("status", "--porcelain")) throw new Error("commit or stash your changes first");
  git("fetch", "--tags", "origin");
  if (git("rev-list", "--count", "HEAD..origin/main") !== "0") {
    throw new Error("main is behind origin/main: pull first");
  }
  if (git("tag", "--list", `v${version}`)) throw new Error(`v${version} is already tagged`);
  run("gh", ["auth", "status"], { quiet: true });
  const notes = unreleasedNotes(readFileSync(FILES.changelog, "utf8"));
  if (!notes) throw new Error("add notes under ## Unreleased in CHANGELOG.md first");
  // Windows locks a running exe, and the files next to it, so the build
  // can't replace them.
  const exe = join(TARGET, "release", "tk-light-mini.exe");
  if (existsSync(exe)) {
    try {
      closeSync(openSync(exe, "r+"));
    } catch {
      throw new Error(
        `${exe} is running: quit it, or set CARGO_TARGET_DIR to build somewhere else`,
      );
    }
  }
  return signingKey();
}

/** @param {string} version */
function bump(version) {
  const date = new Date().toISOString().slice(0, 10);
  const edit = (/** @type {string} */ file, /** @type {(t: string) => string} */ f) =>
    writeFileSync(file, f(readFileSync(file, "utf8")));
  edit(FILES.pkg, (t) => setPackageVersion(t, version));
  edit(FILES.cargo, (t) => setCargoVersion(t, version));
  edit(FILES.changelog, (t) => cutChangelog(t, version, date));
}

/**
 * Build the signed installer and check it the way the app will.
 * @param {string} version @param {string} key
 */
function build(version, key) {
  step("Building the signed installer");
  run("pnpm", ["tauri", "build"], {
    env: {
      ...env,
      TAURI_SIGNING_PRIVATE_KEY: key,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
    },
  });
  const name = `tk-light-mini_${version}_x64-setup.exe`;
  const installer = join(BUNDLE, "nsis", name);
  const sigFile = `${installer}.sig`;
  if (!existsSync(installer) || !existsSync(sigFile)) {
    throw new Error(`the build made no ${name} with a .sig`);
  }
  const signature = readFileSync(sigFile, "utf8");
  const pubkey = JSON.parse(readFileSync(FILES.conf, "utf8")).plugins.updater.pubkey;
  if (!verifySignature(readFileSync(installer), signature, pubkey)) {
    throw new Error("the installer's signature doesn't match the app's updater key");
  }
  console.log(`Signature checks out with the app's key: ${name}`);

  const notes = releaseNotes(readFileSync(FILES.changelog, "utf8"), version);
  const feed = latestJson({
    version,
    notes,
    pubDate: new Date(),
    signature,
    url: assetUrl(version, name),
  });
  const outDir = join(BUNDLE, "updater");
  mkdirSync(outDir, { recursive: true });
  const feedFile = join(outDir, "latest.json");
  writeFileSync(feedFile, `${JSON.stringify(feed, null, 2)}\n`);
  return { installer, sigFile, feedFile, notes };
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch the feed as the app will, and check it offers this version with a
 * good signature.
 * @param {string} version
 */
async function verifyPublished(version) {
  step("Checking the published update");
  const pubkey = JSON.parse(readFileSync(FILES.conf, "utf8")).plugins.updater.pubkey;
  let last = "";
  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt) await sleep(3000);
    try {
      const res = await fetch(FEED_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`latest.json: HTTP ${res.status}`);
      const feed = await res.json();
      if (feed.version !== version) throw new Error(`latest.json offers ${feed.version}`);
      const entry = feed.platforms["windows-x86_64"];
      const file = await fetch(entry.url);
      if (!file.ok) throw new Error(`installer: HTTP ${file.status}`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!verifySignature(bytes, entry.signature, pubkey)) throw new Error("bad signature");
      console.log(`The app will find ${version} at ${FEED_URL}`);
      return;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`the published release doesn't check out: ${last}`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const bumpArg = args.find((a) => !a.startsWith("--"));
  if (!bumpArg) {
    console.log("usage: pnpm release patch|minor|major|x.y.z [--dry-run]");
    process.exit(1);
  }
  const current = JSON.parse(readFileSync(FILES.pkg, "utf8")).version;
  const version = nextVersion(current, bumpArg);
  console.log(`Releasing ${current} -> ${version}${dryRun ? " (dry run)" : ""}`);

  const key = preflight(version);
  step("Lint, typecheck and tests");
  run("pnpm", ["check"]);

  bump(version);
  let built;
  try {
    built = build(version, key);
  } catch (e) {
    git("checkout", "--", FILES.pkg, FILES.cargo, FILES.lock, FILES.changelog);
    throw e;
  }
  if (dryRun) {
    git("checkout", "--", FILES.pkg, FILES.cargo, FILES.lock, FILES.changelog);
    console.log(`\nDry run done. Nothing was committed or published. Built:
  ${built.installer}
  ${built.feedFile}`);
    return;
  }

  step(`Committing and tagging v${version}`);
  git("add", FILES.pkg, FILES.cargo, FILES.lock, FILES.changelog);
  git("commit", "-m", `Release v${version}`);
  git("tag", "-a", `v${version}`, "-m", `v${version}`);
  step("Pushing (the pre-push hook runs the checks again)");
  run("git", ["push", "--atomic", "origin", "main", `v${version}`]);

  step("Publishing the GitHub release");
  const notesFile = join(BUNDLE, "updater", "notes.md");
  writeFileSync(notesFile, `${built.notes}\n`);
  run("gh", [
    "release",
    "create",
    `v${version}`,
    built.installer,
    built.sigFile,
    built.feedFile,
    "--repo",
    REPO,
    "--title",
    `v${version}`,
    "--notes-file",
    notesFile,
    "--verify-tag",
  ]);
  await verifyPublished(version);
  console.log(`\nReleased v${version}: https://github.com/${REPO}/releases/tag/v${version}`);
}

main().catch((e) => {
  console.error(`\nRelease stopped: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
