import test from "node:test";
import assert from "node:assert/strict";
import app from "../src/app.mjs";

test("GET /health returns a 200 JSON health payload", async () => {
  const response = await app.fetch(new Request("http://localhost/health"));

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /^application\/json\b/);
  assert.deepEqual(await response.json(), { ok: true });
});
