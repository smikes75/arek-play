# About this rebuild

## Superfrog, Team17, 1993

**Superfrog** was made and released by Team17 for the Amiga in 1993 (the credits on disk 1 read *A TEAM 17 PRODUCT, 1993*). You just played its first level, Magic Woods.

## What this is

There is no CPU interpreter and no Kickstart: the game's own 68000 code was translated ahead of time to C and WebAssembly, and it runs on our own model of the Amiga chipset (Copper and bitplanes, sprites, the blitter's timing, the Paula sound channels). The translated code ships sealed. Only your disk image opens it, and the image never leaves your browser.

## What was measured

- The first frame of level 1 matches the original in an emulator pixel for pixel: 0 of 204,060 pixels differ.
- Game logic driven by the same recorded input matched the emulator in all 2,338 frames of a test run through the first trees.
- The boot loader and unpacker produce the same memory as the original: 0 bytes differ.

## Enhanced mode

- A wider 448 × 279 view. The extra area around the original window is drawn from the level map, so you see further ahead.
- Smooth movement at your monitor's refresh rate (60, 120 or 144 Hz). The camera, the frog and the enemies are drawn between the game's 50 Hz frames, and colour fades are blended. The game logic still runs at 50 Hz.
- Enemies wake up a little further out, so they don't appear out of nowhere at the wider edges.

## Who and how

Built in about two days (22 to 23 October 2026) by Claude (Anthropic: Sonnet 5.5, then Opus 5.5). The tools were [amiga-re-kit](https://github.com/smikes75/amiga-re-kit) (`arek`: disk and code analysis, the 68000 to C translator and checks against a headless emulator), Emscripten and a browser. Only one disk version has been verified so far: `spfrogd1.adf` (a Crystal crack of disk 1).

<!-- pinned -->

## Like AREK? Support the project's next steps

AREK is free and stays free. Every five euros goes into the next piece of it: more packers, a better recompiler, more tests, more games. Pay through Revolut.me (Revolut, card or Apple Pay): [revolut.me/stepan2vpo](https://revolut.me/stepan2vpo?amount=500&currency=EUR)

![QR code: Revolut.me, 5 €](support-qr.svg)

## Links

- [amiga-re-kit on the web](https://smikes75.github.io/amiga-re-kit/)
- [amiga-re-kit on GitHub](https://github.com/smikes75/amiga-re-kit)

_Original game © its rights holders. This rebuild needs your own disk image; it never leaves your browser. Amiga is a trademark of its owner._
