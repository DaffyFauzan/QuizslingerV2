'use strict';
// Math engine. Add topics/difficulties by adding generators to TOPICS.
// A generator returns { text, answer } where answer is an integer.
const ri = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = ri(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const ar = (expr, answer) => ({ text: `${expr} = ?`, answer });

const TOPICS = {
  arithmetic: {
    easy: [
      () => { const a = ri(2, 20), b = ri(2, 20); return ar(`${a} + ${b}`, a + b); },
      () => { const a = ri(10, 30), b = ri(1, a - 1); return ar(`${a} − ${b}`, a - b); },
      () => { const a = ri(2, 9), b = ri(2, 9); return ar(`${a} × ${b}`, a * b); },
    ],
    medium: [
      () => { const a = ri(6, 15), b = ri(6, 15); return ar(`${a} × ${b}`, a * b); },
      () => { const a = ri(120, 899), b = ri(100, 450); return ar(`${a} + ${b}`, a + b); },
      () => { const a = ri(3, 12), b = ri(3, 12), c = ri(2, 40); return ar(`${a} × ${b} + ${c}`, a * b + c); },
      () => { const b = ri(3, 12), q = ri(6, 25); return ar(`${q * b} ÷ ${b}`, q); },
    ],
    hard: [
      () => { const a = ri(3, 15), b = ri(3, 15), c = ri(3, 12); return ar(`(${a} + ${b}) × ${c}`, (a + b) * c); },
      () => { const a = ri(6, 15), b = ri(6, 15), c = ri(3, 12), d = ri(3, 12); return ar(`${a} × ${b} − ${c} × ${d}`, a * b - c * d); },
      () => { const a = ri(11, 25), b = ri(5, 90); return ar(`${a}² − ${b}`, a * a - b); },
      () => { const b = ri(3, 12), q = ri(6, 20), c = ri(3, 12); return ar(`(${q * b} ÷ ${b}) × ${c}`, q * c); },
    ],
  },
  algebra: {
    easy: [() => { const x = ri(2, 20), a = ri(2, 20); return { text: `x + ${a} = ${x + a}, x = ?`, answer: x }; }],
    medium: [() => { const x = ri(2, 15), a = ri(2, 9), b = ri(1, 30); return { text: `${a}x + ${b} = ${a * x + b}, x = ?`, answer: x }; }],
    hard: [() => {
      const x = ri(2, 12), c = ri(2, 6), a = c + ri(1, 6), b = ri(1, 20), d = (a - c) * x + b;
      return { text: `${a}x + ${b} = ${c}x + ${d}, x = ?`, answer: x };
    }],
  },
};

const DIFFICULTIES = {
  easy: { label: 'Easy', seconds: 20 },
  medium: { label: 'Medium', seconds: 30 },
  hard: { label: 'Hard', seconds: 45 },
};

function distractors(ans, n) {
  const set = new Set([ans]);
  const spread = Math.max(4, Math.round(Math.abs(ans) * 0.15));
  const seeds = shuffle([1, -1, 2, -2, 10, -10, spread, -spread, spread + 2, 3, -3]);
  let tries = 0, range = spread + 4;
  const push = (v) => { if (!set.has(v) && (ans < 0 || v >= 0)) set.add(v); };
  for (const s of seeds) { if (set.size >= n + 1) break; push(ans + s); }
  while (set.size < n + 1) { push(ans + ri(-range, range)); if (++tries % 50 === 0) range *= 2; }
  set.delete(ans);
  return [...set].slice(0, n);
}

function makeRound(difficulty = 'easy', topics = Object.keys(TOPICS)) {
  const d = DIFFICULTIES[difficulty] ? difficulty : 'easy';
  const pool = topics.flatMap((t) => TOPICS[t][d] || []);
  const { text, answer } = pool[ri(0, pool.length - 1)]();
  const choices = shuffle([answer, ...distractors(answer, 5)]);
  return { text, choices, correct: choices.indexOf(answer), time: DIFFICULTIES[d].seconds };
}

module.exports = { makeRound, DIFFICULTIES, TOPICS };
