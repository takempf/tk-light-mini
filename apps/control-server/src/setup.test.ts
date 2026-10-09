import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DEFAULT_SETUP, SetupStore, validateSetup } from "./setup.js";

it("validates setup and persists revisions atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tk-light-"));
  const file = join(dir, "setup.json");
  const store = new SetupStore(file);
  await store.load();
  const next = await store.update({ ...store.get(), enabled: true }, 0);
  expect(next.revision).toBe(1);
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(next);
  await expect(store.update(DEFAULT_SETUP, 0)).rejects.toThrow("Revision conflict");
  const reloaded = new SetupStore(file);
  await reloaded.load();
  expect(reloaded.get()).toEqual(next);
  expect(() =>
    validateSetup({ ...next, source: { kind: "remote", senderId: "bad id" } }),
  ).toThrow();
  const racing = await Promise.allSettled([
    store.update({ ...next, fps: 20 }, 1),
    store.update({ ...next, fps: 40 }, 1),
  ]);
  expect(racing.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
  expect(JSON.parse(await readFile(`${file}.bak`, "utf8")).revision).toBe(1);
  expect(() =>
    validateSetup({
      ...next,
      devices: [
        {
          id: "bad",
          ip: "192.168.1.2",
          name: "bad",
          sku: "x",
          on: true,
          razer: false,
          brightness: 1,
          sections: [{ count: 1, color: "bad" }],
        },
      ],
    }),
  ).toThrow("Invalid section");
});
