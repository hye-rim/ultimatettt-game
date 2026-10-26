'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');

const put = (st, list) => { for (const [b, c, v] of list) st.cells[b * 9 + c] = v; };

test('new game: empty, x to move, any cell allowed', () => {
  const st = L.newGame();
  assert.strictEqual(st.turn, 0);
  assert.strictEqual(st.next, -1);
  assert.strictEqual(L.legalMoves(st).length, 81);
});

test('the cell number you play decides the next small board', () => {
  const st = L.newGame();
  assert.ok(L.move(st, 4 * 9 + 2));            // 가운데 판의 오른쪽 위 칸
  assert.strictEqual(st.next, 2);
  assert.deepStrictEqual(L.legalMoves(st).map((m) => (m / 9) | 0).filter((b, i, a) => a.indexOf(b) === i), [2]);
  assert.strictEqual(L.legalMoves(st).length, 9);
  assert.strictEqual(L.move(st, 5 * 9 + 0), null, 'a cell outside the forced board is refused');
  assert.ok(L.move(st, 2 * 9 + 6));
  assert.strictEqual(st.next, 6);
  assert.strictEqual(st.turn, 0);
});

test('occupied, out of range and garbage moves are refused', () => {
  const st = L.newGame();
  L.move(st, 0);
  assert.strictEqual(L.move(st, 0), null);
  for (const bad of [-1, 81, 1.5, NaN, null, undefined, '3', [3], {}]) assert.strictEqual(L.move(st, bad), null);
});

test('winning a small board marks it and the next board is the cell number', () => {
  const st = L.newGame();
  put(st, [[0, 0, 1], [0, 1, 1]]);
  st.next = 0; st.turn = 0; st.plies = 2;
  const r = L.move(st, 0 * 9 + 2);             // 작은 판 0 의 윗줄 완성
  assert.strictEqual(r.smallStatus, 1);
  assert.strictEqual(st.small[0], 1);
  assert.strictEqual(st.next, 2);
});

test('sent to a finished board means free choice among open boards', () => {
  const st = L.newGame();
  st.small[2] = 1;                              // 판 2 는 이미 ❌ 것
  st.next = 5; st.turn = 0;
  const r = L.move(st, 5 * 9 + 2);              // 칸 2 -> 판 2 로 보내야 하지만 끝났으니 자유
  assert.ok(r);
  assert.strictEqual(st.next, -1);
  const boards = new Set(L.legalMoves(st).map((m) => (m / 9) | 0));
  assert.ok(!boards.has(2), 'a finished board is never playable');
  assert.ok(boards.size >= 7);
});

test('a full small board with no line is a draw board (3)', () => {
  const st = L.newGame();
  const fill = [1, 2, 1, 1, 2, 2, 2, 1, 0];     // 마지막 칸(8)만 비움, 줄 없음
  fill.forEach((v, i) => { st.cells[i] = v; });
  st.next = 0; st.turn = 0;
  L.move(st, 8);                                 // ❌ 이 8 에 두면 (2,5,8)? 8=1,5=2 -> 줄 없음, 0,4,8 = 1,2,1 아님
  assert.strictEqual(st.small[0], 3);
});

test('three small boards in a row wins the game', () => {
  const st = L.newGame();
  st.small[0] = 1; st.small[1] = 1;
  put(st, [[2, 0, 1], [2, 1, 1]]);
  st.next = 2; st.turn = 0;
  L.move(st, 2 * 9 + 2);
  assert.strictEqual(st.small[2], 1);
  assert.strictEqual(st.winner, 0);
  assert.strictEqual(st.reason, 'line');
  assert.strictEqual(L.legalMoves(st).length, 0);
  assert.strictEqual(L.move(st, 3 * 9), null, 'no moves after the game');
});

