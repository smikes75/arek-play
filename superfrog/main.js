// Prezentační verze (level 1, web kitu): disketa z File API (volitelně IndexedDB se souhlasem), ověření a rozšifrování zapečetěných souborů
// klíčem z obsahu diskety (wb-seal.js), engine ve workeru se zprávami místo SharedArrayBuffer, menu jen Display, konec levelu = ABOUT.
// Zobrazení (obraz.js, scene.js) je stejné jako ve web/: snímky a balíčky scény se kopírují do obyčejných bufferů se stejným rozložením.
import { Display, ENH_MX } from './obraz.js';
import { SceneRenderer, PK_SIZE, SLOTS, MAP_BYTES } from './scene.js';

const $ = id => document.getElementById(id);
const W = 716, H = 285, ADF_SIZE = 901120;
const gameEl = document.querySelector('.game');
const disp = new Display(gameEl, { storageKey: 'sf-present-display' });
window.obraz = disp;
window.wbObrazTest = {                                   // háčky `arek web test URL` (kontrakt 1.3, popis v hlavičce wb-obraz.js)
  set(mode, cfg) {
    disp.testFill = null;
    disp.set(mode, { zoom: cfg.zoom > 0 ? cfg.zoom : 'fit', detail: cfg.crtDetail || disp.cur.detail, shape: cfg.crtShape || 'lines', crt: cfg.crt !== false, blur: cfg.blur || 0 });
    const i = disp.info, dpr = disp.dpr, r = disp.canvas.getBoundingClientRect(), l = disp.crt.getBoundingClientRect();
    return { scale: i.scale, W: Math.round(i.W), H: Math.round(i.H), P: i.crtP, D: i.crtD, origin: [r.left * dpr, r.top * dpr], backing: [i.backing.w, i.backing.h], content: [i.content.w, i.content.h],
             crtLayer: [disp.crt.width, disp.crt.height], crtOrigin: [l.left * dpr, l.top * dpr] };
  },
  fill(kind) { disp.testFill = kind; disp.drawLast(); return true; },
};
// Vylepšeno = rozšířený výřez + plynulý pohyb (prolínání palety, mezipolohy spritů) natvrdo; Originál bez plynulého zobrazení
for (const [m, v] of [['original', { smooth: false, blend: false }], ['enhanced', { smooth: true, palfade: true, sprmid: true, blend: false }]]) Object.assign(disp.cfg[m], v);

// stav jako ve web/main.js (indexy ctl): tady obyčejné buffery, worker dostává kopii ctl zprávou
const ctl = new Int32Array(16);
const frame = new Uint8Array(W * H * 3), enhFrame = new Uint8Array((336 + 2 * ENH_MX) * (262 + 32) * 3);
const sceneBuf = new ArrayBuffer(PK_SIZE * SLOTS), mapBuf = new ArrayBuffer(MAP_BYTES), sceneU8 = new Uint8Array(sceneBuf), mapU8 = new Uint8Array(mapBuf);
disp.scene = new SceneRenderer(sceneBuf, mapBuf, ctl);
// testy (present/TESTS.md): čítač snímků ctl[0], přehrání záznamu od začátku levelu
window.presentTest = { ctl, play(text) { window.__play = text.split('\n'); }, about: () => showAbout(),
  smooth(on) { disp.cfg.enhanced.smooth = on; },   // snímky do galerie: Vylepšeno bez mezipoloh = přesně snímek hry
  redraw() { const ew = disp.wideHud() && ctl[6] === ENH_MX; disp.hudWide = ew; disp.present(frame, ew ? enhFrame : null); } };   // po pauze (P): poslední snímek znovu v aktuálním režimu (Originál i Vylepšeno ze stejného tiku)

let disk = null, diskName = '', box = null, manifest = null, running = false, worker = null, menuPause = false, manualPause = false, muted = false;
const shell = new WbMenu.Shell($('shell'), {
  suspend: () => { if (running) { menuPause = true; keys = 0; ctl[1] = 0; sendCtl(); } },
  restore: () => { menuPause = false; sendCtl(); if (running) $('screen').focus({ preventScroll: true }); },
});
const note = (t, err) => shell.message(t, err);
const setStatus = t => { $('status').textContent = t; };
let lastSent = '';
function sendCtl() { ctl[4] = (menuPause || overlayOpen() ? 1 : 0) | (manualPause ? 2 : 0); const k = ctl.join(); if (worker && k !== lastSent) { lastSent = k; worker.postMessage({ ctl: ctl.slice() }); } }
const overlayOpen = () => !$('help').hidden || !$('about').hidden;

