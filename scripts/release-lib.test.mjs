// @ts-check
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assetUrl,
  cargoVersion,
  compareVersions,
  cutChangelog,
  FEED_URL,
  latestJson,
  nextVersion,
  releaseNotes,
  setCargoVersion,
  setPackageVersion,
  unreleasedNotes,
  verifySignature,
} from "./release-lib.mjs";

// Tests run from the project root.
/** @param {string[]} p */
const read = (...p) => readFileSync(join(process.cwd(), ...p), "utf8");
const fixture = (/** @type {string} */ f) => join(process.cwd(), "scripts", "fixtures", f);

describe("versions", () => {
  it("compares", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("0.9.9", "1.0.0")).toBe(-1);
  });

  it("bumps", () => {
    expect(nextVersion("0.1.9", "patch")).toBe("0.1.10");
    expect(nextVersion("0.1.9", "minor")).toBe("0.2.0");
    expect(nextVersion("0.1.9", "major")).toBe("1.0.0");
  });

  it("takes an exact version, the same one for a first release, never an older one", () => {
    expect(nextVersion("0.1.0", "0.3.0")).toBe("0.3.0");
    expect(nextVersion("0.1.0", "0.1.0")).toBe("0.1.0");
    expect(() => nextVersion("0.2.0", "0.1.5")).toThrow(/older/);
    expect(() => nextVersion("0.1.0", "v0.2")).toThrow(/expected/);
    expect(() => nextVersion("0.1.0", "1.0.0-beta")).toThrow(/expected/);
  });

  it("sets package.json's version and keeps its formatting", () => {
    const text =
      '{\r\n  "name": "x",\r\n  "version": "0.1.0",\r\n  "deps": { "version": "9" }\r\n}\r\n';
    expect(setPackageVersion(text, "0.2.0")).toBe(text.replace('"0.1.0"', '"0.2.0"'));
    expect(() => setPackageVersion("{}", "1.0.0")).toThrow();
  });

  it("sets Cargo.toml's package version only", () => {
    const toml = [
      "[package]",
      'name = "app"',
      'version = "0.1.0"',
      "",
      "[dependencies]",
      'serde = { version = "1" }',
      "",
      "[dependencies.other]",
      'version = "0.1.0"',
      "",
    ].join("\n");
    const out = setCargoVersion(toml, "0.2.0");
    expect(cargoVersion(out)).toBe("0.2.0");
    expect(out).toContain('serde = { version = "1" }');
    expect(out.match(/version = "0\.1\.0"/g)).toHaveLength(1);
    expect(() => setCargoVersion("[dependencies]\n", "1.0.0")).toThrow();
  });
});

describe("changelog", () => {
  const log = [
    "# Changelog",
    "",
    "## Unreleased",
    "",
    "- New thing",
    "- Fixed thing",
    "",
    "## 0.1.0 - 2026-01-01",
    "",
    "- First",
    "",
  ].join("\n");

  it("reads what's unreleased", () => {
    expect(unreleasedNotes(log)).toBe("- New thing\n- Fixed thing");
    expect(unreleasedNotes("## Unreleased\n\n## 0.1.0\n- a\n")).toBe("");
    expect(() => unreleasedNotes("# Changelog\n")).toThrow(/Unreleased/);
  });

  it("cuts a release under a fresh Unreleased", () => {
    const out = cutChangelog(log, "0.2.0", "2026-10-01");
    expect(unreleasedNotes(out)).toBe("");
    expect(releaseNotes(out, "0.2.0")).toBe("- New thing\n- Fixed thing");
    expect(releaseNotes(out, "0.1.0")).toBe("- First");
    expect(out).toContain("## Unreleased\n\n## 0.2.0 - 2026-10-01\n");
  });

  it("keeps Windows line endings", () => {
    const crlf = log.replaceAll("\n", "\r\n");
    const out = cutChangelog(crlf, "0.2.0", "2026-10-01");
    expect(out).not.toMatch(/[^\r]\n/);
    expect(releaseNotes(out, "0.2.0")).toBe("- New thing\r\n- Fixed thing");
  });

  it("won't release with nothing to say", () => {
    expect(() => cutChangelog("## Unreleased\n\n## 0.1.0\n- a\n", "0.2.0", "2026-10-01")).toThrow(
      /nothing/,
    );
  });

  it("doesn't mistake 0.1.10 for 0.1.1", () => {
    const out = "## 0.1.10 - x\n- ten\n\n## 0.1.1 - y\n- one\n";
    expect(releaseNotes(out, "0.1.1")).toBe("- one");
    expect(() => releaseNotes(out, "0.1.2")).toThrow();
  });
});

