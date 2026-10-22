'use strict';
process.env.BLANK_MS = '20'; process.env.BETWEEN_MS = '60'; process.env.PORT = '0'; process.env.COUNTDOWN_MS = '300';
const assert = require('assert');
const { makeRound, DIFFICULTIES } = require('../math');
const { server, io } = require('../server');
const ioc = require('socket.io-client');

// 1. Math: exactly one correct, distinct integer choices, arithmetic verified by eval.
for (const d of Object.keys(DIFFICULTIES)) {
  for (let i = 0; i < 3000; i++) {
    const r = makeRound(d);
    assert.strictEqual(r.choices.length, 6);
    assert.strictEqual(new Set(r.choices).size, 6, 'choices must be distinct');
    assert(r.choices.every(Number.isInteger));
    assert(r.correct >= 0 && r.correct < 6);
    if (!/x/.test(r.text)) {
      const expr = r.text.replace(' = ?', '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/(\d+)²/g, '($1**2)');
      assert.strictEqual(eval(expr), r.choices[r.correct], r.text);
    } else {
      const [lhs, rhs] = r.text.split(', x')[0].split(' = ');
      const f = (s, x) => eval(s.replace(/(\d+)x/g, '$1*(' + x + ')').replace(/x/g, x));
      const sol = r.choices[r.correct];
      assert.strictEqual(f(lhs, sol), f(rhs, sol), r.text);
      assert(r.choices.filter((c) => f(lhs, c) === f(rhs, c)).length === 1, 'exactly one solution: ' + r.text);
    }
  }
}
console.log('math ok');

const connect = (url) => new Promise((res) => { const s = ioc(url, { forceNew: true }); s.on('connect', () => res(s)); });
const emit = (s, ev, d) => new Promise((res) => s.emit(ev, d, res));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function playMatch(url, n) {
  const socks = [], states = [], tokens = [];
  for (let i = 0; i < n; i++) {
    const s = await connect(url); socks.push(s); states.push(null);
    s.on('state', (st) => (states[i] = st));
  }
  const c = await emit(socks[0], 'room:create', { name: 'P0', difficulty: 'easy' }); assert(c.ok); tokens.push(c.token);
  for (let i = 1; i < n; i++) { const j = await emit(socks[i], 'room:join', { name: 'P' + i, code: c.code }); assert(j.ok, j.error); tokens.push(j.token); }
  assert((await emit(socks[1], 'room:start')).ok === false, 'non-host cannot start');
  assert((await emit(socks[0], 'room:start')).ok);
  await sleep(100);
  assert.strictEqual(states[0].state, 'playing');
  assert.strictEqual(states[0].round, null, 'no round during countdown');
  assert(states[0].countdownEnd > Date.now() - 1000, 'countdown is synced');
  assert((await emit(socks[0], 'game:load', { index: 0 })).ok === false, 'cannot load during countdown');
  await sleep(350);
  // all players see identical equation + choices; correct answer hidden while live
  states.forEach((s) => { assert.strictEqual(s.round.text, states[0].round.text); assert.deepStrictEqual(s.round.choices, states[0].round.choices); assert.strictEqual(s.round.correct, undefined); });
  // validation checks
  assert((await emit(socks[0], 'game:fire', { targetId: states[0].players[1].id })).ok === false, 'fire without load');
  await emit(socks[0], 'game:load', { index: 0 });
  assert((await emit(socks[0], 'game:fire', { targetId: states[0].you })).ok === false, 'self target');
  assert((await emit(socks[0], 'game:fire', { targetId: 'nope' })).ok === false, 'bad target');
  // reconnect mid-match
  const old = socks[1]; old.disconnect(); await sleep(50);
  assert.strictEqual(states[0].players[1].connected, false);
  const back = await connect(url); socks[1] = back; back.on('state', (st) => (states[1] = st));
  assert((await emit(back, 'room:rejoin', { code: c.code, token: tokens[1] })).ok);
  await sleep(50); assert.strictEqual(states[0].players[1].connected, true);
  // bots: each tries bullets in order at a random live opponent; everyone fires simultaneously
  let over = false, guard = 0;
  while (!over && guard++ < 6000) {
    await Promise.all(socks.map(async (s, i) => {
      const st = states[i]; if (!st || st.state !== 'playing' || st.round.phase !== 'live') return;
      const me = st.players.find((p) => p.id === st.you); if (!me.alive) return;
      const idx = [0, 1, 2, 3, 4, 5].find((k) => !st.me.spent.includes(k)); if (idx === undefined) return;
      const opp = st.players.filter((p) => p.alive && p.id !== st.you); if (!opp.length) return;
      await emit(s, 'game:load', { index: idx });
      await emit(s, 'game:fire', { targetId: opp[Math.floor(Math.random() * opp.length)].id });
    }));
    await sleep(15);
    over = states[0].state === 'finished';
  }
  assert(over, 'match finished');
  const f = states[0];
  assert.strictEqual(f.ranking.length, n);
  assert.strictEqual(f.players.filter((p) => p.alive).length, 1, 'exactly one survivor');
  assert.strictEqual(f.ranking[0], f.players.find((p) => p.alive).id);
  assert.strictEqual(f.players.reduce((a, p) => a + (f.maxHp - p.hp), 0), f.players.reduce((a, p) => a + p.hits, 0), 'damage equals hits');
  assert((await emit(socks[0], 'room:again')).ok); await sleep(50);
  assert.strictEqual(states[0].state, 'lobby');
  socks.forEach((s) => s.close());
  console.log(`${n}-player match ok (winner ${f.players.find((p) => p.alive).name})`);
}

server.listen(0, async () => {
  const url = `http://localhost:${server.address().port}`;
  try {
    // room rules
    const a = await connect(url), b = await connect(url);
    const c = await emit(a, 'room:create', { name: 'A' });
    assert((await emit(b, 'room:join', { name: 'B', code: 'ZZZZ' })).ok === false);
    assert((await emit(b, 'room:join', { name: 'a', code: c.code })).ok === false, 'duplicate name');
    a.close(); b.close();
    for (const n of [2, 3, 4, 8, 16]) await playMatch(url, n);
    console.log('ALL TESTS PASSED'); process.exit(0);
  } catch (e) { console.error(e); process.exit(1); }
});
