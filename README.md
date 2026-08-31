# FeatherCAD

A minimal, fast, web-based parametric CAD. Built for school laptops that can't run
Fusion 360 and wifi that can't stream Onshape — it's a static web page: load it
once, then every computation happens locally in the browser.

![FeatherCAD](https://img.shields.io/badge/units-mm-blue) ![kernel](https://img.shields.io/badge/kernel-manifold--3d-2563eb)

## Run it

```bash
npm install
npm run dev        # development server
npm run build      # production build -> dist/
npm run preview    # serve the production build on your LAN
```

### Sharing with classmates (bad-wifi friendly)

```bash
npm run build
npm run preview -- --host
```

Then everyone on the same network opens `http://<your-ip>:4173/`. The whole app
is ~190 KB gzipped, loads once, and never needs the network again. It also works
from a USB stick — just open `dist/index.html`… actually, serve it (`npx serve dist`)
because browsers block module scripts on `file://`.

Or push `dist/` to GitHub Pages / Netlify / any static host.

## Features

- **Sketching** — line, rectangle, circle, polygon on the origin planes or
  directly on any flat face of a solid. 1 mm grid snap, endpoint snap, live
  preview, click-to-edit entities, delete entities.
- **Solid features** — extrude (add / cut / new body, symmetric option),
  revolve (360° or partial, around sketch X or Y), primitives (box, cylinder,
  sphere, cone, torus).
- **Modelling helpers** — move/rotate gizmo, linear pattern, rename anything.
- **Feature tree** — everything is parametric: edit any feature's numbers later
  and the whole part rebuilds (in milliseconds).
- **History** — full undo/redo, autosave to browser storage, save/open `.json`
  project files.
- **Export** — **3MF** (Bambu Studio native), **STL** (binary), **OBJ**, plus
  PNG screenshots. All exports are millimetres, Z-up, watertight — drop
  straight into Bambu Studio / PrusaSlicer / Cura.
- Clean light/dark themes.

## Keyboard

| Key | Action |
|-----|--------|
| `V` | Select |
| `S` | New sketch (pick plane or face) |
| `L` / `R` / `C` / `P` | Line / Rectangle / Circle / Polygon (while sketching) |
| `Esc` | Finish sketch / cancel tool |
| `E` | Extrude (select a sketch first) |
| `M` | Move (click a body, drag gizmo; `R` toggles rotate mode) |
| `F` | Fit view |
| `Del` | Delete selected feature |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |

## How it works

- **three.js** for rendering, orbit controls and the transform gizmo.
- **manifold-3d** (WASM) as the boolean geometry kernel — rock-solid,
  watertight booleans in milliseconds.
- Sketches are 2D profiles; `ExtrudeGeometry` / `LatheGeometry` turn them into
  solids, which the kernel unions/subtracts into bodies.
- The document is an ordered feature list; rebuilding replays it top to
  bottom, so editing feature #2 correctly re-computes features #3+.

## Tips for printing

- Model in mm; the top origin plane's positive normal is **up** in the slicer
  after export (exports are converted to Z-up automatically).
- One body exports as one part; use *New body* operations to model multiple
  parts in one document and export them individually from the export dialog.
