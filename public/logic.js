'use strict';

// 울트라 틱택토: 규칙과 컴퓨터만 모아 둔 파일 (그리기·입력 없음). 브라우저·서버·테스트(Node)가 같이 쓴다.
//
// - 큰 3x3 판의 칸마다 작은 3x3 판이 하나씩 있다. 작은 칸 번호는 idx = 작은판 * 9 + 칸 (둘 다 0~8, 왼쪽 위부터 가로로)
// - 작은 판에서 내가 둔 칸 번호가 상대가 다음에 둘 작은 판 번호다. 그 판이 이미 끝났으면(주인이 정해졌거나 꽉 참) 아무 열린 판에나 둘 수 있다
// - 작은 판에서 세 개를 이으면 그 판은 내 것, 꽉 찼는데 못 이으면 무승부 판(3). 큰 판에서 내 작은 판 세 개를 이으면 이긴다
// - 모든 작은 판이 끝났는데 아무도 못 이었으면 작은 판을 더 많이 가진 쪽이 이기고 같으면 무승부
// - 0 번(먼저, ❌)과 1 번(⭕). 칸의 값은 0 비었음 · 1 ❌ · 2 ⭕
const LOGIC_UTTT = (() => {
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

function rng(seed) {                                     // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newGame() {
  return { cells: new Array(81).fill(0), small: new Array(9).fill(0), turn: 0, next: -1, winner: -1, reason: '', plies: 0, last: -1 };
}
const clone = (st) => ({ ...st, cells: st.cells.slice(), small: st.small.slice() });

function lineOwner(get) {                                // 세 개를 이은 쪽 (1·2), 없으면 0
  for (const [a, b, c] of LINES) { const v = get(a); if (v === 1 || v === 2) if (v === get(b) && v === get(c)) return v; }
  return 0;
}
function smallStatus(st, b) {
  const o = lineOwner((i) => st.cells[b * 9 + i]);
  if (o) return o;
  for (let i = 0; i < 9; i++) if (!st.cells[b * 9 + i]) return 0;
  return 3;
}
const allowedBoard = (st, b) => st.small[b] === 0 && (st.next < 0 || st.next === b);

function legalMoves(st) {
  const out = [];
  if (st.winner >= 0) return out;
  for (let b = 0; b < 9; b++) {
    if (!allowedBoard(st, b)) continue;
    for (let i = 0; i < 9; i++) if (!st.cells[b * 9 + i]) out.push(b * 9 + i);
  }
  return out;
}
const isLegal = (st, idx) => Number.isInteger(idx) && idx >= 0 && idx < 81 && st.winner < 0 && !st.cells[idx] && allowedBoard(st, (idx / 9) | 0);

// 수를 두고 되돌릴 정보를 돌려준다 (탐색용). 합법인지는 부른 쪽이 안다
function apply(st, idx) {
  const b = (idx / 9) | 0, c = idx % 9;
  const undo = { idx, small: st.small[b], next: st.next, turn: st.turn, winner: st.winner, reason: st.reason, plies: st.plies, last: st.last };
  st.cells[idx] = st.turn + 1;
  st.small[b] = smallStatus(st, b);
  st.plies++; st.last = idx;
  const o = lineOwner((i) => st.small[i]);
  if (o) { st.winner = o - 1; st.reason = 'line'; }
  else if (st.small.every((v) => v !== 0)) {
    const x = st.small.filter((v) => v === 1).length, y = st.small.filter((v) => v === 2).length;
    st.winner = x > y ? 0 : y > x ? 1 : 2; st.reason = 'count';
  }
  st.next = st.small[c] === 0 ? c : -1;
  st.turn = 1 - st.turn;
  return undo;
}
function undoMove(st, u) {
  const b = (u.idx / 9) | 0;
  st.cells[u.idx] = 0; st.small[b] = u.small; st.next = u.next; st.turn = u.turn; st.winner = u.winner; st.reason = u.reason; st.plies = u.plies; st.last = u.last;
}

// 사람·서버가 두는 수: 합법이 아니면 null
function move(st, idx) {
  if (!isLegal(st, idx)) return null;
  const b = (idx / 9) | 0, who = st.turn;
  apply(st, idx);
  return { idx, who, board: b, smallStatus: st.small[b] };
}

// ---------- 컴퓨터 ----------
// 평가: me 쪽에서 본 점수 (클수록 좋다)
function evaluate(st, me) {
  if (st.winner >= 0) return st.winner === 2 ? 0 : st.winner === me ? 100000 - st.plies : -100000 + st.plies;
  const mine = me + 1, theirs = 2 - me;
  let sc = 0;
  for (let b = 0; b < 9; b++) {
    const s = st.small[b];
    if (s === mine) sc += 100 + (b === 4 ? 30 : b % 2 === 0 ? 10 : 0);
    else if (s === theirs) sc -= 100 + (b === 4 ? 30 : b % 2 === 0 ? 10 : 0);
    else if (s === 0) {
      const base = b * 9;
      for (const [x, y, z] of LINES) {
        let m = 0, t = 0;
        for (const i of [x, y, z]) { const v = st.cells[base + i]; if (v === mine) m++; else if (v === theirs) t++; }
        if (m && !t) sc += m === 2 ? 6 : 1;
        else if (t && !m) sc -= t === 2 ? 6 : 1;
      }
      if (st.cells[base + 4] === mine) sc += 3; else if (st.cells[base + 4] === theirs) sc -= 3;
    }
  }
  for (const [x, y, z] of LINES) {                        // 큰 판 줄: 내 판이 줄에 몇 개
    let m = 0, t = 0, d = 0;
    for (const i of [x, y, z]) { const v = st.small[i]; if (v === mine) m++; else if (v === theirs) t++; else if (v === 3) d++; }
    if (!t && !d) sc += m === 2 ? 60 : m === 1 ? 12 : 0;
    if (!m && !d) sc -= t === 2 ? 60 : t === 1 ? 12 : 0;
  }
  // 상대가 아무 판에나 둘 수 있게 만들면 조금 불리, 내가 자유로우면 조금 유리
  if (st.next < 0) sc += (st.turn === me ? 6 : -6);
  return sc;
}

function ordered(st) {
  const ms = legalMoves(st);
  const me = st.turn + 1;
  const keyed = ms.map((m) => {
    let k = 0;
    const b = (m / 9) | 0, c = m % 9;
    st.cells[m] = me;
    if (smallStatus(st, b) === me) k += 50;                // 작은 판을 따는 수 먼저
    st.cells[m] = 0;
    if (st.small[c] !== 0) k -= 8;                         // 상대에게 자유를 주는 수는 뒤로
    if (c === 4) k += 3; else if (c % 2 === 0) k += 1;
    return [m, k];
  });
  keyed.sort((a, b) => b[1] - a[1]);
  return keyed.map((e) => e[0]);
}

function search(st, depth, alpha, beta, me, ctx) {
  if (st.winner >= 0 || depth === 0) return evaluate(st, me);
  if (ctx.deadline && (++ctx.nodes & 255) === 0 && Date.now() > ctx.deadline) { ctx.timeout = true; return 0; }
  const maximizing = st.turn === me;
  let best = maximizing ? -Infinity : Infinity;
  for (const m of ordered(st)) {
    const u = apply(st, m);
    const v = search(st, depth - 1, alpha, beta, me, ctx);
    undoMove(st, u);
    if (ctx.timeout) return 0;
    if (maximizing) { if (v > best) best = v; if (v > alpha) alpha = v; } else { if (v < best) best = v; if (v < beta) beta = v; }
    if (alpha >= beta) break;
  }
  return best;
}

// level 'easy': 35% 는 아무 수나, 나머지는 2수 앞 / 'hard': 시간(기본 350ms) 안에서 깊이를 늘려 가며 (최대 8수) 본다
// opts.depth 를 주면 시간 대신 그 깊이로 고정한다 (시험용)
function aiPick(st, level, rand = Math.random, opts = {}) {
  const ms = legalMoves(st);
  if (!ms.length) return -1;
  if (ms.length === 1) return ms[0];
  if (level === 'easy' && rand() < 0.35) return ms[Math.floor(rand() * ms.length)];
  const me = st.turn;
  const work = clone(st);
  const maxDepth = opts.depth || (level === 'hard' ? 8 : 2);
  const ms2 = ordered(work);
  let best = ms2[0];
  const budget = opts.depth ? 0 : level === 'hard' ? (opts.ms || 350) : 0;
  const startAt = Date.now();
  for (let d = 1; d <= maxDepth; d++) {
    const ctx = { deadline: budget ? startAt + budget : 0, nodes: 0, timeout: false };
    let bm = -1, bv = -Infinity, alpha = -Infinity;
    for (const m of ms2) {
      const u = apply(work, m);
      const v = search(work, d - 1, alpha, Infinity, me, ctx) + rand() * 0.01;
      undoMove(work, u);
      if (ctx.timeout) break;
      if (v > bv) { bv = v; bm = m; }
      if (v > alpha) alpha = v;
    }
    if (ctx.timeout || bm < 0) break;
    best = bm;
    ms2.splice(ms2.indexOf(bm), 1); ms2.unshift(bm);        // 다음 깊이에서는 지금까지 최선을 먼저
    if (bv > 90000) break;                                   // 이기는 길을 찾았다
    if (budget && Date.now() - startAt > budget * 0.6) break;
  }
  return best;
}

return { LINES, rng, newGame, clone, legalMoves, isLegal, move, apply, undoMove, smallStatus, evaluate, aiPick, allowedBoard };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_UTTT;
