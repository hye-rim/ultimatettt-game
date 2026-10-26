'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 울트라 틱택토: 화면·입력·소리·온라인. 규칙과 컴퓨터는 logic.js (LOGIC_UTTT), 방·매칭은 server.js
(() => {
const L = LOGIC_UTTT;
const $ = (id) => document.getElementById(id);
const COLORS = ['#e8453c', '#2f7bf0'];                      // 0 ❌ (먼저) · 1 ⭕
const MARKS = ['✕', '○'];
const MARK_NAME = ['❌', '⭕'];
const T = { cpu: 700, over: 900 };                          // 시간(ms). 시험용으로 줄일 수 있다

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
let wins = Number(store.get('ultimatetttWins')) || 0;
const ONLINE_KEY = 'ultimatetttOnline', SESSION_KEY = 'ultimatetttSession';
const loadJson = (k) => { try { return JSON.parse(store.get(k)) || {}; } catch (_) { return {}; } };
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) { return null; } }
function saveSession(s) { try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch (_) {} }
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const myName = () => store.get('ultimatetttName') || '';

// ---------- 소리 ----------
let audio = null;
let muted = store.get('ultimatetttMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.09, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
const sfx = {
  mine: () => tone(520, 0.07, 'triangle', 0.09),
  theirs: () => tone(400, 0.07, 'triangle', 0.08),
  claim: () => seq([523, 659, 784], 80, 'triangle', 0.1),
  lost: () => seq([392, 311], 100, 'triangle', 0.07),
  bad: () => tone(150, 0.1, 'square', 0.05),
  found: () => seq([392, 523], 90, 'triangle', 0.08),
  win: () => seq([523, 659, 784, 1047], 110, 'triangle', 0.1),
  lose: () => seq([392, 330, 262, 196], 150, 'sawtooth', 0.06),
};
function toggleMute() { muted = !muted; store.set('ultimatetttMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 상태 ----------
let mode = 'easy';                  // 'easy' · 'hard' (컴퓨터) · 'online'
let phase = 'title';                // title · play · over
let st = null;                      // 컴퓨터 대전 판 (나는 0번 ❌, 먼저)
let lastIdx = -1;                   // 마지막에 놓인 칸 (컴퓨터 모드, 온라인은 room.lastMove)
let room = null, waitingNet = false, netDown = false, turnEnd = 0, recorded = '', seenMove = 0;
let cpuTimer = 0, overTimer = 0;
const online = () => mode === 'online';

// 화면에 그릴 모양으로
function model() {
  if (online()) {
    if (!room) return null;
    return { cells: room.cells, small: room.small, next: room.next, turn: room.turn, you: room.you, state: room.state, winner: room.winner, reason: room.reason, last: room.lastMove ? room.lastMove.idx : -1, plies: room.plies,
      names: [0, 1].map((c) => (c === room.you ? '나' : ((room.players.find((p) => p.color === c) || {}).name || '상대'))) };
  }
  if (!st) return null;
  return { cells: st.cells, small: st.small, next: st.next, turn: st.turn, you: 0, state: st.winner >= 0 ? 'over' : 'playing', winner: st.winner, reason: st.reason, last: lastIdx, plies: st.plies, names: ['나', '컴퓨터'] };
}
const viewOf = (m) => ({ cells: m.cells, small: m.small, turn: m.turn, next: m.next, winner: -1, reason: '', plies: m.plies, last: -1 });
const myTurn = (m) => !!m && m.state === 'playing' && m.turn === m.you && !netDown;
const canAct = (m) => myTurn(m) && !waitingNet;

// ---------- 그리기 ----------
const cellEls = [], subEls = [];
function buildBoard() {
  const b = $('board');
  b.innerHTML = '';
  cellEls.length = 0; subEls.length = 0;
  for (let sb = 0; sb < 9; sb++) {
    const box = document.createElement('div');
    box.className = 'sb';
    for (let c = 0; c < 9; c++) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'c';
      el.setAttribute('aria-label', `${sb + 1}번 판 ${c + 1}번 칸`);
      const idx = sb * 9 + c;
      el.onclick = () => onCell(idx);
      box.appendChild(el); cellEls.push(el);
    }
    b.appendChild(box); subEls.push(box);
  }
}

function render() {
  const m = model();
  if (!m) { renderHud(null); return; }
  const legal = new Set(canAct(m) ? L.legalMoves(viewOf(m)) : []);
  const forced = m.state === 'playing' ? m.next : -2;
  for (let sb = 0; sb < 9; sb++) {
    const s = m.small[sb];
    const open = s === 0 && m.state === 'playing' && (forced < 0 || forced === sb);
    subEls[sb].className = 'sb' + (s ? ` w${s - 1}` : '') + (open ? ' act' : '');
    for (let c = 0; c < 9; c++) {
      const idx = sb * 9 + c, v = m.cells[idx], el = cellEls[idx];
      el.className = 'c' + (v ? ` v${v - 1}` : '') + (legal.has(idx) ? ' ok' : '') + (idx === m.last ? ' last' : '');
      el.textContent = v ? MARKS[v - 1] : '';
    }
  }
  const bar = (el, side) => {
    const owned = m.small.filter((v) => v === side + 1).length;
    el.className = 'bar' + (m.state === 'playing' && m.turn === side ? ' turn' : '');
    el.innerHTML = `<span class="mk" style="--c:${COLORS[side]}">${MARKS[side]}</span><span class="nm">${esc(m.names[side])}${side === 0 ? ' (먼저)' : ''}</span><span class="ct">차지한 판 ${owned}</span>`;
  };
  bar($('barOp'), 1 - m.you); bar($('barMe'), m.you);
  renderHud(m);
}
function renderHud(m = model()) {
  $('wins').textContent = wins.toLocaleString('ko-KR');
  let text = '울트라 틱택토';
  if (m && phase === 'play' && m.state === 'playing') {
    const sec = Math.max(0, Math.ceil((turnEnd - performance.now()) / 1000));
    if (online() && netDown) text = '연결 다시 붙이는 중…';
    else if (m.turn === m.you) text = `내 차례${online() ? ` · ${sec}초` : ''}`;
    else text = online() ? `${m.names[m.turn]} 차례 · ${sec}초` : '컴퓨터 생각 중…';
  }
  $('turn').textContent = text;
  $('resignBtn').style.display = online() && room && room.state === 'playing' ? '' : 'none';
}
function say(t) { $('msg').textContent = t; }
function turnHint(m) {
  if (!myTurn(m)) return;
  say(m.next < 0 ? '아무 판에나 둘 수 있어요! (노랗게 빛나는 판)' : `${m.next + 1}번 판(노랗게 빛나는 판)에서 골라 둬요`);
}

// ---------- 창 ----------
const overlayOpen = () => !$('overlay').classList.contains('hidden');
function showOverlay(html) { $('overlay').innerHTML = html; $('overlay').classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }

// ---------- 내 수 두기 ----------
function onCell(idx) {
  const m = model();
  if (!canAct(m)) return;
  if (!L.isLegal(viewOf(m), idx)) {
    sfx.bad();
    if (m.cells[idx]) say('이미 표시가 있는 칸이에요');
    else if (m.small[(idx / 9) | 0]) say('이미 끝난 판이에요. 노랗게 빛나는 판에서 골라요');
    else say(m.next < 0 ? '아무 판에나 둘 수 있어요' : `이번엔 ${m.next + 1}번 판(노랗게 빛나는 판)에만 둘 수 있어요`);
    return;
  }
  doMove(idx);
}
function doMove(idx) {
  if (online()) { waitingNet = true; net.send('move', { idx }); render(); return; }
  const before = st.small.slice();
  const r = L.move(st, idx);
  if (!r) return;
  lastIdx = idx;
  announce(0, idx, before);
  tutorialSignal('move');
  render();
  afterMove();
}
function announce(who, idx, beforeSmall) {
  const b = (idx / 9) | 0, claimed = model().small[b] !== beforeSmall[b] && model().small[b] !== 0;
  const mine = who === (model() || { you: 0 }).you;
  if (claimed) {
    const draw = model().small[b] === 3;
    if (draw) say(`${b + 1}번 판이 비겼어요`);
    else { say(`${mine ? '내가' : '상대가'} ${b + 1}번 판을 차지했어요!`); mine ? sfx.claim() : sfx.lost(); }
    if (mine && !draw) tutorialSignal('claim');
  } else (mine ? sfx.mine : sfx.theirs)();
}

// ---------- 컴퓨터 대전 ----------
function startCpu(level) {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = level; st = L.newGame(); phase = 'play'; lastIdx = -1; turnEnd = 0;
  hideOverlay(); buildBoard(); render();
  say('내가 먼저예요 (❌). 아무 칸에나 둬요!\n내가 둔 칸 번호가 상대가 둘 판이 돼요');
}
function afterMove() {
  if (st.winner >= 0) { overTimer = setTimeout(showOver, T.over); return; }
  render();
  cpuTimer = setTimeout(cpuTurn, T.cpu);
}
function cpuTurn() {
  if (phase !== 'play' || !st || st.winner >= 0 || st.turn !== 1 || online()) return;
  const idx = L.aiPick(st, mode === 'hard' ? 'hard' : 'easy');
  if (idx < 0) return;
  const before = st.small.slice();
  L.move(st, idx);
  lastIdx = idx;
  announce(1, idx, before);
  render();
  if (st.winner >= 0) { overTimer = setTimeout(showOver, T.over); return; }
  turnHint(model());
}
const whyText = (reason, won, draw) => (reason === 'line'
  ? (won ? '큰 판에서 내 판 세 개를 이었어요!' : '상대가 큰 판에서 세 개를 이었어요')
  : reason === 'count' ? (draw ? '모든 판이 끝났고 차지한 판 수가 같아요' : won ? '모든 판이 끝났고 내가 더 많이 차지했어요' : '모든 판이 끝났고 상대가 더 많이 차지했어요') : '');
function showOver() {
  phase = 'over';
  const youWon = st.winner === 0, draw = st.winner === 2;
  if (youWon) { wins++; store.set('ultimatetttWins', String(wins)); sfx.win(); } else if (draw) sfx.found(); else sfx.lose();
  const mine = st.small.filter((v) => v === 1).length, theirs = st.small.filter((v) => v === 2).length;
  showOverlay(`
    <h2>${draw ? '무승부! 🤝' : youWon ? '이겼어요! 🎉' : '아쉬워요! 😵'}</h2>
    <p>${esc(whyText(st.reason, youWon, draw))}</p>
    <dl class="stats card2"><dt>내가 차지한 판</dt><dd>${mine}개</dd><dt>컴퓨터가 차지한 판</dt><dd>${theirs}개</dd><dt>둔 수</dt><dd>${st.plies}수</dd></dl>
    <p>컴퓨터 상대 승리 <b>${wins}</b>번</p>
    <div class="col"><button data-act="again">다시 하기</button><button class="sub" data-act="home">처음으로</button></div>`);
  render();
}
function showTitle() {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = 'easy'; phase = 'title'; st = L.newGame(); lastIdx = -1;
  buildBoard(); say(''); render();
  const on = loadJson(ONLINE_KEY);
  showOverlay(`
    <h1>울트라 틱택토</h1>
    <p>틱택토 안에 틱택토! <b>큰 판</b>에서 세 개를 이으면 이겨요</p>
    <div class="card2" style="font-size:13px">작은 판에서 <b>세 개를 이으면</b> 그 판은 내 것<br>내가 둔 <b>칸 번호</b>가 상대가 다음에 둘 <b>판 번호</b>예요!<br>(오른쪽 위 칸에 두면 상대는 오른쪽 위 판에서만)<br>그 판이 끝났다면 아무 판에나 둘 수 있어요</div>
    <div class="col"><button data-act="cpu" data-lv="easy">🤖 컴퓨터랑 · 쉬움</button><button class="sub" data-act="cpu" data-lv="hard">🤖 컴퓨터랑 · 어려움</button><button class="sub" data-act="online">🌐 온라인 대전${on.w || on.l ? ` · ${on.w || 0}승 ${on.l || 0}패` : ''}</button></div>`);
}

// ---------- 온라인: 연결 ----------
const net = {
  ws: null, pulse: null, outbox: [], retry: 0,
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}${location.pathname}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.raw('hello', { name: myName() });
      const s = loadSession();
      if (s) this.raw('resume', s);
      for (const [t, p] of this.outbox.splice(0)) this.raw(t, p);
      clearInterval(this.pulse);
      this.pulse = setInterval(() => this.raw('pulse'), 10000);
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onNet(m); };
    ws.onclose = () => {
      clearInterval(this.pulse);
      if (this.ws !== ws) return;
      this.ws = null;
      if (!online()) return;
      if (room || loadSession()) {
        netDown = true; waitingNet = false; render();
        setTimeout(() => { if (online()) this.connect(); }, Math.min(4000, 500 * 2 ** this.retry++));
      } else showOnline('서버와 연결이 끊겼어요. 다시 시도해 주세요.');
    };
  },
  send(t, p = {}) {
    if (this.ws && this.ws.readyState === 1) this.raw(t, p);
    else { this.outbox.push([t, p]); this.connect(); }
  },
  raw(t, p = {}) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t, ...p })); },
  close() {
    const ws = this.ws;
    this.ws = null; this.outbox = [];
    clearInterval(this.pulse);
    if (ws) ws.close();
  },
};

