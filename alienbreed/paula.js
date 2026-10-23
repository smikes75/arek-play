/* paula.js - model zvukoveho cipu Paula pro nativni hru (docs/NATIVE.md 5f).
 * Vstup: zapisy hry do DMACON a AUD0-3 s casem v taktech barvy (CCK, 227 na radek, 313 radku na snimek PAL), data vzorku z chip RAM.
 * Vystup: udalosti kanalu (cas, kanal, vzorek * hlasitost) a z nich PCM pro AudioWorklet.
 * Stavovy automat kanalu podle HRM (stavy 000, 001, 101, 010, 011), casovani DMA zmerene proti vAmize 899da5d (tools/paulatest.js):
 *  - pozadavek na data (DR) Paula preda Agnusu na konci radku, Agnus ho obslouzi ve slotu kanalu na dalsim radku (h = 0x0D + 2 n);
 *  - pri zapnuti DMA: 000 -> 001 (nacte LEN, pozadavek), prvni slovo -> 101 (ukazatel = LC, pozadavek), druhe slovo -> 010 = prvni bajt;
 *  - kazdy bajt trva AUDxPER taktu (perioda se cte na zacatku bajtu), hlasitost se nacita s kazdym slovem (vysoky bajt);
 *  - bajt se vyda jen kdyz od posledniho vydani doslo nove slovo (jinak vystup drzi posledni hodnotu);
 *  - slova dosla za blok (LEN) -> znovu LEN a ukazatel = LC (zapis LC/LEN za behu plati az od dalsiho bloku);
 *  - ve stejnem taktu se slot DMA obslouzi pred koncem bajtu (zmereno: jinak chybi bajty v h = 0x11 u kanalu 2);
 *  - vypnuti DMA: ve stavu 001/101 hned 000, ve stavu 011 na konci bajtu (je-li nastaven pozadavek preruseni kanalu). */
