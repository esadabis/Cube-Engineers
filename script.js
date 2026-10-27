const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
const NAMES = { U: 'Wit', R: 'Rood', F: 'Groen', D: 'Geel', L: 'Oranje', B: 'Blauw' };
const SIDES = { U: 'bovenkant', R: 'rechterkant', F: 'voorkant', D: 'onderkant', L: 'linkerkant', B: 'achterkant' };
const SOLVED = FACES.map(f => f.repeat(9)).join('');
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let state = SOLVED.split('');
let brush = 'U';
let ready = false;

function setStatus(text, isError) { $('status').textContent = text; $('status').className = isError ? 'error' : ''; }
function countColors() {
  const c = Object.fromEntries(FACES.map(f => [f, 0]));
  state.forEach(k => c[k]++);
  return c;
}

FACES.forEach(f => {
  const b = document.createElement('button');
  b.className = 'swatch'; b.dataset.c = f; b.title = NAMES[f];
  b.setAttribute('aria-label', NAMES[f]);
  b.setAttribute('aria-pressed', f === brush);
  b.onclick = () => {
    brush = f;
    document.querySelectorAll('.swatch').forEach(s => s.setAttribute('aria-pressed', s === b));
  };
  $('palette').appendChild(b);
});

const cells = [];
FACES.forEach((f, fi) => {
  const face = document.createElement('div');
  face.className = 'face'; face.style.setProperty('--a', f);
  for (let i = 0; i < 9; i++) {
    const idx = fi * 9 + i;
    const c = document.createElement('button');
    c.className = 'cell' + (i === 4 ? ' center' : '');
    c.setAttribute('aria-label', `${NAMES[f]} zijde, vakje ${i + 1}`);
    if (i !== 4) c.onclick = () => { state[idx] = brush; render(); };
    cells.push(c); face.appendChild(c);
  }
  $('net').appendChild(face);
});

function render() {
  playing = false;
  cells.forEach((c, i) => c.dataset.c = state[i]);
  const counts = countColors();
  $('counts').innerHTML = FACES.map(f =>
    `<span class="${counts[f] !== 9 ? 'bad' : ''}">${NAMES[f]}: ${counts[f]}/9</span>`).join('');
  $('result').hidden = true;
}

const S = 56;
const root = $('cubeRoot');
const cubies = [];
const stickers = new Array(54);
const FACE_T = {
  F: `translateZ(${S / 2}px)`, B: `rotateY(180deg) translateZ(${S / 2}px)`,
  R: `rotateY(90deg) translateZ(${S / 2}px)`, L: `rotateY(-90deg) translateZ(${S / 2}px)`,
  U: `rotateX(90deg) translateZ(${S / 2}px)`, D: `rotateX(-90deg) translateZ(${S / 2}px)`
};
const OUTER = { U: c => c.y === -1, D: c => c.y === 1, R: c => c.x === 1, L: c => c.x === -1, F: c => c.z === 1, B: c => c.z === -1 };
const STICKER_INDEX = {
  U: c => 0 + (c.z + 1) * 3 + (c.x + 1),  R: c => 9 + (c.y + 1) * 3 + (1 - c.z),
  F: c => 18 + (c.y + 1) * 3 + (c.x + 1), D: c => 27 + (1 - c.z) * 3 + (c.x + 1),
  L: c => 36 + (c.y + 1) * 3 + (c.z + 1), B: c => 45 + (c.y + 1) * 3 + (1 - c.x)
};
const ROT = {
  F: a => `rotateZ(${a}deg)`, B: a => `rotateZ(${-a}deg)`,
  R: a => `rotateX(${a}deg)`, L: a => `rotateX(${-a}deg)`,
  U: a => `rotateY(${-a}deg)`, D: a => `rotateY(${a}deg)`
};

for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
  const c = { x, y, z };
  const wrap = document.createElement('div'); wrap.className = 'wrap';
  const el = document.createElement('div'); el.className = 'cubie';
  el.style.transform = `translate3d(${x * S}px, ${y * S}px, ${z * S}px)`;
  FACES.forEach(f => {
    const d = document.createElement('div'); d.className = 'f'; d.style.transform = FACE_T[f];
    if (OUTER[f](c)) {
      const s = document.createElement('span'); s.className = 'st';
      d.appendChild(s); stickers[STICKER_INDEX[f](c)] = s;
    }
    el.appendChild(d);
  });
  wrap.appendChild(el); root.appendChild(wrap);
  c.wrap = wrap; cubies.push(c);
}

