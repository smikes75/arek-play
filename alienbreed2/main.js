// main.js - Alien Breed II, level 1 v prohlížeči: lišta Workbench, menu Obraz/Zvuk z kitu (wb-nastaveni.js), obraz podle kontraktu
// (wb-obraz.js 1.5, prezentér WebGL), zvuk podle kontraktu (wb-zvuk.js 1.1), pečeť (wb-seal.js), přeložená hra (engine.js/wasm). Rozhraní jako Superfrog a
// Alien Breed (lišta, menu, výchozí hodnoty po režimech, přechod E 450 ms). Žádná herní data v kódu.
'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const O = WBOBRAZ;
  const H0 = 261, W0 = 330;                               // okno DIW hry $287B-$2DC5 (lowres): Originál
  // Vylepšeno: širší výhled z mapy levelu, 96 bodů do stran a 48 řádků nahoru i dolů (HUD se posune ven) = 522 × 357, nejvíc
  // co engine dovolí (±96 × ±48); výchozí podle zadavatele (2026-10-28, dřív 512 × 319). Nepřátelé vznikají za okrajem
  // (aktivace o 7 dlaždic dál, actSync), takže se v širším obraze neobjevují uprostřed.
  const EXT = { original: [0, 0], enhanced: [96, 48] };
  const widthOf = (mode) => W0 + 2 * EXT[mode][0], heightOf = (mode) => H0 + 2 * EXT[mode][1];
  // výřez teď: v přechodu Originál <-> Vylepšeno se rozšíření mění plynule (jako Alien Breed), jinak podle režimu
  // extF = plynulé rozšíření (zlomky bodu, velikost okna v přechodu), extNow = celé body pro engine (zaokrouhleno nahoru, ořez pokryje)
  const extF = () => { if (!disp.anim) return EXT[modeOf()]; const a = EXT[disp.anim.from], b = EXT[disp.anim.to], e = disp.anim.e;
    return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e]; };
  const extNow = () => { const f = extF(); return disp.anim ? [Math.ceil(f[0] - 1e-6), Math.ceil(f[1] - 1e-6)] : f; };
  const curW = () => W0 + 2 * extNow()[0], curH = () => H0 + 2 * extNow()[1];
  // Vylepšeno: hra vytváří a ruší objekty o n dlaždic dál (tools/patch_act.py), aby nepřátelé vznikali za okrajem výhledu;
  // n = ⌈(rozšíření + 16) / 16⌉ (512 px: 7). Originál n = 0 = hra beze změny.
  const actSync = () => { if (M && M._engine_act_ext) M._engine_act_ext(disp.mode === 'enhanced' ? Math.ceil((EXT.enhanced[0] + 16) / 16) : 0); };
  const FPS = 3546895 / (227 * 313);                      // PAL, dlouhé snímky 313 řádků: 49,92 Hz
  const MENU_STORE = 'abii-wb-menu-v1', DISK_DB = 'abii-disks';

  // ---------------------------------------------------------------- obraz
  const game = document.querySelector('.game'), screen = $('screen'), stage = $('stage');
  const scr = new O.Screen(game, screen);
  // wb-obraz 1.5: plátno hry vlastní prezentér kitu - WebGL2 (jedno plátno, filtry §3 v shaderu, hrací plocha z gl.js přímo do
  // jeho framebufferu, žádná kopie WebGL -> 2D plátno, která v Safari čekala na grafickou kartu, G31), nebo 2D cesta jako dosud
  // (bez WebGL2; ?gl=0 / ?gl=1 pro test kontraktu obou cest)
  const QS = new URLSearchParams(location.search), GLQ = QS.get('gl');
  // terén na GPU (atlas dlaždic + mřížka, view.h VW_SPLIT 2); ?gt=0 = terén skládá engine jako dřív (srovnání)
  const GTQ = QS.get('gt') !== '0';
  // preserve: Safari plátno WebGL s preserveDrawingBuffer false po zobrazení zahodí - změna CSS velikosti / polohy bez nového kreslení
  // (přechod E/O mění CSS každý snímek) pak ukázala prázdné plátno = problikávání (jen Safari, ?gl=0 ne; hlášení zadavatele)
  let PR; try { PR = new O.Presenter(screen, { gl: GLQ === '0' ? 'off' : GLQ === '1' ? 'on' : 'auto', preserve: true }); } catch (e) { PR = new O.Presenter(screen, { gl: 'off' }); }
  // obrázek na režim (celý obraz W × H) a vrstva hrací plochy pro posun o necelý bod (view.h); tmp = vodorovné převzorkování vrstvy
  const pics = {};
  const canvasPic = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); return { c, g, img: g.createImageData(w, h) }; };
  for (const m of ['original', 'enhanced']) pics[m] = canvasPic(widthOf(m), heightOf(m));
  pics.anim = canvasPic(W0, H0);                              // přechod: velikost podle extNow()
  let layer = canvasPic(1, 1); const bandTmp = document.createElement('canvas');
  const sub = { on: false, gl: false, fx: 0, fy: 0, band: 0, lh: 0 };
  // objekty a sprity přes WebGL (gl.js) po necelých bodech; bez WebGL2 nebo s vypnutou volbou skládá engine (view.h) jako dřív
  // objekty a sprity přes WebGL v kontextu prezentéru; vypnuto (Ladění, pojistka) = skládá engine, na plátno jde přes týž prezentér
  const glv = { on: PR.gl && typeof GL !== 'undefined' && GL.attach(PR.g), want: true };
  // Safari (WebKit): dřív (56b809a) ve výchozím stavu bez WebGL - kopie WebGL plátna do 2D plátna čekala na grafickou kartu; s
  // prezentérem kopie není, WebGL je výchozí všude; ruční volba v Ladění platí dál (uložená volba má přednost), pojistka zůstává
  const WEBKIT = navigator.vendor === 'Apple Computer, Inc.';
  try { const v = localStorage.getItem('abii-gl'); glv.want = v === null ? true : v !== '0'; } catch (e) { glv.want = true; }
  // pojistka: když s WebGL během hry opakovaně vypadávají snímky (dvě okna po 5 s s více než 5 % snímků displeje přes 1,5×
  // periodu), stránka WebGL pro tento běh vypne a zapíše to do logu (jen jednou; ruční zapnutí v Ladění pojistku vypne)
  const glGuard = { last: 0, n: 0, late: 0, t0: 0, bad: 0, done: false };
  function glGuardStep(ts, active) {
    const g = glGuard, d = ts - g.last; g.last = ts;
    if (g.done || !active || !(d > 0 && d < 500)) { g.t0 = ts; g.n = g.late = 0; return; }
    const per = vs.hz ? 1000 / vs.hz : 16.7; g.n++; if (d > 1.5 * per) g.late++;
    if (ts - g.t0 < 5000) return;
    g.bad = g.late > 0.05 * g.n ? g.bad + 1 : 0; const n = g.n, late = g.late; g.t0 = ts; g.n = g.late = 0;
    if (g.bad >= 2) { g.done = true; glv.want = false; const cb = $('gl-on'); if (cb) cb.checked = false;
      log('WebGL off by the safeguard: frames were dropped (' + late + ' of ' + n + ' in 5 s), the CPU composes the picture'); }
  }
  const disp = { mode: 'original', S: 1, testFill: null, test: null, anim: null, label: '', lut: null, lutKey: '' };
  const dprNow = () => window.devicePixelRatio || 1;
  function avail() {
    const cs = getComputedStyle(stage);
    return [stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)];
  }
  const limit = (par, W = curW(), H = curH()) => { const [aw, ah] = avail(); return Math.min(aw / (W * par), ah / H); };
  const lerp = (a, b, e) => a + (b - a) * e;
  // nastavení obrazu pro kreslení: test kontraktu > přechod režimu (prolínání) > menu kitu
  function cur() {
    if (disp.test) return disp.test;
    const m = (mode) => menu.getMode(mode, 'display');
    if (!disp.anim) return Object.assign({ crtOn: m(disp.mode).crt ? 1 : 0 }, m(disp.mode));
    const a = m(disp.anim.from), b = m(disp.anim.to), e = disp.anim.e, pick = e < 0.5 ? a : b, c = Object.assign({}, pick);
    for (const k of ['blur', 'brightness', 'contrast', 'saturation', 'par']) c[k] = lerp(a[k], b[k], e);
    c.crtOn = O.crtOn(e, a.crt ? 1 : 0, b.crt ? 1 : 0);
    c.crt = c.crtOn > 0;
    return c;
  }
  const modeOf = () => (disp.anim ? (disp.anim.e < 0.5 ? disp.anim.from : disp.anim.to) : disp.mode);
  function layout() {
    const dpr = dprNow(), c = cur(), par = c.par > 0 ? c.par : 1, W = curW(), H = curH();
    disp.S = disp.anim && disp.anim.S ? disp.anim.S : O.deviceScale(c.zoom, W0, W, dpr, limit(par, W, H), par);   // v přechodu stálé měřítko
    const [fx, fy] = extF(), Wf = W0 + 2 * fx, Hf = H0 + 2 * fy;   // v přechodu plynulý výřez (jako Alien Breed: zlomky bodu)
    let [cw, ch] = disp.anim ? [Math.ceil(Wf * disp.S * par - 1e-6), Math.ceil(Hf * disp.S - 1e-6)] : O.contentSize(W, H, disp.S, par), bw = O.padded(cw, dpr), bh = O.padded(ch, dpr);
    // WebGL: v přechodu režimů plátno jednou ve větším z obou výhledů (Safari: přealokace plátna a textur prezentéru v každém
    // snímku přechodu - až 12 MB na texturu - problikávala, hlášení zadavatele 2026-10-29); výřez Wf × Hf se kreslí doprostřed
    // (paintGL, černý okraj = pozadí stránky), posun po pixelech zařízení
    if (PR.gl) {
      const Wa = disp.anim ? Math.max(widthOf(disp.anim.from), widthOf(disp.anim.to)) : W, Ha = disp.anim ? Math.max(heightOf(disp.anim.from), heightOf(disp.anim.to)) : H;
      // šířka bodu se v přechodu prolíná (Originál 1,04 / Vylepšeno 1): plátno se šířkou bodu cílového režimu, zbytek měřítkem CSS
      const pT = disp.anim ? (menu.getMode(disp.anim.to, 'display').par > 0 ? menu.getMode(disp.anim.to, 'display').par : 1) : par;
      const z = PR.size(Wa, Ha, disp.S, pT, dpr); [bw, bh] = z.backing; [cw, ch] = z.content;
      disp.win = disp.anim ? { Wa, Ha, W, H, Wf, Hf, parK: par / pT } : null;
    }
    else if (screen.width !== bw || screen.height !== bh) { screen.width = bw; screen.height = bh; }
    // přechod (jako Alien Breed): backing ve větším S obou režimů, zobrazená velikost bodu z = S/dpr se plynule mění z výchozího
    // do cílového režimu, takže okno hry roste nebo se zmenšuje jedním směrem (dřív stálé S: výřez narostl a na konci splaskl)
    const k = disp.anim && disp.anim.sF ? lerp(disp.anim.sF, disp.anim.sT, disp.anim.e) / disp.S : 1;
    const ew = disp.anim && !PR.gl ? Wf * disp.S * par - cw : 0, eh = disp.anim && !PR.gl ? Hf * disp.S - ch : 0;   // CSS přesně podle zlomkového výřezu
    screen.style.width = (bw + ew) / dpr * k * (disp.win ? disp.win.parK : 1) + 'px'; screen.style.height = (bh + eh) / dpr * k + 'px';
    const lk = { blur: c.blur, brightness: c.brightness, contrast: c.contrast, saturation: c.saturation };
    if (PR.gl) { screen.style.filter = ''; PR.look(lk); }   // §3 v shaderu prezentéru
    else screen.style.filter = O.filter(lk, disp.S / dpr * k);
    paint();
    const pd = scr.crt({ mode: modeOf(), detail: c['crt-detail'], shape: c['crt-shape'], S: disp.hd && disp.hd.lace ? disp.S / 2 : disp.S, dpr, w: bw, h: bh, on: c.crtOn !== undefined ? c.crtOn : (c.crt ? 1 : 0) });
    { const pk = disp.win ? disp.win.parK : 1; if (k !== 1 || pk !== 1 || scr.layer.style.width !== bw / dpr + 'px') { scr.layer.style.width = (bw + ew) / dpr * k * pk + 'px'; scr.layer.style.height = (bh + eh) / dpr * k + 'px'; } }
    scr.align();
    disp.label = O.zoomLabel(c.zoom, disp.S, dpr, W0, W, { fit: 'fit to window', limited: 'limited to', actual: 'actual' }, par);
    $('zoom-value').textContent = disp.label;
    $('display-status').textContent = 'canvas ' + bw + ' × ' + bh + ' device px, ×' + disp.S;
    return Object.assign(scr.info(), { scale: disp.S, dpr, W, H, P: pd.P, D: pd.D, par, content: [cw, ch], gl: PR.gl });
  }
  const perf = { paint: 0, view: 0, loop: 0, n: 0, ln: 0 };   // ladění (abii.perf): ms na snímek displeje
  const mon = { hook: null, paint: 0, view: 0, vr: 0, game: 0, gameMax: 0, gf: 0, passes: 0, lastPass: -1, leadSum: 0, leadN: 0, under0: 0, lt: [], sN: 0, sNoB: 0, sNoOB: 0, sExt: 0, aheadSum: 0, aheadN: 0, missTot: 0 };
  // dlouhé úlohy prohlížeče (nad 50 ms, PerformanceObserver): délka a původce (skript, vrstva) – hledání záseků mimo hru
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) mon.lt.push({ t: e.startTime, d: e.duration, who: (e.attribution || []).map((a) => a.containerType + (a.containerSrc ? ':' + a.containerSrc.split('/').pop() : '') + (a.name ? ' ' + a.name : '')).join(',') || e.name }); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}   // Ladění → Výkon (měří jen celá hra)
  function paint() { const t0 = performance.now(); paintIn(); const d = performance.now() - t0; perf.paint += d; mon.paint += d; perf.n++; }
  const animTmp = document.createElement('canvas');
  // WebGL: celý snímek enginu (HUD, záložní obraz, Originál) jako pixels, hrací plocha Vylepšeno z gl.js přes draw (pruh od
  // řádku band, necelá kamera v pixelech zařízení); tvar a filtry dělá prezentér
  let bandQ = null;
  function paintGL() {
    if (disp.testFill) { PR.fill(disp.testFill); return; }
    if (disp.anim && disp.win) { paintAnimGL(); return; }
    const P = disp.anim ? pics.anim : pics[modeOf()];
    if (P.img.width !== PR.W || P.img.height !== PR.H) return;
    if (disp.hd && pics.hd && !disp.anim) {                 // M31: plné rozlišení – polovina S, poloha okna originálu
      const S = PR.S, h = disp.hd; PR.present({ draw: (g, fbo, d) => { GL.frame(pics.hd.img, 2 * W0, 2 * H0, S / 2, fbo, d.w, d.h, h.ex * S, h.ey * S, [0, 0, d.w, d.h]); GL.noClip(); } }); return;
    }
    const q = (sub.gl || sub.on) && M && glv.on ? bandQ : null;
    PR.present({ pixels: P.img, draw: q ? (g, fbo, d) => { if (!GL.render(M, Object.assign(q, { fbo, fh: d.h }))) { glv.on = false; sub.gl = false; log('WebGL selhalo'); } } : undefined });
  }
  // přechod na WebGL: plátno má stálou velikost (větší výhled, layout); snímek přechodu W × H bodů doprostřed, okno Wf × Hf
  // (zlomky bodu -> pixely zařízení) scissorem, pruh hrací plochy se stejným posunem; mimo okno černě
  function paintAnimGL() {
    const w = disp.win, P = pics.anim, S = PR.S;
    // snímek přechodu ještě nemá novou velikost: znovu předchozí (textura v gl.js), ale kreslit v každém snímku displeje
    if (!P.valid || P.img.width !== w.W || P.img.height !== w.H) {
      // snímek přechodu pro tuto velikost ještě není: obraz výchozího režimu doprostřed nového plátna (dřív poslední snímek
      // předchozího přechodu se starou polohou – skok obrazu v Chromu i Safari při velikosti „fit“, změřeno záznamem obrazovky)
      // poslední platný snímek přechodu ve své velikosti, jinak (začátek přechodu) obraz výchozího režimu; obojí doprostřed plátna
      const F = P.valid ? P : pics[disp.anim.from], fw = F.img.width, fh = F.img.height, xf = (w.Wa - fw) / 2 * S, yf = (w.Ha - fh) / 2 * S;
      PR.present({ draw: (g, fbo, d) => { GL.frame(F.img, fw, fh, S, fbo, d.w, d.h, xf, yf, [0, 0, d.w, d.h]); GL.noClip(); } }); return;
    }
    const x0 = (w.Wa - w.W) / 2 * S, y0 = (w.Ha - w.H) / 2 * S;
    const clip = [Math.round((w.Wa - w.Wf) / 2 * S), Math.round((w.Ha - w.Hf) / 2 * S), Math.round(w.Wf * S), Math.round(w.Hf * S)];
    const q = (sub.gl || sub.on) && M && glv.on ? bandQ : null;
    disp.lastAnim = { W: w.W, H: w.H, x0, y0, clip };
    PR.present({ draw: (g, fbo, d) => { GL.frame(P.img, w.W, w.H, S, fbo, d.w, d.h, x0, y0, clip); if (q) GL.render(M, Object.assign(q, { fbo, fh: d.h, x0, y0, clip: true })); GL.noClip(); } });
  }
  function paintIn() {
    if (PR.gl) { paintGL(); return; }
    if (disp.testFill) { O.testPattern(screen, disp.testFill, curW(), curH(), disp.S, cur().par || 1); return; }
    if (!disp.anim) { paintTo(screen); return; }
    // přechod: obraz celých bodů do pomocného plátna, z něj plynule rostoucí (zmenšující se) střed W × H bodů hry se zlomky
    const W = curW(), H = curH(), par = cur().par || 1, S = disp.S, [fx, fy] = extF(), Wf = W0 + 2 * fx, Hf = H0 + 2 * fy;
    const [tw, th] = O.contentSize(W, H, S, par);
    if (animTmp.width !== tw || animTmp.height !== th) { animTmp.width = tw; animTmp.height = th; }
    paintTo(animTmp);
    const g = screen.getContext('2d'), sx = (W - Wf) / 2 * S * par, sy = (H - Hf) / 2 * S, sw = Wf * S * par, sh = Hf * S;
    g.fillStyle = '#000'; g.fillRect(0, 0, screen.width, screen.height);
    g.imageSmoothingEnabled = false; g.drawImage(animTmp, sx, sy, sw, sh, 0, 0, sw, sh);
  }
  function paintTo(cv) {
    const m = modeOf(), W = curW(), H = curH(), par = cur().par || 1, S = disp.S;
    const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    O.blit(cv, (disp.anim ? pics.anim : pics[m]).c, W, H, S, par);
    if (disp.hd && pics.hd && !disp.anim) {                 // M31: plné rozlišení přes okno originálu (2D cesta)
      const [cw, ch] = O.contentSize(W, H, S, par), kx = cw / W, ky = ch / H, h = disp.hd;
      g.imageSmoothingEnabled = par !== 1; g.drawImage(pics.hd.c, 0, 0, 2 * W0, 2 * H0, h.ex * kx, h.ey * ky, W0 * kx, H0 * ky);
    }
    // hrací plocha posunutá o necelý bod kamery: vodorovně převzorkovat se zdrojovým posunem fx, svisle po celých
    // pixelech zařízení se zdrojovým posunem fy (nejbližší soused) – krok pohybu = 1 pixel zařízení
    if (sub.on && (sub.fx || sub.fy) && layer.c.width === W + 1) {
      const cw = Math.round(W * S * par), lh = sub.lh;
      if (bandTmp.width !== cw || bandTmp.height !== lh) { bandTmp.width = cw; bandTmp.height = lh; }
      const t = bandTmp.getContext('2d'); t.imageSmoothingEnabled = par !== 1; t.imageSmoothingQuality = 'high';
      t.drawImage(layer.c, sub.fx, 0, W, lh, 0, 0, cw, lh);
      g.imageSmoothingEnabled = false; g.drawImage(bandTmp, 0, sub.fy, cw, lh - 1, 0, sub.band * S, cw, (lh - 1) * S);
    }
  }
  // kanály RGB 50–150 % (menu kitu): tabulka při kopírování snímku, žádný filtr prohlížeče (jako Superfrog / Alien Breed)
  function rgbLut() {
    const d = menu.getMode(modeOf(), 'display'), key = [d.red, d.green, d.blue].join(',');
    if (key === disp.lutKey) return disp.lut;
    disp.lutKey = key;
    if (d.red === 100 && d.green === 100 && d.blue === 100) return (disp.lut = null);
    const t = [d.red, d.green, d.blue].map((k) => Uint8Array.from({ length: 256 }, (_, v) => Math.min(255, Math.round(v * k / 100))));
    return (disp.lut = t);
  }
  const putPx = (P, px) => {
    const lut = rgbLut(), d = P.img.data;
    if (!lut) d.set(px);
    else for (let i = 0; i < px.length; i += 4) { d[i] = lut[0][px[i]]; d[i + 1] = lut[1][px[i + 1]]; d[i + 2] = lut[2][px[i + 2]]; d[i + 3] = 255; }
    if (!PR.gl) P.g.putImageData(P.img, 0, 0);            // WebGL: prezentér bere data přímo
  };
  let lastPx = null;
  function showFrame(fr) {                                  // snímek originálu 330 × 261 (Originál bez plynulého zobrazení)
    lastPx = fr; sub.on = false;
    const P = pics.original; if (modeOf() !== 'original') return;
    const rp = M._engine_rec_rgba(fr.rec); putPx(P, M.HEAPU8.subarray(rp, rp + W0 * H0 * 4));
    if (!disp.testFill) paint();
  }
  // vlastní obraz (view.h) v čase t mezi snímky A a B: kamera a sprity po snímcích, objekty po průchodech kreslení
  let viewMs = 0, viewN = 0;
  // měřidlo plynulosti objektů: krok polohy ve světě (px hry) mezi snímky displeje u každého objektu (rec); nerovnoměrnost = |krok − předchozí krok|
  const jerk = { m: new Map(), n: 0, sum: 0, big: 0 };
  function jerkMeasure(S) {
    const T = GL.track, cur = new Map();
    for (let i = 0; i < T.n; i++) { const r = T.rec[i]; if (!r) continue; cur.set(r, cur.has(r) ? null : [T.x[i] / S, T.y[i] / S]); }   // víc dílů jednoho objektu: vynechat
    for (const [r, p] of cur) {
      if (!p) continue; const o = jerk.m.get(r);
      if (o) { const dx = p[0] - o.x, dy = p[1] - o.y;
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
          if (o.dx !== undefined && (Math.hypot(dx, dy) > 0.2 || Math.hypot(o.dx, o.dy) > 0.2)) { const j = Math.hypot(dx - o.dx, dy - o.dy); jerk.n++; jerk.sum += j; if (j > 0.5) jerk.big++; }
          o.dx = dx; o.dy = dy; } else { o.dx = undefined; }
        o.x = p[0]; o.y = p[1]; o.seen = true;
      } else jerk.m.set(r, { x: p[0], y: p[1], seen: true });
    }
    for (const [r, o] of jerk.m) { if (!o.seen) jerk.m.delete(r); else o.seen = false; }
  }
  function showView(A, B, t, smooth, tO = t) {
    const t0 = performance.now();
    const m = modeOf(), [ex, ey] = extNow();
    const f = smooth && B && B.t > A.t ? Math.min(1, Math.max(0, (t - A.t) / (B.t - A.t))) : 0;
    let ob = -1, of = 0, oa = A.rec, dT = null;
    if (smooth) {                                            // objekty v čase tO: průchod OA (poslední snímek s časem <= tO) a příští průchod
      const all = hist.concat(frames); let OA = null;
      for (const x of all) if (x.t <= tO && x.ok) OA = x;
      if (!OA) OA = A; oa = OA.rec;
      const nx = all.find((x) => x.pass > OA.pass && x.ok), tA = passT.get(OA.pass);
      if (nx && tA !== undefined) { const tB = passT.get(nx.pass); dT = [tO, tA, tB, OA.pass, nx.pass]; if (tB > tA) { ob = nx.rec; of = Math.min(1, Math.max(0, (tO - tA) / (tB - tA))); } }
      else if (tA !== undefined && M._engine_view_extrap) {  // příští průchod ještě není: dopočet dopředu z posledních dvou (engine: of > 1)
        let P = null; for (const x of all) if (x.ok && x.pass < OA.pass) P = x;
        const tP = P ? passT.get(P.pass) : undefined;
        if (tP !== undefined && tA > tP) { oa = P.rec; ob = OA.rec; of = 1 + Math.min(1, Math.max(0, (tO - tA) / (tA - tP))); dT = [tO, tP, tA, P.pass, OA.pass, 'ext']; if (smooth && !disp.anim) mon.sExt++; }
      }
    }
    M._engine_view_sprites(1);                               // sprity při plném DMA (hráč bez pruhů DDFSTRT $24)
    const useGL = glv.on && glv.want && !disp.anim && !!M._engine_view_split; const gt = useGL && GTQ && !!M._engine_gt_atlas; if (M._engine_view_split) M._engine_view_split(useGL ? (gt ? 2 : 1) : 0);
    const tr = performance.now(), r = M._engine_view_render(A.rec, B ? B.rec : A.rec, f, oa, ob, of, ex, ey); mon.vr += performance.now() - tr;
    // M31: obrazovky v hires / s prokládáním (úvod: příběh) v plném rozlišení 2 W0 × 2 H0 na místo okna originálu
    { const hd = r === 1 && M._engine_view_hd ? M._engine_view_hd() : 0, was = disp.hd ? disp.hd.lace : null;
      if (hd) { if (!pics.hd) pics.hd = canvasPic(2 * W0, 2 * H0); const hp = M._engine_view_hd_full(); putPx(pics.hd, M.HEAPU8.subarray(hp, hp + 4 * W0 * H0 * 4)); disp.hd = { lace: hd === 2, ex, ey }; }
      else disp.hd = null;
      if ((disp.hd ? disp.hd.lace : null) !== was && (was === true || (disp.hd && disp.hd.lace))) layout(); }   // řádkování CRT S/2 při prokládání
    disp.dbg = [t, A.t, B ? B.t : null, f, A.rec, B ? B.rec : null, ob, of, dT];
    if (smooth && !disp.anim && r === 0) { mon.sN++; if (!B || !(B.t > A.t)) mon.sNoB++; if (ob < 0) { mon.sNoOB++; mon.missTot++; } }   // jen hrací plocha (ne obrazovky mimo hru, např. přelet mapy po smrti hráče)   // plynulost: chybí další snímek / příští průchod
    const w = M._engine_view_w(), h = M._engine_view_h();
    if (disp.anim && (pics.anim.c.width !== w || pics.anim.c.height !== h)) pics.anim = canvasPic(w, h);
    const P = disp.anim ? pics.anim : pics[m];
    if (w !== P.c.width || h !== P.c.height) return;
    const fp = M._engine_view_full(); putPx(P, M.HEAPU8.subarray(fp, fp + w * h * 4)); P.valid = true;
    sub.gl = useGL && r === 0; sub.on = !sub.gl && smooth && r === 0;
    bandQ = null;
    if (sub.gl || sub.on) {
      const lw = M._engine_view_lw(), lh = M._engine_view_lh(); sub.band = M._engine_view_band(); sub.lh = lh; sub.fx = M._engine_view_fx(); sub.fy = M._engine_view_fy();
      // pruh hrací plochy pro prezentér (kreslí gl.js v paintGL): sub.gl = terén + objekty + sprity, sub.on = vrstva enginu
      if (PR.gl) bandQ = { W: w, LW: lw, LH: lh, S: disp.S, fx: sub.fx, fy: sub.fy, lv: level, camx: M._engine_view_camx(), camy: M._engine_view_camy(), lut: rgbLut(), band: sub.band, layerOnly: !sub.gl, gt: sub.gl && gt };
      else if (sub.on) {                                     // 2D cesta: vrstva do plátna a posun v paintTo
        const lp = M._engine_view_layer();
        if (layer.c.width !== lw || layer.c.height !== lh) layer = canvasPic(lw, lh);
        putPx(layer, M.HEAPU8.subarray(lp, lp + lw * lh * 4));
      }
    }
    lastPx = null;
    if (!disp.testFill) paint();
    if (sub.gl && smooth && !disp.anim) jerkMeasure(disp.S);   // GL.track z kreslení v paintGL
    const dv = performance.now() - t0; viewMs += dv; viewN++; perf.view += dv; mon.view += dv;
  }
  // přechod Originál ↔ Vylepšeno: 450 ms smoothstep, prolíná rozmazání, jas, kontrast, sytost a CRT; rozvržení se přepne v polovině
  function switchMode(m) {
    if (m === disp.mode || disp.anim) return;
    // ladění problikávání v Safari: ?tr=0 přechod bez animace (okamžitě), ?trcrt=0 vrstva CRT v přechodu skrytá
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || QS.get('tr') === '0';
    if (reduce) { disp.mode = m; afterMode(); return; }
    const sOf = (mode) => { const d = menu.getMode(mode, 'display'), par = d.par > 0 ? d.par : 1, W = widthOf(mode), H = heightOf(mode);
      return O.deviceScale(d.zoom, W0, W, dprNow(), (() => { const [aw, ah] = avail(); return Math.min(aw / (W * par), ah / H); })(), par); };
    const sF = sOf(disp.mode), sT = sOf(m);
    disp.anim = { from: disp.mode, to: m, t0: performance.now(), e: 0, S: Math.max(sF, sT), sF, sT };
    disp.lastAnim = null; pics.anim.valid = false;   // snímek předchozího přechodu neplatí (Chrome/Safari: skok starého obrazu)
    if (QS.get('trcrt') === '0') scr.layer.style.visibility = 'hidden';
    game.classList.add('mode-changing'); stage.classList.add('mode-changing');
    const step = () => {
      const t = Math.min(1, (performance.now() - disp.anim.t0) / O.MODE_MS);
      disp.anim.e = O.smoothstep(t); { const n = performance.now(); present(false, (n - PACE.LATC) / 1000, (n - PACE.latO) / 1000); } layout();
      if (t < 1) requestAnimationFrame(step); else { disp.mode = m; disp.anim = null; game.classList.remove('mode-changing'); stage.classList.remove('mode-changing'); scr.layer.style.visibility = ''; afterMode(); }
    };
    requestAnimationFrame(step);
  }
  function afterMode() {
    if (menu.mode !== disp.mode) menu.setMode(disp.mode);
    sndPlusSync();
    actSync();
    disp.lutKey = ''; present(true);
    menu.refreshZoom(); layout(); syncUi(); audioApply();
  }
  const toggleMode = () => switchMode(disp.mode === 'original' ? 'enhanced' : 'original');

  // ---------------------------------------------------------------- menu Obraz / Zvuk z kitu
  const zoomSteps = () => {
    const dpr = dprNow(), par = menu ? (menu.getMode(modeOf(), 'display').par || 1) : 1, W = widthOf(modeOf());
    const smax = Math.max(1, Math.floor(limit(par, W, heightOf(modeOf())) * dpr + 1e-6)), st = [{ value: 0, label: 'fit' }];
    for (let S = 1; S <= smax; S++) { const z = S * W * par / (W0 * dpr); st.push({ value: z, label: z.toLocaleString('en', { maximumFractionDigits: 2 }) + '×' }); }
    return st;
  };
  let firstVisit = false; try { firstVisit = !localStorage.getItem(MENU_STORE); } catch (e) {}   // před build: kit stav hned ukládá
  var menu = WBNASTAVENI.build(document.createElement('div'), {
    store: MENU_STORE, lang: 'en', zoom: 'snap', zoomSteps,
    defaults: { sound: { original: { stereo: 100 }, enhanced: { stereo: 70 } }, display: { original: { smooth: true, zoom: 2, blur: 0 }, enhanced: { smooth: true, zoom: 0, blur: 0 } } },   // Original 2×, Enhanced do okna, rozmazání 0 (zadavatel)
    texts: { display: { crt: 'CRT scanlines and RGB mask', 'crt-detail': 'CRT detail', smooth: 'Smooth motion' } },
  });
  // Plynulé zobrazení výchozí ve všech režimech (zadání); uložené nastavení z dřívějška se jednou přepne
  try { if (!localStorage.getItem('abii-smooth-v1')) { for (const m of ['original', 'enhanced']) menu.state[m].display.smooth = true; menu.save(); localStorage.setItem('abii-smooth-v1', '1'); } } catch (e) {}
  // první návštěva (bez uloženého nastavení): start ve Vylepšeno (zadavatel); uložená volba režimu platí dál
  if (firstVisit) { menu.setMode('enhanced'); menu.save(); }
  disp.mode = menu.mode;
  $('wb-display-host').appendChild(menu.root.querySelector('.wb-nastaveni-display'));
  $('wb-sound-host').appendChild(menu.root.querySelector('.wb-nastaveni-sound'));
  menu.extras.display.appendChild($('display-extras')); $('display-extras').hidden = false;
  menu.extras.sound.appendChild($('sound-extras')); $('sound-extras').hidden = false;
  { const base = menu.refresh.bind(menu); menu.refresh = () => { base();
      for (const [id, c] of Object.entries(menu.controls.display)) if (c.out && id !== 'zoom') c.out.value = id === 'par' ? Number(menu.get('display').par).toLocaleString('en', { minimumFractionDigits: 2 }) : c.out.value;
      const zc = menu.controls.display.zoom, zv = menu.get('display').zoom;
      if (zc.ctl.dataset.snap && zv > 0 && disp.label) zc.out.value = disp.label; }; }
  menu.on('change', (st, what) => {
    if (what === 'mode') { if (st.mode !== disp.mode) switchMode(st.mode); return; }
    if (what === 'display' || what === 'all') { disp.lutKey = ''; present(true); layout(); syncUi(); }
    if (what === 'sound' || what === 'all') audioApply();
  });
  for (const b of document.querySelectorAll('[data-zoom]')) b.addEventListener('click', () => {
    const want = +b.dataset.zoom;                      // tlačítka = zkratky posuvníku: nejbližší přesné zvětšení (do okna = 0)
    menu.set('display', 'zoom', want);
  });
  window.wbMenuTest = menu.testHooks();
  const SIG = WBZVUK.testSignal(4096, 44100);
  window.wbZvukTest = { version: WBZVUK.VERSION, signal: () => ({ l: Array.from(SIG.l), r: Array.from(SIG.r) }),
    render: (settings, led) => WBZVUK.render(settings, !!led, SIG, 44100),
    reference: (settings, led) => { const [l, r] = WBZVUK.process(SIG.l, SIG.r, settings, !!led, 44100); return { l: Array.from(l), r: Array.from(r) }; } };
  // háčky kontraktu obrazu (arek web test §5): nastavení testu má přednost, hra pod vzorem nekreslí
  const hideOverlays = () => { $('intro').hidden = true; $('about-shade').hidden = true; game.hidden = false; };
  window.wbObrazTest = {
    set(mode, c) {
      hideOverlays(); disp.mode = mode;
      disp.test = { zoom: c.zoom > 0 ? c.zoom : 0, crt: c.crt !== false, crtOn: c.crt !== false ? 1 : 0, 'crt-detail': c.crtDetail || (mode === 'original' ? 'strong' : 'fine'),
                    'crt-shape': c.crtShape || 'lines', blur: c.blur || 0, brightness: 100, contrast: 100, saturation: 100, par: c.par > 0 ? c.par : 1 };
      return layout();
    },
    fill(kind) { hideOverlays(); disp.testFill = kind === 'picture' ? null : kind; game.classList.toggle('no-vignette', !!disp.testFill); paint(); return true; },
    gl: () => PR.gl,                                         // 1.5: cesta WebGL (?gl=0 / ?gl=1)
  };
  window.display = () => layout();

  // ---------------------------------------------------------------- zvuk (kontrakt wb-zvuk 1.1)
  let audio = null, zvuk = null, lastLed = null;
  // Vylepšený zvuk (menu Zvuk, po režimech; výchozí Vylepšeno ano, Originál ne): požadavek, který by ovladač hry zahodil (fronta,
  // priorita, sekvence na kanálu 3), jde na volný kanál Pauly (engine_sound_redirect, M21). Menu kitu vlastní položky neumí (G46).
  const sndPlus = { original: false, enhanced: true };
  try { Object.assign(sndPlus, JSON.parse(localStorage.getItem('abii-snd-plus') || '{}')); } catch (e) {}
  function sndPlusSync() {
    const on = !!sndPlus[disp.mode], cb = $('snd-plus'); if (cb) cb.checked = on;
    if (M && M._engine_sound_redirect) M._engine_sound_redirect(on ? 1 : 0);
    if (M && M._engine_sound_hum) M._engine_sound_hum(on ? 1 : 0);   // hučení reaktorů podle vzdálenosti a ve stereu (M33)
    const ht = /[?&]hum=([\d.]+),([\d.]+),([\d.]+)(?:,([\d.]+))?/.exec(location.search);   //@DEV ladění: plná do px, ticho od px, zbytek, nejvíc
  }
  { const cb = $('snd-plus'); if (cb) cb.onchange = () => { sndPlus[disp.mode] = cb.checked; try { localStorage.setItem('abii-snd-plus', JSON.stringify(sndPlus)); } catch (e) {} sndPlusSync(); log('enhanced sound (' + disp.mode + '): ' + (cb.checked ? 'on' : 'off')); }; }
  sndPlusSync();
  const toSound = (z) => ({ on: z.sound, volume: z.volume, stereo: z.stereo, filterFixed: z['filter-fixed'], filterLed: z['filter-led'], filterHp: z['filter-hp'] });
  const ledOn = () => (M ? M._engine_led() !== 0 : false);   // 1 = LED svítí = filtr zapnutý; -1 (hra nezapsala) = jako po Kickstartu
  function audioApply() { if (zvuk) WBZVUK.apply(zvuk, toSound(menu.getMode(disp.mode, 'sound')), ledOn()); }
  // zvuk: snímky hry -> AudioWorklet s kruhem (audio-worklet.js, jako Superfrog): nezávislý na taktu obrazu, ~50 ms zásoba
  let audioNode = null, audioSt = { fill: 0, under: 0, drop: 0 };
  function startAudio() {
    if (audio) { if (audio.state !== 'running') audio.resume(); return; }
    try {
      audio = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      zvuk = WBZVUK.chain(audio); WBZVUK.apply(zvuk, toSound(menu.getMode(disp.mode, 'sound')), ledOn(), 0);
      audio.audioWorklet.addModule('audio-worklet.js').then(() => {
        audioNode = new AudioWorkletNode(audio, 'abii-paula', { outputChannelCount: [2] });
        audioNode.port.onmessage = (e) => { audioSt = e.data; }; audioNode.connect(zvuk.input); audioBind();
      }).catch((e) => log('zvuk: ' + e));
      if (audio.state !== 'running') audio.resume();
    } catch (e) { log('zvuk: ' + e); }
  }
  function audioFlush() { if (audioNode) audioNode.port.postMessage('flush'); }
  // zásoba zvuku: engine ve vlákně (MT) čte AudioWorklet kruh přímo ze sdílené paměti, vlákno hry ho samo dopočítá, když
  // zásoba klesne pod AUD.low - proto stačí menší zásoba (latence); bez sdílené paměti zprávy přes port jako dosud
  // low: pod tuto zásobu (ms) počítá vlákno hry i bez povolení - jen pojistka při zaseknutém hlavním vlákně; musí být hluboko pod
  // běžnou zásobou (cíl 30 ms, drží se ~28 ms), jinak vlákno průběžně uteče dopředu a klávesy reagují pozdě (měřeno: s 25 ms ano)
  const AUD = { mt: { prefill: 20, target: 30, low: 15 }, msg: { prefill: 40, target: 50 } };
  function audioBind() {
    if (!audioNode || !M) return;
    const a = MT ? AUD.mt : AUD.msg; audioNode.port.postMessage({ prefill: a.prefill, target: a.target });
    if (MT) { audioNode.port.postMessage({ sab: M.HEAPU8.buffer, ring: M._engine_aud_ring(), n: M._engine_aud_size(), widx: M._engine_aud_written(), ridx: M._engine_aud_read() });
      M._engine_aud_low(Math.round(a.low * 48)); }
  }
  ['pointerdown', 'keydown'].forEach((t) => addEventListener(t, () => { if (M) startAudio(); }, true));

  // ---------------------------------------------------------------- lišta, stav, ladění
  let manualPause = false, menuPause = false;
  const shell = new WbMenu.Shell($('shell'), { suspend: () => { menuPause = true; held = 0; }, restore: () => { menuPause = false; screen.focus({ preventScroll: true }); } });
  const log = (t) => { const el = $('log'); if (!el) return; el.textContent += t + '\n'; el.scrollTop = el.scrollHeight; };
  const setStatus = (t) => { $('status').textContent = t; };
  function syncUi() {
    const m = modeOf();
    $('mode-original').setAttribute('aria-pressed', m === 'original'); $('mode-enhanced').setAttribute('aria-pressed', m === 'enhanced');
    $('run-state').textContent = m === 'original' ? 'Original' : 'Enhanced';
    game.dataset.mode = m;
    // právě jedno tlačítko: to, jehož přání je nejblíž skutečnému zvětšení (do okna jen při zoom 0)
    const zv = menu.get('display').zoom, bs = [...document.querySelectorAll('[data-zoom]')];
    const best = zv > 0 ? bs.filter((b) => +b.dataset.zoom > 0).reduce((x, b) => (Math.abs(+b.dataset.zoom - zv) < Math.abs(+x.dataset.zoom - zv) ? b : x)) : bs.find((b) => +b.dataset.zoom === 0);
    for (const b of bs) b.setAttribute('aria-pressed', b === best);
  }
  $('mode-original').onclick = () => switchMode('original');
  $('mode-enhanced').onclick = () => switchMode('enhanced');
  const fullscreen = () => { if (document.fullscreenElement) document.exitFullscreen(); else if ($('shell').requestFullscreen) $('shell').requestFullscreen().catch(() => {}); };
  $('fullscreen').onclick = fullscreen;
  document.addEventListener('fullscreenchange', () => { menu.refreshZoom(); layout(); });
  addEventListener('resize', () => { menu.refreshZoom(); layout(); syncUi(); });
  $('pause').onclick = () => { manualPause = !manualPause; };
  $('restart').onclick = () => { if (M) restartGame(); };
  function restartGame() { reset().then(() => { if (levelDone) { levelDone = false; running = true; requestAnimationFrame(loop); } }); }
  $('about-open').onclick = () => shell.openDialog('about-shade');

  // ---------------------------------------------------------------- vstup: klávesnice + gamepad -> R L U D F
  const KEYS = { ArrowRight: 1, KeyD: 1, ArrowLeft: 2, KeyA: 2, ArrowUp: 4, KeyW: 4, ArrowDown: 8, KeyS: 8, ControlLeft: 16, ControlRight: 16, KeyZ: 16 };   // mezerník = klávesa Amigy (terminál)
  const KEYS2 = { KeyL: 1, KeyJ: 2, KeyI: 4, KeyK: 8, ShiftRight: 16, Enter: 16 };   // hráč 2 (port 0): I J K L, pravý Shift / Enter
  let held = 0, held2 = 0;
  const pads = new PAD.Gamepads();
  try { const v = JSON.parse(localStorage.getItem('abii-pad') || '{}'); if (/^(auto|\d+)$/.test(v.pad)) pads.preferred = v.pad; if (/^(auto|\d+)$/.test(v.fire)) pads.fireButton = v.fire; } catch (e) {}
  const padSave = () => { try { localStorage.setItem('abii-pad', JSON.stringify({ pad: pads.preferred, fire: pads.fireButton })); } catch (e) {} };
  $('gamepad').onchange = (e) => { pads.preferred = e.target.value; padSave(); };
  $('gamepad-fire').onchange = (e) => { pads.fireButton = e.target.value; padSave(); };
  addEventListener('keydown', (e) => {
    if (shell.busy || WbMenu.editable(e.target)) return;
    if (e.code === 'KeyE' && !e.repeat) { toggleMode(); return; }
    if (e.code === 'KeyF' && !e.repeat) { fullscreen(); return; }
    if (e.code === 'KeyP' && !e.repeat) { manualPause = !manualPause; return; }
    if (e.code === 'KeyR' && !e.repeat && M) { restartGame(); return; }
    if (e.code === 'KeyM' && !e.repeat && M) { M._engine_key(0x37, 1); return; }      // mapa (klávesa Amigy $37)
    if (e.code === 'Space' && M) { if (!e.repeat) M._engine_key(0x40, 1); e.preventDefault(); return; }   // terminál Intex ($40)
    if (KEYS[e.code]) { held |= KEYS[e.code]; e.preventDefault(); }
    if (KEYS2[e.code]) { held2 |= KEYS2[e.code]; e.preventDefault(); }
    pushKeys();
  });
  addEventListener('keyup', (e) => { if (KEYS[e.code]) { held &= ~KEYS[e.code]; e.preventDefault(); } if (KEYS2[e.code]) { held2 &= ~KEYS2[e.code]; e.preventDefault(); } pushKeys(); });
  // klávesy do hry hned při události (engine ve vlákně je čte ze sdílené paměti na začátku dalšího snímku hry), ne až v příštím
  // snímku displeje; v každém snímku displeje se posílají znovu (ovladač, dotyk)
  function pushKeys() { if (M && !restarting) { M._engine_keys(manualPause || menuPause ? 0 : keys()); if (M._engine_keys2) M._engine_keys2(manualPause || menuPause ? 0 : keys2()); } }
  addEventListener('keyup', (e) => { if (e.code === 'KeyM' && M) M._engine_key(0x37, 0); if (e.code === 'Space' && M) M._engine_key(0x40, 0); });
  addEventListener('blur', () => { held = held2 = 0; });
  WBTOUCH.init(document.querySelector('.game'), { onKey: (code, down) => { if (M) M._engine_key(code, down); }, buttons: [{ label: 'Map', code: 0x37 }, { label: 'Terminal', code: 0x40 }], fire: 'FIRE' });   // wb-touch.js (kit)
  const clean = (k) => { if ((k & 3) === 3) k &= ~3; if ((k & 12) === 12) k &= ~12; return k; };
  function keys() { return clean(held | WBTOUCH.bits() | (shell.busy ? 0 : pads.poll())); }
  function keys2() { return clean(held2 | (shell.busy ? 0 : pads.poll2())); }   // hráč 2: druhý ovladač nebo I J K L

  // ---------------------------------------------------------------- diskety a pečeť
  let disks = [];                                          // [{name, buf}]
  const DISK_ID = { '00123111': 0, '4d104d43': 1, 'b7aab7dd': 2 };   // long v sektoru 0 na +8 (docs/disk.md bod 5)
  const diskNo = (buf) => (buf.byteLength === 901120 ? DISK_ID[hex(buf.slice(8, 12))] : undefined);   // jen celý obraz ADF (zkrácený s platným sektorem 0 ne)
  const byNo = (k) => disks.find((d) => diskNo(d.buf) === k);
  let manifest = null;
  const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
  async function sha(buf) { return hex(await crypto.subtle.digest('SHA-256', buf)); }
  async function getManifest() { if (!manifest) manifest = await (await fetch('sealed/seal.json')).json(); return manifest; }
  async function showDisks() {
    let agaSeen = false;
    const ul = $('disks'); ul.replaceChildren();
    const m = await getManifest().catch(() => null), known = m ? m.keys.filter((k) => k.disks).map((k) => k.disks).flat() : [];
    for (const d of disks) {
      const h = await sha(d.buf), li = document.createElement('li'), i = known.indexOf(h);
      li.innerHTML = '<span></span><span></span>'; li.children[0].textContent = d.name;
      // proč disk nesedí (M33): otisk v pečeti, velikost ADF, identita v sektoru 0 (+8: disk 1 $00123111, 2 $4D104D43, 3 $B7AAB7DD;
      // AGA disk 1 $00123000, AGA disky 2–4 začínají „ATN!“ – změřeno na archivu FLT)
      const n = diskNo(d.buf), head = d.buf.byteLength >= 12 ? hex(d.buf.slice(8, 12)) : '', aga = head === '00123000' || (d.buf.byteLength >= 4 && hex(d.buf.slice(0, 4)) === '41544e21');
      const okd = i >= 0 || n !== undefined && d.buf.byteLength === 901120; if (aga) agaSeen = true;
      li.children[1].textContent = i >= 0 ? 'disk ' + (i % 2 + 1) + ' ✓'
        : d.buf.byteLength !== 901120 ? 'not a disk image: ' + d.buf.byteLength + ' bytes, an Amiga ADF has 901 120'
        : n === 2 ? 'disk 3 ✓'
        : n !== undefined ? 'disk ' + (n + 1) + ', other release – checked when the game starts'
        : aga ? 'AGA (A1200) version – not supported'
        : 'not an Alien Breed II disk (another game, or the boot sector is damaged)';
      li.children[1].className = okd ? 'disk-ok' : 'disk-bad'; ul.appendChild(li);
    }
    const ok = !!byNo(0) && !!byNo(1), miss = [0, 1].filter((k) => !byNo(k)).map((k) => 'disk ' + (k + 1));
    $('intro-start').disabled = !ok; $('start').disabled = !ok;
    $('intro-status').textContent = ok ? '' : agaSeen ? 'This is the AGA (A1200) version of Alien Breed II – the rebuild needs the Amiga 500 version (disks 1 and 2).'
      : !disks.length ? '' : (miss.length > 1 ? 'Disks 1 and 2 are' : 'Disk ' + miss[0].slice(5) + ' is') + ' missing' + (disks.length > (2 - miss.length) ? ' – see why next to each file above.' : '.');
  }
  async function addFiles(files) {
    for (const f of files) { const buf = await f.arrayBuffer(); if (!disks.some((d) => d.name === f.name)) disks.push({ name: f.name, buf }); }
    disks = disks.slice(-3);
    if ($('remember').checked) storeDisks();
    await showDisks();
  }
  // pamatování disket: IndexedDB tohoto prohlížeče (jen u návštěvníka, nikam se neposílají)
  function idb() { return new Promise((res, rej) => { const r = indexedDB.open(DISK_DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('adf'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function storeDisks() { try { const db = await idb(); db.transaction('adf', 'readwrite').objectStore('adf').put(disks, 'set'); } catch (e) { /* soukromé okno */ } }
  async function loadDisks() { try { const db = await idb(); return await new Promise((res) => { const q = db.transaction('adf').objectStore('adf').get('set'); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }); } catch (e) { return []; } }
  $('forget').onclick = async () => { try { const db = await idb(); db.transaction('adf', 'readwrite').objectStore('adf').delete('set'); } catch (e) {} shell.message('Saved disks forgotten'); };
  $('files').onchange = (e) => addFiles(e.target.files);
  $('files-pick').onclick = () => $('files').click();   // vlastní tlačítko: popisek prohlížeče („Soubor nevybrán“) je v jazyce systému
  $('disk-file').onchange = (e) => addFiles(e.target.files);
  $('disks-insert').onclick = () => $('disk-file').click();
  const intro = $('intro');
  intro.addEventListener('dragover', (e) => { e.preventDefault(); intro.classList.add('dragover'); });
  intro.addEventListener('dragleave', () => intro.classList.remove('dragover'));
  intro.addEventListener('drop', (e) => { e.preventDefault(); intro.classList.remove('dragover'); addFiles(e.dataTransfer.files); });
  async function openSeal(bufs) {
    const m = await getManifest();
    for (const d of [bufs, [bufs[1], bufs[0]]]) { try { return await WBSEAL.open(m, d); } catch (e) { /* jiné pořadí */ } }
    setStatus('Other disk version: looking for the game files…');
    const content = await gameContent(bufs, await (await fetch('content.json')).json());
    if (content) { try { return await WBSEAL.openPayload(m, content); } catch (e) { /* obsah nesedí */ } }
    throw new Error('The game files on these disks could not be verified – a disk image is probably damaged or modified. Needed: Alien Breed II, Amiga 500 version, disks 1 and 2.');
  }

  // ---------------------------------------------------------------- hra: přeložený engine, takt podle zvukových hodin (49,92 Hz)
  // Hra běží v hlavním vlákně jako korutina (Emscripten ASYNCIFY, jako Superfrog): engine_run() na konci každého snímku
  // uloží záznam a zvuk, a když je hotovo víc snímků, než stránka povolila, usne (js_wait); stránka mezitím kreslí
  // a probudí ji, když chce další. Bez sdílené paměti a bez hlaviček COOP/COEP; vnitřní smyčky hry (mapa M, terminál,
  // obrazovky mezi levely) fungují. Prezentace: po dokončení levelu 1 engine skončí (engine_ended).
  var M = null, levelDone = false; let stateBytes = null, wasmMod = null, running = false, got = 0, restarting = false, frames = [], hist = [], clockAudio = false;
  const passT = new Map();                                  // průchod kreslení -> čas prvního snímku, který ho ukazuje
  // takt (jako Superfrog web/main.js + web/scene.js): hodiny hry z rAF; snímek hry n má čas PACE.tg[n] (ms, performance.now),
  // hra smí být nejvýš AHEAD snímků napřed; obraz se kreslí pozadu za časem hry – kamera a sprity o LATC, objekty (logika
  // 25 Hz) o LATO –, takže pro mezipolohu je vždy k dispozici další snímek i příští průchod. Zvuk jde zvlášť (audio-worklet.js).
  // Snímek hry bez povolení (hra v rušné scéně udělá 3–4 snímky v jednom běhu, než dojde k čekací smyčce) nemá v tg svůj čas
  // (tgN ≠ n) – dřív dostal starý čas z kruhu (o 256 snímků = 5 s), teď předchozí + 1 snímek hry; hodiny pak čekají za ním.
  const PACE = { clock: 0, granted: 0, tg: new Float64Array(256), tgN: new Int32Array(256).fill(-1), lastT: 0, AHEAD: 2, LATC: 30, LATO: 40, latO: 40, lens: [], lastPassT: -1, maxPass: -1, pausedAud: false };
  // objekty pozadu přizpůsobivě (jako zásobník proti kolísání): v rušných scénách hra kreslí objekty jen každý 3.–4. snímek
  // (60–80 ms, změřeno: level 1, průchody 134 → 136 … po 0,0801 s) a se 60 ms by na začátku průchodu chyběl příští průchod
  // (objekt stojí a pak poskočí). Cíl = nejdelší z posledních 16 průchodů − kolik má hra spočítáno dopředu + 8 ms, 60–120 ms;
  // nahoru až 1 ms, dolů 0,1 ms na snímek displeje (změna tempa objektů nejvýš ~6 %, ne skok).
  function latOStep(ts) {
    if (M && M._engine_view_extrap) return (PACE.latO = PACE.LATO);   // engine dopočítá polohu dopředu: objekty pevně LATO (40 ms)
    const newest = frames.length ? frames[frames.length - 1].t * 1000 : ts, maxLen = PACE.lens.length ? Math.max(...PACE.lens) : 40;
    const target = Math.min(120, Math.max(PACE.LATO, maxLen - (newest - ts) + 8)), d = target - PACE.latO;
    PACE.latO += d > 0 ? Math.min(1, d) : Math.max(-0.1, d);
    return PACE.latO;
  }
  const now = () => performance.now() / 1000;
  function syncClock() { clockAudio = !!audio && audio.state === 'running'; }
  // engine: ve vlastním vlákně (sdílená paměť: stránka s COOP/COEP, engine_mt), jinak korutina v hlavním vlákně (ASYNCIFY)
  let MT = false;
  async function start() {
    try {
      startAudio();
      setStatus('Opening the game…');
      $('intro-start').disabled = $('start').disabled = true;   // druhý klik během stahování nespustí hru podruhé
      startStep('Checking the disks…');
      const box = await openSeal([byNo(0), byNo(1)].filter(Boolean).map((d) => d.buf));
      MT = !!(window.crossOriginIsolated && typeof SharedArrayBuffer === 'function' && window.ABR2EngineMT && !/[?&]mt=0\b/.test(location.search));
      const man = await getManifest(), stored = (p) => ((man.files.find((f) => f.path === p) || {}).stored || 0);
      const dl = { n: 0, total: stored('state.bin') + stored(MT ? 'engine_mt.wasm' : 'engine.wasm') };
      stateBytes = new Uint8Array(await fetchSealed(box, 'state.bin', dl));
      posKey = (await sha(byNo(0).buf)).slice(0, 16); levelMenu();
      let wb = null; if (MT) { try { wb = await fetchSealed(box, 'engine_mt.wasm', dl); } catch (e) { if (!/HTTP 404/.test(e.message)) throw e; MT = false; log('thread engine not in the package: ' + e.message); } }   // jen chybějící soubor -> korutina; chyba sítě do okna
      if (!wb) wb = await fetchSealed(box, 'engine.wasm', dl);
      startStep('Preparing the engine…', 1); wasmMod = await WebAssembly.compile(wb);
      // kamera a sprity pozadu za hrou: vlákno dává snímky pravidelně -> 20 ms stačí (měřeno: 0 % chybějících mezipoloh, prodleva
      // kláves medián 59–62 ms proti 72–76 ms s 30 ms; 15 ms už 3,5 % chybí); korutina dává snímky nárazově v rAF -> 30 ms. ?latc=N ladění
      PACE.LATC = +((/[?&]latc=(\d+)/.exec(location.search) || [])[1] || (MT ? 20 : 30));
      PACE.LATO = PACE.latO = +((/[?&]lato=(\d+)/.exec(location.search) || [])[1] || 40);   // objekty za hrou: 40 ms (zadavatel: prodleva střelby; měřeno 60/40/30/20 ms: dopočet dopředu 0/0/16/41 %, nerovnoměrnost 0,91/0,73/0,84/0,84 px), ?lato= ladění
      log(MT ? 'engine in its own thread (shared memory), audio buffer ' + AUD.mt.target + ' ms, camera ' + PACE.LATC + ' ms behind the game' : 'engine in the main thread (coroutine, page without COOP/COEP)');
      await reset();
      startStep(null); intro.hidden = true; game.hidden = false; layout(); screen.focus({ preventScroll: true });
      running = true; requestAnimationFrame(loop);
      setStatus('Playing'); log('seal opened (' + (box.key.disks ? 'disks' : 'game content') + '), whole game from boot' + (byNo(2) ? '' : ' (without disk 3)'));
      log('keys: M map, Space Intex terminal, Ctrl / Z fire, N finish level (debug)');
    } catch (e) { startStep(null); $('intro-start').disabled = $('start').disabled = false; setStatus(String(e.message || e)); $('intro-status').textContent = String(e.message || e); }
  }
  // průběh po Startu (M34, publikace): ověření disket, stažení zapečetěných souborů po bajtech, překlad wasm; null = skrýt.
  // Změřeno na arek-play (2026-10-31): stažení a odemčení 1,45 MB + překlad 0,45–1,5 s; na pomalém připojení déle
  function startStep(text, frac) {
    const bar = $('intro-progress'); if (!bar) return;
    bar.hidden = text === null; if (text === null) return;
    if (frac === undefined) bar.removeAttribute('value'); else bar.value = frac;
    $('intro-status').textContent = text;                // lišta jen „Opening the game…“ (měnící se text v liště měnil rozvržení plochy)
  }
  async function fetchSealed(box, path, dl) {             // jako box.fetch, ale s průběhem stahování (dl = { n, total } bajtů)
    // chyba sítě i zaseknuté stahování (20 s bez bajtu) skončí hláškou v okně Startu a Start jde zmáčknout znovu (ne tiché čekání)
    const ac = new AbortController(); let idle = null; const arm = () => { clearTimeout(idle); idle = setTimeout(() => ac.abort(), 20000); };
    const fail = (why) => new Error('Downloading the game failed (' + why + ') – check the connection and press Start game again.');
    arm(); let r;
    try { r = await fetch('sealed/' + path + '.sealed', { signal: ac.signal }); } catch (e) { clearTimeout(idle); throw fail(ac.signal.aborted ? 'no data for 20 s' : e.message || 'network error'); }
    if (!r.ok) { clearTimeout(idle); throw fail(path + ': HTTP ' + r.status); }
    const mb = (x) => (x / 1048576).toFixed(1), show = () => startStep('Downloading the game: ' + mb(dl.n) + (dl.total ? ' / ' + mb(dl.total) : '') + ' MB', dl.total ? Math.min(1, dl.n / dl.total) : undefined);
    let buf;
    if (r.body && r.body.getReader) {
      const rd = r.body.getReader(), parts = []; let n = 0;
      try { for (;;) { const { done, value } = await rd.read(); if (done) break; arm(); parts.push(value); n += value.length; dl.n += value.length; show(); } }
      catch (e) { throw fail(ac.signal.aborted ? 'no data for 20 s' : e.message || 'connection lost'); } finally { clearTimeout(idle); }
      buf = new Uint8Array(n); let o = 0; for (const q of parts) { buf.set(q, o); o += q.length; }
    } else { try { buf = new Uint8Array(await r.arrayBuffer()); } catch (e) { throw fail(e.message || 'connection lost'); } finally { clearTimeout(idle); } dl.n += buf.length; show(); }
    startStep('Unlocking the game…', dl.total ? Math.min(1, dl.n / dl.total) : undefined);
    return box.get(path, buf);
  }
  // skrytá karta (M34): rAF stojí a další snímek stránky po skrytí nemusí přijít -> pojistku zvuku vlákna vypnout hned, jinak hra
  // ve vlákně běží dál podle zvuku (změřeno: emulace skryté karty bez dalšího rAF, 10 s: +499 snímků, zvuk hraje); po návratu
  // zpět, hodiny začnou od prvního snímku displeje (bez dohánění)
  document.addEventListener('visibilitychange', () => {
    if (!M || !MT || !running) return;
    const paused = manualPause || menuPause || document.hidden;
    if (paused !== PACE.pausedAud) { PACE.pausedAud = paused; if (M._engine_aud_low) M._engine_aud_low(paused ? 0 : Math.round(AUD.mt.low * 48)); }
    if (document.hidden) setStatus('Paused – tab hidden');
  });
  $('intro-start').onclick = start; $('start').onclick = start;
  // nová instance enginu (běžící korutinu nejde přerušit; zkompilovaný modul se použije znovu, je to rychlé)
  async function reset(from) {                              // from = uložená pozice (začátek levelu), jinak start z disket
    restarting = true;
    if (MT && M) {                                          // vlákno hry zastavit a počkat, až zaparkuje (pak se přepíše stav)
      M._engine_stop(); for (let i = 0; i < 400 && !M._engine_parked(); i++) await new Promise((r) => setTimeout(r, 5));
      if (!M._engine_parked()) throw new Error('the game thread did not stop');
      for (const q of allocs) M._free(q); allocs = [];
    } else {
      M = await (MT ? ABR2EngineMT : ABR2Engine)({ instantiateWasm(imports, done) { WebAssembly.instantiate(wasmMod, imports).then((inst) => done(inst, wasmMod)); return {}; } });
      monWrap(M);
    }
    const st = from || stateBytes, p = M._engine_alloc(st.length); M.HEAPU8.set(st, p); allocs.push(p);
    const r = M._engine_init(p, st.length); if (r !== 0) throw new Error('engine_init ' + r);
    snapSeen = M._engine_snap_seq ? M._engine_snap_seq() : 0;
    syncClock(); frames = []; hist = []; passT.clear(); PACE.maxPass = -1; PACE.lastPassT = -1; PACE.lens = []; PACE.tgN.fill(-1); PACE.lastT = 0; PACE.clock = 0; PACE.granted = 0; audioFlush(); lastLed = null; got = 0; lastPx = null;
    M._engine_palette_linear(1);                            // barvy 12 bitů x17 (model vAmigy obraz ztmavuje, docs/code.md)
    M._engine_view(1); M._engine_sprites_full(1);          // hráč celý i v Originálu (pravidlo slotu emulátoru dělá pruhy, docs/code.md)
    sndPlusSync();
    if (M._engine_autosnap) M._engine_autosnap(250);   // ladění zaseknutí: záloha stavu každých 5 s (Ladění → Zaseknutí)
    actSync();
    for (let k = 0; k < 3; k++) { const d = byNo(k); if (!d) continue; const b = new Uint8Array(d.buf), q = M._engine_alloc(b.length); M.HEAPU8.set(b, q); M._engine_set_disk(k, q, b.length); allocs.push(q); }
    if (MT) { const r = M._engine_run(); if (r) throw new Error('engine_run ' + r); audioBind(); }
    else M.ccall('engine_run', 'number', [], [], { async: true }).then((c) => log('engine_run ended ' + c));
    restarting = false;
  }
  let snapSeen = 0, allocs = [];
  // výběr levelu (bod 6): engine při každém vstupu do smyčky levelu ($C01C72) připraví stav ve tvaru engine_init; stránka ho
  // uloží v prohlížeči (IndexedDB, klíč = level; obsahuje RAM hry z disket návštěvníka, nikam se neposílá) a menu Hra nabídne
  // pokračovat od začátku každého dosaženého levelu. Pozice patří k obrazům disket (otisk disku 1).
  const ORDER = [1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 17, 10, 11, 12, 13, 15, 14];   // pořadí levelů v ovladači $C01026 (změřeno)
  const levelNo = (id) => ORDER.indexOf(id) + 1 || id;
  let posKey = null, posDbP = null;
  const posDb = () => posDbP || (posDbP = new Promise((res, rej) => { const r = indexedDB.open('abii-pozice', 1); r.onupgradeneeded = () => r.result.createObjectStore('levels'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const posReq = (q) => new Promise((res) => { q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
  async function posAll() { try { const db = await posDb(); return ((await posReq(db.transaction('levels').objectStore('levels').getAll())) || []).filter((x) => x.disk === posKey); } catch (e) { return []; } }
  async function posPut(id, bytes) {
    try { const db = await posDb(); await posReq(db.transaction('levels', 'readwrite').objectStore('levels').put({ id, disk: posKey, t: Date.now(), bytes }, posKey + ':' + id)); } catch (e) { log('cannot save the position: ' + (e.message || e)); }
    levelMenu();
  }
  function pollSnap() {
    if (!M._engine_snap_seq || !posKey) return;
    const q = M._engine_snap_seq(); if (q === snapSeen) return; snapSeen = q;
    const id = M._engine_snap_level(), n = M._engine_snap_len(), p = M._engine_snap();
    posPut(id, M.HEAPU8.slice(p, p + n)); log('position saved: start of level ' + levelNo(id));
  }
  async function levelMenu() {
    const box = $('levels'); if (!box) return;
    const all = (await posAll()).sort((a, b) => levelNo(a.id) - levelNo(b.id));
    box.replaceChildren(...all.map((x) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'wbitem'; b.dataset.closeMenu = '';
      b.textContent = 'Level ' + levelNo(x.id); b.onclick = () => { startFrom(x.bytes, levelNo(x.id)); }; return b; }));
    $('levels-note').textContent = all.length ? 'The start of each level you reached (saved in this browser).' : 'None yet: the start of every level you reach is saved here.';
  }
  function startFrom(bytes, n) { if (!M) return; reset(bytes).then(() => { log('continuing from level ' + n); if (levelDone || !running) { levelDone = false; running = true; requestAnimationFrame(loop); } }); }
  { const panel = $('game-panel'), hr = panel.querySelector('hr'), h = document.createElement('div');
    h.innerHTML = '<p class="wbnote"><b>Continue from level</b></p><div id="levels"></div><p id="levels-note" class="wbnote"></p><hr>';
    panel.insertBefore(h, hr ? hr.nextSibling : null); }
  // hlídání vlákna hry (hlášení zadavatele: level 15 po dlouhém hraní hra stojí, stránka běží): stránka povoluje snímky, ale hra
  // 2 s žádný nedodá (karta vidět, bez pauzy, skoku, restartu) -> stav vlákna do logu (čeká / běží v kódu, adresa, kroky za 0,5 s)
  // a lišta ve hře: pokračovat od poslední zálohy, stáhnout zálohu pro ladění
  const wd = { done: -1, t: 0, fired: false };
  function watchdog(paused) {
    if (!M || !M._engine_dbg_pc || paused || jumpTo || restarting || !running) { wd.t = 0; return; }
    const done = M._engine_done(), now = performance.now();
    if (done !== wd.done) { wd.done = done; wd.t = now; if (wd.fired) { wd.fired = false; $('stall').hidden = true; } return; }
    if (!wd.t || wd.fired || now - wd.t < 2000 || !(PACE.granted > done)) return;
    wd.fired = true; const pc0 = M._engine_dbg_pc(), n0 = M._engine_dbg_pcn(), w = M._engine_waiting(), f = M._engine_dbg_frame();
    setTimeout(() => {
      const pc1 = M._engine_dbg_pc(), dn = (M._engine_dbg_pcn() - n0) >>> 0, hx = (v) => '$' + (v >>> 0).toString(16).padStart(6, '0');
      const st = w ? 'waiting for permission' : dn ? 'running game code (' + dn + ' steps in 0.5 s, address ' + hx(pc0) + ' → ' + hx(pc1) + ')' : 'stuck (no step in 0.5 s, address ' + hx(pc1) + ')';
      const a = M._engine_as_n ? M._engine_as_frame(0) : -1;
      log('game stopped: frame ' + f + ', level ' + levelNo(level) + ', thread ' + st + (a >= 0 ? ', last backup from frame ' + a : '') + ' (Debug → Stall)');
      $('stall-text').textContent = 'The game has stopped. ' + (a >= 0 ? 'The last save point is ' + ((f - a) / 50).toFixed(0) + ' s old.' : '');
      $('stall').hidden = false;
    }, 500);
  }
  { const bar = document.createElement('div'); bar.id = 'stall'; bar.hidden = true; bar.className = 'stall';
    bar.innerHTML = '<span id="stall-text"></span> <button type="button" id="stall-go">Resume from save point</button> <button type="button" id="stall-dl">Download save for debugging</button>';
    game.appendChild(bar);
    $('stall-go').onclick = () => { if (!M || !M._engine_as_len || !M._engine_as_len(0)) return; const p = M._engine_as_buf(0), b = M.HEAPU8.slice(p, p + M._engine_as_len(0));
      $('stall').hidden = true; wd.fired = false; log('continuing from the backup of frame ' + M._engine_as_frame(0)); startFrom(b, 'backup'); };
    $('stall-dl').onclick = () => { const b = $('dbg-as0'); if (b) b.click(); };
    if (!$('diagnostics')) $('stall-dl').hidden = true;   // publikace: bez stažení zálohy pro ladění
  }
  // skrytý ukazatel myši nad hrou (zadavatel): po 2 s hraní bez pohybu myši zmizí, po pohybu se ukáže na 2 s; ne v menu,
  // dialogu ani v pauze; mimo plochu hry (lišta, menu) nikdy
  { let lastMove = 0, playT = 0, over = false; const area = $('stage');
    area.addEventListener('pointerenter', () => { over = true; }); area.addEventListener('pointerleave', () => { over = false; area.classList.remove('nocursor'); });
    addEventListener('pointermove', () => { lastMove = performance.now(); area.classList.remove('nocursor'); }, true);
    setInterval(() => {
      const play = running && !manualPause && !menuPause && !document.hidden && !shell.busy && $('intro').hidden && $('about-shade').hidden && $('stall').hidden;
      if (!play) { playT = 0; area.classList.remove('nocursor'); return; }
      const now = performance.now(); if (!playT) playT = now;
      const hideAt = Math.max(playT + 2000, lastMove ? lastMove + 2000 : 0);   // zadavatel: 2 s po začátku hraní a po pohybu
      area.classList.toggle('nocursor', over && now >= hideAt);
    }, 250);
  }
  // Ladění → Zaseknutí (hlášení zadavatele, level 15): stav vlákna hry (snímek, čeká na stránku / běží v kódu, adresa a rozsah
  // adres za 2 s) a stažení průběžné zálohy stavu (každých 250 snímků na začátku průchodu hlavní smyčky) + vstupu od ní dál;
  // nativně: INLOG=vstup.txt build/m8/run_game zaloha.bin N (přehrání ověřeno: paměť bitově shodná, M22)
  // Ladění → Level: hra sama projde levely až k cíli (engine_jump_level: fire na obrazovkách mezi levely, každý level
  // dokončen, jakmile se v něm hraje), zrychleně bez obrazu a zvuku; level dřív nebo stejný = nejdřív start z disket.
  let jumpTo = 0;
  function jumpStep() {
    if (!M._engine_jumping()) {
      // povolení ze skoku (hotovo + 24) vzít zpět a snímky, které hra díky němu už spočítala, přeskočit (bez obrazu, jako
      // celý skok): jinak dostanou časy teď, teď + 20 ms, ... a časová osa zůstane napřed (změřeno: náskok hry po skoku
      // 140-170 ms místo ~0, o tolik pozdější reakce na klávesy)
      M._engine_allow(M._engine_done()); got = M._engine_done();
      jumpTo = 0; frames = []; hist = hist.slice(-1); passT.clear(); PACE.maxPass = -1; PACE.lastPassT = -1; PACE.lens = []; PACE.tgN.fill(-1); PACE.lastT = 0; PACE.clock = 0; PACE.granted = M._engine_done(); audioFlush();
      log('skok hotov: level ' + levelNo(level)); return false;
    }
    pump();
    if (frames.length) { hist.push(frames[frames.length - 1]); frames = []; if (hist.length > 4) hist.splice(0, hist.length - 4); present(true, hist[hist.length - 1].t); }
    M._engine_allow(M._engine_done() + 24); if (M._engine_waiting() && M.__engineResume) M.__engineResume();   // kruh záznamů enginu má 32 snímků
    setStatus('Jumping to level ' + levelNo(jumpTo) + ' · now level ' + levelNo(level));
    return true;
  }
  // Ladění → Výhled Vylepšeno: rozšíření z mapy levelu (engine nejvýš ±96 × ±48), výchozí 522 × 357; uložené v prohlížeči
  // výhled Vylepšeno pevně 522 × 357 (zadavatel: jen dvě rozlišení, Original a Enhanced)
  // Ladění → Výkon: po sekundách snímky displeje a vypadlé (interval rAF nad 1,5 periody displeje), výpočet hry (od probuzení
  // korutiny Module.__engineResume do dalšího uspání v js_wait), skládání vlastního obrazu (view.h + nahrání), plátno
  // (blit, posun vrstvy) a celá smyčka stránky. Filtr CSS a skládání vrstev dělá prohlížeč mimo měření (vidět jen jako vypadlé).
  function monWrap(m) {
    let r = null, t = 0;
    Object.defineProperty(m, '__engineResume', { configurable: true,
      get() { return r ? () => { t = performance.now(); r(); } : null; },
      set(v) { if (v && t) { const d = performance.now() - t; mon.game += d; if (d > mon.gameMax) mon.gameMax = d; t = 0; } r = v; } });
  }
  const monHist = []; let monSec = null;
  const fmt = (x, k = 1) => x.toLocaleString('cs', { minimumFractionDigits: k, maximumFractionDigits: k });
  mon.hook = (ts, loopMs) => {
    if (manualPause || menuPause || document.hidden || jumpTo || restarting) {   // pauza, menu, skok: nepočítat
      pw.t0 = 0; pw.lowD = pw.lowG = 0; monSec = null; mon.game = mon.gameMax = mon.gf = mon.passes = mon.view = mon.paint = mon.vr = mon.sN = mon.sNoB = mon.sNoOB = mon.sExt = mon.aheadSum = mon.aheadN = 0; jerk.n = jerk.sum = jerk.big = 0; return; }
    if (!monSec) monSec = { t0: ts, last: ts, dts: [], loop: 0, loopMax: 0, n: 0 };
    const S = monSec; if (ts > S.last) S.dts.push(ts - S.last);
    if (PACE.lastT) { mon.aheadSum += PACE.lastT - performance.now(); mon.aheadN++; } S.last = ts; S.loop += loopMs; if (loopMs > S.loopMax) S.loopMax = loopMs; S.n++;
    if (ts - S.t0 < 1000) return;
    const per = vs.hz ? 1000 / vs.hz : [...S.dts].sort((a, b) => a - b)[S.dts.length >> 1] || 16.7;
    const r = { hz: vs.hz, fps: S.dts.length, drops: S.dts.filter((d) => d > 1.5 * per).length, maxInt: Math.max(0, ...S.dts),
      gf: mon.gf, passes: mon.passes, game: mon.gf ? mon.game / mon.gf : 0, gameMax: mon.gameMax, gameLoad: mon.game / (ts - S.t0) * 100,
      lead: audioSt.fill || 0, out: audio ? 1000 * ((audio.outputLatency || 0) + (audio.baseLatency || 0)) : 0, latC: mon.latC || 0, latO: mon.latO || 0, under: (audioSt.under || 0) - mon.under0,
      ahead: mon.aheadN ? mon.aheadSum / mon.aheadN : 0,
      jerk: jerk.n ? jerk.sum / jerk.n : 0, jerkBig: jerk.n ? 100 * jerk.big / jerk.n : 0, jerkN: jerk.n,
      lt: mon.lt.splice(0, mon.lt.length), noB: mon.sN ? 100 * mon.sNoB / mon.sN : 0, noOB: mon.sN ? 100 * mon.sNoOB / mon.sN : 0, ext: mon.sN ? 100 * mon.sExt / mon.sN : 0, view: mon.vr / S.n, up: Math.max(0, mon.view - mon.vr - mon.paint) / S.n, paint: mon.paint / S.n, loop: S.loop / S.n, loopMax: S.loopMax, budget: per };
    monHist.push(r); if (monHist.length > 30) monHist.shift(); mon.under0 = audioSt.under || 0; perfWatch(r);
    mon.game = mon.gameMax = mon.gf = mon.passes = mon.view = mon.paint = mon.vr = mon.sN = mon.sNoB = mon.sNoOB = mon.sExt = mon.aheadSum = mon.aheadN = 0; jerk.n = jerk.sum = jerk.big = 0; monSec = { t0: ts, last: ts, dts: [], loop: 0, loopMax: 0, n: 0 };
    monShow();
  };
  function monShow() {
    if (!$('mon-out')) return;                             // publikace: panel Ladění není
    const n = Math.min(10, monHist.length), h = monHist.slice(-n), a = (k) => h.reduce((x, r) => x + r[k], 0) / Math.max(1, n);
    $('mon-out').textContent = !n ? 'nothing yet: measured only while playing (not paused, no menu open)' :
      'last second of play:\n' + monText(monHist[monHist.length - 1]) + '\n\naverage over ' + n + ' s of play: dropped ' + h.reduce((x, r) => x + r.drops, 0) +
      ' frames, picture behind the game: camera ' + fmt(a('latC'), 0) + ' ms, objects ' + fmt(a('latO'), 0) + ' ms, audio buffer ' + fmt(a('lead'), 0) + ' ms, audio underruns ' + h.reduce((x, r) => x + r.under, 0) + ', game ' + fmt(a('game'), 2) + ' ms per frame, compose ' + fmt(a('view'), 2) + ' ms, canvas ' + fmt(a('paint'), 2) + ' ms, loop ' + fmt(a('loop'), 2) + ' ms';
  }
  // hlídání výkonu (zadavatel: „zpomalování asi vzniká v Chromu“): prohlížeč 2 s kreslí méně než 3/4 dosud nejvyššího počtu
  // snímků (úspora energie, baterie), nebo hra 3 s dodá méně než 45 snímků/s -> protokol a poznámka ve hře na 8 s (každý druh
  // nejvýš jednou za minutu; ne prvních 5 s hry). Vlákno hry počítá většinu času = počítač nestíhá, jinak hru brzdí prohlížeč.
  const pw = { best: 0, lowD: 0, lowG: 0, t0: 0, said: {}, h: 0 };
  function perfWatch(r) {
    const now = performance.now(); if (!pw.t0) pw.t0 = now;
    if (r.fps > pw.best) pw.best = r.fps;
    pw.lowD = pw.best >= 50 && r.fps < 0.75 * pw.best ? pw.lowD + 1 : 0;
    pw.lowG = r.gf > 0 && r.gf < 45 ? pw.lowG + 1 : 0;
    if (now - pw.t0 < 5000) return;
    const say = (k, t, hint) => {
      if (pw.said[k] && now - pw.said[k] < 60000) return; pw.said[k] = now; log('performance: ' + t);
      if (navigator.webdriver) return; const el = $('perf-hint'); el.textContent = hint; el.hidden = false; clearTimeout(pw.h); pw.h = setTimeout(() => { el.hidden = true; }, 8000);
    };
    if (pw.lowD >= 2) say('disp', 'browser draws only ' + r.fps + ' frames/s (best ' + pw.best + ') – limited by the browser or the system (energy saving, battery)',
      'The browser now draws only ' + r.fps + ' frames per second – probably energy saving (Chrome: Settings → Performance) or battery.');
    if (pw.lowG >= 3) {
      const busy = r.game * r.gf / 10, how = r.game > 0 ? ', game thread computes ' + fmt(r.game, 2) + ' ms per frame (' + fmt(busy, 0) + ' % of the time)' : '';
      if (r.game > 0 && busy > 80) say('cpu', 'game made only ' + r.gf + ' frames/s' + how + ' – the computer cannot keep up or is slowed down (energy saving, heat)',
        'The game cannot keep up (' + r.gf + ' frames per second instead of 50) – the computer is busy or slowed down (energy saving, battery, heat).');
      else say('game', 'game made only ' + r.gf + ' frames/s' + how + ' – the game waits, held back by the browser (energy saving, background tab, other tabs)',
        'The game runs slower (' + r.gf + ' frames per second instead of 50) – the browser holds it back, probably energy saving (Chrome: Settings → Performance).');
    }
  }
  { const el = document.createElement('div'); el.id = 'perf-hint'; el.hidden = true; el.className = 'stall perfhint'; game.appendChild(el); }
  const monText = (r) => 'display ' + fmt(r.hz) + ' Hz (' + fmt(r.budget) + ' ms per frame) · frames ' + r.fps + '/s · dropped ' + r.drops + ' (longest ' + fmt(r.maxInt) + ' ms)\n' +
    'game ' + r.gf + ' frames/s, ' + (r.passes || 0) + ' main loop passes/s · ' + fmt(r.game, 2) + ' ms per frame (max ' + fmt(r.gameMax) + ' ms at once, ' + fmt(r.gameLoad) + ' % of the time)\n' +
    'game ahead ' + fmt(r.ahead || 0, 0) + ' ms · picture behind the game: camera ' + fmt(r.latC, 0) + ' ms, objects ' + fmt(r.latO, 0) + ' ms · audio: buffer ' + fmt(r.lead, 0) + ' ms + browser output ' + fmt(r.out || 0, 0) + ' ms, underruns ' + r.under + '\n' +
    (r.lt && r.lt.length ? 'long browser tasks: ' + r.lt.length + ' (longest ' + fmt(Math.max(...r.lt.map((x) => x.d)), 0) + ' ms: ' + r.lt.reduce((a, b) => (b.d > a.d ? b : a)).who + ')\n' : '') +
    'in-betweens: next frame missing (camera) ' + fmt(r.noB, 1) + ' %, next pass missing (objects) ' + fmt(r.noOB, 1) + ' %, extrapolated ' + fmt(r.ext || 0, 1) + ' % of display frames\n' +
    (r.jerkN ? 'object motion (WebGL): step unevenness ' + fmt(r.jerk, 2) + ' game px, jump > 0.5 px in ' + fmt(r.jerkBig, 1) + ' % of steps (' + r.jerkN + ')\n' : '') +
    'compose (view.h) ' + fmt(r.view, 2) + ' ms · upload ' + fmt(r.up, 2) + ' ms · canvas ' + fmt(r.paint, 2) + ' ms · page loop ' + fmt(r.loop, 2) + ' ms (max ' + fmt(r.loopMax) + ' ms) per display frame';
  function monReport() {
    const d = menu.getMode(modeOf(), 'display'), n = monHist.length || 1, sum = (k) => monHist.reduce((a, r) => a + r[k], 0), mx = (k) => Math.max(0, ...monHist.map((r) => r[k]));
    const env = ['browser ' + navigator.userAgent, 'devicePixelRatio ' + dprNow() + ', window ' + innerWidth + ' × ' + innerHeight + ', screen ' + screen.width + ' × ' + screen.height + ' device px (×' + disp.S + ')',
      'mode ' + modeOf() + ', view ' + curW() + ' × ' + curH() + ', smooth ' + (d.smooth ? 'yes' : 'no') + ', zoom ' + (d.zoom ? fmt(d.zoom, 2) + '×' : 'fit') + ', CRT ' + (d.crt ? d['crt-detail'] + ' ' + d['crt-shape'] : 'no') + ', blur ' + d.blur + ' %, brightness ' + d.brightness + ' %, pixel width ' + d.par,
      'engine ' + (MT ? 'in its own thread (shared memory)' : 'in the main thread (coroutine)') + ', audio: buffer target ' + (MT ? AUD.mt.target : AUD.msg.target) + ' ms, browser output ' + (audio ? fmt(1000 * ((audio.outputLatency || 0) + (audio.baseLatency || 0)), 0) : '?') + ' ms',
      'pacing ' + (vs.k ? 'by the display ' + vs.k + ':1' : '50 Hz game clock, in-betweens') + ' (setting ' + vs.pref + '), level ' + levelNo(level) + (M && M._engine_peek8 ? ', ' + $('w-now').textContent : '')];
    const lts = monHist.flatMap((r) => r.lt || []);
    const avg = 'average over ' + monHist.length + ' s: frames ' + fmt(sum('fps') / n) + '/s, dropped in total ' + sum('drops') + ' (longest ' + fmt(mx('maxInt')) + ' ms); picture behind: camera ' + fmt(sum('latC') / n, 0) + ' ms, objects ' + fmt(sum('latO') / n, 0) + ' ms; audio buffer ' + fmt(sum('lead') / n, 0) + ' ms, audio underruns ' + sum('under') + ' (dropped ' + (audioSt.drop || 0) + ' samples); long browser tasks ' + lts.length + (lts.length ? ' [' + lts.map((x) => fmt(x.d, 0) + ' ms ' + x.who).join('; ') + ']' : '') + '; game ' + fmt(sum('game') / n, 2) + ' ms per frame (max ' + fmt(mx('gameMax')) + ' ms), compose ' + fmt(sum('view') / n, 2) + ' ms, canvas ' + fmt(sum('paint') / n, 2) + ' ms, loop ' + fmt(sum('loop') / n, 2) + ' ms (max ' + fmt(mx('loopMax')) + ' ms)';
    return ['Alien Breed II – performance measurement', ...env, avg, 'per second:', ...monHist.map((r, i) => (i + 1) + '. ' + monText(r).replace(/\n/g, ' | '))].join('\n');
  }
  let workMs = 0, workN = 0, statT = 0;
  // hotové snímky z korutiny hry (obraz = záznam view.h, zvuk z kruhu), časy podle zvukových hodin
  let level = 0;
  function pump() {
    const done = M._engine_done(), ring = M._engine_aud_ring() >> 1, asz = M._engine_aud_size();
    while (got < done) {
      const n = got++, rec = M._engine_fr_rec(n), pass = M._engine_rec_pass(rec), an = M._engine_fr_naud(n), a0 = M._engine_fr_aud0(n);
      const ix = (n + 1) & 255; let tms = PACE.tgN[ix] === n + 1 ? PACE.tg[ix] : (PACE.lastT ? PACE.lastT + 1000 / FPS : performance.now());
      if (PACE.lastT && tms < PACE.lastT + 1) tms = PACE.lastT + 1; PACE.lastT = tms;
      const f = { t: tms / 1000, rec, pass, ok: !!M._engine_rec_ok(rec) };
      // starší průchod až po novějším (zřídka v prohlížeči, ~1 snímek z 1 500) do osy průchodů ne: jinak čas příštího průchodu < času
      // tohoto a mezipoloha objektů vypadne (arek web smooth: missing); velký skok zpět = nový level / restart: osa znovu
      if (f.ok && !passT.has(pass) && !(pass < PACE.maxPass && PACE.maxPass - pass < 16)) { PACE.maxPass = pass; passT.set(pass, f.t); if (PACE.lastPassT >= 0) { PACE.lens.push((f.t - PACE.lastPassT) * 1000); if (PACE.lens.length > 16) PACE.lens.shift(); } PACE.lastPassT = f.t; }
      frames.push(f); workN++; mon.gf++; if (f.ok && pass !== mon.lastPass) { mon.lastPass = pass; mon.passes++; }   // průchody hlavní smyčky hry (normálně 25/s)
      if (MT && M._engine_fr_ms) { const ms = M._engine_fr_ms(n); if (ms >= 0) { mon.game += ms; if (ms > mon.gameMax) mon.gameMax = ms; } }   // výpočet snímku ve vlákně hry
      const lv = M._engine_fr_level(n); if (lv !== level) { level = lv; log('level ' + lv + ' (frame ' + M._engine_fr_frame(n) + ')'); }
      if (an > 0 && audioNode && !MT && !jumpTo) {
        const b = new Int16Array(an * 2), s = M.HEAP16;
        for (let i = 0; i < an; i++) { const w = (a0 + i) % asz; b[2 * i] = s[ring + 2 * w]; b[2 * i + 1] = s[ring + 2 * w + 1]; }
        audioNode.port.postMessage(b, [b.buffer]);
      }
      const led = M._engine_fr_led(n) !== 0; if (led !== lastLed) { lastLed = led; if (zvuk) WBZVUK.apply(zvuk, toSound(menu.getMode(disp.mode, 'sound')), led); }
    }
    if (passT.size > 64) for (const k of [...passT.keys()].slice(0, passT.size - 32)) passT.delete(k);
    pollSnap();
    const e = M._engine_error();
    if (e) { setStatus('Error: routine $' + e.toString(16) + ' is not translated'); log('game stopped: routine $' + e.toString(16) + ' is not translated'); running = false; }
    if (M._engine_ended() && !levelDone && got >= done) {   // publikace: hra skončila po posledním povoleném levelu
      levelDone = true; running = false; log('end of the preview (public build)'); setStatus('End of the preview – thanks for playing!'); if ($('preview-end')) $('preview-end').hidden = false; shell.openDialog('about-shade');
    }
  }
  // takt podle displeje (bod 8): displej k × 50 Hz (50, 100, 150, 200 Hz; změřeno z requestAnimationFrame) -> přesně jeden snímek
  // hry na k snímků displeje, bez rázů 49,92 / 50 Hz (jinak každých ~12 s zdvojený snímek); zvuk souvisle, rychlost přehrávání
  // (hz / k) / 49,92 doladěná podle zásoby ve frontě. Jiný displej (60, 120, 144 Hz…): takt podle zvukových hodin a mezipolohy.
  const vs = { dts: [], last: 0, hz: 0, k: 0, cnt: 0, n: 0, rate: 1, force: /[?&]lock\b/.test(location.search) };
  try { vs.pref = localStorage.getItem('abii-pace') || 'auto'; } catch (e) { vs.pref = 'auto'; }
  { const panel = $('game-panel'), hr = panel.querySelector('hr'), l = document.createElement('label');
    l.innerHTML = 'Frame pacing <select id="pace"><option value="auto">auto (locked on 50 / 100 / 150 / 200 Hz displays)</option><option value="audio">always the 50 Hz game clock</option></select>';
    panel.insertBefore(l, hr); const sel = l.querySelector('select'); sel.value = vs.pref;
    sel.onchange = () => { vs.pref = sel.value; try { localStorage.setItem('abii-pace', vs.pref); } catch (e) {} }; }
  // takt viditelně ve stavové liště (Ladění má podrobnosti): displej a jak se na něj kladou snímky hry
  const paceTxt = () => !vs.hz ? '' : vs.k ? ' · displej ' + vs.hz.toFixed(1) + ' Hz, takt ' + vs.k + ':1' : ' · displej ' + vs.hz.toFixed(0) + ' Hz, ' + (menu.getMode(modeOf(), 'display').smooth ? 'mezipolohy' : 'bez mezipoloh');
  function measureHz(ts) {
    if (vs.last) { const d = ts - vs.last; if (d > 3 && d < 45) { vs.dts.push(d); if (vs.dts.length > 120) vs.dts.shift(); } }
    vs.last = ts;
    if (vs.dts.length < 60 || vs.cnt % 30) return;
    const med = [...vs.dts].sort((a, b) => a - b)[vs.dts.length >> 1]; vs.hz = 1000 / med;
    let k = vs.pref === 'audio' ? 0 : [1, 2, 3, 4].find((j) => Math.abs(vs.hz / j - 50) < 0.6) || 0;
    if (vs.force) k = 1;
    if (k !== vs.k) { vs.k = k; PACE.clock = 0; log(k ? 'pacing by the display: ' + vs.hz.toFixed(2) + ' Hz, ' + k + ' display frame' + (k === 1 ? '' : 's') + ' per game frame' : 'pacing: 50 Hz game clock from a ' + vs.hz.toFixed(1) + ' Hz display, in-betweens'); }
  }
  function loop(ts) { const t0 = performance.now(); glGuardStep(ts, sub.gl && running && !manualPause && !menuPause && !document.hidden && !restarting && !(typeof jumpTo !== 'undefined' && jumpTo)); loopIn(ts); const d = performance.now() - t0; perf.loop += d; perf.ln++; if (mon.hook) mon.hook(ts, d); }
  function loopIn(ts) {
    if (!running) return;
    vs.cnt++; measureHz(ts);
    if (jumpTo && M && !restarting && jumpStep()) { requestAnimationFrame(loop); return; }
    syncClock();
    { const p = pads; p.poll(); p.syncUi($('gamepad'), $('gamepad-fire'), $('gamepad-status')); }
    if (restarting || !M) { requestAnimationFrame(loop); return; }
    if (measureGod) { M._engine_poke8(0xc00fb6, 0); M._engine_poke8(0xc00fb7, 1); }   // měření: hráč bez zranění (prepare)
    M._engine_keys(manualPause || menuPause ? 0 : keys());
    if (M._engine_keys2) M._engine_keys2(manualPause || menuPause ? 0 : keys2());
    pump();
    if (!running) return;
    const paused = manualPause || menuPause || document.hidden;
    // pauza: vlákno hry nesmí počítat ani kvůli zásobě zvuku (pojistka G_ALOW) - jinak při P stál jen hráč (vstup 0) a zbytek hry
    // jel dál (hlášení zadavatele); po pauze pojistka zpět
    if (MT && paused !== PACE.pausedAud) { PACE.pausedAud = paused; if (M._engine_aud_low) M._engine_aud_low(paused ? 0 : Math.round(AUD.mt.low * 48)); }
    watchdog(paused);
    const FM = vs.k ? 1000 * vs.k / vs.hz : 1000 / FPS;     // displej k × 50 Hz: přesně jeden snímek hry na k snímků displeje
    if (paused) PACE.clock = 0;
    else {
      if (!PACE.clock || ts - PACE.clock > 5 * FM) PACE.clock = ts;   // start, návrat z pauzy, pomalý stroj: hodiny od teď (bez dohánění)
      const done = M._engine_done(); let g = Math.max(PACE.granted, done);
      if (done > PACE.granted && PACE.lastT + FM > PACE.clock) PACE.clock = PACE.lastT + FM;   // hra přeběhla povolení: navázat za ni
      while (PACE.clock <= ts + FM) { if (g < done + PACE.AHEAD) { g++; PACE.tg[g & 255] = PACE.clock; PACE.tgN[g & 255] = g; } PACE.clock += FM; }
      if (g > PACE.granted) {
        PACE.granted = g; const t0 = performance.now(); M._engine_allow(g);
        if (M._engine_waiting() && M.__engineResume) M.__engineResume();   // hra pokračuje v mikroúloze, snímky v dalším kole
        workMs += performance.now() - t0;
      }
    }
    // obraz pozadu za časem hry; zamčený takt: kamera o necelý snímek (přesné snímky hry), objekty o snímek víc
    const lo = latOStep(ts), latC = vs.k ? FM - 2 : PACE.LATC, latO = vs.k ? Math.max(lo, 2 * FM - 2) : lo;
    const tv = (ts - latC) / 1000, tvO = (ts - latO) / 1000;
    mon.latC = latC; mon.latO = latO;
    let fresh = false;
    while (frames.length && frames[0].t <= tv) { hist.push(frames.shift()); fresh = true; }
    if (hist.length > 8) hist.splice(0, hist.length - 8);     // záznamy enginu jsou v kruhu (32), starší snímky netřeba
    if (!disp.testFill) present(fresh, tv, tvO);
    if (performance.now() - statT > 1000) {
      statT = performance.now();
      setStatus('Playing · level ' + levelNo(level) + (vs.hz ? ' · ' + vs.hz.toFixed(0) + ' Hz' + (vs.k ? ' locked' : '') : ''));
      if ($('frame-status')) $('frame-status').textContent = 'game frames ' + workN + '/s · ' + (vs.k ? 'paced by the display ' + vs.hz.toFixed(2) + ' Hz (' + vs.k + ':1)' : '50 Hz game clock') + ' · picture ' + (viewN ? (viewMs / viewN).toFixed(2) + ' ms per display frame (' + viewN + '/s)' : 'original frame') + ' · audio ' + (clockAudio ? 'running, buffer ' + Math.round(audioSt.fill || 0) + ' ms' : 'waiting for a click') + ' · LED filter ' + (lastLed ? 'on' : 'off');
      workMs = 0; workN = 0; viewMs = 0; viewN = 0;
    }
    requestAnimationFrame(loop);
  }

  // co ukázat: Vylepšeno a Plynulé zobrazení = vlastní obraz na každý snímek displeje; jinak snímek originálu, když přijde nový
  function present(fresh, t = now(), tO = t) {
    const A = hist[hist.length - 1]; if (!A || !M) return;
    const m = modeOf(), smooth = !!menu.getMode(m, 'display').smooth;
    if (m === 'enhanced' || smooth || disp.anim) showView(A, frames[0], t, smooth || !!disp.anim, tO);
    else if (fresh || lastPx !== A) showFrame(A);
  }

  // ladění a kouřová zkouška (tools/web_smoke.py): jen čtení stavu
  // kontrola WebGL: poslední snímek bez mezipoloh složený enginem vs WebGL při S = 1 -> počet rozdílných bodů
  function glCheck() {
    const A = hist[hist.length - 1]; if (!A || !M || !glv.on || !M._engine_view_split) return null; const [ex, ey] = extNow();
    M._engine_view_split(0); if (M._engine_view_render(A.rec, A.rec, 0, A.rec, -1, 0, ex, ey) !== 0) { M._engine_view_split(sub.gl ? (GTQ ? 2 : 1) : 0); return null; }
    const lw = M._engine_view_lw(), lh = M._engine_view_lh(), lp = M._engine_view_layer(), w = M._engine_view_w(), ref = M.HEAPU8.slice(lp, lp + lw * lh * 4);
    const gt = GTQ && !!M._engine_gt_atlas; M._engine_view_split(gt ? 2 : 1); M._engine_view_render(A.rec, A.rec, 0, A.rec, -1, 0, ex, ey);
    const gc = GL.render(M, { W: w, LW: lw, LH: lh, S: 1, fx: 0, fy: 0, lv: level, gt }), px = gc ? GL.read() : null; bandQ = null; M._engine_view_split(sub.gl ? (GTQ ? 2 : 1) : 0);
    if (!px) return null; let bad = 0;
    for (let y = 0; y < lh - 1; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, j = (y * lw + x) * 4; if (px[i] !== ref[j] || px[i + 1] !== ref[j + 1] || px[i + 2] !== ref[j + 2]) bad++; }
    return { pixels: w * (lh - 1), bad, objs: GL.stats.objs, sprs: GL.stats.sprs, cache: GL.cacheSize(), frame: A.rec };
  }
  // arek web longrun (kit): plynulost delsi hry - hra běží s vlastním obrazem, kamera v bodech hry, stavový řádek
  // háčky měření kitu (WBLONGRUN 1.1, arek web longrun / smooth): kamera výhledu a objekty v bodech hry (zlomky při mezipoloze),
  // snímky displeje bez příštího průchodu pro mezipolohu (kumulativně), náskok hry ve snímcích, zvuk
  // měření (prepare, zadavatel 2026-10-29: pro testování smí stránka hru měnit): hráč bez zranění - slovo $C00FB6 ≠ 0 obsluha
  // zásahu ($C2517C) přeskočí; změřeno: 3000 snímků náhodné hry 0 ztracených životů (bez něj 3), obraz až do prvního zásahu
  // shodný (jen nezmizí energie). Bez prepare se hra nemění.
  let measureGod = false;
  const objGen = new Map();
  globalThis.WBLONGRUN = { ready: () => !!(running && (sub.gl || sub.on)), cam: () => (M ? [M._engine_view_camx(), M._engine_view_camy()] : [0, 0]), status: () => $('status') ? $('status').textContent : '',
    // identita = slot objektu + generace: hra slot po zničení objektu použije pro jiný (skok o desítky bodů) - nový objekt
    objs: () => { const r = [], tr = GL.track, S = disp.S || 1; if (!sub.gl) return r;
      for (let i = 0; i < tr.n; i++) { const rec = tr.rec[i], x = tr.x[i] / S, y = tr.y[i] / S; let g = objGen.get(rec);
        if (!g) { g = { x, y, n: 0 }; objGen.set(rec, g); } else if (Math.abs(x - g.x) > 24 || Math.abs(y - g.y) > 24) g.n++;
        g.x = x; g.y = y; r.push([rec * 256 + (g.n & 255), x, y]); }
      return r; },
    missing: () => mon.missTot, ahead: () => (PACE.lastT ? (PACE.lastT - performance.now()) / 19.968 : 0),
    audio: () => ({ reserve: audioSt.fill || 0, dropouts: audioSt.under || 0, latency: audio ? 1000 * ((audio.outputLatency || 0) + (audio.baseLatency || 0)) : 0 }),
    keys: { left: 'ArrowLeft', right: 'ArrowRight' }, scale: () => disp.S || 1,   // celé pixely zařízení na bod hry (G44: tolerance 1/S)
    // ABRII je bludiště: na začátku levelu 1 stojí kamera hry na pravém kraji mapy a volno je ~3,2 s doleva (změřeno, M16)
    route: [['ArrowLeft', 2800], ['ArrowRight', 2800]] };
  // prepare (WBLONGRUN 1.1): do hry – Ladění → skok na level 1 (úvod a menu čekají na fire), pak Vylepšeno
  WBLONGRUN.prepare = async () => { measureGod = true; log('measurement: player invulnerable ($C00FB6)'); const wait = (f, ms) => new Promise((res, rej) => { const t0 = performance.now(), k = () => { if (f()) res(true); else if (performance.now() - t0 > ms) rej(new Error('prepare: timed out')); else setTimeout(k, 100); }; k(); }); await wait(() => running && !!M, 60000); if (!(level === 1 && !jumpTo && WBLONGRUN.ready())) { $('j-level').value = '1'; $('j-go').click(); await wait(() => level === 1 && !jumpTo && WBLONGRUN.ready(), 180000); } if (disp.mode !== 'enhanced') { switchMode('enhanced'); await wait(() => !disp.anim && disp.mode === 'enhanced', 5000); } await new Promise((r) => setTimeout(r, 1000)); return true; };
  window.abii = { peek: (a) => (M ? M._engine_peek8(a) : -1), poke: (a, v) => (M ? M._engine_poke8(a, v) : -1), dbgStop: () => (M && M._engine_stop ? M._engine_stop() : -1), mt: () => MT, ahead: () => (PACE.lastT ? PACE.lastT - performance.now() : 0), audioSt: () => Object.assign({}, audioSt), glCheck, gl: () => ({ on: glv.on, want: glv.want, active: sub.gl, webkit: WEBKIT, guard: Object.assign({}, glGuard), stats: Object.assign({}, GL.stats), cache: GL.cacheSize() }), width: () => curW(), height: () => curH(), sub: () => Object.assign({}, sub), cam: () => (M ? [M._engine_view_camx(), M._engine_view_camy()] : null), dbg: () => disp.dbg, aud: () => { const r = Object.assign({ state: audio ? audio.state : 'none', clock: clockAudio, gain: zvuk ? zvuk.volume.gain.value : null }, aud); aud.n = 0; aud.peak = 0; aud.late = 0; aud.skipped = 0; aud.maxN = 0; aud.maxAn = 0; aud.ticks = 0; r.last = aud.last.slice(); return r; }, running: () => running, perf: () => { const r = { paint: perf.paint / Math.max(1, perf.n), view: perf.view / Math.max(1, perf.ln), loop: perf.loop / Math.max(1, perf.ln), frames: perf.ln, lock: vs.k, hz: vs.hz }; perf.paint = perf.view = perf.loop = perf.n = perf.ln = 0; return r; }, frameNo: () => (M ? M._engine_frame_no() : -1), mode: () => modeOf(), led: () => (M ? M._engine_led() : null), audio: () => (audio ? audio.state : 'none') };

  // ---------------------------------------------------------------- start stránky
  menu.refreshZoom(); layout(); syncUi();
  (async () => {
    // ?disks=a.adf,b.adf,c.adf: diskety ze stejného původu (např. složka hry na serveru, jako Superfrog); ověří se jako
    // vložený soubor (otisk v pečeti / obsah), do prohlížeče se neukládají
    const urlDisks = (new URLSearchParams(location.search).get('disks') || '').split(',').filter(Boolean);
    if (urlDisks.length) {
      const got = [];
      for (const u of urlDisks) {
        const url = new URL(u, document.baseURI);   // proti <base>, jako ostatní relativní cesty stránky (mikdenik: adresa bez koncového lomítka)
        if (url.origin !== location.origin) { log(u + ': only disks from the same origin'); continue; }
        try { const r = await fetch(url); if (!r.ok) throw new Error(r.status); got.push({ name: decodeURIComponent(url.pathname.split('/').pop()), buf: await r.arrayBuffer() }); }
        catch (e) { log(u + ': cannot load (' + e.message + ')'); }
      }
      if (got.length) { disks = got.slice(-3); await showDisks(); setStatus('Disks from the address – Start game'); log('disks from the address: ' + got.map((d) => d.name).join(', ')); return; }
    }
    // vývoj na localhostu: diskety z arek web serve (bez výběru); jinak uložené v prohlížeči
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      try {
        const rs = await Promise.all(['disk1', 'disk2', 'disk3'].map((n) => fetch('local-disks/' + n + '.adf', { cache: 'no-store' })));
        if (rs[0].ok && rs[1].ok) { disks = await Promise.all(rs.filter((r) => r.ok).map(async (r, i) => ({ name: 'disk' + (i + 1) + '.adf (dev)', buf: await r.arrayBuffer() }))); await showDisks(); log('dev: disks from local/'); start(); return; }
      } catch (e) { /* bez vývojového serveru */ }
    }
    const saved = await loadDisks();
    if (saved && saved.length) { disks = saved; await showDisks(); setStatus('Disks from last time – Start game'); }
  })();
})();
