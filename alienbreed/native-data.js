// native-data.js - data hry Alien Breed SE92 primo z ADF, bez ROM a emulatoru.
// Prepis zmerenych rutin: OFS cteni jako zavadec hry (docs/loader.md, tools/ofs.py),
// Atomik "ATN!" dekruncher (docs/loader.md, tools/atomik.py, bajtove overeno 40/40 souboru),
// kontejner T7MP a dlazdice (docs/MAP.md, tools/maptest.py). Zadna herni logika.
'use strict';
const NATIVE_DATA = (() => {
    const SECTOR = 512;
    const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    const i32 = (b, o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    const u16 = (b, o) => (b[o] << 8) | b[o + 1];
    const block = (adf, n) => adf.subarray(n * SECTOR, (n + 1) * SECTOR);
    const bstr = (b, o) => { let s = ''; for (let i = 0; i < b[o]; i++) s += String.fromCharCode(b[o + 1 + i]); return s; };

    // --- OFS: korenovy blok 880, hash tabulka 72 slotu, hlavicka souboru, datove bloky (0x5de2..0x6002) ---
    function rootEntries(adf, root = 880) {
        const rb = block(adf, root);
        if (adf.length !== 901120 || u32(rb, 0) !== 2 || i32(rb, 0x1fc) !== 1) throw new Error('neni OFS disketa Amigy (korenovy blok 880)');
        const out = [];
        for (let slot = 0; slot < 72; slot++) {
            let n = u32(rb, 0x18 + 4 * slot);
            while (n) {
                const hb = block(adf, n);
                out.push({ slot, header: n, type: u32(hb, 0), sec: i32(hb, 0x1fc), name: bstr(hb, 0x1b0), size: u32(hb, 0x144) });
                n = u32(hb, 0x1f0);
            }
        }
        return out;
    }
    function fileBlocks(adf, header) {
        const blocks = []; let hb = block(adf, header);
        for (;;) {
            const count = u32(hb, 8); let p = 0x138;
            for (let i = 0; i < count; i++) { p -= 4; blocks.push(u32(hb, p)); }
            const ext = u32(hb, 0x1f8);
            if (!ext) return blocks;
            hb = block(adf, ext);
        }
    }
    function readFile(adf, name) {
        const e = rootEntries(adf).find(x => x.name === name);
        if (!e) throw new Error('soubor ' + name + ' na diskete neni');
        const out = new Uint8Array(e.size); let pos = 0;
        for (const n of fileBlocks(adf, e.header)) {
            const db = block(adf, n), len = u32(db, 0xc);
            out.set(db.subarray(24, 24 + Math.min(len, e.size - pos)), pos); pos += len;
            if (pos >= e.size) break;
        }
        return out;
    }

    // --- Atomik ATN! (tools/atomik.py; komentare = adresy rutiny 0x5b88 v docs/loader.md) ---
    const T_ADD = [0x06, 0x0a, 0x0a, 0x12], T_NBITS = [1, 1, 1, 1, 2, 3, 3, 4, 4, 5, 7, 14];
    function unpackATN(buf) {
        if (!(buf[0] === 0x41 && buf[1] === 0x54 && buf[2] === 0x4e && buf[3] === 0x21)) return { data: buf, packed: false, ok: true };
        const unpackedLen = u32(buf, 4), p = u32(buf, 8);
        const src = new Uint8Array(buf.subarray(0, p));
        src.set(buf.subarray(p, p + 4), 8); src.set(buf.subarray(p + 4, p + 8), 4); src.set(buf.subarray(p + 8, p + 12), 0);   // 5ba0
        let d2 = u32(buf, p + 12);                               // 5ba6
        const d3w = u16(buf, p + 16);                            // 5ba8
        let a3 = (d3w & 0x8000) ? p : p - 1;                     // 5baa/5bac
        const base0 = [], base1 = [], nbits = [];
        for (let i = 0; i < 4; i++) { base0.push(u16(buf, p + 18 + 2 * i)); base1.push(u16(buf, p + 26 + 2 * i)); }
        for (let i = 0; i < 12; i++) nbits.push(buf[p + 34 + i]);
        const out = new Uint8Array(unpackedLen);
        let a4 = unpackedLen, d3 = d3w & 0xff;
        const bit = () => {                                      // add.b d3,d3 ; bne ; move.b -(a3),d3 ; addx.b d3,d3
            let c = (d3 >> 7) & 1; d3 = (d3 << 1) & 0xff;
            if (d3 === 0) { a3--; const n = src[a3]; d3 = ((n << 1) | c) & 0xff; c = (n >> 7) & 1; }
            return c;
        };
        for (;;) {
            while (d2) { a3--; a4--; out[a4] = src[a3]; d2--; }   // 5bc0
            if (!(a4 > 0)) break;                                 // 5bca
            let d4, d0;
            if (bit() === 0) { d4 = 2; d0 = 0; }
            else if (bit() === 0) { d4 = 3; d0 = 1; }
            else if (bit() === 0) { d4 = 4; d0 = 2; }
            else if (bit() === 0) { d4 = 5; d0 = 3; }
            else if (bit() === 0) { d4 = 0; for (let i = 0; i < 3; i++) d4 = ((d4 << 1) | bit()) & 0xff; d4 = (d4 + 6) & 0xff; d0 = 3; }   // 5c1a
            else { a3--; d4 = src[a3]; d0 = 3; }                  // 5c14
            let d5 = 0; const d1 = d0;                            // 5c54
            if (bit() === 0) { } else if (bit() === 0) { d5 = 2; d0 += 4; } else { d5 = T_ADD[d0]; d0 += 8; }
            for (let i = 0; i < T_NBITS[d0]; i++) d2 = ((d2 << 1) | bit()) & 0xffff;
            d2 = (d2 + d5) & 0xffff;                              // 5c8a
            d5 = 0; let a2 = 0; d0 = d1;                          // 5c8c
            if (bit() === 0) { } else if (bit() === 0) { a2 = base0[d1]; d0 += 4; } else { a2 = base1[d1]; d0 += 8; }
            for (let i = 0; i < nbits[d0]; i++) d5 = ((d5 * 2) + bit()) >>> 0;
            a2 = a2 + 1 + d5 + a4;                                // 5cc8
            const n = d4 || 256;                                  // 5cce
            for (let i = 0; i < n; i++) { a2--; a4--; out[a4] = out[a2]; }
        }
        return { data: out, packed: true, ok: a3 === 0 };
    }

    // --- T7MP (docs/MAP.md 2-3) ---
    function t7mp(m) {
        if (!(m[0] === 0x54 && m[1] === 0x37 && m[2] === 0x4d && m[3] === 0x50)) throw new Error('neni kontejner T7MP');
        const chunks = {}; let q = 12;
        while (q + 8 <= m.length) {
            const name = String.fromCharCode(m[q], m[q + 1], m[q + 2], m[q + 3]), len = u32(m, q + 4);
            chunks[name] = m.subarray(q + 8, q + 8 + len); q += 8 + len;
        }
        return chunks;
    }
    const MAP_W = 124, MAP_H = 109, MAP_ROW0 = 7;      // tabulka 0xC47288: c0341a
    function runtimeMap(body, xb, yb) {
        const t = new Uint16Array(MAP_W * MAP_H);        // vynulovano; ROL.W #6: index v bitech 6-15, typ 0-5
        for (let r = 0; r < yb; r++) for (let c = 0; c < xb; c++) {
            const v = u16(body, 2 * (r * xb + c));
            t[(MAP_ROW0 + r) * MAP_W + c] = ((v << 6) | (v >> 10)) & 0xffff;
        }
        return t;
    }
    // dlazdice 160 B = 5 planu po 32 B, plan = 16 radku po slovu, MSB vlevo (c050f2)
    function tiles(lab) {
        const n = (lab.length / 160) | 0, out = new Uint8Array(n * 256);
        for (let t = 0; t < n; t++) for (let p = 0; p < 5; p++) for (let r = 0; r < 16; r++) {
            const o = t * 160 + p * 32 + r * 2, w = (lab[o] << 8) | lab[o + 1];
            for (let x = 0; x < 16; x++) if ((w >> (15 - x)) & 1) out[t * 256 + r * 16 + x] |= 1 << p;
        }
        return out;
    }
    function startCell(map) {                            // c0b17a: typ 53 -> (sloupec*16+4, radek*16-54), vychozi (1280, 320)
        for (let i = 0; i < map.length; i++) if ((map[i] & 63) === 53) { const c = i % MAP_W, r = (i / MAP_W) | 0; return { x: Math.max(0, c * 16 + 4), y: Math.max(0, r * 16 - 54), cell: [c, r] }; }
        return { x: 1280, y: 320, cell: null };
    }
    // tabulka souboru levelu (0xC0ABF6): mapa, animace, dlazdice (jmeno z IFFP), objekty
    const LEVEL_FILES = ['L0MA', 'L1MA', 'L2MA', 'L3MA', 'L4MA', 'L5MA', 'L6MA', 'L7MA', 'L8MA', 'L9MA', 'LAMA', 'LBMA'];
    function level(adf2, index = 0) {
        const mapRaw = readFile(adf2, LEVEL_FILES[index]), mapU = unpackATN(mapRaw);
        const ch = t7mp(mapU.data);
        const xb = u32(ch.XBLK, 0), yb = u32(ch.YBLK, 0);
        const tilesName = String.fromCharCode(ch.IFFP[13], ch.IFFP[14], ch.IFFP[15], ch.IFFP[16]);   // c0b1e8
        const labRaw = readFile(adf2, tilesName), labU = unpackATN(labRaw);
        const pal = []; for (let i = 0; i < 32; i++) pal.push(u16(ch.PALA, 64 + 2 * i));         // c0b200: +68 od chunku
        pal[0] = 0;                                                                              // clr.w COLOR00
        const map = runtimeMap(ch.BODY, xb, yb);
        return { index, xb, yb, map, tiles: tiles(labU.data), tileCount: labU.data.length / 160, pal, tilesName, start: startCell(map),
                 files: { map: { name: LEVEL_FILES[index], packed: mapRaw.length, size: mapU.data.length, ok: mapU.ok, data: mapU.data },
                          tiles: { name: tilesName, packed: labRaw.length, size: labU.data.length, ok: labU.ok, data: labU.data } } };
    }
    // --- start z ADF (docs/NATIVE.md 5b): vychozi pamet jako pri predani z LOAD do PARTF (zmereno stopou) ---
    const HUNK_BASES = [0xc00000, 0xc4dc20, 0x400, 0x1559c];     // hunk 0 kod, 1 BSS (fast), 2 chip (= partc), 3 chip (buffery)
    const HANDOFF = [{ addr: 0xc210db, bytes: [0x71, 0x4e, 0x71, 0x4e, 0x71] }];   // zaplata LOAD: 3x NOP (build/cap/handoff.json)
    const HANDOFF_REGS = { a7: 0x7f830, d0: 0x20, a0: 0x400, sr: 0x2004 };
    function hunks(file) {
        if (u32(file, 0) !== 0x3f3) throw new Error('neni HUNK soubor');
        const n = u32(file, 8), sizes = []; for (let i = 0; i < n; i++) sizes.push((u32(file, 20 + 4 * i) & 0x3fffffff) * 4);
        let pos = 20 + 4 * n; const out = [];
        while (pos + 4 <= file.length) {
            const t = u32(file, pos);
            if (t === 0x3e9 || t === 0x3ea) { const sz = u32(file, pos + 4) * 4; out.push({ type: t, data: file.subarray(pos + 8, pos + 8 + sz), relocs: [] }); pos += 8 + sz; }
            else if (t === 0x3eb) { out.push({ type: t, size: u32(file, pos + 4) * 4, relocs: [] }); pos += 8; }
            else if (t === 0x3ec) {
                let q = pos + 4;
                for (;;) { const cnt = u32(file, q); if (!cnt) { q += 4; break; } const h = u32(file, q + 4); const offs = []; for (let i = 0; i < cnt; i++) offs.push(u32(file, q + 8 + 4 * i)); out[out.length - 1].relocs.push({ hunk: h, offs }); q += 8 + 4 * cnt; }
                pos = q;
            } else if (t === 0x3f2) pos += 4;
            else throw new Error('neznamy blok HUNK 0x' + t.toString(16));
        }
        return { sizes, blocks: out };
    }
    /** Vychozi pamet 1 MB (chip 0-0x7FFFF, slow 0xC00000-0xC7FFFF na 0x80000): PARTF hunk 0 relokovany na 0xC00000
     *  (baze hunku zmereny), chip hunk 2 = data hunku souboru partc, zaplata LOAD. Vraci { ram, regs, info }. */
    function bootImage(adf1) {
        const partfRaw = readFile(adf1, 'PARTF'), partf = unpackATN(partfRaw); const h = hunks(partf.data);
        const code = new Uint8Array(h.blocks[0].data);
        for (const r of h.blocks[0].relocs) { const base = HUNK_BASES[r.hunk]; for (const o of r.offs) { const v = (u32(code, o) + base) >>> 0; code[o] = v >>> 24; code[o + 1] = (v >>> 16) & 255; code[o + 2] = (v >>> 8) & 255; code[o + 3] = v & 255; } }
        const partcRaw = readFile(adf1, 'partc'), partc = unpackATN(partcRaw);
        if (u32(partc.data, 0) !== 0x3ea) throw new Error('partc neni datovy hunk');
        const chip2 = partc.data.subarray(8, 8 + u32(partc.data, 4) * 4);
        const ram = new Uint8Array(0x100000);
        ram.set(code, 0x80000); ram.set(chip2, 0x400);
        for (const p of HANDOFF) ram.set(Uint8Array.from(p.bytes), 0x80000 + (p.addr - 0xc00000));
        return { ram, regs: { ...HANDOFF_REGS }, info: { partf: { packed: partfRaw.length, size: partf.data.length, ok: partf.ok, hunks: h.sizes.length, relocs: h.blocks[0].relocs.reduce((a, r) => a + r.offs.length, 0) }, partc: { packed: partcRaw.length, size: partc.data.length, ok: partc.ok, data: chip2.length } } };
    }
    /** Uvod originalu (docs/NATIVE.md 5k): program `load` z disku 1 (ATN!, jeden hunk CODE, 210 relokaci) relokovany na 0x4D768 jako
     *  zavadeci blok (zmereno: shodny se zachytem build/cap/blocks/load_relocated_at_4d768.bin v cele delce kodu); 0x7D20A = rts jako
     *  blok 0x300 pred skokem (jinak trap #0). Vraci { addr, data }; vstup 0x7A48E s a0 = 0x400, a1 = 0xC00000, a2 = 0. */
    const INTRO_BASE = 0x4d768, INTRO_ENTRY = 0x7a48e;
    function introImage(adf1) {
        const u = unpackATN(readFile(adf1, 'load')); const h = hunks(u.data);
        const code = new Uint8Array(h.blocks[0].data);
        for (const r of h.blocks[0].relocs) for (const o of r.offs) { const v = (u32(code, o) + INTRO_BASE) >>> 0; code[o] = v >>> 24; code[o + 1] = (v >>> 16) & 255; code[o + 2] = (v >>> 8) & 255; code[o + 3] = v & 255; }
        code[0x7d20a - INTRO_BASE] = 0x4e; code[0x7d20b - INTRO_BASE] = 0x75;
        // 0x7A8A8 jmp (a3) = skok do hry za uvodem; blok 0x300 tam v originalu zapise ILLEGAL 0x4AFC, u nas se nikdy neprovede (uvod konci
        // pri nahrani PARTF), pro preklad rts
        code[0x7a8a8 - INTRO_BASE] = 0x4e; code[0x7a8a9 - INTRO_BASE] = 0x75;
        return { addr: INTRO_BASE, data: code, entry: INTRO_ENTRY };
    }
    /** Soubor pro nahravaci rutinu hry: cesta "DISKn:JMENO" -> bajty souboru (zabalene, jak jsou na disketě). */
    /** Doba nahrani souboru z diskety v originalu (snimky; zmereno 2026-10-22 ve stope lv2load: LBMA/L1AN/LEBM/L1BO 128/199/296/250 snimku
     *  mezi vstupy do nahravace 0xC0FE50, po odecteni prace procesoru; docs/NATIVE.md 5j): nahravac cte korenovy blok 880, retez hashe
     *  adresare (hlavicky jinych souboru se stejnym hashem), hlavicku a data po stopach (11 bloku); cas = 12,5 + 21,3 x prectena stopa
     *  (~2 otacky) + 0,51 x krok hlavy (cylindr), odchylka fitu do 2 snimku. head = cylindr hlavy pred nahranim, vraci i novy. */
    function diskTime(adf, name, head) {
        const rb = block(adf, 880); let h = name.length; for (const ch of name.toUpperCase()) h = (h * 13 + ch.charCodeAt(0)) & 0x7ff;
        const seq = [880]; let n = u32(rb, 0x18 + 4 * (h % 72)), hdr = 0;
        while (n) { seq.push(n); const hb = block(adf, n); if (bstr(hb, 0x1b0).toUpperCase() === name.toUpperCase()) { hdr = n; break; } n = u32(hb, 0x1f0); }
        if (hdr) for (const b of fileBlocks(adf, hdr)) seq.push(b);
        let tracks = 0, steps = 0, last = -1, cyl = head || 0;
        for (const b of seq) { const t = (b / 11) | 0; if (t === last) continue; last = t; tracks++; steps += Math.abs((t >> 1) - cyl); cyl = t >> 1; }
        return { frames: Math.round(12.5 + 21.3 * tracks + 0.51 * steps), tracks, steps, head: cyl };
    }
    function gameFile(adf1, adf2, path) {
        const m = /^DISK([12]):(.+)$/.exec(path); if (!m) return null;
        try { return readFile(m[1] === '1' ? adf1 : adf2, m[2]); } catch (e) { return null; }
    }
    /** Obsah hry pro klic zapecetenych souboru prezentace (arek 0.5.12 payload, present/README.md): soubory, ktere prezentace levelu 1
     *  cte (zmereno 2026-10-24 pruchodem k vytahu a game over: start z ADF = PARTF, partc, mapa L0MA a dlazdice LABM; nahravac hry
     *  pri startu levelu CSAM, FSAM, MUSC, DECK, L0MA, L0AN, LABM, L0BO), v tomto pevnem poradi (podle "DISKn:JMENO"), kazdy rozbaleny
     *  (ATN!): "DISKn:JMENO\0delka\0" + bajty. Nezavisi na bootbloku, zavadeci (load), cracktru, nazvu ani poloze bloku na disketě.
     *  Chybi-li soubor nebo se nerozbali, vyhodi chybu s .file. */
    const PAYLOAD_FILES = ['DISK1:CSAM', 'DISK1:FSAM', 'DISK1:PARTF', 'DISK1:partc', 'DISK2:DECK', 'DISK2:L0AN', 'DISK2:L0BO', 'DISK2:L0MA', 'DISK2:LABM', 'DISK2:MUSC'];
    function payload(adf1, adf2) {
        const parts = []; let n = 0;
        for (const p of PAYLOAD_FILES) {
            const m = /^DISK([12]):(.+)$/.exec(p); let u;
            try { u = unpackATN(readFile(m[1] === '1' ? adf1 : adf2, m[2])); } catch (e) { e.file = p; throw e; }
            if (!u.ok) { const e = new Error(p + ': ATN! se nerozbalil'); e.file = p; throw e; }
            const head = Uint8Array.from(p + '\0' + u.data.length + '\0', (c) => c.charCodeAt(0));
            parts.push(head, u.data); n += head.length + u.data.length;
        }
        const out = new Uint8Array(n); let o = 0; for (const q of parts) { out.set(q, o); o += q.length; }
        return out;
    }
    async function sha256(u8) {
        const h = await crypto.subtle.digest('SHA-256', u8); return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return { payload, PAYLOAD_FILES, rootEntries, readFile, diskTime, introImage, unpackATN, t7mp, runtimeMap, tiles, level, sha256, hunks, bootImage, gameFile, HUNK_BASES, HANDOFF, HANDOFF_REGS, MAP_W, MAP_H, MAP_ROW0, LEVEL_FILES };
})();
if (typeof module !== 'undefined') module.exports = NATIVE_DATA;
