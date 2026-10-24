// Samostatne nacteni dat. Zadna ROM, snapshot ani emulator.
// Format: docs/LOADER.md; dekruncher MAIN 0xe2c / 0xf48 / 0x11be.
'use strict';
const NativeData = (() => {
    function requireOK(ok, message) { if (!ok) throw new Error(message); }
    function byte(a, p) { requireOK(Number.isInteger(p) && p >= 0 && p < a.length, 'Data mimo rozsah'); return a[p]; }
    const word = (a, p) => byte(a, p) * 256 + byte(a, p + 1);
    const long = (a, p) => word(a, p) * 65536 + word(a, p + 2);
    function size(n) { requireOK(n > 0 && n <= 0x100000, 'Neplatna delka rozbalenych dat'); return n; }
    function unpack(src) {
        const l1 = size(long(src, 0)), l2 = size(long(src, 4)), l3 = size(long(src, 8));
        // Huffman: pomala bitova cesta 0xef0-0xf18; rychla tabulka neni nutna.
        let p = 12;
        p += 3; const n = byte(src, p++);
        requireOK(n > 0 && n <= 32, 'Neplatny Huffman');
        const c0 = [], c1 = [], c2 = [], c3 = [];
        let d5 = 2, d6 = 256, d7 = 0, extra = 0;
        for (let i = 0; i < n; i++) {
            const a = byte(src, p++), b = byte(src, p++), total = a + b;
            extra += 2 * b; c0.push(a); c1.push(total);
            c2.push((d6 - 2 * a) & 65535); c3.push((d7 - total) & 65535);
            d7 = (d7 + d5 - total) >>> 0; d6 = (d6 + 2 * b) >>> 0; d5 = 2 * a;
        }
        const symbols = src.slice(p, p + 256 + extra); p += 256 + extra;
        requireOK(symbols.length === 256 + extra, 'Zkracena tabulka symbolu');
        const h = new Uint8Array(l3); let o = 0, bits = 0, value = 0;
        while (o < l3) {
            let code = 0, i = 0;
            for (;;) {
                if (!bits) { value = word(src, p); p += 2; bits = 16; }
                code = ((code << 1) | ((value >>> 15) & 1)) & 65535;
                value = (value << 1) & 65535; bits--;
                requireOK(i < n, 'Neplatny Huffman kod');
                if (code >= c0[i]) break;
                i++;
            }
            if (code < c1[i]) {
                const k = (2 * code + c2[i]) & 65535;
                requireOK(o + 2 <= l3, 'Huffman pretekl');
                h[o++] = byte(symbols, k); h[o++] = byte(symbols, k + 1);
            } else h[o++] = byte(symbols, (code + c3[i]) & 65535);
        }
        // LZ pozpatku (stejne poradi escape tabulky jako 0xf60/0xf78).
        const z = new Uint8Array(l2), table = new Uint16Array(256);
        p = h.length; o = z.length;
        const take = () => byte(h, --p);
        for (const v of [0x6c,0x86,0xa2,0xc4,0x138,0x10a,0x150,0x14a,0x144,0x13e]) table[take()] = v - 0x68;
        for (let i = 0; i < 16; i++) table[take()] = 0x116 + 6 * i;
        table[take()] = 0x1a0;
        const put = v => { requireOK(o > 0, 'LZ pretekl'); z[--o] = v; };
        const copy = (distance, count) => {
            requireOK(distance > 0 && count <= o && o - 1 + distance < z.length, 'Neplatny LZ odkaz');
            for (let i = 0; i < count; i++) { --o; z[o] = z[o + distance]; }
        };
        const bases = {208:0xc01,232:0x3401,226:0x5401,220:0x7401,214:0x9401};
        while (o > 0) {
            const literal = take(), handler = table[literal];
            if (!handler) { put(literal); continue; }
            const b = take();
            if (handler === 0x1e || (handler >= 0x116 && handler < 0x176)) {
                if (!(b & 252)) { put(literal); continue; }
                copy((b >> 2) + (handler === 0x1e ? 0 : 63 + 63 * ((handler - 0x116) / 6)), 3 + (b & 3));
            } else if (!b) put(literal);
            else if (handler === 4) copy(b, 7);
            else if (handler === 0x3a) copy(((b * 256 + take()) & 1023) + 1, (b >> 2) + 3);
            else if (handler === 0x5c || handler === 0xa2) {
                let v = b * 256 + take();
                if (v >= 0xc000) { v &= 0x3fff; copy((v >> 3) + (handler === 0x5c ? 0x401 : 0x2c01), (v & 7) + 4); }
                else if (handler === 0x5c) copy(v, 4);
                else copy(v - 256, take());
            } else if (bases[handler]) copy(((b * 256 + take()) & 8191) + bases[handler], (b >> 5) + 4);
            else if (handler === 0x1a0) {
                const delta = [-128, 0, 256, 512][b >> 6];
                const a = take(), bb = take(), c = take(), d = take();
                let v = (d * 0x1000000 + c * 65536 + bb * 256 + a) >>> 0;
                for (let i = 0; i <= (b & 63); i++) {
                    for (let k = 0; k < 4; k++) put(v >>> (8 * k));
                    // Posledni delta se v originalu nacte, ale pak vrati (0x119a).
                    if (i < (b & 63)) v = (v - take() - delta) >>> 0;
                }
            } else throw new Error('Neznamy LZ handler');
        }
        // RLE dopredu.
        const out = new Uint8Array(l1), runs = new Uint8Array(256);
        p = 0; o = 0; const next = () => byte(z, p++);
        runs[next()] = 4; runs[next()] = 14; runs[next()] = 26;
        const fill = (v, count) => { requireOK(count <= l1 - o, 'RLE pretekl'); out.fill(v, o, o + count); o += count; };
        while (o < l1) {
            const v = next(), kind = runs[v];
            if (!kind) { fill(v, 1); continue; }
            let b = next();
            if (!b) { fill(v, 1); continue; }
            if (kind === 14) { fill(b, 3); continue; }
            const color = kind === 4 ? 0 : b;
            if (kind === 26) b = next();
            let count = b;
            if (b < 3) { count = b === 2 ? long(z, p) : word(z, p); p += b === 2 ? 4 : 2; }
            fill(color, count);
        }
        return out;
    }
    function catalog(disk) {
        requireOK(disk.length === 901120, 'Ocekavan standardni ADF (901120 B)');
        return Array.from({length:30}, (_, i) => {
            const p = 0x1600 + i * 16, offset = long(disk, p + 4);
            return {name:String.fromCharCode(...disk.slice(p, p + 4)), disk:offset >>> 24 === 255 ? 2 : 1,
                offset:offset >>> 24 === 255 ? offset & 0xffffff : offset,
                length:long(disk, p + 8), flags:long(disk, p + 12)};
        });
    }
    function load(disk1, disk2, name) {
        const e = catalog(disk1).find(e => e.name === name);
        requireOK(e, 'Soubor neni v katalogu: ' + name);
        const disk = e.disk === 1 ? disk1 : disk2;
        requireOK(disk && disk.length === 901120, 'Chybi disk ' + e.disk);
        requireOK(e.length > 0 && e.offset + e.length <= disk.length, 'Neplatna polozka katalogu');
        const raw = disk.slice(e.offset, e.offset + e.length);
        requireOK(String.fromCharCode(...raw.slice(0, 4)) !== 'PP20', 'PP20 intro neni soucasti primeho startu');
        return e.flags & 8 || !(e.flags & 256) ? raw : unpack(raw);
    }
    // MAIN 0x9ca: the word at offset 1024 tells the disks apart (0x23c0 disk 1, 0x4546 disk 2).
    function diskNumber(disk) {
        if (!disk || disk.length !== 901120) return 0;
        const id = word(disk, 1024);
        return id === 0x23c0 ? 1 : id === 0x4546 ? 2 : 0;
    }
    // Files of the catalog on disk 2 (MUS4, L4-2, L5-1, MUS5, L5-2, EDAT).
    function onDisk2(disk1, name) { const e = catalog(disk1).find(e => e.name === name); return !!e && e.disk === 2; }
    return {unpack, catalog, load, word, long, diskNumber, onDisk2};
})();
if (typeof module !== 'undefined') module.exports = NativeData;
