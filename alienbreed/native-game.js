// native-game.js - nativni hra, etapa 3 (docs/NATIVE.md 5a): prelozeny krok snimku (web/native-core.wasm,
// zadna emulace CPU) + vlastni zobrazeni z jeho RAM (web/render.js: copper list, bitplanove buffery, sprity).
// Vychozi stav levelu 1 je zatim ze zaznamu stopy originalu (web/local/level1_seed.bin), ne z ADF: viz stranka.
'use strict';
(() => {
    // prezentacni verze (present/index.html, docs/PRESENT): window.AB_PRESENT = { disks(), wasm(), levelEnd(), help(), tr(text) };
    // diskety vlozi navstevnik, jadro je zapecetene, jen level 1 (konec u vytahu, game over = znovu od zacatku), menu jen Display
    const PRES = window.AB_PRESENT || null, dummies = new Map(); let presRestart = false, presEnded = false;
    // prezentace: start v rezimu Original, po 5 s hrani levelu (viditelny obraz, bez pauzy) prepnout do Vylepseno; jednou za nacteni
    // stranky, E nebo menu to zrusi. presDemo = odehrane ms, -1 = vypnuto
    let presDemo = PRES ? 0 : -1; const PRES_DEMO_MS = 5000;
    const $ = (id) => document.getElementById(id) || (PRES ? dummies.get(id) || dummies.set(id, document.createElement('input')).get(id) : null);
    const STORE_KEY = 'alien-breed-native-game-v1';
    const FRAME_MS = 568408 / 28375.16, CHIP = 0x80000, SLOWOFF = 0x80000;   // 20,0317 ms: PAL snimek vAmigy (313 radku), ne 20,0
    // Vyrezy v souradnicich okna hry (293 x 240 = DIW 142..434 x radky 52..291): Original = cela obrazovka 320 x 256 jako na Amize
    // (okno na (13, 9), HUD radky 43..51 nahore a 293..300 dole), Vylepseno = hraci plocha 448 x 256 (jako Turrican) vystredena na okno + HUD pruhy.
    const HUD_TOP = 9, HUD_BOT = 7, WIN_W = 293, WIN_H = 240;
    const VIEWPORTS = { orig: { x0: 0, y0: 0, w: 293, h: 240, hud: true }, w448: { x0: -78, y0: -8, w: 448, h: 256, hud: true } };
    // predvolby po rezimech (wb-shell obraz 1.2, 4): kazdy rezim ma svuj zoom, CRT zap/vyp, jemnost CRT, rozmazani a knofliky monitoru
    // (Original 2x / CRT vyrazne / bez rozmazani, Vylepseno 3x / CRT jemne / rozmazani 20 %); Original = meridlo bez interpolace (plynuly
    // posun zamceny), rozmazani volitelne. Kazde cteni se validuje. Migrace: zaznam v1 bez rezimu -> zoom a jemnost do Vylepseno; zaznam
    // bez ver 2 (pred 1.2): sdilene CRT a knofliky do obou rezimu, hodnoty rovne starym vychozim (CRT vyp, Original standardni, Vylepseno
    // rozmazani 24 %, Original bez rozmazani) prejdou na nove vychozi.
    const W0 = VIEWPORTS.orig.w;   // sirka vyrezu Originalu (293): zoom = sirka okna v nasobcich W0 (1.1)
    // pomer pixelu PAL (jako Turrican a Superfrog): televize PAL vzorkuje ctvercove body 14,75 MHz, Amiga lores 7,09379 MHz -> lores pixel
    // 14,75 / 14,1875 = 1,0397 krat sirsi nez vysoky. Jen zobrazeni; prezentace bez nej (kontrakt kitu = cele pixely na sirku i vysku)
    const PAL_PAR = 14.75 / 14.1875;
    const PREFS_VER = 2, KNOBS = ['brightness', 'contrast', 'saturation'], CHANNELS = ['red', 'green', 'blue'];   // CHANNELS: kanaly RGB 50-150 % (RENDER.setChannels)
    const VIEW_DEFAULTS = { original: { ...WBOBRAZ.VIEW_DEFAULTS.original, crtShape: 'lines', smooth: false, par: false, brightness: 100, contrast: 100, saturation: 100, red: 100, green: 100, blue: 100 },
        enhanced: { ...WBOBRAZ.VIEW_DEFAULTS.enhanced, crtShape: 'lines', smooth: true, par: !PRES, brightness: 100, contrast: 100, saturation: 100, red: 100, green: 100, blue: 100 } };
    const VIEW_KEYS = Object.keys(VIEW_DEFAULTS.original), OLD_DEFAULTS = { original: { crtDetail: 'standard' }, enhanced: { blur: 24 } };
    const DEFAULTS = { mode: 'enhanced', viewport: 'w448' };
    const CRT_DETAILS = WBOBRAZ.CRT_DETAILS, MODE_MS = WBOBRAZ.MODE_MS;   // prechod Original <-> Vylepseno, smoothstep
    function validPrefs(raw) {
        const p = { ...DEFAULTS, ver: PREFS_VER, views: { original: { ...VIEW_DEFAULTS.original }, enhanced: { ...VIEW_DEFAULTS.enhanced } } };
        const r = raw && typeof raw === 'object' ? raw : {};
        const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi) ? v : d;
        p.mode = r.mode === 'original' ? 'original' : 'enhanced';
        p.viewport = VIEWPORTS[r.viewport] ? r.viewport : DEFAULTS.viewport;
        const old = r.ver !== PREFS_VER, views = r.views && typeof r.views === 'object' ? r.views : {};
        if (!r.views && (r.zoom !== undefined || r.crtDetail !== undefined)) views.enhanced = { zoom: r.zoom, crtDetail: r.crtDetail };   // migrace v1 bez rezimu
        for (const m of ['original', 'enhanced']) {
            const v = views[m] && typeof views[m] === 'object' ? { ...views[m] } : {}, d = VIEW_DEFAULTS[m];
            if (old) {   // pred 1.2: CRT a knofliky sdilene, stare vychozi hodnoty -> nove vychozi
                v.crt = r.crt === true ? true : undefined;
                for (const k of KNOBS) v[k] = r[k];
                if (v.crtDetail === OLD_DEFAULTS[m].crtDetail) v.crtDetail = undefined;
                if (m === 'original' || v.blur === OLD_DEFAULTS.enhanced.blur) v.blur = undefined;
            }
            const o = p.views[m];
            o.zoom = num(v.zoom, 0, 6, d.zoom);
            o.crt = typeof v.crt === 'boolean' ? v.crt : d.crt;
            o.crtDetail = CRT_DETAILS.includes(v.crtDetail) ? v.crtDetail : d.crtDetail;
            o.crtShape = WBOBRAZ.CRT_SHAPES.includes(v.crtShape) ? v.crtShape : d.crtShape;
            o.smooth = typeof v.smooth === 'boolean' ? v.smooth : d.smooth;   // Original: vychozi vypnuto (meridlo), od 2026-10-22 lze zapnout rucne
            o.blur = num(v.blur, 0, 100, d.blur);
            o.par = typeof v.par === 'boolean' && !PRES ? v.par : d.par;
            o.brightness = num(v.brightness, 50, 150, 100); o.contrast = num(v.contrast, 50, 150, 100); o.saturation = num(v.saturation, 0, 200, 100);
            for (const k of CHANNELS) o[k] = num(v[k], 50, 150, 100);
        }
        return p;
    }
    const prefs = (() => { let raw = null; try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { /* vychozi */ } return validPrefs(raw); })();
    // zoom, crt, crtDetail, smooth, blur, jas, kontrast, sytost = hodnoty prave zobrazeneho rezimu (neserializuji se, ulozi se prefs.views);
    for (const k of VIEW_KEYS) Object.defineProperty(prefs, k, { enumerable: false, get: () => prefs.views[prefs.mode][k], set: (v) => { prefs.views[prefs.mode][k] = v; } });
    const savePrefs = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); } catch (e) { /* bez ulozeni */ } };
    const canvas = $('screen'), ctx = canvas.getContext('2d', { alpha: false }), gameEl = document.querySelector('.game');
    const logEl = $('log'), log = (t) => { logEl.textContent += t + '\n'; logEl.scrollTop = logEl.scrollHeight; };
    const held = new Set();
    // gamepad a joystick (web/native-input.js): stav ctu v kazdem snimku displeje (i v pauze kvuli Start), do hry jde spolu s klavesnici
    const PADS = typeof NativeInput !== 'undefined' ? new NativeInput.Gamepads() : null, PAD_KEY = 'ab-native-pad';
    let PAD = PADS ? NativeInput.empty() : null;
    try { const ps = JSON.parse(localStorage.getItem(PAD_KEY) || 'null'); if (PADS && ps && typeof ps === 'object') { if (/^(auto|\d{1,2})$/.test(ps.pad)) PADS.preferred = ps.pad; if (/^(auto|\d{1,2})$/.test(ps.fire)) PADS.fireButton = ps.fire; } } catch (e) { /* vychozi */ }
    const shell = new WbMenu.Shell($('shell') || document.querySelector('.wbshell'), { suspend: () => { held.clear(); paused = true; }, restore: () => { paused = manualPause; canvas.focus({ preventScroll: true }); } });
    let core = null, mem = null, memBase = 0, seedMeta = null, running = false, paused = false, manualPause = false;
    // zvuk: zapisy hry do Pauly po snimcich -> model cipu -> AudioWorklet (web/native-audio.js); predvolby spolecne pro oba rezimy
    const AUDIO = NativeAudio.create(), SOUND_KEY = 'ab-native-sound';
    const sound = (() => { try { const r = JSON.parse(localStorage.getItem(SOUND_KEY) || '{}'); return { on: r.on !== false, volume: typeof r.volume === 'number' && r.volume >= 0 && r.volume <= 1 ? r.volume : 0.5 }; } catch (e) { return { on: true, volume: 0.5 }; } })();
    const saveSound = () => { try { localStorage.setItem(SOUND_KEY, JSON.stringify(sound)); } catch (e) { /* bez ulozeni */ } };
    AUDIO.setEnabled(sound.on); AUDIO.setVolume(sound.volume);
    const unlockAudio = () => { if (sound.on) AUDIO.unlock().catch((e) => log('zvuk: ' + e.message)); };
    let acc = 0, lastNow = 0, steps = 0, stats = { stepMs: 0, renderMs: 0, frames: 0, spritePixels: 0, screenSkips: 0, slowFrames: 0 };
    let stepClock = 0;   // nominalni cas posledniho kroku (performance.now ms): kroky v t0 + n * 20 ms, interpolace mezi nimi
    let scaleInfo = { S: 3, z: 3, dpr: 1 };   // S = pixely zarizeni na herni pixel, z = CSS px na herni pixel (S / dpr), zoom = sirka v nasobcich W0
    const screen = new WBOBRAZ.Screen(gameEl, canvas);   // vrstva CRT a zarovnani na cely pixel zarizeni (wb-obraz.js)
    let lastLook = null;   // prave zobrazeny vzhled (CRT, filtr): z nej zacina prechod rezimu i pri otoceni uprostred
    const meter = { draws: 0, moving: 0, dup: 0, lastShown: null, spriteMissing: 0, deltas: [], lastSx: null, lastSy: null, lastNow: null };
    let cur = null, prev = null, pfCanvas = [], pfCtx = [], spCanvas = [], spCtx = [], pfIdx = 0;
    let idxBuf = null, spBuf = null, rgbaBuf = null, spRgba = null, winBuf = null, hudCanvas = null, hudCtx = null, hudRaw = null, hudRev = 0;
    const objTrace = { on: false, list: [] };   // ladeni/testy: zobrazene polohy objektu po snimcich displeje
    const hudWide = { canvas: null, key: '' }, hudUp = { canvas: null, key: '' };   // HUD roztazeny na sirku vyrezu (Vylepseno), RENDER.hudStretch
    // objekty ze zaznamu kresleni (docs/RENDER.md 14): snimky po krocich, kdy bezelo telo smycky (hra kreslila do zadniho bufferu,
    // ten je videt v nasledujicich dvou krocich); zobrazeny stav kroku n = posledni snimek s krokem < n
    let objHist = [], modelBuf = null, faultShown = false;
    const objImgCache = new Map();
    function objStep() { if (core._core_body_ran()) { objHist.push({ s: steps, objs: RENDER.objectRecords(mem.subarray(SLOWOFF, SLOWOFF + 0x80000), 0xc00000) }); if (objHist.length > 6) objHist.shift(); objLife(objHist[objHist.length - 1]); } }
    // plynule objeveni a zmizeni mimozemstanu v okraji (Vylepseno, jen zobrazeni; volba 3 z 2026-10-22): hra vytvori mimozemstana, az
    // jeho lihen dojede k okraji okna 293 x 240; v sirsim vyrezu by naskocil na viditelnem miste. Podle vzdalenosti je hra neuvolnuje
    // (zmereno: po uteku hrace zustali aktivni 500-700 px od okna), zanikaji zastrelenim - mimo okno jen strelou do okraje. Mimozemstane = 7 slotu tabulky 0xC088CE (krok 0x5A, zmereno 2026-10-22): +4/+6 = domovska poloha (1944, 100 + 32k),
    // +0x12 = ukazatel na zaznam kresleni; volny slot ma zaznam zaparkovany na domovske poloze (mimo mapu). Mimozemstan, ktery vznikne
    // nebo zanikne ve vyrezu, ale ne cely uvnitr okna hry, se roztmi / ztmi za FADE_STEPS kroku obrazu; zanikly se dokresli jako duch
    // posledni podobou s poslednim zmerenym pohybem. Ostatni objekty (strely, plameny) zustavaji jako v originale.
    const FADE_STEPS = 12, ALIEN_SLOTS = 0xc088ce, ALIEN_N = 7, ALIEN_STEP = 0x5a, objBorn = new Map(), fadeStats = { bornOut: 0, bornIn: 0, ghosts: 0, diedIn: 0 }, fadeLog = [];
    let objGhosts = [];
    function insideWin(o, camX, camY) {
        const O = RENDER.objectOrigin(o, o.wx, o.wy), w = o.copy ? o.words * 16 : (o.words - 1) * 16, x0 = camX - 3, y0 = camY + 68;
        return O.X >= x0 && O.Y >= y0 && O.X + w <= x0 + WIN_W && O.Y + o.h <= y0 + WIN_H;
    }
    /** Zasahuje kresba objektu do zobrazeneho vyrezu? */
    function inView(o, camX, camY) {
        const vp = viewport(), O = RENDER.objectOrigin(o, o.wx, o.wy), w = o.copy ? o.words * 16 : (o.words - 1) * 16, x0 = camX - 3 + vp.x0, y0 = camY + 68 + vp.y0;
        return O.X + w > x0 && O.Y + o.h > y0 && O.X < x0 + vp.w && O.Y < y0 + vp.h;
    }
    function objLife(snap) {
        const camX = s16(SLOWOFF + 0x31fc), camY = s16(SLOWOFF + 0x31f8), u32 = (a) => ((mem[a] << 24) | (mem[a + 1] << 16) | (mem[a + 2] << 8) | mem[a + 3]) >>> 0, live = new Map();
        for (let k = 0; k < ALIEN_N; k++) {
            const sl = SLOWOFF + ALIEN_SLOTS - 0xc00000 + k * ALIEN_STEP, rec = u32(sl + 0x12), hx = s16(sl + 4), hy = s16(sl + 6);
            const o = snap.objs.find((q) => q.rec === rec); if (o && !(o.wx === hx && o.wy === hy)) live.set(rec, o);   // zaparkovany = volny slot
        }
        const die = (L) => { if (!inView(L.o, L.camX, L.camY)) return; if (insideWin(L.o, L.camX, L.camY)) { fadeStats.diedIn++; return; } fadeStats.ghosts++; fadeLog.push(['out', snap.s, L.o.rec.toString(16), L.o.wx, L.o.wy, L.camX, L.camY]); { const ds = L.s - L.ps; objGhosts.push({ o: L.o, s: snap.s, from: L.s, vx: ds > 0 ? (L.o.wx - L.px) / ds : 0, vy: ds > 0 ? (L.o.wy - L.py) / ds : 0 }); } };
        for (const [rec, o] of live) {
            let L = objBorn.get(rec);
            if (L && (Math.abs(o.wx - L.o.wx) > 24 || Math.abs(o.wy - L.o.wy) > 24)) { die(L); L = null; }   // slot uvolnen a znovu obsazen mezi snimky
            if (!L) { const vis = inView(o, camX, camY); objBorn.set(rec, L = { born: snap.s, fade: vis && !insideWin(o, camX, camY), o, s: snap.s, px: o.wx, py: o.wy, ps: snap.s, camX, camY }); if (vis) { fadeStats[L.fade ? 'bornOut' : 'bornIn']++; if (L.fade) fadeLog.push(['in', snap.s, rec.toString(16), o.wx, o.wy, camX, camY]); } }
            else { L.px = L.o.wx; L.py = L.o.wy; L.ps = L.s; L.o = o; L.s = snap.s; L.camX = camX; L.camY = camY; }
        }
        for (const [rec, L] of objBorn) if (!live.has(rec)) { die(L); objBorn.delete(rec); }
        objGhosts = objGhosts.filter((g) => snap.s - g.s < FADE_STEPS + 2); if (fadeLog.length > 64) fadeLog.splice(0, fadeLog.length - 64);
    }
    /** Pruhlednost zaznamu rec v case displeje T (0..1): roztmivani po vzniku mimo okno hry. */
    function objAlpha(rec, T) { const L = objBorn.get(rec); return L && L.fade ? Math.min(1, Math.max(0, (T - L.born) / FADE_STEPS)) : 1; }
    function shownObjects(n) { for (let i = objHist.length - 1; i >= 0; i--) if (objHist[i].s < n) return objHist[i]; return null; }
    /** Poloha zaznamu rec v case displeje T (krok obrazu, necelociselne): snimek z kroku s je videt v krocich s+1, s+2 -> stred s+1,5;
     *  linearne mezi stredy sousednich snimku, pri skoku > 24 px (novy objekt na miste jineho) bez interpolace. */
    function objectPosAt(rec, T, fallback) {
        let a = null, b = null;
        for (let i = 0; i + 1 < objHist.length; i++) { const ca = objHist[i].s + 1.5, cb = objHist[i + 1].s + 1.5; if (ca <= T && T < cb) { a = objHist[i]; b = objHist[i + 1]; break; } }
        if (!a) return fallback;
        const oa = a.objs.find((o) => o.rec === rec), ob = b.objs.find((o) => o.rec === rec);
        if (!oa || !ob || oa.copy !== ob.copy || Math.abs(ob.wx - oa.wx) > 24 || Math.abs(ob.wy - oa.wy) > 24) return fallback;
        const f = (T - (a.s + 1.5)) / (b.s - a.s);
        return { x: oa.wx + (ob.wx - oa.wx) * f, y: oa.wy + (ob.wy - oa.wy) * f };
    }
    const MARGIN = 8, worldState = {}, disk = { head: 0, level: 0, shown: false };   // disk: poloha hlavy mechaniky, index mapy nahraneho levelu (LEVEL_FILES)

    // ---- jadro ----
    // rezim korutiny (docs/NATIVE.md 5e): hra uvnitr jadra spi na hranici snimku, novy start = nova instance jadra; modul WebAssembly
    // se zkompiluje jednou a dalsi instance (restart) vzniknou za par ms
    let wasmModule = null, coreId = '';
    async function loadCore() {
        if (!wasmModule) {   // otisk jadra: pozice (savestate) jde nahrat jen do stejneho sestaveni (rozlozeni pameti)
            const bytes = PRES ? await PRES.wasm() : await (await fetch('native-core.wasm')).arrayBuffer();
            coreId = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
            wasmModule = await WebAssembly.compile(bytes);
        }
        const M = await NativeCore({ instantiateWasm: (imports, ok) => { WebAssembly.instantiate(wasmModule, imports).then((inst) => ok(inst, wasmModule)); return {}; } });
        core = M; memBase = M._core_mem(); mem = M.HEAPU8.subarray(memBase, memBase + M._core_memsize());
        log('jadro: ' + M._core_memsize() + ' B pameti (chip 0-0x7FFFF, slow 0xC00000-0xC7FFFF)');
    }
    let adf1 = null, adf2 = null;
    async function loadDisks() {
        if (PRES) { [adf1, adf2] = await PRES.disks(); NATIVE_DATA.rootEntries(adf1); NATIVE_DATA.rootEntries(adf2); return; }
        for (const [k, url] of [['adf1', 'local/disk1.adf'], ['adf2', 'local/disk2.adf']]) {
            try { const r = await fetch(url, { cache: 'no-store' }); if (r.ok) { const d = new Uint8Array(await r.arrayBuffer()); NATIVE_DATA.rootEntries(d); if (k === 'adf1') adf1 = d; else adf2 = d; log(k + ': ' + url + ' (' + d.length + ' B)'); } else log(k + ': ' + url + ' HTTP ' + r.status); } catch (e) { log(k + ': ' + url + ' chyba: ' + e.message); }
        }
        if (!adf1 || !adf2) throw new Error('chybi web/local/disk1.adf a disk2.adf (symlinky na obrazy disket)');
    }
    /** Start z dat ADF (docs/NATIVE.md 5b, 5h): vychozi pamet (PARTF relokovany, partc, zaplata LOAD) a prelozena vstupni sekvence;
     *  soubory nahrava hra pres core -> gameFile. S uvodem bezi prezentacni moduly (nahravaci obrazovka, titul a menu, briefing)
     *  po snimcich jako level, bez uvodu se preskoci a jadro dobehne zmerenou casovou osu az ke smycce levelu. */
    const INTRO_KEY = 'ab-native-intro';
    const URL_INTRO = new URLSearchParams(location.search).get('intro');   // ?intro=skip|on (testy), jinak volba ulozena v prohlizeci
    const skipIntro = () => { if (PRES) return true; if (URL_INTRO) return URL_INTRO === 'skip'; try { return localStorage.getItem(INTRO_KEY) === 'skip'; } catch (e) { return false; } };
    // zkracene nahravani uvodu (vychozi): originál ceka na disketu i v uvodu; zmereno: FACE (131 snimku) a CSAM + FSAM (~800) pri cerne
    // obrazovce, PARTF + PARTC (1306) s logem Alien Breed. Zkracene: cekani pri cerne obrazovce 0, logo 250 snimku (jako vyzva Superfrogu);
    // LP01/LP01B (na obrazovce logo Team17 / upoutavka) a od nahravaci obrazovky (modul 2) doba z diskety jako originál.
    const FAST_KEY = 'ab-native-fast-intro', INTRO_LOGO = 250, INTRO_DARK = ['DISK1:FACE', 'DISK1:CSAM', 'DISK1:FSAM'];
    const fastIntro = () => { try { return localStorage.getItem(FAST_KEY) !== 'orig'; } catch (e) { return true; } };
    let turbo = false, blackRun = 0; const BLACK_HOLD = 25;   // blackRun: po sobe jdouci uplne cerne snimky (capture)
    /** Aktivni copper list hned na zacatku vypne bitplany (BPLCON0 bez planu): hra tak zatemni obrazovku vcetne HUD, napr. 0x3494
     *  (BPLCON0 0x200, COLOR00 0) pred terminalem Intex a pri prechodech; stranka pak kresli obraz z copper listu (cerno), ne level s HUD. */
    function blankList(lc) {
        for (let a = lc, k = 0; k < 8; k++, a += 4) {
            const w1 = (mem[a] << 8) | mem[a + 1], w2 = (mem[a + 2] << 8) | mem[a + 3];
            if (w1 & 1) return false;                                   // WAIT/SKIP: dal uz se nehleda
            if ((w1 & 0x1fe) === 0x100) return ((w2 >> 12) & 7) === 0;
        }
        return false;
    }
    /** Obraz RGBA uplne cerny (kazdy step-ty pixel; R, G, B nula). */
    function isBlack(rgba, step) { for (let i = 0, n = rgba.length, d = step * 4; i < n; i += d) if (rgba[i] | rgba[i + 1] | rgba[i + 2]) return false; return true; }
    // animace vzdy (vychozi zapnuto): jizda vytahem i pri drzenem fire, start terminalu Intex vzdy s efektem stareho PC (native-core.c ANIM_ALWAYS)
    const ANIM_KEY = 'ab-native-anim-always';
    const animAlways = () => { if (PRES) return true; try { return localStorage.getItem(ANIM_KEY) !== 'orig'; } catch (e) { return true; } };
    const introTurbo = () => disk.intro && disk.shown && fastIntro() && core && core._core_module() === 0 && !core._core_fault();
    function loadSeed() {
        const t0 = performance.now();
        const img = NATIVE_DATA.bootImage(adf1);
        mem.set(img.ram);
        worldState.diskMap = NATIVE_DATA.level(adf2, 0).map;   // mapa z diskety: podklad bunek, ktere hra za behu vycerni (docs/RENDER.md 13)
        // mapa podkladu podle levelu: hra nahrava mapu souborem L?MA (tabulka 0xC0ABF6; po levelu 1 = L0MA nasleduje LBMA, zmereno 2026-10-22)
        // doba nahrani jako z diskety v originalu (NATIVE_DATA.diskTime, jadro ji odcka jen s uvodem); hlava mechaniky drzi polohu mezi soubory
        // cekani na disketu az od prvni obrazovky hry: uvod originalu (program load: upoutavka, logo), behem ktereho se nahravaji CSAM/FSAM,
        // zatim neni prelozeny, cerna obrazovka by trvala ~23 s
        disk.head = 0; disk.level = 0; disk.shown = false; disk.intro = !skipIntro();
        core.loadFile = (p) => {
            const m = /(L[0-9A-B]MA)$/.exec(p), k = m ? NATIVE_DATA.LEVEL_FILES.indexOf(m[1]) : -1; if (k >= 0) { worldState.diskMap = NATIVE_DATA.level(adf2, k).map; disk.level = k; }
            const f = /^DISK([12]):(.+)$/.exec(p); if (f) { const t = NATIVE_DATA.diskTime(f[1] === '1' ? adf1 : adf2, f[2], disk.head); disk.head = t.head; core.loadDelay = disk.shown ? t.frames : 0;
                if (p === 'DISK1:PARTF') { const t2 = NATIVE_DATA.diskTime(adf1, 'partc', disk.head); disk.head = t2.head; core.loadDelay += t2.frames; }   // konec uvodu: PARTF + PARTC
                if (disk.intro && fastIntro()) { if (p === 'DISK1:PARTF') core.loadDelay = Math.min(core.loadDelay, INTRO_LOGO); else if (INTRO_DARK.includes(p)) core.loadDelay = 0; } }
            return NATIVE_DATA.gameFile(adf1, adf2, p);
        };
        const intro = !skipIntro();
        core._core_set_present(intro ? 1 : 0); core._core_set_anim_always(animAlways() ? 1 : 0);
        // uvod originalu (program load, docs/NATIVE.md 5k): jadro si ho vyzada na zacatku core_run, po nem znovu pamet startu hry
        core.introImage = () => { const im = NATIVE_DATA.introImage(adf1); mem.set(im.data, im.addr); return 1; };
        core.onIntroDone = () => { mem.set(img.ram); log('uvod skoncil, start hry z dat ADF'); };
        core._core_run(img.regs.a7, img.regs.d0, img.regs.a0);   // vraci se pri prvnim usnuti hry (s uvodem v prvnim snimku, jinak u smycky levelu)
        // bez uvodu: jadro dobehlo ke smycce levelu bez prezentacnich modulu; od ted moduly bezi (obrazovka mezi levely s jizdou vytahem,
        // game over, briefingy dalsich levelu) a nahravani ma dobu z diskety - jinak hra obrazovku mezi levely preskocila (nahlaseno 2026-10-23)
        if (!intro) core._core_set_present(1);
        const at = core._core_running() && core.frameWake ? 0xc00a84 : 0;
        const bl = core.UTF8ToString(core._core_bootlog());
        seedMeta = { trace: 'ADF', frame: 0, sdr: 0, px: s16(SLOWOFF + 0x599e), py: s16(SLOWOFF + 0x59a0), exit: at, ticks: core._core_ticks() };
        steps = 0; objHist = []; objBorn.clear(); objGhosts = []; for (const k in fadeStats) fadeStats[k] = 0; fadeLog.length = 0; faultShown = false;
        log('start z ADF: PARTF ' + img.info.partf.size + ' B (' + img.info.partf.relocs + ' relokaci), partc ' + img.info.partc.data + ' B; ' + (intro ? 'uvod (prezentacni moduly) bezi po snimcich' : 'vstupni sekvence az k smycce levelu: exit 0x' + at.toString(16) + ', ' + seedMeta.ticks + ' prerusenich') + ', ' + (performance.now() - t0).toFixed(0) + ' ms');
        log(bl.trim());
        if (at !== 0xc00a84) throw new Error('vstupni sekvence se nerozbehla (0x' + at.toString(16) + ')');
        if (!PRES) $('status').textContent = intro ? 'Připraveno: hra od nahrávací obrazovky (bez emulátoru).' : 'Připraveno: level 1 ze dvou disket (bez emulátoru).'; $('intro-start').disabled = false;
        $('intro-files').textContent = intro ? 'Jádro načteno, hra začne nahrávací obrazovkou, titulem, menu a briefingem (fire nebo levé tlačítko myši).' : 'Jádro načteno, level 1 nastartován z dat disket (hráč ' + seedMeta.px + ', ' + seedMeta.py + ').';
    }
    const s16 = (a) => ((mem[a] << 8) | mem[a + 1]) << 16 >> 16;
    function joystick() {
        // JOY1DAT: bit 1 = vpravo, bit 9 = vlevo, dolu = bit 0 XOR bit 1, nahoru = bit 8 XOR bit 9 (zmereno: vpravo = 0x0003)
        const g = PAD || {}, r = held.has('ArrowRight') || !!g.right, l = held.has('ArrowLeft') || !!g.left, u = held.has('ArrowUp') || !!g.up, d = held.has('ArrowDown') || !!g.down;
        let v = 0;
        if (r) v |= 0x0002; if (l) v |= 0x0200;
        if (d !== r) v |= 0x0001;           // bit0 = bit1 XOR dolu
        if (u !== l) v |= 0x0100;           // bit8 = bit9 XOR nahoru
        const fire = held.has('KeyX') || held.has('ControlLeft') || held.has('ControlRight') || !!g.fire;
        return { joy1: v, pra: (fire ? 0x7e : 0xfe) & (mouseDown ? ~0x40 : 0xff) };   // bit 6 = leve tlacitko mysi (port 1), cte ho titul a menu
    }
    let spaceDown = false, mouseDown = false;
    /** Jeden snimek hry: vstup, probuzeni jadra (hra bezi do dalsi hranice snimku), zachyceni obrazu. */
    function wake() { const w = core.frameWake; core.frameWake = null; if (w) w(); }
    function step() {
        if (!disk.shown && core && core._core_module()) disk.shown = true;
        if (PRES && core) {   // prezentace: obrazovka mezi levely (modul 6) = konec levelu 1, game over (modul 5) = znovu od zacatku
            const md = core._core_module();
            if (md === 6) { if (!presEnded) { presEnded = true; running = false; AUDIO.pause(); PRES.levelEnd(); } return; }
            if (md === 5 && !presRestart) { presRestart = true; running = false; restart().then(() => { presRestart = false; start(); }); return; }
        }
        if (disk.intro && core && core._core_module() && core._core_module() !== 7) disk.intro = false;   // nahravaci obrazovka (modul 2): dal doba z diskety jako originál
        const j = joystick();
        core._core_input(0, j.joy1, j.pra, 0, 0);
        // klavesnice hry (0xC21208 = surovy kod posledni klavesy): mezernik 0x40 (terminal Intex, obsluha typu 23 0xC08104),
        // pri pusteni kod uvolneni 0x40 | 0x80 (jinak by kod zustal a terminal se po odchodu otevrel znovu)
        if (held.has('Space') || (PAD && PAD.space)) { mem[SLOWOFF + 0x21208] = 0x40; spaceDown = true; } else if (spaceDown) { mem[SLOWOFF + 0x21208] = 0xc0; spaceDown = false; }
        const t0 = performance.now();
        wake(); steps++; objStep();
        AUDIO.frame(core, mem);
        stats.stepMs = performance.now() - t0;
        if (core._core_fault() && !faultShown) {   // chyba prekladu: hra stoji, misto tiche zamrznuti ohlasit adresu (docs/NATIVE.md 5d)
            faultShown = true; manualPause = paused = true;
            const f = core._core_fault() >>> 0, pc = core._core_fault_pc() >>> 0, kind = (f & 0x40000000) ? 'nepřeložená rutina 0x' : (f & 0x80000000) ? 'přístup mimo RAM 0x' : 'chyba 0x';
            const msg = 'Chyba překladu kódu hry: ' + kind + (f & 0xffffff).toString(16) + ' (z 0x' + pc.toString(16) + ', krok ' + steps + '). Hra zastavena, R = level od začátku.';
            log(msg); shell.message(msg); $('frame-status').textContent = msg;
        }
        capture();
    }
    // ---- zobrazeni z RAM jadra (jako view.js, ale bez emulatoru: HUD zatim neni) ----
    function capture() {
        const t0 = performance.now();
        const chipA = mem.subarray(0x1000, 0x5000), planes = mem.subarray(0x28000, 0x48000);
        const cop = RENDER.parseCopper(chipA, 0x1000);
        // level jen s aktivnim copper listem levelu (COP1LC 0x2E48/0x3494/0x34C8 v 0x1000-0x5000): seznam levelu v pameti zustava i behem
        // nahravani dalsiho levelu, kdy hardware ukazuje briefing z obrazovky mezi levely (COP1LC 0x28F4A az do fire, docs/NATIVE.md 5j)
        const lc = ((core._core_creg(0x080) << 16) | core._core_creg(0x082)) >>> 0;
        if (core._core_module() || !cop.level || lc < 0x1000 || lc >= 0x5000 || blankList(lc)) { captureScreen(t0); return; }
        scrState = null;   // level: svisle okno obrazovek mimo level zacne znovu (stav klopneho obvodu jen mezi po sobe jdoucimi obrazovkami)
        const vp = captureViewport(), enhanced = prefs.mode === 'enhanced' || !!modeAnim;
        const view = { x0: vp.x0 - MARGIN, y0: vp.y0 - MARGIN, w: vp.w + 2 * MARGIN, h: vp.h + 2 * MARGIN }, n = view.w * view.h;
        if (!idxBuf || idxBuf.length !== n) { idxBuf = new Uint8Array(n); spBuf = new Uint8Array(n); rgbaBuf = new Uint8ClampedArray(n * 4); spRgba = new Uint8ClampedArray(n * 4); winBuf = new Uint8Array(WIN_W * WIN_H); }
        const camX = s16(SLOWOFF + 0x31fc), camY = s16(SLOWOFF + 0x31f8);
        // teren z mapy a dlazdic v RAM hry (okno hry je ve svete na (kamera X - 3, kamera Y + 68), docs/MAP.md 5)
        RENDER.renderWorld(worldState, mem.subarray(SLOWOFF, SLOWOFF + 0x80000), 0xc00000, camX - 3 + view.x0, camY + 68 + view.y0, view.w, view.h, idxBuf);
        // okno hry (293 x 240) z bitplanovych bufferu presne tak, jak ho hra nakreslila (vcetne objektu), na sve misto ve vyrezu
        RENDER.renderIndices(cop, planes, 0x28000, { x0: 0, y0: 0, w: WIN_W, h: WIN_H }, winBuf);
        let shown = null;
        if (!enhanced) {   // Original: okno presne z bufferu hry (vcetne cerneho sloupce 0 pri posunu 14, jako hardware)
            for (let y = 0; y < WIN_H; y++) { const vy = y - view.y0; if (vy < 0 || vy >= view.h) continue; idxBuf.set(winBuf.subarray(y * WIN_W, y * WIN_W + WIN_W), vy * view.w - view.x0); }
        } else {
            // Vylepseno: hraci plocha = teren z mapy + objekty kreslene v draw() ze svych zaznamu (s interpolaci polohy). Kontrola modelu:
            // okno hry z bufferu proti terenu + objektum v zobrazene poloze; nevysvetlene pixely (zbytky u spodni hrany, co model nezna)
            // se vlozi z bufferu na sve misto, aby se nic neztratilo. Sloupec 0 pri posunu 14 a radky >= 236 (spodni orez hry) se nekontroluji.
            shown = shownObjects(steps);
            if (!modelBuf) modelBuf = new Uint8Array(WIN_W * WIN_H);
            RENDER.renderWorld(worldState, mem.subarray(SLOWOFF, SLOWOFF + 0x80000), 0xc00000, camX - 3, camY + 68, WIN_W, WIN_H, modelBuf, true);   // atlas uz obnoven vyse
            if (shown) RENDER.drawObjects(shown.objs, mem.subarray(0, CHIP), camX - 3, camY + 68, WIN_W, WIN_H, modelBuf);
            const winX0 = Math.max(0, -RENDER.fineOf(cop)); let unknown = 0;
            if (!unkCol) unkCol = new Uint16Array(WIN_W); else unkCol.fill(0);
            for (let y = 0; y < 236; y++) for (let x = winX0; x < WIN_W; x++) { const k = y * WIN_W + x; if (winBuf[k] !== modelBuf[k]) { unknown++; unkCol[x]++; idxBuf[(y - view.y0) * view.w + x - view.x0] = winBuf[k]; } }
            let worst = 0; for (let x = 1; x < WIN_W; x++) if (unkCol[x] > unkCol[worst]) worst = x;
            // diagnostika unknownCol: nejhorsi sloupec okna (svisla cara = cely sloupec z bufferu)
            stats.unknownPx = unknown; stats.unknownCol = [worst, unkCol[worst], winX0, RENDER.fineOf(cop)]; stats.objects = shown ? shown.objs.length : 0;
        }
        RENDER.paint(idxBuf, view.w, view.h, cop.palette, rgbaBuf);
        // obrazky snimku objektu (cache podle popisovace a palety) + nahled nespustenych spawneru za oknem hry (RENDER.spawnPreviews)
        const objs = [], ghosts = [];
        if (shown) {
            const pk = cop.palette.join(',');
            if (objImgCache.size > 512) objImgCache.clear();
            const active = new Set(shown.objs.map((o) => o.cell)), wx0 = camX - 3, wy0 = camY + 68;
            const previews = RENDER.spawnPreviews(mem.subarray(SLOWOFF, SLOWOFF + 0x80000), 0xc00000, wx0 + view.x0, wy0 + view.y0, view.w, view.h, steps >> 1, active)
                .filter((o) => { const O = RENDER.objectOrigin(o, o.wx, o.wy); return O.X + o.words * 16 <= wx0 || O.X >= wx0 + WIN_W || O.Y + o.h <= wy0 || O.Y >= wy0 + WIN_H; });   // jen mimo okno hry
            stats.previews = previews.length;
            const imgOf = (o) => {
                const key = o.desc + ':' + o.copy + ':' + pk; let c = objImgCache.get(key);
                if (!c) { const im = RENDER.objectImage(o, mem.subarray(0, CHIP), cop.palette); c = document.createElement('canvas'); c.width = im.w || 1; c.height = im.h || 1; if (im.w && im.h) c.getContext('2d').putImageData(new ImageData(im.rgba, im.w, im.h), 0, 0); objImgCache.set(key, c); }
                return c;
            };
            for (const o of shown.objs.concat(previews)) objs.push({ o, img: imgOf(o) });
            for (const g of objGhosts) if (g.s < steps && steps - g.s <= FADE_STEPS + 1) ghosts.push({ g, img: imgOf(g.o) });
        }
        spBuf.fill(0); RENDER.drawSprites(spBuf, view, cop, mem.subarray(0, CHIP), 0);
        // sprity jen uvnitr okna hry (DIW 293 x 240): hardware je mimo okno nezobrazi; sprity 0-3 parkuji hra vpravo za oknem (x 337/354)
        for (let y = 0; y < view.h; y++) { const wy = y + view.y0; const ob = y * view.w; if (wy < 0 || wy >= WIN_H) { spBuf.fill(0, ob, ob + view.w); continue; }
            const xl = -view.x0, xr = xl + WIN_W; if (xl > 0) spBuf.fill(0, ob, ob + Math.min(xl, view.w)); if (xr < view.w) spBuf.fill(0, ob + Math.max(xr, 0), ob + view.w); }
        RENDER.paint(spBuf, view.w, view.h, cop.palette, spRgba, true);
        let spPix = 0; for (let i = 0; i < n; i++) if (spBuf[i]) spPix++; stats.spritePixels = spPix;
        pfIdx ^= 1;
        if (!pfCanvas[pfIdx]) { for (const arr of [pfCanvas, spCanvas]) arr[pfIdx] = document.createElement('canvas'); pfCtx[pfIdx] = pfCanvas[pfIdx].getContext('2d'); spCtx[pfIdx] = spCanvas[pfIdx].getContext('2d'); }
        for (const [c, x, buf] of [[pfCanvas[pfIdx], pfCtx[pfIdx], rgbaBuf], [spCanvas[pfIdx], spCtx[pfIdx], spRgba]]) {
            if (c.width !== view.w || c.height !== view.h) { c.width = view.w; c.height = view.h; }
            x.putImageData(new ImageData(buf, view.w, view.h), 0, 0);
        }
        if (vp.hud && typeof RENDER.renderHud === 'function') {
            if (!hudCanvas) { hudCanvas = document.createElement('canvas'); hudCanvas.width = WIN_W; hudCanvas.height = HUD_TOP + HUD_BOT; hudCtx = hudCanvas.getContext('2d'); }
            const hud = RENDER.renderHud(mem.subarray(0, CHIP), 0);   // RGBA 293 x (9 + 7): radky 43..51 a 293..300
            if (hud) { hudCtx.putImageData(new ImageData(hud, WIN_W, HUD_TOP + HUD_BOT), 0, 0); hudRaw = hud; hudRev++; }
        }
        blackRun = isBlack(rgbaBuf, 16) && isBlack(spRgba, 16) && (!vp.hud || !hudRaw || isBlack(hudRaw, 4)) ? blackRun + 1 : 0;
        prev = cur;
        cur = { n: steps, t: performance.now(), camX, camY, px: s16(SLOWOFF + 0x599e), py: s16(SLOWOFF + 0x59a0), pf: pfCanvas[pfIdx], sp: spCanvas[pfIdx], view, vp, objs, ghosts, rgb: RENDER.channels() };
        stats.renderMs = performance.now() - t0; stats.frames++;
    }
    // obrazovka mimo level (modul Intex, prechody): cely snimek obecnym rendererem z copper listu (RENDER.renderCopperFrame, docs/RENDER.md 15),
    // radky paprsku 26..310 a lores pozice 98..455 jako snimek emulatoru; registry, ktere nastavil procesor, ze stinu jadra
    // xs 2: snimek v hires bodech (logo Team17 a upoutavka uvodu jsou hires 640 px, BPLCON0 0xC200), na platno se kresli v sirce w
    // scrState: svisle okno (DIW) jako klopny obvod hardwaru mezi snimky – terminal Intex pri startu nahodne posouva DIW a okno
    // zustava otevrene pres konec snimku (zmereno proti vAmize, docs/RENDER.md 15)
    const SCR = { l0: 26, h: 285, h0: 98, w: 358, xs: 2 }; let wbTest = null, unkCol = null, scrState = null, scrCanvas = null, scrCtx = null, scrRgba = null; const cregBuf = new Uint16Array(256);
    // obrazovka mimo level: pamet vstupu posledniho nakresleneho snimku (registry, stav svisleho okna pred a po, kopie prectenych stranek)
    let scrMemo = null, scrRgb = '';   // scrRgb: kanaly RGB, se kterymi je obrazovka nakreslena
    const stCopy = (st) => ({ vOpen: st.vOpen, diw: st.diw && st.diw.slice(), ptr: st.ptr && st.ptr.slice() });
    /** Kanaly RGB se zmenily: zobrazeny snimek znovu z tehoz stavu RAM (v pauze a v menu hra nebezi), hra se neposune. Obrazovka mimo
     *  level: stav svisleho okna pred snimkem (scrMemo.pre) a tytez registry, po vykresleni je stav stejny jako po puvodnim snimku. */
    function recolor() {
        if (!cur || !mem || !core) return;
        if (cur.screen) {
            const m = scrMemo, st = scrState; if (!m || !m.pre || !st || m.st !== st) return;
            Object.assign(st, stCopy(m.pre));
            RENDER.renderCopperFrame(mem.subarray(0, CHIP), 0, ((m.creg[0x080 >> 1] << 16) | m.creg[0x082 >> 1]) >>> 0, m.creg, SCR.l0, SCR.h, SCR.h0, SCR.w, scrRgba, SCR.xs, st);
            scrCtx.putImageData(new ImageData(scrRgba, SCR.w * SCR.xs, SCR.h), 0, 0); cur.rgb = scrRgb = RENDER.channels();
        } else { const b = blackRun; capture(); blackRun = b; }
        drawDirty = true;
    }
    const stKey = (st) => (st.vOpen ? 1 : 0) + '|' + (st.diw ? st.diw.join(',') : '') + '|' + (st.ptr ? Array.from(st.ptr).join(',') : '');
    const sameU16 = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
    function memoPages(st, before, black) {
        const idx = []; for (let i = 0; i < st.pages.length; i++) if (st.pages[i]) idx.push(i);
        const snap = new Uint8Array(idx.length * 4096); idx.forEach((p, k) => snap.set(mem.subarray(p * 4096, p * 4096 + 4096), k * 4096));
        return { st, before, creg: cregBuf.slice(), idx, snap, black, after: { vOpen: st.vOpen, diw: st.diw.slice(), ptr: st.ptr.slice() } };
    }
    function samePages(m) {
        const al = (mem.byteOffset & 3) === 0, s32 = al ? new Uint32Array(m.snap.buffer) : null;
        for (let k = 0; k < m.idx.length; k++) {
            const o = m.idx[k] * 4096;
            if (al) { const c32 = new Uint32Array(mem.buffer, mem.byteOffset + o, 1024); for (let i = 0, j = k * 1024; i < 1024; i++, j++) if (c32[i] !== s32[j]) return false; }
            else for (let i = 0; i < 4096; i++) if (mem[o + i] !== m.snap[k * 4096 + i]) return false;
        }
        return true;
    }
    function captureScreen(t0) {
        for (let i = 0; i < 256; i++) cregBuf[i] = core._core_creg(i * 2);
        const coplc = ((cregBuf[0x080 >> 1] << 16) | cregBuf[0x082 >> 1]) >>> 0;
        if (!scrCanvas) { scrCanvas = document.createElement('canvas'); scrCanvas.width = SCR.w * SCR.xs; scrCanvas.height = SCR.h; scrCtx = scrCanvas.getContext('2d'); scrRgba = new Uint8ClampedArray(SCR.w * SCR.xs * SCR.h * 4); }
        const st = scrState || (scrState = { vOpen: false }), before = stKey(st);
        if (scrMemo && scrMemo.st === st && scrMemo.before === before && scrRgb === RENDER.channels() && sameU16(scrMemo.creg, cregBuf) && samePages(scrMemo)) {
            // stejne vstupy (registry, stav okna, prectene stranky chip RAM) = stejny obraz: snimek se nekresli (obrazovky mimo level stoji)
            st.vOpen = scrMemo.after.vOpen; st.diw = scrMemo.after.diw.slice(); st.ptr = scrMemo.after.ptr.slice(); stats.screenSkips++;
            blackRun = scrMemo.black ? blackRun + 1 : 0;
        } else {
            const pre = stCopy(st);
            RENDER.renderCopperFrame(mem.subarray(0, CHIP), 0, coplc, cregBuf, SCR.l0, SCR.h, SCR.h0, SCR.w, scrRgba, SCR.xs, st);
            scrCtx.putImageData(new ImageData(scrRgba, SCR.w * SCR.xs, SCR.h), 0, 0); scrRgb = RENDER.channels();
            const black = isBlack(scrRgba, 16); blackRun = black ? blackRun + 1 : 0;
            scrMemo = memoPages(st, before, black); scrMemo.pre = pre;
        }
        prev = null;
        cur = { n: steps, t: performance.now(), screen: scrCanvas, module: core._core_module(), camX: 0, camY: 0, px: s16(SLOWOFF + 0x599e), py: s16(SLOWOFF + 0x59a0), objs: [], ghosts: [], rgb: scrRgb };
        stats.renderMs = performance.now() - t0; stats.frames++;
    }
    function viewportOf(mode) { return VIEWPORTS[mode === 'original' ? 'orig' : (VIEWPORTS[prefs.viewport] ? prefs.viewport : 'w448')]; }
    function viewport() { return viewportOf(prefs.mode); }
    // behem prechodu se zachycuje sjednoceni obou vyrezu (w448 obsahuje orig), kresli se animovany vyrez z modeSample()
    function captureViewport() { if (!modeAnim) return viewport(); const a = modeAnim.fromVp, b = modeAnim.toVp; const x0 = Math.min(a.x0, b.x0), y0 = Math.min(a.y0, b.y0); return { x0, y0, w: Math.max(a.x0 + a.w, b.x0 + b.w) - x0, h: Math.max(a.y0 + a.h, b.y0 + b.h) - y0, hud: true }; }
    // Vylepseno: HUD o 1/9 vetsi (pismo i do sirky), pruhy 10 + 8 radku misto 9 + 7; behem prechodu rezimu plynule podle sirky vyrezu
    const HUD_F = 10 / 9, HUD_FULL_W = 448;
    function hudOf(vp) {
        if (!vp.hud) return { top: 0, bot: 0, f: 1 };
        const t = Math.min(1, Math.max(0, (vp.w - WIN_W) / (HUD_FULL_W - WIN_W)));
        return { top: HUD_TOP + t, bot: HUD_BOT + t, f: 1 + (HUD_F - 1) * t };
    }
    function screenSizeOf(vp) { const H = hudOf(vp); return { w: vp.w, h: vp.h + H.top + H.bot }; }
    function screenSize() { return screenSizeOf(viewport()); }
    // ---- prechod Original <-> Vylepseno (Turrican ViewportTransition): jen kresleni, hra bezi dal beze zmeny ----
    let modeAnim = null, drawDirty = true, drawnCur = null;
    const MAX_STEPS = 2, TURBO_MS = 12;   // takt: nejvys 2 kroky hry na snimek displeje; zrychlene pauzy nejvys 12 ms prace na snimek   // { from: {x0,y0,w,h,z}, to: {...}, fromVp, toVp, start }
    const smoothstep = (t) => t * t * (3 - 2 * t);
    function shownVisual(now) {   // prave zobrazeny vyrez a zoom (i uprostred animace: otoceni z teto polohy)
        const s = modeSample(now); if (s) return s;
        const vp = viewport(); return { x0: vp.x0, y0: vp.y0, w: vp.w, h: vp.h, z: scaleInfo.z };
    }
    function modeSample(now) {
        if (!modeAnim) return null;
        const t = Math.max(0, Math.min(1, (now - modeAnim.start) / MODE_MS));
        if (t >= 1) { modeAnim = null; applyDisplay(); return null; }
        const e = smoothstep(t), f = modeAnim.from, g = modeAnim.to, l = (k) => f[k] + (g[k] - f[k]) * e;
        return { x0: l('x0'), y0: l('y0'), w: l('w'), h: l('h'), z: l('z'), e };
    }
    /** wb-shell obraz 1.2 (1.1): S = cele pixely zarizeni na herni pixel; zoom = sirka okna v nasobcich W0 (Vylepseno 448 ukaze pri stejnem
     *  zoomu vic sveta ve zhruba stejnem okne): S = round(zoom * W0 / W * dpr), do okna floor(fit * dpr), vzdy nejvys to, co se vejde. */
    // popisek zoomu cesky (wb-obraz 1.3 ma anglicka slova a desetinnou tecku)
    const zoomLabelCz = (...a) => PRES ? WBOBRAZ.zoomLabel(...a) : WBOBRAZ.zoomLabel(...a, { fit: 'do okna', limited: 'omezeno na', actual: 'skutečně' }).replace(/(\d)\.(\d)/g, '$1,$2');
    function zoomFor(vp, zoomPref, par = 1) {   // par: pomer pixelu (obraz o tolik sirsi, do okna se pocita se zobrazenou sirkou)
        // do okna = nejvetsi meritko, ktere se vejde na sirku i vysku stage (jako index.html; drive jen sirka: Original do okna pretekal dolu)
        const dpr = window.devicePixelRatio || 1, sz = screenSizeOf(vp), st = $('stage');
        const limit = Math.min(Math.max(200, st.clientWidth - 26) / (sz.w * par), Math.max(150, st.clientHeight - 26) / sz.h);
        const S = WBOBRAZ.deviceScale(zoomPref, W0, sz.w, dpr, limit);
        return { S, z: S / dpr, dpr, limit, zoom: S / dpr * sz.w / W0 };
    }
    function lookOf(m) { const v = prefs.views[m]; return { mode: m, detail: v.crtDetail, shape: v.crtShape, on: v.crt ? 1 : 0, blur: v.blur, par: v.par ? PAL_PAR : 1, brightness: v.brightness, contrast: v.contrast, saturation: v.saturation, red: v.red, green: v.green, blue: v.blue }; }
    /** Vzhled okna w x h hernich pixelu pri pixel CSS px na herni pixel (behem prechodu necele): filtr platna (knofliky, rozmazani
     *  0,8 herniho pixelu pri 100 %) a vrstva CRT pres obsah v pixelech zarizeni (Original perioda = herni radek, Vylepseno mrizka 2/3/4). */
    function applyLook(L, w, h, pixel, dpr) {
        canvas.style.filter = WBOBRAZ.filter(L, pixel);
        if (RENDER.setChannels(L.red, L.green, L.blue)) objImgCache.clear();   // kanaly RGB: tabulka barev, obrazky objektu se starymi barvami pryc
        scaleInfo.crt = screen.crt({ mode: L.mode, detail: L.detail, shape: L.shape, S: Math.max(1, Math.round(pixel * dpr)), dpr, w: WBOBRAZ.padded(Math.max(1, Math.round(w * pixel * dpr * (L.par || 1))), dpr), h: WBOBRAZ.padded(Math.max(1, Math.round(h * pixel * dpr)), dpr), on: L.on });   // vrstva = backing platna (1.3)
        lastLook = L;
    }
    function applyDisplay() {
        drawDirty = true;
        if (modeAnim) { updateControls(); return; }   // prechod: rozmer platna ridi draw, po dobehnuti zavola applyDisplay znovu
        const vp = viewport(), enhanced = prefs.mode === 'enhanced';
        // backing platna = presne pixely zarizeni (S cele), jinak se obraz prevzorkuje a posun 1,67 px na snimek displeje se laame na nestejne kroky
        const par = prefs.par ? PAL_PAR : 1, sz = screenSize(), { S, z, dpr, limit, zoom } = zoomFor(vp, prefs.zoom, par);   // nevejde se do okna: mensi zoom, ale backing stale = pixely zarizeni
        // 1.3: backing = obsah W*S x H*S zaokrouhleny nahoru na krok rozvrzeni q (Chromium uklada rozmery po 1/64 CSS px: dpr 1,25 q 5,
        // 1,5 q 3), hra kresli do leveho horniho W*S x H*S, zbytek cerny; jinak se platno prevzorkuje (zdvojeny/zkraceny radek)
        // PAL: backing o 4 % sirsi (zase cele pixely zarizeni), kresleni vodorovne natazene transformaci (draw), ne CSS (to by zdvojovalo sloupce)
        const bw = WBOBRAZ.padded(Math.round(sz.w * S * par), dpr), bh = WBOBRAZ.padded(sz.h * S, dpr);
        if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
        // platno ma ramecek 1 px (box-sizing border-box): obsah = sirka - 2, proto +2, jinak by se backing prevzorkoval o 2 px
        gameEl.style.width = (bw / dpr + 2) + 'px'; canvas.style.height = (bh / dpr + 2) + 'px';   // vyska explicitne: aspect-ratio by u border-box zahrnul ramecek
        scaleInfo = { S, z, dpr, limit, zoom, par };
        gameEl.classList.toggle('smooth', enhanced); gameEl.classList.remove('mode-changing');
        applyLook(lookOf(prefs.mode), sz.w, sz.h, z, dpr);
        if (cur && cur.rgb !== RENDER.channels()) recolor();   // zobrazeny snimek se starymi kanaly (pauza, menu, stojici obrazovka)
        updateControls();
        screen.align();
    }
    function updateControls() {   // ovladaci prvky menu podle rezimu (i behem prechodu, platno pak ridi draw)
        const vp = viewport(), enhanced = prefs.mode === 'enhanced', t = zoomFor(vp, prefs.zoom, prefs.par ? PAL_PAR : 1);
        for (const k of KNOBS.concat(CHANNELS)) { $(k).value = prefs[k]; $(k + '-value').textContent = prefs[k] + ' %'; }
        $('run-state').textContent = enhanced ? 'Vylepšeno' : 'Originál';
        $('mode-original').setAttribute('aria-pressed', String(!enhanced)); $('mode-enhanced').setAttribute('aria-pressed', String(enhanced));
        $('view-mode-note').textContent = 'Celé nastavení obrazu platí pro režim ' + (enhanced ? 'Vylepšeno' : 'Originál') + '.';
        $('smooth').checked = prefs.smooth; $('smooth').disabled = false; $('blur').disabled = false;
        $('zoom').value = prefs.zoom; $('zoom-value').textContent = zoomLabelCz(prefs.zoom, t.S, t.dpr, W0, screenSizeOf(vp).w);
        for (const b of document.querySelectorAll('[data-zoom]')) b.setAttribute('aria-pressed', String(parseFloat(b.dataset.zoom) === prefs.zoom));
        $('par').checked = prefs.par; $('crt').checked = prefs.crt; $('crt-detail').value = prefs.crtDetail; $('crt-shape').value = prefs.crtShape; $('blur').value = prefs.blur; $('blur-value').textContent = prefs.blur + ' %';
        $('display-status').textContent = 'Výřez ' + vp.w + ' × ' + vp.h + (vp.hud ? ' + HUD' : '') + ' · plátno ' + canvas.width + ' × ' + canvas.height + ' px zařízení, celé pixely ×' + t.S + (t.dpr !== 1 ? ' (dpr ' + t.dpr + ')' : '') + (prefs.par ? ', na šířku × 1,04 (PAL)' : '');
    }
    function pollPad() {                   // gamepad: smery a fire bere step(), tady hrany Y (Original / Vylepseno) a Start (pauza)
        if (!PADS) return;
        PAD = PADS.poll();
        if (shell.busy) { PAD = NativeInput.empty(); return; }
        if (PAD.modePressed) setMode(prefs.mode === 'enhanced' ? 'original' : 'enhanced');
        if (PAD.pausePressed) togglePause();
    }
    // zatizeni v liste (jako Superfrog): prace stranky v snimcich displeje (kroky hry, kresleni) na jeden krok hry, jednou za sekundu
    const load = { ms: 0, steps: 0, t: 0 };
    function draw(now) {
        const t = performance.now(); drawFrame(now); load.ms += performance.now() - t;
        if (!running || paused || wbTest) { load.t = 0; return; }
        if (!load.t) { load.t = t; load.ms = 0; load.steps = steps; return; }
        if (t - load.t >= 1000 && steps > load.steps) {
            const per = load.ms / (steps - load.steps), txt = PRES ? 'Level 1 · frame ' + per.toFixed(1) + ' ms of 20' : 'Hra běží · výpočet ' + per.toFixed(1).replace('.', ',') + ' ms z 20';
            $('status').textContent = txt; stats.loadMs = per; load.t = t; load.ms = 0; load.steps = steps;
        }
    }
    function drawFrame(now) {
        if (!running) return;
        pollPad();
        if (wbTest) { requestAnimationFrame(draw); return; }   // testovaci vzor obrazoveho kontraktu (wbObrazTest.fill) se neprekresluje
        const t0 = performance.now();
        if (!paused) {
            if (now - stepClock > 5 * FRAME_MS) stepClock = now - FRAME_MS;      // po vypadku (menu, karta na pozadi) znovu zavesit
            // takt jako Superfrog (docs/NATIVE.md 5n): nejvys MAX_STEPS kroku hry na snimek displeje; kdyz pocitac nestiha, zpozdeni se
            // zahodi a hra zpomali (dohaneni by snimek prodlouzilo a stranka by prestala reagovat na menu a klavesy)
            let ns = 0;
            while (now - stepClock >= FRAME_MS && ns < MAX_STEPS) { step(); stepClock += FRAME_MS; ns++; }
            if (now - stepClock >= FRAME_MS) { stepClock = now; stats.slowFrames++; }
            // zkracene nahravani uvodu: po logu hra pri cerne obrazovce zpracovava zvuky z CSAM/FSAM (~340 snimku, kod 0xC2388E) -> 8 snimku
            // hry na snimek displeje; potom zahodit nahromadeny zvuk (jinak by zpozdoval)
            if (introTurbo()) { for (let i = 0; i < 7 && introTurbo() && performance.now() - t0 < TURBO_MS; i++) step(); turbo = true; }
            // cerne prodlevy nejvys asi 1 s (prani hrace 2026-10-23): je-li obraz cely cerny dele nez 25 snimku (vypocet hry, napr. rozbaleni
            // terminalu Intex ~245 snimku, nebo cekani na disketu), bezi hra 16 snimku na snimek displeje, dokud se obraz neobjevi
            else if (blackRun > BLACK_HOLD) { for (let i = 0; i < 15 && blackRun > BLACK_HOLD && performance.now() - t0 < TURBO_MS; i++) step(); turbo = true; }   // zrychleni jen do TURBO_MS prace na snimek displeje
            else if (turbo) { turbo = false; AUDIO.pause(); }
            if (presDemo >= 0 && cur && !cur.screen && !blackRun && lastNow && (presDemo += Math.max(0, Math.min(now - lastNow, 100))) >= PRES_DEMO_MS) setMode('enhanced');
            acc = now - stepClock;                                              // faze uvnitr snimku 0..20 ms od nominalniho casu kroku
        }
        lastNow = now;
        const anim = modeSample(now);
        // bez zmeny se neprekresluje: pauza a menu, Original bez plynuleho posunu mezi kroky; zmena nastaveni (applyDisplay) prekresli jednou
        if (!anim && !drawDirty && cur && cur === drawnCur && (paused || !(prefs.mode === 'enhanced' || prefs.smooth))) { requestAnimationFrame(draw); return; }
        drawDirty = false; drawnCur = cur;
        let vp = viewport(), sz = screenSize(), S = scaleInfo.S, par = scaleInfo.par || 1;   // backing muze byt o krok q sirsi nez obsah (1.3)
        if (anim) {   // prechod: vyrez a zoom animovane, backing = vetsi S obou rezimu, platno o celych pixelech nad animovanym vyrezem
            vp = { x0: anim.x0, y0: anim.y0, w: anim.w, h: anim.h, hud: true }; sz = screenSizeOf(vp); S = modeAnim.S;
            const fp = modeAnim.fromLook.par || 1; par = fp + ((prefs.par ? PAL_PAR : 1) - fp) * anim.e;   // pomer pixelu se prolina
            const cw = Math.ceil(sz.w * S * par), ch = Math.ceil(sz.h * S);
            if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
            gameEl.style.width = (cw / S * anim.z + 2) + 'px'; canvas.style.height = (sz.h * anim.z + 2) + 'px';
            // vzhled (4): rozmazani a knofliky se prolinaji, perioda CRT nikdy - do e < 0,5 vzor stareho rezimu (mel-li CRT), pak noveho;
            // --crt-on pri obou zapnutych klesne k 40 % a zase stoupne, jinak linearne
            const f = modeAnim.fromLook, g = lookOf(prefs.mode), e = anim.e, l = (k) => f[k] + (g[k] - f[k]) * e, old = e < .5 && f.on > 0;
            applyLook({ mode: old ? f.mode : g.mode, detail: old ? f.detail : g.detail, shape: old ? f.shape : g.shape, on: WBOBRAZ.crtOn(e, f.on, g.on), blur: l('blur'), brightness: l('brightness'), contrast: l('contrast'), saturation: l('saturation'), red: l('red'), green: l('green'), blue: l('blue'), par },
                sz.w, sz.h, anim.z, scaleInfo.dpr);
        }
        screen.align();   // poloha obsahu na celem pixelu zarizeni (1.4): i po zmene sirky behem prechodu nebo posuvniku stage
        const hudL = hudOf(vp), top = hudL.top;
        ctx.imageSmoothingEnabled = false; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.save(); if (par !== 1) ctx.setTransform(par, 0, 0, 1, 0, 0);   // pomer pixelu PAL: vse nize vodorovne natazene (souradnice dal v S)
        if (cur && cur.screen) {   // obrazovka mimo level: pozice 142 a radek 52 jako okno hry, nahore a dole to, co obrazovka ma (HUD se nekresli)
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(cur.screen, (SCR.h0 - 142 - vp.x0) * S, (top + SCR.l0 - 52 - vp.y0) * S, SCR.w * S, SCR.h * S);   // radek 52 = radek 0 okna hry pod HUD
        } else if (cur) {
            if (vp.hud && hudCanvas) {
                let img = hudCanvas, hw = WIN_W, hx = -vp.x0 * S, up = 1;   // Original: 293 px na miste okna hry
                const f = hudL.f, extra = Math.round(vp.w / f) - WIN_W;
                if (extra > 0 && hudRaw) {   // Vylepseno: pres celou sirku vyrezu, mezery mezi udaji roztazene (jako Superfrog)
                    const key = hudRev + ':' + extra;
                    if (hudWide.key !== key) {
                        const st = RENDER.hudStretch(hudRaw, WIN_W, HUD_TOP + HUD_BOT, extra);
                        if (!hudWide.canvas) hudWide.canvas = document.createElement('canvas');
                        hudWide.canvas.width = st.w; hudWide.canvas.height = HUD_TOP + HUD_BOT;
                        hudWide.canvas.getContext('2d').putImageData(new ImageData(st.rgba, st.w, HUD_TOP + HUD_BOT), 0, 0); hudWide.key = key;
                    }
                    img = hudWide.canvas; hw = img.width; hx = 0;
                }
                if (f !== 1) {   // zvetseni o necely nasobek: zdroj 4x nejblizsim sousedem, pak vyhlazene (ostre hrany bez nerovnych sloupcu)
                    const key = (img === hudCanvas ? 'o' : 'w') + hudRev + ':' + hw;
                    if (hudUp.key !== key) {
                        if (!hudUp.canvas) hudUp.canvas = document.createElement('canvas');
                        hudUp.canvas.width = hw * 4; hudUp.canvas.height = (HUD_TOP + HUD_BOT) * 4;
                        const c = hudUp.canvas.getContext('2d'); c.imageSmoothingEnabled = false; c.drawImage(img, 0, 0, hw * 4, (HUD_TOP + HUD_BOT) * 4); hudUp.key = key;
                    }
                    img = hudUp.canvas; up = 4; ctx.imageSmoothingEnabled = true;
                }
                ctx.drawImage(img, 0, 0, hw * up, HUD_TOP * up, hx, 0, hw * S * f, HUD_TOP * S * f);
                ctx.drawImage(img, 0, HUD_TOP * up, hw * up, HUD_BOT * up, hx, (top + vp.h) * S, hw * S * f, HUD_BOT * S * f);
                ctx.imageSmoothingEnabled = false;
            }
            ctx.save(); ctx.beginPath(); ctx.rect(0, top * S, vp.w * S, vp.h * S); ctx.clip();
            let ox = 0, oy = 0;
            if (prefs.smooth && prev && !paused && cur.n === prev.n + 1) {
                const alpha = Math.min(1, Math.max(0, acc / FRAME_MS));
                // zobrazena poloha = prev + (cur - prev) * alpha = cur - (cur - prev) * (1 - alpha): platno zachycene pri kamere cur
                // se posune o (cur - prev) * (1 - alpha) doprava (dx > 0 = pohyb vpravo); drive bylo znamenko obracene (pila 2,33 / -1,67 px)
                const dx = cur.camX - prev.camX, dy = cur.camY - prev.camY;
                if (Math.abs(dx) <= 8 && Math.abs(dy) <= 8) { ox = dx * (1 - alpha); oy = dy * (1 - alpha); }
            }
            const v = cur.view, enhanced = prefs.mode === 'enhanced' || !!anim;
            const bx = v.x0 - vp.x0, by = v.y0 - vp.y0;   // poloha zachyceneho vyrezu vuci zobrazenemu (normalne -MARGIN)
            const px = enhanced ? (ox + bx) * S : Math.round((ox + bx) * S), py = (enhanced ? (oy + by) * S : Math.round((oy + by) * S)) + top * S;
            meter.draws++;
            if (prev && (prev.camX !== cur.camX || prev.camY !== cur.camY)) {
                const sx = (cur.camX - ox) * S, sy = (cur.camY - oy) * S, shown = (enhanced ? sx.toFixed(2) : Math.round(sx)) + ',' + (enhanced ? sy.toFixed(2) : Math.round(sy));
                meter.moving++; if (shown === meter.lastShown) meter.dup++;
                if (meter.lastSx !== null && meter.lastNow !== null && now > meter.lastNow) {
                    const d = Math.abs(sx - meter.lastSx) + Math.abs(sy - meter.lastSy);          // posun v pixelech zarizeni
                    const vel = d / (now - meter.lastNow) * 1000 / S;                              // rychlost v lores px/s (ocekavano 100 = 2 px za 20 ms)
                    meter.deltas.push(Math.round(vel)); if (meter.deltas.length > 600) meter.deltas.shift();
                }
                meter.lastShown = shown; meter.lastSx = sx; meter.lastSy = sy; meter.lastNow = now;
            } else { meter.lastShown = null; meter.lastSx = meter.lastSy = null; meter.lastNow = null; }
            if (stats.spritePixels === 0) meter.spriteMissing++;
            ctx.imageSmoothingEnabled = enhanced;
            ctx.drawImage(cur.pf, px, py, v.w * S, v.h * S);
            // objekty (Vylepseno): poloha v case displeje T = n - 1 + alpha (jako kamera), bez interpolace T = n (zobrazeny stav)
            if (cur.objs.length || cur.ghosts.length) {
                const smooth = prefs.smooth && prev && !paused && cur.n === prev.n + 1, T = smooth ? cur.n - 1 + Math.min(1, Math.max(0, acc / FRAME_MS)) : cur.n;
                const wx0 = cur.camX - 3 + v.x0, wy0 = cur.camY + 68 + v.y0;
                for (const { g, img } of cur.ghosts) {   // zanikle v okraji: posledni podoba, posledni pohyb, ztmiva se (pod zivymi objekty)
                    const a = 1 - (T - g.s) / FADE_STEPS; if (a <= 0) continue;
                    const dt = T - (g.from + 1.5), O = RENDER.objectOrigin(g.o, g.o.wx + g.vx * dt, g.o.wy + g.vy * dt);
                    ctx.globalAlpha = Math.min(1, a); ctx.drawImage(img, (ox + bx + O.X - wx0) * S, (oy + by + O.Y - wy0) * S + top * S, img.width * S, img.height * S);
                }
                ctx.globalAlpha = 1;
                for (let i = cur.objs.length - 1; i >= 0; i--) {   // hra kresli seznam od konce: prvni je navrchu
                    const { o, img } = cur.objs[i], P = smooth ? objectPosAt(o.rec, T, { x: o.wx, y: o.wy }) : { x: o.wx, y: o.wy };
                    const O = RENDER.objectOrigin(o, P.x, P.y), x = (ox + bx + O.X - wx0) * S, y = (oy + by + O.Y - wy0) * S + top * S;
                    const a = o.preview ? 1 : objAlpha(o.rec, T); if (a <= 0) continue;
                    ctx.globalAlpha = a; ctx.drawImage(img, x, y, img.width * S, img.height * S); ctx.globalAlpha = 1;
                    if (objTrace.on) { objTrace.list.push([now, o.rec, (O.X - (cur.camX - ox) ), (O.Y - (cur.camY - oy))]); if (objTrace.list.length > 4000) objTrace.list.shift(); }   // svetova poloha zobrazena v case now
                }
                stats.objDrawn = cur.objs.length;
            }
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(cur.sp, bx * S, (top + by) * S, v.w * S, v.h * S);
            ctx.restore();
            if ((stats.frames & 15) === 0) $('frame-status').textContent = 'Krok ' + steps + ', hráč (' + cur.px + ', ' + cur.py + '), kamera (' + cur.camX + ', ' + cur.camY + '), krok ' + stats.stepMs.toFixed(2) + ' ms, obraz ' + stats.renderMs.toFixed(2) + ' ms, blitů ' + core._core_blits() + '; plynulost: ' + meter.dup + ' dvojitých z ' + meter.moving + ' pohybových snímků, sprite chyběl ' + meter.spriteMissing + '×, backing ' + scaleInfo.S + '× při dpr ' + scaleInfo.dpr + '.';
        }
        ctx.restore();   // transformace PAL jen pro snimek hry (testovaci vzor kontraktu kresli bez ni)
        requestAnimationFrame(draw);
    }
    function start() { if (!core || !seedMeta) return; $('intro').hidden = true; gameEl.hidden = false; running = true; paused = false; manualPause = false; lastNow = performance.now(); stepClock = lastNow; acc = 0; applyDisplay(); capture(); canvas.focus(); requestAnimationFrame(draw); }
    async function restart() { presEnded = false; await loadCore(); loadSeed(); AUDIO.reset(); cur = prev = null; scrState = null; blackRun = 0; capture(); shell.message(skipIntro() ? 'Level 1 od začátku (start z dat disket).' : 'Hra od začátku (nahrávací obrazovka).'); }
    // ---- pozice (savestate, 2026-10-22): hra mezi kroky spi v korutine jadra a jeji zasobnik je v pameti WebAssembly, takze stav = cela pamet
    // jadra + par udaju stranky. Nahrani: nove jadro (po startu spi na stejnem miste), prepis pameti a adresa dat uspane korutiny
    // (Asyncify.currData, z pozice: drobna alokace navic ji posune); overeno: dalsi beh shodny bajt po bajtu (tools/nativegametest.py). Format souboru .absave: gzip("ABSV" + delka hlavicky (u32 LE) + hlavicka JSON + pamet).
    const SAVE_DB = 'ab-native-saves', SAVE_VER = 2;
    function idb() { return new Promise((ok, ko) => { const r = indexedDB.open(SAVE_DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('slots'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); }); }
    async function idbDo(mode, fn) { const db = await idb(); return new Promise((ok, ko) => { const tx = db.transaction('slots', mode), q = fn(tx.objectStore('slots')); tx.oncomplete = () => ok(q && q.result); tx.onerror = () => ko(tx.error); }); }
    async function gz(u8, de) { const cs = de ? new DecompressionStream('gzip') : new CompressionStream('gzip'); return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(cs)).arrayBuffer()); }
    function stateHeader() { const st = window.abg.state(); return { ver: SAVE_VER, core: coreId, async: core.Asyncify.currData, steps, disk: { ...disk }, level: disk.level + 1, module: core._core_module(), px: st && st.px, py: st && st.py, time: new Date().toISOString() }; }
    async function packState() {
        const head = new TextEncoder().encode(JSON.stringify(stateHeader())), heap = core.HEAPU8, out = new Uint8Array(8 + head.length + heap.length);
        out.set([0x41, 0x42, 0x53, 0x56]); new DataView(out.buffer).setUint32(4, head.length, true); out.set(head, 8); out.set(heap, 8 + head.length);
        return gz(out);
    }
    async function unpackState(blob) {
        const u = await gz(blob, true);
        if (u[0] !== 0x41 || u[1] !== 0x42 || u[2] !== 0x53 || u[3] !== 0x56) throw new Error('neni soubor pozice (.absave)');
        const n = new DataView(u.buffer).getUint32(4, true), head = JSON.parse(new TextDecoder().decode(u.subarray(8, 8 + n)));
        return { head, heap: u.subarray(8 + n) };
    }
    async function applyState({ head, heap }) {
        if (head.core !== coreId) throw new Error('pozice je z jiného sestavení jádra (' + head.core + ', teď ' + coreId + ')');
        if (head.ver !== SAVE_VER || !head.async) throw new Error('stará verze pozice');
        await loadCore(); loadSeed();                       // nove jadro uspane v prvnim snimku
        if (heap.length !== core.HEAPU8.length) throw new Error('jiná velikost paměti jádra');
        core.HEAPU8.set(heap);
        core.Asyncify.currData = head.async;               // data uspane korutiny z pozice (adresa se mezi instancemi muze lisit)
        core._core_set_anim_always(animAlways() ? 1 : 0);  // volba stranky, ne stav z pozice
        steps = head.steps; Object.assign(disk, head.disk); disk.intro = !!(head.disk && head.disk.intro); worldState.diskMap = NATIVE_DATA.level(adf2, disk.level).map;
        objHist = []; objBorn.clear(); objGhosts = []; faultShown = false; AUDIO.reset(); cur = prev = null; scrState = null; blackRun = 0; held.clear();
        if (!running) start(); else { stepClock = performance.now(); acc = 0; capture(); }
    }
    const describe = (h) => h ? 'level ' + h.level + (h.module ? ', obrazovka ' + h.module : '') + ', hráč (' + h.px + ', ' + h.py + '), ' + new Date(h.time).toLocaleString('cs-CZ') : 'prázdná';
    async function saveSlot(k) {
        if (!core || !running) { shell.message('Pozici lze uložit až během hry'); return; }
        const data = await packState(); await idbDo('readwrite', (st) => st.put({ head: stateHeader(), data }, 'slot' + k));
        shell.message('Pozice ' + k + ' uložena (' + (data.length / 1048576).toFixed(1) + ' MB)'); refreshSlots();
    }
    async function backupNow() { return core && running ? { head: stateHeader(), data: await packState() } : null; }   // pozice 0 = stav pred poslednim nahranim
    async function loadSlot(k) {
        try {
            const rec = await idbDo('readonly', (st) => st.get('slot' + k)); if (!rec) { shell.message(k ? 'Pozice ' + k + ' je prázdná' : 'Není co vrátit'); return; }
            const backup = k ? await backupNow() : null;
            await applyState(await unpackState(rec.data));
            if (backup) await idbDo('readwrite', (st) => st.put(backup, 'slot0'));
            shell.message((k ? 'Nahrána pozice ' + k : 'Vrácen stav před nahráním') + ': ' + describe(rec.head));
        } catch (e) { shell.message('Pozici nelze nahrát: ' + e.message); log('pozice: ' + e.message); }
    }
    async function refreshSlots() {
        for (const k of [1, 2, 3]) { const rec = await idbDo('readonly', (st) => st.get('slot' + k)).catch(() => null); const el = $('slot-info-' + k); if (el) el.textContent = describe(rec && rec.head); }
    }
    async function downloadState() {
        if (!core || !running) { shell.message('Pozici lze uložit až během hry'); return; }
        const h = stateHeader(), data = await packState(), a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' })); a.download = 'alienbreed-level' + h.level + '-' + h.time.replace(/[:.]/g, '-') + '.absave'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000); shell.message('Pozice stažena do souboru');
    }
    async function loadStateFile(blob, label) {
        try { const s = await unpackState(new Uint8Array(await blob.arrayBuffer())), backup = await backupNow(); await applyState(s); if (backup) await idbDo('readwrite', (st) => st.put(backup, 'slot0')); shell.message('Nahrána pozice ' + label + ': ' + describe(s.head)); }
        catch (e) { shell.message('Pozici nelze nahrát: ' + e.message); log('pozice: ' + e.message); }
    }
    function setMode(m) {
        presDemo = -1;
        if (m === prefs.mode && !modeAnim) return;
        const now = performance.now(), from = shownVisual(now), fromMode = modeAnim ? (modeSample(now) && modeAnim.e < .5 ? modeAnim.fromMode : prefs.mode) : prefs.mode;
        const fromLook = lastLook ? { ...lastLook } : lookOf(fromMode), fromVp = modeAnim ? captureViewport() : viewport();
        prefs.mode = m; savePrefs();   // held se nemaze: drzena sipka by po stisku E uz neprisla znovu (opakovani patri E) a hrac by stal
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const toVp = viewport(), zt = zoomFor(toVp, prefs.zoom, prefs.par ? PAL_PAR : 1), zf = zoomFor(fromVp, prefs.views[fromMode].zoom, prefs.views[fromMode].par ? PAL_PAR : 1);
        if (running && !reduce) {
            modeAnim = { from, to: { x0: toVp.x0, y0: toVp.y0, w: toVp.w, h: toVp.h, z: zt.z }, fromVp: VIEWPORTS.w448, toVp, start: now, S: Math.max(zt.S, zf.S, scaleInfo.S), fromMode, fromLook };
            gameEl.classList.add('mode-changing');   // bez CSS prechodu: --crt-on ridi animace (4)
            if (cur) capture();
        } else { modeAnim = null; applyDisplay(); }
        updateControls();
        const vp = viewport(); shell.message(m === 'enhanced' ? 'Vylepšeno: hrací plocha ' + vp.w + ' × ' + vp.h + ' + HUD' : 'Originál: okno hry 293 × 240 + HUD'); }
    // ---- ovladani ----
    $('intro-start').addEventListener('click', start);
    $('skip-intro').checked = skipIntro();
    $('fast-intro').checked = fastIntro();
    $('anim-always').checked = animAlways();
    $('anim-always').addEventListener('change', (e) => { try { localStorage.setItem(ANIM_KEY, e.target.checked ? 'always' : 'orig'); } catch (x) { /* bez ulozeni */ } if (core) core._core_set_anim_always(e.target.checked ? 1 : 0); });
    $('fast-intro').addEventListener('change', (e) => { try { localStorage.setItem(FAST_KEY, e.target.checked ? 'fast' : 'orig'); } catch (x) { /* bez ulozeni */ } });
    $('skip-intro').addEventListener('change', async (e) => { try { localStorage.setItem(INTRO_KEY, e.target.checked ? 'skip' : 'intro'); } catch (x) { /* bez ulozeni */ } $('intro-start').disabled = true; await restart(); });
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) mouseDown = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
    $('mode-original').addEventListener('click', () => setMode('original')); $('mode-enhanced').addEventListener('click', () => setMode('enhanced'));
    for (const k of KNOBS.concat(CHANNELS)) $(k).addEventListener('input', () => { prefs[k] = parseInt($(k).value, 10); savePrefs(); applyDisplay(); });
    // vychozi obraz zvoleneho rezimu: vsechno nastaveni obrazu toho rezimu (zoom, CRT, rozmazani, plynuly posun, ovladace monitoru, kanaly)
    $('look-reset').addEventListener('click', () => { Object.assign(prefs.views[prefs.mode], VIEW_DEFAULTS[prefs.mode]); savePrefs(); applyDisplay(); shell.message(PRES ? 'Default picture for ' + (prefs.mode === 'enhanced' ? 'Enhanced' : 'Original') : 'Výchozí obraz režimu ' + (prefs.mode === 'enhanced' ? 'Vylepšeno' : 'Originál')); });
    $('smooth').addEventListener('change', () => { prefs.smooth = $('smooth').checked; savePrefs(); });
    $('zoom').addEventListener('input', () => { prefs.zoom = parseFloat($('zoom').value); savePrefs(); applyDisplay(); });
    for (const b of document.querySelectorAll('[data-zoom]')) b.addEventListener('click', () => { prefs.zoom = parseFloat(b.dataset.zoom); savePrefs(); applyDisplay(); });
    $('par').addEventListener('change', () => { prefs.par = $('par').checked; savePrefs(); applyDisplay(); });
    $('crt').addEventListener('change', () => { prefs.crt = $('crt').checked; savePrefs(); applyDisplay(); });
    $('crt-detail').addEventListener('change', () => { prefs.crtDetail = $('crt-detail').value; savePrefs(); applyDisplay(); });
    $('crt-shape').addEventListener('change', () => { prefs.crtShape = $('crt-shape').value; savePrefs(); applyDisplay(); });
    $('blur').addEventListener('input', () => { prefs.blur = parseInt($('blur').value, 10); savePrefs(); applyDisplay(); });
    $('sound').checked = sound.on; $('volume').value = Math.round(sound.volume * 100);
    $('sound').addEventListener('change', () => { sound.on = $('sound').checked; saveSound(); AUDIO.setEnabled(sound.on); unlockAudio(); });
    $('volume').addEventListener('input', () => { sound.volume = parseInt($('volume').value, 10) / 100; saveSound(); AUDIO.setVolume(sound.volume); });
    document.addEventListener('pointerdown', unlockAudio);
    document.addEventListener('visibilitychange', () => { if (document.hidden) AUDIO.pause(); });
    function togglePause() { manualPause = !manualPause; paused = manualPause; if (paused) AUDIO.pause(); if (!paused) stepClock = performance.now(); shell.message(paused ? 'Pauza' : 'Pokračuje'); }
    if ($('pause-game')) $('pause-game').addEventListener('click', togglePause);
    // ovladac: hlaseni pri pripojeni a odpojeni, volba ovladace a tlacitka Fire v menu Hra (jen stranka s menu; ulozeno v ab-native-pad)
    function padUi() {
        const sel = $('pad-select'), fire = $('pad-fire'); if (!(sel instanceof HTMLSelectElement) || !(fire instanceof HTMLSelectElement) || !PADS) return;   // stranka bez menu ovladace (prezentace)
        const pads = Array.from((navigator.getGamepads && navigator.getGamepads()) || []).filter((p) => p && p.connected !== false);
        sel.replaceChildren(new Option('Automaticky (první připojený)', 'auto'), ...pads.map((p) => new Option((p.index + 1) + ': ' + p.id.slice(0, 48) + (p.mapping === 'standard' ? '' : ' (bez standardního rozložení)'), String(p.index))));
        sel.value = [...sel.options].some((o) => o.value === PADS.preferred) ? PADS.preferred : 'auto';
        const pad = pads.find((p) => String(p.index) === sel.value) || pads[0], n = pad ? pad.buttons.length : 0;
        fire.replaceChildren(new Option('Automaticky', 'auto'), ...Array.from({ length: n }, (_, i) => new Option('Tlačítko ' + (i + 1), String(i))));
        fire.value = [...fire.options].some((o) => o.value === PADS.fireButton) ? PADS.fireButton : 'auto'; fire.disabled = !pad;
        $('pad-status').textContent = pads.length ? 'Připojeno: ' + pads.length : 'Žádný ovladač (stiskni na něm tlačítko)';
    }
    const savePad = () => { try { localStorage.setItem(PAD_KEY, JSON.stringify({ pad: PADS.preferred, fire: PADS.fireButton })); } catch (e) { /* bez ulozeni */ } };
    if ($('pad-select') instanceof HTMLSelectElement) { $('pad-select').addEventListener('change', (e) => { PADS.preferred = e.target.value; savePad(); padUi(); }); $('pad-fire').addEventListener('change', (e) => { PADS.fireButton = e.target.value; savePad(); }); padUi(); }
    window.addEventListener('gamepadconnected', (e) => { shell.message((PRES ? 'Controller connected: ' : 'Ovladač připojen: ') + e.gamepad.id.slice(0, 40)); padUi(); });
    window.addEventListener('gamepaddisconnected', (e) => { shell.message((PRES ? 'Controller disconnected: ' : 'Ovladač odpojen: ') + e.gamepad.id.slice(0, 40)); padUi(); });
    $('reset').addEventListener('click', () => { restart(); });
    for (const k of [1, 2, 3]) { $('save-' + k).addEventListener('click', () => saveSlot(k)); $('load-' + k).addEventListener('click', () => loadSlot(k)); }
    $('load-0').addEventListener('click', () => loadSlot(0));
    $('save-file').addEventListener('click', () => downloadState());
    $('load-file').addEventListener('click', () => $('load-file-input').click());
    $('load-file-input').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) loadStateFile(f, f.name); e.target.value = ''; });
    $('load-lift').addEventListener('click', async () => { const r = await fetch('local/pred_vytahem.absave', { cache: 'no-store' }); if (r.ok) loadStateFile(await r.blob(), 'před výtahem'); });
    if (!PRES) fetch('local/pred_vytahem.absave', { method: 'HEAD', cache: 'no-store' }).then((r) => { $('load-lift').hidden = !r.ok; }).catch(() => {});
    if (window.indexedDB) refreshSlots().catch(() => {});
    $('fullscreen').addEventListener('click', () => { const el = $('shell'); if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); });
    // sirka stage meni strop S (i u explicitniho zoomu) a centrovani polohu obsahu (1.4)
    window.addEventListener('resize', () => applyDisplay()); document.addEventListener('fullscreenchange', () => applyDisplay());
    const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyX', 'ControlLeft', 'ControlRight', 'Space']);
    document.addEventListener('keydown', (e) => {
        if (WbMenu.editable(e.target) || e.metaKey || e.altKey || shell.busy) return;
        unlockAudio();
        if (GAME_KEYS.has(e.code)) { held.add(e.code); e.preventDefault(); return; }
        if (e.code === 'KeyE') { if (!e.repeat) setMode(prefs.mode === 'enhanced' ? 'original' : 'enhanced'); }
        else if (PRES && e.code === 'KeyH') PRES.help();
        else if (e.code === (PRES ? 'KeyM' : 'KeyS')) { $('sound').checked = !$('sound').checked; $('sound').dispatchEvent(new Event('change')); shell.message(sound.on ? 'Zvuk zapnut' : 'Zvuk vypnut'); }
        else if (e.code === 'KeyP') togglePause();
        else if (e.code === 'KeyR') $('reset').click();
        else if (e.code === 'KeyF') $('fullscreen').click();
        else if (!PRES && /^Digit[1-3]$/.test(e.code) && !e.repeat) { const k = +e.code.slice(5); if (e.shiftKey) saveSlot(k); else loadSlot(k); }
    });
    document.addEventListener('keyup', (e) => held.delete(e.code));
    window.addEventListener('blur', () => held.clear());
    // ---- testovaci rozhrani ----
    // ---- verze stranky (tools/serve.py /__version): pri zmene souboru ve web/ se stranka sama obnovi (jako index.html) ----
    if (!PRES) (async () => {
        const read = async () => { try { const r = await fetch('__version', { cache: 'no-store' }); return r.ok ? (await r.text()).trim() : null; } catch (e) { return null; } };
        const v0 = await read();
        if (v0) setInterval(async () => { const v = await read(); if (v && v !== v0) { log('nová verze souborů, obnovuji stránku'); location.reload(); } }, 2000);
    })();
    window.abg = {
        ready: () => !!(core && seedMeta), prefs, applyDisplay, start, steps: () => steps, input: () => joystick(), pad: () => PAD && { ...PAD, pad: undefined },
        fault: () => ({ at: core._core_fault() >>> 0, pc: core._core_fault_pc() >>> 0, module: core._core_module() }),
        state: () => cur && { n: cur.n, px: cur.px, py: cur.py, camX: cur.camX, camY: cur.camY, module: core._core_module(), level: !cur.screen },
        bootlog: () => core.UTF8ToString(core._core_bootlog()),
        audio: () => ({ ...AUDIO.state(), ...sound }), audioStats: () => AUDIO.stats(), audioPcm: () => AUDIO.pcm(),
        boot: () => seedMeta && { exit: seedMeta.exit, ticks: seedMeta.ticks, px: seedMeta.px, py: seedMeta.py },
        stepN: (n, keys) => { held.clear(); for (const k of (keys || [])) held.add(k); for (let i = 0; i < n; i++) step(); held.clear(); return window.abg.state(); },
        slowHash: async () => { const h = await crypto.subtle.digest('SHA-256', mem.subarray(SLOWOFF, SLOWOFF + 0x80000)); return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join(''); },
        slowHashMasked: async () => { const c = new Uint8Array(mem.subarray(SLOWOFF, SLOWOFF + 0x80000)); c.fill(0, 0xe99e, 0xe9a2); const h = await crypto.subtle.digest('SHA-256', c); return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join(''); },
        setKb: (a, b) => { mem[SLOWOFF + 0x21208] = a; mem[SLOWOFF + 0x21209] = b; },
        setInput: (joy1, pra, sdr) => { core._core_input(0, joy1, pra, sdr, 0); wake(); steps++; objStep(); capture(); return window.abg.state(); },
        pause: (p) => { manualPause = paused = !!p; if (!p) stepClock = performance.now(); }, stats: () => ({ ...stats, steps }), viewport,
        meter: () => { const d = meter.deltas.slice(); const uniq = {}; for (const x of d) uniq[x] = (uniq[x] || 0) + 1; return { draws: meter.draws, moving: meter.moving, dup: meter.dup, spriteMissing: meter.spriteMissing, deltas: uniq, scale: scaleInfo, backing: [canvas.width, canvas.height], css: [canvas.clientWidth, canvas.clientHeight], stage: $('stage').clientWidth }; },
        fades: () => ({ ...fadeStats, log: fadeLog.slice(), live: objBorn.size, ghostsNow: objGhosts.length, fadeSteps: FADE_STEPS }),
        saveState: () => packState(), loadState: async (u8) => applyState(await unpackState(u8)), coreId: () => coreId,
        resetMeter: () => { meter.draws = meter.moving = meter.dup = meter.spriteMissing = 0; meter.lastShown = null; meter.deltas = []; meter.lastSx = meter.lastSy = meter.lastNow = null; },
        // kontrakt modelu objektu (tools/nativegametest.py): nsteps kroku s klavesami, po kazdem kroku pocet pixelu okna, ktere teren z mapy
        // + objekty ze zaznamu v zobrazene poloze nevysvetli (radky < 236, bez sloupce 0 pri posunu 14), a pixely objektu v okraji vyrezu
        objectCheck: (nsteps, keys) => {
            held.clear(); for (const k of (keys || [])) held.add(k);
            let unknown = 0, frames = 0, maxObj = 0, marginObjPx = 0, worst = 0;
            for (let i = 0; i < nsteps; i++) {
                step(); if (!cur || prefs.mode !== 'enhanced') continue;
                frames++; unknown += stats.unknownPx || 0; worst = Math.max(worst, stats.unknownPx || 0); maxObj = Math.max(maxObj, stats.objects || 0);
                const sh = shownObjects(steps); if (!sh) continue;
                const v = cur.view, buf = new Uint8Array(v.w * v.h), cov = new Uint8Array(v.w * v.h);
                RENDER.drawObjects(sh.objs, mem.subarray(0, CHIP), cur.camX - 3 + v.x0, cur.camY + 68 + v.y0, v.w, v.h, buf, cov);
                for (let vy = 0; vy < v.h; vy++) for (let vx = 0; vx < v.w; vx++) { const wx = vx + v.x0, wy = vy + v.y0; if (cov[vy * v.w + vx] && !(wx >= 0 && wx < 293 && wy >= 0 && wy < 240) && wx >= -78 && wx < 370 && wy >= -8 && wy < 248) marginObjPx++; }
            }
            held.clear();
            return { frames, unknown, worst, maxObj, marginObjPx, state: window.abg.state() };
        },
        terrainDiff: () => {   // ladeni: bunky mapy v okne, kde se teren z mapy lisi od bufferu hry (objekty, animace, jine zdroje dlazdic)
            if (!cur) return null; const view = cur.view, camX = cur.camX, camY = cur.camY, cells = {};
            const terrBuf = new Uint8Array(view.w * view.h); RENDER.renderWorld(worldState, mem.subarray(SLOWOFF, SLOWOFF + 0x80000), 0xc00000, camX - 3 + view.x0, camY + 68 + view.y0, view.w, view.h, terrBuf);
            for (let wy = 0; wy < 240; wy++) for (let wx = 0; wx < 293; wx++) {
                const t = terrBuf[(wy - view.y0) * view.w + (wx - view.x0)], w = winBuf[wy * 293 + wx]; if (t === w) continue;
                const cx = (camX - 3 + wx) >> 4, cy = (camY + 68 + wy) >> 4, k = cy + ',' + cx;
                if (!cells[k]) { const o = SLOWOFF + 0x47288 + (cy * 124 + cx) * 2, word = (mem[o] << 8) | mem[o + 1]; cells[k] = { cell: [cy, cx], tile: word >> 6, type: word & 63, n: 0 }; }
                cells[k].n++;
            }
            return Object.values(cells).sort((a, b) => b.n - a.n); },
        winEdges: () => { const W = 293, H = 240, cols = [], rows = []; if (!winBuf) return null;
            for (const x of [0, 1, 2, 3, 4, 288, 289, 290, 291, 292]) { let z = 0; for (let y = 0; y < H; y++) if (!winBuf[y * W + x]) z++; cols.push([x, z]); }
            for (const y of [0, 1, 2, 3, 236, 237, 238, 239]) { let z = 0; for (let x = 0; x < W; x++) if (!winBuf[y * W + x]) z++; rows.push([y, z]); }
            return { cols, rows }; },
        blitlog: () => { const k = core._core_blitlog_count(); return Array.from(new Uint32Array(core.HEAPU8.buffer, core._core_blitlog(), k * 16)); },   // ladeni/testy
        setMode, applyDisplay, objTrace: (on) => { if (on !== undefined) { objTrace.on = !!on; objTrace.list = []; } return objTrace.list; },
        // diagnostika obrazu (wb-shell obraz 1.2, 5.6; tools/obraztest.py): backing, obsah, S, poloha obsahu a vrstvy CRT v pixelech zarizeni, P a D
        display: () => { const info = screen.info(), dpr = window.devicePixelRatio || 1, sz = screenSize(); return { mode: prefs.mode, anim: !!modeAnim,
            e: modeAnim ? smoothstep(Math.max(0, Math.min(1, (performance.now() - modeAnim.start) / MODE_MS))) : null, size: [sz.w, sz.h], w0: W0,
            backing: [canvas.width, canvas.height], content: [canvas.clientWidth, canvas.clientHeight], dpr, scale: { ...scaleInfo }, S: scaleInfo.S, par: scaleInfo.par, wish: prefs.zoom, limit: scaleInfo.limit, zoom: scaleInfo.zoom,
            ...info, crtPx: info.crtP / dpr, crtDark: info.crtD / dpr, filter: canvas.style.filter,
            views: JSON.parse(JSON.stringify(prefs.views)), stored: (() => { try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { return null; } })() }; },
        testFill: (color) => { ctx.fillStyle = color; ctx.fillRect(0, 0, canvas.width, canvas.height); },   // jen testy: plocha jedne barvy pod CRT (5.4)
        poke: (addr, bytes) => { const o = addr >= 0xc00000 ? addr - 0xc00000 + SLOWOFF : addr; mem.set(bytes, o); },   // jen testy (laboratorni cheaty)
        peek: (addr, len) => Array.from(mem.subarray(addr >= 0xc00000 ? addr - 0xc00000 + SLOWOFF : addr, (addr >= 0xc00000 ? addr - 0xc00000 + SLOWOFF : addr) + len)),
        wrlog: () => { const w = core.HEAPU8.subarray(core._core_wrlog() + 0x28000, core._core_wrlog() + 0x48000); const out = []; for (let i = 0; i < w.length; i++) if (w[i]) out.push(i + 0x28000, w[i]); return out; },
        copper: () => { const c = RENDER.parseCopper(mem.subarray(0x1000, 0x5000), 0x1000); return { level: c.level, diw: c.diw, sets: c.sets.map(x => ({ line: x.line, con0: x.con0, con1: x.con1, ptrs: x.ptrs })) }; },
    };
    // testovaci hacky obrazoveho kontraktu wb-shell obraz 1.3 (arek web test URL, WB-OBRAZ-CRT.md 5): herni okno bez startu hry,
    // set(mode, {zoom, crtDetail, crtShape, crt, blur}) -> info, fill('grey'|'rows'|'cols') = WBOBRAZ.testPattern do obsahu W*S x H*S (zbytek cerny)
    function wbTestInfo() { const sz = screenSize(), S = scaleInfo.S; return Object.assign(screen.info(), { scale: S, dpr: scaleInfo.dpr, W: sz.w, H: sz.h, P: scaleInfo.crt.P, D: scaleInfo.crt.D, content: [sz.w * S, sz.h * S], backing: [canvas.width, canvas.height] }); }
    function wbTestPaint() { if (wbTest) { const sz = screenSize(); WBOBRAZ.testPattern(canvas, wbTest, sz.w, sz.h, scaleInfo.S); } }   // 'grey' | 'rows' | 'cols'
    window.wbObrazTest = {
        set(mode, cfg) { presDemo = -1; $('intro').hidden = true; gameEl.hidden = false; prefs.mode = mode; for (const [k, v] of Object.entries(cfg || {})) if (VIEW_KEYS.includes(k)) prefs[k] = v; applyDisplay(); wbTestPaint(); return wbTestInfo(); },
        fill(kind) { wbTest = kind; gameEl.classList.add('no-vignette'); wbTestPaint(); return true; },
    };
    applyDisplay();
    if (PRES) {   // prezentace: nejdriv diskety (klic zapeceteneho jadra), pak jadro, start levelu 1 rovnou
        const msg0 = shell.message.bind(shell); shell.message = (m) => msg0(PRES.tr(m));
        window.abg.present = async () => { await loadDisks(); await loadCore(); loadSeed(); if (presDemo >= 0) { prefs.mode = 'original'; applyDisplay(); updateControls(); } start(); };
        window.abg.restart = restart;
    } else (async () => { try { await loadCore(); await loadDisks(); loadSeed(); } catch (e) { log('CHYBA: ' + e.message); $('status').textContent = 'Chyba: ' + e.message; } })();
})();