function onNet(m) {
  if (m.t === 'queued') showQueued();
  else if (m.t === 'room') applyRoom(m);
  else if (m.t === 'error') { room = null; saveSession(null); showOnline(m.msg); }
  else if (m.t === 'resumeFailed') {
    saveSession(null);
    if (room) { room = null; showOnline('대국이 끝나서 이어갈 수 없어요.'); }
    netDown = false; render();
  }
}

function leaveOnline() {
  if (!online()) return;
  net.send('leave'); net.close();
  saveSession(null);
  room = null; netDown = false; waitingNet = false; mode = 'easy'; phase = 'title';
}

// ---------- 온라인: 대국 ----------
function applyRoom(r) {
  const prev = room;
  const fresh = !room || room.code !== r.code;
  const newGame = fresh || room.games !== r.games;
  room = r;
  netDown = false; waitingNet = false;
  saveSession({ code: r.code, token: r.token });
  turnEnd = performance.now() + r.remain;
  if (newGame) { seenMove = r.lastMove ? r.lastMove.seq : 0; buildBoard(); say(''); }
  if (r.state === 'waiting') { phase = 'title'; showWaiting(); render(); return; }
  phase = r.state === 'playing' ? 'play' : 'over';
  if (newGame && r.state === 'playing') { sfx.found(); say(r.turn === r.you ? `내가 먼저예요 (${MARK_NAME[r.you]}). 아무 칸에나 둬요!` : '상대가 먼저 둬요'); }
  if (!($('overlay').dataset.screen === 'confirm') && r.state !== 'over') hideOverlay();
  const lm = r.lastMove;
  if (lm && lm.seq > seenMove && !newGame) {
    seenMove = lm.seq;
    const mine = lm.who === r.you;
    const prevSmall = prev ? prev.small : r.small;
    if (lm.smallStatus !== prevSmall[lm.board] && lm.smallStatus !== 0) {
      if (lm.smallStatus === 3) say(`${lm.board + 1}번 판이 비겼어요`);
      else { say(`${mine ? '내가' : '상대가'} ${lm.board + 1}번 판을 차지했어요!`); mine ? sfx.claim() : sfx.lost(); }
      if (mine && lm.smallStatus !== 3) tutorialSignal('claim');
    } else (mine ? sfx.mine : sfx.theirs)();
    if (mine) tutorialSignal('move');
  }
  render();
  if (r.state === 'playing' && lm && lm.who !== r.you) turnHint(model());
  if (r.state === 'over') afterOver();
}
function afterOver() {
  const r = room;
  const key = `${r.code}:${r.games}:${r.reason}:${r.winner}`;
  if (recorded !== key) {
    recorded = key;
    const rec = loadJson(ONLINE_KEY);
    if (r.winner === r.you) { rec.w = (rec.w || 0) + 1; sfx.win(); } else if (r.winner === 2) { rec.d = (rec.d || 0) + 1; sfx.found(); } else { rec.l = (rec.l || 0) + 1; sfx.lose(); }
    store.set(ONLINE_KEY, JSON.stringify(rec));
    setTimeout(() => { if (room && room.state === 'over') showResult(); }, T.over);
  } else if (overlayOpen()) showResult();
}