const VIEWS = { a: { rx: -25, ry: -35 }, b: { rx: 25, ry: 145 } };
let view = 'a', rx = -25, ry = -35, autoView = true, viewBusyUntil = 0;
function applyView(smooth) {
  root.style.transition = smooth ? 'transform .7s ease' : 'none';
  root.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
}
function resetView() {
  autoView = true; view = 'a'; rx = VIEWS.a.rx; ry = VIEWS.a.ry;
  applyView(true); $('viewReset').hidden = true;
}
function setViewFor(face) {
  if (!autoView) return;
  const want = 'UFR'.includes(face) ? 'a' : 'b';
  if (want === view) return;
  view = want; rx = VIEWS[want].rx; ry = VIEWS[want].ry;
  applyView(true); viewBusyUntil = performance.now() + 700;
}
let drag = null;
$('stage').addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); });
$('stage').addEventListener('pointermove', e => {
  if (!drag) return;
  ry += (e.clientX - drag.x) * 0.6;
  rx = Math.max(-85, Math.min(85, rx - (e.clientY - drag.y) * 0.6));
  drag = { x: e.clientX, y: e.clientY };
  autoView = false; $('viewReset').hidden = false; applyView(false);
});
['pointerup', 'pointercancel'].forEach(ev => $('stage').addEventListener(ev, () => drag = null));
$('viewReset').onclick = resetView;
applyView(false);

let moves = [], idx = 0, cur = [], start = '', busy = false, playing = false, hlFace = null;

const applyMove = (s, m) => { const c = Cube.fromString(s); c.move(m); return c.asString(); };
const inverse = m => m.length === 1 ? m + "'" : (m[1] === "'" ? m[0] : m);
const angleOf = m => m.length === 1 ? 90 : (m[1] === "'" ? -90 : 180);
const speed = () => +$('speed').value;

function paint() {
  stickers.forEach((s, i) => {
    s.dataset.c = cur[i];
    s.classList.toggle('hl', !!hlFace && FACES[Math.floor(i / 9)] === hlFace);
  });
}

function animate(face, angle, ms) {
  return new Promise(resolve => {
    const group = cubies.filter(OUTER[face]);
    const t0 = performance.now();
    (function frame(t) {
      const p = Math.min(1, (t - t0) / ms);
      const e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      group.forEach(c => c.wrap.style.transform = ROT[face](angle * e));
      if (p < 1) requestAnimationFrame(frame);
      else { group.forEach(c => c.wrap.style.transform = ''); resolve(); }
    })(t0);
  });
}

function describe(m) {
  const f = m[0], side = SIDES[f];
  const where = `${side} (midden ${NAMES[f].toLowerCase()})`;
  if (m.length === 1) return { icon: '↻', sub: '90°', text: `Draai de ${where} een kwartslag met de klok mee` };
  if (m[1] === "'") return { icon: '↺', sub: '90°', text: `Draai de ${where} een kwartslag tegen de klok in` };
  return { icon: '↻', sub: '2 × 90° = 180°', text: `Draai de ${where} een halve slag` };
}

function refresh() {
  const n = moves.length, done = idx >= n;
  hlFace = done ? null : moves[idx][0];
  if (!done) setViewFor(hlFace);
  paint();
  if (n === 0) {
    $('arrow').innerHTML = ''; $('stepNo').textContent = '';
    $('stepTxt').textContent = 'Deze cube is al opgelost.'; $('stepSub').textContent = '';
  } else if (done) {
    $('arrow').innerHTML = '<b>✓</b>'; $('stepNo').textContent = `Alle ${n} stappen gedaan`;
    $('stepTxt').textContent = 'Klaar, de cube is opgelost!'; $('stepSub').textContent = '';
  } else {
    const d = describe(moves[idx]);
    $('arrow').innerHTML = `<b>${d.icon}</b><small>${d.sub}</small>`;
    $('stepNo').textContent = `Stap ${idx + 1} van ${n}`;
    $('stepTxt').textContent = d.text;
    $('stepSub').textContent = 'Kijk recht op die zijde: met de klok mee is de richting van de wijzers.';
  }
  $('bar').style.width = (n ? idx / n * 100 : 100) + '%';
  document.querySelectorAll('#moves button').forEach((b, i) => {
    b.className = i < idx ? 'done' : (i === idx ? 'now' : '');
  });
  $('toStart').disabled = $('prevBtn').disabled = idx === 0;
  $('nextBtn').disabled = done;
  $('playBtn').disabled = n === 0;
  $('playBtn').textContent = playing ? 'Pauze' : (done && n ? 'Opnieuw afspelen' : 'Afspelen');
}

