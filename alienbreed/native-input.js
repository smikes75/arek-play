// native-input.js - gamepad a joystick (Gamepad API) pro web/native-game.js: stav ovladace na hranici logiky se slouci s klavesnici
// (odpojeni jednoho zdroje nikdy nesmaze druhy). Podle Turrican2-claude web/native-input.js (docs/JOYSTICK-INPUT.md):
// standardni gamepad (mapping 'standard'): packa nebo krizek = smery, A/X/RT = fire, B = mezernik (terminal Intex), Y = Original/Vylepseno,
// Start = pauza; USB joystick bez standardniho rozlozeni: zadne A/B/X/Y, tlacitka 0-3 a 7 = fire, smery z packy nebo hat (osa 9, DirectInput).
// Zvolene tlacitko Fire (fireButton = index) bere tomu tlacitku ostatni role.
'use strict';
const NativeInput = (() => {
    const empty = () => ({ left: false, right: false, up: false, down: false, fire: false, space: false, mode: false, pause: false });
    const button = (pad, n) => { const b = pad.buttons && pad.buttons[n]; return typeof b === 'number' ? b > 0.5 : !!b && (b.pressed || b.value > 0.5); };
    class Gamepads {
        constructor(read = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []) || []) {
            this.read = read; this.preferred = 'auto'; this.fireButton = 'auto'; this.previous = new Set(); this.selected = null; this.pads = [];
        }
        poll() {
            try { this.pads = Array.from(this.read()).filter((p) => p && p.connected !== false); } catch (e) { this.pads = []; }
            const pad = this.pads.find((p) => String(p.index) === this.preferred) || (this.preferred === 'auto' ? this.pads[0] : null);
            const out = empty(), pressed = new Set();
            if (pad) {
                const ax = pad.axes || [], x = ax[0] || 0, y = ax[1] || 0, standard = pad.mapping === 'standard';
                const fireIndex = /^(?:[0-9]|[1-5][0-9]|6[0-3])$/.test(this.fireButton) ? Number(this.fireButton) : null;
                const other = (n) => n !== fireIndex && button(pad, n);
                out.left = x < -0.4 || (standard && other(14)); out.right = x > 0.4 || (standard && other(15));
                out.up = y < -0.4 || (standard && other(12)); out.down = y > 0.4 || (standard && other(13));
                out.fire = fireIndex !== null ? button(pad, fireIndex) : standard ? button(pad, 0) || button(pad, 2) || button(pad, 7) : [0, 1, 2, 3, 7].some((n) => button(pad, n));
                out.space = standard && other(1); out.mode = standard && other(3); out.pause = other(9);
                const hat = standard ? undefined : ax[9];   // hat prepinac DirectInput: -1 nahoru, po 2/7 po smeru hodin; mimo rozsah = klid
                if (Number.isFinite(hat) && hat >= -1 && hat <= 1) {
                    const h = Math.round((hat + 1) * 3.5);
                    out.up = out.up || [0, 1, 7].includes(h); out.right = out.right || [1, 2, 3].includes(h);
                    out.down = out.down || [3, 4, 5].includes(h); out.left = out.left || [5, 6, 7].includes(h);
                }
                for (const k of ['mode', 'pause']) if (out[k]) pressed.add(k);
            }
            const changed = this.selected !== (pad ? pad.index : null), edge = (k) => pressed.has(k) && (!this.previous.has(k) || changed);
            out.modePressed = edge('mode'); out.pausePressed = edge('pause');
            this.previous = pressed; this.selected = pad ? pad.index : null; out.pad = pad || null;
            return out;
        }
    }
    return { Gamepads, empty };
})();
if (typeof module !== 'undefined') module.exports = NativeInput;
