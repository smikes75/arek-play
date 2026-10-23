// Prezentační worker (bez SharedArrayBuffer, GitHub Pages): engine.wasm sestavený s ASYNCIFY, js_present je asynchronní – mezi snímky
// se vrací do smyčky událostí (zprávy z hlavního vlákna, čekání na 50 Hz časovačem). Snímek, výřez Vylepšeno, balíček scény a změněné
// dlaždice atlasu jdou do hlavního vlákna zprávou (přenos bufferů), zvuk rovnou do AudioWorkletu přes MessagePort.
// Zapečetěné soubory (engine.wasm, loader.js) rozšifruje hlavní vlákno klíčem z diskety a pošle je sem.
import EngineModule from './engine.js';

const W = 716, H = 285, FRAME_MS = 20;
const PK = 448 + 336 * 262 * 5 + 512 * 343 * 2 + 64 * 12 + 128 * 304 * 2;   // = PK_SIZE ve web/scene.js a engine/scene.c
const ctl = new Int32Array(16);   // stejné indexy jako web/main.js: 1 vstup, 4 pauza, 5 okraj Vylepšeno, 7 přeskočit úvod, 10 scéna, 11 aktivace objektů
let started = false, play = null, playN = 0, wake = null;
const post = (m, t) => self.postMessage(m, t || []);
self.onmessage = e => {
  const d = e.data;
  if (d.ctl) { ctl.set(d.ctl); if (wake && !ctl[4]) { const w = wake; wake = null; w(); } }
  if (d.play) play = d.play;                                       // test: záznam vstupů od začátku levelu (řádek = snímek, R L U D F S, A0..A8)
  if (d.start && !started) { started = true; run(d.start).catch(err => post({ status: 'Error: ' + (err && err.message || err) })); }
};

async function run({ wasm, loader, disks, audioPort }) {
  const { buildProgramImage } = await import(URL.createObjectURL(new Blob([loader], { type: 'text/javascript' })));
  const image = buildProgramImage(disks[0]);
  let next = performance.now(), count = 0, seq = 0, mapgen = 0, sceneOn = 0, lastAct = 0, lastMx = 0, loading = true, disk0 = -1, ended = false;
  const mask = { R: 8, L: 4, U: 1, D: 2, F: 16, S: 32 };
  const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
  const Module = await EngineModule({
    instantiateWasm: (imports, done) => { WebAssembly.instantiate(wasm, imports).then(r => done(r.instance, r.module)); return {}; },   // rozšifrovaný engine.wasm (glue nečte wasmBinary)
    hostPresent: async ptr => {
      const lt = Module._wasm_level_ticks();
      if (lt >= 0 && loading) { loading = false; post({ loading: false }); next = performance.now(); disk0 = Module._wasm_disk_n(); }
      if (lt < 0) { if (++count % 64 === 0) await sleep(0); return; }   // úvod (titulka, menu, nahrávání) bez čekání a bez obrazu; občas zprávy
      // konec levelu 1: první přístup k disketě po začátku levelu (během hraní levelu žádný, změřeno); životy $C017CE < 0 = game over
      if (!ended && Module._wasm_disk_n() > disk0) {
        const m = Module.HEAPU8, a = Module._wasm_mem() + 0xc017ce, lives = (m[a] << 24 >> 16) | m[a + 1];
        ended = true; post({ end: lives < 0 ? 'gameover' : 'level', ticks: lt });
        await new Promise(() => {});                                  // stojí; hlavní vlákno worker ukončí
      }
      count++;
      const frame = Module.HEAPU8.slice(ptr, ptr + W * H * 3).buffer, msg = { f: 1, frame, ts: performance.timeOrigin + next, steps: Module._wasm_steps() }, tr = [frame];
      const mx = Module._wasm_enh_mx(); msg.mx = mx;
      if (mx > 0) { const p = Module._wasm_enh_fb(), b = Module.HEAPU8.slice(p, p + (336 + 2 * mx) * (262 + 32) * 3).buffer; msg.enh = b; tr.push(b); }
      if (sceneOn) {
        const p = Module._wasm_scene_packet(), hd = new Uint32Array(Module.HEAPU8.buffer, p, 16);
        if (hd[0] === 1) {
          if (hd[3] !== mapgen) {                                    // atlas: jen dlaždice se změněnou grafikou
            const g = new Uint32Array(Module.HEAPU8.buffer, Module._wasm_scene_row_gens(), 1024), mp = Module._wasm_scene_map(), ids = [];
            for (let t = 0; t < 1024; t++) if (g[t] > mapgen) ids.push(t);
            const data = new Uint8Array(ids.length * 256); ids.forEach((t, i) => data.set(Module.HEAPU8.subarray(mp + t * 256, mp + (t + 1) * 256), i * 256));
            msg.tiles = new Uint16Array(ids).buffer; msg.tileData = data.buffer; tr.push(msg.tiles, msg.tileData); mapgen = hd[3]; msg.mapgen = mapgen;
          }
          msg.scn = Module.HEAPU8.slice(p, p + PK).buffer;
        } else msg.scn = Module.HEAPU8.slice(p, p + 64).buffer;          // neplatný: jen hlavička (důvod v [7])
        tr.push(msg.scn); msg.seq = ++seq;
      }
      post(msg, tr);
      { const ap = Module._wasm_audio(), pcm = Module.HEAPU8.slice(ap, ap + 960 * 4).buffer; audioPort.postMessage(pcm, [pcm]); }   // 960 stereo int16 (48 kHz)
      while (ctl[4]) { await new Promise(r => { wake = r; }); next = performance.now(); }   // pauza (menu, klávesa P)
      next += FRAME_MS; const now = performance.now();
      if (next < now - 200) next = now;
      await sleep(next - now);
    },
    hostInput: () => {
      if (ctl[11] !== lastAct && !play) { Module._wasm_set_act(ctl[11]); lastAct = ctl[11]; }
      if (ctl[10] !== sceneOn) { Module._wasm_scene_on(ctl[10]); sceneOn = ctl[10]; }
      if (ctl[5] !== lastMx) { Module._wasm_set_enh(ctl[5]); lastMx = ctl[5]; }
      const lt = Module._wasm_level_ticks();
      let raw = ctl[1];
      if (play && lt >= 0) {                                         // přehrávání záznamu (test průchodu levelem): řádek = n-té volání od začátku levelu, jako nahrávač ve web/worker.js
        const s = play[playN++] || ''; const a = /A(\d)/.exec(s); if (a) { lastAct = +a[1]; Module._wasm_set_act(lastAct); }
        raw = 0; for (const ch of s.replace(/A\d/, '')) raw |= mask[ch] || 0;
      }
      let fire = (raw & 48) ? 16 : 0;
      if (lt < 0 && ((count >= 1000 && count < 1006) || (count >= 1150 && count < 1156))) fire = 16;   // titulka a menu: fire (jako ENG_INPUT v nativních testech)
      return (raw & 15) | fire;
    },
  });
  const mem = Module._wasm_mem();
  Module.HEAPU8.set(image.chipRam, mem);
  Module.HEAPU8.set(image.slowRam, mem + 0xc00000);
  disks.forEach((dk, i) => { if (dk) { const p = Module._wasm_disk_buffer(i, dk.length); Module.HEAPU8.set(dk, p); } });
  post({ loading: true });
  Module._wasm_start();
}
