const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
const NAMES = { U: 'Wit', R: 'Rood', F: 'Groen', D: 'Geel', L: 'Oranje', B: 'Blauw' };
const SIDES = { U: 'bovenkant', R: 'rechterkant', F: 'voorkant', D: 'onderkant', L: 'linkerkant', B: 'achterkant' };
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/*Volgorde van de foto's: welke kant naar de camera, en welke kleur boven en links zit*/
const SCAN = [
  { f: 'F', top: 'U', left: 'L', text: 'Houd de groene kant naar de camera, met wit boven.' },
  { f: 'R', top: 'U', left: 'F', text: 'Draai de cube zodat de rode kant naar de camera wijst. Wit blijft boven.' },
  { f: 'B', top: 'U', left: 'R', text: 'Draai verder zodat de blauwe kant naar de camera wijst. Wit blijft boven.' },
  { f: 'L', top: 'U', left: 'B', text: 'Draai verder zodat de oranje kant naar de camera wijst. Wit blijft boven.' },
  { f: 'U', top: 'B', left: 'L', text: 'Kantel de cube zodat de witte kant naar de camera wijst, met blauw boven.' },
  { f: 'D', top: 'F', left: 'L', text: 'Kantel de cube zodat de gele kant naar de camera wijst, met groen boven.' }
];
const DEFAULT_RGB = { U: [225, 225, 220], R: [185, 35, 45], F: [25, 155, 85], D: [225, 205, 45], L: [235, 115, 35], B: [25, 85, 185] };
const GUIDE = 0.7;

let state, raw, manual, scanned, scanAt;
let brush = 'U';
let ready = false;
let stream = null;

function resetScan() {
  state = FACES.flatMap(f => Array.from({ length: 9 }, (_, i) => i === 4 ? f : ''));
  raw = new Array(54).fill(null);
  manual = new Array(54).fill(null);
  scanned = Object.fromEntries(FACES.map(f => [f, false]));
  scanAt = 0;
}
resetScan();

function setStatus(text, isError) { $('status').textContent = text; $('status').className = isError ? 'error' : ''; }
function scanMsg(text, isError) { $('scanStatus').textContent = text; $('scanStatus').className = isError ? 'error' : ''; }
function countColors() {
  const c = Object.fromEntries(FACES.map(f => [f, 0]));
  state.forEach(k => { if (k) c[k]++; });
  return c;
}

/*Kleurherkenning*/
function toLab([r, g, b]) {
  const lin = v => (v /= 255) <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const dist = (a, b) => Math.hypot((a[0] - b[0]) * 0.5, a[1] - b[1], a[2] - b[2]);
const median = a => { a.sort((x, y) => x - y); return a[a.length >> 1]; };

function refs() {
  return Object.fromEntries(FACES.map((f, fi) => [f, scanned[f] ? raw[fi * 9 + 4] : toLab(DEFAULT_RGB[f])]));
}
function nearest(lab, ref) {
  let best = null, d = Infinity;
  FACES.forEach(f => { const e = dist(lab, ref[f]); if (e < d) { d = e; best = f; } });
  return best;
}

/*De middens zijn de referentiekleuren. Als alle kanten gescand zijn krijgt elke kleur precies 9 vakjes.*/
function classify() {
  const ref = refs();
  const cap = Object.fromEntries(FACES.map(f => [f, 9]));
  const free = [];
  for (let i = 0; i < 54; i++) {
    const f = FACES[Math.floor(i / 9)];
    if (i % 9 === 4) { state[i] = f; cap[f]--; }
    else if (!scanned[f]) state[i] = '';
    else if (manual[i]) { state[i] = manual[i]; cap[manual[i]]--; }
    else free.push(i);
  }
  if (!FACES.every(f => scanned[f])) { free.forEach(i => state[i] = nearest(raw[i], ref)); return; }
  const pairs = [];
  free.forEach(i => FACES.forEach(f => pairs.push([dist(raw[i], ref[f]), i, f])));
  pairs.sort((a, b) => a[0] - b[0]);
  const done = new Set();
  for (const [, i, f] of pairs) {
    if (done.has(i) || cap[f] <= 0) continue;
    state[i] = f; cap[f]--; done.add(i);
  }
  free.forEach(i => { if (!done.has(i)) state[i] = nearest(raw[i], ref); });
}

const work = document.createElement('canvas');
work.width = work.height = 240;
const wctx = work.getContext('2d', { willReadFrequently: true });

function sample(source, sw, sh) {
  const side = Math.min(sw, sh) * GUIDE;
  wctx.drawImage(source, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, 240, 240);
  const data = wctx.getImageData(0, 0, 240, 240).data;
  const out = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const R = [], G = [], B = [];
    for (let y = r * 80 + 24; y < r * 80 + 56; y += 2) for (let x = c * 80 + 24; x < c * 80 + 56; x += 2) {
      const k = (y * 240 + x) * 4;
      R.push(data[k]); G.push(data[k + 1]); B.push(data[k + 2]);
    }
    out.push(toLab([median(R), median(G), median(B)]));
  }
  return out;
}

