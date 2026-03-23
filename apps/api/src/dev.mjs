import { serve } from "@hono/node-server";
import app from "./app.mjs";

const port = Number.parseInt(process.env.PORT || "8787", 10);

serve({
  fetch: app.fetch,
  port
});
