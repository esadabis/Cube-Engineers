/*Camera scanner*/

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

let raw, manual, scanned, scanAt, stream = null;

function resetScan() {
  state = FACES.flatMap(f => Array.from({ length: 9 }, (_, i) => i === 4 ? f : ''));
  raw = new Array(54).fill(null);
  manual = new Array(54).fill(null);
  scanned = Object.fromEntries(FACES.map(f => [f, false]));
  scanAt = 0;
}
resetScan();

function scanMsg(text, isError) { $('scanStatus').textContent = text; $('scanStatus').className = isError ? 'error' : ''; }

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
    if (i % 9 === 4) { cap[f]--; continue; }
    if (!scanned[f]) continue;
    if (manual[i]) { state[i] = manual[i]; cap[manual[i]]--; }
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
  renderScan();
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

SCAN.forEach((s, k) => {
  const li = document.createElement('li'), b = document.createElement('button');
  b.innerHTML = `<i data-c="${s.f}"></i>${NAMES[s.f]}`;
  b.onclick = () => { scanAt = k; scanMsg(''); renderScan(); };
  li.appendChild(b); $('steps').appendChild(li);
});

function renderScan() {
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
    const mini = Array.from({ length: 9 }, (_, i) => i === 4 ? `<b data-c="${s.f}"></b>` : '<b></b>').join('');
    $('hint').innerHTML = `<i class="top" data-c="${s.top}"></i><i class="left" data-c="${s.left}"></i><div class="mini">${mini}</div>`;
    $('scanNo').textContent = `Foto ${scanAt + 1} van 6: kant met ${NAMES[s.f].toLowerCase()} midden`;
    $('scanTxt').textContent = s.text;
    $('scanSub').textContent = `Op het scherm zit ${NAMES[s.top].toLowerCase()} boven en ${NAMES[s.left].toLowerCase()} links, net als in het plaatje. Laat de kant het vierkant vullen, met elk vakje in een hokje.`;
  }
  $('snapBtn').disabled = !stream || allDone;
}

/*Koppeling met script.js*/
onEdit = idx => { manual[idx] = state[idx]; };
onRender = renderScan;
onSolved = stopCamera;
onReset = () => { resetScan(); scanMsg(''); };

render();

