/* native-audio-worklet.js - prehravac PCM nativni hry (web/native-audio.js posila stereo po snimcich hry).
 * Kruhovy zasobnik s cilovou zasobou TARGET vzorku; hodiny hry (snimky po FRAME_MS) a zvukove karty se lisi o promile,
 * proto se rychlost cteni jemne doladuje podle naplneni (max +-0,5 %), pri podteceni ticho, nad 3x cil se zahodi prebytek. */
class NativeAudioPlayer extends AudioWorkletProcessor {
    constructor() {
        super();
        this.size = 1 << 16; this.L = new Float32Array(this.size); this.R = new Float32Array(this.size);
        this.w = 0; this.r = 0; this.target = Math.round(sampleRate * 0.06); this.started = false; this.underruns = 0;
        this.port.onmessage = (e) => {
            const m = e.data;
            if (m.type === 'pcm') {
                const n = m.l.length;
                if (this.fill() + n >= this.size - 1) this.r = this.w - this.target;   // preteceni: zpet na cilovou zasobu
                for (let i = 0; i < n; i++) { const k = (this.w + i) & (this.size - 1); this.L[k] = m.l[i]; this.R[k] = m.r[i]; }
                this.w += n;
                if (this.fill() > 3 * this.target) this.r = this.w - this.target;   // dohaneni snimku (skryta zalozka, testy): nezvetsovat zpozdeni
            } else if (m.type === 'flush') { this.r = this.w; this.started = false; }
            else if (m.type === 'stats') this.port.postMessage({ type: 'stats', fill: this.fill(), underruns: this.underruns });
        };
    }
    fill() { return this.w - this.r; }
    process(inputs, outputs) {
        const out = outputs[0], oL = out[0], oR = out[1] || out[0], n = oL.length;
        if (!this.started) { if (this.fill() < this.target) { oL.fill(0); oR.fill(0); return true; } this.started = true; }
        const ratio = 1 + Math.max(-0.005, Math.min(0.005, (this.fill() - this.target) / this.target * 0.01));
        for (let i = 0; i < n; i++) {
            if (this.fill() < 2) { oL[i] = oR[i] = 0; if (i === 0) this.underruns++; this.started = false; continue; }
            const p = Math.floor(this.r), f = this.r - p, a = p & (this.size - 1), b = (p + 1) & (this.size - 1);
            oL[i] = this.L[a] + (this.L[b] - this.L[a]) * f; oR[i] = this.R[a] + (this.R[b] - this.R[a]) * f;
            this.r += ratio;
        }
        return true;
    }
}
registerProcessor('native-audio-player', NativeAudioPlayer);
