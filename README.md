# Math Duel

Gunblood-style Wild West duels with math. 2–4 players share one equation and six bullets (six answers, one correct). Load a bullet yourself, pick a target, fire.

## Rules (implemented exactly)
- **Six bullets refill every round** (the limit is per round, not per match). Each bullet is one of the six answers.
- Load any unspent bullet by tapping it (never auto-loaded). Reloading a different bullet swaps the chamber.
- **Correct bullet = hit** (target loses 1 of 3 lives) and ends the round. **Wrong bullet = blank**: it is spent and you must wait 1.2s to fire again.
- If time runs out, nobody is hit. A new equation starts after ~3.5s.
- Last player alive wins. Ranking = survivor, then reverse elimination order.

## Run locally
```bash
npm install
npm start            # http://localhost:3000
npm test             # math validity + 2/3/4-player simulations + reconnect
```
Open several browser tabs (or phones on the same network) to play.

## Deploy on Render
1. Push this folder to a GitHub repo.
2. Render dashboard → **New → Blueprint** → select the repo (uses `render.yaml`), or **New → Web Service** with: Runtime Node, Build `npm install --omit=dev`, Start `node server.js`, Health check path `/healthz`.
3. Deploy. Render sets `PORT` automatically; WebSockets work with no extra config. Play at your `https://<name>.onrender.com` URL.
- Optional env vars: `GRACE_MS` (reconnect window, default 30000), `BETWEEN_MS`, `BLANK_MS`.
- Free instances sleep after inactivity (first load is slow) and rooms live in memory, so a restart ends active matches. No database is needed. For stats/accounts later, add Render Postgres and a `DATABASE_URL` env var.
- Keep a single instance: rooms are in-process. Scaling out needs the Socket.IO Redis adapter plus room storage in Redis.

## Architecture
- `server.js`: Express static hosting + Socket.IO. The server owns all state (rooms, HP, bullets, timers, correct answer). Clients send only intents (`game:load`, `game:fire`); the server validates phase, ownership, target, spent bullets and cooldown, and Node's single thread serialises simultaneous shots (the first correct shot ends the round; later shots are rejected).
- After every change the server sends each player a personalised `state` snapshot. The correct index is only included after the round ends. `shot` events drive animations and sounds.
- Reconnect: a secret token is kept in `localStorage`; on reconnect the client emits `room:rejoin`. Players have 30s before being eliminated (in a match) or removed (lobby). Host passes to another player if they leave.
- `math.js`: pluggable generators per topic and difficulty (`TOPICS`); distractors are distinct integers, so exactly one choice is correct.
- `public/`: vanilla JS, responsive CSS (touch-sized chambers, safe-area insets, landscape layout), WebAudio synthesised sounds.
