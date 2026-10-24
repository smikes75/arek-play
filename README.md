# arek play

First levels of Amiga games, rebuilt with [amiga-re-kit](https://github.com/smikes75/amiga-re-kit)
and playable in a browser **with your own disk image**.

| game | play | needs |
|---|---|---|
| Superfrog (Team17, 1993), level 1 Magic Woods | [superfrog/](https://smikes75.github.io/arek-play/superfrog/) | disk 1 |
| Alien Breed Special Edition 92 (Team17, 1992), level 1 | [alienbreed/](https://smikes75.github.io/arek-play/alienbreed/) | disks 1 and 2 |
| Turrican II (Factor 5 / Rainbow Arts, 1991), world 1-1 | [turrican2/](https://smikes75.github.io/arek-play/turrican2/) | disk 1 |

## What is here, and what is not

- **No game data.** No graphics, maps, music or levels are in this repository or on the pages.
  Everything the games show comes from the disk image you load; it never leaves your browser.
- **Code derived from the games is sealed.** The games' own 68000 code was translated ahead of time
  to WebAssembly (`arek recomp`). Those files (`*/sealed/*.sealed`) are encrypted with a key computed
  from the contents of the original disk (`arek web seal`); without the disk they are noise. Only disk
  versions that were verified are accepted; the page tells you which.
- **The rest is ordinary web code** (pages, menus, the display and sound layers), MIT licensed.
- There is no CPU interpreter and no Kickstart: the translated code runs on our own model of the
  Amiga chipset. Each game's *About* screen says how it was built and what was measured.

Each folder is a self-contained bundle made by the game's own project and checked with
`arek web check` (no game data, every derived file sealed, manifest matching the files).

Original games © their rights holders. Amiga is a trademark of its owner. Questions and requests:
open an issue.
