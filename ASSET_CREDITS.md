# Asset Credits

All third-party 3D models, HDRIs and materials were obtained from the [Patch](https://patch.gg) asset library through its public API (`https://patch.gg/api/v1`) by `scripts/fetch-patch-assets.mjs`. Every file is verified against the SHA-256 published by Patch. Patch's `credit` line is reproduced verbatim for each asset.

## Changes made in this game (CC BY 4.0 "indicate changes")

Models are loaded unmodified from the downloaded GLB files; at runtime the game rescales them, recolours material tints for team identification (enemy livery), and re-orients them to the flight model axes. Terrain textures are tiled and blended by height/slope in a custom shader.

No endorsement by the creators, Scenario, Poly Haven or Patch is implied.

### Orange fighter jet — `scenario:asset_AFJ7WNJT3rSULDLBwTXmqD7U`

- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (CC-BY-4.0)
- Source: Scenario <https://huggingface.co/datasets/scenario-labs/3d-collection/blob/55b4c002b4c1529fc48da3dff98516c3069bfa3f/assets/scenario_asset_AFJ7WNJT3rSULDLBwTXmqD7U/output.glb>
- AI-generated: yes (Meshy text-to-3D)
- License duties: attribute, link-license, indicate-changes, no-endorsement, no-added-restrictions
- Used for: Player fighter jet (variant `web-lod1`); Enemy fighter jets (variant `web-lod2`)
- Credit line: asset_AFJ7WNJT3rSULDLBwTXmqD7U ("Orange fighter jet", title by Patch) by Scenario (Scenario, https://huggingface.co/datasets/scenario-labs/3d-collection/blob/55b4c002b4c1529fc48da3dff98516c3069bfa3f/assets/scenario_asset_AFJ7WNJT3rSULDLBwTXmqD7U/output.glb), licensed Creative Commons Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/). AI-generated with Meshy text-to-3D. Changed by Patch: pivot moved to the bottom centre, credit and license added to the file metadata, simplified LODs added.

### Red vintage fighter plane — `scenario:12162a48873f808d`

- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (CC-BY-4.0)
- Source: Scenario <https://huggingface.co/datasets/scenario-labs/3d-collection/blob/55b4c002b4c1529fc48da3dff98516c3069bfa3f/assets/12162a48873f808d/0e72556a81c774f2.glb>
- AI-generated: yes (gpt-6-astra (coding agent) 3D-to-3D)
- License duties: attribute, link-license, indicate-changes, no-endorsement, no-added-restrictions
- Used for: Enemy propeller fighters (bandits) (variant `web-lod1`)
- Credit line: 12162a48873f808d ("Red vintage fighter plane", title by Patch) by Scenario (Scenario, https://huggingface.co/datasets/scenario-labs/3d-collection/blob/55b4c002b4c1529fc48da3dff98516c3069bfa3f/assets/12162a48873f808d/0e72556a81c774f2.glb), licensed Creative Commons Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/). AI-generated with gpt-6-astra (coding agent) 3D-to-3D. Changed by Patch: pivot moved to the bottom centre, credit and license added to the file metadata, simplified LODs added.

### Coast Line 01 — `polyhaven:coast_line_01`

- License: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) (CC0-1.0)
- Source: Poly Haven <https://polyhaven.com/a/coast_line_01>
- Used for: Photogrammetry rocky shoreline set dressing (variant `web-lod2`)
- Credit line: "Coast Line 01" by Rob Tuytel and Rico Cilliers (Poly Haven, https://polyhaven.com/a/coast_line_01), licensed CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/). Changed by Patch: packed the 1K glTF into one GLB, pivot moved to the bottom centre, credit added to the file, simplified LODs added.

### Kloofendal 43d Clear (Pure Sky) — `polyhaven:kloofendal_43d_clear_puresky`

- License: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) (CC0-1.0)
- Source: Poly Haven <https://polyhaven.com/a/kloofendal_43d_clear_puresky>
- Used for: Sky background + image based lighting (variant `web`)
- Credit line: "Kloofendal 43d Clear (Pure Sky)" by Greg Zaal (Poly Haven, https://polyhaven.com/a/kloofendal_43d_clear_puresky), licensed CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/). Changed by Patch: 1K HDR selected, tonemapped JPEG background added, credit added to each file.

### Aerial Grass Rock — `polyhaven:aerial_grass_rock`

- License: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) (CC0-1.0)
- Source: Poly Haven <https://polyhaven.com/a/aerial_grass_rock>
- Used for: Terrain: grass/rock layer (variant `web`)
- Credit line: "Aerial Grass Rock" by Rob Tuytel (Poly Haven, https://polyhaven.com/a/aerial_grass_rock), licensed CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/). Changed by Patch: 1K JPEG maps selected, credit added to each file.

### Aerial Rocks 02 — `polyhaven:aerial_rocks_02`

- License: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) (CC0-1.0)
- Source: Poly Haven <https://polyhaven.com/a/aerial_rocks_02>
- Used for: Terrain: mountain rock layer (variant `web`)
- Credit line: "Aerial Rocks 02" by Rob Tuytel (Poly Haven, https://polyhaven.com/a/aerial_rocks_02), licensed CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/). Changed by Patch: 1K JPEG maps selected, credit added to each file.

### Aerial Beach 01 — `polyhaven:aerial_beach_01`

- License: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) (CC0-1.0)
- Source: Poly Haven <https://polyhaven.com/a/aerial_beach_01>
- Used for: Terrain: beach layer (variant `web`)
- Credit line: "Aerial Beach 01" by Rob Tuytel (Poly Haven, https://polyhaven.com/a/aerial_beach_01), licensed CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/). Changed by Patch: 1K JPEG maps selected, credit added to each file.

## Code

Three.js (MIT) — https://threejs.org