/*Camera*/
const video = $('video');
const guideCells = [];
for (let i = 0; i < 9; i++) {
  const d = document.createElement('div'), s = document.createElement('span');
  d.appendChild(s); $('guide').appendChild(d); guideCells.push(s);
}

function sizeGuide() {
  const s = Math.min(video.clientWidth, video.clientHeight) * GUIDE;
  $('guide').style.width = $('guide').style.height = s + 'px';
}
['loadedmetadata', 'playing', 'resize'].forEach(ev => video.addEventListener(ev, sizeGuide));
window.addEventListener('resize', sizeGuide);

function stopCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null; video.srcObject = null;
  $('guide').hidden = true; $('cameraOff').hidden = false;
  $('snapBtn').disabled = true;
}

async function startCamera(deviceId) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('camInfo').textContent = window.isSecureContext
      ? 'Deze browser ondersteunt geen camera. Gebruik "Foto uploaden".'
      : 'De camera werkt alleen via https of localhost (bijvoorbeeld met Live Server). Je kunt ook "Foto uploaden" gebruiken.';
    return;
  }
  stopCamera();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
  } catch (e) {
    stream = null;
    $('camInfo').textContent = e.name === 'NotAllowedError'
      ? 'Je hebt geen toestemming gegeven voor de camera. Sta de camera toe in je browser, of gebruik "Foto uploaden".'
      : 'De camera kon niet gestart worden. Gebruik eventueel "Foto uploaden".';
    return;
  }
  video.srcObject = stream;
  const track = stream.getVideoTracks()[0];
  $('cameraOff').hidden = true; $('guide').hidden = false;
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
  const sel = $('camSelect');
  sel.innerHTML = '';
  cams.forEach((c, i) => sel.appendChild(new Option(c.label || 'Camera ' + (i + 1), c.deviceId)));
  sel.value = track.getSettings().deviceId || '';
  sel.hidden = cams.length < 2;
  render();
}
$('startCam').onclick = () => startCamera();
$('camSelect').onchange = e => startCamera(e.target.value);

setInterval(() => {
  if (!stream || video.readyState < 2) return;
  const ref = refs();
  sample(video, video.videoWidth, video.videoHeight).forEach((l, i) => guideCells[i].dataset.c = nearest(l, ref));
}, 300);

function capture(labs) {
  const s = SCAN[scanAt], fi = FACES.indexOf(s.f);
  const similar = FACES.find(f => f !== s.f && scanned[f] && dist(labs[4], raw[FACES.indexOf(f) * 9 + 4]) < 10);
  labs.forEach((l, i) => { raw[fi * 9 + i] = l; manual[fi * 9 + i] = null; });
  scanned[s.f] = true;
  classify();
  const next = SCAN.findIndex((t, k) => k > scanAt && !scanned[t.f]);
  scanAt = next >= 0 ? next : SCAN.findIndex(t => !scanned[t.f]);
  if (similar) scanMsg(`Let op: het midden lijkt op ${NAMES[similar].toLowerCase()}, terwijl ${NAMES[s.f].toLowerCase()} verwacht werd. Klik op "${NAMES[s.f]}" hierboven om die foto opnieuw te maken.`, true);
  else scanMsg(`Kant met ${NAMES[s.f].toLowerCase()} midden gescand.`);
  const cam = $('camera');
  cam.classList.remove('flash'); void cam.offsetWidth; cam.classList.add('flash');
  render();
}

$('snapBtn').onclick = () => {
  if (!stream || scanAt < 0) return;
  capture(sample(video, video.videoWidth, video.videoHeight));
};

