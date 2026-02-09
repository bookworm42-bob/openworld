# Asset License Notes

## Landmark imports (Poly Pizza)

### Tower — Quaternius
- Source page: https://poly.pizza/m/iuMDwgTRMU
- Downloaded file: `public/assets/poly-pizza/tower-quaternius.glb`
- License: **Public Domain (CC0 1.0)**
- License URL: https://creativecommons.org/publicdomain/zero/1.0/

### Windmill — Poly by Google
- Source page: https://poly.pizza/m/ctIRaIM3zXu
- Downloaded file: `public/assets/poly-pizza/windmill-poly-google.glb`
- License: **Creative Commons Attribution 3.0 (CC BY 3.0)**
- License URL: https://creativecommons.org/licenses/by/3.0/
- Required attribution text:
  - "Windmill" by Poly by Google via Poly Pizza (https://poly.pizza/m/ctIRaIM3zXu), licensed under CC BY 3.0.

### Damaged Grave — Kay Lousberg
- Source page: https://poly.pizza/m/KWtVNrHXVR
- Downloaded file: `public/assets/poly-pizza/damaged-grave-kay-lousberg.glb`
- License: **Public Domain (CC0 1.0)**
- License URL: https://creativecommons.org/publicdomain/zero/1.0/

### Broken Fence Pillar — Kay Lousberg
- Source page: https://poly.pizza/m/8RXyLygEeF
- Downloaded file: `public/assets/poly-pizza/broken-fence-pillar-kay-lousberg.glb`
- License: **Public Domain (CC0 1.0)**
- License URL: https://creativecommons.org/publicdomain/zero/1.0/

### Payload impact (T-033 micro accents)
- Added files raw sizes:
  - `damaged-grave-kay-lousberg.glb`: **40,800 bytes**
  - `broken-fence-pillar-kay-lousberg.glb`: **23,748 bytes**
- Added gzip estimate (level 9): **36,225 bytes total delta**
- Result: within T-033 budget constraint (<= 60 KB gzip delta).

### Payload impact (T-042 silhouette beacon pass)
- Newly placed silhouettes reuse already-imported assets only:
  - `public/assets/nature-kit/tree_oak.glb` (Kenney Nature Kit CC0)
  - `public/assets/poly-pizza/broken-fence-pillar-kay-lousberg.glb` (Poly Pizza CC0)
- New imported files: **none**
- Build payload delta attributable to T-042 imports: **0 bytes raw / 0 bytes gzip**
- Result: within T-042 budget constraint (<= 80 KB gzip delta).

## Deferred candidate (not imported)

### Modular Ruins Pack — Quaternius
- Source page: https://poly.pizza/m/F2LAK03B0r
- Direct model URL (from page metadata): https://static.poly.pizza/fa6cf69d-a091-4eb7-b62e-56290d8b9097.glb
- License: **Public Domain (CC0 1.0)**
- License URL: https://creativecommons.org/publicdomain/zero/1.0/
- Payload audit (2026-02-09):
  - Candidate GLB size: **7,965,364 bytes raw** (~7.6 MiB)
  - Candidate GLB gzip estimate: **2,701,915 bytes** (~2.58 MiB)
  - Current imported landmark payload baseline (tower + windmill): **299,400 bytes gzip**
- Decision: Over budget for current milestone target (~300 KB gzip). Do **not** import full pack; if needed, follow-up must selectively extract only 1-2 ruin pieces into a much smaller derived GLB and re-measure before merge.
