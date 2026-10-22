'use strict';
const $ = (id) => document.getElementById(id);
const socket = io({ reconnection: true });
let arena = null, S = null, offset = 0, target = null, lastShot = null, prevState = null, prevPhase = null, prevRound = 0;
let sess = JSON.parse(localStorage.getItem('mdSession') || 'null');
const log = [];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n < 0 ? '−' + Math.abs(n) : String(n));
const SCREENS = ['menu', 'lobby', 'duel', 'results'];
const show = (n) => SCREENS.forEach((s) => ($(s).hidden = s !== n));

/* ---------- sound (synthesised, no assets) ---------- */
let ac, muted = localStorage.getItem('mdMute') === '1';
const ctx = () => (ac ||= new (window.AudioContext || window.webkitAudioContext)());
function tone(f, d = 0.12, type = 'square', v = 0.12, slide = 0, at = 0) {
  if (muted) return;
  try {
    const c = ctx(), o = c.createOscillator(), g = c.createGain(), t = c.currentTime + at;
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + d);
  } catch (e) { /* audio is optional */ }
}
function noise(d = 0.25, v = 0.25) {
  if (muted) return;
  try {
    const c = ctx(), n = c.sampleRate * d, b = c.createBuffer(1, n, c.sampleRate), a = b.getChannelData(0);
    for (let i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(), g = c.createGain(); g.gain.value = v; s.buffer = b; s.connect(g).connect(c.destination); s.start();
  } catch (e) { /* audio is optional */ }
}
const SND = {
  load: () => { tone(520, 0.06, 'square', 0.1); tone(780, 0.05, 'square', 0.08, 0, 0.06); },
  bang: () => { noise(0.3, 0.3); tone(140, 0.2, 'sawtooth', 0.15, -90); },
  blank: () => { tone(220, 0.08, 'square', 0.1, -120); },
  hit: () => { tone(300, 0.25, 'sawtooth', 0.15, -200); },
  out: () => { [330, 262, 196, 131].forEach((f, i) => tone(f, 0.25, 'triangle', 0.15, 0, i * 0.2)); },
  win: () => { [392, 392, 523, 659, 784].forEach((f, i) => tone(f, 0.22, 'triangle', 0.14, 0, i * 0.16)); },
};
$('mute').textContent = muted ? '🔇' : '🔊';
$('mute').onclick = () => { muted = !muted; localStorage.setItem('mdMute', muted ? '1' : '0'); $('mute').textContent = muted ? '🔇' : '🔊'; };

/* ---------- helpers ---------- */
let toastT;
function toast(msg, kind = '') {
  const t = $('toast'); t.textContent = msg; t.className = `toast show ${kind}`;
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = 'toast'), 2200);
}
function flash(c) { const f = $('flash'); f.className = 'flash'; void f.offsetWidth; f.className = `flash ${c}`; }
function addLog(s) { log.unshift(s); log.length = Math.min(log.length, 4); }
const serverNow = () => Date.now() + offset;
const me = () => S.players.find((p) => p.id === S.you);
const byId = (id) => S.players.find((p) => p.id === id);
const hearts = (p) => '❤️'.repeat(Math.max(0, p.hp)) + '🖤'.repeat(Math.max(0, S.maxHp - p.hp));

function saveSession(code, token) { sess = { code, token }; localStorage.setItem('mdSession', JSON.stringify(sess)); }
function clearSession() { sess = null; localStorage.removeItem('mdSession'); S = null; target = null; log.length = 0; show('menu'); }

/* ---------- menu ---------- */
$('name').value = localStorage.getItem('mdName') || '';
const qRoom = new URLSearchParams(location.search).get('room');
if (qRoom) $('code').value = qRoom.toUpperCase().slice(0, 4);
const nm = () => { const n = $('name').value.trim(); localStorage.setItem('mdName', n); return n; };
function enter(res, err) {
  if (!res.ok) { err.textContent = res.error; return; }
  err.textContent = ''; saveSession(res.code, res.token || (sess && sess.token));
  history.replaceState(null, '', location.pathname);
}
$('create').onclick = () => { ctx(); socket.emit('room:create', { name: nm(), difficulty: $('difficulty').value }, (r) => enter(r, $('menuErr'))); };
$('join').onclick = () => { ctx(); socket.emit('room:join', { name: nm(), code: $('code').value }, (r) => enter(r, $('menuErr'))); };
$('how').onclick = () => $('help').showModal();
$('helpClose').onclick = () => $('help').close();
const leave = () => socket.emit('room:leave', {}, clearSession);
$('leave1').onclick = leave; $('leave2').onclick = leave;

