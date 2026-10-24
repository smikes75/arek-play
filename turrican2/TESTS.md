# Tests of the presentation package (Turrican II, world 1-1)

`python3.14 tools/presenttest.py` (Playwright Chromium headless). The package `build/present/` is
served by Python's `http.server` (no COOP/COEP headers) as `play/turrican2/` of a temporary site;
the test disks lie next to it in `test/` and are not part of the package. Kit: `arek 0.5.12`
(`wb-obraz.js` 1.3 sha256 9eda0e23…, `wb-seal.js` 519f83ff…). Date: 2026-10-23/24 (re-run 2026-10-24 after the start without the opening grid, after the 5 s Original start, smooth sky off, and after the content key).

| # | test | result |
|---|---|---|
| 1 | `arek web test` over the full matrix (dpr 1 / 1.25 / 1.5 / 2 × zoom × window × mode × detail; §5.1–5.4b) on the page with the game running | **OK** – 576 layouts + 864 picture checks, 0 failures |
| 2 | a recorded input from the start of 1-1 to its exit, replayed in the page, ends on the about screen | **OK** – the recorded run (`present/1-1-input.json`, recorded with `?record=1` on 2026-10-24) replayed tick for tick: the exit at tick 16,774 shows the about screen without errors; *Play level 1 again* starts 1-1 anew. The page now opens 1-1 without the opening grid (paused a second in Original, then Enhanced), so the 70 neutral grid ticks at the start of the recording (16,844 ticks) were removed; the run still reaches the exit at its last tick. |
| 3 | a wrong or unknown disk gives a message and no game; another version with the same game files plays | **OK** – a copy of disk 1 with a changed boot block byte starts the game (opened by the content key); disk 2 of the game and a copy of disk 1 with one byte changed inside `L1-1`: "This disk version is not accepted yet", with the disk sha256, the content id and the issues link; a 1000-byte file: "not a standard Amiga disk image"; no game code loaded |
| 4 | no request to another origin, nothing in the clear from the game | **OK** – 93 requests, all same-origin: 41 `*.sealed`, 12 open shell files, the test disk; every one listed in `manifest.json`; `crossOriginIsolated` false |
| 5 | `WBSEAL.open` with the disk key and the content key | **OK** – no disk, disk 2 and a short file: "no key for these disks"; disk 1 opens `native-combat.js` by the disk key; copies of disk 1 with one byte changed in the boot block (0x100) or in a sector no file uses (0xdbfff) open by the content key (`box.key.payload`); a copy with one byte changed inside `L1-1` is refused |

Replay determinism (for test 2): the page records one input per game tick (`?record=1`); a replay
(`?replay=URL`) of a 633-tick recording with movement, jumps, fire and a weapon change gave the same
player position, energy and score in all 633 ticks.
