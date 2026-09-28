import http from "node:http";
import path from "node:path";
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, createReadStream, statSync } from "node:fs";
import { randomBytes, randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import { GameError, newGame, join, leave, start, roll, move, publicGame } from "./game.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const idPattern = /^[a-f0-9]{32}$/;
const bearer = /^Bearer ([a-f0-9]{64})$/;
const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function send(res, status, value) {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(value));
}

async function body(req) {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new GameError("Očekuje se JSON zahtev.");
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) throw new GameError("Zahtev je prevelik.");
  }
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new GameError("Neispravan JSON zahtev."); }
}

export function createApp({ dataDir = path.join(root, "data"), rng = () => randomInt(1, 7) } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const games = new Map();
  const listeners = new Map();
  for (const file of readdirSync(dataDir)) {
    if (!idPattern.test(file.replace(/\.json$/, "")) || !file.endsWith(".json")) continue;
    try {
      const record = JSON.parse(readFileSync(path.join(dataDir, file), "utf8"));
      if (record.id === file.slice(0, -5) && record.game?.version === 1 && Array.isArray(record.tokens)) games.set(record.id, record);
    } catch { /* Oštećen fajl ostaje na disku radi oporavka. */ }
  }
  function save(record) {
    const target = path.join(dataDir, `${record.id}.json`);
    const temp = path.join(dataDir, `${record.id}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
    writeFileSync(temp, JSON.stringify(record), { mode: 0o600 });
    renameSync(temp, target);
  }
  function publish(record) {
    const payload = `event: state\ndata: ${JSON.stringify(publicGame(record.game))}\n\n`;
    for (const res of listeners.get(record.id) || []) res.write(payload);
  }
  function auth(req, record) {
    const token = bearer.exec(req.headers.authorization || "")?.[1];
    const seat = record.tokens.indexOf(token);
    if (seat < 0) throw new GameError("Nevažeći pristupni token.");
    return seat;
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/app.js" || url.pathname === "/menu.css")) {
        const file = url.pathname === "/app.js" ? "app.js" : url.pathname === "/menu.css" ? "menu.css" : "index.html";
        const target = path.join(root, "public", file);
        const contentType = file.endsWith(".js") ? "text/javascript; charset=utf-8" : file.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8";
        res.writeHead(200, { "content-type": contentType, "content-length": statSync(target).size });
        createReadStream(target).pipe(res);
        return;
      }
      if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true, service: "covece-server" });
      if (req.method === "POST" && url.pathname === "/api/games") {
        const input = await body(req);
        const game = newGame(input.seats ?? 4);
        const id = randomBytes(16).toString("hex");
        const token = randomBytes(32).toString("hex");
        join(game, randomBytes(16).toString("hex"), input.name);
        const record = { id, game, tokens: [token] };
        games.set(id, record);
        save(record);
        return send(res, 201, { id, seat: 0, token, state: publicGame(game) });
      }
      if (parts[0] !== "api" || parts[1] !== "games" || !idPattern.test(parts[2] || "")) return send(res, 404, { error: "Ruta ne postoji." });
      const record = games.get(parts[2]);
      if (!record) return send(res, 404, { error: "Partija ne postoji." });
      if (req.method === "GET" && parts.length === 3) return send(res, 200, publicGame(record.game));
      if (req.method === "GET" && parts[3] === "events" && parts.length === 4) {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(`event: state\ndata: ${JSON.stringify(publicGame(record.game))}\n\n`);
        if (!listeners.has(record.id)) listeners.set(record.id, new Set());
        listeners.get(record.id).add(res);
        const ping = setInterval(() => res.write(": keepalive\n\n"), 25000);
        req.on("close", () => { clearInterval(ping); listeners.get(record.id)?.delete(res); });
        return;
      }
      if (req.method !== "POST" || parts.length !== 4) return send(res, 404, { error: "Ruta ne postoji." });
      const action = parts[3];
      if (action === "join") {
        const input = await body(req);
        const token = randomBytes(32).toString("hex");
        const seat = join(record.game, randomBytes(16).toString("hex"), input.name);
        record.tokens[seat] = token;
        save(record); publish(record);
        return send(res, 201, { id: record.id, seat, token, state: publicGame(record.game) });
      }
      const seat = auth(req, record);
      if (action === "leave") {
        await body(req);
        leave(record.game, seat);
        record.tokens.splice(seat, 1);
      } else if (action === "start") {
        await body(req);
        start(record.game, seat);
      } else if (action === "roll") {
        await body(req);
        roll(record.game, seat, rng());
      } else if (action === "move") {
        const input = await body(req);
        move(record.game, seat, input.piece);
      } else return send(res, 404, { error: "Ruta ne postoji." });
      save(record); publish(record);
      return send(res, 200, publicGame(record.game));
    } catch (error) {
      return send(res, error instanceof GameError ? 400 : 500, { error: error instanceof GameError ? error.message : "Greška servera." });
    }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, process.env.HOST || "0.0.0.0", () => console.log(`Čoveče server sluša na portu ${port}`));
}
