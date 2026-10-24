# Turrican II: The Final Fight

Amiga, 1991 · developed by Factor 5 · published by Rainbow Arts.

## What you just played

The first level of a rebuild: the game's own 68000 code rewritten to JavaScript, routine by
routine, reading the graphics, maps, sounds and music from your disk. It is not an emulator; no
Amiga is being simulated. The ported code itself is sealed on this page and opens only with an
accepted disk; so far one version of disk 1 is verified (the [L]EGEND re-release), not yet an
original retail disk.

## What was measured

- The original runs in the vAmiga emulator as the reference. 154 recorded runs (about 98 minutes
  of play) are compared frame by frame with this rebuild in 24 categories of the game state:
  player, enemies, shots, random numbers, score, camera and more. 90 % of the 293,154 frames
  match in every category until the first difference.
- The picture of world 1-1 matches the emulator's frames at the checked moments in 99 % or
  more of the pixels; the end sequence and the story intro of the full rebuild are bit-exact
  against the original's memory.
- Every claim has an address in the disassembly or a measurement; the project keeps a ratchet
  that may only rise.

## Who and how

Directed by Štěpán Mikeš. Started on 4 September 2026 by Codex (OpenAI); this version was
continued from 5 October 2026 by Claude (Anthropic) in Claude Code: 197 of its 290 commits,
including worlds 2 to 5, the bosses, the ending and the title. Tools: the vAmiga emulator in a
headless build as the measuring instrument and the amiga-re-kit toolkit.

## Original and Enhanced

Original shows the game as it was: the 304 × 192 window and the original status bar. Enhanced
keeps the same rules at 50 Hz but widens the view to 448 × 256, moves smoothly at 60, 120 or
144 Hz, blends the scrolling background and sprites and draws a smooth status bar.

## Links

- [amiga-re-kit on the web](https://smikes75.github.io/amiga-re-kit/)
- [amiga-re-kit on GitHub](https://github.com/smikes75/amiga-re-kit)

*Original game © its rights holders. This rebuild needs your own disk image; it never leaves
your browser. Amiga is a trademark of its owner.*
