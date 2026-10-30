// content.js - the game's content from the visitor's disks for the payload key (arek web seal --payload): every ATN!
// block on the disks (sector-aligned) is unpacked when its size is listed in content.json, kept when its SHA-256 matches,
// and the files are joined in the listed order. Works for any disk version that holds the same files. No game data.
'use strict';
async function gameContent(disks, manifest) {
    const want = manifest.files, found = new Array(want.length).fill(null);
    const sizes = new Set(want.map((f) => f.size));
    const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
    for (const buf of disks) {
        const d = new Uint8Array(buf);
        for (let o = 0; o + 12 <= d.length; o += 512) {
            const h = ATNUNPACK.header(d, o);
            if (!h || !sizes.has(h.unpacked)) continue;
            let out; try { out = ATNUNPACK.unpack(d, o); } catch (e) { continue; }
            const sha = hex(await crypto.subtle.digest('SHA-256', out));
            want.forEach((f, i) => { if (!found[i] && f.size === out.length && f.sha256 === sha) found[i] = out; });
        }
    }
    if (found.some((x) => !x)) return null;
    const n = found.reduce((s, x) => s + x.length, 0), all = new Uint8Array(n); let p = 0;
    for (const x of found) { all.set(x, p); p += x.length; }
    return all;
}
if (typeof globalThis !== 'undefined') globalThis.gameContent = gameContent;
