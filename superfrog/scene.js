// Plynulé vykreslení: terén z mapy levelu v poloze kamery interpolované mezi dvěma snímky hry, objekty (BOBy) ve světě a sprity na obrazovce
// (balíček scény z engine/scene.c, docs/M9-SCENA.md). Bez herních dat v kódu; mapa i balíčky přicházejí z workeru (z disket uživatele).
export const PK_HDR = 448, GW = 336, GH = 262, TOP = 15, MX = 56, MY = 16, BW = GW + 2 * MX, BH = GH + 2 * MY;
export const WW = BW + 1, WH = BH + 1;   // buffer světa (terén + objekty) o sloupec a řádek větší než výřez
export const OL_PAD = 32, OL_W = GW + 2 * MX + 2 * OL_PAD, OL_H = GH - TOP + 2 * MY + 2 * OL_PAD, OL_MAX = 64;   // vrstva objektů (engine/scene.c)
export const PK_OL = PK_HDR + GW * GH + GW * GH * 4, PK_OBJT = PK_OL + OL_W * OL_H * 2;
export const PK_CELLS = PK_OBJT + OL_MAX * 12, MAP_COLS = 304, PK_SIZE = PK_CELLS + 128 * MAP_COLS * 2, MAP_W = MAP_COLS * 16, MAP_BYTES = 1024 * 256, SLOTS = 6;   // MAP_BYTES = atlas dlaždic
const FRAME_MS = 20, LAT = 28, LATO = 48, JUMP = 40;           // snímek hry 50 Hz; objekty (logika 25 Hz) o 20 ms víc; větší skok kamery (teleport, nový level) se neinterpoluje

