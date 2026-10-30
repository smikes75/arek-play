// Gamepad / USB joystick -> klávesy hry (bit 0 R, 1 L, 2 U, 3 D, 4 F), čte se v každém snímku displeje. Výběr ovladače a tlačítka Fire
// převzatý ze Superfrogu (SF-sonet/web/pad.js, tam podle Turricanu); Alien Breed II je hra shora: páčka / kříž = pohyb, A / B / X / pravý
// trigger = fire (standardní gamepad), nestandardní joystick: osy, hat (osa 9), tlačítka 0–3 a 7 = fire.
'use strict';
const PAD = (() => {
  const pressed = (pad, n) => { const b = pad.buttons && pad.buttons[n]; return typeof b === 'number' ? b > 0.5 : !!b && (b.pressed || b.value > 0.5); };
  class Gamepads {
    constructor() { this.pad = null; this.pads = []; this.preferred = 'auto'; this.fireButton = 'auto'; this.sig = ''; }
    poll() {
      try { this.pads = Array.from((navigator.getGamepads && navigator.getGamepads()) || []).filter((p) => p && p.connected !== false); } catch (e) { this.pads = []; }
      const pad = this.pad = this.pads.find((p) => String(p.index) === this.preferred) || (this.preferred === 'auto' ? this.pads[0] : null) || null;
      return this.read(pad);
    }
    // hráč 2: první připojený ovladač kromě toho, který řídí hráče 1 (volat po poll())
    poll2() { return this.read(this.pads.find((p) => p !== this.pad) || null); }
    read(pad) {
      if (!pad) return 0;
      const x = (pad.axes && pad.axes[0]) || 0, y = (pad.axes && pad.axes[1]) || 0, std = pad.mapping === 'standard';
      const fi = /^\d+$/.test(this.fireButton) ? +this.fireButton : null;
      let up = y < -0.4 || (std && pressed(pad, 12)), down = y > 0.4 || (std && pressed(pad, 13));
      let left = x < -0.4 || (std && pressed(pad, 14)), right = x > 0.4 || (std && pressed(pad, 15));
      const fire = fi !== null ? pressed(pad, fi) : std ? [0, 1, 2, 7].some((n) => pressed(pad, n)) : [0, 1, 2, 3, 7].some((n) => pressed(pad, n));
      const hat = std ? undefined : pad.axes && pad.axes[9];
      if (Number.isFinite(hat) && hat >= -1 && hat <= 1) {
        const h = Math.round((hat + 1) * 3.5);
        up = up || [0, 1, 7].includes(h); right = right || [1, 2, 3].includes(h); down = down || [3, 4, 5].includes(h); left = left || [5, 6, 7].includes(h);
      }
      return (right ? 1 : 0) | (left ? 2 : 0) | (up ? 4 : 0) | (down ? 8 : 0) | (fire ? 16 : 0);
    }
    syncUi(sel, fireSel, status) {
      const sig = JSON.stringify([this.preferred, this.fireButton, this.pads.map((p) => [p.index, p.id, p.mapping, p.buttons && p.buttons.length])]);
      if (sig === this.sig) return; this.sig = sig;
      sel.replaceChildren(new Option('Automatic', 'auto'));
      for (const p of this.pads) sel.add(new Option(p.id, String(p.index)));
      if (this.preferred !== 'auto' && !this.pads.some((p) => String(p.index) === this.preferred)) sel.add(new Option('The selected controller is not connected', this.preferred));
      sel.value = this.preferred;
      const p = this.pad;
      fireSel.replaceChildren(new Option('Automatic', 'auto'));
      for (let i = 0; i < Math.min(64, (p && p.buttons && p.buttons.length) || 0); i++) fireSel.add(new Option('Button ' + (i + 1), String(i)));
      fireSel.value = this.fireButton; fireSel.disabled = !p;
      status.hidden = !p; status.textContent = p ? (p.mapping === 'standard' ? 'Gamepad connected · A / B / X / RT fire' : 'Joystick connected') : '';
    }
  }
  return { Gamepads };
})();
