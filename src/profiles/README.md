# profiles

Diagram profiles (`<name>.yaml`) for the schematic layout, bundled into the app: `?profile=<name>` loads `<name>.yaml`.

These files are **working copies for the trial stage**. The canonical files are managed in the playground repository
(`profiles/<network>/<snapshot>/profile.yaml`). In the final form the profiles are given by the backend (netomox-exp)
and these copies are removed (see `src/render/layout/schematic/profileSource.ts`).