export class SceneRenderer {
  constructor(scn, map, ctl) {
    this.scn = scn; this.map = new Uint8Array(map); this.ctl = ctl;
    this.slots = Array.from({ length: SLOTS }, (_, i) => ({ h: new Uint32Array(scn, i * PK_SIZE, 16), ts: new Float64Array(scn, i * PK_SIZE + 48, 1), inst: new Uint32Array(scn, i * PK_SIZE + 192, 64), ol: new Uint16Array(scn, i * PK_SIZE + PK_OL, OL_W * OL_H), objt: new Int32Array(scn, i * PK_SIZE + PK_OBJT, OL_MAX * 3), cells: new Uint16Array(scn, i * PK_SIZE + PK_CELLS, 128 * MAP_COLS), pal: new Uint32Array(scn, i * PK_SIZE + 64, 32), bob: new Uint8Array(scn, i * PK_SIZE + PK_HDR, GW * GH), spr: new Uint32Array(scn, i * PK_SIZE + PK_HDR + GW * GH, GW * GH) }));
    this.seq = 0; this.t = 0; this.palMix = new Uint32Array(32); this.shift = new Int32Array(130); this.oshift = new Int32Array(2 * OL_MAX); this.passStart = new Map(); this.stats = { smooth: 0, fallback: 0, why: {} };
  }
  // balíček snímku `seq - k` (platný, stejná mapa jako nejnovější), jinak null
  slot(k) { if (this.seq - k < 1) return null; const p = this.slots[(this.seq - k) % SLOTS]; return p.h[0] === 1 ? p : null; }
  // zapíše herní řádky (od TOP) do world32 (WW × WH) a sprity do ovl32 (BW × BH, 0 = průhledné); vrací {fx, fy} (zbytek polohy kamery) nebo false; nowMs = performance.timeOrigin + performance.now(); wide = medailonek v rohu širokého výřezu
  // Čas zobrazení tau = now - LAT leží mezi časy dvou po sobě jdoucích snímků hry (A, B); poloha kamery se mezi nimi interpoluje, objekty a sprity jsou z bližšího snímku.
  draw(world32, ovl32, med32, nowMs, wide, opt = { pal: true, spr: true }) {
    this.seq = Atomics.load(this.ctl, 8); let C = this.slot(0);
    // jediný neplatný snímek uprostřed hry (např. ukazatel bitplanu mimo buffery): podržet poslední platný, místo přepnutí na původní obraz (bliknutí)
    if (!C && this.seq > 0 && this.slots[this.seq % SLOTS].h[7] < 100) for (let k = 1; k <= 3 && !C; k++) { const q = this.slot(k); if (q) { C = q; this.stats.held = (this.stats.held || 0) + 1; } }
    if (!C || !Atomics.load(this.ctl, 9)) { this.stats.fallback++; const raw = this.slots[this.seq % SLOTS]; if (this.seq > 0) { const w = raw.h[0] === 1 ? 9 : raw.h[7]; this.stats.why[w] = (this.stats.why[w] || 0) + 1; } return false; }
    const tau = nowMs - LAT; let A = null, B = C, f = 1;
    for (let k = 0; k < 3 && C === this.slot(0); k++) {
      const b = this.slot(k), a = this.slot(k + 1); if (!b || !a) break;
      if (a.ts[0] <= tau && tau <= b.ts[0] + 1) { A = a; B = b; f = Math.min(1, Math.max(0, (tau - a.ts[0]) / Math.max(1, b.ts[0] - a.ts[0]))); break; }
      if (tau > b.ts[0]) break;                      // zdržení: držíme nejnovější
    }
    let oxf = B.h[1] | 0, oyf = B.h[2] | 0, K = B;
    if (A && !(Math.abs((A.h[1] | 0) - oxf) < JUMP && Math.abs((A.h[2] | 0) - oyf) < JUMP)) A = null;
    if (A) {
      const px = A.h[1] | 0, py = A.h[2] | 0;
      oxf = px + (oxf - px) * f; oyf = py + (oyf - py) * f;
      if (f < 0.5) K = A;
    }
    // Rozšířený výřez se u kraje mapy zastaví: obsah (terén, objekty, sprity) se posune, HUD a medailonek zůstanou (vsx, vsy = posun v herních px)
    let vsx = 0, vsy = 0, vfx = 0, vfy = 0;
    if (wide) {
      const rows = K.h[4] * 16, cx = Math.min(Math.max(oxf, MX), MAP_W - GW - MX), cy = Math.min(Math.max(oyf, MY), rows - (GH - TOP) - MY);
      vsx = Math.round(cx - oxf); vsy = Math.round(cy - oyf); vfx = cx - oxf - vsx; vfy = cy - oyf - vsy; oxf = cx; oyf = cy;
    }
    // poloha kamery v necelých herních pixelech: celá část se vykreslí do bufferu světa, zbytek (fx, fy) posune celý buffer při zobrazení (pixely zařízení)
    const ox = Math.floor(oxf), oy = Math.floor(oyf), fx = oxf - ox, fy = oyf - oy, kox = K.h[1] | 0, koy = K.h[2] | 0;
    this.lastOrigin = [+oxf.toFixed(2), +oyf.toFixed(2), +f.toFixed(2), K === B ? 'B' : 'A', Math.round(nowMs - C.ts[0])];
    // paleta: při stmívání (paleta A ≠ B) se barvy prolnou podle f, jinak paleta snímku K
    let pal = K.pal;
    if (A && opt.pal) {
      let same = true; for (let i = 0; i < 32; i++) if (A.pal[i] !== B.pal[i]) { same = false; break; }
      if (!same) { const m = this.palMix; for (let i = 0; i < 32; i++) { const a = A.pal[i], b = B.pal[i]; let o = 0xff000000; for (let sh = 0; sh < 24; sh += 8) { const ca = a >>> sh & 255, cb = b >>> sh & 255; o |= Math.round(ca + (cb - ca) * f) << sh; } m[i] = o >>> 0; } pal = m; }
    }
    // sprity: výskyt ve snímku K se spáruje s výskytem téhož spritu v druhém snímku (nejbližší poloha) a posune na mezipolohu
    const sh = this.shift; sh.fill(0); let sfx = 0, sfy = 0, sfSet = false;   // zbytek mezipolohy žáby (necelé px): vrstva spritů se posune v pixelech zařízení jako svět
    if (A && opt.spr) {
      const O = K === B ? A : B, nk = Math.min(64, K.h[8]), no = Math.min(64, O.h[8]);
      for (let i = 0; i < nk; i++) {
        const e = K.inst[i], k = e >>> 24, vs = e >>> 12 & 0xfff, hs = e & 0xfff; let best = -1, bd = 33;
        for (let j = 0; j < no; j++) { const g = O.inst[j]; if (g >>> 24 !== k) continue; const d = Math.abs((g >>> 12 & 0xfff) - vs) + Math.abs((g & 0xfff) - hs); if (d < bd) { bd = d; best = j; } }
        if (best < 0) continue;
        const g = O.inst[best], ovs = g >>> 12 & 0xfff, ohs = g & 0xfff;
        const [ax, ay, bx, by] = K === A ? [hs, vs, ohs, ovs] : [ohs, ovs, hs, vs];
        const lx = ax + (bx - ax) * f, ly = ay + (by - ay) * f;
        sh[2 * i] = Math.round(lx) - hs; sh[2 * i + 1] = Math.round(ly) - vs;
        if (!sfSet && vs < 256) { sfx = lx - Math.round(lx); sfy = ly - Math.round(ly); sfSet = true; }   // první výskyt mimo medailonek (žába)
      }
    }
    // terén: buňky mapy snímku K (oči stromů aj. hra mění přepisem buněk) + atlas dlaždic; o sloupec a řádek víc (posun o zbytek)
    const atlas = this.map, cells = K.cells, rows = K.h[4] * 16, black = 0xff000000;
    for (let y = TOP; y < WH; y++) {
      const wy = oy + (y - TOP) - MY, row = y * WW;
      if (wy < 0 || wy >= rows) { world32.fill(black, row, row + WW); continue; }
      const crow = (wy >> 4) * MAP_COLS, ty = (wy & 15) << 4, x0 = ox - MX;
      for (let x = 0; x < WW; x++) { const wx = x0 + x; world32[row + x] = wx < 0 || wx >= MAP_W ? black : pal[atlas[(cells[crow + (wx >> 4)] << 8) | ty | (wx & 15)] & 31]; }
    }
    // objekty: pevné ve světě (posun o změnu kamery od snímku K); sprity a medailon: na obrazovce, ve vlastní průhledné vrstvě
    const bob = K.bob, spr = K.spr, sx = kox - ox, sy = koy - oy, mx2 = wide ? 2 * MX : MX, my2 = wide ? 2 * MY : MY;
    // objekty: hra je kreslí jen v krocích logiky (25 Hz, h[11] = číslo průchodu kreslení). Mezipoloha se proto počítá mezi stavy logiky
    // podle času, kdy se který stav poprvé ukázal, v čase tauO = now − 48 ms (o 20 ms dál než kamera; pro objekty ve světě jen menší zpoždění)
    const ps = this.passStart, cand = [];
    for (let k = 0; k < SLOTS; k++) { const q = this.slot(k); if (!q || q.h[10] !== 1) continue; const id = q.h[11], t0 = ps.get(id); if (t0 === undefined || q.ts[0] < t0) ps.set(id, q.ts[0]); if (!cand.some(c => c.id === id)) cand.push({ id, q }); }
    if (ps.size > 64) { const keep = new Set(cand.map(c => c.id)); for (const id of ps.keys()) if (!keep.has(id) && ps.size > 32) ps.delete(id); }
    cand.forEach(c => c.t = ps.get(c.id)); cand.sort((a, b) => a.t - b.t);
    const tauO = nowMs - LATO; let KO = K, OO = null, fo = 1;
    if (cand.length) {
      KO = cand[cand.length - 1].q;
      for (let i = 0; i + 1 < cand.length; i++) if (cand[i].t <= tauO && tauO < cand[i + 1].t) { fo = (tauO - cand[i].t) / Math.max(1, cand[i + 1].t - cand[i].t); KO = fo < 0.5 ? cand[i].q : cand[i + 1].q; OO = fo < 0.5 ? cand[i + 1].q : cand[i].q; if (fo >= 0.5) { OO = cand[i].q; } break; }
      if (!OO && tauO < cand[0].t) KO = cand[0].q;
    }
    const kfirst = OO ? (fo < 0.5) : true;                    // KO je dřívější stav dvojice
    const olValid = KO.h[10] === 1, okx = (KO.h[1] | 0) - ox, oky = (KO.h[2] | 0) - oy;
    if (true) {
      // objekty ze záznamů hry (i mimo původní okno): pevné ve světě, každý posunutý na mezipolohu mezi stavy logiky (spárováno podle adresy záznamu)
      const os = this.oshift; os.fill(0); this.dbgObj = null;
      if (OO && opt.spr) {
        const O = OO, kt = KO.objt, ot = O.objt;
        for (let i = 0; i < OL_MAX; i++) {
          const p = kt[3 * i]; if (!p) continue;
          for (let j = 0; j < OL_MAX; j++) if (ot[3 * j] === p) {
            const kx = kt[3 * i + 1], ky = kt[3 * i + 2], qx = ot[3 * j + 1], qy = ot[3 * j + 2];
            if (Math.abs(qx - kx) < 32 && Math.abs(qy - ky) < 32) {
              const [ax, ay, bx, by] = kfirst ? [kx, ky, qx, qy] : [qx, qy, kx, ky];
              os[2 * i] = Math.round(ax + (bx - ax) * fo) - kx; os[2 * i + 1] = Math.round(ay + (by - ay) * fo) - ky;
              if (qx !== kx && !this.dbgObj) this.dbgObj = [p, ax + (bx - ax) * fo, ay + (by - ay) * fo];   // ladění: první pohybující se objekt
            }
            break;
          }
        }
      }
      const ol = KO.ol;
      for (let ly = 0; ly < OL_H; ly++) {
        const row = ly * OL_W;
        for (let lx = 0; lx < OL_W; lx++) {
          const q = ol[row + lx]; if (!q) continue;
          // vrstva objektů nesedí s originálem: uvnitř původního okna platí BOBy z blitů (níže), objekty ze záznamů jen v okrajích
          if (!olValid && lx >= OL_PAD + MX && lx < OL_PAD + MX + GW && ly >= OL_PAD + MY && ly < OL_PAD + MY + GH - TOP) continue;
          const i = (q >> 8) - 1, bx = lx - OL_PAD + okx + os[2 * i], by = ly - OL_PAD + TOP + oky + os[2 * i + 1];
          if (bx >= 0 && bx < WW && by >= TOP && by < WH) world32[by * WW + bx] = pal[q & 31];
        }
      }
    }
    if (!olValid) {
      for (let y = TOP; y < GH; y++) {
        const by = y + MY + sy; if (by < TOP || by >= WH) continue;
        for (let x = 0; x < GW; x++) {
          const b = bob[y * GW + x];
          if (b !== 255) { const bx = x + MX + sx; if (bx >= 0 && bx < WW) world32[by * WW + bx] = pal[b & 31]; }
        }
      }
    }
    ovl32.fill(0); med32.fill(0);
    // Rozšířený výřez, žába při návratu (start levelu, po smrti; změřeno: visí s vrcholem vs 38 asi 66 snímků, pak padá na vs 159 = vrchol 120 řádků výřezu):
    // v řádcích HUD visí na volném místě hned za poslední hlavou životů (sloupec 130 + 16 × počet hlav z h[14], levá skupina HUD +40; zvoleno
    // 2026-10-23) a k poloze ve světě se srovná pozvolna po celou dobu pádu (vodorovný rozdíl × (1 − vrchol/120)), takže padá téměř svisle.
    let respF = null;
    if (wide) {
      let top = 1e9, mn = 1e9;
      for (let i = 0; i < Math.min(64, K.h[8]); i++) { const vs = K.inst[i] >>> 12 & 0xfff; if (vs < 256) top = Math.min(top, vs + sh[2 * i + 1] - 39); }
      for (let y = 0; y < TOP; y++) for (let x = 0; x < GW; x++) { const a = spr[y * GW + x] >>> 24; if (a >= 128 && a < 192) mn = Math.min(mn, MX + x + sh[2 * (a - 128)] - vsx); }
      if (mn < 1e9) { this.respOn = true; this.respOff = 130 + 16 * K.h[14] + 40 - mn; }               // žába v řádcích HUD: cíl = volné místo za hlavami
      else if (this.respOn && (top >= 120 || top < this.respTop - 2 || top === 1e9)) this.respOn = false;   // dopadla, letí vzhůru nebo zmizela
      this.respTop = top;
      if (this.respOn) respF = this.respOff * (1 - Math.max(0, Math.min(1, top / 120)));
    }
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {        // od řádku 0: žába v řádcích HUD originálu patří do okraje nad oknem (y + MY)
      const s = spr[y * GW + x]; if (!s) continue;
      const a = s >>> 24; let dx, dy;
      if (a === 254) { dx = 2 * MX + x; dy = 2 * MY + y; if (dx < BW && dy < BH) med32[dy * BW + dx] = (s & 0xffffff) | black; continue; }   // medailonek vždy v poloze širokého výřezu; posun s rohem výřezu v obraz.js
      if (a >= 128 && a < 192) {
        const i = a - 128; dx = MX + x + sh[2 * i] - vsx; dy = MY + y + sh[2 * i + 1] - vsy;
        // Rozšířený výřez: žába (výskyt spritu) v řádcích HUD originálu se kreslí přes HUD jako v originále a během 15 řádků sestupu plynule dojede
        // svisle na polohu ve světě (o MY níž); vrchol výskytu v řádcích výřezu = vs − 39. Vodorovně viz respF výše.
        if (wide) { const top = (K.inst[i] >>> 12 & 0xfff) - 39; if (top < 15) dy -= MY - Math.round(MY * Math.max(0, top) / 15);
          if (respF !== null && (K.inst[i] >>> 12 & 0xfff) < 256) dx += Math.round(respF); }
      } else { dx = MX + x - vsx; dy = MY + y - vsy; }
      if (dx >= 0 && dy >= 0 && dx < BW && dy < BH && (wide || dy >= TOP)) ovl32[dy * BW + dx] = (s & 0xffffff) | black;
    }
    this.stats.smooth++; return { fx, fy, sfx: sfx - vfx, sfy: sfy - vfy };   // sfx: vrstva spritů se posune o necelý zbytek (mezipoloha žáby, zastavení výřezu u kraje)
  }
}
