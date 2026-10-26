/* native-audio.js - zvuk nativni hry: zapisy hry do DMACON a AUD0-3 z jadra (core_audlog, po snimcich) -> model Pauly (paula.js)
 * -> filtry jako A500 -> PCM do AudioWorkletu (native-audio-worklet.js). Zvuk je vystup puvodniho prelozeneho kodu (efekty, okolni zvuk),
 * zadne nahravky. Docs: docs/NATIVE.md 5f.
 *  - cas zapisu ve snimku v taktech CCK pocita jadro (core_audlog: radek = -4,60 + 0,03281 * instrukce, zmereno tools/soundtest.js proti vAmize,
 *    max 3,8 radku; zapisy z obsluhy preruseni kanalu maji cas preruseni);
 *  - snimek = 312 radku * 227 taktu (PAL, jako hodiny stranky FRAME_MS), PCM se vyrabi po snimcich, nezavisle na obnovovaci frekvenci;
 *  - filtry A500 (zapojeni A500, hodnoty soucastek jako vAmiga AudioFilter): dolni propust 1. radu R 360 ohm, C 0,1 uF (4,42 kHz),
 *    horni propust 1. radu 1390 ohm, 22,33 uF (5,1 Hz); filtr LED vypnuty (hra pri startu nastavi CIA-A PRA bit 1 = LED nesviti, 0xC0F194);
 *  - stereo ve Vylepseno (docs/NATIVE.md 5q): Paula ma kanaly 0+3 napevno vlevo a 1+2 vpravo (hra: okolni zvuk kanal 3, strelba kanal 2).
 *    Kazdy kanal ma vlastni zisk podle bloku, ktery prave hraje (Paula.render mix): zvuky hrace (setCenter: mnozina adres vzorku) uprostred
 *    0,5 / 0,5, ostatni podle sirky w (setWidth): kanal na sve strane (1+w)/2, na druhe (1-w)/2. w = 1 a bez setCenter = original:
 *    po ustaleni zisku stejna cesta jako Amiga (vzorky beze zmeny). Zmena zisku plynule (~5 ms), bez cvaknuti.
 *  - stranka (opts.zvuk = WBZVUK, kontrakt zvuku kitu WB-ZVUK 1.1): filtry A500, sirka sterea a hlasitost dela retezec kitu
 *    (WBZVUK.chain, setSettings); tady zustane jen Paula a zvuky hrace uprostred (sirka v mixu po kanalech 1 = tvrde stereo,
 *    stred 0,5 / 0,5 zustane po sirce kitu uprostred). Bez opts.zvuk (Node, testy) filtry A500 a sirka jako drive. */