async function step(dir) {
  if (busy || (dir > 0 && idx >= moves.length) || (dir < 0 && idx <= 0)) return;
  busy = true;
  const m = dir > 0 ? moves[idx] : inverse(moves[idx - 1]);
  setViewFor(m[0]);
  const wait = viewBusyUntil - performance.now();
  if (wait > 0) await sleep(wait);
  hlFace = null; paint();
  await animate(m[0], angleOf(m), speed());
  cur = applyMove(cur.join(''), m).split('');
  idx += dir; busy = false; refresh();
}

function goTo(i) {
  if (busy) return;
  playing = false;
  let s = start;
  for (let k = 0; k < i; k++) s = applyMove(s, moves[k]);
  cur = s.split(''); idx = i; refresh();
}

async function togglePlay() {
  if (playing) { playing = false; refresh(); return; }
  if (idx >= moves.length) goTo(0);
  playing = true; refresh();
  while (playing && idx < moves.length) {
    await step(1);
    await sleep(speed() > 400 ? 350 : 150);
  }
  playing = false; refresh();
}

$('toStart').onclick = () => goTo(0);
$('prevBtn').onclick = () => { playing = false; step(-1); };
$('nextBtn').onclick = () => { playing = false; step(1); };
$('playBtn').onclick = togglePlay;

const CORNER_POS = [[8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11], [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51]];
const CORNER_COL = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
const EDGE_POS = [[5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25], [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14]];
const EDGE_COL = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];
const parity = p => { let n = 0; for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) n++; return n % 2; };

/*Fix voor vastlopen */

function isValid(s) {
  const cp = [], co = [], ep = [], eo = [];
  for (let i = 0; i < 8; i++) {
    const cols = CORNER_POS[i].map(p => s[p]);
    const ori = cols.findIndex(c => c === 'U' || c === 'D');
    const j = ori < 0 ? -1 : CORNER_COL.findIndex(k => k[1] === cols[(ori + 1) % 3] && k[2] === cols[(ori + 2) % 3]);
    if (j < 0) return false;
    cp.push(j); co.push(ori);
  }
  for (let i = 0; i < 12; i++) {
    const [a, b] = EDGE_POS[i].map(p => s[p]);
    let j = EDGE_COL.indexOf(a + b), o = 0;
    if (j < 0) { j = EDGE_COL.indexOf(b + a); o = 1; }
    if (j < 0) return false;
    ep.push(j); eo.push(o);
  }
  return new Set(cp).size === 8 && new Set(ep).size === 12
    && co.reduce((a, b) => a + b, 0) % 3 === 0
    && eo.reduce((a, b) => a + b, 0) % 2 === 0
    && parity(cp) === parity(ep);
}

/*Oplossen van cube*/

$('solveBtn').onclick = () => {
  const counts = countColors();
  const wrong = FACES.filter(f => counts[f] !== 9);
  if (wrong.length) {
    setStatus('Elke kleur moet precies 9 keer voorkomen. Controleer: ' + wrong.map(f => NAMES[f]).join(', ') + '.', true);
    return;
  }
  if (!isValid(state.join(''))) {
    $('result').hidden = true;
    setStatus('Deze mogelijkheid bestaat niet.', true);
    return;
  }
  let solution;
  try {
    solution = Cube.fromString(state.join('')).solve();
  } catch (e) { solution = null; }
  if (solution === null || solution === undefined) {
    $('result').hidden = true;
    setStatus('Deze mogelijkheid bestaat niet.', true);
    return;
  }
  moves = solution.trim() ? solution.trim().split(/\s+/) : [];
  start = state.join(''); cur = start.split(''); idx = 0; playing = false; busy = false;
  $('resultTitle').textContent = moves.length ? `Oplossing in ${moves.length} stappen` : 'Al opgelost';
  $('moves').innerHTML = moves.map((m, i) => `<li><button data-i="${i}">${m}</button></li>`).join('');
  $('moves').querySelectorAll('button').forEach(b => b.onclick = () => goTo(+b.dataset.i));
  setStatus('Oplossing berekend.');
  $('result').hidden = false;
  resetView();
  refresh();
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

$('resetBtn').onclick = () => { state = SOLVED.split(''); setStatus(ready ? 'Klaar. Vul de cube in.' : 'Oplosser laden…'); render(); };
$('randomBtn').onclick = () => {
  state = Cube.random().asString().split('');
  setStatus('Willekeurige cube geladen. Klik op "Los op".');
  render();
};

render();

setTimeout(() => {
  try {
    Cube.initSolver();
    ready = true;
    $('solveBtn').disabled = false; $('randomBtn').disabled = false;
    setStatus('Klaar. Vul de cube in en klik op "Los op".');
  } catch (e) {
    setStatus('De oplosser kon niet geladen worden. Controleer je internetverbinding.', true);
  }
}, 50);
