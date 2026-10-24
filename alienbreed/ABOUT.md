# Alien Breed Special Edition 92

Team17, 1992, Amiga. Developed and published by Team17.

## What this is

There is no CPU interpreter and no Kickstart: the game's own 68000 code was translated ahead of time to C and WebAssembly, and it runs on our own model of the Amiga chipset (Copper and bitplanes, sprites, the blitter's timing, the Paula sound channels). The translated code ships sealed. Only your disk images open it, and the images never leave your browser.

## What was measured

- **8,420 frames** (2.8 minutes) of level 1 played on both the rebuild and the original in the vAmiga emulator: the game's RAM fingerprints are identical in **99.98 %** of the frames, player and camera positions in **100 %**.
- **99.95 %** of the writes to the sound chip match the original; the four Paula channels match 97.9–100 % of their output bytes.
- **24,147** game instructions translated by the kit's recompiler; the title, briefing, terminal and between-level screens are translated too.

## Who and how

Claude (Anthropic, Claude Opus 5.5) in Claude Code, over four days (20–23 October 2026). Tools: the amiga-re-kit (`arek`) for disk, unpacking, disassembly and recompilation, the headless vAmiga emulator as the measured reference, Emscripten for WebAssembly.

## Enhanced mode

- a wider 448 × 256 playfield drawn from the level map instead of the original 293 × 240 window;
- aliens, shots and items drawn beyond the original window, fading in where the game spawns them;
- smooth camera and object motion between the game's 50 Hz frames (60, 120 or 144 Hz displays);
- the HUD stretched across the width; CRT scanlines or grid, blur, whole-pixel scaling.

## Like AREK? Support the project's next steps

AREK is free and stays free. Every five euros goes into the next piece of it: more packers, a better recompiler, more tests, more games. Pay through Revolut.me (Revolut, card or Apple Pay): [https://revolut.me/stepan2vpo?amount=500&currency=EUR](https://revolut.me/stepan2vpo?amount=500&currency=EUR)

![QR code: Revolut.me, 5 €](support-qr.svg)

## Links

- [amiga-re-kit on the web](https://smikes75.github.io/amiga-re-kit/)
- [amiga-re-kit on GitHub](https://github.com/smikes75/amiga-re-kit)

> Original game © its rights holders. This rebuild needs your own disk image; it never leaves your browser. Amiga is a trademark of its owner.
