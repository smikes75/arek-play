// AudioWorklet prezentace (bez SharedArrayBuffer): worker posílá přes MessagePort každý snímek 960 stereo vzorků int16 (48 kHz, engine/paula.c),
// tady malá fronta (cíl 50 ms, předplnění 40 ms) a jemné přizpůsobení rychlosti čtení (±1 %), protože worker nedává přesně 48 000 vzorků/s.
class PaulaOut extends AudioWorkletProcessor {
  constructor() {
    super(); this.q = []; this.cur = null; this.ci = 0; this.fill = 0; this.pos = 0; this.vol = 0.8; this.l = 0; this.r = 0; this.primed = false; this.prev = [0, 0];
    this.port.onmessage = e => {
      const d = e.data;
      if (d instanceof ArrayBuffer) { const s = new Int16Array(d); this.q.push(s); this.fill += s.length / 2; while (this.fill > 4800 && this.q.length > 1) { this.fill -= this.q.shift().length / 2; } return; }   // přetečení: zahodit staré
      if (d.port) { d.port.onmessage = this.port.onmessage; return; }   // vzorky přímo z workeru (MessageChannel)
      if (d.vol !== undefined) this.vol = d.vol;
    };
  }
  next() {                                               // další stereo vzorek z fronty, nebo null
    while (!this.cur || this.ci >= this.cur.length) { if (!this.q.length) return null; this.cur = this.q.shift(); this.ci = 0; }
    const l = this.cur[this.ci], r = this.cur[this.ci + 1]; this.ci += 2; this.fill--; return [l, r];
  }
  process(_, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0];
    if (!this.primed && this.fill >= 1920) this.primed = true;
    if (this.primed && this.fill < 2) this.primed = false;
    const adj = Math.max(-0.01, Math.min(0.01, (this.fill - 2400) / 2400 * 0.01)), step = 48000 / sampleRate * (1 + adj);
    for (let i = 0; i < L.length; i++) {
      let l = 0, r = 0;
      if (this.primed) {
        this.pos += step;
        while (this.pos >= 1) { const s = this.next(); if (!s) { this.primed = false; break; } this.prev = s; this.pos -= 1; }
        l = this.prev[0] / 32768; r = this.prev[1] / 32768;
      }
      this.l += 0.35 * (l - this.l); this.r += 0.35 * (r - this.r);   // měkčí výšky jako filtr A500 (1 pól), stejně jako výchozí nastavení web/
      L[i] = this.l * this.vol; R[i] = this.r * this.vol;
    }
    return true;
  }
}
registerProcessor('paula-out', PaulaOut);