function showResult() {
  const r = room;
  const draw = r.winner === 2, won = r.winner === r.you;
  const why = {
    resign: won ? '상대가 기권했어요' : '기권했어요',
    timeout: won ? '상대가 시간을 넘겼어요' : '시간을 넘겼어요',
    left: won ? '상대가 나갔어요' : '연결이 끊겨 패배했어요',
  }[r.reason] || whyText(r.reason, won, draw);
  const rec = loadJson(ONLINE_KEY);
  const opp = r.players.find((p) => p.color !== r.you);
  const iVoted = r.rematch.includes(r.you), theyVoted = opp && r.rematch.includes(opp.color);
  let again;
  if (!opp) again = '<p>상대가 방을 나갔어요</p>';
  else if (iVoted) again = '<p>상대를 기다리는 중…</p>';
  else again = `${theyVoted ? '<p>상대가 한 판 더 하고 싶어해요!</p>' : ''}<button data-act="rematch">한 판 더</button>`;
  showOverlay(`
    <h2>${draw ? '🤝 무승부' : won ? '🎉 승리!' : '😵 패배'}</h2>
    ${why ? `<p>${why}</p>` : ''}
    <span class="tag">온라인 ${rec.w || 0}승 ${rec.l || 0}패${rec.d ? ` ${rec.d}무` : ''}</span>
    <div class="col">${again}
      <div class="row"><button class="sub" data-act="view">판 보기</button><button class="sub" data-act="leave">나가기</button></div>
    </div>`);
}