(function (root) {
    'use strict';
    const Paula = root.Paula || (typeof require === 'function' ? require('./paula.js') : null);
    const LINE_A = -4.60, LINE_B = 0.03281;
    const CCK_LINE = 227;
    const HALF = [0.5, 0.5];
    /** Cilovy zisk kanalu n [L, R]: uprostred, kdyz hraje vzorek z mnoziny center, jinak sirka w (kanaly 0 a 3 vlevo, 1 a 2 vpravo). */
    function gains(n, src, w, center) {
        if (center && center.has(src)) return HALF;
        return (n === 0 || n === 3) ? [(1 + w) / 2, (1 - w) / 2] : [(1 - w) / 2, (1 + w) / 2];
    }

    function onePole(rate, R, C) {   // koeficient filtru 1. radu (diskretizace jako vAmiga OnePoleFilter)
        const fc = Math.min(1 / (2 * Math.PI * R * C), rate / 2 - 1e-4), a = 2 - Math.cos(2 * Math.PI * fc / rate);
        return a - Math.sqrt(a * a - 1);
    }
    /** Zvukovy vystup. opts: { rate } (bez AudioContextu jen model, napr. Node testy). */
    function create(opts) {
        const P = new Paula(), Z = (opts && opts.zvuk) || null; let frameNo = 0, rate = (opts && opts.rate) || 48000, t0 = (opts && opts.t0) || 0;
        let z = null, zs = Z ? Object.assign({}, Z.DEFAULTS) : null, zled = false;   // retezec kitu a jeho nastaveni (on, volume, stereo, filtry)
        const LINES = (opts && opts.lines) || 312, CCK_FRAME = LINES * CCK_LINE;   // radku na snimek: jako jadro (core_set_lines)   // t0: cas zacatku snimku 0 (testy: model predem pusteny zapisy originalu)
        let ctx = null, node = null, gain = null, peak = 0, frames = 0, enabled = true, volume = 0.5, width = 1, center = null, mixing = false, lpL = 0, lpR = 0, hpL = 0, hpR = 0, bLp = 0, bHp = 0;
        const setRate = (r) => { rate = r; bLp = onePole(rate, 360, 1e-7); bHp = onePole(rate, 1390, 2.233e-5); };
        setRate(rate);
        const mix = { ver: 0, a: 1, gains: (n, src) => gains(n, src, Z ? 1 : width, center) };
        let bufL = new Float32Array(4096), bufR = new Float32Array(4096);
        const A = {
            paula: P,
            /** Jeden snimek hry po core wake: zapisy snimku do modelu a PCM snimku do prehravace. chip = Uint8Array chip RAM (0..0x7FFFF). */
            frame(core, chip) {
                const n = core._core_audlog_n(), p = core._core_audlog() >> 2, H = core.HEAPU32, base = t0 + frameNo * CCK_FRAME;
                // stereo Vylepseno: mix, dokud se zisky neustali na tvrdem stereu originalu (pak zase presna cesta bez mix)
                const hard = (Z || width === 1) && !center;
                if (!hard && !mixing) { for (const c of P.ch) { c.gl = c.tl = (c === P.ch[0] || c === P.ch[3]) ? 1 : 0; c.gr = c.tr = 1 - c.gl; c.mver = -1; } mixing = true; }
                else if (hard && mixing && P.ch.every((c) => c.gl === c.tl && c.gr === c.tr && c.mver === mix.ver)) mixing = false;
                mix.a = 1 - Math.exp(-1 / (0.005 * rate)); const mx = mixing ? mix : null;
                const mem = (a) => chip[a & 0x7ffff];
                // slova, ktera Paula v jadre nacetla v case nacteni (core_datlog): hlasy hra plni do bufferu behem snimku; bez zaznamu z pameti
                const q = [[], [], [], []], qi = [0, 0, 0, 0];
                if (core._core_datlog_n) { const dn = core._core_datlog_n(), dp = core._core_datlog() >> 2; for (let i = 0; i < dn; i++) { const e = H[dp + 2 * i]; q[e >>> 24].push(e & 0xffffff, H[dp + 2 * i + 1]); } }
                P.fetch = (n, a, m) => { const Q = q[n], i = qi[n]; if (i < Q.length && Q[i] === (a & 0x7fffe)) { qi[n] = i + 2; return Q[i + 1]; } return (m(a) << 8) | m(a + 1); };
                let k = 0;
                for (let i = 0; i < n; i++) {   // PCM do casu zapisu, pak zapis (vzorky pred zapisem slysi stav pred nim)
                    const tw = base + H[p + 3 * i];
                    k += P.render(tw, mem, rate, bufL, bufR, k, mx);
                    P.write(tw, H[p + 3 * i + 1], H[p + 3 * i + 2], mem, P.onEmit || null);
                }
                frameNo++;
                k += P.render(t0 + frameNo * CCK_FRAME, mem, rate, bufL, bufR, k, mx);
                if (!Z) for (let i = 0; i < k; i++) {   // A500: dolni propust 4,4 kHz, horni propust 5 Hz (oddeleni ss slozky); se Z je dela retezec kitu
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
                if (Z) { z = Z.chain(ctx); node.connect(z.input); Z.apply(z, zs, zled, 0); return; }
                gain = ctx.createGain(); gain.gain.value = enabled ? volume : 0; node.connect(gain).connect(ctx.destination);
            },
            setEnabled(on) { enabled = on; if (gain) gain.gain.value = on ? volume : 0; if (!on && node) node.port.postMessage({ type: 'flush' }); },
            setVolume(v) { volume = v; if (gain && enabled) gain.gain.value = v; },
            /** Sirka sterea 0..1 (1 = original) pro zvuky mimo center; plynule od dalsiho snimku. */
            setWidth(w) { w = Math.min(1, Math.max(0, w)); if (w !== width) { width = w; mix.ver++; } },
            /** Stranka s retezcem kitu: nastaveni {on, volume 0-100, stereo 0-100, filterFixed, filterLed, filterHp} a bit LED hry
             *  (true = filtr LED zapnuty); zmeny se dorovnaji za 20 ms (WBZVUK.apply). */
            setSettings(s, led) {
                if (!Z) return; zs = Object.assign({}, zs, s); zled = !!led;
                if (enabled !== zs.on) { enabled = zs.on; if (!enabled && node) node.port.postMessage({ type: 'flush' }); }
                if (z) Z.apply(z, zs, zled);
            },
            /** Zvuky hrace uprostred: mnozina adres vzorku (Set) nebo null (vse podle sirky). */
            setCenter(set) { const same = set === center || (set && center && set.size === center.size && [...set].every((a) => center.has(a))); if (!same) { center = set; mix.ver++; } },
            /** Pauza (zalozka na pozadi, pauza hry): zahodit zasobu, aby po navratu zvuk nezpozdoval. */
            pause() { if (node) node.port.postMessage({ type: 'flush' }); },
            reset() { P.reset(); mixing = false; frameNo = 0; peak = 0; lpL = lpR = hpL = hpR = 0; if (node) node.port.postMessage({ type: 'flush' }); },
            stats() { return new Promise((res) => { if (!node) { res(null); return; } node.port.onmessage = (e) => res(e.data); node.port.postMessage({ type: 'stats' }); }); },
            state: () => ({ ctx: ctx ? ctx.state : 'none', rate, enabled, volume, width, center: center ? [...center] : null, mixing, peak, frames, chain: !!z, settings: zs, led: zled }),
        };
        return A;
    }
    const api = { create, gains, LINE_A, LINE_B };
    if (typeof module === 'object' && module.exports) module.exports = api; else root.NativeAudio = api;
})(typeof window !== 'undefined' ? window : this);
