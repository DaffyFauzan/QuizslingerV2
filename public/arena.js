/* 3D duel arena. Needs THREE (r128). Aim with mouse position / touch-drag; tap an outlaw to snap to them. */
(function (g) {
'use strict';
const T = g.THREE, D = 14, MAXYAW = 1.25, COLORS = [0xb3261e, 0x2c6e9b, 0x5b8a4a, 0x8a5aa8];
const mat = (c) => new T.MeshLambertMaterial({ color: c });
const box = (w, h, d, c, x, y, z) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); return m; };
const cyl = (rt, rb, h, c, x, y, z, seg = 14) => { const m = new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg), mat(c)); m.position.set(x, y, z); return m; };

function makeLabel() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const tex = new T.CanvasTexture(c);
  const s = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, fog: false }));
  s.scale.set(3.4, 1.28, 1); s.position.y = 3.1; s.renderOrder = 5; s.userData = { c, tex, key: '' };
  return s;
}
function paint(s, name, hp, max, alive) {
  const k = name + hp + alive; if (s.userData.key === k) return; s.userData.key = k;
  const x = s.userData.c.getContext('2d');
  x.clearRect(0, 0, 256, 96); x.fillStyle = 'rgba(20,12,8,.82)'; x.fillRect(8, 8, 240, 80);
  x.strokeStyle = '#c9953c'; x.lineWidth = 4; x.strokeRect(8, 8, 240, 80);
  x.textAlign = 'center'; x.fillStyle = '#efe6d2'; x.font = 'bold 30px sans-serif'; x.fillText(name, 128, 42);
  x.fillStyle = alive ? '#ff8c7e' : '#8a7a66'; x.font = '26px sans-serif';
  x.fillText(alive ? '♥'.repeat(Math.max(0, hp)) + '♡'.repeat(Math.max(0, max - hp)) : 'OUT', 128, 76);
  s.userData.tex.needsUpdate = true;
}
function cowboy(color) {
  const root = new T.Group(), body = new T.Group(); root.add(body);
  body.add(box(.6, 1, .35, 0x3a2a1c, 0, .5, 0), box(.8, .9, .4, color, 0, 1.45, 0),
    box(.18, .18, .7, color, .5, 1.5, .35), box(.12, .2, .3, 0x222222, .5, 1.5, .75),
    cyl(.5, .5, .05, 0x2b1b12, 0, 2.38, 0, 18), cyl(.25, .3, .28, 0x2b1b12, 0, 2.52, 0, 18));
  const head = new T.Mesh(new T.SphereGeometry(.25, 12, 10), mat(0xe0b48a)); head.position.y = 2.15; body.add(head);
  const gun = new T.Object3D(); gun.position.set(.5, 1.5, .95); body.add(gun);
  return { root, body, gun };
}

