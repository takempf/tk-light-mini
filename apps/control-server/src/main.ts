import { resolve } from "node:path";
import { Govee } from "./govee.js";
import { createControlServer } from "./server.js";
import { SetupStore } from "./setup.js";

const adminToken = process.env.TK_LIGHT_ADMIN_TOKEN;
const senderToken = process.env.TK_LIGHT_SENDER_TOKEN;
const senderTokens = process.env.TK_LIGHT_SENDERS
  ? (JSON.parse(process.env.TK_LIGHT_SENDERS) as Record<string, string>)
  : undefined;
if (
  !adminToken ||
  adminToken.length < 16 ||
  (!senderTokens && (!senderToken || senderToken.length < 16)) ||
  (senderTokens && Object.values(senderTokens).some((token) => token.length < 16))
)
  throw new Error(
    "Set TK_LIGHT_ADMIN_TOKEN and TK_LIGHT_SENDERS (or TK_LIGHT_SENDER_TOKEN) to secrets of at least 16 characters",
  );
const host = process.env.TK_LIGHT_HOST ?? "127.0.0.1";
const port = Number(process.env.TK_LIGHT_PORT ?? 8787);
const store = new SetupStore(resolve(process.env.TK_LIGHT_DATA ?? "./data/setup.json"));
await store.load();
const lights = new Govee();
const app = createControlServer({
  store,
  lights,
  adminToken,
  senderToken,
  senderTokens,
  adminDist: resolve("../admin-web/dist"),
});
app.server.listen(port, host, () =>
  console.log(`Control server listening on http://${host}:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().finally(() => {
      lights.close();
      process.exit(0);
    });
  });
