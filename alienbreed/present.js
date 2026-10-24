// present.js - prezentacni verze levelu 1 pro web kitu (amiga-re-kit PREZENTACE-WEB.md, docs/PRESENT.md): diskety vlozi navstevnik
// (sada disket podle otisku v sealed/seal.json, nazvy v disks.json; jina verze disket podle obsahu hry: NATIVE_DATA.payload,
// arek 0.5.12), jadro native-core.wasm je zapecetene (WBSEAL, klic z obou disket nebo z obsahu hry) a komprimovane (arek web seal --gzip: sifrovany soubor uz server nezkomprimuje). Konec levelu 1 (obrazovka mezi levely)
// = obrazovka o projektu z ABOUT.md; H napoveda, M zvuk. native-game.js cte window.AB_PRESENT.
'use strict';
(() => {
    const $ = (id) => document.getElementById(id);
    const ADF_SIZE = 901120, DB_NAME = 'ab-present-disks', SLOTS = ['disk 1 (program)', 'disk 2 (levels)'];
    let manifest = null, versions = [], box = null, resolveDisks = null;
    const disks = [null, null], hashes = [null, null];
    const disksReady = new Promise((r) => { resolveDisks = r; });
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const msg = (html) => { $('disk-msg').innerHTML = html; };
    const ISSUES = 'https://github.com/smikes75/arek-play/issues';
    const domReady = new Promise((r) => { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', r); else r(); });   // NATIVE_DATA (skript za timto)

    // ---- prijimane diskety: sha256 z seal.json (keys[].disks), nazvy z disks.json ----
    function knownList() {
        return versions.map((v) => '<li>' + esc(v.name) + '<br>' + (v.disks ? v.disks.map((d, i) => esc(SLOTS[i]) + ': <span class="hash">' + d.sha256 + '</span>').join('<br>')
            : 'game content id: <span class="hash">' + esc(v.payload) + '</span>') + '</li>').join('');
    }
    function slotOf(h) { for (const k of manifest.keys) { const i = (k.disks || []).indexOf(h); if (i >= 0) return i; } return -1; }
    // jina verze disket: ktera disketa to je podle souboru hry (disk 1 = program PARTF, disk 2 = mapa levelu 1 L0MA)
    async function slotByFiles(bytes) {
        await domReady;
        try { const names = NATIVE_DATA.rootEntries(bytes).map((e) => e.name); return names.includes('PARTF') ? 0 : names.includes('L0MA') ? 1 : -1; } catch (e) { return -1; }
    }
    const notAccepted = (rows) => 'Hashes: <span class="hash">' + rows.join('<br>') + '</span><br>This version is not accepted yet. You can report the hashes in the ' +
        '<a href="' + ISSUES + '" target="_blank" rel="noopener">arek-play issues</a>. Accepted versions:<ul>' + knownList() + '</ul>';
    function render() {
        $('disk-list').innerHTML = SLOTS.map((name, i) => '<div class="disk ' + (disks[i] ? 'ok' : '') + '">' + esc(name[0].toUpperCase() + name.slice(1)) + ': ' + (disks[i] ? 'loaded' : 'missing') + '</div>').join('');
    }
    async function addDisk(bytes, label) {
        if (bytes.length !== ADF_SIZE) { msg('<b>' + esc(label) + '</b> is not an ADF disk image (' + bytes.length + ' bytes, an ADF has ' + ADF_SIZE + ').'); return false; }
        const [h] = await WBSEAL.ids([bytes]); let i = slotOf(h);
        if (i < 0) i = await slotByFiles(bytes);   // jina verze: overi se az obsahem hry obou disket (tryOpen)
        if (i < 0) {
            msg('<b>' + esc(label) + '</b> is not an Alien Breed SE92 disk this page can read (no game program PARTF or level map L0MA on it). ' + notAccepted(['sha256 ' + h]));
            return false;
        }
        disks[i] = bytes; hashes[i] = h; render();
        return true;
    }
    async function tryOpen() {
        $('play').disabled = true;
        if (!disks[0] || !disks[1]) { msg(!disks[0] ? 'Now add disk 1: it holds the game program.' : 'Now add disk 2: level 1 loads its map, tiles and aliens from it.'); return; }
        let payload = null, missing = '';
        await domReady;
        try { payload = NATIVE_DATA.payload(disks[0], disks[1]); } catch (e) { missing = e.file || e.message; }
        try { box = await WBSEAL.open(manifest, [disks[0], disks[1]], payload ? { payload } : undefined); }
        catch (e) {
            const rows = ['disk 1 sha256 ' + hashes[0], 'disk 2 sha256 ' + hashes[1]];
            if (payload) rows.push('game content id ' + await WBSEAL.payloadId(payload));
            msg('These two disks do not open the game' + (missing ? ' (game file ' + esc(missing) + ' is missing or damaged)' : '') + '. ' + notAccepted(rows));
            return;
        }
        msg(box.key.payload ? 'Both disks verified by their game files (' + esc(box.label || 'another version') + ').' : 'Both disks verified.'); $('play').disabled = false;
        if ($('remember').checked) await remember(true);
    }
    async function addFiles(files) {
        let good = true;
        for (const f of files) good = (await addDisk(new Uint8Array(await f.arrayBuffer()), f.name)) && good;
        if (good) await tryOpen(); else $('play').disabled = !(disks[0] && disks[1] && box);   // hlaska o spatne diskete zustane
    }

    // ---- zapamatovani disket (IndexedDB) jen se souhlasem ----
    function db() { return new Promise((ok, no) => { const r = indexedDB.open(DB_NAME, 1); r.onupgradeneeded = () => r.result.createObjectStore('disks'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); }
    async function remember(on) {
        try {
            const d = await db(), tx = d.transaction('disks', 'readwrite'), st = tx.objectStore('disks');
            if (on) st.put([disks[0], disks[1]], 'set'); else st.delete('set');
            await new Promise((ok) => { tx.oncomplete = ok; tx.onerror = ok; });
            $('forget').hidden = !on;
        } catch (e) { /* bez ulozeni */ }
    }
    async function recall() {
        try {
            const d = await db(), r = d.transaction('disks').objectStore('disks').get('set');
            const v = await new Promise((ok) => { r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); });
            if (!v) return;
            $('remember').checked = true; $('forget').hidden = false;
            for (const [i, b] of v.entries()) if (b) await addDisk(new Uint8Array(b), 'remembered ' + SLOTS[i]);
            await tryOpen();
        } catch (e) { /* bez ulozeni */ }
    }

    // ---- obrazovka o projektu: ABOUT.md (nadpisy, odstavce, odrazky, **tucne**, [odkaz](url), ![obrazek](soubor.svg|png), `kod`) ----
    function md(text) {
        const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/!\[([^\]]*)\]\(([\w.-]+\.(?:svg|png))\)/g, '<img src="$2" alt="$1">')   // jen soubor vedle stranky
            .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        const out = []; let list = false, para = [];
        const flush = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } if (list) { out.push('</ul>'); list = false; } };
        for (const line of text.split('\n')) {
            const t = line.trim();
            if (!t) { flush(); continue; }
            const h = /^(#{1,3})\s+(.*)$/.exec(t);
            if (h) { flush(); out.push('<h' + (h[1].length + 1) + '>' + inline(h[2]) + '</h' + (h[1].length + 1) + '>'); continue; }
            if (/^[-*]\s+/.test(t)) { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } if (!list) { out.push('<ul>'); list = true; } out.push('<li>' + inline(t.replace(/^[-*]\s+/, '')) + '</li>'); continue; }
            if (/^>\s?/.test(t)) { flush(); out.push('<p class="foot">' + inline(t.replace(/^>\s?/, '')) + '</p>'); continue; }
            if (list) { out.push('</ul>'); list = false; }
            para.push(t);
        }
        flush();
        return out.join('\n');
    }
    let aboutHtml = null;   // promise textu (jedno stazeni)
    async function showAbout() {
        if (!aboutHtml) aboutHtml = fetch('ABOUT.md').then((r) => r.text()).then(md).catch(() => '<p>Level 1 complete.</p>');
        $('help').hidden = true; $('about').hidden = false; $('again').focus({ preventScroll: true });   // okno hned, text po stazeni (na webu chvili trva)
        const box = $('about-text'); box.innerHTML = await aboutHtml; $('about').scrollTop = 0;
        // oddil s obrazkem (podpora s QR) do bocniho sloupce: na sirokem okne viditelny bez rolovani, na uzkem zustane v textu
        const img = box.querySelector('p > img');
        if (img) {
            let h = img.parentElement; while (h && !/^H\d$/.test(h.tagName)) h = h.previousElementSibling;
            if (h) { const aside = document.createElement('aside'); aside.className = 'support'; h.before(aside);
                for (let e = h; e && (e === h || !/^H\d$/.test(e.tagName));) { const n = e.nextElementSibling; aside.append(e); e = n; } }
        }
        $('status').textContent = 'Level 1 complete.';
    }
    function toggleHelp(show) { const h = $('help'); h.hidden = show === undefined ? !h.hidden : !show; if (!h.hidden) $('help-close').focus(); else $('screen').focus(); }

    // ---- hlasky native-game.js (cesky) -> anglicky ----
    const TR = [
        [/^Vylepšeno/, 'Enhanced: wider playfield, smooth motion'], [/^Originál/, "Original: the game's own window"],
        [/^Pauza$/, 'Paused (P)'], [/^Pokračuje$/, 'Running'], [/^Zvuk zapnut$/, 'Sound on (M)'], [/^Zvuk vypnut$/, 'Sound off (M)'],
        [/^Jas, kontrast a sytost 100 %$/, 'Brightness, contrast and colour 100 %'],
        [/^Level 1 od začátku/, 'Level 1 from the start'], [/^Hra od začátku/, 'Level 1 from the start'],
        [/^Chyba překladu/, 'Internal error of the translated code - press R to restart level 1'], [/^Jas, kontrast/, 'Monitor reset'],
    ];
    const tr = (m) => { for (const [re, en] of TR) if (re.test(m)) return en; return m; };

    window.AB_PRESENT = {
        disks: () => disksReady,
        wasm: () => box.fetch('native-core.wasm', 'sealed/'),   // zapecetene jadro (arek seal --gzip): wb-seal.js rozsifruje a rozbali
        levelEnd: showAbout, help: () => toggleHelp(), tr,
    };

    // ---- ovladani stranky ----
    const drop = $('drop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); });
    $('adf-input').addEventListener('change', (e) => addFiles([...e.target.files]));
    $('remember').addEventListener('change', (e) => { if (disks[0] && disks[1]) remember(e.target.checked); });
    $('forget').addEventListener('click', () => { $('remember').checked = false; remember(false); });
    $('play').addEventListener('click', async () => {
        $('play').disabled = true; msg('Starting level 1…'); $('status').textContent = 'Starting level 1…';
        resolveDisks([disks[0], disks[1]]);
        try { await window.abg.present(); if (window.abPresent.startPaused) window.abg.pause(true); $('status').textContent = 'Level 1'; $('screen').focus(); }   // startPaused: testy (prehrany vstup od kroku 0)
        catch (e) { msg('Could not start: ' + esc(e.message)); $('status').textContent = 'Could not start.'; }
    });
    $('again').addEventListener('click', async () => { $('about').hidden = true; await window.abg.restart(); window.abg.start(); $('screen').focus(); });
    $('help-button').addEventListener('click', () => toggleHelp());
    $('help-close').addEventListener('click', () => toggleHelp(false));
    document.addEventListener('keydown', (e) => { if (e.code === 'Escape' && !$('help').hidden) toggleHelp(false); });
    window.abPresent = { addDisk: async (bytes, label) => { const ok = await addDisk(bytes, label || 'disk'); await tryOpen(); return ok; }, ready: () => !$('play').disabled, showAbout, key: () => box && box.key };   // testy (Playwright)

    (async () => {
        try {
            manifest = await (await fetch('sealed/seal.json')).json();
            versions = await (await fetch('disks.json')).json();
        } catch (e) { msg('The page is incomplete (sealed/seal.json or disks.json missing).'); return; }
        render(); await recall();
    })();
})();