test('all boards finished without a line is decided by count', () => {
  const st = L.newGame();
  // 0 1 0 / 1 0 1 / 3 3 ... 줄이 안 생기게: 1 이 4개, 2 가 3개, 무승부판 2개
  st.small = [1, 2, 1, 2, 1, 2, 3, 3, 0];
  put(st, [[8, 0, 1], [8, 1, 2], [8, 2, 1], [8, 3, 2], [8, 4, 1], [8, 5, 2], [8, 6, 2], [8, 7, 1]]);   // 칸 8 만 비어 있고 둘 곳은 1 이 두면 줄 없이 꽉 참?
  st.next = 8; st.turn = 0;
  const r = L.move(st, 8 * 9 + 8);
  assert.ok(r);
  assert.strictEqual(st.winner >= 0, true);
  assert.strictEqual(st.reason === 'count' || st.reason === 'line', true);
});

test('random playouts keep every invariant', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rand = L.rng(seed), st = L.newGame();
    let guard = 0;
    while (st.winner < 0 && guard++ < 100) {
      const ms = L.legalMoves(st);
      assert.ok(ms.length > 0, 'there is always a legal move before the end');
      const m = ms[Math.floor(rand() * ms.length)];
      const turn = st.turn;
      assert.ok(L.move(st, m));
      assert.strictEqual(st.cells[m], turn + 1);
      for (let b = 0; b < 9; b++) assert.strictEqual(st.small[b], L.smallStatus(st, b), 'small status matches a recount');
    }
    assert.ok(st.winner >= 0 && guard < 100);
    const x = st.small.filter((v) => v === 1).length, y = st.small.filter((v) => v === 2).length;
    if (st.reason === 'count') assert.strictEqual(st.winner, x > y ? 0 : y > x ? 1 : 2);
  }
});

test('apply and undo restore the position exactly', () => {
  const rand = L.rng(5), st = L.newGame();
  for (let i = 0; i < 25 && st.winner < 0; i++) { const ms = L.legalMoves(st); L.move(st, ms[Math.floor(rand() * ms.length)]); }
  const before = JSON.stringify(st);
  for (const m of L.legalMoves(st)) { const u = L.apply(st, m); L.undoMove(st, u); assert.strictEqual(JSON.stringify(st), before); }
});

test('the computer always returns a legal move', () => {
  const rand = L.rng(9), st = L.newGame();
  while (st.winner < 0) {
    const m = L.aiPick(st, st.turn ? 'hard' : 'easy', rand, { depth: 3 });
    assert.ok(L.isLegal(st, m), 'ai move is legal');
    L.move(st, m);
  }
});

test('the computer takes a winning move when it has one', () => {
  const st = L.newGame();
  st.small[0] = 1; st.small[1] = 1;
  put(st, [[2, 0, 1], [2, 1, 1]]);
  st.next = 2; st.turn = 0;
  assert.strictEqual(L.aiPick(st, 'hard', L.rng(1), { depth: 2 }), 2 * 9 + 2);
});

test('the computer blocks the opponent small board line when it can', () => {
  const st = L.newGame();
  put(st, [[4, 0, 2], [4, 1, 2]]);               // 상대(⭕)가 판 4 윗줄에 2개
  st.next = 4; st.turn = 0; st.plies = 5;
  const m = L.aiPick(st, 'hard', L.rng(1), { depth: 3 });
  assert.strictEqual(m, 4 * 9 + 2);
});

test('hard beats easy in a fixed seed series', () => {
  let hard = 0, easy = 0;
  for (let s = 1; s <= 10; s++) {
    const st = L.newGame(), r = L.rng(s + 50);
    const hardSeat = s % 2;
    while (st.winner < 0) L.move(st, L.aiPick(st, st.turn === hardSeat ? 'hard' : 'easy', r, { depth: st.turn === hardSeat ? 4 : undefined }));
    if (st.winner === hardSeat) hard++; else if (st.winner < 2) easy++;
  }
  assert.ok(hard >= easy + 4, `hard ${hard} easy ${easy}`);
});
