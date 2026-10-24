// The presentation page of Turrican II (world 1-1 only): checks the visitor's disk, opens the sealed
// game code with it (wb-seal.js, `arek web seal`), loads it and starts 1-1. No game data or code is
// on the server in the clear: the open files are the shell (menu, display contract, audio output,
// the ADF reader); every file with ported game logic arrives as `sealed/*.sealed`.
'use strict';
(() => {
    const $ = (id) => document.getElementById(id);
    const config = JSON.parse($('present-config').textContent);
    const ADF_SIZE = 901120, DB = 'turrican2-present', STORE = 'disks';
    let loaded = false, busy = false;

    // ---- known disks (from the seal: keys[].disks, names from the build) ----
    for (const d of config.disks) {
        const li = document.createElement('li');
        li.textContent = d.name + ' · sha256 ' + d.sha256;
        $('present-known').append(li);
    }
    for (const c of config.contents || []) {           // the payload key: the game files, whatever disk carries them
        const li = document.createElement('li');
        li.textContent = c.name + ' · content id ' + c.id;
        $('present-known').append(li);
    }
    const ISSUES = 'https://github.com/smikes75/arek-play/issues';
    const say = (text, bad = false, link = null) => {
        const m = $('present-message'); m.textContent = text; m.classList.toggle('bad', bad);
        if (link) { const a = document.createElement('a'); a.href = link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = link; m.append(' ', a); }
    };

    // ---- remembering the disk (IndexedDB, only with the visitor's consent) ----
    function db() {
        return new Promise((ok, fail) => {
            const r = indexedDB.open(DB, 1);
            r.onupgradeneeded = () => r.result.createObjectStore(STORE);
            r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
        });
    }
    async function remembered(op, value) {
        try {
            const d = await db();
            return await new Promise((ok, fail) => {
                const t = d.transaction(STORE, op === 'get' ? 'readonly' : 'readwrite'), s = t.objectStore(STORE);
                const r = op === 'get' ? s.get('disk1') : op === 'put' ? s.put(value, 'disk1') : s.delete('disk1');
                r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
            });
        } catch { return undefined; }
    }

    // ---- the sealed game code ----
    async function addScript(code) {
        const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        await new Promise((ok, fail) => {
            const s = document.createElement('script'); s.src = url;
            s.onload = ok; s.onerror = () => fail(new Error('a sealed script did not run'));
            document.body.append(s);
        });
    }
    async function openGame(bytes, payload) {
        const seal = await (await fetch(config.seal)).json();
        // The disk itself first, then the game's content (NativeData.payload); throws when neither fits.
        const box = await WBSEAL.open(seal, [bytes], payload ? { payload } : undefined);
        const text = async (p) => new TextDecoder().decode(await box.fetch(p, config.sealedBase));
        // The sound worklet as one module: the opened sound and music code, then the processor.
        const parts = [];
        for (const p of config.sound) parts.push(await text(p));
        parts.push(await (await fetch(config.worklet)).text());
        window.presentKey = box.key;                          // { disks: [...] } or { payload: id } (tests)
        globalThis.NATIVE_WORKLET_URL = URL.createObjectURL(new Blob([parts.join('\n')], { type: 'text/javascript' }));
        for (const p of config.scripts) await addScript(await text(p));
    }

    async function useDisk(bytes, fromMemory = false) {
        if (busy) return;
        busy = true;
        try {
            if (bytes.byteLength !== ADF_SIZE) { say('This is not a standard Amiga disk image (an ADF of 901120 bytes).', true); return; }
            let payload = null;
            try { payload = NativeData.payload(bytes); } catch { /* not a Turrican II disk 1: only the disk key can fit */ }
            if (!loaded) {
                say('Checking the disk…');
                try { await openGame(bytes, payload); }
                catch (e) {
                    const [id] = await WBSEAL.ids([bytes]), content = payload ? await WBSEAL.payloadId(payload) : null;
                    say('This disk version is not accepted yet. Disk sha256 ' + id + '; ' +
                        (content ? 'game content id ' + content : 'no Turrican II disk 1 game files found on it') +
                        '. You can report both in the arek-play issues:', true, ISSUES);
                    if (fromMemory) { await remembered('delete'); $('present-forget').hidden = true; }
                    return;
                }
                loaded = true;
            }
            if ($('present-remember').checked && !fromMemory) { await remembered('put', bytes.slice(0)); $('present-forget').hidden = false; }
            window.dispatchEvent(new Event('present-game-loaded'));     // tests hook the game here
            await window.nativeLoadDisk(new File([bytes], 'disk1.adf'));
            $('present-loader').hidden = true;
            say('');
        } catch (e) {
            say('Error: ' + e.message, true);
        } finally { busy = false; }
    }
    const fromFile = async (file) => { if (file) await useDisk(new Uint8Array(await file.arrayBuffer())); };

    $('present-choose').addEventListener('click', () => $('present-file').click());
    $('present-file').addEventListener('change', (e) => fromFile(e.target.files[0]));
    const drop = $('present-drop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); fromFile(e.dataTransfer.files[0]); });
    $('present-forget').addEventListener('click', async () => { await remembered('delete'); $('present-forget').hidden = true; $('present-remember').checked = false; say('The remembered disk was removed from this device.'); });

    // ---- help (H, ?) and sound (M) ----
    const help = $('present-help'), about = $('present-about');
    const focusGame = () => { if (loaded && $('present-loader').hidden) $('map').focus(); };
    function toggleHelp(show = help.hidden) { help.hidden = !show; if (show) help.querySelector('[data-present-close]').focus(); else focusGame(); }
    $('present-help-open').addEventListener('click', () => toggleHelp());
    help.addEventListener('click', (e) => { if (e.target === help || e.target.closest('[data-present-close]')) toggleHelp(false); });
    function notice(text) {
        const n = $('wbnotice'); n.textContent = text; n.hidden = false;
        clearTimeout(notice.timer); notice.timer = setTimeout(() => { n.hidden = true; }, 1500);
    }
    function toggleSound() {
        const on = !($('sound').checked || $('music').checked);
        for (const id of ['sound', 'music']) { $(id).checked = on; $(id).dispatchEvent(new Event('change', { bubbles: true })); }
        notice(on ? 'Sound on' : 'Sound off');
    }
    document.addEventListener('keydown', (e) => {
        if (e.target.closest && e.target.closest('input,select,textarea')) return;
        if (e.code === 'KeyH' && !e.repeat) { toggleHelp(); e.preventDefault(); e.stopImmediatePropagation(); }
        else if (e.code === 'KeyM' && !e.repeat) { toggleSound(); e.preventDefault(); e.stopImmediatePropagation(); }
        else if (e.code === 'Escape' && !help.hidden) { toggleHelp(false); e.preventDefault(); }
    }, true);

    // ---- the end of 1-1: about this rebuild (ABOUT.md) ----
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    function inline(s) {
        return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>')
            .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    }
    function markdown(md) {
        const out = []; let list = false, para = [];
        const flush = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } if (list) { out.push('</ul>'); list = false; } };
        for (const raw of md.split('\n')) {
            const line = raw.trimEnd();
            if (!line.trim()) { flush(); continue; }
            const img = /^!\[([^\]]*)\]\(([\w.-]+\.(?:svg|png))\)$/.exec(line.trim());  // a picture next to ABOUT.md
            if (img) { flush(); out.push('<p class="present-img"><img src="' + esc(img[2]) + '" alt="' + esc(img[1]) + '" width="160" height="160"></p>'); continue; }
            if (/^#{1,3} /.test(line)) { flush(); const n = line.indexOf(' '); out.push('<h' + (n + 1) + '>' + inline(line.slice(n + 1)) + '</h' + (n + 1) + '>'); continue; }
            if (/^[-*] /.test(line)) { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } if (!list) { out.push('<ul>'); list = true; } out.push('<li>' + inline(line.slice(2)) + '</li>'); continue; }
            if (list && /^\s+/.test(raw)) { out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ' ' + inline(line.trim()) + '</li>'); continue; }
            if (list) { out.push('</ul>'); list = false; }
            para.push(line.trim());
        }
        flush();
        return out.join('\n');
    }
    window.addEventListener('native-present-end', async () => {
        if (!$('present-about-text').innerHTML) {
            const box = $('present-about-text');
            box.innerHTML = markdown(await (await fetch(config.about)).text());
            // The support section goes to a column beside the text: its QR shows without scrolling.
            const h = [...box.querySelectorAll('h2,h3')].find((e) => /support/i.test(e.textContent));
            if (h) {
                const aside = document.createElement('aside'); aside.className = 'present-support';
                for (let n = h; n && !(n !== h && n.tagName === h.tagName) && n.tagName !== 'UL'; ) { const next = n.nextElementSibling; aside.append(n); n = next; }
                box.parentElement.insertBefore(aside, box.nextSibling);
            }
        }
        about.hidden = false; $('present-again').focus();
        if (recording) recording.download();                 // the finished run, ready for the test
    });
    $('present-again').addEventListener('click', () => { about.hidden = true; window.nativePresentRestart(); $('map').focus(); });

    // ---- input recording (?record=1) and replay (?replay=URL, tests): one input per game tick ----
    const BITS = ['left', 'right', 'jump', 'down', 'fire', 'space', 'special'];
    const pack = (i) => BITS.reduce((v, k, n) => v | (i[k] ? 1 << n : 0), 0);
    const params = new URLSearchParams(location.search), sameOrigin = (u) => u && !/^[a-z]+:/i.test(u) && !u.startsWith('//');
    let recording = null;
    if (params.get('record') === '1') {
        recording = { runs: [], last: 0 };                  // [bits, weapon, count] per run of equal ticks
        const panel = document.createElement('div'); panel.className = 'present-recorder';
        panel.innerHTML = '<span>● Recording 1-1 · tick <b>0</b></span> <button type="button">Download</button>';
        document.body.append(panel);
        const download = () => {
            const ticks = recording.runs.reduce((n, r) => n + r[2], 0);
            const data = JSON.stringify({ format: 'turrican2-present-input-1', level: '1-1', disk: config.disks[0]?.sha256, ticks, bits: BITS, runs: recording.runs });
            const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
            a.download = 'turrican2-1-1-input.json'; a.click();
        };
        panel.querySelector('button').addEventListener('click', download);
        recording.download = download;
        window.nativeTickInput = (t, i) => {
            if (t <= recording.last) { recording.runs = []; recording.last = 0; }   // a new run (GAME OVER -> 1-1 from the start)
            // Ticks without player input (the opening grid) are recorded as neutral, so index = tick - 1.
            const add = (b, w, n) => { const r = recording.runs[recording.runs.length - 1];
                if (r && r[0] === b && !r[1] && !w) r[2] += n; else recording.runs.push([b, w, n]); };
            if (t - recording.last > 1) add(0, 0, t - recording.last - 1);
            recording.last = t; window.presentTick = t;
            add(pack(i), i.weapon || 0, 1);
            if (!(t % 25)) panel.querySelector('b').textContent = t;
            return i;
        };
    }
    async function replay(url) {
        const rec = await (await fetch(url)).json(), at = [];
        for (const [b, w, n] of rec.runs) for (let k = 0; k < n; k++) at.push([b, k ? 0 : w]);
        window.presentReplay = { ticks: at.length };
        window.nativeTickInput = (t, live) => {
            const [b, w] = at[t - 1] || [0, 0], i = { weapon: w };
            BITS.forEach((k, n) => { i[k] = !!(b & 1 << n); });
            window.presentReplay.tick = t; window.presentTick = t;
            return i;
        };
    }

    // ---- start: a remembered disk, or (tests only) ?disk=same-origin URL ----
    (async () => {
        if (sameOrigin(params.get('replay'))) await replay(params.get('replay'));
        const test = params.get('disk');
        if (sameOrigin(test)) { await useDisk(new Uint8Array(await (await fetch(test)).arrayBuffer())); return; }
        const kept = await remembered('get');
        if (kept) { $('present-remember').checked = true; $('present-forget').hidden = false; say('Using the disk remembered on this device…'); await useDisk(new Uint8Array(kept), true); }
    })();
})();
