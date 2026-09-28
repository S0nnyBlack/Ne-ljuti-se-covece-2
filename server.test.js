import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./server.js";

test("API čuva partiju i odbija potez bez tokena ili van reda", async () => {
  const dir = mkdtempSync(path.join(path.dirname(fileURLToPath(import.meta.url)), ".test-data-"));
  let server = createApp({ dataDir: dir, rng: () => 6 });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, payload, token) => fetch(base + url, {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload)
  });
  try {
    const page = await (await fetch(base + "/")).text();
    assert.match(page, /session-panel/);
    assert.match(page, /\/app\.js/);
    const client = await (await fetch(base + "/app.js")).text();
    assert.match(client, /EventSource/);
    const created = await (await post("/api/games", { seats: 2, name: "Ana" })).json();
    const joined = await (await post(`/api/games/${created.id}/join`, { name: "Bojan" })).json();
    assert.equal(joined.state.phase, "await-roll");
    assert.equal(JSON.stringify(joined.state).includes(created.token), false);
    assert.equal((await post(`/api/games/${created.id}/roll`, {}, joined.token)).status, 400);
    assert.equal((await post(`/api/games/${created.id}/roll`, {})).status, 400);
    const rolled = await (await post(`/api/games/${created.id}/roll`, {}, created.token)).json();
    assert.deepEqual(rolled.legalMoves, [0, 1, 2, 3]);
    assert.equal((await post(`/api/games/${created.id}/move`, { piece: 5 }, created.token)).status, 400);
    const moved = await (await post(`/api/games/${created.id}/move`, { piece: 0 }, created.token)).json();
    assert.equal(moved.pieces[0][0], 0);
    await new Promise(resolve => server.close(resolve));
    server = createApp({ dataDir: dir });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const restored = await (await fetch(`${base}/api/games/${created.id}`)).json();
    assert.equal(restored.pieces[0][0], 0);
    assert.equal(restored.current, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