class Arena {
  constructor(el) {
    this.el = el; this.figs = new Map(); this.fx = []; this.key = ''; this.you = null;
    this.yaw = 0; this.tyaw = 0; this.pitch = 0; this.tpitch = 0; this.aimed = null; this.onAim = null;
    this.recoil = 0; this.shake = 0; this.last = 0;
    const r = this.renderer = new T.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(g.devicePixelRatio || 1, 2)); el.appendChild(r.domElement);
    r.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
    const sc = this.scene = new T.Scene(); sc.fog = new T.Fog(0xc98a4a, 25, 110);
    const cam = this.camera = new T.PerspectiveCamera(62, 1, .1, 300); cam.position.set(0, 1.6, 0); cam.rotation.order = 'YXZ'; sc.add(cam);
    sc.add(new T.HemisphereLight(0xffd9a0, 0x6b4a2a, .9));
    const sun = new T.DirectionalLight(0xffc680, .8); sun.position.set(20, 30, -30); sc.add(sun);
    this.flashLight = new T.PointLight(0xffc060, 0, 14); sc.add(this.flashLight);
    this.buildWorld(); this.buildGun(); this.buildHud(); this.bind();
    new ResizeObserver(() => this.resize()).observe(el); this.resize();
    requestAnimationFrame((t) => this.loop(t));
  }
  buildWorld() {
    const sc = this.scene, sg = new T.SphereGeometry(150, 16, 12), cols = [], p = sg.attributes.position;
    const top = new T.Color(0x14232b), mid = new T.Color(0xe08a45);
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 150; const c = mid.clone(); if (y > 0) c.lerp(top, Math.min(1, y * 1.7)); cols.push(c.r, c.g, c.b); }
    sg.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    sc.add(new T.Mesh(sg, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false })));
    const sunM = new T.Mesh(new T.SphereGeometry(9, 20, 14), new T.MeshBasicMaterial({ color: 0xf6d58a, fog: false })); sunM.position.set(10, 12, -120); sc.add(sunM);
    const ground = new T.Mesh(new T.PlaneGeometry(400, 400), mat(0xc9a468)); ground.rotation.x = -Math.PI / 2; sc.add(ground);
    [[-70, 14, -85], [-35, 9, -100], [40, 18, -95], [78, 11, -75], [-95, 10, -30], [100, 13, -20]].forEach(([x, h, z]) => sc.add(box(26, h, 16, 0x8a4b2d, x, h / 2, z)));
    [[-9, -8], [10, -7], [-16, -18], [18, -16], [-6, -26], [7, -30], [-22, 2], [22, 4]].forEach(([x, z]) => {
      const c = new T.Group(); c.add(cyl(.3, .35, 3, 0x4d7a3a, 0, 1.5, 0), cyl(.2, .2, 1, 0x4d7a3a, .6, 1.8, 0), cyl(.2, .2, 1, 0x4d7a3a, -.6, 1.5, 0));
      c.position.set(x, 0, z); sc.add(c);
    });
  }
  buildGun() {
    const gun = this.gun = new T.Group();
    gun.add(box(.07, .07, .5, 0x555a60, 0, 0, -.2), cyl(.09, .09, .16, 0x777c82, 0, -.02, .05, 6), box(.07, .22, .09, 0x4a2f1d, 0, -.14, .17));
    gun.children[1].rotation.x = Math.PI / 2; gun.position.set(.26, -.25, -.55); this.camera.add(gun);
    this.muzzle = new T.Object3D(); this.muzzle.position.set(0, 0, -.5); gun.add(this.muzzle);
  }
  buildHud() {
    const x = this.cross = document.createElement('div');
    x.style.cssText = 'position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border:3px solid #efe6d2;border-radius:50%;pointer-events:none;box-shadow:0 0 4px #000;transition:.12s';
    x.innerHTML = '<i style="position:absolute;left:50%;top:50%;width:5px;height:5px;margin:-2.5px;background:currentColor;border-radius:50%"></i>';
    this.el.style.position = 'relative'; this.el.appendChild(x);
  }
  bind() {
    const c = this.renderer.domElement; let d = null;
    c.addEventListener('pointermove', (e) => {
      const w = c.clientWidth, h = c.clientHeight;
      if (e.pointerType === 'mouse') { this.tyaw = ((e.offsetX / w) - .5) * 2 * MAXYAW; this.tpitch = -((e.offsetY / h) - .5) * .7; }
      else if (d) { const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy);
        this.tyaw = Math.max(-MAXYAW, Math.min(MAXYAW, this.tyaw + dx * .005)); this.tpitch = Math.max(-.35, Math.min(.35, this.tpitch - dy * .004)); this.yaw = this.tyaw; this.pitch = this.tpitch; }
    });
    c.addEventListener('pointerdown', (e) => { d = { x: e.clientX, y: e.clientY, moved: 0, t: Date.now() }; if (e.pointerType !== 'mouse') c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointerup', (e) => { if (d && d.moved < 8 && Date.now() - d.t < 350) this.snapAt(e.offsetX, c.clientWidth); d = null; });
  }
  snapAt(x, w) {
    let best = null, bd = w * .2;
    for (const f of this.figs.values()) {
      if (!f.alive) continue;
      const v = new T.Vector3(Math.sin(f.ang) * D, 1.5, -Math.cos(f.ang) * D).project(this.camera), sx = (v.x + 1) / 2 * w;
      if (Math.abs(sx - x) < bd) { bd = Math.abs(sx - x); best = f; }
    }
    if (best) this.lookAt(best.id);
  }
  lookAt(id) { const f = this.figs.get(id); if (f && f.alive) { this.tyaw = f.ang; this.tpitch = 0; } }
  resize() {
    const w = this.el.clientWidth || 300, h = this.el.clientHeight || 200;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  update(players, you, maxHp) {
    this.you = you;
    const opps = players.filter((p) => p.id !== you), key = opps.map((p) => p.id).join();
    if (key !== this.key) {
      this.key = key; this.figs.forEach((f) => this.scene.remove(f.root)); this.figs.clear(); this.tyaw = this.yaw = 0; this.aimed = null;
      const angs = { 1: [0], 2: [-.55, .55], 3: [-.85, 0, .85] }[opps.length] || [];
      opps.forEach((p, i) => {
        const c = cowboy(COLORS[players.indexOf(p) % 4]), ang = angs[i], label = makeLabel();
        c.root.position.set(Math.sin(ang) * D, 0, -Math.cos(ang) * D); c.root.lookAt(0, 0, 0); c.root.add(label);
        this.scene.add(c.root); this.figs.set(p.id, { id: p.id, ang, label, flinch: 0, alive: true, fall: 0, ...c });
      });
    }
    opps.forEach((p) => { const f = this.figs.get(p.id); f.alive = p.alive; paint(f.label, p.name, p.hp, maxHp, p.alive); });
  }
  worldOf(id) {
    if (id === this.you) return this.camera.localToWorld(new T.Vector3(0, -.2, -.3));
    const f = this.figs.get(id); return f ? f.root.localToWorld(new T.Vector3(0, 1.5, 0)) : null;
  }
  shoot(from, to, hit) {
    const mine = from === this.you, f = this.figs.get(from);
    const a = mine ? this.muzzle.getWorldPosition(new T.Vector3()) : f ? f.gun.getWorldPosition(new T.Vector3()) : null, b = this.worldOf(to);
    if (!a || !b) return;
    this.flashLight.position.copy(a); this.flashLight.intensity = 4; this.flashT = .08;
    if (mine) this.recoil = 1;
    const puff = new T.Mesh(new T.SphereGeometry(.12, 8, 6), new T.MeshBasicMaterial({ color: hit ? 0xffd27a : 0x999999, transparent: true, opacity: .8 }));
    puff.position.copy(a); this.scene.add(puff); this.fx.push({ m: puff, t: 0, dur: .45, grow: hit ? 4 : 7 });
    if (hit) {
      const bl = new T.Mesh(new T.SphereGeometry(.09, 8, 6), new T.MeshBasicMaterial({ color: 0xfff1a8 })); bl.position.copy(a); this.scene.add(bl);
      this.fx.push({ m: bl, t: 0, dur: .22, from: a, to: b, onEnd: () => {
        const tf = this.figs.get(to); if (tf) tf.flinch = 1; else this.shake = .6;
        const s = new T.Mesh(new T.SphereGeometry(.3, 8, 6), new T.MeshBasicMaterial({ color: 0xb3261e, transparent: true, opacity: .9 }));
        s.position.copy(b); this.scene.add(s); this.fx.push({ m: s, t: 0, dur: .4, grow: 3 });
      } });
    }
  }
  loop(t) {
    requestAnimationFrame((n) => this.loop(n));
    const dt = Math.min(.05, (t - this.last) / 1000 || .016); this.last = t;
    const k = 1 - Math.pow(.0005, dt);
    this.yaw += (this.tyaw - this.yaw) * k; this.pitch += (this.tpitch - this.pitch) * k;
    this.recoil = Math.max(0, this.recoil - dt * 5); this.shake = Math.max(0, this.shake - dt * 2);
    const sh = this.shake * (Math.random() - .5) * .05;
    this.camera.rotation.set(this.pitch + sh + this.recoil * .02, -this.yaw + sh, 0);
    this.gun.rotation.x = this.recoil * .5; this.gun.position.z = -.55 + this.recoil * .1;
    if (this.flashT > 0 && (this.flashT -= dt) <= 0) this.flashLight.intensity = 0;
    let best = null, bd = 1;
    for (const f of this.figs.values()) {
      const tgt = f.alive ? 0 : -Math.PI / 2; f.fall += (tgt - f.fall) * (1 - Math.pow(.001, dt));
      f.flinch = Math.max(0, f.flinch - dt * 3); f.body.rotation.x = f.fall - f.flinch * .35;
      if (f.alive) { f.body.rotation.z = Math.sin(t / 700 + f.ang * 5) * .02; const d = Math.abs(f.ang - this.yaw); if (d < .075 && d < bd) { best = f.id; bd = d; } }
    }
    if (Math.abs(this.pitch) > .3) best = null;
    if (best !== this.aimed) { this.aimed = best; this.cross.style.borderColor = best ? '#ff4b3a' : '#efe6d2'; this.cross.style.color = best ? '#ff4b3a' : '#efe6d2'; this.onAim && this.onAim(best); }
    this.fx = this.fx.filter((e) => {
      e.t += dt; const p = Math.min(1, e.t / e.dur);
      if (e.from) e.m.position.lerpVectors(e.from, e.to, p);
      if (e.grow) { e.m.scale.setScalar(1 + p * e.grow); e.m.material.opacity = .85 * (1 - p); }
      if (p >= 1) { this.scene.remove(e.m); e.onEnd && e.onEnd(); return false; }
      return true;
    });
    this.renderer.render(this.scene, this.camera);
  }
}
g.Arena = Arena;
})(window);