function showOnline(error = '') {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = 'online'; phase = 'title'; room = null; st = null; waitingNet = false;
  buildBoard(); say(''); render();
  showOverlay(`
    <h2>🌐 온라인 대전</h2>
    <input id="nameInput" maxlength="10" placeholder="내 이름 (최대 10자)" value="${esc(myName())}" autocomplete="off">
    <div class="col">
      <button data-act="quick">⚡ 빠른 대전</button>
      <button class="sub" data-act="create">방 만들기</button>
      <div class="row join"><input id="codeInput" maxlength="4" placeholder="방 코드" autocomplete="off" autocapitalize="characters"><button class="sub" data-act="join">들어가기</button></div>
    </div>
    <span class="error">${esc(error)}</span>
    <button class="back" data-act="home">← 처음으로</button>
    <p style="font-size:12.5px">한 수에 60초 · ❌(먼저)와 ⭕는 한 판마다 바뀌어요</p>`);
}
function showQueued() {
  showOverlay(`
    <h2>상대를 찾는 중…</h2>
    <div class="dots"><span></span><span></span><span></span></div>
    <p>누군가 빠른 대전을 누르면 바로 시작해요</p>
    <button class="sub" data-act="cancel">취소</button>`);
}
const inviteUrl = () => `${location.origin}${location.pathname}?room=${room.code}`;
function showWaiting() {
  showOverlay(`
    <h2>친구를 기다리는 중…</h2>
    <p>방 코드</p>
    <div class="code">${esc(room.code)}</div>
    <p>친구가 <b>온라인 대전 → 들어가기</b>에<br>이 코드를 넣으면 시작해요</p>
    <button data-act="copy">🔗 초대 링크 복사</button>
    <button class="sub" data-act="cancel">취소</button>`);
}
function saveName() {
  const input = $('nameInput');
  if (!input) return;
  const name = input.value.trim().slice(0, 10);
  store.set('ultimatetttName', name);
  net.send('hello', { name });
}
function confirmResign() {
  showOverlay(`<h2>기권할까요?</h2><p>이번 판은 패배로 기록돼요</p>
    <div class="row"><button data-act="close">계속하기</button><button class="sub" data-act="resign">🏳 기권</button></div>`);
  $('overlay').dataset.screen = 'confirm';
}