// --- disketa: jen v prohlížeči; uložení do IndexedDB jen se souhlasem ---
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('superfrog-present', 1); r.onupgradeneeded = () => r.result.createObjectStore('disks'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbOp = async (mode, fn) => { try { const db = await idb(); return await new Promise((res, rej) => { const t = db.transaction('disks', mode), r = fn(t.objectStore('disks')); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); } catch (e) { return null; } };
const remember = () => { try { return localStorage.getItem('sf-present-remember') === '1'; } catch (e) { return false; } };
async function getManifest() { if (!manifest) manifest = await (await fetch('sealed/seal.json')).json(); return manifest; }
function renderDisk(msg, bad) {
  $('disks').innerHTML = `<li><span>Disk 1</span><span class="${disk ? 'disk-ok' : 'disk-bad'}">${disk ? 'verified: ' + diskName : 'missing'}</span></li>`;
  $('start').disabled = !disk || running;
  $('intro-status').innerHTML = msg || ''; $('intro-status').className = bad ? 'unknown' : '';
  if (!running) setStatus(disk ? 'Disk 1 verified. Press Play level 1.' : 'Insert disk 1.');
}
async function useDisk(bytes, name, fromStore = false) {
  if (bytes.length !== ADF_SIZE) { renderDisk(`${esc(name)}: not an Amiga disk image (${bytes.length} bytes, an ADF has ${ADF_SIZE}).`, true); return false; }
  const [id] = await WBSEAL.ids([bytes]);
  try { box = await WBSEAL.open(await getManifest(), [bytes]); }
  catch (e) {
    const known = (await getManifest()).keys.map(k => `<br>· ${esc(k.label || 'disk 1')}, sha256 <code>${k.disks.join(', ')}</code>`).join('');   // popisky z seal.json (--label)
    renderDisk(`<b>Unknown disk:</b> ${esc(name)}<br>sha256 <code>${id}</code><br>This page knows only these versions of Superfrog disk 1 (more will be added once verified):${known}`, true);
    return false;
  }
  disk = bytes; diskName = name; renderDisk(fromStore ? 'Disk loaded from this device.' : '');
  if (remember() && !fromStore) idbOp('readwrite', st => st.put(bytes, 'disk1'));
  return true;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function addFiles(files) { if (files[0]) await useDisk(new Uint8Array(await files[0].arrayBuffer()), files[0].name); }
$('files').addEventListener('change', e => addFiles(e.target.files));
const intro = $('intro');
for (const t of [intro, document.body]) {
  t.addEventListener('dragover', e => { e.preventDefault(); intro.classList.add('dragover'); });
  t.addEventListener('dragleave', () => intro.classList.remove('dragover'));
  t.addEventListener('drop', e => { e.preventDefault(); intro.classList.remove('dragover'); if (!running) addFiles(e.dataTransfer.files); });
}
$('remember').checked = remember();
$('remember').onchange = e => { try { localStorage.setItem('sf-present-remember', e.target.checked ? '1' : '0'); } catch (err) {} if (e.target.checked && disk) idbOp('readwrite', st => st.put(disk, 'disk1')); if (!e.target.checked) idbOp('readwrite', st => st.clear()); };
renderDisk();
(async () => { if (!remember()) return; const d = await idbOp('readonly', st => st.get('disk1')); if (d) await useDisk(new Uint8Array(d), 'saved disk', true); })();

// --- klávesy ---
const KEYS = { ArrowUp: 1, ArrowDown: 2, ArrowLeft: 4, ArrowRight: 8, KeyX: 16, Space: 32 };
let keys = 0; const downAt = {};
function key(e, down) {
  const b = KEYS[e.code]; if (!b || !running || shell.busy || overlayOpen()) return;
  e.preventDefault();
  if (down) { downAt[b] = performance.now(); keys |= b; ctl[1] = keys; sendCtl(); return; }
  const wait = Math.max(0, 60 - (performance.now() - (downAt[b] || 0)));   // stisk drží aspoň 60 ms (dva snímky)
  setTimeout(() => { keys &= ~b; ctl[1] = keys; sendCtl(); }, wait);
}
addEventListener('keydown', e => key(e, true)); addEventListener('keyup', e => key(e, false));
addEventListener('blur', () => { keys = 0; ctl[1] = 0; sendCtl(); });

// --- zvuk: AudioWorklet s frontou; vzorky z workeru přes MessageChannel ---
let audioCtx = null, audioNode = null;
async function startAudio(port) {
  try {
    if (!audioCtx) { audioCtx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' }); await audioCtx.audioWorklet.addModule('audio-worklet.js'); }
    if (audioNode) audioNode.disconnect();
    audioNode = new AudioWorkletNode(audioCtx, 'paula-out', { outputChannelCount: [2] });
    audioNode.port.postMessage({ port }, [port]); audioNode.port.postMessage({ vol: muted ? 0 : 0.8 }); audioNode.connect(audioCtx.destination);
    if (audioCtx.state !== 'running') await audioCtx.resume();
  } catch (e) { console.warn('audio', e); }
}
['pointerdown', 'keydown'].forEach(t => addEventListener(t, () => { if (audioCtx && audioCtx.state !== 'running') audioCtx.resume(); }));
function toggleMute() { muted = !muted; if (audioNode) audioNode.port.postMessage({ vol: muted ? 0 : 0.8 }); note(muted ? 'Sound off (M)' : 'Sound on (M)'); }

// --- spuštění: rozšifrovat engine.wasm (gzip) a loader.js, worker, vykreslování ---
let files = null, drawing = false;
async function start() {
  if (running || !disk) return;
  running = true; renderDisk(); setStatus('Opening the sealed engine with your disk…');
  try {
    if (!files) files = { wasm: await box.fetch('engine.wasm', 'sealed/'), loader: new TextDecoder().decode(await box.fetch('loader.js', 'sealed/')) };   // --gzip: wb-seal.js rozbalí sám
  } catch (e) { running = false; renderDisk('Could not open the sealed files with this disk: ' + esc(e.message), true); return; }
  intro.hidden = true; gameEl.hidden = false; $('loading').hidden = false; disp.layout(); syncUi(); $('screen').focus({ preventScroll: true });
  boot();
}
function boot() {
  if (worker) worker.terminate();
  worker = new Worker('worker.js', { type: 'module' }); lastSent = '';
  let atlasGen = 0, seq = 0;
  worker.onmessage = e => {
    const d = e.data;
    if (d.f) {                                             // snímek hry: kopie do bufferů, které čte obraz.js / scene.js
      frame.set(new Uint8Array(d.frame)); ctl[6] = d.mx; if (d.enh) enhFrame.set(new Uint8Array(d.enh));
      if (d.tiles) { const ids = new Uint16Array(d.tiles), data = new Uint8Array(d.tileData); ids.forEach((t, i) => mapU8.set(data.subarray(i * 256, (i + 1) * 256), t * 256)); atlasGen = d.mapgen; ctl[9] = atlasGen; }
      if (d.scn) { seq = d.seq; const slot = (seq % SLOTS) * PK_SIZE; sceneU8.set(new Uint8Array(d.scn), slot); new Float64Array(sceneBuf, slot + 48, 1)[0] = d.ts; ctl[8] = seq; }
      ctl[0]++;
    }
    if (d.loading !== undefined) { $('loading').hidden = !d.loading; setStatus(d.loading ? 'Loading Magic Woods…' : 'Level 1 · Magic Woods'); }
    if (d.end === 'level') { window.__end = d; showAbout(); }
    if (d.end === 'gameover') { window.__gameover = d; note('Game over: back to the start of level 1'); setTimeout(() => restart(), 1500); }
    if (d.status) setStatus(d.status);
  };
  ctl[7] = 1; ctl[1] = 0; keys = 0;                        // rovnou do levelu 1 (titulka a menu bez obrazu, fire automaticky)
  const ch = new MessageChannel();
  worker.postMessage({ start: { wasm: files.wasm.slice(0), loader: files.loader, disks: [disk], audioPort: ch.port2 } }, [ch.port2]);
  startAudio(ch.port1);
  if (window.__play) worker.postMessage({ play: window.__play });
  sendCtl();
  if (drawing) return; drawing = true;
  let last = 0;
  (function draw() {
    ctl[5] = disp.wantEnh() ? ENH_MX : 0; ctl[10] = disp.wantScene() ? 1 : 0; ctl[11] = disp.view === 'wide' && disp.wantScene() ? 4 : 0;   // jako web/main.js
    sendCtl();
    const n = ctl[0];
    if (n !== last) { last = n; const ew = disp.wideHud() && ctl[6] === ENH_MX; disp.hudWide = ew; disp.present(frame, ew ? enhFrame : null); }
    else disp.tick(performance.now());
    requestAnimationFrame(draw);
  })();
}
function restart() { $('about').hidden = true; ctl[0] = 0; $('loading').hidden = false; boot(); sendCtl(); }
$('start').addEventListener('click', start);
$('again').addEventListener('click', () => { restart(); $('screen').focus({ preventScroll: true }); });

// --- ABOUT (present/ABOUT.md, malý převod Markdownu) ---
async function showAbout() {
  if (!$('about-text').innerHTML) {
    const md = await (await fetch('ABOUT.md')).text();
    const inl = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/\[(.+?)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    let html = '', list = false;
    for (const block of md.split(/\n\s*\n/)) {
      const lines = block.trim().split('\n'); if (!lines[0]) continue;
      if (/^# /.test(lines[0])) continue;                       // titulek okna je v HTML
      if (/^## /.test(lines[0])) { html += `<h2>${inl(lines[0].slice(3))}</h2>`; lines.shift(); if (!lines.length) continue; }
      if (lines.every(l => /^[-*] /.test(l))) html += '<ul>' + lines.map(l => `<li>${inl(l.slice(2))}</li>`).join('') + '</ul>';
      else html += `<p${/^_/.test(lines[0]) ? ' class="foot"' : ''}>${inl(lines.join(' ').replace(/^_|_$/g, ''))}</p>`;
    }
    $('about-text').innerHTML = html;
  }
  $('about').hidden = false; sendCtl(); $('again').focus();
}

// --- Display menu ---
function syncUi() {
  const c = disp.cur, m = disp.mode;
  $('mode-original').setAttribute('aria-pressed', String(m === 'original')); $('mode-enhanced').setAttribute('aria-pressed', String(m === 'enhanced'));
  document.querySelectorAll('[data-zoom]').forEach(b => b.setAttribute('aria-pressed', String(String(c.zoom) === b.dataset.zoom)));
  const i = disp.info, eff = i.scale ? i.scale / i.dpr * i.W / 336 : 0;
  $('zoom-value').textContent = c.zoom === 'fit' ? `fit · ${eff.toFixed(2).replace(/\.?0+$/, '')}×` : (Math.abs(eff - c.zoom) > 0.01 ? `${c.zoom}× · limited to ${eff.toFixed(2).replace(/\.?0+$/, '')}×` : `${c.zoom}×`);
  $('crt').checked = c.crt; $('crt-detail').value = c.detail; $('crt-shape').value = c.shape || 'lines';
  $('blur').value = c.blur; $('blur-value').textContent = Math.round(c.blur) + ' %';
  $('run-state').textContent = m === 'original' ? 'Original' : 'Enhanced';
  $('display-status').textContent = i.backing ? `Canvas ${i.backing.w}×${i.backing.h} device px, ×${i.scale} per game pixel` : '';
}
const apply = patch => { disp.set(null, patch); syncUi(); };
const mode = to => { disp.switchMode(to); setTimeout(syncUi, 500); };
$('mode-original').onclick = () => mode('original'); $('mode-enhanced').onclick = () => mode('enhanced');
document.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => apply({ zoom: b.dataset.zoom === 'fit' ? 'fit' : parseFloat(b.dataset.zoom) })));
$('crt').onchange = e => apply({ crt: e.target.checked });
$('crt-detail').onchange = e => apply({ detail: e.target.value });
$('crt-shape').onchange = e => apply({ shape: e.target.value });
$('blur').oninput = e => apply({ blur: +e.target.value });
function fullscreen() { if (document.fullscreenElement) document.exitFullscreen(); else $('shell').requestFullscreen?.().catch(() => {}); }
$('fullscreen').addEventListener('click', fullscreen);
document.addEventListener('fullscreenchange', () => { disp.layout(); syncUi(); });
const help = show => { $('help').hidden = !show; sendCtl(); };
$('help-btn').onclick = () => help($('help').hidden);
document.querySelectorAll('[data-close-overlay]').forEach(b => b.onclick = () => { help(false); $('screen').focus({ preventScroll: true }); });
addEventListener('keydown', e => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || shell.busy || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '') && document.activeElement.type === 'file') return;
  if (e.code === 'Escape' && !$('help').hidden) { help(false); return; }
  if (!$('about').hidden) return;
  if (e.code === 'KeyE') { disp.toggleMode(); setTimeout(syncUi, 500); }
  else if (e.code === 'KeyF') fullscreen();
  else if (e.code === 'KeyH') help($('help').hidden);
  else if (e.code === 'KeyM') toggleMute();
  else if (e.code === 'KeyP' && running) { manualPause = !manualPause; sendCtl(); note(manualPause ? 'Paused (P)' : 'Running'); }
});
addEventListener('resize', () => { disp.layout(); syncUi(); });
disp.layout(); syncUi();
if (/obraz-test/.test(location.search)) { intro.hidden = true; gameEl.hidden = false; disp.layout(); syncUi(); }   // test obrazu (arek web test) bez hry
