const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const G = require("./lib/gameLogic");
const D = require("./lib/gameData");

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/api/config", (req, res) => {
  res.json({
    players: D.PLAYERS,
    basePrice: D.BASE_PRICE,
    catLabel: D.CAT_LABEL,
    formations: D.FORMATIONS,
    budget: D.BUDGET,
    maxSquad: G.MAX_SQUAD,
  });
});
app.get("/healthz", (req, res) => res.send("ok"));

const server = http.createServer(app);
const io = new Server(server);

/** code -> room state (see lib/gameLogic.createRoom) */
const rooms = new Map();
/** code -> { lot: Timeout|null, squad: { [managerId]: Timeout } } */
const timers = new Map();
/** code -> Set<Socket> currently viewing that room */
const socketsByCode = new Map();

const DATA_DIR = path.join(__dirname, "data");
const HOF_PATH = path.join(DATA_DIR, "hof.json");
function loadHof() {
  try {
    return JSON.parse(fs.readFileSync(HOF_PATH, "utf8"));
  } catch (e) {
    return { managers: {}, log: [] };
  }
}
function saveHof(hof) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HOF_PATH, JSON.stringify(hof));
  } catch (e) {
    console.error("Failed to save Hall of Fame:", e.message);
  }
}
let hof = loadHof();

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(s) ? genCode() : s;
}

function broadcast(code) {
  const room = rooms.get(code);
  const sockets = socketsByCode.get(code);
  if (!room || !sockets) return;
  sockets.forEach((sock) => {
    sock.emit("state", G.redactRoomFor(room, sock.data.clientId));
  });
}

function clearRoomTimers(code) {
  const t = timers.get(code);
  if (!t) return;
  if (t.lot) clearTimeout(t.lot);
  Object.values(t.squad || {}).forEach((h) => clearTimeout(h));
  timers.set(code, { lot: null, squad: {} });
}
function scheduleLotTimer(code) {
  const room = rooms.get(code);
  if (!room || room.phase !== "auction") return;
  const t = timers.get(code) || { lot: null, squad: {} };
  if (t.lot) clearTimeout(t.lot);
  const delay = Math.max(0, room.lotEndsAt - Date.now());
  t.lot = setTimeout(() => doFinalize(code, {}), delay);
  timers.set(code, t);
}
function scheduleSquadTimers(code) {
  const room = rooms.get(code);
  if (!room || room.phase !== "squad") return;
  const t = timers.get(code) || { lot: null, squad: {} };
  Object.entries(room.managers).forEach(([id, m]) => {
    if (m.locked || !m.squadDeadline) return;
    if (t.squad[id]) clearTimeout(t.squad[id]);
    const delay = Math.max(0, m.squadDeadline - Date.now());
    t.squad[id] = setTimeout(() => {
      const r = rooms.get(code);
      if (!r || r.phase !== "squad") return;
      const res = G.autoLockManager(r, id);
      broadcast(code);
      if (res.allLocked) clearRoomTimers(code);
    }, delay);
  });
  timers.set(code, t);
}
function doFinalize(code, opts) {
  const room = rooms.get(code);
  if (!room) return;
  G.finalizeLot(room, opts);
  broadcast(code);
  if (room.phase === "auction") scheduleLotTimer(code);
  else if (room.phase === "squad") scheduleSquadTimers(code);
}

function joinSocketToRoom(socket, code, clientId) {
  if (socket.data.code && socketsByCode.has(socket.data.code)) {
    socketsByCode.get(socket.data.code).delete(socket);
  }
  socket.data.code = code;
  socket.data.clientId = clientId;
  if (!socketsByCode.has(code)) socketsByCode.set(code, new Set());
  socketsByCode.get(code).add(socket);
  const room = rooms.get(code);
  socket.emit("state", G.redactRoomFor(room, clientId));
}
function currentRoom(socket) {
  return socket.data.code ? rooms.get(socket.data.code) : null;
}
function mutateAndBroadcast(socket, cb, fn) {
  const room = currentRoom(socket);
  if (!room) return cb && cb({ error: "You're not in a room." });
  const res = fn(room) || {};
  if (res.error) return cb && cb(res);
  broadcast(room.code);
  cb && cb({ ok: true });
}