(function (root) {
    'use strict';
    const CCK_LINE = 227, LINES = 313, CCK_FRAME = CCK_LINE * LINES, CCK_HZ = 3546895;

    function Paula() { this.reset(); }
    Paula.CCK_LINE = CCK_LINE; Paula.LINES = LINES; Paula.CCK_FRAME = CCK_FRAME; Paula.CCK_HZ = CCK_HZ;
    Paula.prototype.reset = function () {
        this.dmacon = 0x0200; this.t = 0; this.line = 0;
        this.ch = [0, 1, 2, 3].map(() => ({ st: 0, lenL: 0, len: 0, perL: 0, volL: 0, vol: 0, dat: 0, buf: 0, enHi: false, enLo: false,
            dr: false, adr: false, lc: 0, pt: 0, perfin: Infinity, ip: true, intreq2: false, out: 0 }));
    };
    Paula.prototype.on = function (n) { return (this.dmacon & 0x200) !== 0 && (this.dmacon & (1 << n)) !== 0; };
    function per(c) { return c.perL || 0x10000; }
    function pen(c, n, t, hi, emit) {
        if (hi ? !c.enHi : !c.enLo) return;
        const b = hi ? c.buf >> 8 : c.buf & 0xff;
        c.out = (b << 24 >> 24) * c.vol; if (emit) emit(t, n, c.out);
        if (hi) c.enHi = false; else c.enLo = false;
    }
    /** Data kanalu z DMA (AUDxDAT) v case t. */
    Paula.prototype.dat = function (n, t, v, emit) {
        const c = this.ch[n];
        c.dat = v; c.enHi = c.enLo = true;
        if (!this.on(n)) return;   // rezim preruseni (bez DMA) hra nepouziva
        switch (c.st) {
            case 0: c.len = c.lenL; c.dr = true; c.st = 1; break;
            case 1: c.ip = true; c.dr = true; c.pt = c.lc; if (c.len !== 1) c.len = (c.len - 1) & 0xffff; c.st = 5; break;
            case 5: c.perfin = t + per(c); c.vol = c.volL; c.buf = c.dat; c.dr = true; c.st = 2; pen(c, n, t, true, emit); break;
            default: if (c.len !== 1) c.len = (c.len - 1) & 0xffff; else { c.len = c.lenL; c.pt = c.lc; c.intreq2 = true; } break;
        }
    };
    /** Konec bajtu (PERFIN) kanalu n v case t. */
    Paula.prototype.perfin = function (n, t, emit) {
        const c = this.ch[n];
        if (c.st === 2) { c.perfin = t + per(c); c.st = 3; pen(c, n, t, false, emit); return; }
        if (this.on(n) || !c.ip) {
            c.perfin = t + per(c); c.buf = c.dat; c.vol = c.volL;
            if (this.on(n)) { c.dr = true; if (c.intreq2) { c.ip = true; c.intreq2 = false; } } else c.ip = true;
            c.st = 2; pen(c, n, t, true, emit);
        } else { c.st = 0; c.perfin = Infinity; c.intreq2 = false; }
    };
    /** Posun casu na t (CCK): konce bajtu, konce radku (predani pozadavku) a sloty DMA kanalu. mem(a) = bajt chip RAM. */
    Paula.prototype.advance = function (t, mem, emit) {
        const ch = this.ch;
        for (;;) {
            // dalsi udalost: nejblizsi konec bajtu, slot DMA kanalu s pozadavkem, konec radku
            let te = (this.line + 1) * CCK_LINE, kind = -1, who = -1;   // kind -1 = konec radku
            for (let n = 0; n < 4; n++) {
                const c = ch[n];
                if (c.perfin < te || (c.perfin === te && kind === -1)) { te = c.perfin; kind = 0; who = n; }
                if (c.adr) { const s = this.line * CCK_LINE + 0x0d + 2 * n; if (s >= this.t && (s < te || (s === te && kind === 0))) { te = s; kind = 1; who = n; } }   // slot DMA pred koncem bajtu ve stejnem taktu (zmereno)
            }
            if (te > t) break;
            this.t = te;
            if (kind === 0) this.perfin(who, te, emit);
            else if (kind === 1) { const c = ch[who]; c.adr = false; const v = this.fetch ? this.fetch(who, c.pt, mem) : (mem(c.pt) << 8) | mem(c.pt + 1); c.pt = (c.pt + 2) & 0x1ffffe; this.dat(who, te, v, emit); }
            else { this.line++; for (const c of ch) if (c.dr) { c.adr = true; c.dr = false; } }
        }
        this.t = t;
    };
    /** Zapis registru v case t (CCK). */
    Paula.prototype.write = function (t, reg, v, mem, emit) {
        this.advance(t, mem, emit);
        if (reg === 0x09c) {   // INTREQ: pozadavky preruseni kanalu (stav 011 bez DMA pokracuje jen bez cekajiciho pozadavku)
            for (let n = 0; n < 4; n++) if (v & (0x80 << n)) this.ch[n].ip = (v & 0x8000) !== 0;
            return;
        }
        if (reg === 0x096) {
            const was = [0, 1, 2, 3].map((n) => this.on(n));
            this.dmacon = v & 0x8000 ? this.dmacon | (v & 0x7fff) : this.dmacon & ~v;
            for (let n = 0; n < 4; n++) {
                const now = this.on(n), c = this.ch[n];
                if (now && !was[n]) { if (c.st === 0) { c.len = c.lenL; c.dr = true; c.st = 1; } }
                else if (!now && was[n]) { if (c.st === 1 || c.st === 5) c.st = 0; }
            }
            return;
        }
        if (reg < 0x0a0 || reg >= 0x0e0) return;
        const c = this.ch[(reg - 0x0a0) >> 4];
        switch (reg & 0x0f) {
            case 0x0: c.lc = ((v & 0x1f) << 16) | (c.lc & 0xffff); break;
            case 0x2: c.lc = (c.lc & 0x1f0000) | (v & 0xfffe); break;
            case 0x4: c.lenL = v; break;
            case 0x6: c.perL = v; break;
            case 0x8: c.volL = Math.min(v & 0x7f, 64); break;
            case 0xa: this.dat((reg - 0x0a0) >> 4, t, v, emit); break;
        }
    };
    /** PCM: smicha kanaly do stereo (kanaly 0 a 3 vlevo, 1 a 2 vpravo) do casu t1 (CCK) se vzorkovaci frekvenci rate; hodnota kanalu
     *  v case vzorku = posledni vydany bajt (jako vAmiga bez interpolace). Vraci pocet zapsanych vzorku od offset. */
    Paula.prototype.render = function (t1, mem, rate, outL, outR, offset) {
        const cps = CCK_HZ / rate, ch = this.ch; let k = offset || 0;
        if (this.tr === undefined || this.tr < this.t - cps) this.tr = this.t;
        while (this.tr + cps <= t1) {
            this.tr += cps;
            this.advance(this.tr, mem, this.onEmit || null);   // onEmit: udalosti kanalu pro testy (tools/soundtest.js --pcm)
            outL[k] = (ch[0].out + ch[3].out) / 16384; outR[k] = (ch[1].out + ch[2].out) / 16384; k++;
        }
        this.advance(t1, mem, this.onEmit || null);
        return k - (offset || 0);
    };
    if (typeof module === 'object' && module.exports) module.exports = Paula; else root.Paula = Paula;
})(this);
