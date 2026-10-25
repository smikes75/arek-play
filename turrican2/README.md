# Turrican II presentation package (world 1-1)

Built by `python3 tools/build-present.py [--adf DISK1.adf]` from the Turrican2-claude repository into
`build/present/` (git-ignored). It goes to the kit web as `play/turrican2/` unchanged; it runs from
any sub-folder (relative paths only) on a plain static server without COOP/COEP headers.

## What is in it

- `index.html`, `present.js`, `present.css`, `native-menu.css`: the page (wb-shell look, one menu
  Display, help H, sound M, the disk loader and the about screen from `ABOUT.md`).
- `support-qr.svg`: the QR code of the support link in `ABOUT.md` (Revolut.me, €5), a plain SVG
  from the kit's `docs/img`; not derived from the game. The about screen shows the support
  section in a column beside the text, so the QR needs no scrolling.
- `wb-obraz.js` (display contract 1.3) and `wb-seal.js`: the kit's reference files, unchanged
  (sha256 in `manifest.json`).
- Open shell code without game logic: `native-data.js` (ADF/AmigaDOS reader and unpacker),
  `native-menu.js` (Workbench menu), `native-input.js` (gamepad adapter), `native-audio.js`
  (AudioWorklet lifecycle, `postMessage` only), `present-worklet.js` (the audio processor without
  its imports).
- `sealed/seal.json` and `sealed/*.sealed`: every file with ported game logic or tables
  (`native-*.js`, the sound and music code), AES-GCM, opened by `WBSEAL.open` with the visitor's
  disk 1; the page loads them as Blob scripts. `manifest.json` lists each file with size, sha256,
  `derived` and `sealed`, the accepted disks and the accepted game content.
- `shots/`: four screenshots of the rebuild in game pixels (zoom 1, no CRT, no blur) with
  `shots/README.md`; made by `python3.14 tools/present-shots.py` (replays `present/1-1-input.json`)
  into `build/present-shots/` and copied in by the build. They show game graphics, so they are kept
  out of git; `manifest.json` marks them `"screenshot": true`.

The figure on the about screen (96.8 % of 293,154 frames) is `python3 tools/nativetracescore.py`
over the ratchet `tools/nativetrace-baseline.json` of the same commit: a frame counts only if all
compared categories of its run match, and everything after a run's first difference counts as
different.

The page fetches no game data: everything the game uses (graphics, maps, sound and music) comes
from the visitor's ADF in the browser. No disk file is in the package; the only game pictures are
the four screenshots in `shots/`, which the page itself does not load.

## Taking it over (kit session)

1. Check `manifest.json` (no `derived` file without `sealed`), `TESTS.md` (the five tests).
2. Copy the whole folder to `play/turrican2/`. To switch the demo off, remove that folder.
3. Accepted disks: the seal has two keys (kit 0.5.12). The disk key opens with exactly the disk
   listed in `manifest.json` (`accepted_disks`); the content key opens with any disk 1 whose game
   files are the same (`accepted_contents`, see below). A version with different game files is
   added by building with `--adf` once more (each is one `--set`; extend `tools/build-present.py`
   to pass several).

## The game content (payload key)

The content key is made from the bytes the rebuild reads from disk 1, unpacked, in a fixed order;
`NativeData.payload(disk1)` in `native-data.js` builds it in the page, `build-present.py` builds
the same bytes into `build/payload.bin` (git-ignored, never in the package) and seals with
`--payload build/payload.bin`.

- Files, from the game's own catalog (30 entries of 16 bytes at disk offset 0x1600: name, offset,
  length, flags), in this order: `IDAT INTR IP00 IP01 IP02 IP03 IP04 IP05 IP06 IP07 L1-1 MAIN MUS0
  MUS1`. Each file is unpacked as the game unpacks it.
- Each file adds `name`, a zero byte, its unpacked length in decimal ASCII, a zero byte, then its
  unpacked bytes.
- In `MAIN` the 8 bytes at 0x50fc..0x5103 are set to zero: there the [L]EGEND release has its
  crack hook (`jsr $7fee0; nop`); the rebuild does not run that code.
- Nothing else is read: the boot block, the loader, a cracktro and the sectors no file uses
  change neither the content id nor the game. Disk 2 is not part of the key.

For TURRI2-1.ADF the content is 828,489 bytes, content id (sha256) 3668a7dc4db91181…. When a disk
is refused, the page shows its sha256 (`WBSEAL.ids`) and its content id (`WBSEAL.payloadId`) and
asks for a report in the arek-play issues; a version with the same content id then needs no
change, one with a different id needs a new build.

The query parameter `?disk=URL` (same origin only) loads a disk from the server; it exists for the
automated tests, which serve a local ADF next to the package. The published folder has no disk.