$('fileInput').onchange = e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (scanAt < 0) { scanMsg('Alle kanten zijn al gescand. Klik eerst op een kant hierboven om die opnieuw te doen.', true); return; }
  const img = new Image();
  img.onload = () => { capture(sample(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(img.src); };
  img.onerror = () => scanMsg('Deze foto kon niet geladen worden.', true);
  img.src = URL.createObjectURL(file);
};

/*Voortgang en instructies*/
SCAN.forEach((s, k) => {
  const li = document.createElement('li'), b = document.createElement('button');
  b.innerHTML = `<i data-c="${s.f}"></i>${NAMES[s.f]}`;
  b.onclick = () => { scanAt = k; scanMsg(''); render(); };
  li.appendChild(b); $('steps').appendChild(li);
});

function drawHint(s) {
  const mini = Array.from({ length: 9 }, (_, i) => i === 4 ? `<b data-c="${s.f}"></b>` : '<b></b>').join('');
  $('hint').innerHTML = `<i class="top" data-c="${s.top}"></i><i class="left" data-c="${s.left}"></i><div class="mini">${mini}</div>`;
}

/*Invoer controleren*/
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
    if (i !== 4) c.onclick = () => { manual[idx] = brush; state[idx] = brush; render(); };
    cells.push(c); face.appendChild(c);
  }
  $('net').appendChild(face);
});

function render() {
  playing = false;
  const allDone = scanAt < 0;
  $('steps').querySelectorAll('button').forEach((b, k) => {
    b.classList.toggle('done', scanned[SCAN[k].f]);
    b.classList.toggle('now', k === scanAt);
  });
  $('hint').hidden = allDone;
  if (allDone) {
    $('scanNo').textContent = 'Alle 6 kanten gescand';
    $('scanTxt').textContent = 'Controleer de kleuren hieronder en klik op "Los op".';
    $('scanSub').textContent = 'Wil je een kant opnieuw fotograferen? Klik er hierboven op.';
  } else {
    const s = SCAN[scanAt];
    drawHint(s);
    $('scanNo').textContent = `Foto ${scanAt + 1} van 6: kant met ${NAMES[s.f].toLowerCase()} midden`;
    $('scanTxt').textContent = s.text;
    $('scanSub').textContent = `Op het scherm zit ${NAMES[s.top].toLowerCase()} boven en ${NAMES[s.left].toLowerCase()} links, net als in het plaatje. Laat de kant het vierkant vullen, met elk vakje in een hokje.`;
  }
  $('snapBtn').disabled = !stream || allDone;
  cells.forEach((c, i) => {
    c.dataset.c = state[i];
    c.disabled = i % 9 === 4 || !scanned[FACES[Math.floor(i / 9)]];
  });
  const counts = countColors();
  $('counts').innerHTML = FACES.map(f =>
    `<span class="${allDone && counts[f] !== 9 ? 'bad' : ''}">${NAMES[f]}: ${counts[f]}/9</span>`).join('');
  $('solveBtn').disabled = !ready || !allDone;
  $('result').hidden = true;
}

/*3D cube*/
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

/*Stappenspeler*/
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
    $('stepSub').textContent = 'Houd de cube weer met wit boven en groen naar je toe. Kijk recht op de zijde die je draait: met de klok mee is de richting van de wijzers.';
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

/*Controle of de cube kan bestaan*/
const CORNER_POS = [[8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11], [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51]];
const CORNER_COL = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
const EDGE_POS = [[5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25], [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14]];
const EDGE_COL = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];
const parity = p => { let n = 0; for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) n++; return n % 2; };

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

/*Oplossen*/
$('solveBtn').onclick = () => {
  const counts = countColors();
  const wrong = FACES.filter(f => counts[f] !== 9);
  if (wrong.length) {
    setStatus('Elke kleur moet precies 9 keer voorkomen. Controleer: ' + wrong.map(f => NAMES[f]).join(', ') + '.', true);
    return;
  }
  const invalid = 'Deze combinatie kan niet bestaan. Waarschijnlijk is een kleur verkeerd herkend of is een kant verkeerd om gefotografeerd. Controleer de vakjes.';
  if (!isValid(state.join(''))) {
    $('result').hidden = true;
    setStatus(invalid, true);
    return;
  }
  let solution;
  try {
    solution = Cube.fromString(state.join('')).solve();
  } catch (e) { solution = null; }
  if (solution === null || solution === undefined) {
    $('result').hidden = true;
    setStatus(invalid, true);
    return;
  }
  stopCamera();
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

$('resetBtn').onclick = () => {
  resetScan(); scanMsg('');
  setStatus(ready ? 'Klaar. Scan alle 6 kanten.' : 'Oplosser laden…');
  render();
};

render();

setTimeout(() => {
  try {
    Cube.initSolver();
    ready = true;
    setStatus('Klaar. Scan alle 6 kanten en klik daarna op "Los op".');
    render();
  } catch (e) {
    setStatus('De oplosser kon niet geladen worden. Controleer je internetverbinding.', true);
  }
}, 50);
