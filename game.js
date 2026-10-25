'use strict';

// ---- Constants -------------------------------------------------------------

const COLS = 10;
const ROWS = 20;
const HIDDEN = 2; // spawn rows above the visible field
const CELL = 30;

const DAS = 160; // ms before auto-repeat starts
const ARR = 40; // ms between auto-repeat moves
const SOFT_DROP_MS = 30;
const LOCK_DELAY = 500;
const MAX_LOCK_RESETS = 15;
const LINE_SCORES = [0, 100, 300, 500, 800];

const COLORS = {
  I: '#00e5ff',
  O: '#ffd400',
  T: '#b14dff',
  S: '#2ee66b',
  Z: '#ff3d5a',
  J: '#3d7bff',
  L: '#ff9a1f',
};

// Spawn orientation of each piece; rotation states are derived by rotating the matrix.
const SHAPES = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
};

// SRS wall kicks, keyed "from>to", offsets as [dx, dy] with y pointing down.
const flipY = (table) =>
  Object.fromEntries(Object.entries(table).map(([k, v]) => [k, v.map(([x, y]) => [x, -y])]));

const KICKS_JLSTZ = flipY({
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
});

const KICKS_I = flipY({
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
});

// ---- DOM -------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const boardCtx = $('board').getContext('2d');
const holdCtx = $('hold').getContext('2d');
const nextCtx = $('next').getContext('2d');
const overlay = $('overlay');

// ---- Helpers ---------------------------------------------------------------

const rotateCW = (m) => m[0].map((_, c) => m.map((row) => row[c]).reverse());

function rotations(shape) {
  const out = [shape];
  for (let i = 1; i < 4; i++) out.push(rotateCW(out[i - 1]));
  return out;
}

const PIECES = Object.fromEntries(Object.keys(SHAPES).map((k) => [k, rotations(SHAPES[k])]));

function loadBest() {
  try { return Number(localStorage.getItem('tetrix-best')) || 0; } catch { return 0; }
}

function saveBest(v) {
  try { localStorage.setItem('tetrix-best', String(v)); } catch { /* storage unavailable */ }
}

function gravityMs(level) {
  // Tetris Guideline gravity curve, in ms per row.
  return Math.pow(0.8 - (level - 1) * 0.007, level - 1) * 1000;
}

// ---- Game state ------------------------------------------------------------

const state = {
  grid: [],
  piece: null,
  queue: [],
  bag: [],
  hold: null,
  holdUsed: false,
  score: 0,
  best: loadBest(),
  lines: 0,
  level: 1,
  mode: 'title', // title | playing | paused | over
  dropTimer: 0,
  lockTimer: 0,
  lockResets: 0,
  flash: [], // rows being flashed after a clear
  flashTimer: 0,
};

function emptyGrid() {
  return Array.from({ length: ROWS + HIDDEN }, () => Array(COLS).fill(null));
}

function nextFromBag() {
  if (state.bag.length === 0) {
    state.bag = Object.keys(SHAPES);
    for (let i = state.bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.bag[i], state.bag[j]] = [state.bag[j], state.bag[i]];
    }
  }
  return state.bag.pop();
}

function makePiece(type) {
  const size = PIECES[type][0].length;
  return { type, rot: 0, x: Math.floor((COLS - size) / 2), y: type === 'I' ? 0 : 1 };
}

function cells(p, rot = p.rot, x = p.x, y = p.y) {
  const out = [];
  PIECES[p.type][rot].forEach((row, r) =>
    row.forEach((v, c) => { if (v) out.push([x + c, y + r]); }));
  return out;
}

function fits(p, rot, x, y) {
  return cells(p, rot, x, y).every(([cx, cy]) =>
    cx >= 0 && cx < COLS && cy < ROWS + HIDDEN && (cy < 0 || !state.grid[cy][cx]));
}

const onGround = () => !fits(state.piece, state.piece.rot, state.piece.x, state.piece.y + 1);

function spawn(type = null) {
  while (state.queue.length < 6) state.queue.push(nextFromBag());
  state.piece = makePiece(type ?? state.queue.shift());
  while (state.queue.length < 6) state.queue.push(nextFromBag());
  state.dropTimer = 0;
  state.lockTimer = 0;
  state.lockResets = 0;
  if (!fits(state.piece, 0, state.piece.x, state.piece.y)) gameOver();
}

function reset() {
  Object.assign(state, {
    grid: emptyGrid(), queue: [], bag: [], hold: null, holdUsed: false,
    score: 0, lines: 0, level: 1, flash: [], flashTimer: 0,
  });
  state.mode = 'playing';
  spawn();
  hideOverlay();
  updateStats();
}

// ---- Actions ---------------------------------------------------------------

function afterMove() {
  // Moving/rotating while grounded resets the lock delay, up to a limit.
  if (onGround() && state.lockResets < MAX_LOCK_RESETS) {
    state.lockTimer = 0;
    state.lockResets++;
  }
}