io.on("connection", (socket) => {
  socket.data.clientId = null;
  socket.data.code = null;

  socket.on("createRoom", (payload, cb) => {
    const clientId = payload && payload.clientId;
    if (!clientId) return cb && cb({ error: "Missing client id." });
    const code = genCode();
    rooms.set(code, G.createRoom(code, clientId));
    timers.set(code, { lot: null, squad: {} });
    socketsByCode.set(code, new Set());
    joinSocketToRoom(socket, code, clientId);
    cb && cb({ code });
  });

  socket.on("joinRoom", (payload, cb) => {
    const { code, clientId } = payload || {};
    const room = rooms.get((code || "").toUpperCase().trim());
    if (!room) return cb && cb({ error: "No room with that code." });
    if (!clientId) return cb && cb({ error: "Missing client id." });
    joinSocketToRoom(socket, room.code, clientId);
    cb && cb({ ok: true, code: room.code });
  });

  socket.on("joinAsManager", (payload, cb) => {
    const room = currentRoom(socket);
    if (!room) return cb && cb({ error: "You're not in a room." });
    const res = G.joinAsManager(room, socket.data.clientId, payload && payload.name);
    if (res.error) return cb && cb(res);
    broadcast(room.code);
    cb && cb({ ok: true, id: res.id });
  });

  socket.on("startAuction", (payload, cb) => {
    const room = currentRoom(socket);
    if (!room) return cb && cb({ error: "You're not in a room." });
    const res = G.startAuction(room, socket.data.clientId);
    if (res.error) return cb && cb(res);
    broadcast(room.code);
    scheduleLotTimer(room.code);
    cb && cb({ ok: true });
  });

  socket.on("placeBid", (payload, cb) => {
    const room = currentRoom(socket);
    if (!room) return cb && cb({ error: "You're not in a room." });
    const res = G.placeBid(room, socket.data.clientId, payload && payload.managerId);
    if (res.error) return cb && cb(res);
    broadcast(room.code);
    scheduleLotTimer(room.code);
    cb && cb({ ok: true });
  });
  socket.on("passLot", (payload, cb) => {
    const room = currentRoom(socket);
    if (!room) return cb && cb({ error: "You're not in a room." });
    const res = G.passLot(room, socket.data.clientId);
    if (res.error) return cb && cb(res);
    broadcast(room.code);
    if (res.allPassed) doFinalize(room.code, {});
    cb && cb({ ok: true });
  });

  socket.on("forceSell", (payload, cb) => {
    const room = currentRoom(socket);
    if (!room) return cb && cb({ error: "You're not in a room." });
    if (room.hostClientId !== socket.data.clientId) return cb && cb({ error: "Host only." });
    doFinalize(room.code, {});
    cb && cb({ ok: true });
  });
  socket.on("forceSkip", (payload, cb) => {
    const room = currentRoom(socket);
    if (!room) return cb && cb({ error: "You're not in a room." });
    if (room.hostClientId !== socket.data.clientId) return cb && cb({ error: "Host only." });
    doFinalize(room.code, { clearBidder: true });
    cb && cb({ ok: true });
  });
  socket.on("skipCategory", (payload, cb) => {
    const room = currentRoom(socket);
    if (!room) return cb && cb({ error: "You're not in a room." });
    const res = G.skipToNextCategory(room, socket.data.clientId);
    if (res.error) return cb && cb(res);
    broadcast(room.code);
    scheduleLotTimer(room.code);
    if (room.phase === "squad") scheduleSquadTimers(room.code);
    cb && cb({ ok: true });
  });

  socket.on("pickFormation", (payload, cb) =>
    mutateAndBroadcast(socket, cb, (room) => G.pickFormation(room, socket.data.clientId, payload && payload.formation))
  );
  socket.on("moveSlot", (payload, cb) =>
    mutateAndBroadcast(socket, cb, (room) =>
      G.movePlayerToSlot(
        room, socket.data.clientId,
        payload && payload.playerId,
        payload && payload.toCat!==undefined ? payload.toCat : null,
        payload && payload.toIdx!==undefined ? payload.toIdx : null
      )
    )
  );
  socket.on("autofill", (payload, cb) =>
    mutateAndBroadcast(socket, cb, (room) => G.autofillSlots(room, socket.data.clientId))
  );
  socket.on("lockSquad", (payload, cb) => {
    const room = currentRoom(socket);
    if (!room) return cb && cb({ error: "You're not in a room." });
    const res = G.lockSquad(room, socket.data.clientId);
    if (res.error) return cb && cb(res);
    broadcast(room.code);
    if (res.allLocked) clearRoomTimers(room.code);
    cb && cb({ ok: true });
  });

  socket.on("requestSwitch", (payload, cb) =>
    mutateAndBroadcast(socket, cb, (room) => G.requestSwitch(room, socket.data.clientId))
  );
  socket.on("voteSwitch", (payload, cb) =>
    mutateAndBroadcast(socket, cb, (room) => G.voteSwitch(room, socket.data.clientId, payload && payload.vote))
  );
  socket.on("chooseSwitchCategory", (payload, cb) =>
    mutateAndBroadcast(socket, cb, (room) => G.chooseSwitchCategory(room, socket.data.clientId, payload && payload.category))
  );
  socket.on("submitSwitchOffer", (payload, cb) =>
    mutateAndBroadcast(socket, cb, (room) => G.submitSwitchOffer(room, socket.data.clientId, payload && payload.playerId, payload && payload.price))
  );
  socket.on("acceptSwitchOffer", (payload, cb) =>
    mutateAndBroadcast(socket, cb, (room) => G.acceptSwitchOffer(room, socket.data.clientId, payload && payload.offerIndex, payload && payload.removePlayerId))
  );
  socket.on("cancelSwitch", (payload, cb) =>
    mutateAndBroadcast(socket, cb, (room) => G.cancelSwitch(room, socket.data.clientId))
  );
  socket.on("endSwitchWindow", (payload, cb) => {
    const room = currentRoom(socket);
    if (!room) return cb && cb({ error: "You're not in a room." });
    const res = G.endSwitchWindow(room, socket.data.clientId);
    if (res.error) return cb && cb(res);
    broadcast(room.code);
    scheduleSquadTimers(room.code);
    cb && cb({ ok: true });
  });

  socket.on("getHof", (payload, cb) => cb && cb({ hof }));
  socket.on("submitNight", (payload, cb) => {
    const room = currentRoom(socket);
    if (!room) return cb && cb({ error: "You're not in a room." });
    if (room.hostClientId !== socket.data.clientId) return cb && cb({ error: "Host only." });
    hof = G.mergeHof(hof, room, (payload && payload.recordDraft) || {}, payload && payload.championId);
    saveHof(hof);
    cb && cb({ ok: true, hof });
  });

  socket.on("disconnect", () => {
    const code = socket.data.code;
    if (code && socketsByCode.has(code)) socketsByCode.get(code).delete(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("FC27 Auction Night listening on port " + PORT));
