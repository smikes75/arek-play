// Zobrazení podle kontraktu „wb-shell obraz 1.2“ (WB-OBRAZ-CRT.md): celé pixely zařízení, CRT vrstva jako canvas v pixelech zařízení,
// režimy Originál / Vylepšeno, rozmazání a knoflíky monitoru, přechod 450 ms. Bez herních dat (jen geometrie a kreslení).
export const W0 = 336;                 // šířka Originálu (kontrakt: Superfrog 336)
export const GAME_W = 336, GAME_H = 262, HUD_H = 15;           // herní pixel = lowres pixel; výřez okna DIW (řádky 39–300): HUD 15 řádků + herní plocha 247
export const ENH_MX = 56, ENH_MY = 16, ENH_W = GAME_W + 2 * ENH_MX, ENH_H = GAME_H + 2 * ENH_MY;   // Vylepšeno: okraj z mapy levelu (engine/enh.c)
// „Výřez mapy“ (herní plocha bez HUD): Původní 336 × 247, Rozšířený 448 × 279
export const VIEWS = { orig: { w: GAME_W, gh: GAME_H - HUD_H, label: 'Původní' }, wide: { w: ENH_W, gh: GAME_H - HUD_H + 2 * ENH_MY, label: 'Rozšířený' } };
export const viewOfMode = mode => mode === 'enhanced' ? 'wide' : 'orig';
export const RAW_W = 716, RAW_H = 285, CROP_X = 44, CROP_Y = 13;   // výřez z RGB snímku enginu (hires x 2, řádky)
export const CRT_ROW = { fine: .30, standard: .42, strong: .50 };
export const CRT_SCREEN = { fine: 2, standard: 3, strong: 4 };
export const CRT_LINE = { original: { fine: .20, standard: .34, strong: .50 }, enhanced: { fine: .14, standard: .28, strong: .40 } };
export const CRT_RGB = { fine: .015, standard: .03, strong: .045 };
export const DEFAULTS = {
  original: { zoom: 2, crt: true, detail: 'strong', blur: 0, brightness: 100, contrast: 100, saturate: 100, blend: false, smooth: false, palfade: true, sprmid: true },
  enhanced: { zoom: 3, crt: true, detail: 'fine', blur: 20, brightness: 100, contrast: 100, saturate: 100, blend: false, smooth: true, palfade: true, sprmid: true },
};
export const ZOOMS = [1, 1.5, 2, 2.5, 3, 4, 6, 'fit'];

// --- čisté funkce (testovatelné s libovolným dpr) ---
export function scaleFor(zoom, fit, dpr, W = GAME_W) {      // kontrakt 1.3 (wb-obraz.js deviceScale): zoom omezený velikostí okna
  const floor = Math.max(1, Math.floor(fit * dpr + 1e-6));
  if (zoom === 'fit') return floor;
  return Math.min(Math.max(1, Math.round(zoom * W0 / W * dpr)), floor);
}
const WB = typeof WBOBRAZ !== 'undefined' ? WBOBRAZ : null;   // (const z klasického skriptu není vlastnost globalThis, jen globální jméno)   // referenční wb-obraz.js 1.3 (arek web copy, sha256 v docs/M7-OBRAZ.md): krok rozvržení, CRT
export function crtParams(mode, detail, S) {
  if (WB) return WB.crtParams(mode, detail, S);
  const P = mode === 'original' ? Math.max(2, S) : CRT_SCREEN[detail];
  const D = mode === 'original' ? Math.max(1, Math.round(P * CRT_ROW[detail])) : 1;
  return { P, D };
}
export function drawCrt(c, mode, detail, S, dpr, w, h, shape = 'lines') {   // w, h = backing v pixelech zařízení (kontrakt §2); shape lines | grid (1.3)
  if (WB) return WB.drawCrt(c, mode, detail, S, dpr, w, h, shape);
  const { P, D } = crtParams(mode, detail, S);
  const line = CRT_LINE[mode][detail], rgb = CRT_RGB[detail];
  c.width = w; c.height = h; c.style.width = w / dpr + 'px'; c.style.height = h / dpr + 'px';
  const g = c.getContext('2d'); g.clearRect(0, 0, w, h);
  ['255,0,0', '0,255,0', '0,0,255'].forEach((col, k) => { g.fillStyle = `rgba(${col},${rgb})`; for (let x = k; x < w; x += 3) g.fillRect(x, 0, 1, h); });
  g.fillStyle = `rgba(0,0,0,${line})`;
  for (let y = P - D; y < h; y += P) g.fillRect(0, y, w, D);
  return { P, D };
}
// bez filtru, když jsou všechny knoflíky neutrální (zbytečný kompozitní vrstva = riziko převzorkování při necelém dpr)
function filterFor(blur, b, c, s) {
  const parts = [];
  if (blur > 0) parts.push(`blur(${blur}px)`);
  if (b !== 100) parts.push(`brightness(${b}%)`); if (c !== 100) parts.push(`contrast(${c}%)`); if (s !== 100) parts.push(`saturate(${s}%)`);
  return parts.length ? parts.join(' ') : 'none';
}
const smoothstep = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

