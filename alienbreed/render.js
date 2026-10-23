// render.js - vlastni renderer hraci plochy Alien Breed SE92 ze stavu RAM (M5.1).
// Vsechno nize je zmereno (docs/RENDER.md, tools/statescan.py, tools/rendercheck.py):
//   - copper list 1 na 0x2e48: DIWSTRT/DIWSTOP (okno 142..435 x 43..301), paleta COLOR00-31
//     pred radkem 52, sprity 0-7 (ukazatele + POS/CTL primo v copperu), od WAIT 51 sada 5
//     ukazatelu bitplanu (BPLCON0 0x5200, BPLCON1 jemny scroll, modulo 2 -> 42 B na radek),
//     druha sada na radku prepnuti kruhoveho bufferu (287 radku na plan), radek 292 prazdny,
//     293-300 spodni HUD ve 2 planech.
//   - hraci plocha = radky 52..291 (240), pixel s okna = nacteny bit (hstart-0x81)-zpozdeni+s
//     od MSB slova na ukazateli planu; dva buffery (0x28xxx a 0x37xxx) se stridaji po snimcich.
//   - barvy jako vAmiga (PixelEngine::updateAdjLut, paleta COLOR), prevzato z Turrican render.js.
// Zadna herni logika: renderer jen cte, co hra do RAM zapsala.
'use strict';
const RENDER = (() => {
    // BUF_ROWS: sada 1 na radku 70 bufferu pokryva radky 52..269 (218) a sada 2 od 270 zacina
    // radkem 0 -> 70 + 218 = 288 (po scrollu 58 + 230 = 288); alokovano 294 (0x303c / 42).
    const COP1 = 0x2e48, ROWB = 42, PF_START = 52, PF_H = 240, WIN_W = 293, BUF_ROWS = 288, BUF_W = ROWB * 8;
    const u16 = (d, a) => (d[a] << 8) | d[a + 1];

    // --- barvy jako vAmiga (jas 50 %, kontrast 100 %, sytost 50 %, GAMMA_IN 2.8, GAMMA_OUT 2.2) ---
    const GAMMA_IN = 2.8, GAMMA_OUT = 2.2;
    const adj = new Int32Array(9 * 256), gammaLut = new Uint8Array(256);
    {
        const y = [0.299, 0.587, 0.114], s = 1.0;
        const u = [-0.147 * s, -0.289 * s, 0.436 * s], v = [0.615 * s, -0.515 * s, -0.100 * s];
        const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (let i = 0; i < 3; i++) { m[0][i] = y[i] + 1.140 * v[i]; m[1][i] = y[i] - 0.396 * u[i] - 0.581 * v[i]; m[2][i] = y[i] + 2.029 * u[i]; }
        for (let out = 0; out < 3; out++) for (let inn = 0; inn < 3; inn++) for (let val = 0; val < 256; val++) {
            const linear = Math.pow(val / 255.0, GAMMA_IN) * 255.0;
            adj[(out * 3 + inn) * 256 + val] = Math.round(m[out][inn] * linear * 65536.0);
        }
        for (let i = 0; i < 256; i++) {
            const display = Math.pow(Math.min(1, Math.max(0, i / 255.0)), 1.0 / GAMMA_OUT) * 255.0;
            gammaLut[i] = Math.round(Math.min(255, Math.max(0, display)));
        }
    }
    const clampG = (v) => gammaLut[v < 0 ? 0 : v > (255 << 16) ? 255 : v >> 16];
    const RGB12 = new Uint32Array(4096);   // 0xAABBGGRR (ImageData little endian)
    for (let c = 0; c < 4096; c++) {
        const r8 = (c >> 8 & 15) << 4, g8 = (c >> 4 & 15) << 4, b8 = (c & 15) << 4;
        const r = clampG(adj[r8] + adj[256 + g8] + adj[512 + b8]);
        const g = clampG(adj[768 + r8] + adj[1024 + g8] + adj[1280 + b8]);
        const b = clampG(adj[1536 + r8] + adj[1792 + g8] + adj[2048 + b8]);
        RGB12[c] = (0xff << 24 | b << 16 | g << 8 | r) >>> 0;
    }

    // --- copper list ---------------------------------------------------------------
    // buf = Uint8Array chip RAM od adresy base (musi pokryvat 0x2e48..0x3500).
    function parseCopper(buf, base, start = COP1) {
        const res = { diw: null, sets: [], palette: new Uint16Array(32), sprites: [], level: false };
        for (let i = 0; i < 8; i++) res.sprites.push({ ptr: 0, pos: 0, ctl: 0 });
        let a = start - base, vbase = 0, wait = 0, con0 = 0, con1 = 0, diwstrt = 0x2c81, diwstop = 0x2cc1;
        const cur = new Map();
        for (let n = 0; n < 4000 && a + 3 < buf.length; n++, a += 4) {
            const w1 = u16(buf, a), w2 = u16(buf, a + 2);
            if (w1 === 0xffff && w2 === 0xfffe) break;
            if (w1 & 1) {
                const vp = (w1 >> 8) & 0xff, hp = w1 & 0xfe;
                if (vp === 255 && hp > 200 && vbase === 0) vbase = 256; else wait = vp + vbase;
                continue;
            }
            const r = w1 & 0x1fe, v = w2;
            if (r === 0x08e) diwstrt = v;
            else if (r === 0x090) diwstop = v;
            else if (r === 0x100) con0 = v;
            else if (r === 0x102) con1 = v;
            else if (r >= 0x0e0 && r <= 0x0f2) {
                cur.set(r, v);
                if (cur.size === 10) {
                    const ptrs = [];
                    for (let p = 0; p < 5; p++) ptrs.push(((cur.get(0x0e0 + 4 * p) << 16) | cur.get(0x0e2 + 4 * p)) >>> 0);
                    res.sets.push({ line: wait + 1, con0, con1, ptrs });
                    cur.clear();
                }
            }
            else if (r >= 0x120 && r <= 0x13e) { const s = res.sprites[(r - 0x120) >> 2]; if ((r - 0x120) & 2) s.ptr = (s.ptr & 0xffff0000) | v; else s.ptr = ((v << 16) | (s.ptr & 0xffff)) >>> 0; }
            else if (r >= 0x140 && r <= 0x17e) { const s = res.sprites[(r - 0x140) >> 3], k = (r - 0x140) & 6; if (k === 0) s.pos = v; else if (k === 2) s.ctl = v; }
            else if (r >= 0x180 && r <= 0x1be && wait < PF_START) res.palette[(r - 0x180) >> 1] = v;
        }
        res.diw = { hstart: diwstrt & 0xff, hstop: (diwstop & 0xff) + 256, vstart: diwstrt >> 8, vstop: (diwstop >> 8) + ((diwstop >> 8) < 0x80 ? 256 : 0) };
        res.sets = res.sets.filter((s) => (s.con0 >> 12) === 5);
        res.level = res.sets.length >= 1 && res.diw.hstop - res.diw.hstart === WIN_W;
        return res;
    }

    // Prvni viditelny bit okna vuci slovu na ukazateli (DDFSTRT 0x38, okno od hstart, zpozdeni BPLCON1).
    const fineOf = (cop) => (cop.diw.hstart - 0x81) - (cop.sets[0].con1 & 0xf);
    // Radek bufferu, na kterem zacina hraci plocha (z rozdilu obou sad ukazatelu); -1 bez druhe sady.
    const camRowOf = (cop) => cop.sets.length >= 2 ? Math.round((cop.sets[0].ptrs[0] - cop.sets[1].ptrs[0]) / ROWB) : -1;

    // Indexy barev 0..31 pro vyrez {x0, y0, w, h} v souradnicich hraci plochy (pixel 0,0 = levy
    // horni roh okna na radku 52). Zaporne x0/y0 a presah = okraje bufferu (336 x 287) mimo okno;
    // co neni v bufferu, zustane 0. planes = Uint8Array chip RAM od adresy planesBase.
    function renderIndices(cop, planes, planesBase, view, out) {
        const { x0, y0, w, h } = view;
        out = out || new Uint8Array(w * h); out.fill(0);
        if (!cop.level) return out;
        const fine = fineOf(cop), camRow = camRowOf(cop), s0 = cop.sets[0], s1 = cop.sets[1];
        for (let y = 0; y < h; y++) {
            const py = y0 + y;                     // radek hraci plochy (0 = radek 52)
            let ptrs, k;
            if (s1 && py >= s1.line - PF_START) { ptrs = s1.ptrs; k = py - (s1.line - PF_START); }
            else { ptrs = s0.ptrs; k = py; }
            if (camRow >= 0) {                     // cely kruhovy buffer: radek = (camRow + py) mod 287 od sady 1
                const row = ((camRow + py) % BUF_ROWS + BUF_ROWS) % BUF_ROWS;
                ptrs = s1.ptrs; k = row;
            } else if (k < 0) continue;
            const orow = y * w;
            for (let p = 0; p < 5; p++) {
                const pb = ptrs[p] + k * ROWB - planesBase;
                if (pb < 0 || pb + ROWB > planes.length) continue;
                const bit = 1 << p;
                for (let x = 0; x < w; x++) {
                    const b = fine + x0 + x;
                    if (b < 0 || b >= BUF_W) continue;
                    if (planes[pb + (b >> 3)] & (0x80 >> (b & 7))) out[orow + x] |= bit;
                }
            }
        }
        return out;
    }

    // Hardwarove sprity z copperu: pozice z POS/CTL (copper je zapisuje po nacteni ridicich slov
    // DMA, proto se data berou od ptr+0: prvni dve slova = prazdny radek 0), x o 1 px vpravo od
    // bitplanu (zmereno tools/rendertest.js: 100 % v oblasti spritu jen s dx=+1), pripojene pary
    // (CTL bit 7 licheho spritu) = 16 barev od 16, jinak 3 barvy od 16+4*(n>>1).
    // chip = Uint8Array chip RAM od chipBase (musi pokryvat data spritu).
    function drawSprites(idx, view, cop, chip, chipBase) {
        if (!cop.level) return;
        const { x0, y0, w, h } = view, hwin = cop.diw.hstart;
        for (let n = 0; n < 8; n += 2) {
            const a = cop.sprites[n], b = cop.sprites[n + 1];
            const att = (b.ctl >> 7) & 1;
            for (const [s, odd] of att ? [[a, 0]] : [[a, 0], [b, 1]]) {
                const hs = ((s.pos & 0xff) << 1) | (s.ctl & 1), vs = (s.pos >> 8) | ((s.ctl & 4) << 6), ve = (s.ctl >> 8) | ((s.ctl & 2) << 7);
                const height = ve - vs; if (height <= 0 || height > 256) continue;
                const sx = hs - hwin - x0 + 1, sy = vs - PF_START - y0;
                const pa = s.ptr - chipBase, pb = b.ptr - chipBase;
                for (let y = 0; y < height; y++) {
                    const ty = sy + y; if (ty < 0 || ty >= h) continue;
                    if (pa + y * 4 + 3 >= chip.length) break;
                    const a0 = u16(chip, pa + y * 4), a1 = u16(chip, pa + y * 4 + 2);
                    const b0 = att ? u16(chip, pb + y * 4) : 0, b1 = att ? u16(chip, pb + y * 4 + 2) : 0;
                    for (let x = 0; x < 16; x++) {
                        const tx = sx + x; if (tx < 0 || tx >= w) continue;
                        const sh = 15 - x;
                        let c = ((a0 >> sh) & 1) | (((a1 >> sh) & 1) << 1);
                        if (att) c |= (((b0 >> sh) & 1) << 2) | (((b1 >> sh) & 1) << 3);
                        if (!c) continue;
                        idx[ty * w + tx] = att ? 16 + c : 16 + 4 * (n >> 1) + c;
                    }
                }
            }
        }
    }

    // transparent: index 0 = pruhledny (vrstva spritu kreslena zvlast nad terenem)
    function paint(idx, w, h, palette, rgba, transparent) {
        const lut = new Uint32Array(32);
        for (let i = 0; i < 32; i++) lut[i] = RGB12[palette[i] & 0xfff];
        if (transparent) lut[0] = 0;
        const out = rgba || new Uint8ClampedArray(w * h * 4);
        const u32 = new Uint32Array(out.buffer, out.byteOffset, w * h);
        for (let i = 0; i < w * h; i++) u32[i] = lut[idx[i]];
        return out;
    }

    // --- teren z tabulky mapy a dlazdic v RAM hry (docs/MAP.md): mapa 124 x 109 slov na 0xC47288 (index dlazdice = slovo >> 6),
    // dlazdice 160 B (5 planu po 16 slovech) na 0xC4DC20; hra dlazdice animuje na miste, atlas se obnovuje jen pro zmenene ---
    const MAP_W = 124, MAP_H = 109, MAP_ADDR = 0xc47288, TILES_ADDR = 0xc4dc20, TILE_N = 480;
    function tileAtlas(state, slow, slowBase) {
        if (!state.atlas) { state.atlas = new Uint8Array(TILE_N * 256); state.cache = new Uint8Array(TILE_N * 160); state.cache.fill(0xff); }
        const base = TILES_ADDR - slowBase; let changed = 0;
        for (let t = 0; t < TILE_N; t++) {
            const o = base + t * 160; let same = true;
            for (let i = 0; i < 160; i++) if (slow[o + i] !== state.cache[t * 160 + i]) { same = false; break; }
            if (same) continue;
            state.cache.set(slow.subarray(o, o + 160), t * 160); changed++;
            const px = state.atlas; const pb = t * 256;
            for (let i = 0; i < 256; i++) px[pb + i] = 0;
            for (let p = 0; p < 5; p++) for (let r = 0; r < 16; r++) {
                const w = (slow[o + p * 32 + r * 2] << 8) | slow[o + p * 32 + r * 2 + 1];
                if (!w) continue;
                for (let x = 0; x < 16; x++) if ((w >> (15 - x)) & 1) px[pb + r * 16 + x] |= 1 << p;
            }
        }
        return changed;
    }
    /** Indexy barev sveta (x0, y0, w, h) z mapy v RAM (slow = Uint8Array slow RAM, slowBase jeji adresa) do out (w*h). */
    function renderWorld(state, slow, slowBase, x0, y0, w, h, out) {
        tileAtlas(state, slow, slowBase);
        const atlas = state.atlas, mb = MAP_ADDR - slowBase;
        for (let y = 0; y < h; y++) {
            const wy = y0 + y, cr = wy >> 4, ry = (wy & 15) * 16, ob = y * w;
            if (cr < 0 || cr >= MAP_H) { out.fill(0, ob, ob + w); continue; }
            const rb = mb + cr * MAP_W * 2;
            for (let x = 0; x < w; x++) {
                const wx = x0 + x, cc = wx >> 4;
                if (cc < 0 || cc >= MAP_W) { out[ob + x] = 0; continue; }
                const word = (slow[rb + cc * 2] << 8) | slow[rb + cc * 2 + 1]; let t = word >> 6;
                if (!t && (word & 63) && state.diskMap) t = state.diskMap[cr * MAP_W + cc] >> 6;   // podklad objektu (dlazdice 0 + typ): puvodni dlazdice z diskety
                out[ob + x] = t < TILE_N ? atlas[t * 256 + ry + (wx & 15)] : 0;
            }
        }
    }
    // --- HUD: 2 bitplany (radky 43..50 nahore, 293..299 dole), barvy menene copperem uvnitr radku (tools/hudcheck.py, 100 %):
    // pozice zmeny x = 2*HP - 142 (okno od lores 142), MOVE trva 4 px, WAIT, ktery ceka, 0 px, WAIT s uz splnenou podminkou 20 px;
    // radek planu 40 B s modulem -2 (krok 38 B), BPLCON1 0xDD -> prvni bit 0; radek 51 je cerny.
    const HUD_ROWS = [[43, 52], [293, 300]], HUD_H = 9 + 7;   // 43..51 (9 radku, 51 cerny) + 293..299 (7 radku)
    function hudEvents(chip, base) {
        const u16c = (a) => (chip[a - base] << 8) | chip[a - base + 1];
        let a = COP1, line = 0, hp = 0; const ev = {}, ptrs = {}; let vbase = 0; const bpl = {};
        for (let k = 0; k < 4000; k++) {
            const w1 = u16c(a), w2 = u16c(a + 2); a += 4;
            if (w1 === 0xffff && w2 === 0xfffe) break;
            if (w1 & 1) { const vp = (w1 >> 8) & 0xff, h = w1 & 0xfe; if (vp === 255 && h > 200 && vbase === 0) { vbase = 256; line = 255; hp = h; } else { line = vp + vbase; hp = h; } continue; }
            const reg = w1 & 0x1fe, val = w2;
            if (reg === 0x0e0 || reg === 0x0e2 || reg === 0x0e4 || reg === 0x0e6) { bpl[reg] = val; if (bpl[0x0e0] !== undefined && bpl[0x0e2] !== undefined) ptrs[line * 2] = ((bpl[0x0e0] << 16) | bpl[0x0e2]) >>> 0; if (bpl[0x0e4] !== undefined && bpl[0x0e6] !== undefined) ptrs[line * 2 + 1] = ((bpl[0x0e4] << 16) | bpl[0x0e6]) >>> 0; }
            if (reg >= 0x180 && reg <= 0x1be) (ev[line] || (ev[line] = [])).push([hp, (reg - 0x180) >> 1, val]);
        }
        return { ev, ptrs };
    }
    /** HUD jako RGBA 293 x 16: radky 43..51 (51 cerny) a 293..299. chip = Uint8Array chip RAM, base jeji adresa (0). */
    function renderHud(chip, base) {
        const { ev, ptrs } = hudEvents(chip, base);
        const out = new Uint8ClampedArray(WIN_W * HUD_H * 4), px32 = new Uint32Array(out.buffer);
        const pal = new Uint16Array(32);
        const lines = Object.keys(ev).map(Number).sort((a, b) => a - b);
        let row = 0;
        for (const [l0, l1] of HUD_ROWS) {
            const start = row;
            for (const l of lines) { if (l >= l0) break; for (const e of ev[l]) pal[e[1]] = e[2]; }   // stav palety pred prvnim radkem
            let p0 = -1, p1 = -1;
            for (const k of Object.keys(ptrs)) { const ln = k >> 1; if (ln <= l0 && ln > ((k & 1) ? p1 : p0)) { if (k & 1) p1 = ln; else p0 = ln; } }
            const ptr = [ptrs[p0 * 2], ptrs[p1 * 2 + 1]];
            for (let L = l0; L < l1; L++, row++) {
                const i = L - l0, o0 = ptr[0] - base + 38 * i, o1 = ptr[1] - base + 38 * i;
                const changes = []; let pos = -1000;
                for (const [hp, reg, val] of (ev[L] || [])) {
                    if (hp) { const t = 2 * hp - 142; pos = t > pos ? t : pos + 20; } else pos = -1000;
                    pos += 4; changes.push([pos > -1000 ? pos : -1, reg, val]);
                }
                let ci = 0;
                const black = (L === 51);
                for (let x = 0; x < WIN_W; x++) {
                    while (ci < changes.length && changes[ci][0] <= x) { pal[changes[ci][1]] = changes[ci][2]; ci++; }
                    const byte = x >> 3, bit = 7 - (x & 7);
                    const idx = ((chip[o0 + byte] >> bit) & 1) | (((chip[o1 + byte] >> bit) & 1) << 1);
                    px32[row * WIN_W + x] = black ? 0xff000000 : RGB12[pal[idx] & 0xfff];
                }
                while (ci < changes.length) { pal[changes[ci][1]] = changes[ci][2]; ci++; }
            }
        }
        return out;
    }
    // --- okraj okna z bufferu hry podle razitek (docs/RENDER.md 13). Buffer je lineárni: radek 42 B (336 px), 288 radku v kruhu
    // (plan + 0x303C), ukazatel radku 0 (sada 2 copperu) se posouva o slovo na 16 px; hardware zobrazi z kazdeho radku jen okno
    // 293 x 240. Hra obnovuje jen sloupec hned za oknem (bajty 38-39 vpravo, 40-41 predchoziho radku = x -16..-1 vlevo) a objekty
    // kresli do celeho bufferu, zbytek okraje je zastaraly. Razitko bajtu = klic svetove pozice (radek sveta, bajt sveta) v okamziku
    // zapisu pod stejnym stitkem (radek r, bajt b v [0,42)); v okraji se ukaze jen bajt, jehoz razitko rovna se klici dnesni pozice.
    const STAMP_SPLIT = 264;                 // radek kruhu k >= 264 (vuci camRow) = nad oknem (k - 288), jinak pod oknem
    const PLANE_STRIDE = ROWB * 294, BUF_LEN = 5 * PLANE_STRIDE;
    function stampKey(wy, wByte) { return ((wy + 4096) * 1024 + (wByte + 512)) | 0; }
    /** Stitek linearni adresy a: {buf, p, r, b} vuci zakladne base0 (radek 0 planu 0 zobrazeneho bufferu); druhy buffer lezi o BUF_LEN dal/bliz.
     *  Hardware cte z radku 40 B od ukazatele, bajty 40-41 radku r proto nikdy nejsou radek r, ale prvni slovo radku r + 1 po posunu
     *  ukazatele o slovo zpet (x -16..-1): stitek je (r + 1, b - 42), b v [-2, 40). */
    function labelOf(a, base0) {
        const d = a - base0, buf = Math.floor(d / BUF_LEN), d2 = d - buf * BUF_LEN, p = (d2 / PLANE_STRIDE) | 0, rem = d2 - p * PLANE_STRIDE; let r = (rem / ROWB) | 0, b = rem - r * ROWB;
        if (b >= ROWB - 2) { r++; b -= ROWB; }
        return { buf, p, r, b };
    }
    /** Klic svetove pozice bajtu na adrese a (0 = bajt mimo kruh radku 0..287 nebo mimo 5 planu). */
    function stampKeyOf(a, base0, camRow, fine, camX, camY) {
        const L = labelOf(a, base0);
        if (L.r < 0 || L.r >= BUF_ROWS || L.p > 4) return 0;
        let k = (((L.r - camRow) % BUF_ROWS) + BUF_ROWS) % BUF_ROWS; if (k >= STAMP_SPLIT) k -= BUF_ROWS;
        return stampKey(camY + 68 + k, ((camX - 3 - fine) >> 3) + L.b);
    }
    /** Orazitkuje bajty bufferu zapsane v tomto kroku (wrlog[a - wrBase] != 0) klicem jejich svetove pozice. Vraci pocet. */
    function stampWrites(stamp, stampAt, stampBase, wrlog, wrBase, cop, camX, camY, stepNo) {
        if (!cop.level || cop.sets.length < 2) return 0;
        const base0 = cop.sets[1].ptrs[0], camRow = camRowOf(cop), fine = fineOf(cop); let n = 0;
        const w32 = new Uint32Array(wrlog.buffer, wrlog.byteOffset, wrlog.length >> 2);
        for (let i = 0; i < w32.length; i++) {
            if (!w32[i]) continue;
            for (let j = 0; j < 4; j++) {
                const o = i * 4 + j; if (!wrlog[o]) continue;
                const a = wrBase + o, key = stampKeyOf(a, base0, camRow, fine, camX, camY);
                stamp[a - stampBase] = key; stampAt[a - stampBase] = stepNo; if (key) n++;
            }
        }
        return n;
    }
    /** Do out (indexy vyrezu view) dokresli mimo okno 293 x 240 bajty bufferu s platnym razitkem, zapsane nejvyse pred maxAge kroky
     *  (hra kresli zive objekty do zadniho bufferu kazdy sudy krok, zobrazeny buffer je tedy stary 1-2 kroky; co hra prestala kreslit,
     *  napr. objekt za svou orezovou mezi, zustane terenu z mapy). Vraci pocet ukazanych bajtu. */
    function marginLayer(stamp, stampAt, stampBase, chip, cop, camX, camY, view, out, stepNo, maxAge) {
        if (!cop.level || cop.sets.length < 2) return 0;
        const base0 = cop.sets[1].ptrs[0], camRow = camRowOf(cop), fine = fineOf(cop); let valid = 0;
        const winX0 = Math.max(0, -fine);                                   // sloupce okna pred prvnim bitem radku (fine < 0) patri okraji
        for (let vy = 0; vy < view.h; vy++) {
            const k = vy + view.y0, r = ((camRow + k) % BUF_ROWS + BUF_ROWS) % BUF_ROWS, inRows = k >= 0 && k < PF_H;
            const bmin = Math.floor((view.x0 + fine) / 8), bmax = Math.floor((view.x0 + view.w - 1 + fine) / 8);
            for (let b = Math.max(bmin, -2); b <= Math.min(bmax, ROWB - 3); b++) {   // bajty -2..39 radku: jen ty hardware pro radek cte
                const x0 = b * 8 - fine - view.x0;                      // prvni pixel bajtu ve vyrezu
                if (inRows && x0 >= winX0 && x0 + 7 < WIN_W) continue;  // cely bajt v okne: okno uz je vlozeno z bufferu
                const a0 = base0 + r * ROWB + b, key = stampKeyOf(a0, base0, camRow, fine, camX, camY);
                if (!key) continue;
                let ok = true; for (let p = 0; p < 5 && ok; p++) { const o = a0 + p * PLANE_STRIDE - stampBase; if (stamp[o] !== key || stepNo - stampAt[o] > maxAge) ok = false; }
                if (!ok) continue;
                valid++;
                for (let bit = 0; bit < 8; bit++) {
                    const vx = x0 + bit, wx = vx + view.x0; if (vx < 0 || vx >= view.w) continue;
                    if (inRows && wx >= winX0 && wx < WIN_W) continue;
                    let idx = 0; for (let p = 0; p < 5; p++) if (chip[a0 + p * PLANE_STRIDE] & (0x80 >> bit)) idx |= 1 << p;
                    out[vy * view.w + vx] = idx;
                }
            }
        }
        return valid;
    }
    // --- objekty hry ze zaznamu kresleni (docs/RENDER.md 14, zmereno 2026-10-21): seznam ukazatelu na zaznamy 0xC1242E (do nuly),
    // zaznam 284 B: slovo -4/-2 = svetova poloha (volny = x 32000 nebo y 30000), +4 long < 0 = kopie bez masky zarovnana na 16 px
    // (plameny), jinak cookie-cut; +22 ukazatel animace -> long = popisovac snimku: +4 sirka px, +6 vyska, +10 posun y, +22 krok planu zdroje,
    // +26 BLTSIZE, +28 data (B, u kopie A), +32 modulo zdroje, +36 maska (A). Levy horni pixel kresby = svet + (-1, +52 + posun y), u kopie bez masky obe souradnice & ~15.
    const OBJ_LIST = 0xc1242e;
    function objectRecords(slow, slowBase) {
        const u16 = (a) => (slow[a - slowBase] << 8) | slow[a - slowBase + 1], s16 = (a) => u16(a) << 16 >> 16, u32 = (a) => ((u16(a) << 16) | u16(a + 2)) >>> 0;
        const out = [];
        for (let p = OBJ_LIST; p < OBJ_LIST + 64 * 4; p += 4) {
            const r = u32(p); if (!r) break;
            const wx = s16(r - 4), wy = s16(r - 2); if (wx >= 30000 || wy >= 30000) continue;
            const ap = u32(r + 22); if (ap < slowBase || ap >= slowBase + slow.length) continue;
            const d = u32(ap); if (d < slowBase || d >= slowBase + slow.length) continue;
            out.push(descObject(u16, s16, u32, d, { rec: r, wx, wy, copy: (u32(r + 4) | 0) < 0, cell: u32(r + 66) }));
        }
        return out;
    }
    function descObject(u16, s16, u32, d, o) {
        const bs = u16(d + 26);
        return Object.assign(o, { desc: d, w: s16(d + 4), h: bs >> 6, words: bs & 63, dy: s16(d + 10), plane: u32(d + 22), data: u32(d + 28), mod: s16(d + 32), mask: u32(d + 36) });
    }
    // --- nahled nespustenych spawneru (jen zobrazeni, jako okraj Superfrogu): hra spawner aktivuje, az jeho bunka dojede k okraji
    // jejiho okna (obsluha posunu 0xC03EAA + typ*4); v sirsim vyrezu by do te doby chybely napr. plameny motoru lodi. Typy 24-29:
    // obsluha `bsr 0xC0AA60; lea DEF,a1; bsr 0xC0AB42; bra 0xC0AB0A`, DEF = seznam snimku po 8 B (long popisovac, slovo +6 doba v tiku
    // logiky, konec = zaporny long), zaznamy techto typu jsou kopie bez masky (+4 = -1, zmereno); poloha zaznamu = (sloupec*16 + 16,
    // (radek - 4)*16 + 16) (0xC0AB0A, 0xC001E2 = mapa + 4 radky). Typy 30, 31 a 40 (mimozemstane) se nenahlizi.
    const PREVIEW_TYPES = [24, 25, 26, 27, 28, 29];
    function spawnPreviews(slow, slowBase, x0, y0, w, h, tick, activeCells) {
        const u16 = (a) => (slow[a - slowBase] << 8) | slow[a - slowBase + 1], s16 = (a) => u16(a) << 16 >> 16, u32 = (a) => ((u16(a) << 16) | u16(a + 2)) >>> 0;
        const out = [], c0 = Math.max(0, (x0 >> 4) - 2), c1 = Math.min(MAP_W - 1, ((x0 + w) >> 4) + 1), r0 = Math.max(0, (y0 >> 4) - 2), r1 = Math.min(MAP_H - 1, ((y0 + h) >> 4) + 1);
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
            const cell = MAP_ADDR + (r * MAP_W + c) * 2, t = u16(cell) & 63;
            if (!PREVIEW_TYPES.includes(t) || activeCells.has(cell)) continue;
            const hnd = 0xc03eaa + 4 * t + 2 + s16(0xc03eaa + 4 * t + 2);
            if (u16(hnd + 4) !== 0x43f9) continue;
            const def = u32(hnd + 6), frames = [];
            for (let e = def; frames.length < 16; e += 8) { const d = u32(e); if (d & 0x80000000) break; for (let k = 0; k <= Math.max(0, s16(e + 6)); k++) frames.push(d); }
            if (!frames.length) continue;
            const d = frames[tick % frames.length];
            out.push(descObject(u16, s16, u32, d, { rec: 'p' + cell, wx: c * 16 + 16, wy: (r - 4) * 16 + 16, copy: true, cell, preview: true }));
        }
        return out;
    }
    /** Nakresli objekty do indexu out (view.w x view.h, svetovy pocatek vyrezu (ox, oy)); cov[] = 1 pro zakryte pixely. Polohy lze
     *  posunout (pos(o) -> {x, y}, interpolace). Vraci pocet nakreslenych pixelu. */
    function drawObjects(objs, chip, ox, oy, w, h, out, cov, pos) {
        let n = 0;
        for (let oi = objs.length - 1; oi >= 0; oi--) {   // hra kresli seznam od konce (0xC11C24 movea.l -(a0),a2): prvni v seznamu je navrchu
            const o = objs[oi], P = pos ? pos(o) : { x: o.wx, y: o.wy };
            let X = Math.round(P.x) - 1, Y = Math.round(P.y) + 52 + o.dy;
            if (o.copy) { X &= ~15; Y &= ~15; }   // kopie bez masky: zarovnano na 16 ve svete (zmereno: svet + (-16, +48) pro (1888, 832))
            const words = o.words, rowB = words * 2 + o.mod, cols = o.copy ? words * 16 : (words - 1) * 16;   // cookie-cut: posledni slovo = rezerva na posun (ALWM 0)
            for (let r = 0; r < o.h; r++) {
                const vy = Y + r - oy; if (vy < 0 || vy >= h) continue;
                for (let u = 0; u < cols; u++) {
                    const vx = X + u - ox; if (vx < 0 || vx >= w) continue;
                    const byte = r * rowB + (u >> 3), bit = 0x80 >> (u & 7);
                    if (!o.copy && !(chip[o.mask + byte] & bit)) continue;
                    let idx = 0; for (let p = 0; p < 5; p++) if (chip[o.data + p * o.plane + byte] & bit) idx |= 1 << p;
                    const k = vy * w + vx; out[k] = idx; if (cov) cov[k] = 1; n++;
                }
            }
        }
        return n;
    }
    /** Obrazek snimku objektu jako RGBA (sirka = sloupce kresby, pruhledne mimo masku; kopie bez masky je nepruhledna). */
    function objectImage(o, chip, palette) {
        const words = o.words, rowB = words * 2 + o.mod, cols = o.copy ? words * 16 : (words - 1) * 16, h = o.h;
        const rgba = new Uint8ClampedArray(Math.max(1, cols * h) * 4), u32 = new Uint32Array(rgba.buffer);
        for (let r = 0; r < h; r++) for (let u = 0; u < cols; u++) {
            const byte = r * rowB + (u >> 3), bit = 0x80 >> (u & 7);
            if (!o.copy && !(chip[o.mask + byte] & bit)) continue;
            let idx = 0; for (let p = 0; p < 5; p++) if (chip[o.data + p * o.plane + byte] & bit) idx |= 1 << p;
            u32[r * cols + u] = RGB12[palette[idx] & 0xfff];
        }
        return { w: cols, h, rgba };
    }
    /** Levy horni pixel kresby objektu ve svete pro polohu zaznamu (x, y) (viz drawObjects). */
    function objectOrigin(o, x, y) { let X = x - 1, Y = y + 52 + o.dy; if (o.copy) { X = Math.floor(X / 16) * 16; Y = Math.floor(Y / 16) * 16; } return { X, Y }; }
    // --- roztazeny HUD (Vylepseno, jako Superfrog web/hud.js): udaje v puvodnim meritku, sirka navic se rozdeli do mezer pred popisky
    // LIVES (x 97), AMMO (x 150) a KEYS (x 237); mezery se vyplni opakovanim sloupce pozadi tesne pred rezem (zmereno: sloupce 88-97,
    // 142-150 a 231-237 jsou ve vsech radcich shodne s pozadim, obsah skupin do nich nezasahuje).
    const HUD_SPLITS = [97, 150, 237];
    function hudStretch(rgba, w, h, extra) {
        extra = Math.max(0, Math.round(extra));
        const W = w + extra, out = new Uint8ClampedArray(W * h * 4), src = new Uint32Array(rgba.buffer, rgba.byteOffset, w * h), dst = new Uint32Array(out.buffer);
        const gaps = HUD_SPLITS.map((_, i) => Math.floor(extra / HUD_SPLITS.length) + (i < extra % HUD_SPLITS.length ? 1 : 0));
        for (let y = 0; y < h; y++) {
            let dx = 0, sx = 0;
            for (let k = 0; k <= HUD_SPLITS.length; k++) {
                const end = k < HUD_SPLITS.length ? HUD_SPLITS[k] : w;
                for (; sx < end; sx++) dst[y * W + dx++] = src[y * w + sx];
                if (k < HUD_SPLITS.length) { const c = src[y * w + end - 1]; for (let g = 0; g < gaps[k]; g++) dst[y * W + dx++] = c; }
            }
        }
        return { w: W, rgba: out, gaps };
    }
    // --- obecny obraz z copper listu (moduly: Intex; docs/RENDER.md 15): copper po radcich paprsku (WAIT/MOVE, SKIP se bere jako
    // splneny), zmena za WAIT s hp > HFETCH plati az od dalsiho radku (data radku uz byla nactena), bitplany podle BPLCON0 (pocet planu,
    // hires, EHB), DDFSTRT/DDFSTOP (sirka nacitani), BPL1MOD/BPL2MOD, jemny posun BPLCON1, okno DIWSTRT/DIWSTOP, barvy COLORxx.
    // Prvni bit nactenych dat je na vodorovne pozici 2*DDFSTRT + 17 (lores; 0x38 -> 0x81) posunuty o BPLCON1. Mimo okno barva 0.
    // Vystup RGBA pro radky l0..l0+h a lores pozice h0..h0+w; xs = 1: krok 1 lores px (hires: dva body sloucene OR jako dosud),
    // xs = 2: krok 1 hires px (sirka 2w; obrazovky v hires, napr. upoutavka uvodu BPLCON0 0xC200). Uvnitr vzdy v hires bodech.
    function renderCopperFrame(chip, chipBase, coplc, init, l0, h, h0, w, out, xs, st) {
        xs = xs === 2 ? 2 : 1; const OW = w * xs;
        // st (volitelne): { vOpen } = svisle okno jako klopny obvod hardwaru – otevre se na radku DIWSTRT, zavre na radku DIWSTOP a stav
        // prechazi do dalsiho snimku (konec za radkem 312 = okno zustane otevrene); bez st okno jen mezi radky start..stop v tomto snimku
        let vOpen = !!(st && st.vOpen);
        const R = new Uint16Array(256); if (init) R.set(init.subarray ? init.subarray(0, 256) : init);
        if (st && st.diw) { R[0x08e >> 1] = st.diw[0]; R[0x090 >> 1] = st.diw[1]; }   // DIWSTRT/DIWSTOP z konce minuleho snimku (zapsal je copper)
        const rd16 = (a) => { const o = a - chipBase; return (o >= 0 && o + 1 < chip.length) ? (chip[o] << 8) | chip[o + 1] : 0; };
        const ptr = (i) => ((R[(0xe0 >> 1) + 2 * i] << 16) | R[(0xe2 >> 1) + 2 * i]) >>> 0;
        const setPtr = (i, v) => { R[(0xe0 >> 1) + 2 * i] = v >>> 16; R[(0xe2 >> 1) + 2 * i] = v & 0xffff; };
        out = out || new Uint8ClampedArray(OW * h * 4); const u32 = new Uint32Array(out.buffer, out.byteOffset, OW * h);
        let cp = coplc >>> 0; const HFETCH = 0x38;
        const line = new Uint8Array(2048), sline = new Uint8Array(2048);   // po hires bodech (lores bod = 2)   // bitplany, sprity (0 = zadny, jinak barva 16-31)
        // sprity pres DMA: po zapisu SPRxPT se nacte POS/CTL z dat, pak radky dat (2 slova), na konci dalsi POS/CTL (0 = konec)
        const spr = []; for (let n = 0; n < 8; n++) spr.push({ reload: true, ptr: 0, vs: -1, ve: -1, hs: 0, att: 0, d0: 0, d1: 0 });
        const sprLoad = (n) => { const S = spr[n]; const pos = rd16(S.ptr), ctl = rd16(S.ptr + 2); S.vs = (pos >> 8) | ((ctl & 4) << 6); S.ve = (ctl >> 8) | ((ctl & 2) << 7); S.hs = ((pos & 0xff) << 1) | (ctl & 1); S.att = (ctl >> 7) & 1; S.ptr += 4; if (!pos && !ctl) S.vs = S.ve = -1; };
        // copper s vodorovnou polohou (jako hardware): instrukce = 4 takty, WAIT plati pro paprsek >= (VP, HP) v maskach (8 bitu radku:
        // po radku 255 je nizsich 8 bitu 0, proto se ceka FFDF/FFD7 a pak radky - 256); zapis po HFETCH v radku plati od dalsiho radku
        const ev = []; let cl = 0, ch = 0;
        const step = (n) => { ch += n; while (ch >= 227) { ch -= 227; cl++; } };
        for (let guard = 0; guard < 8192 && cl < 313; guard++) {
            const w1 = rd16(cp), w2 = rd16(cp + 2); cp += 4; step(4);
            if (!(w1 & 1)) { ev.push([ch <= HFETCH ? cl : cl + 1, (w1 & 0x1fe) >> 1, w2]); if (((w1 & 0x1fe) >> 1) === (0x080 >> 1) || ((w1 & 0x1fe) >> 1) === (0x082 >> 1)) R[(w1 & 0x1fe) >> 1] = w2; if (((w1 & 0x1fe) >> 1) === (0x088 >> 1)) cp = ((R[0x080 >> 1] << 16) | R[0x082 >> 1]) >>> 0; continue; }
            if (w1 === 0xffff && w2 === 0xfffe) break;
            if (w2 & 1) continue;                                       // SKIP: bez preskoceni (aproximace)
            const vp = (w1 >> 8), hp = w1 & 0xfe, ve = 0x80 | ((w2 >> 8) & 0x7f), he = w2 & 0xfe;
            const ok = (l, h) => { const a = l & 0xff & ve, b = vp & ve; return a > b || (a === b && (h & he) >= (hp & he)); };
            if (ok(cl, ch)) continue;
            if ((cl & 0xff & ve) === (vp & ve) && (hp & he) > (ch & he)) { ch = hp; step(2); continue; }   // pozdeji v tomto radku
            let l = cl + 1; while (l < 313 && !ok(l, 0xe2)) l++;
            cl = l; ch = ok(l, 0) ? 0 : hp; step(2);
        }
        // bez stavu z minuleho snimku: DIW jako by ho copper zapsal uz minule (prvni zapis v tomto snimku), ne nula z vychozich registru
        if (st && !st.diw) for (const r of [0x08e >> 1, 0x090 >> 1]) { const e = ev.find((x) => x[1] === r); if (e) R[r] = e[2]; }
        let ei = 0;
        const apply = (r, w2) => {
            R[r] = w2;
            if (r >= (0x120 >> 1) && r < (0x140 >> 1)) { const n = (r - (0x120 >> 1)) >> 1; spr[n].ptr = ((R[(0x120 >> 1) + 2 * n] << 16) | R[(0x122 >> 1) + 2 * n]) >>> 0; spr[n].reload = !spr[n].manual; }
            if (r >= (0x140 >> 1) && r < (0x180 >> 1) && ((r - (0x140 >> 1)) & 3) < 2) {   // SPRxPOS/SPRxCTL z copperu: rucni poloha, data od ukazatele (jako hra v levelu)
                const n = (r - (0x140 >> 1)) >> 2, S = spr[n], pos = R[(0x140 >> 1) + 4 * n], ctl = R[(0x142 >> 1) + 4 * n];
                S.manual = true; S.reload = false; S.vs = (pos >> 8) | ((ctl & 4) << 6); S.ve = (ctl >> 8) | ((ctl & 2) << 7); S.hs = ((pos & 0xff) << 1) | (ctl & 1); S.att = (ctl >> 7) & 1;
            }
        };
        for (let v = 0; v < 313; v++) {
            while (ei < ev.length && ev[ei][0] <= v) { apply(ev[ei][1], ev[ei][2]); ei++; }
            // radek obrazu
            const con0 = R[0x100 >> 1], hires = !!(con0 & 0x8000), np = (con0 >> 12) & 7, dpf = !!(con0 & 0x0400), ehb = np === 6 && !(con0 & 0x0800) && !dpf;
            const pf2pri = !!(R[0x104 >> 1] & 0x40);   // dual playfield: liche bitplany = PF1 (barvy 0-7), sude = PF2 (barvy 8-15), BPLCON2 bit 6 = PF2 vpredu
            const diwS = R[0x08e >> 1], diwE = R[0x090 >> 1], vs = diwS >> 8, ve2 = (diwE >> 8) | ((diwE & 0x8000) ? 0 : 0x100), hs = diwS & 0xff, he2 = (diwE & 0xff) | 0x100;
            if (st) { if (v === ve2) vOpen = false; if (v === vs) vOpen = true; }
            const inV = st ? vOpen : v >= vs && v < ve2;
            const ddfS = R[0x092 >> 1] & 0xfc, ddfE = R[0x094 >> 1] & 0xfc;
            const words = hires ? ((ddfE - ddfS) >> 2) + 2 : ((ddfE - ddfS) >> 3) + 1;
            const pal = (i) => RGB12[(i < 32 ? R[(0x180 >> 1) + i] : (R[(0x180 >> 1) + (i - 32)] >> 1) & 0x777) & 0xfff];
            const y = v - l0;
            if (inV && np > 0 && words > 0) {
                line.fill(0);
                const con1 = R[0x102 >> 1], first = 2 * ddfS + 17;
                for (let p = 0; p < np; p++) {
                    const a = ptr(p), sc = (p & 1) ? (con1 >> 4) & 15 : con1 & 15;
                    for (let k = 0; k < words; k++) {
                        const wv = rd16(a + 2 * k);
                        for (let b = 0; b < 16; b++) if (wv & (0x8000 >> b)) {
                            if (hires) { const hx = 2 * first - 17 + k * 16 + b + sc; if (hx >= 0 && hx < 2048) line[hx] |= 1 << p; }   // hires: prvni bod o 17 hires px driv nez lores (zmereno: upoutavka uvodu DDFSTRT 0x38 proti snimku vAmigy, 100 % bodu)
                            else { const hx = 2 * (first + k * 16 + b + sc); if (hx >= 0 && hx < 2047) { line[hx] |= 1 << p; line[hx + 1] |= 1 << p; } }
                        }
                    }
                    setPtr(p, (a + words * 2 + (((p & 1) ? R[0x10a >> 1] : R[0x108 >> 1]) << 16 >> 16)) >>> 0);
                }
            } else line.fill(0);
            sline.fill(0);
            // sprity tohoto radku (DMA zapnute: DMACON bit 5 se nekontroluje, pointery nastavuje copper)
            for (let n = 0; n < 8; n++) {
                const S = spr[n]; if (S.reload && S.ptr) { S.reload = false; sprLoad(n); }
                if (S.vs < 0 || v < S.vs) continue;
                if (v >= S.ve) { if (v === S.ve) { sprLoad(n); if (v < S.vs || S.vs < 0) continue; } else continue; }   // konec spritu: DMA nacte dalsi POS/CTL (i po zapisu copperem)
                S.d0 = rd16(S.ptr); S.d1 = rd16(S.ptr + 2); S.ptr += 4;
            }
            for (let n = 0; n < 8; n += 2) {
                const A = spr[n], B = spr[n + 1], att = B.att;
                for (const [S, k] of att ? [[A, n]] : [[A, n], [B, n + 1]]) {
                    if (S.vs < 0 || v < S.vs || v >= S.ve) continue;
                    for (let x = 0; x < 16; x++) {
                        const sh = 15 - x; let c = ((S.d0 >> sh) & 1) | (((S.d1 >> sh) & 1) << 1);
                        if (att && v >= B.vs && v < B.ve) c |= (((B.d0 >> sh) & 1) << 2) | (((B.d1 >> sh) & 1) << 3);
                        if (!c) continue; const hx = 2 * (S.hs + 1 + x); if (hx >= 0 && hx < 2047 && !sline[hx]) sline[hx] = sline[hx + 1] = att ? 16 + c : 16 + 4 * (n >> 1) + c;   // nizsi cislo spritu vpredu
                    }
                }
            }
            const pfColor = (b) => {
                if (!dpf) return ehb ? b : b & 31;
                const c1 = (b & 1) | ((b >> 1) & 2) | ((b >> 2) & 4), c2 = ((b >> 1) & 1) | ((b >> 2) & 2) | ((b >> 3) & 4);
                if (pf2pri) return c2 ? 8 + c2 : c1; return c1 ? c1 : (c2 ? 8 + c2 : 0);
            };
            if (y >= 0 && y < h) for (let x = 0; x < OW; x++) {
                const lx = h0 + (xs === 2 ? x >> 1 : x), q = xs === 2 ? 2 * h0 + x : 2 * lx, b = xs === 2 ? line[q] : line[q] | line[q + 1];
                u32[y * OW + x] = (inV && lx >= hs && lx < he2) ? pal(sline[q] || pfColor(b)) : pal(0);
            }
        }
        if (st) { st.vOpen = vOpen; st.diw = [R[0x08e >> 1], R[0x090 >> 1]]; }
        return out;
    }
    return { renderCopperFrame, hudStretch, HUD_SPLITS, spawnPreviews, objectRecords, drawObjects, objectImage, objectOrigin, OBJ_LIST, parseCopper, renderIndices, drawSprites, paint, fineOf, camRowOf, renderWorld, tileAtlas, renderHud, stampWrites, marginLayer, labelOf, stampKey, stampKeyOf, PLANE_STRIDE, BUF_LEN, STAMP_SPLIT, RGB12, COP1, ROWB, PF_START, PF_H, WIN_W, BUF_ROWS, BUF_W, MAP_W, MAP_H, HUD_H };
})();
if (typeof module !== 'undefined') module.exports = RENDER;