describe("latest.json", () => {
  it("is what the updater reads", () => {
    const url = assetUrl("1.2.3", "tk-light-mini_1.2.3_x64-setup.exe");
    expect(url).toBe(
      "https://github.com/takempf/tk-light-mini/releases/download/v1.2.3/tk-light-mini_1.2.3_x64-setup.exe",
    );
    expect(
      latestJson({
        version: "1.2.3",
        notes: "- Faster",
        pubDate: new Date("2026-10-01T12:00:00Z"),
        signature: "c2ln\n",
        url,
      }),
    ).toEqual({
      version: "1.2.3",
      notes: "- Faster",
      pub_date: "2026-10-01T12:00:00.000Z",
      platforms: { "windows-x86_64": { signature: "c2ln", url } },
    });
  });
});

describe("feed fixture", () => {
  // src-tauri/src/updates.rs serves this to the real updater, so it has to be
  // what latestJson writes.
  it("matches what a release writes", () => {
    const sig = read("scripts", "fixtures", "installer.txt.sig");
    expect(
      latestJson({
        version: "9.9.9",
        notes: "- Faster scans",
        pubDate: new Date("2026-10-01T12:00:00Z"),
        signature: sig,
        url: "http://127.0.0.1:PORT/installer.txt",
      }),
    ).toEqual(JSON.parse(read("scripts", "fixtures", "latest.json")));
  });
});

describe("signatures", () => {
  const file = readFileSync(fixture("installer.txt"));
  const sig = read("scripts", "fixtures", "installer.txt.sig");
  const pub = read("scripts", "fixtures", "fixture.key.pub");

  it("accepts a file tauri signed", () => {
    expect(verifySignature(file, sig, pub)).toBe(true);
  });

  it("rejects a changed file", () => {
    const changed = Buffer.from(file);
    changed[0] = (changed[0] ?? 0) ^ 1;
    expect(verifySignature(changed, sig, pub)).toBe(false);
  });

  it("rejects another key", () => {
    const appKey = /** @type {{ plugins: { updater: { pubkey: string } } }} */ (
      JSON.parse(read("src-tauri", "tauri.conf.json"))
    ).plugins.updater.pubkey;
    expect(verifySignature(file, sig, appKey)).toBe(false);
  });

  it("rejects a changed trusted comment", () => {
    const lines = Buffer.from(sig, "base64").toString("utf8").split("\n");
    lines[2] = `${lines[2]}x`;
    const forged = Buffer.from(lines.join("\n")).toString("base64");
    expect(verifySignature(file, forged, pub)).toBe(false);
  });

  it("rejects junk", () => {
    expect(verifySignature(file, "", pub)).toBe(false);
    expect(verifySignature(file, "bm90IGEgc2ln", pub)).toBe(false);
  });

  it("checks minisign's plain Ed scheme too", () => {
    // Build a minisign key and signature by hand.
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const raw = Buffer.from(
      /** @type {string} */ (publicKey.export({ format: "jwk" }).x),
      "base64url",
    );
    const id = randomBytes(8);
    const keyFile = `untrusted comment: k\n${Buffer.concat([Buffer.from("Ed"), id, raw]).toString("base64")}\n`;
    const data = Buffer.from("plain");
    const s = sign(null, data, privateKey);
    const comment = "timestamp:1";
    const global = sign(null, Buffer.concat([s, Buffer.from(comment)]), privateKey);
    const sigFile = [
      "untrusted comment: s",
      Buffer.concat([Buffer.from("Ed"), id, s]).toString("base64"),
      `trusted comment: ${comment}`,
      global.toString("base64"),
      "",
    ].join("\n");
    const b64 = (/** @type {string} */ t) => Buffer.from(t).toString("base64");
    expect(verifySignature(data, b64(sigFile), b64(keyFile))).toBe(true);
    expect(verifySignature(Buffer.from("plainer"), b64(sigFile), b64(keyFile))).toBe(false);
  });
});

describe("release config", () => {
  const pkg = JSON.parse(read("package.json"));
  const conf = JSON.parse(read("src-tauri", "tauri.conf.json"));

  it("has one version, in package.json, that Cargo.toml matches", () => {
    expect(conf.version).toBe("../package.json");
    expect(cargoVersion(read("src-tauri", "Cargo.toml"))).toBe(pkg.version);
  });

  it("builds signed installers the updater can use", () => {
    expect(conf.bundle.targets).toEqual(["nsis"]);
    expect(conf.bundle.createUpdaterArtifacts).toBe(true);
  });

  it("looks for updates in the newest GitHub release", () => {
    expect(conf.plugins.updater.endpoints).toEqual([FEED_URL]);
    const key = Buffer.from(conf.plugins.updater.pubkey, "base64").toString("utf8");
    expect(key).toMatch(/^untrusted comment: minisign public key/);
    expect(Buffer.from(key.split("\n")[1] ?? "", "base64")).toHaveLength(42);
  });

  it("lists a changelog entry for this version, or has one waiting", () => {
    const log = read("CHANGELOG.md");
    const released = (() => {
      try {
        return releaseNotes(log, pkg.version);
      } catch {
        return "";
      }
    })();
    expect(released || unreleasedNotes(log)).not.toBe("");
  });
});