export class Display {
  constructor(root, { dpr = null, storageKey = 'sf-obraz' } = {}) {
    this.storageKey = storageKey;
    this.game = root; this.canvas = root.querySelector('#screen'); this.crt = root.querySelector('.crt-layer');
    this.off = document.createElement('canvas'); this.off.width = ENH_W; this.off.height = ENH_H;
    this.offctx = this.off.getContext('2d'); this.img = this.offctx.createImageData(ENH_W, ENH_H); this.img32 = new Uint32Array(this.img.data.buffer); this.orig32 = new Uint32Array(ENH_W * ENH_H); this.scene = null; this.smoothed = false;
    // plynulé vykreslení: svět (terén + objekty, o sloupec a řádek větší) a průhledná vrstva spritů
    this.world = document.createElement('canvas'); this.world.width = ENH_W + 1; this.world.height = ENH_H + 1; this.worldctx = this.world.getContext('2d'); this.worldImg = this.worldctx.createImageData(ENH_W + 1, ENH_H + 1); this.world32 = new Uint32Array(this.worldImg.data.buffer);
    this.ovl = document.createElement('canvas'); this.ovl.width = ENH_W; this.ovl.height = ENH_H; this.ovlctx = this.ovl.getContext('2d'); this.ovlImg = this.ovlctx.createImageData(ENH_W, ENH_H); this.ovl32 = new Uint32Array(this.ovlImg.data.buffer);
    this.med = document.createElement('canvas'); this.med.width = ENH_W; this.med.height = ENH_H; this.medctx = this.med.getContext('2d'); this.medImg = this.medctx.createImageData(ENH_W, ENH_H); this.med32 = new Uint32Array(this.medImg.data.buffer);   // medailonek: bez posunu
    this.prev = document.createElement('canvas'); this.prev.width = ENH_W; this.prev.height = ENH_H; this.prevctx = this.prev.getContext('2d'); this.frameTime = 0; this.havePrev = false;
    this.ctx = this.canvas.getContext('2d');
    this.dprOverride = dpr;                         // test: pevné dpr
    this.mode = 'original'; this.view = 'orig'; this.cfg = { original: { ...DEFAULTS.original }, enhanced: { ...DEFAULTS.enhanced } };
    this.load(); this.viewW = VIEWS[this.view].w; this.viewGH = VIEWS[this.view].gh; this.animating = false; this.crtKey = ''; this.info = {}; this.transition = null; this.lastDraw = null;
    this.stage = root.parentElement;
  }
  get dpr() { return this.dprOverride || window.devicePixelRatio || 1; }
  load() { try { const s = JSON.parse(localStorage.getItem(this.storageKey) || 'null'); if (s) { this.mode = s.mode || this.mode; this.view = VIEWS[s.view] ? s.view : viewOfMode(this.mode); for (const m of ['original', 'enhanced']) Object.assign(this.cfg[m], s.cfg?.[m] || {}); } else this.view = viewOfMode(this.mode); } catch (e) {} }
  save() { try { localStorage.setItem(this.storageKey, JSON.stringify({ mode: this.mode, view: this.view, cfg: this.cfg })); } catch (e) {} }
  get cur() { return this.cfg[this.mode]; }
  get viewH() { return HUD_H + this.viewGH; }          // celková výška zobrazeného výřezu (HUD + herní plocha)
  fitScale(W, H) {                                   // největší měřítko (CSS px na herní px), které se vejde do stage (bez vnitřního okraje 12 px)
    const st = this.stage, cs = st && getComputedStyle(st), padx = cs ? parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) : 0, pady = cs ? parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) : 0;
    const aw = Math.max(50, (st?.clientWidth || window.innerWidth) - padx), ah = Math.max(50, (st?.clientHeight || (window.innerHeight - 40)) - pady);
    return Math.min(aw / (W || this.viewW), ah / (H || this.viewH));
  }
  // set(mode, patch): režim (Originál/Vylepšeno) nastaví i výchozí výřez; setView(view) mění jen výřez
  set(mode, patch) { if (mode) { this.mode = mode; this.view = viewOfMode(mode); this.viewW = VIEWS[this.view].w; this.viewGH = VIEWS[this.view].gh; } if (patch) Object.assign(this.cfg[this.mode], patch); this.save(); this.layout(); }
  wantEnh() { return this.view === 'wide' || this.animating || this.wantScene(); }
  wantScene() { return !!this.cur.smooth && !!this.scene; }          // plynulé vykreslení (web/scene.js) potřebuje polohu v mapě z enginu
  wideHud() { return this.view === 'wide' || this.animating; }       // HUD přes celou šířku jen v širokém výřezu   // má engine počítat okraje z mapy?
  // rozvržení: S (celé), backing, CSS velikost, CRT, filtr, poloha na celém pixelu zařízení
  layout(over = null) {
    const dpr = this.dpr, c = over || this.cur, mode = over ? over._mode : this.mode;
    const W = over && over._W ? over._W : this.viewW, H = over && over._H ? over._H : this.viewH, fit = this.fitScale(W, H);
    const S = over && over._S ? over._S : scaleFor(c.zoom, fit, dpr, W);
    const cwc = Math.round(W * S), chc = Math.round(H * S);   // obsah (W·S × H·S pixelů zařízení), vlevo nahoře
    const bw = WB ? WB.padded(cwc, dpr) : cwc, bh = WB ? WB.padded(chc, dpr) : chc;   // 1.3: plátno i CRT zaokrouhlené na krok quantum(dpr), CSS velikost na celých CSS px
    this.content = { w: cwc, h: chc };
    const cv = this.canvas;
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    cv.style.width = bw / dpr + 'px'; cv.style.height = bh / dpr + 'px';
    this.game.style.width = bw / dpr + 'px'; this.game.style.height = bh / dpr + 'px';
    this.game.dataset.mode = mode; this.game.dataset.crt = c.detail;
    const blur = c.blur / 100 * 0.8 * S / dpr;
    cv.style.filter = filterFor(blur, c.brightness, c.contrast, c.saturate);
    this.game.style.setProperty('--crt-on', c.crt ? '1' : '0');
    const key = [bw, bh, S, dpr, mode, c.detail, c.shape].join('/');
    if (key !== this.crtKey) { this.crtKey = key; const r = drawCrt(this.crt, mode, c.detail, S, dpr, bw, bh, c.shape || 'lines'); this.crtP = r.P; this.crtD = r.D; }
    // poloha: levý horní roh obsahu na celém pixelu zařízení (§1.4) – posunem v rozvržení (position:relative), ne transform
    // (transform s necelým posuvem vytvoří kompozitní vrstvu a převzorkuje obsah: změřeno jako zdvojený řádek při dpr 1,25/1,5)
    this.fixPosition();
    this.S = S; this.fit = fit; this.drawLast();
    const eff = S / dpr * W / W0; const want = c.zoom === 'fit' ? null : c.zoom;   // zoom = šířka okna v násobcích šířky Originálu (kontrakt)
    this.label = want && Math.abs(eff - want) > 0.01 ? `${want}× · omezeno na ${eff.toLocaleString('cs', { maximumFractionDigits: 2 })}×` : `${eff.toLocaleString('cs', { maximumFractionDigits: 2 })}×`;
    this.info = { backing: { w: bw, h: bh }, content: { w: cwc, h: chc }, css: { w: bw / dpr, h: bh / dpr }, dpr, scale: S, W, H, crtP: this.crtP, crtD: this.crtD, mode, view: this.view, detail: c.detail, label: this.label };
    return this.info;
  }
  fixPosition() {
    // 1.3: levý horní roh obsahu na násobku kroku quantum(dpr) pixelů zařízení (= celé CSS px), posunem v rozvržení (left/top), nikdy transform
    const dpr = this.dpr, g = this.game; g.style.position = 'relative'; g.style.left = '0px'; g.style.top = '0px'; g.style.transform = ''; g.style.translate = '';
    const rc = this.canvas.getBoundingClientRect();
    const [fx, fy] = WB ? WB.snap(rc.left, rc.top, dpr) : [Math.round(rc.left * dpr) / dpr - rc.left, Math.round(rc.top * dpr) / dpr - rc.top];
    if (Math.abs(fx * dpr) > 0.005 || Math.abs(fy * dpr) > 0.005) { g.style.left = fx.toFixed(4) + 'px'; g.style.top = fy.toFixed(4) + 'px'; }
  }
  // předání snímku enginu (RGB24 716×285) -> buffer ENH_W × ENH_H: HUD nahoře, herní plocha o ENH_MY níž, okraje z mapy kolem (enh), nebo jen původní snímek doprostřed (null)
  present(rgb, enh = null) {
    const d = this.img.data;
    if (enh) {
      for (let i = 0, o = 0; i < ENH_W * ENH_H * 3; i += 3, o += 4) { d[o] = enh[i]; d[o + 1] = enh[i + 1]; d[o + 2] = enh[i + 2]; d[o + 3] = 255; }
    } else {
      for (let y = 0; y < GAME_H; y++) {
        let s = ((y + CROP_Y) * RAW_W + CROP_X) * 3, o = ((y < HUD_H ? y : y + ENH_MY) * ENH_W + ENH_MX) * 4;
        for (let x = 0; x < GAME_W; x++, s += 6, o += 4) { d[o] = rgb[s]; d[o + 1] = rgb[s + 1]; d[o + 2] = rgb[s + 2]; d[o + 3] = 255; }
      }
    }
    this.smoothed = false; this.presentSeq = this.scene ? Atomics.load(this.scene.ctl, 8) : 0; if (this.wantScene()) this.smoothApply(performance.now());
    this.prevctx.drawImage(this.off, 0, 0); this.havePrev = this.lastDraw === 'frame'; this.frameTime = performance.now();
    this.offctx.putImageData(this.img, 0, 0); this.lastDraw = 'frame'; this.drawLast();
  }
  // plynulé vykreslení: herní řádky z mapy v interpolované poloze kamery (HUD zůstává z posledního snímku hry); při neplatném balíčku zůstane původní snímek
  smoothApply(now) {
    const r = this.scene.draw(this.world32, this.ovl32, this.med32, performance.timeOrigin + now, this.wideHud(), { pal: !!this.cur.palfade, spr: !!this.cur.sprmid });
    this.smoothed = !!r; if (r) { this.frac = r; this.worldctx.putImageData(this.worldImg, 0, 0); this.ovlctx.putImageData(this.ovlImg, 0, 0); this.medctx.putImageData(this.medImg, 0, 0); }
  }
  tick(now) { if (!this.wantScene() || !this.lastDraw || this.lastDraw !== 'frame') return false; this.smoothApply(now); this.drawLast(); return true; }
  fill(color) { this.offctx.fillStyle = color; this.offctx.fillRect(0, 0, ENH_W, ENH_H); this.lastDraw = 'fill'; this.drawLast(); }
  // zobrazí HUD (šířka výřezu) a pod ním herní plochu o výšce viewGH vystředěnou kolem původní (animuje se při přepnutí výřezu)
  blit(src, alpha) {
    const cw = this.content ? this.content.w : this.canvas.width, ch = this.content ? this.content.h : this.canvas.height, vw = this.viewW, gh = this.viewGH, sx = (ENH_W - vw) / 2, sy = HUD_H + ENH_MY - (gh - (GAME_H - HUD_H)) / 2;
    const k = ch / (HUD_H + gh), c = this.ctx; c.globalAlpha = alpha;
    if (this.hudWide && src === this.off && (this.animating || vw < ENH_W - 0.5)) this.blitHudTransition(src, vw, cw, k);   // v bufferu HUD Rozšířeného výřezu, výřez užší (přechod nebo první snímky po něm): rozložení po úsecích, ne ořez
    else c.drawImage(src, sx, 0, vw, HUD_H, 0, 0, cw, HUD_H * k);
    if (this.smoothed && src === this.off) {          // plynulé: svět posunutý o zbytek polohy kamery (zaokrouhleno na pixel zařízení), nad ním sprity
      const fx = Math.round(this.frac.fx * k) / k, fy = Math.round(this.frac.fy * k) / k;
      c.drawImage(this.world, sx + fx, sy + fy, vw, gh, 0, HUD_H * k, cw, gh * k);
      const gx = Math.round(this.frac.sfx * k) / k, gy = Math.round(this.frac.sfy * k) / k;   // sprity (žába): necelý zbytek mezipolohy v pixelech zařízení
      c.drawImage(this.ovl, sx - gx, sy - gy, vw, gh, 0, HUD_H * k, cw, gh * k);
      if (this.wideHud()) c.drawImage(this.ovl, sx - gx, 0, vw, HUD_H, 0, 0, cw, HUD_H * k);   // žába při návratu přes HUD (jako v originále)
      // medailonek: ve vrstvě je v poloze širokého výřezu; posune se s pravým dolním rohem aktuálního výřezu (v obou výřezech na svém místě, při přechodu plynule)
      const mxs = ENH_W - (sx + vw), mys = ENH_H - (sy + gh);
      c.drawImage(this.med, sx + mxs, sy + mys, vw, gh, 0, HUD_H * k, cw, gh * k);
    } else c.drawImage(src, sx, sy, vw, gh, 0, HUD_H * k, cw, gh * k);
    c.globalAlpha = 1;
  }
  // HUD při přechodu Vylepšeno ↔ Originál: údaje (skóre + životy, energie + čas) drží velikost a plynule se posouvají, šikmé pruhy na krajích
  // a v mezeře se zkracují/prodlužují. Zdroj = HUD Rozšířeného výřezu (engine/enh.c: levá skupina +40, pravá +72, okraje 40 px, docs/M8-MAPA.md).
  blitHudTransition(src, vw, cw, k) {
    const c = this.ctx, e = Math.max(0, Math.min(1, (vw - GAME_W) / (ENH_W - GAME_W))), sc = cw / vw, L = 40, R = 72, SPLIT = 212;
    const part = (sx0, w, tx) => { if (w > 0.01) c.drawImage(src, sx0, 0, w, HUD_H, tx * sc, 0, w * sc, HUD_H * k); };
    const l = L * e, r = R * e, edge = 40 * e;
    c.drawImage(src, 0, 0, ENH_W, HUD_H, 0, 0, cw, HUD_H * k);   // podklad (žádné mezery mezi úseky při necelém měřítku)
    part(0, 1, 0);                                         // tmavá hrana vlevo
    part(L - l + 1, l, 1);                                 // levý okraj (vnitřní část pruhů, sloupce 1 … l)
    part(L + 1, SPLIT - 1, l + 1);                         // levá skupina (sloupce 1–211)
    part(L + SPLIT, r - l, SPLIT + l);                     // mezera (zkracuje se)
    part(R + SPLIT, GAME_W - 1 - SPLIT, SPLIT + r);        // pravá skupina (sloupce 212–334)
    part(R + GAME_W - 1, edge, GAME_W - 1 + r);            // pravý okraj
    part(ENH_W - 1, 1, vw - 1);                            // tmavá hrana vpravo
  }
  drawLast() {
    if (this.testFill && WB) { WB.testPattern(this.canvas, this.testFill, Math.round(this.viewW), Math.round(this.viewH), this.S); return; }   // §5: testovací vzor (wbObrazTest.fill)
    if (this.content && (this.content.w < this.canvas.width || this.content.h < this.canvas.height)) { this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); }
    if (!this.lastDraw) { this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); return; }
    this.ctx.imageSmoothingEnabled = false;
    // volitelné míchání snímků 50 → obnovovací frekvence displeje (lineární přechod předchozí → aktuální za 20 ms; +1 snímek zpoždění)
    if (this.cur.blend && !this.cur.smooth && this.havePrev && this.lastDraw === 'frame') {   // míchání jen bez plynulého zobrazení (jinak by prolínalo obrazovky mimo hru)
      const a = Math.min(1, (performance.now() - this.frameTime) / 20);
      this.blit(this.prev, 1); this.blit(this.off, a);
    } else this.blit(this.off, 1);
  }
  toggleMode() { this.switchMode(this.mode === 'original' ? 'enhanced' : 'original'); }
  setView(view) { if (VIEWS[view] && view !== this.view) this.switchTo(this.mode, view); }
  switchMode(to) { if (to !== this.mode) this.switchTo(to, viewOfMode(to)); }
  // přechod 450 ms (smoothstep): výřez se plynule rozšíří/zúží kolem středu, rozmazání, jas, kontrast, sytost, zoom a CRT se prolínají (kontrakt §4; stejně jako Turrican a Alien Breed)
  switchTo(toMode, toView) {
    const fromMode = this.mode, A = { ...this.cfg[fromMode] }, B = { ...this.cfg[toMode] };
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { this.mode = toMode; this.view = toView; this.viewW = VIEWS[toView].w; this.viewGH = VIEWS[toView].gh; this.save(); this.layout(); return; }
    const VA = { w: this.viewW, gh: this.viewGH }, VB = VIEWS[toView], dpr = this.dpr;
    const SA = scaleFor(A.zoom, this.fitScale(VA.w, HUD_H + VA.gh), dpr, VA.w), SB = scaleFor(B.zoom, this.fitScale(VB.w, HUD_H + VB.gh), dpr, VB.w);
    this.view = toView;                              // wantEnh() je od začátku přechodu
    this.game.classList.add('mode-changing'); this.animating = true; const t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / 450), e = smoothstep(t);
      const mix = { ...(e < .5 ? A : B), zoom: 1, blur: lerp(A.blur, B.blur, e), brightness: lerp(A.brightness, B.brightness, e), contrast: lerp(A.contrast, B.contrast, e), saturate: lerp(A.saturate, B.saturate, e) };
      mix._mode = e < .5 ? fromMode : toMode;
      mix._S = lerp(SA, SB, e); mix._W = lerp(VA.w, VB.w, e); this.viewGH = lerp(VA.gh, VB.gh, e); mix._H = HUD_H + this.viewGH;   // během přechodu smí být necelé
      mix.crt = A.crt || B.crt;
      this.layoutTransition(mix, A, B, e);
      if (t < 1) requestAnimationFrame(step); else { this.game.classList.remove('mode-changing'); this.animating = false; this.mode = toMode; this.viewW = VB.w; this.viewGH = VB.gh; this.save(); this.layout(); }
    };
    requestAnimationFrame(step);
  }
  layoutTransition(mix, A, B, e) {
    const dpr = this.dpr, S = mix._S, bw = Math.round(mix._W * S), bh = Math.round(mix._H * S), cv = this.canvas;
    this.viewW = mix._W; this.content = { w: bw, h: bh };   // během přechodu bez zaokrouhlení na krok (necelé S)
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    cv.style.width = bw / dpr + 'px'; cv.style.height = bh / dpr + 'px'; this.game.style.width = bw / dpr + 'px'; this.game.style.height = bh / dpr + 'px';
    const blur = mix.blur / 100 * 0.8 * S / dpr;
    cv.style.filter = filterFor(blur, mix.brightness, mix.contrast, mix.saturate);
    const both = A.crt && B.crt; let on;
    if (both) on = e < .5 ? 1 - 1.2 * e : 1 - 1.2 * (1 - e); else on = A.crt ? 1 - e : e;
    this.game.style.setProperty('--crt-on', String(Math.max(both ? .4 : 0, on)));
    const c = mix._mode === 'original' ? A : B, key = [bw, bh, Math.round(S * 100), dpr, mix._mode, c.detail, c.shape].join('/');
    if (key !== this.crtKey) { this.crtKey = key; drawCrt(this.crt, mix._mode, c.detail, Math.max(1, Math.round(S)), dpr, bw, bh, c.shape || 'lines'); }
    this.drawLast();
  }
}
