// present.js - prezentacni verze levelu 1 pro web kitu (amiga-re-kit PREZENTACE-WEB.md, docs/PRESENT.md): diskety vlozi navstevnik
// (overeni otiskem proti sealed/seal.json, nazvy v disks.json), jadro native-core.wasm je zapecetene (WBSEAL, klic z obsahu obou
// disket) a komprimovane (arek web seal --gzip: sifrovany soubor uz server nezkomprimuje). Konec levelu 1 (obrazovka mezi levely)
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

    // ---- prijimane diskety: sha256 z seal.json (keys[].disks), nazvy z disks.json ----
    function knownList() {
        return versions.map((v) => '<li>' + esc(v.name) + '<br>' + v.disks.map((d, i) => esc(SLOTS[i]) + ': <span class="hash">' + d.sha256 + '</span>').join('<br>') + '</li>').join('');
    }
    function slotOf(h) { for (const k of manifest.keys) { const i = k.disks.indexOf(h); if (i >= 0) return i; } return -1; }
    function render() {
        $('disk-list').innerHTML = SLOTS.map((name, i) => '<div class="disk ' + (disks[i] ? 'ok' : '') + '">' + esc(name[0].toUpperCase() + name.slice(1)) + ': ' + (disks[i] ? 'loaded' : 'missing') + '</div>').join('');
    }
    async function addDisk(bytes, label) {
        if (bytes.length !== ADF_SIZE) { msg('<b>' + esc(label) + '</b> is not an ADF disk image (' + bytes.length + ' bytes, an ADF has ' + ADF_SIZE + ').'); return false; }
        const [h] = await WBSEAL.ids([bytes]), i = slotOf(h);
        if (i < 0) {
            msg('<b>' + esc(label) + '</b> is a version this page does not know (sha256 <span class="hash">' + h + '</span>). Accepted versions:<ul>' + knownList() + '</ul>');
            return false;
        }
        disks[i] = bytes; hashes[i] = h; render();
        return true;
    }
    async function tryOpen() {
        $('play').disabled = true;
        if (!disks[0] || !disks[1]) { msg(!disks[0] ? 'Now add disk 1: it holds the game program.' : 'Now add disk 2: level 1 loads its map, tiles and aliens from it.'); return; }
        try { box = await WBSEAL.open(manifest, [disks[0], disks[1]]); }
        catch (e) { msg('These two disks are not a set this page knows (' + esc(e.message) + '). Accepted versions:<ul>' + knownList() + '</ul>'); return; }
        msg('Both disks verified.'); $('play').disabled = false;
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

    // ---- obrazovka o projektu: ABOUT.md (nadpisy, odstavce, odrazky, **tucne**, [odkaz](url), `kod`) ----
    function md(text) {
        const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>')
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
        $('about-text').innerHTML = await aboutHtml; $('help').hidden = true; $('about').hidden = false; $('about').scrollTop = 0; $('again').focus({ preventScroll: true });
        $('status').textContent = 'Level 1 complete.';
    }
    function toggleHelp(show) { const h = $('help'); h.hidden = show === undefined ? !h.hidden : !show; if (!h.hidden) $('help-close').focus(); else $('screen').focus(); }

    // ---- hlasky native-game.js (cesky) -> anglicky ----
    const TR = [
        [/^Vylepšeno/, 'Enhanced: wider playfield, smooth motion'], [/^Originál/, "Original: the game's own window"],
        [/^Pauza$/, 'Paused (P)'], [/^Pokračuje$/, 'Running'], [/^Zvuk zapnut$/, 'Sound on (M)'], [/^Zvuk vypnut$/, 'Sound off (M)'],
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
    window.abPresent = { addDisk: async (bytes, label) => { const ok = await addDisk(bytes, label || 'disk'); await tryOpen(); return ok; }, ready: () => !$('play').disabled, showAbout };   // testy (Playwright)

    (async () => {
        try {
            manifest = await (await fetch('sealed/seal.json')).json();
            versions = await (await fetch('disks.json')).json();
        } catch (e) { msg('The page is incomplete (sealed/seal.json or disks.json missing).'); return; }
        render(); await recall();
    })();
})();
