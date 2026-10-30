// gl.js - Vylepšeno přes WebGL2: terén z enginu (RGBA vrstva) a nad ním objekty a sprity jako obdélníky s texturou indexů
// barev na necelých bodech hry (zlomek bodu = celé pixely zařízení, jako posun kamery); paleta po řádcích vrstvy.
// wb-obraz 1.5: kreslí do framebufferu prezentéru kitu (WBOBRAZ.Presenter, jedno plátno WebGL, bez kopie do 2D plátna -
// Safari, G31) v jeho draw(gl, fbo, {w, h}): pruh hrací plochy na řádcích band .. band + LH - 1 (shora, v bodech hry).
// GL.attach(gl) -> false bez WebGL2. GL.render(M, q): q = { W, LW, LH, S, fx, fy, lv, camx, camy, lut?, layerOnly?, fbo?, fh?,
// band?, x0?, y0? (posun pruhu v pixelech zařízení - přechod režimů) }; bez fbo kreslí do vlastního framebufferu W*S × (LH-1)*S (kontrola shody, GL.read). layerOnly: jen vrstva enginu
// (skládání procesorem, objekty a sprity už v ní) posunutá o necelou kameru.
'use strict';
const GL = (() => {
  let gl = null, prog = null, u = {}, texLayer = null, texPal = null, vbo = null, vao = null, cache = new Map(), pool = [], level = -1;
  let own = null, texGrid = null, texAtlas = null, texBg = null, atGen = -1, atRows = 0;                                          // vlastní framebuffer (kontrola shody): { fbo, t, w, h }
  const VS = `#version 300 es
    in vec2 a_pos; in vec2 a_uv; out vec2 v_uv; uniform vec2 u_size;
    void main() { v_uv = a_uv; vec2 p = a_pos / u_size * 2.0 - 1.0; gl_Position = vec4(p.x, -p.y, 0.0, 1.0); }`;
  const FS = `#version 300 es
    precision highp float; precision highp int;
    in vec2 v_uv; out vec4 o;
    uniform sampler2D u_tex; uniform sampler2D u_pal; uniform int u_mode; uniform float u_S; uniform float u_fy; uniform float u_hdev; uniform float u_vy; uniform int u_rows;
    uniform highp usampler2D u_grid; uniform sampler2D u_atlas; uniform sampler2D u_bg; uniform ivec4 u_g0; uniform ivec4 u_w0; uniform ivec4 u_win; uniform ivec4 u_msk; uniform vec2 u_lsize;
    int ix8(sampler2D t, ivec2 p) { return int(texelFetch(t, p, 0).r * 255.0 + 0.5); }
    void main() {
      if (u_mode == 0) { o = texture(u_tex, v_uv); return; }
      if (u_mode == 2) {                         // terén z atlasu dlaždic + mřížky + pozadí okna originálu (view.h vw_gpu_terrain)
        ivec2 lp = ivec2(floor(v_uv * u_lsize)); int idx = -1;
        ivec2 b = lp + u_w0.zw, w = lp + u_w0.xy;
        if (b.x >= u_win.x && b.x < u_win.y && b.y >= u_win.z && b.y <= u_win.w) { int v = ix8(u_bg, b); if (v != 255) idx = v; }
        if (idx < 0 && w.x >= 0 && w.y >= 0 && w.x >= u_msk.x && w.x < u_msk.y && w.y >= u_msk.z && w.y < u_msk.w) {
          ivec2 c = (w >> 4) - u_g0.xy;
          if (c.x >= 0 && c.y >= 0 && c.x < u_g0.z && c.y < u_g0.w) { uint sl = texelFetch(u_grid, c, 0).r;
            if (sl != 0xffffu) idx = ix8(u_atlas, ivec2(int(sl % 32u) * 16 + (w.x & 15), int(sl / 32u) * 16 + (w.y & 15))); }
        }
        if (idx < 0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
        o = texelFetch(u_pal, ivec2(idx, clamp(lp.y, 0, u_rows - 1)), 0); return;
      }
      ivec2 ts = textureSize(u_tex, 0); ivec2 p = ivec2(int(floor(v_uv.x * float(ts.x))), int(floor(v_uv.y * float(ts.y))));
      if (p.x < 0 || p.y < 0 || p.x >= ts.x || p.y >= ts.y) discard;
      int idx = int(texelFetch(u_tex, p, 0).r * 255.0 + 0.5); if (idx == 255) discard;
      int row = clamp(int(floor((u_hdev + u_vy - gl_FragCoord.y) / u_S + u_fy)), 0, u_rows - 1);
      o = texelFetch(u_pal, ivec2(idx, row), 0);
    }`;
  function shader(t, src) { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function tex(filter) { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; }
  // připojení ke kontextu prezentéru (jeho plátno): vlastní program, VAO a textury; stav prezentéru se nemění (ten si ho po draw
  // obnoví sám, ale VAO a atributy jsou naše)
  function attach(g) {
    try {
      gl = g; if (!gl) return false;
      prog = gl.createProgram(); gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      for (const n of ['u_size', 'u_tex', 'u_pal', 'u_mode', 'u_S', 'u_fy', 'u_hdev', 'u_vy', 'u_rows', 'u_grid', 'u_atlas', 'u_bg', 'u_g0', 'u_w0', 'u_win', 'u_msk', 'u_lsize']) u[n] = gl.getUniformLocation(prog, n);
      vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      const aPos = gl.getAttribLocation(prog, 'a_pos'), aUv = gl.getAttribLocation(prog, 'a_uv');
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(aUv); gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
      gl.bindVertexArray(null);
      texLayer = tex(gl.NEAREST); texPal = tex(gl.NEAREST); texGrid = tex(gl.NEAREST); texAtlas = tex(gl.NEAREST); texBg = tex(gl.NEAREST);
      gl.canvas.addEventListener('webglcontextlost', () => { gl = null; });
      return true;
    } catch (e) { gl = null; return false; }
  }
  const quad = new Float32Array(24);
  function draw(x0, y0, w, h, u0, v0, u1, v1) {
    quad.set([x0, y0, u0, v0, x0 + w, y0, u1, v0, x0, y0 + h, u0, v1, x0, y0 + h, u0, v1, x0 + w, y0, u1, v0, x0 + w, y0 + h, u1, v1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STREAM_DRAW); gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  // engine ve vlákně: paměť wasm je SharedArrayBuffer - WebGL dostane kopii (pohled do sdílené paměti nemusí přijmout)
  let scratch = new Uint8Array(0);
  function heap(M, p, n) {
    if (!(M.HEAPU8.buffer instanceof ArrayBuffer)) { if (scratch.length < n) scratch = new Uint8Array(n); scratch.set(M.HEAPU8.subarray(p, p + n)); return scratch.subarray(0, n); }
    return M.HEAPU8.subarray(p, p + n);
  }
  function r8(t, w, h, data) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data); }
  // textura objektu (obrázek z enginu: indexy barev); klíč = otisk zdrojové grafiky (sig z enginu), ne adresa deskriptoru:
  // nový level má na stejné adrese jinou grafiku a číslo levelu se přepne dřív, než zmizí objekty starého (M14: alien
  // v levelu 2 problikl helikoptérou z levelu 1). Starší engine bez sig: adresa deskriptoru jako dosud.
  let tmpTex = null;
  function objTex(M, fd, flags, sig) {
    const key = sig === undefined ? fd * 4 + flags : sig * 4 + flags; let e = cache.get(key); if (e) return e;
    const p = M._engine_view_obj_img(fd, flags); if (!p) return null;
    const w = M._engine_view_obj_w(), h = M._engine_view_obj_h();
    // vlákno hry mohlo mezitím grafiku změnit: do cache jen obrázek, jehož otisk po dekódování souhlasí s klíčem
    const ok = sig === undefined || !M._engine_view_obj_sig || M._engine_view_obj_sig(fd, flags) === sig;
    if (!ok) { if (!tmpTex) tmpTex = { t: tex(gl.NEAREST), w: 0, h: 0 }; tmpTex.w = w; tmpTex.h = h; r8(tmpTex.t, w, h, heap(M, p, w * h)); return tmpTex; }
    if (cache.size >= 4096) { for (const v of cache.values()) gl.deleteTexture(v.t); cache.clear(); }
    e = { t: tex(gl.NEAREST), w, h }; r8(e.t, w, h, heap(M, p, w * h)); cache.set(key, e); stats.uploads++; return e;
  }
  const stats = { objs: 0, sprs: 0, uploads: 0, ms: 0 };
  const track = { n: 0, rec: new Uint32Array(96), x: new Float64Array(96), y: new Float64Array(96) };   // měřidlo plynulosti (main.js)
  // q: W (šířka vrstvy bez sloupce navíc), LW, LH (rozměr vrstvy), S (pixely zařízení na bod), fx, fy (necelá kamera), lv (level)
  // terén na GPU (q.gt): atlas dlaždic (512 × 512 R8) - nahrát jen změněné sloty (nová generace = celý), mřížka dlaždic (R16UI),
  // pozadí okna originálu (R8 E_W × E_H), parametry jako uniformy; skládá shader (režim 2)
  function terrainGT(M, q) {
    const gen = M._engine_gt_gen(), ns = M._engine_gt_nslots(), nd = M._engine_gt_ndirty(), at = M._engine_gt_atlas();
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, texAtlas);
    if (gen !== atGen) { atGen = gen; atRows = 32; gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 512, 512, 0, gl.RED, gl.UNSIGNED_BYTE, null); upTiles(M, at, null, ns); }
    else if (nd) upTiles(M, at, new Uint16Array(M.HEAPU8.buffer, M._engine_gt_dirty(), nd).slice(), nd);
    const P = new Int32Array(M.HEAPU8.buffer, M._engine_gt_params(), 16).slice();
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texGrid);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, P[2], P[3], 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, new Uint16Array(heapCopy(M, M._engine_gt_grid(), P[2] * P[3] * 2).buffer, 0, P[2] * P[3]));
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, texBg);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 330, 261, 0, gl.RED, gl.UNSIGNED_BYTE, heap(M, M._engine_gt_bg(), 330 * 261));
    gl.uniform1i(u.u_grid, 2); gl.uniform1i(u.u_atlas, 3); gl.uniform1i(u.u_bg, 4);
    gl.uniform4i(u.u_g0, P[0], P[1], P[2], P[3]); gl.uniform4i(u.u_w0, P[4], P[5], P[6], P[7]); gl.uniform4i(u.u_win, P[8], P[9], P[10], P[11]);
    gl.uniform4i(u.u_msk, P[12], P[13], P[14], P[15]); gl.uniform2f(u.u_lsize, q.LW, q.LH); gl.uniform1i(u.u_mode, 2);
    // jednotka 0 (u_tex) nesmí držet texturu cílového framebufferu (WebGL: feedback loop = kreslení odmítnuto)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texLayer);
    stats.tiles = ns;
  }
  function upTiles(M, at, list, n) {                       // sloty do atlasu: 32 na řádek, 16 × 16
    for (let i = 0; i < n; i++) { const sl = list ? list[i] : i; gl.texSubImage2D(gl.TEXTURE_2D, 0, (sl % 32) * 16, ((sl / 32) | 0) * 16, 16, 16, gl.RED, gl.UNSIGNED_BYTE, heap(M, at + sl * 256, 256)); stats.tileUp = (stats.tileUp || 0) + 1; }
  }
  function heapCopy(M, p, n) { return M.HEAPU8.slice(p, p + n); }
  function render(M, q) {
    if (!gl) return false; const t0 = performance.now();
    if (q.lv !== level) { for (const e of cache.values()) gl.deleteTexture(e.t); cache.clear(); level = q.lv; }
    const S = q.S, Wd = q.W * S, Hd = (q.LH - 1) * S;
    // cíl: framebuffer prezentéru (řádek 0 dole; pruh hrací plochy od řádku band shora) nebo vlastní (kontrola shody)
    let vy = 0;
    let vx = 0;
    if (q.fbo !== undefined) { gl.bindFramebuffer(gl.FRAMEBUFFER, q.fbo); vy = q.fh - (q.y0 || 0) - q.band * S - Hd; vx = q.x0 || 0; }
    else {
      if (!own) own = { fbo: gl.createFramebuffer(), t: tex(gl.NEAREST), w: 0, h: 0 };
      if (own.w !== Wd || own.h !== Hd) { own.w = Wd; own.h = Hd; gl.bindTexture(gl.TEXTURE_2D, own.t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, Wd, Hd, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, own.fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, own.t, 0); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, own.fbo);
    }
    gl.useProgram(prog); gl.bindVertexArray(vao); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); if (!q.clip) gl.disable(gl.SCISSOR_TEST); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.uniform1i(u.u_tex, 0); gl.uniform1i(u.u_pal, 1);
    gl.viewport(vx, vy, Wd, Hd); gl.uniform2f(u.u_size, Wd, Hd); gl.uniform1f(u.u_S, S); gl.uniform1f(u.u_fy, q.fy); gl.uniform1f(u.u_hdev, Hd); gl.uniform1f(u.u_vy, vy); gl.uniform1i(u.u_rows, q.LH);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texPal);
    const pp = M._engine_gl_pal(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 32, q.LH, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutApply(heap(M, pp, 32 * q.LH * 4), q.lut));
    if (q.gt) terrainGT(M, q);
    else {
      // terén: celá vrstva, posun o necelou kameru přes souřadnice textury (nejbližší soused -> celé pixely zařízení)
      const lp = M._engine_view_layer();
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texLayer);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, q.LW, q.LH, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutApply(heap(M, lp, q.LW * q.LH * 4), q.lut));
      gl.uniform1i(u.u_mode, 0);
    }
    gl.activeTexture(gl.TEXTURE0);
    draw(0, 0, Wd, Hd, q.fx / q.LW, q.fy / q.LH, (q.W + q.fx) / q.LW, (q.LH - 1 + q.fy) / q.LH);
    track.n = 0;
    if (q.layerOnly) { stats.objs = stats.sprs = 0; stats.ms = performance.now() - t0; return true; }
    // objekty v pořadí kreslení hry; poloha v bodech vrstvy (zlomek) -> pixely zařízení
    gl.uniform1i(u.u_mode, 1);
    const n = M._engine_gl_nobj(), ob = M._engine_gl_obj(), Z = (M._engine_gl_obj_size ? M._engine_gl_obj_size() : 24) >> 2;
    const I = new Int32Array(M.HEAPU8.buffer, ob, n * Z), F = new Float32Array(M.HEAPU8.buffer, ob, n * Z), U = new Uint32Array(M.HEAPU8.buffer, ob, n * Z);
    let objs = 0;
    for (let i = 0; i < n; i++) {
      const e = objTex(M, U[Z * i], I[Z * i + 3], Z > 7 ? U[Z * i + 7] : undefined); if (!e) continue;
      gl.bindTexture(gl.TEXTURE_2D, e.t);
      const dx = Math.round((F[Z * i + 4] - q.fx) * S), dy = Math.round((F[Z * i + 5] - q.fy) * S);
      draw(dx, dy, e.w * S, e.h * S, 0, 0, 1, 1); objs++;
      if (Z > 6 && track.n < 96) { track.rec[track.n] = U[Z * i + 6]; track.x[track.n] = dx + q.camx * S; track.y[track.n] = dy + q.camy * S; track.n++; }   // poloha ve světě v px zařízení (měřidlo)
    }
    // sprity (hráč): behy 16 × h, nižší číslo spritu navrch
    const ns = M._engine_gl_nspr(), sp = M._engine_gl_spr(), SI = new Int32Array(M.HEAPU8.buffer, sp, ns * 5), SF = new Float32Array(M.HEAPU8.buffer, sp, ns * 5), img = M._engine_gl_sprimg();
    let sprs = 0;
    for (let k = 7; k >= 0; k--) for (let i = 0; i < ns; i++) {
      if (SI[5 * i] !== k) continue;
      const h = SI[5 * i + 1], off = SI[5 * i + 2]; if (!pool[sprs]) pool[sprs] = tex(gl.NEAREST);
      r8(pool[sprs], 16, h, heap(M, img + off, 16 * h));
      draw(Math.round((SF[5 * i + 3] - q.fx) * S), Math.round((SF[5 * i + 4] - q.fy) * S), 16 * S, h * S, 0, 0, 1, 1); sprs++;
    }
    stats.objs = objs; stats.sprs = sprs; stats.ms = performance.now() - t0;
    gl.bindVertexArray(null);
    return true;
  }
  // přechod režimů (wb-obraz 1.5 bez přealokace plátna v každém snímku): celý snímek W × H bodů (RGBA) do framebufferu prezentéru
  // fw × fh na (x0, y0) pixelů zařízení shora, bod = S × S; mimo okno (scissor, pixely zařízení shora) černě
  let texFrame = null;
  function frame(px, W, H, S, fbo, fw, fh, x0, y0, clip) {
    if (!gl) return false;
    if (!texFrame) texFrame = tex(gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, fw, fh); gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(clip[0], fh - clip[1] - clip[3], clip[2], clip[3]);
    gl.useProgram(prog); gl.bindVertexArray(vao); gl.disable(gl.BLEND); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texFrame);
    if (px) { const d = px.data || px; gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, d instanceof Uint8Array ? d : new Uint8Array(d.buffer, d.byteOffset, d.byteLength)); }   // null = předchozí snímek
    gl.uniform1i(u.u_tex, 0); gl.uniform1i(u.u_mode, 0); gl.uniform2f(u.u_size, fw, fh);
    gl.uniform1i(u.u_grid, 2); gl.uniform1i(u.u_atlas, 3); gl.uniform1i(u.u_bg, 4);   // samplery jinych typu ne na jednotce 0 (M31: snimek pred prvnim kreslenim hry)
    draw(x0, y0, W * S, H * S, 0, 0, 1, 1);
    gl.bindVertexArray(null); return true;
  }
  // kanály RGB z menu (tabulky 256 hodnot na kanál) na vrstvu a paletu - jako u snímku z enginu (putPx)
  let lutBuf = new Uint8Array(0);
  function lutApply(px, lut) {
    if (!lut) return px;
    if (lutBuf.length < px.length) lutBuf = new Uint8Array(px.length);
    const o = lutBuf.subarray(0, px.length);
    for (let i = 0; i < px.length; i += 4) { o[i] = lut[0][px[i]]; o[i + 1] = lut[1][px[i + 1]]; o[i + 2] = lut[2][px[i + 2]]; o[i + 3] = px[i + 3]; }
    return o;
  }
  function read() {                                        // vlastní framebuffer RGBA shora dolů (kontrola shody)
    if (!own) return null; const w = own.w, h = own.h, px = new Uint8Array(w * h * 4), out = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, own.fbo); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    return out;
  }
  // render s q.clip: scissor zůstane (pruh se ořízne oknem přechodu); vypne ho volající
  return { attach, render, frame, read, ok: () => !!gl, stats, track, cacheSize: () => cache.size, noClip: () => gl && gl.disable(gl.SCISSOR_TEST) };
})();
