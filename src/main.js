// main.js — FeatherCAD application core
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EdgesGeometry, LineSegments, LineBasicMaterial } from 'three';

import {
  newDoc, uid, nextName, rebuild, initKernel, ORIGIN_PLANES, planeBasis, makeFacePlane,
} from './doc.js';
import { SketchEditor } from './sketch.js';
import { UI } from './ui.js';

const LS_KEY = 'feathercad:doc';

const PRIM_DEFAULTS = {
  box: { w: 20, h: 20, d: 20, place: p => [0, p.h / 2, 0], rot: () => [0, 0, 0] },
  cylinder: { r: 10, h: 20, place: p => [0, p.h / 2, 0], rot: () => [0, 0, 0] },
  sphere: { r: 12, place: p => [0, p.r, 0], rot: () => [0, 0, 0] },
  cone: { r: 10, h: 20, place: p => [0, p.h / 2, 0], rot: () => [0, 0, 0] },
  torus: { r: 12, tube: 4, place: p => [0, p.tube, 0], rot: () => [90, 0, 0] },
};

class App {
  constructor() {
    this.doc = newDoc();
    this.docName = 'Untitled';
    this.state = {
      tool: 'select', selectedId: null, editingSketchId: null,
      bodies: [], errors: {}, polygonSides: 6,
    };
    this.history = [];
    this.historyIndex = -1;

    this.ui = new UI(this);
    this._initThree();
    this.sketchEditor = new SketchEditor(this);
    this._loadLocal();
    this._bindEvents();

    this.setTool('select');
    this.rebuildScene();
    this.commitSilent();
    this.fitView();
    this.animate();
  }

  /* ================= three.js setup ================= */

