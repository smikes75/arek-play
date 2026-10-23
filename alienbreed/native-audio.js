/* native-audio.js - zvuk nativni hry: zapisy hry do DMACON a AUD0-3 z jadra (core_audlog, po snimcich) -> model Pauly (paula.js)
 * -> filtry jako A500 -> PCM do AudioWorkletu (native-audio-worklet.js). Zvuk je vystup puvodniho prelozeneho kodu (efekty, okolni zvuk),
 * zadne nahravky. Docs: docs/NATIVE.md 5f.
 *  - cas zapisu ve snimku v taktech CCK pocita jadro (core_audlog: radek = -4,60 + 0,03281 * instrukce, zmereno tools/soundtest.js proti vAmize,
 *    max 3,8 radku; zapisy z obsluhy preruseni kanalu maji cas preruseni);
 *  - snimek = 313 radku * 227 taktu (PAL, jako hodiny stranky FRAME_MS), PCM se vyrabi po snimcich, nezavisle na obnovovaci frekvenci;
 *  - filtry A500 (zapojeni A500, hodnoty soucastek jako vAmiga AudioFilter): dolni propust 1. radu R 360 ohm, C 0,1 uF (4,42 kHz),
 *    horni propust 1. radu 1390 ohm, 22,33 uF (5,1 Hz); filtr LED vypnuty (hra pri startu nastavi CIA-A PRA bit 1 = LED nesviti, 0xC0F194). */
(function (root) {
    'use strict';
    const Paula = root.Paula || (typeof require === 'function' ? require('./paula.js') : null);
    const LINE_A = -4.60, LINE_B = 0.03281;
    const CCK_LINE = 227;

    function onePole(rate, R, C) {   // koeficient filtru 1. radu (diskretizace jako vAmiga OnePoleFilter)
        const fc = Math.min(1 / (2 * Math.PI * R * C), rate / 2 - 1e-4), a = 2 - Math.cos(2 * Math.PI * fc / rate);
        return a - Math.sqrt(a * a - 1);
    }
    /** Zvukovy vystup. opts: { rate } (bez AudioContextu jen model, napr. Node testy). */
    function create(opts) {
        const P = new Paula(); let frameNo = 0, rate = (opts && opts.rate) || 48000, t0 = (opts && opts.t0) || 0;
        const LINES = (opts && opts.lines) || 313, CCK_FRAME = LINES * CCK_LINE;   // radku na snimek: jako jadro (core_set_lines)   // t0: cas zacatku snimku 0 (testy: model predem pusteny zapisy originalu)
        let ctx = null, node = null, gain = null, peak = 0, frames = 0, enabled = true, volume = 0.5, lpL = 0, lpR = 0, hpL = 0, hpR = 0, bLp = 0, bHp = 0;
        const setRate = (r) => { rate = r; bLp = onePole(rate, 360, 1e-7); bHp = onePole(rate, 1390, 2.233e-5); };
        setRate(rate);
        let bufL = new Float32Array(4096), bufR = new Float32Array(4096);
        const A = {
            paula: P,
            /** Jeden snimek hry po core wake: zapisy snimku do modelu a PCM snimku do prehravace. chip = Uint8Array chip RAM (0..0x7FFFF). */
            frame(core, chip) {
                const n = core._core_audlog_n(), p = core._core_audlog() >> 2, H = core.HEAPU32, base = t0 + frameNo * CCK_FRAME;
                const mem = (a) => chip[a & 0x7ffff];
                // slova, ktera Paula v jadre nacetla v case nacteni (core_datlog): hlasy hra plni do bufferu behem snimku; bez zaznamu z pameti
                const q = [[], [], [], []], qi = [0, 0, 0, 0];
                if (core._core_datlog_n) { const dn = core._core_datlog_n(), dp = core._core_datlog() >> 2; for (let i = 0; i < dn; i++) { const e = H[dp + 2 * i]; q[e >>> 24].push(e & 0xffffff, H[dp + 2 * i + 1]); } }
                P.fetch = (n, a, m) => { const Q = q[n], i = qi[n]; if (i < Q.length && Q[i] === (a & 0x7fffe)) { qi[n] = i + 2; return Q[i + 1]; } return (m(a) << 8) | m(a + 1); };
                let k = 0;
                for (let i = 0; i < n; i++) {   // PCM do casu zapisu, pak zapis (vzorky pred zapisem slysi stav pred nim)
                    const tw = base + H[p + 3 * i];
                    k += P.render(tw, mem, rate, bufL, bufR, k);
                    P.write(tw, H[p + 3 * i + 1], H[p + 3 * i + 2], mem, P.onEmit || null);
                }
                frameNo++;
                k += P.render(t0 + frameNo * CCK_FRAME, mem, rate, bufL, bufR, k);
                for (let i = 0; i < k; i++) {   // A500: dolni propust 4,4 kHz, horni propust 5 Hz (oddeleni ss slozky)
                    lpL = (1 - bLp) * bufL[i] + bLp * lpL; lpR = (1 - bLp) * bufR[i] + bLp * lpR;
                    hpL = (1 - bHp) * lpL + bHp * hpL; hpR = (1 - bHp) * lpR + bHp * hpR;
                    bufL[i] = lpL - hpL; bufR[i] = lpR - hpR;
                }
                for (let i = 0; i < k; i++) { const a = Math.abs(bufL[i]) + Math.abs(bufR[i]); if (a > peak) peak = a; }
                frames++;
                if (node && enabled) node.port.postMessage({ type: 'pcm', l: bufL.slice(0, k), r: bufR.slice(0, k) });
                return k;
            },
            pcm: () => ({ l: bufL, r: bufR }),
            /** Spusteni zvuku (po gestu uzivatele: prohlizece jinak AudioContext nepusti). */
            async unlock() {
                if (ctx) { if (ctx.state === 'suspended') await ctx.resume(); return; }
                const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return;
                ctx = new AC({ latencyHint: 'interactive' }); setRate(ctx.sampleRate);
                await ctx.audioWorklet.addModule('native-audio-worklet.js');
                node = new AudioWorkletNode(ctx, 'native-audio-player', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
                gain = ctx.createGain(); gain.gain.value = enabled ? volume : 0; node.connect(gain).connect(ctx.destination);
            },
            setEnabled(on) { enabled = on; if (gain) gain.gain.value = on ? volume : 0; if (!on && node) node.port.postMessage({ type: 'flush' }); },
            setVolume(v) { volume = v; if (gain && enabled) gain.gain.value = v; },
            /** Pauza (zalozka na pozadi, pauza hry): zahodit zasobu, aby po navratu zvuk nezpozdoval. */
            pause() { if (node) node.port.postMessage({ type: 'flush' }); },
            reset() { P.reset(); frameNo = 0; peak = 0; lpL = lpR = hpL = hpR = 0; if (node) node.port.postMessage({ type: 'flush' }); },
            stats() { return new Promise((res) => { if (!node) { res(null); return; } node.port.onmessage = (e) => res(e.data); node.port.postMessage({ type: 'stats' }); }); },
            state: () => ({ ctx: ctx ? ctx.state : 'none', rate, enabled, volume, peak, frames }),
        };
        return A;
    }
    const api = { create, LINE_A, LINE_B };
    if (typeof module === 'object' && module.exports) module.exports = api; else root.NativeAudio = api;
})(typeof window !== 'undefined' ? window : this);