/* ---------- lobby ---------- */
$('share').onclick = async () => {
  const url = `${location.origin}/?room=${S.code}`;
  try { if (navigator.share) await navigator.share({ title: 'Math Duel', text: `Join my duel! Room ${S.code}`, url }); else { await navigator.clipboard.writeText(url); toast('Invite link copied'); } }
  catch (e) { /* share cancelled */ }
};
$('lobbyDiff').onchange = (e) => socket.emit('room:difficulty', { difficulty: e.target.value });
$('start').onclick = () => socket.emit('room:start', {}, (r) => { if (!r.ok) $('lobbyErr').textContent = r.error; });
function renderLobby() {
  const host = S.hostId === S.you;
  $('lobbyCode').textContent = S.code;
  $('lobbyPlayers').innerHTML = S.players.map((p) =>
    `<li><span class="dot ${p.connected ? '' : 'off'}"></span><span>${esc(p.name)}${p.id === S.you ? ' (you)' : ''}</span>${p.id === S.hostId ? '<span style="margin-left:auto">👑 Host</span>' : ''}</li>`).join('');
  $('lobbyCount').textContent = `${S.players.length} of 4 gunslingers`;
  $('hostCtl').hidden = !host; $('lobbyDiff').value = S.difficulty;
  $('start').disabled = S.players.filter((p) => p.connected).length < 2;
  $('guestNote').textContent = host ? '' : `Waiting for the host to start (${S.difficulty}).`;
  $('lobbyErr').textContent = '';
}

/* ---------- duel ---------- */
function liveRound() { return S.round && S.round.phase === 'live' && me().alive; }
function renderDuel() {
  const r = S.round, p = me(), live = liveRound(), now = serverNow();
  $('dRoom').textContent = `Room ${S.code}`; $('dRound').textContent = `Round ${r.no}`;
  const opps = S.players.filter((q) => q.id !== S.you);
  if (!arena && window.THREE) { arena = new Arena($('arena')); arena.onAim = (id) => { if (id !== target) { target = id; if (S && S.state === 'playing') renderDuel(); } }; }
  if (arena) arena.update(S.players, S.you, S.maxHp);
  if (target && (!byId(target) || !byId(target).alive)) target = null;
  $('eqText').textContent = r.text;
  $('eqNote').textContent = !p.alive ? 'You are out. Watch the rest of the duel.'
    : r.phase === 'between' ? (r.winnerId ? `${r.winnerId === S.you ? 'You' : byId(r.winnerId).name} fired the right answer.` : 'Time ran out. Nobody hit.')
    : 'Load the right bullet, aim at an outlaw, fire.';
  $('opps').innerHTML = opps.map((q) =>
    `<button class="opp ${q.id === target ? 'sel' : ''} ${q.alive ? '' : 'dead'} ${q.connected ? '' : 'off'}" data-id="${q.id}" ${q.alive ? '' : 'disabled'} aria-pressed="${q.id === target}">
      <span class="nm">${esc(q.name)}</span><span class="hearts">${q.alive ? hearts(q) : '💀 Out'}</span>${q.ready && q.alive && live ? '<span class="rdy"> loaded</span>' : ''}</button>`).join('');
  $('opps').querySelectorAll('.opp').forEach((b) => (b.onclick = () => { if (arena) arena.lookAt(b.dataset.id); else { target = b.dataset.id; renderDuel(); } }));
  const spent = new Set(S.me.spent), left = S.bullets - spent.size;
  $('chambers').innerHTML = r.choices.map((c, i) => {
    const cls = ['ch', S.me.loaded === i ? 'on' : '', spent.has(i) ? 'spent' : '', r.phase === 'between' && r.correct === i ? 'right' : ''].join(' ');
    return `<button class="${cls}" data-i="${i}" ${live && !spent.has(i) ? '' : 'disabled'} aria-label="Load answer ${fmt(c)}">${fmt(c)}</button>`;
  }).join('');
  $('chambers').querySelectorAll('.ch').forEach((b) => (b.onclick = () => socket.emit('game:load', { index: +b.dataset.i }, (res) => { if (res.ok) { SND.load(); const c = $('cylinder'); c.classList.remove('spin'); void c.offsetWidth; c.classList.add('spin'); } else toast(res.error, 'bad'); })));
  $('loadedNum').textContent = S.me.loaded === null ? '–' : fmt(r.choices[S.me.loaded]);
  $('ammo').textContent = `Bullets left: ${left} of ${S.bullets}`;
  $('loadedNote').textContent = S.me.loaded === null ? 'Chamber empty. Tap a bullet.' : 'Loaded. Pick a target and fire.';
  const reloading = S.me.cd > now, f = $('fire');
  f.disabled = !(live && S.me.loaded !== null && target && !reloading);
  const tn = target && byId(target) ? byId(target).name : '';
  f.textContent = reloading ? 'Reloading…' : S.me.loaded === null ? 'Load a bullet' : !target ? 'Aim at an outlaw' : `FIRE at ${tn}`;
  if (reloading) setTimeout(() => S && S.state === 'playing' && renderDuel(), S.me.cd - now + 30);
  $('meCard').innerHTML = `<div class="mecard" id="mc"><b>${esc(p.name)}</b><span>${p.alive ? hearts(p) : '💀 Out'}</span><span class="muted">Hits ${p.hits} · Blanks ${p.blanks}</span></div>`;
  $('log').innerHTML = log.map((l) => `<li>${esc(l)}</li>`).join('');
  if (lastShot) { applyShotFx(lastShot); lastShot = null; }
}
$('fire').onclick = () => {
  if (!target) return;
  $('fire').disabled = true;
  socket.emit('game:fire', { targetId: target }, (res) => { if (!res.ok) { toast(res.error, 'bad'); renderDuel(); } });
};
function applyShotFx(e) {
  const mine = e.from === S.you, tgtMine = e.to === S.you;
  const el = (id) => (id === S.you ? $('mc') : document.querySelector(`.opp[data-id="${id}"]`));
  el(e.from) && el(e.from).classList.add('shoot');
  if (e.hit && el(e.to)) el(e.to).classList.add('hit');
}
function timerTick() {
  if (!S || S.state !== 'playing' || !S.round) return;
  const r = S.round, rem = Math.max(0, r.endsAt - serverNow());
  const live = r.phase === 'live';
  $('timebar').style.width = (live ? (rem / r.total) * 100 : 0) + '%';
  $('timebar').classList.toggle('low', live && rem < 5000);
  $('dTime').textContent = live ? `${Math.ceil(rem / 1000)}s` : 'Next round…';
}
setInterval(timerTick, 200);