let lastCpu = 'easy';
$('overlay').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  btn.blur();
  $('overlay').dataset.screen = '';
  const act = btn.dataset.act;
  if (act === 'cpu') { lastCpu = btn.dataset.lv; startCpu(lastCpu); }
  else if (act === 'again') startCpu(lastCpu);
  else if (act === 'home') showTitle();
  else if (act === 'online') showOnline();
  else if (act === 'quick') { saveName(); net.send('quick'); }
  else if (act === 'create') { saveName(); net.send('create'); }
  else if (act === 'join') {
    const code = ($('codeInput').value || '').trim().toUpperCase();
    if (code.length !== 4) { $('overlay').querySelector('.error').textContent = '방 코드 4자리를 넣어 주세요.'; return; }
    saveName();
    net.send('join', { code });
  } else if (act === 'cancel') { net.send('cancel'); showOnline(); }
  else if (act === 'copy') {
    const url = inviteUrl();
    const done = () => { btn.textContent = '✅ 복사했어요'; setTimeout(() => { btn.textContent = '🔗 초대 링크 복사'; }, 1500); };
    if (navigator.share && matchMedia('(pointer: coarse)').matches) navigator.share({ title: '울트라 틱택토 한 판 해요!', url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('링크를 복사하세요', url));
    else prompt('링크를 복사하세요', url);
  } else if (act === 'rematch') { net.send('rematch'); }
  else if (act === 'view') hideOverlay();
  else if (act === 'leave') showOnline();
  else if (act === 'resign') { net.send('resign'); hideOverlay(); }
  else if (act === 'close') hideOverlay();
});
$('overlay').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'codeInput') $('overlay').querySelector('[data-act="join"]').click();
  if (e.target.id === 'nameInput') $('overlay').querySelector('[data-act="quick"]').click();
  e.stopPropagation();
});
$('resignBtn').onclick = (e) => { e.currentTarget.blur(); if (online() && room && room.state === 'playing') confirmResign(); };
addEventListener('keydown', (e) => { if (e.target.tagName !== 'INPUT' && e.code === 'KeyM') toggleMute(); });
setInterval(() => { if (online() && room && room.state === 'playing' && !netDown) renderHud(); }, 500);

// ---------- 시작 ----------
const invite = new URLSearchParams(location.search).get('room');
if (invite) { try { window.history.replaceState(null, '', location.pathname); } catch (_) {} }
function joinInvite(code) { showOnline(); net.send('join', { code: code.toUpperCase() }); }
if (loadSession()) {
  mode = 'online';
  buildBoard();
  showOverlay('<h2>대국으로 돌아가는 중…</h2>');
  net.connect();
  const until = setInterval(() => {
    if (room || !loadSession()) { clearInterval(until); if (!room) invite ? joinInvite(invite) : showOnline(); }
  }, 100);
} else if (invite) joinInvite(invite);
else showTitle();

/* @test-hooks:start */
window.__ut = { get st() { return st; }, get mode() { return mode; }, get phase() { return phase; }, get room() { return room; }, T, onCell, startCpu, render };
/* @test-hooks:end */
})();
