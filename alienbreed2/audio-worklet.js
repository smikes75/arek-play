// audio-worklet.js - výstup Pauly do Web Audio: kruh stereo int16 48 kHz, předplnění a cílová zásoba nastavitelné (port:
// {prefill, target} v ms), rychlost čtení doladěná ±1 % podle zásoby (hra dává 960 vzorků na 19,968 ms, o 0,16 % víc než
// 48 000/s). Jen zdroj: filtry Amigy 500, šířka sterea a hlasitost jsou za ním v řetězci kitu (wb-zvuk.js).
// Dva režimy:
//  - zprávy (engine bez sdílené paměti): stránka posílá snímky hry (Int16Array) přes port, vlastní kruh 1 s;
//  - sdílená paměť (engine ve vlákně, GAME_THREAD): {sab, ring, n, widx, ridx} = kruh G_AUD enginu přímo v paměti wasm,
//    počítadlo zapsaných vzorků (G_AWT) a přečtených (G_ARD - podle něj vlákno hry pozná, že dochází zvuk, a počítá dál
//    i bez povolení stránky). Stránka do toho nesahá: zaseknuté hlavní vlákno zvuk nepřeruší.
// Stav (zásoba, výpadky) posílá stránce po 250 ms.
class AbiiPaula extends AudioWorkletProcessor {
  constructor() {
    super();
    this.n = 48000; this.ring = new Int16Array(this.n * 2); this.w = 0; this.rd = 0; this.primed = false;
    this.shared = null; this.prefill = 1920; this.target = 2400;
    this.under = 0; this.drop = 0; this.fillSum = 0; this.fillN = 0; this.last = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d === 'flush') { if (this.shared) this.rd = Atomics.load(this.shared.w, 0); else { this.w = 0; this.rd = 0; } this.primed = false; return; }
      if (d && d.sab) {                                    // sdílená paměť enginu
        this.shared = { ring: new Int16Array(d.sab, d.ring, d.n * 2), w: new Int32Array(d.sab, d.widx, 1), r: new Int32Array(d.sab, d.ridx, 1), n: d.n };
        this.rd = Atomics.load(this.shared.w, 0); this.primed = false; return;
      }
      if (d && d.target) { this.target = Math.round(d.target * 48); this.prefill = Math.round((d.prefill || d.target * 0.8) * 48); return; }
      if (this.shared) return;
      const s = d instanceof Int16Array ? d : new Int16Array(d), m = s.length >> 1;
      if (this.w - this.rd + m > this.n - 128) { this.drop += m; return; }      // přeteklo by: snímek zahodit
      for (let i = 0; i < m; i++) { const o = ((this.w + i) % this.n) * 2; this.ring[o] = s[2 * i]; this.ring[o + 1] = s[2 * i + 1]; }
      this.w += m;
    };
  }
  process(_, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], sh = this.shared;
    const ring = sh ? sh.ring : this.ring, n = sh ? sh.n : this.n;
    let rd = this.rd; const w = sh ? Atomics.load(sh.w, 0) : this.w;
    if (w < Math.floor(rd)) { rd = w; this.primed = false; }  // nový start enginu (počítadlo od nuly)
    const fill = w - rd, T = this.target;
    const adj = Math.max(-0.01, Math.min(0.01, (fill - T) / T * 0.01)), step = 48000 / sampleRate * (1 + adj);
    if (fill > 2 * T + 960) rd = w - T;                    // hra napřed (návrat z pauzy, skok): držet cílovou zásobu
    if (!this.primed && fill >= this.prefill) this.primed = true;
    let gap = false;
    for (let i = 0; i < L.length; i++) {
      let l = 0, r = 0;
      if (this.primed && rd + 1 < w) {
        const k = Math.floor(rd), f = rd - k, o = (k % n) * 2, o2 = ((k + 1) % n) * 2;
        l = (ring[o] * (1 - f) + ring[o2] * f) / 32768; r = (ring[o + 1] * (1 - f) + ring[o2 + 1] * f) / 32768; rd += step;
      } else if (this.primed) { gap = true; }
      L[i] = l; R[i] = r;
    }
    if (gap) { this.under++; this.primed = false; }        // vyprázdněno: výpadek, znovu předplnit
    this.rd = rd; if (sh) Atomics.store(sh.r, 0, Math.floor(rd));
    this.fillSum += w - rd; this.fillN++;
    if (currentTime - this.last > 0.25) {
      this.last = currentTime; this.port.postMessage({ fill: this.fillSum / Math.max(1, this.fillN) / 48, under: this.under, drop: this.drop, primed: this.primed, shared: !!sh });
      this.fillSum = 0; this.fillN = 0;
    }
    return true;
  }
}
registerProcessor('abii-paula', AbiiPaula);