function move(dx) {
  const p = state.piece;
  if (!fits(p, p.rot, p.x + dx, p.y)) return false;
  p.x += dx;
  afterMove();
  return true;
}

function rotate(dir) {
  const p = state.piece;
  if (p.type === 'O') return;
  const to = (p.rot + dir + 4) % 4;
  const kicks = (p.type === 'I' ? KICKS_I : KICKS_JLSTZ)[`${p.rot}>${to}`];
  for (const [dx, dy] of kicks) {
    if (fits(p, to, p.x + dx, p.y + dy)) {
      p.x += dx;
      p.y += dy;
      p.rot = to;
      afterMove();
      return;
    }
  }
}

function softDrop() {
  const p = state.piece;
  if (fits(p, p.rot, p.x, p.y + 1)) {
    p.y++;
    state.score += 1;
    state.dropTimer = 0;
    updateStats();
  }
}

function hardDrop() {
  const p = state.piece;
  let dist = 0;
  while (fits(p, p.rot, p.x, p.y + 1)) { p.y++; dist++; }
  state.score += dist * 2;
  lock();
}

function holdPiece() {
  if (state.holdUsed) return;
  const current = state.piece.type;
  if (state.hold) spawn(state.hold);
  else spawn();
  state.hold = current;
  state.holdUsed = true;
}

function lock() {
  const p = state.piece;
  const placed = cells(p);
  // Lock out: piece came to rest entirely above the visible field.
  if (placed.every(([, y]) => y < HIDDEN)) { gameOver(); return; }
  placed.forEach(([x, y]) => { if (y >= 0) state.grid[y][x] = p.type; });

  const full = [];
  state.grid.forEach((row, y) => { if (row.every(Boolean)) full.push(y); });
  if (full.length) {
    state.flash = full;
    state.flashTimer = 120;
    state.score += LINE_SCORES[full.length] * state.level;
    state.lines += full.length;
    state.level = Math.floor(state.lines / 10) + 1;
  }
  state.holdUsed = false;
  state.piece = null;
  updateStats();
  if (!full.length) spawn();
}

function clearFlashedRows() {
  state.grid = state.grid.filter((_, y) => !state.flash.includes(y));
  while (state.grid.length < ROWS + HIDDEN) state.grid.unshift(Array(COLS).fill(null));
  state.flash = [];
  spawn();
}

function gameOver() {
  state.mode = 'over';
  state.piece = null;
  if (state.score > state.best) {
    state.best = state.score;
    saveBest(state.best);
  }
  updateStats();
  showOverlay('GAME OVER', `Score ${state.score}\nPress Enter or tap to play again`);
}

function togglePause() {
  if (state.mode === 'playing') {
    state.mode = 'paused';
    showOverlay('PAUSED', 'Press P / Esc or tap to resume');
  } else if (state.mode === 'paused') {
    state.mode = 'playing';
    hideOverlay();
  }
}

// ---- Input -----------------------------------------------------------------

const held = {}; // action -> { time, repeating }

const KEYMAP = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'soft',
  ArrowUp: 'rotate', KeyX: 'rotate', KeyZ: 'rotateCCW',
  Space: 'hard', KeyC: 'hold', ShiftLeft: 'hold', ShiftRight: 'hold',
  KeyP: 'pause', Escape: 'pause', Enter: 'start',
};

function press(act) {
  if (act === 'start') {
    if (state.mode === 'title' || state.mode === 'over') reset();
    else if (state.mode === 'paused') togglePause();
    return;
  }
  if (act === 'pause') { togglePause(); return; }
  if (state.mode !== 'playing' || !state.piece) return;

  switch (act) {
    case 'left': move(-1); held.left = { time: 0 }; delete held.right; break;
    case 'right': move(1); held.right = { time: 0 }; delete held.left; break;
    case 'soft': softDrop(); held.soft = { time: 0 }; break;
    case 'rotate': rotate(1); break;
    case 'rotateCCW': rotate(-1); break;
    case 'hard': hardDrop(); break;
    case 'hold': holdPiece(); break;
  }
}

function release(act) { delete held[act]; }

document.addEventListener('keydown', (e) => {
  const act = KEYMAP[e.code];
  if (!act) return;
  e.preventDefault();
  if (e.repeat) return; // auto-repeat is handled by DAS/ARR
  press(act);
});

document.addEventListener('keyup', (e) => {
  const act = KEYMAP[e.code];
  if (act) release(act);
});

window.addEventListener('blur', () => {
  for (const k of Object.keys(held)) delete held[k];
  if (state.mode === 'playing') togglePause();
});

overlay.addEventListener('click', () => press('start'));

document.querySelectorAll('.touch button').forEach((btn) => {
  const act = btn.dataset.act;
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); press(act); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) =>
    btn.addEventListener(ev, () => release(act)));
});

