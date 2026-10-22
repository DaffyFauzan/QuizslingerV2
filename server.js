'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { makeRound, DIFFICULTIES } = require('./math');

const PORT = process.env.PORT || 3000;
const MAX_HP = 3;                 // default lives (2-4 players); scaled down for bigger rooms, see livesFor()
const livesFor = (n) => (n <= 4 ? 3 : n <= 8 ? 2 : 1);
const BULLETS = 6;                // bullets per player PER ROUND (refilled every round)
const MAX_PLAYERS = 16;
const GRACE_MS = +process.env.GRACE_MS || 30000;       // reconnect window
const BETWEEN_MS = +process.env.BETWEEN_MS || 3500;    // pause between rounds
const COUNTDOWN_MS = +process.env.COUNTDOWN_MS || 5000;  // get-ready countdown before round 1
const BLANK_MS = +process.env.BLANK_MS || 1200;        // reload penalty after a blank

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 10000 });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_, res) => res.send('ok'));

const rooms = new Map();
const uid = () => crypto.randomBytes(4).toString('hex');
const clean = (n) => String(n || '').replace(/[<>&"'`]/g, '').trim().slice(0, 14);
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}
const resetPlayer = (p, hp = MAX_HP) => Object.assign(p, {
  hp, alive: true, left: false, loaded: null, spent: new Set(), cd: 0, hits: 0, shots: 0, blanks: 0, wins: 0,
});
const makePlayer = (name, sid) => resetPlayer({
  id: uid(), token: crypto.randomBytes(16).toString('hex'), name, sid, connected: true, grace: null,
});
const list = (room) => [...room.players.values()];
const alive = (room) => list(room).filter((p) => p.alive);
const ack = (cb, error, extra) => typeof cb === 'function' && cb(error ? { ok: false, error } : { ok: true, ...extra });

function view(room, p) {
  const r = room.round;
  return {
    now: Date.now(), countdownEnd: room.state === 'playing' && !room.round ? room.countdownEnd : null, code: room.code, state: room.state, difficulty: room.difficulty, hostId: room.hostId,
    you: p.id, maxHp: room.maxHp || MAX_HP, bullets: BULLETS, ranking: room.ranking,
    players: list(room).map((q) => ({
      id: q.id, name: q.name, connected: q.connected && !q.left, hp: q.hp, alive: q.alive,
      ready: q.loaded !== null, hits: q.hits, shots: q.shots, blanks: q.blanks, wins: q.wins,
    })),
    round: r && {
      no: r.no, text: r.text, choices: r.choices, endsAt: r.endsAt, total: r.total, phase: r.phase, winnerId: r.winnerId,
      correct: r.phase === 'between' ? r.correct : undefined, // never leaked while round is live
    },
    me: { loaded: p.loaded, spent: [...p.spent], cd: p.cd },
  };
}
function broadcast(room) {
  for (const p of list(room)) if (p.sid) io.to(p.sid).emit('state', view(room, p));
}

function startRound(room) {
  const g = makeRound(room.difficulty);
  room.roundNo++;
  room.round = {
    no: room.roundNo, text: g.text, choices: g.choices, correct: g.correct,
    total: g.time * 1000, endsAt: Date.now() + g.time * 1000, phase: 'live', winnerId: null,
  };
  for (const p of list(room)) { p.loaded = null; p.spent = new Set(); p.cd = 0; }
  clearTimeout(room.timer);
  room.timer = setTimeout(() => endRound(room, null), g.time * 1000);
  broadcast(room);
}
function endRound(room, winnerId) {
  const r = room.round;
  if (room.state !== 'playing' || !r || r.phase !== 'live') return;
  r.phase = 'between';
  r.winnerId = winnerId;
  clearTimeout(room.timer);
  if (alive(room).length <= 1) return finish(room);
  broadcast(room);
  room.timer = setTimeout(() => room.state === 'playing' && startRound(room), BETWEEN_MS);
}
function eliminate(room, p) {
  p.alive = false; p.hp = 0; p.loaded = null;
  room.elim.push(p.id);
}
function finish(room) {
  clearTimeout(room.timer);
  if (room.round && room.round.phase === 'live') room.round.phase = 'between';
  room.state = 'finished';
  room.ranking = [...alive(room).map((p) => p.id), ...[...room.elim].reverse()];
  broadcast(room);
}
function afterElimination(room) {
  if (room.state !== 'playing') return broadcast(room);
  if (alive(room).length <= 1) {
    if (room.round && room.round.phase === 'live') endRound(room, null);
    else finish(room);
  } else broadcast(room);
}

function migrateHost(room) {
  const cands = list(room).filter((p) => !p.left);
  const next = cands.find((p) => p.connected) || cands[0];
  room.hostId = next ? next.id : null;
}
// Permanently remove a player (explicit leave or reconnect window expired).
function drop(room, p) {
  clearTimeout(p.grace); p.grace = null;
  if (room.state === 'playing') {
    if (p.alive) eliminate(room, p);
    p.left = true; p.connected = false; p.sid = null;
  } else room.players.delete(p.id);
  if (room.hostId === p.id) migrateHost(room);
  if (!list(room).some((q) => !q.left && (q.connected || q.grace))) {
    clearTimeout(room.timer); rooms.delete(room.code); return;
  }
  room.state === 'playing' ? afterElimination(room) : broadcast(room);
}
function attach(socket, room, p) {
  clearTimeout(p.grace); p.grace = null;
  p.sid = socket.id; p.connected = true;
  socket.data = { code: room.code, pid: p.id };
  socket.join(room.code);
}
function ctx(socket) {
  const room = rooms.get(socket.data && socket.data.code);
  const p = room && room.players.get(socket.data.pid);
  return { room, p };
}
function detach(socket) {
  const { room, p } = ctx(socket);
  socket.data = {};
  if (room && p) { socket.leave(room.code); drop(room, p); }
}

io.on('connection', (socket) => {
  socket.data = {};

  socket.on('room:create', ({ name, difficulty } = {}, cb) => {
    name = clean(name);
    if (!name) return ack(cb, 'Enter a name first.');
    detach(socket);
    const room = {
      code: newCode(), hostId: null, difficulty: DIFFICULTIES[difficulty] ? difficulty : 'easy', state: 'lobby',
      players: new Map(), round: null, roundNo: 0, timer: null, elim: [], ranking: null,
    };
    const p = makePlayer(name, socket.id);
    room.players.set(p.id, p); room.hostId = p.id; rooms.set(room.code, room);
    attach(socket, room, p);
    ack(cb, null, { code: room.code, token: p.token });
    broadcast(room);
  });

  socket.on('room:join', ({ code, name } = {}, cb) => {
    name = clean(name); code = String(code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!name) return ack(cb, 'Enter a name first.');
    if (!room) return ack(cb, 'No room with that code.');
    if (room.state !== 'lobby') return ack(cb, 'That match has already started.');
    if (list(room).length >= MAX_PLAYERS) return ack(cb, 'Room is full (16 players max).');
    if (list(room).some((q) => q.name.toLowerCase() === name.toLowerCase())) return ack(cb, 'That name is taken in this room.');
    detach(socket);
    const p = makePlayer(name, socket.id);
    room.players.set(p.id, p);
    attach(socket, room, p);
    ack(cb, null, { code: room.code, token: p.token });
    broadcast(room);
  });

  socket.on('room:rejoin', ({ code, token } = {}, cb) => {
    const room = rooms.get(String(code || '').toUpperCase());
    const p = room && list(room).find((q) => q.token === token);
    if (!p || p.left) return ack(cb, 'Session expired.');
    if (p.sid && p.sid !== socket.id) io.to(p.sid).emit('replaced'); // same player opened another tab
    attach(socket, room, p);
    if (room.hostId === null || !room.players.has(room.hostId)) migrateHost(room);
    ack(cb, null, { code: room.code });
    broadcast(room);
  });

  socket.on('room:leave', (_, cb) => { detach(socket); ack(cb); });

  socket.on('room:difficulty', ({ difficulty } = {}, cb) => {
    const { room, p } = ctx(socket);
    if (!room || room.hostId !== p.id || room.state !== 'lobby' || !DIFFICULTIES[difficulty]) return ack(cb, 'Not allowed.');
    room.difficulty = difficulty; broadcast(room); ack(cb);
  });

  socket.on('room:start', (_, cb) => {
    const { room, p } = ctx(socket);
    if (!room || room.hostId !== p.id || room.state !== 'lobby') return ack(cb, 'Only the host can start.');
    for (const q of list(room)) if (!q.connected) room.players.delete(q.id);
    if (list(room).length < 2) return ack(cb, 'Need at least 2 players.');
    room.maxHp = livesFor(list(room).length);
    list(room).forEach((q) => resetPlayer(q, room.maxHp));
    room.elim = []; room.ranking = null; room.roundNo = 0; room.state = 'playing';
    room.round = null; room.countdownEnd = Date.now() + COUNTDOWN_MS;   // everyone sees the same 5..1 countdown
    ack(cb); broadcast(room);
    clearTimeout(room.timer);
    room.timer = setTimeout(() => room.state === 'playing' && startRound(room), COUNTDOWN_MS);
  });

  socket.on('room:again', (_, cb) => {
    const { room, p } = ctx(socket);
    if (!room || room.hostId !== p.id || room.state !== 'finished') return ack(cb, 'Only the host can do that.');
    for (const q of list(room)) if (q.left) room.players.delete(q.id);
    list(room).forEach(resetPlayer);
    room.state = 'lobby'; room.round = null; room.ranking = null; room.elim = [];
    ack(cb); broadcast(room);
  });

  // Manual chamber loading: the player picks which of the six answers goes in the chamber.
  socket.on('game:load', ({ index } = {}, cb) => {
    const { room, p } = ctx(socket);
    const r = room && room.round;
    if (!room || room.state !== 'playing' || !r || r.phase !== 'live') return ack(cb, 'Round is not live.');
    if (!p.alive) return ack(cb, 'You are out.');
    if (!Number.isInteger(index) || index < 0 || index >= BULLETS) return ack(cb, 'Invalid bullet.');
    if (p.spent.has(index)) return ack(cb, 'That bullet is already spent.');
    p.loaded = index; broadcast(room); ack(cb);
  });

  socket.on('game:fire', ({ targetId } = {}, cb) => {
    const { room, p } = ctx(socket);
    const r = room && room.round;
    const now = Date.now();
    if (!room || room.state !== 'playing' || !r || r.phase !== 'live') return ack(cb, 'Round is not live.');
    if (!p.alive) return ack(cb, 'You are out.');
    if (p.loaded === null) return ack(cb, 'Load a bullet first.');
    const t = room.players.get(targetId);
    if (!t || !t.alive || t === p) return ack(cb, 'Invalid target.');
    if (now < p.cd) return ack(cb, 'Still reloading.');
    const idx = p.loaded;
    p.loaded = null; p.spent.add(idx); p.shots++;
    const hit = idx === r.correct;
    const evt = { from: p.id, to: t.id, fromName: p.name, toName: t.name, hit, eliminated: false };
    if (hit) {
      t.hp--; p.hits++; p.wins++;
      if (t.hp <= 0) { eliminate(room, t); evt.eliminated = true; }
      io.to(room.code).emit('shot', evt);
      endRound(room, p.id); // first correct shot ends the round; later shots are rejected above
    } else {
      p.blanks++; p.cd = now + BLANK_MS;
      io.to(room.code).emit('shot', evt);
      broadcast(room);
    }
    ack(cb);
  });

  socket.on('disconnect', () => {
    const { room, p } = ctx(socket);
    if (!room || !p || p.sid !== socket.id) return;
    p.connected = false; p.sid = null;
    clearTimeout(p.grace);
    p.grace = setTimeout(() => drop(room, p), GRACE_MS);
    if (room.hostId === p.id) migrateHost(room);
    broadcast(room);
  });
});

if (require.main === module) server.listen(PORT, () => console.log(`Math Duel listening on ${PORT}`));
module.exports = { server, io, rooms };
