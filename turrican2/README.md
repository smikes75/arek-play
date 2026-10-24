# Turrican II presentation package (world 1-1)

Built by `python3 tools/build-present.py [--adf DISK1.adf]` from the Turrican2-claude repository into
`build/present/` (git-ignored). It goes to the kit web as `play/turrican2/` unchanged; it runs from
any sub-folder (relative paths only) on a plain static server without COOP/COEP headers.

## What is in it

- `index.html`, `present.js`, `present.css`, `native-menu.css`: the page (wb-shell look, one menu
  Display, help H, sound M, the disk loader and the about screen from `ABOUT.md`).
- `wb-obraz.js` (display contract 1.3) and `wb-seal.js`: the kit's reference files, unchanged
  (sha256 in `manifest.json`).
- Open shell code without game logic: `native-data.js` (ADF/AmigaDOS reader and unpacker),
  `native-menu.js` (Workbench menu), `native-input.js` (gamepad adapter), `native-audio.js`
  (AudioWorklet lifecycle, `postMessage` only), `present-worklet.js` (the audio processor without
  its imports).
- `sealed/seal.json` and `sealed/*.sealed`: every file with ported game logic or tables
  (`native-*.js`, the sound and music code), AES-GCM, opened by `WBSEAL.open` with the visitor's
  disk 1; the page loads them as Blob scripts. `manifest.json` lists each file with size, sha256,
  `derived` and `sealed`, and the accepted disks.

No game data is in the package and none is fetched: graphics, maps, sound and music come from the
visitor's ADF in the browser.

## Taking it over (kit session)

1. Check `manifest.json` (no `derived` file without `sealed`), `TESTS.md` (the five tests).
2. Copy the whole folder to `play/turrican2/`. To switch the demo off, remove that folder.
3. Accepted disk: Turrican II disk 1 as listed in `manifest.json` (`accepted_disks`); another
   verified version is added by building with `--adf` once more per version (each is one `--set`;
   extend `tools/build-present.py` to pass several).

The query parameter `?disk=URL` (same origin only) loads a disk from the server; it exists for the
automated tests, which serve a local ADF next to the package. The published folder has no disk.
