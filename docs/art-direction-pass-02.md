# Art Direction Pass 02 (v2)

## Visual direction summary
This pass pushes a **storybook dusk** look: fewer competing colors, clearer value grouping, and stronger landmark silhouettes from spawn.

- Palette intent: compress scene tones into a 5-color dusk ramp inspired by Lospec Twilight 5 (`#fbbbad #ee8695 #4a7a96 #333f58 #292831`)
- Composition intent: landmarks should read in three depth bands (near/mid/far) with subtle warm accents against cool fog
- Material intent: keep stylized low-poly flat shading; avoid realistic texture drift

## Reference + research notes
- Palette reference: Lospec Twilight 5 — https://lospec.com/palette-list/twilight-5
- Free low-poly source (already integrated): Kenney Nature Kit, CC0 — https://kenney.nl/assets/nature-kit
- Candidate ruins kit: Poly Pizza “Modular Ruins Pack” by Quaternius, marked Public Domain (CC0) — https://poly.pizza/m/F2LAK03B0r
- Existing landmark licensing baseline:
  - Tower (Quaternius) CC0 — https://poly.pizza/m/iuMDwgTRMU
  - Windmill (Poly by Google) CC BY 3.0 — https://poly.pizza/m/ctIRaIM3zXu

## Top priorities (this run)
1. Re-grade sky/fog/terrain toward the dusk 5-color ramp while preserving gameplay readability.
2. Validate whether Modular Ruins can fit current gzip budget before import (or cherry-pick only 1–2 meshes).
3. Run a scored readability playtest (spawn/mid/far) to confirm silhouette and horizon separation gains.

## Risks / constraints
- **Performance:** full ruins kit import may exceed budget; prefer selective extraction and mesh reuse.
- **License hygiene:** any CC BY assets require persistent attribution text in-project docs.
- **Style coherence:** realistic PBR maps can clash with current low-poly character + terrain language.