function handleRepeat(dt) {
  for (const dir of ['left', 'right']) {
    const h = held[dir];
    if (!h) continue;
    h.time += dt;
    while (h.time >= DAS + ARR) {
      h.time -= ARR;
      if (!move(dir === 'left' ? -1 : 1)) break;
    }
  }
  if (held.soft) {
    held.soft.time += dt;
    while (held.soft.time >= SOFT_DROP_MS && state.piece) {
      held.soft.time -= SOFT_DROP_MS;
      softDrop();
    }
  }
}

// ---- Rendering -------------------------------------------------------------

function drawCell(ctx, x, y, size, color, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(x + 1, y + 1, size - 2, 3);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 1, y + size - 4, size - 2, 3);
  ctx.globalAlpha = 1;
}

function drawBoard() {
  const ctx = boardCtx;
  ctx.clearRect(0, 0, COLS * CELL, ROWS * CELL);

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  for (let x = 1; x < COLS; x++) {
    ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, ROWS * CELL); ctx.stroke();
  }
  for (let y = 1; y < ROWS; y++) {
    ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(COLS * CELL, y * CELL); ctx.stroke();
  }

  for (let y = HIDDEN; y < ROWS + HIDDEN; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = state.grid[y][x];
      if (!t) continue;
      const color = state.flash.includes(y) ? '#ffffff' : COLORS[t];
      drawCell(ctx, x * CELL, (y - HIDDEN) * CELL, CELL, color);
    }
  }

  const p = state.piece;
  if (!p) return;

  let ghostY = p.y;
  while (fits(p, p.rot, p.x, ghostY + 1)) ghostY++;
  cells(p, p.rot, p.x, ghostY).forEach(([x, y]) => {
    if (y >= HIDDEN) {
      ctx.strokeStyle = COLORS[p.type];
      ctx.globalAlpha = 0.5;
      ctx.strokeRect(x * CELL + 2.5, (y - HIDDEN) * CELL + 2.5, CELL - 5, CELL - 5);
      ctx.globalAlpha = 1;
    }
  });

  // Fade the active piece slightly as the lock delay runs out.
  const alpha = onGround() ? 1 - 0.4 * (state.lockTimer / LOCK_DELAY) : 1;
  cells(p).forEach(([x, y]) => {
    if (y >= HIDDEN) drawCell(ctx, x * CELL, (y - HIDDEN) * CELL, CELL, COLORS[p.type], alpha);
  });
}

function drawMini(ctx, type, ox, oy, box, alpha = 1) {
  if (!type) return;
  const m = SHAPES[type];
  const filled = [];
  m.forEach((row, r) => row.forEach((v, c) => { if (v) filled.push([c, r]); }));
  const minX = Math.min(...filled.map(([c]) => c));
  const maxX = Math.max(...filled.map(([c]) => c));
  const minY = Math.min(...filled.map(([, r]) => r));
  const maxY = Math.max(...filled.map(([, r]) => r));
  const size = 20;
  const w = (maxX - minX + 1) * size;
  const h = (maxY - minY + 1) * size;
  const sx = ox + (box - w) / 2;
  const sy = oy + (box - h) / 2;
  filled.forEach(([c, r]) =>
    drawCell(ctx, sx + (c - minX) * size, sy + (r - minY) * size, size, COLORS[type], alpha));
}

function drawSide() {
  holdCtx.clearRect(0, 0, 96, 96);
  drawMini(holdCtx, state.hold, 0, 0, 96, state.holdUsed ? 0.35 : 1);

  nextCtx.clearRect(0, 0, 96, 288);
  state.queue.slice(0, 4).forEach((t, i) => drawMini(nextCtx, t, 0, i * 72, 72 + 24 * (i === 0)));
}

function updateStats() {
  $('score').textContent = state.score;
  $('best').textContent = Math.max(state.best, state.score);
  $('level').textContent = state.level;
  $('lines').textContent = state.lines;
}

function showOverlay(title, text) {
  $('overlay-title').textContent = title;
  $('overlay-text').textContent = text;
  overlay.hidden = false;
}

function hideOverlay() { overlay.hidden = true; }

// ---- Main loop -------------------------------------------------------------

function update(dt) {
  if (state.mode !== 'playing') return;

  if (state.flash.length) {
    state.flashTimer -= dt;
    if (state.flashTimer <= 0) clearFlashedRows();
    return;
  }
  if (!state.piece) return;

  handleRepeat(dt);
  if (!state.piece) return;

  if (onGround()) {
    state.lockTimer += dt;
    if (state.lockTimer >= LOCK_DELAY) lock();
  } else {
    state.lockTimer = 0;
    state.dropTimer += dt;
    const interval = gravityMs(state.level);
    while (state.dropTimer >= interval && !onGround()) {
      state.dropTimer -= interval;
      state.piece.y++;
    }
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(now - last, 100);
  last = now;
  update(dt);
  drawBoard();
  drawSide();
  requestAnimationFrame(frame);
}

state.grid = emptyGrid();
updateStats();
requestAnimationFrame(frame);
