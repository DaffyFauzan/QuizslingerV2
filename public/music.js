/* In-game music player. Reads music/playlist.json (your own tracks) and plays them per screen.
   Browsers block audio until the first tap/click, so playback starts on the first interaction. */
(function (g) {
  'use strict';
  const KEY = 'mdVol', a = new Audio();
  let cfg = null, started = false, muted = false, want = 'menu', cur = null, list = [], idx = 0, fails = 0;
  let vol = parseFloat(localStorage.getItem(KEY)); if (!(vol >= 0 && vol <= 1)) vol = 0.4;
  a.preload = 'auto';
  const level = () => (muted ? 0 : vol);
  const shuffle = (x) => x.map((v) => [Math.random(), v]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  function fade(to, ms, done) {
    const from = a.volume, t0 = performance.now();
    (function step() { const p = Math.min(1, (performance.now() - t0) / ms); a.volume = from + (to - from) * p; p < 1 ? requestAnimationFrame(step) : done && done(); })();
  }
  function play(i) {
    if (!list.length) return;
    idx = (i + list.length) % list.length; a.src = list[idx]; a.volume = 0;
    a.play().then(() => fade(level(), 600)).catch(() => {});
  }
  function pick(scene) {
    want = scene;
    if (!started || !cfg) return;
    const t = cfg[scene] || cfg.default || [], key = t.join('|');
    if (key === cur) return; // same playlist as the previous screen: keep playing
    cur = key; fails = 0;
    const go = () => { list = cfg.shuffle ? shuffle(t) : t.slice(); list.length ? play(0) : a.pause(); };
    a.paused || !a.src ? go() : fade(0, 400, go);
  }
  a.addEventListener('ended', () => { fails = 0; play(idx + 1); });
  a.addEventListener('error', () => { if (++fails < list.length) play(idx + 1); });
  const vEl = () => document.getElementById('vol');
  const start = () => { if (started) return; started = true; ['pointerdown', 'keydown', 'touchstart'].forEach((e) => removeEventListener(e, start)); pick(want); };
  ['pointerdown', 'keydown', 'touchstart'].forEach((e) => addEventListener(e, start));
  fetch('music/playlist.json', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
    cfg = j;
    const any = ['default', 'menu', 'lobby', 'duel', 'results'].some((k) => Array.isArray(j[k]) && j[k].length);
    const v = vEl(); if (v) { v.hidden = !any; v.value = vol; v.oninput = () => { vol = +v.value; localStorage.setItem(KEY, vol); if (!a.paused) a.volume = level(); }; }
    pick(want);
  }).catch(() => {});
  document.addEventListener('visibilitychange', () => { document.hidden ? a.pause() : started && list.length && !muted && a.play().catch(() => {}); });
  g.MDMusic = { scene: pick, mute(m) { muted = !!m; a.volume = level(); } };
})(window);
