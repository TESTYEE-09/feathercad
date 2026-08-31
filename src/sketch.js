// sketch.js — 2D sketch drawing & editing on a work plane
import * as THREE from 'three';
import { planeBasis } from './doc.js';

const ACCENT = 0x2563eb;
const ACCENT_SEL = 0xf59e0b;

export class SketchEditor {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.renderOrder = 10;
    app.scene.add(this.group);

    this.sketch = null;        // sketch feature being edited
    this.tool = null;          // 'line' | 'rect' | 'circle' | 'polygon' | 'select'
    this.pending = [];         // points picked so far for current entity
    this.selectedEntity = -1;
    this.dragPoint = null;     // {entity, index}
    this.hoverSnap = null;     // [u, v]
    this.raycaster = new THREE.Raycaster();
    this._listeners();
  }

  get active() { return !!this.sketch; }

  setTool(tool) {
    if (!this.active) return;
    this.tool = tool;
    this.pending = [];
    this.selectedEntity = -1;
    this.app.ui.showSketchEntityProps(null);
    const hints = { line: 'Line — click points, double-click or right-click to finish', rect: 'Rectangle — click two corners', circle: 'Circle — click center, then radius', polygon: 'Polygon — click center, then a vertex', select: 'Select — click an entity to edit it' };
    this.app.ui.setHint(hints[tool] || '');
    this.redraw();
  }

  start(sketch) {
    this.sketch = sketch;
    this.tool = 'select';
    this.pending = [];
    this.selectedEntity = -1;
    this.app.ui.enterSketchMode(sketch);
    this.redraw();
  }

  stop() {
    this.sketch = null;
    this.tool = null;
    this.pending = [];
    this.app.ui.exitSketchMode();
    this.clear();
  }

  clear() {
    while (this.group.children.length) {
      const c = this.group.children.pop();
      c.geometry?.dispose();
      c.material?.dispose?.();
    }
  }

  /* ----- cursor <-> plane math ----- */

  cursorUV(event) {
    const rect = this.app.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.app.camera);
    const { origin, U, V, N } = planeBasis(this.sketch.plane);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(N, origin);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return null;
    const rel = hit.clone().sub(origin);
    return [rel.dot(U), rel.dot(V)];
  }

  snap(uv) {
    if (!uv) return null;
    const [u, v] = uv;
    // snap to existing endpoints first
    const tol = this.app.screenWorldTol(10);
    for (const e of this.sketch.entities) {
      const pts = e.type === 'polyline' ? e.pts : e.type === 'circle' ? [e.c] : [];
      for (const p of pts) {
        if (Math.hypot(p[0] - u, p[1] - v) < tol) return [p[0], p[1]];
      }
    }
    // grid snap 1mm
    return [Math.round(u), Math.round(v)];
  }

  /* ----- events ----- */

  _listeners() {
    const dom = this.app.renderer.domElement;
    dom.addEventListener('pointermove', e => {
      if (!this.active) return;
      const s = this.snap(this.cursorUV(e));
      if (JSON.stringify(s) !== JSON.stringify(this.hoverSnap)) {
        this.hoverSnap = s;
        this.redraw();
      }
    });
    dom.addEventListener('pointerdown', e => {
      if (!this.active || e.button !== 0) return;
      if (e.target !== dom) return;
      const uv = this.hoverSnap || this.snap(this.cursorUV(e));
      if (!uv) return;

      if (this.tool === 'select') {
        this._pickEntity(uv, e);
        return;
      }
      if (this.tool === 'line') {
        this.pending.push(uv);
        this.redraw();
      } else if (this.tool === 'rect') {
        this.pending.push(uv);
        if (this.pending.length === 2) {
          this._commitPolyline(this._rectPts(this.pending[0], this.pending[1]));
        }
      } else if (this.tool === 'circle') {
        this.pending.push(uv);
        if (this.pending.length === 2) {
          const r = Math.hypot(uv[0] - this.pending[0][0], uv[1] - this.pending[0][1]);
          if (r > 1e-3) this._commit({ type: 'circle', c: this.pending[0], r });
          else this.pending = [];
        }
      } else if (this.tool === 'polygon') {
        this.pending.push(uv);
        if (this.pending.length === 2) {
          const [c, p] = this.pending;
          const r = Math.hypot(p[0] - c[0], p[1] - c[1]);
          const a0 = Math.atan2(p[1] - c[1], p[0] - c[0]);
          const n = this.app.state.polygonSides || 6;
          const pts = [];
          for (let i = 0; i < n; i++) {
            const a = a0 + (i / n) * Math.PI * 2;
            pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
          }
          this._commitPolyline(pts);
        }
      }
      this.redraw();
    });
    dom.addEventListener('dblclick', () => {
      if (this.active && this.tool === 'line' && this.pending.length >= 3) {
        this._commitPolyline(this.pending);
      }
    });
    dom.addEventListener('contextmenu', e => {
      if (!this.active) return;
      e.preventDefault();
      if (this.tool === 'line' && this.pending.length >= 3) this._commitPolyline(this.pending);
      else { this.pending = []; this.redraw(); }
    });
  }

  _rectPts(a, b) {
    return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
  }

  _commitPolyline(pts) {
    pts = pts.map(p => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]);
    // drop consecutive duplicates (e.g. double-click registering two points)
    pts = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-6);
    if (pts.length < 3) { this.pending = []; return; }
    this._commit({ type: 'polyline', pts });
  }

  _commit(entity) {
    this.sketch.entities.push(entity);
    this.pending = [];
    this.app.commit(`Sketch ${this.sketch.name}`);
  }

  _pickEntity(uv, e) {
    const tol = this.app.screenWorldTol(8);
    let best = -1, bestD = tol;
    this.sketch.entities.forEach((ent, i) => {
      const d = this._distToEntity(ent, uv);
      if (d < bestD) { bestD = d; best = i; }
    });
    this.selectedEntity = best;
    this.app.ui.showSketchEntityProps(best >= 0 ? this.sketch.entities[best] : null);
    this.redraw();
  }

  _entityPoints(ent) { return ent.type === 'polyline' ? ent.pts : ent.type === 'circle' ? [ent.c] : []; }

  _distToEntity(ent, uv) {
    const pts = ent.type === 'polyline' ? ent.pts
      : ent.type === 'circle'
        ? Array.from({ length: 48 }, (_, i) => {
          const a = (i / 48) * Math.PI * 2;
          return [ent.c[0] + Math.cos(a) * ent.r, ent.c[1] + Math.sin(a) * ent.r];
        })
        : [];
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      best = Math.min(best, distToSeg(uv, a, b));
    }
    return best;
  }

  /* ----- rendering ----- */

  redraw() {
    this.clear();
    if (!this.active) return;
    const { origin, U, V, N } = planeBasis(this.sketch.plane);
    const m4 = new THREE.Matrix4().makeBasis(U, V, N).setPosition(origin);

    // plane grid (200x200mm, 10mm cells) as lines in sketch space
    const grid = new THREE.Group();
    const matMinor = new THREE.LineBasicMaterial({ color: 0x9ca3af, transparent: true, opacity: 0.25 });
    const matMajor = new THREE.LineBasicMaterial({ color: 0x6b7280, transparent: true, opacity: 0.45 });
    const addLine = (a, b, mat) => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a, 0), new THREE.Vector3(...b, 0)]);
      grid.add(new THREE.Line(g, mat));
    };
    for (let i = -10; i <= 10; i++) {
      const mat = i % 5 === 0 ? matMajor : matMinor;
      addLine([i * 10, -100], [i * 10, 100], mat);
      addLine([-100, i * 10], [100, i * 10], mat);
    }
    grid.applyMatrix4(m4);
    this.group.add(grid);

    // entities
    const pts3 = (p) => new THREE.Vector3(p[0], p[1], 0).applyMatrix4(m4);
    this.sketch.entities.forEach((ent, i) => {
      const sel = i === this.selectedEntity;
      const mat = new THREE.LineBasicMaterial({ color: sel ? ACCENT_SEL : ACCENT, depthTest: false });
      let line;
      if (ent.type === 'circle') {
        const pts = [];
        for (let k = 0; k <= 64; k++) {
          const a = (k / 64) * Math.PI * 2;
          pts.push([ent.c[0] + Math.cos(a) * ent.r, ent.c[1] + Math.sin(a) * ent.r]);
        }
        line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(pts3)), mat);
      } else if (ent.type === 'polyline') {
        if (ent.pts.length < 2) return;
        const closed = ent.pts.length >= 3;
        const pts = closed ? [...ent.pts, ent.pts[0]] : ent.pts;
        line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(pts3)), mat);
      }
      if (line) { line.renderOrder = 11; this.group.add(line); }
    });

    // pending preview
    if (this.pending.length && this.hoverSnap && this.tool) {
      const cur = this.hoverSnap;
      const mat = new THREE.LineBasicMaterial({ color: 0x6b7280, depthTest: false });
      let pts = [];
      if (this.tool === 'line') pts = [...this.pending, cur];
      else if (this.tool === 'rect' && this.pending.length === 1) pts = this._rectPts(this.pending[0], cur).concat([this.pending[0]]);
      else if (this.tool === 'circle' && this.pending.length === 1) {
        const c = this.pending[0], r = Math.hypot(cur[0] - c[0], cur[1] - c[1]);
        pts = Array.from({ length: 65 }, (_, k) => {
          const a = (k / 64) * Math.PI * 2;
          return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
        });
      } else if (this.tool === 'polygon' && this.pending.length === 1) {
        const c = this.pending[0], r = Math.hypot(cur[0] - c[0], cur[1] - c[1]);
        const a0 = Math.atan2(cur[1] - c[1], cur[0] - c[0]);
        const n = this.app.state.polygonSides || 6;
        pts = Array.from({ length: n + 1 }, (_, i) => {
          const a = a0 + (i / n) * Math.PI * 2;
          return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
        });
      }
      if (pts.length > 1) {
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(pts3)), mat);
        l.renderOrder = 11;
        this.group.add(l);
      }
    }

    // vertex handles
    const handlePos = [];
    this.sketch.entities.forEach(ent => {
      for (const p of this._entityPoints(ent)) handlePos.push(pts3(p));
    });
    if (this.pending.length) for (const p of this.pending) handlePos.push(pts3(p));
    if (handlePos.length) {
      const g = new THREE.BufferGeometry().setFromPoints(handlePos);
      const pm = new THREE.PointsMaterial({ color: ACCENT, size: 5, sizeAttenuation: false, depthTest: false });
      const p = new THREE.Points(g, pm);
      p.renderOrder = 12;
      this.group.add(p);
    }
  }
}

function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