  _initThree() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    this.camera.position.set(120, 90, 120);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.ui.viewport.append(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;

    // lights
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1));
    const d1 = new THREE.DirectionalLight(0xffffff, 1.4);
    d1.position.set(1, 2, 1.2);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.5);
    d2.position.set(-1.5, 0.6, -1);
    this.scene.add(d1, d2);

    // groups
    this.bodiesGroup = new THREE.Group();
    this.planesGroup = new THREE.Group();
    this.planesGroup.visible = false;
    this.scene.add(this.bodiesGroup, this.planesGroup);

    // part material
    this.partMaterial = new THREE.MeshStandardMaterial({
      color: 0x9aa7b8, metalness: 0.05, roughness: 0.55,
    });
    this.selMaterial = new THREE.MeshStandardMaterial({
      color: 0x9aa7b8, metalness: 0.05, roughness: 0.55, emissive: 0x2563eb, emissiveIntensity: 0.35,
    });

    this._buildGrid();
    this._buildOriginPlanes();
    this._initTransformControls();
  }

  _buildGrid() {
    if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose(); }
    const dark = document.body.classList.contains('dark');
    this.grid = new THREE.GridHelper(400, 40, dark ? 0x374151 : 0xd1d5db, dark ? 0x1f2937 : 0xe5e7eb);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.9;
    this.scene.add(this.grid);
    // axes
    const axes = new THREE.Group();
    const mk = (dir, color) => {
      const g = new THREE.BufferGeometry().setFromPoints(
        [dir.clone().multiplyScalar(-200), dir.clone().multiplyScalar(200)]);
      return new LineSegments(g, new LineBasicMaterial({ color, transparent: true, opacity: 0.6 }));
    };
    axes.add(mk(new THREE.Vector3(1, 0, 0), 0xef4444));
    axes.add(mk(new THREE.Vector3(0, 0, 1), 0x3b82f6));
    this.axesGroup = axes;
    this.scene.add(axes);
  }

  _buildOriginPlanes() {
    for (const [id, p] of Object.entries(ORIGIN_PLANES)) {
      const { U, V } = planeBasis(p);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(80, 80),
        new THREE.MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
      );
      const m = new THREE.Matrix4().makeBasis(U, V, new THREE.Vector3().crossVectors(U, V));
      mesh.applyMatrix4(m);
      mesh.userData.planeId = id;
      this.planesGroup.add(mesh);
    }
  }

  _initTransformControls() {
    this.tc = new TransformControls(this.camera, this.renderer.domElement);
    this.tc.setSize(0.8);
    const helper = this.tc.getHelper ? this.tc.getHelper() : this.tc;
    this.scene.add(helper);
    this.tc.addEventListener('dragging-changed', e => {
      this.controls.enabled = !e.value;
      if (!e.value && this._moveCtx) this._endMove();
    });
    this.tc.addEventListener('objectChange', () => this._updateMove());
  }

  /* ================= rebuild & history ================= */

  rebuildScene() {
    const { bodies, errors } = rebuild(this.doc);
    this.state.bodies = bodies;
    this.state.errors = errors;

    // dispose old
    for (const c of [...this.bodiesGroup.children]) {
      c.geometry?.dispose();
      this.bodiesGroup.remove(c);
    }
    this.meshById = {};
    for (const b of bodies) {
      const mesh = new THREE.Mesh(b.geometry, this.partMaterial);
      mesh.userData.bodyId = b.id;
      // clean CAD-style edges
      const edges = new LineSegments(
        new EdgesGeometry(b.geometry, 25),
        new LineBasicMaterial({ color: 0x1f2937, transparent: true, opacity: 0.35 }),
      );
      mesh.add(edges);
      this.bodiesGroup.add(mesh);
      this.meshById[b.id] = mesh;
    }
    this._applySelection();
    this.ui.renderTree();
    const tris = bodies.reduce((n, b) => n + (b.geometry.index ? b.geometry.index.count : b.geometry.attributes.position.count) / 3, 0);
    this.ui.setStats(`${bodies.length} ${bodies.length === 1 ? 'body' : 'bodies'} · ${Math.round(tris).toLocaleString()} triangles · mm`);
  }

  softRebuild() { this.rebuildScene(); }

  commitSilent() {
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(JSON.stringify({ doc: this.doc, docName: this.docName }));
    if (this.history.length > 100) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this._saveLocal();
  }

  commit(label) {
    this.rebuildScene();
    this.commitSilent();
    if (label) this.ui.setHint(label + ' ✓');
  }

  undo() {
    if (this.historyIndex <= 0) return;
    this.historyIndex--;
    this._restore(this.history[this.historyIndex]);
  }
  redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex++;
    this._restore(this.history[this.historyIndex]);
  }
  _restore(json) {
    const { doc, docName } = JSON.parse(json);
    this.doc = doc;
    this.docName = docName;
    this.ui.docNameInput.value = docName;
    this.state.selectedId = null;
    this._detachMove();
    if (this.sketchEditor.active) this.sketchEditor.stop();
    this.rebuildScene();
    this.ui.renderProps();
    this._saveLocal();
  }

  _saveLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        docName: this.docName, doc: this.doc, theme: document.body.classList.contains('dark') ? 'dark' : 'light',
      }));
    } catch { /* storage full / disabled */ }
  }
  _loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const { docName, doc, theme } = JSON.parse(raw);
      if (doc?.features) { this.doc = doc; this.docName = docName || 'Untitled'; }
      if (theme === 'dark') { document.body.classList.add('dark'); this._buildGrid(); }
    } catch { /* corrupt */ }
  }

  /* ================= selection & tools ================= */

  selectedFeature() {
    return this.doc.features.find(f => f.id === this.state.selectedId) || null;
  }
  getSketch(id) {
    return this.doc.features.find(f => f.id === id && f.type === 'sketch') || null;
  }
  bodyName(id) {
    return this.state.bodies.find(b => b.id === id)?.name || '—';
  }

  selectFeature(id) {
    if (this.sketchEditor.active) return;
    this.state.selectedId = id;
    this._applySelection();
    this.ui.renderTree();
    this.ui.renderProps();
  }

  _applySelection() {
    for (const [id, mesh] of Object.entries(this.meshById || {})) {
      mesh.material = id === this.state.selectedId ? this.selMaterial : this.partMaterial;
    }
  }

  setTool(tool) {
    if (this.sketchEditor.active && tool !== 'select') return;
    this.state.tool = tool;
    this._detachMove();
    this.tc.enabled = false;
    this.tc.visible = false;
    this.planesGroup.visible = tool === 'sketch-pick';
    this.ui.setActiveTool(tool === 'sketch-pick' ? 'sketch' : tool);
    const hints = {
      select: 'Ready — click a body to select it',
      move: 'Move — click a body, then drag the gizmo',
      'sketch-pick': 'Sketch — pick an origin plane (blue) or click a flat face of a body',
    };
    this.ui.setHint(hints[tool] || 'Ready');
    this.ui.renderProps();
  }

  /* ----- move (transform) ----- */

  setToolMove() { this.setTool('move'); }

  _beginMove(bodyId) {
    const mesh = this.meshById[bodyId];
    if (!mesh) return;
    const box = new THREE.Box3().setFromObject(mesh);
    const proxy = new THREE.Object3D();
    proxy.position.copy(box.getCenter(new THREE.Vector3()));
    this.scene.add(proxy);
    this.tc.enabled = true;
    this.tc.visible = true;
    this.tc.attach(proxy);
    this._moveCtx = { bodyId, proxy, start: proxy.matrix.clone() };
    this.state.selectedId = bodyId;
    this._applySelection();
  }

  _updateMove() {
    const ctx = this._moveCtx;
    if (!ctx) return;
    ctx.proxy.updateMatrix();
    const delta = ctx.proxy.matrix.clone().multiply(ctx.start.clone().invert());
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    delta.decompose(pos, quat, scl);
    const f = this._ensureTransformFeature(ctx.bodyId);
    f.pos = [pos.x, pos.y, pos.z].map(v => Math.round(v * 100) / 100);
    const e = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
    f.rot = [e.x, e.y, e.z].map(v => Math.round(v * 180 / Math.PI * 10) / 10);
    this.softRebuild();
    this.ui.renderProps();
  }

  _ensureTransformFeature(bodyId) {
    const idx = this.doc.features.findIndex(f => f.id === bodyId);
    if (idx < 0) return null;
    // reuse an existing transform directly after the creator
    let i = idx + 1;
    while (i < this.doc.features.length && this.doc.features[i].type === 'transform' && this.doc.features[i].bodyId === bodyId) {
      return this.doc.features[i];
    }
    const f = {
      id: uid(), type: 'transform', name: nextName(this.doc, 'Move'),
      bodyId, pos: [0, 0, 0], rot: [0, 0, 0],
    };
    this.doc.features.splice(idx + 1, 0, f);
    return f;
  }

  _endMove() {
    this._detachMove();
    this.commit('Move');
  }

  _detachMove() {
    if (this._moveCtx) {
      this.scene.remove(this._moveCtx.proxy);
      this._moveCtx = null;
    }
    this.tc.detach?.();
  }

  /* ----- sketching ----- */

  startSketchPick() {
    if (this.sketchEditor.active) return;
    this.setTool('sketch-pick');
  }

  createSketchOnOriginPlane(planeId) {
    const sketch = {
      id: uid(), type: 'sketch', name: nextName(this.doc, 'Sketch'),
      plane: { kind: 'origin', id: planeId }, entities: [],
    };
    this.doc.features.push(sketch);
    this.commit('New sketch');
    this.setTool('select');
    this.sketchEditor.start(sketch);
  }

  editSketch(id) {
    const sk = this.getSketch(id);
    if (!sk || this.sketchEditor.active) return;
    this.setTool('select');
    this.sketchEditor.start(sk);
    this.state.editingSketchId = id;
  }

  finishSketch() {
    if (!this.sketchEditor.active) return;
    this.state.editingSketchId = null;
    this.sketchEditor.stop();
    this.commit('Finish sketch');
    this.setTool('select');
  }

  /* ----- features ----- */

  startExtrude() {
    const sk = this._targetSketch();
    if (!sk) { this.ui.toast('Select a sketch in the tree first (or draw one with S)', 'warn'); return; }
    const f = {
      id: uid(), type: 'extrude', name: nextName(this.doc, 'Extrude'),
      sketchId: sk.id, distance: 10, symmetric: false,
      op: this.state.bodies.length ? 'add' : 'new',
      target: this.state.bodies[0]?.id || null,
    };
    this.doc.features.push(f);
    this.state.selectedId = f.id;
    this.commit('Extrude');
  }

  startRevolve() {
    const sk = this._targetSketch();
    if (!sk) { this.ui.toast('Select a sketch in the tree first', 'warn'); return; }
    const f = {
      id: uid(), type: 'revolve', name: nextName(this.doc, 'Revolve'),
      sketchId: sk.id, angle: 360, axis: 'u',
      op: this.state.bodies.length ? 'add' : 'new',
      target: this.state.bodies[0]?.id || null,
    };
    this.doc.features.push(f);
    this.state.selectedId = f.id;
    this.commit('Revolve');
  }

  _targetSketch() {
    const sel = this.selectedFeature();
    if (sel?.type === 'sketch') return sel;
    const sketches = this.doc.features.filter(f => f.type === 'sketch');
    return sketches[sketches.length - 1] || null;
  }

  addPrimitive(prim) {
    if (this.sketchEditor.active) return;
    const def = PRIM_DEFAULTS[prim];
    const params = { ...def };
    delete params.place; delete params.rot;
    const f = {
      id: uid(), type: 'primitive', name: nextName(this.doc, prim[0].toUpperCase() + prim.slice(1)),
      prim, params,
      position: def.place(params), rotation: def.rot(params),
      op: this.state.bodies.length ? 'add' : 'new',
      target: this.state.bodies[0]?.id || null,
    };
    this.doc.features.push(f);
    this.state.selectedId = f.id;
    this.commit(prim);
  }

  addPattern() {
    const body = this.state.bodies.find(b => b.id === this.state.selectedId) || this.state.bodies[0];
    if (!body) { this.ui.toast('Create something first', 'warn'); return; }
    const f = {
      id: uid(), type: 'pattern', name: nextName(this.doc, 'Pattern'),
      bodyId: body.id, dirKey: 'x', dir: [1, 0, 0], count: 3, spacing: 20,
    };
    this.doc.features.push(f);
    this.state.selectedId = f.id;
    this.commit('Pattern');
  }

  deleteSelected() {
    const f = this.selectedFeature();
    if (!f) return;
    this.doc.features = this.doc.features.filter(x => x.id !== f.id);
    this.state.selectedId = null;
    this.commit('Delete ' + (f.name || f.type));
    this.ui.renderProps();
  }

  /* ================= picking ================= */

  _bindEvents() {
    const dom = this.renderer.domElement;
    let downPos = null;
    dom.addEventListener('pointerdown', e => { downPos = [e.clientX, e.clientY]; });
    dom.addEventListener('pointerup', e => {
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
      downPos = null;
      if (moved > 5 || e.button !== 0) return;
      if (this.sketchEditor.active || this.tc.dragging) return;
      this._handleClick(e);
    });

    // resize
    new ResizeObserver(() => {
      const w = this.ui.viewport.clientWidth, h = this.ui.viewport.clientHeight;
      if (!w || !h) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }).observe(this.ui.viewport);

    // keyboard
    window.addEventListener('keydown', e => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); this.redo(); return; }
      if (this.sketchEditor.active) {
        if (k === 'escape') { this.sketchEditor.pending.length > 0 ? (this.sketchEditor.pending = [], this.sketchEditor.redraw()) : this.finishSketch(); return; }
        if (k === 'l') this.sketchEditor.setTool('line');
        if (k === 'r') this.sketchEditor.setTool('rect');
        if (k === 'c') this.sketchEditor.setTool('circle');
        if (k === 'p') this.sketchEditor.setTool('polygon');
        return;
      }
      if (k === 'escape') this.setTool('select');
      if (k === 'v') this.setTool('select');
      if (k === 's') this.startSketchPick();
      if (k === 'e') this.startExtrude();
      if (k === 'm') this.setTool('move');
      if (k === 'f') this.fitView();
      if (k === 'r' && this.state.tool === 'move') { this.tc.setMode(this.tc.mode === 'translate' ? 'rotate' : 'translate'); }
      if (k === 'delete' || k === 'backspace') this.deleteSelected();
    });
  }

  _handleClick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster ??= new THREE.Raycaster();
    this._raycaster.setFromCamera(ndc, this.camera);

    // sketch plane picking
    if (this.state.tool === 'sketch-pick') {
      const hits = this._raycaster.intersectObjects(this.planesGroup.children, false);
      if (hits.length) { this.createSketchOnOriginPlane(hits[0].object.userData.planeId); return; }
      // face picking
      const meshHits = this._raycaster.intersectObjects(this.bodiesGroup.children, false);
      if (meshHits.length) {
        const h = meshHits[0];
        const n = h.face.normal.clone()
          .applyMatrix3(new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld))
          .normalize();
        const plane = makeFacePlane(h.point, n);
        const sketch = {
          id: uid(), type: 'sketch', name: nextName(this.doc, 'Sketch'),
          plane, entities: [],
        };
        this.doc.features.push(sketch);
        this.commit('New sketch on face');
        this.setTool('select');
        this.sketchEditor.start(sketch);
        return;
      }
      return;
    }

    // body picking
    const hits = this._raycaster.intersectObjects(this.bodiesGroup.children, false);
    if (hits.length) {
      const bodyId = hits[0].object.userData.bodyId;
      if (this.state.tool === 'move') this._beginMove(bodyId);
      else this.selectFeature(bodyId);
    } else if (this.state.tool !== 'move') {
      this.selectFeature(null);
    }
  }

  /* ================= misc ================= */

  screenWorldTol(px) {
    const dist = this.camera.position.length();
    const h = 2 * Math.tan((this.camera.fov / 2) * Math.PI / 180) * dist;
    return (px * h) / this.renderer.domElement.clientHeight;
  }

  fitView() {
    const box = new THREE.Box3();
    if (this.state.bodies.length) {
      for (const m of this.bodiesGroup.children) box.expandByObject(m);
    } else {
      box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(100, 100, 100));
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 100;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, size * 1.8);
    this.controls.update();
  }

  toggleGrid() {
    this.grid.visible = !this.grid.visible;
    this.axesGroup.visible = this.grid.visible;
  }

  toggleTheme() {
    document.body.classList.toggle('dark');
    this._buildGrid();
    this._saveLocal();
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = (this.docName || 'feathercad') + '.png';
    a.click();
    this.ui.toast('Screenshot saved');
  }

  saveJson() {
    const blob = new Blob([JSON.stringify({ app: 'feathercad', version: 1, docName: this.docName, doc: this.doc })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (this.docName || 'part').replace(/[^\w-]+/g, '_') + '.feathercad.json';
    a.click();
    this.ui.toast('Saved .json — keep it in your drive');
  }

  openJson() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      file.text().then(text => {
        const data = JSON.parse(text);
        if (!data.doc?.features) throw new Error('bad file');
        this.doc = data.doc;
        this.docName = data.docName || 'Imported';
        this.ui.docNameInput.value = this.docName;
        this.state.selectedId = null;
        this.rebuildScene();
        this.commitSilent();
        this.fitView();
        this.ui.toast('Opened ' + file.name, 'ok');
      }).catch(() => this.ui.toast('Could not read that file', 'warn'));
    };
    input.click();
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

initKernel().then(() => {
  const app = new App();
  if (location.search.includes('e2e')) {
    import('./e2e.js').then(m => m.runE2E(app));
  }
});