/* ---------- results ---------- */
$('again').onclick = () => socket.emit('room:again');
function renderResults() {
  const winner = byId(S.ranking[0]);
  $('winTitle').textContent = winner ? (winner.id === S.you ? 'You win!' : `${winner.name} wins!`) : 'Draw';
  const medal = ['🥇', '🥈', '🥉', '4th'];
  $('rank').innerHTML = S.ranking.map((id, i) => { const p = byId(id); return `<li><b>${medal[i] || i + 1}</b><span>${esc(p.name)}${id === S.you ? ' (you)' : ''}</span></li>`; }).join('');
  $('stats').innerHTML = '<tr><th>Player</th><th>Hits</th><th>Shots</th><th>Blanks</th><th>Accuracy</th></tr>' +
    S.ranking.map((id) => { const p = byId(id); return `<tr><td>${esc(p.name)}</td><td>${p.hits}</td><td>${p.shots}</td><td>${p.blanks}</td><td>${p.shots ? Math.round((p.hits / p.shots) * 100) : 0}%</td></tr>`; }).join('');
  const host = S.hostId === S.you;
  $('again').hidden = !host; $('againNote').textContent = host ? '' : 'Waiting for the host to play again.';
}

/* ---------- state + events ---------- */
socket.on('state', (s) => {
  const first = !S;
  S = s; offset = s.now - Date.now();
  const r = s.round;
  if (r && r.no !== prevRound) { prevRound = r.no; if (s.state === 'playing') addLog(`Round ${r.no}: ${r.text}`); }
  if (r && prevPhase === 'live' && r.phase === 'between' && !r.winnerId && s.state === 'playing') { toast('Time is up. No hits.', 'bad'); addLog('Time ran out.'); }
  prevPhase = r ? r.phase : null;
  if (s.state === 'finished' && prevState !== 'finished') { const w = s.ranking[0] === s.you; (w ? SND.win : SND.out)(); }
  prevState = s.state;
  if (s.state === 'lobby') { prevRound = 0; show('lobby'); renderLobby(); }
  else if (s.state === 'playing') { show('duel'); renderDuel(); timerTick(); }
  else { show('results'); renderResults(); }
});
socket.on('shot', (e) => {
  lastShot = e; SND.bang(); if (arena) arena.shoot(e.from, e.to, e.hit);
  const you = e.from === S?.you, tgt = e.to === S?.you;
  if (e.hit) {
    setTimeout(SND.hit, 120);
    addLog(`${e.fromName} shot ${e.toName}${e.eliminated ? ' and put them down' : ''}.`);
    if (tgt) { flash('red'); toast(e.eliminated ? 'You are out!' : 'You took a hit!', 'bad'); if (e.eliminated) setTimeout(SND.out, 300); }
    else if (you) { flash('gold'); toast(e.eliminated ? 'Target eliminated!' : 'Direct hit!', 'good'); }
    else toast(`${e.fromName} hit ${e.toName}${e.eliminated ? ' (out)' : ''}`);
  } else {
    SND.blank(); addLog(`${e.fromName} fired a blank at ${e.toName}.`);
    if (you) toast('Blank! Wrong bullet.', 'bad'); else toast(`${e.fromName} fired a blank`);
  }
  if (S && S.state === 'playing') { setTimeout(() => lastShot && S && renderDuel(), 0); }
});
socket.on('replaced', () => { toast('Opened in another tab'); clearSession(); });

function tryRejoin() {
  if (!sess) return;
  socket.emit('room:rejoin', sess, (r) => { if (!r.ok) clearSession(); });
}
socket.on('connect', () => { $('conn').hidden = true; tryRejoin(); });
socket.on('disconnect', () => { $('conn').hidden = false; });
