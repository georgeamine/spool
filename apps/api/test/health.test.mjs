import assert from "node:assert/strict";
import test from "node:test";
import app from "../src/app.mjs";

test("GET /health returns a lightweight liveness payload", async () => {
  const response = await app.request("http://localhost/health");

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /^application\/json\b/);
  assert.deepEqual(await response.json(), {
    status: "ok"
  });
});
