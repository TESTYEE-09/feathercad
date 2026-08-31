// ui.js — DOM layout, feature tree, properties panel, modals
import { exportSTL, exportOBJ, export3MF, download } from './exporters.js';
import { ORIGIN_PLANES } from './doc.js';

/* ---------- tiny DOM helper ---------- */
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}

/* ---------- icons (minimal 24px line style) ---------- */
const I = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}${extra}</svg>`;

export const ICONS = {
  select: I('<path d="M5 3l14 8-6.5 1.5L9 19z"/>'),
  sketch: I('<path d="M17 3l4 4L8 20l-5 1 1-5z"/>'),
  line: I('<path d="M4 20L20 4"/><circle cx="4" cy="20" r="1.5"/><circle cx="20" cy="4" r="1.5"/>'),
  rect: I('<rect x="4" y="6" width="16" height="12" rx="1"/>'),
  circle: I('<circle cx="12" cy="12" r="8"/>'),
  polygon: I('<path d="M12 3l7.8 5.6-3 9.4H7.2l-3-9.4z"/>'),
  extrude: I('<path d="M4 20h16M7 20V9l5-4 5 4v11"/><path d="M12 16v-6m0 0l-2.5 2.5M12 10l2.5 2.5"/>'),
  revolve: I('<ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M19 9a8 8 0 0 1-2 8"/><path d="M19 9l1.5-2.5M19 9l-3-.5"/>'),
  box: I('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9"/>'),
  cylinder: I('<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/>'),
  sphere: I('<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="9" ry="3.5"/>'),
  cone: I('<path d="M12 3L5 18M12 3l7 15"/><ellipse cx="12" cy="18" rx="7" ry="3"/>'),
  torus: I('<ellipse cx="12" cy="12" rx="9" ry="6"/><ellipse cx="12" cy="12" rx="3.5" ry="2"/>'),
  move: I('<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>'),
  pattern: I('<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h3M14 12h3"/>'),
  undo: I('<path d="M8 5L3 10l5 5"/><path d="M3 10h11a6 6 0 0 1 0 12h-4"/>'),
  redo: I('<path d="M16 5l5 5-5 5"/><path d="M21 10H10a6 6 0 0 0 0 12h4"/>'),
  export: I('<path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v3h16v-3"/>'),
  save: I('<path d="M5 3h11l4 4v14H5z"/><path d="M8 3v5h7V3M8 13h8v8H8z"/>'),
  open: I('<path d="M3 6h6l2 2h10v11H3z"/>'),
  grid: I('<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>'),
  theme: I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  fit: I('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  trash: I('<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>'),
  edit: I('<path d="M17 3l4 4L8 20l-5 1 1-5z"/>'),
  camera: I('<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13" r="4"/><path d="M9 7l1.5-3h3L15 7"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  check: I('<path d="M4 12l5 5L20 6"/>'),
};

const svgBtn = (icon, title, onclick, cls = 'tb-btn') =>
  el('button', { class: cls, title, html: ICONS[icon], onclick });

/* ---------- UI class ---------- */

export class UI {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('app');

    this._buildLayout();
  }

  _buildLayout() {
    this.root.innerHTML = '';

    /* top bar */
    const app = this.app;
    this.topbar = el('header', { class: 'topbar' },
      el('div', { class: 'logo' }, 'Feather', el('span', {}, 'CAD')),
      this.docNameInput = el('input', { class: 'doc-name', value: app.docName || 'Untitled', title: 'Document name',
        onchange: () => { app.docName = this.docNameInput.value; app.saveLocal(); } }),
      el('div', { class: 'tb-sep' }),
      svgBtn('undo', 'Undo (Ctrl+Z)', () => app.undo()),
      svgBtn('redo', 'Redo (Ctrl+Y)', () => app.redo()),
      el('div', { class: 'tb-sep' }),
      svgBtn('fit', 'Fit view (F)', () => app.fitView()),
      svgBtn('grid', 'Toggle grid', () => app.toggleGrid()),
      svgBtn('camera', 'Save screenshot', () => app.screenshot()),
      el('div', { class: 'tb-sep' }),
      svgBtn('open', 'Open (.json)', () => app.openJson()),
      svgBtn('save', 'Save (.json)', () => app.saveJson()),
      el('div', { class: 'spacer' }),
      svgBtn('theme', 'Toggle theme', () => app.toggleTheme()),
      svgBtn('export', 'Export', () => this.exportModal(), 'tb-btn primary'),
    );

    /* tool rail */
    const railDefs = [
      ['select', 'Select (V)', () => app.setTool('select')],
      ['sketch', 'New sketch (S)', () => app.startSketchPick()],
      null, // separator
      ['extrude', 'Extrude (E)', () => app.startExtrude()],
      ['revolve', 'Revolve', () => app.startRevolve()],
      null,
      ['box', 'Box', () => app.addPrimitive('box')],
      ['cylinder', 'Cylinder', () => app.addPrimitive('cylinder')],
      ['sphere', 'Sphere', () => app.addPrimitive('sphere')],
      ['cone', 'Cone', () => app.addPrimitive('cone')],
      ['torus', 'Torus', () => app.addPrimitive('torus')],
      null,
      ['move', 'Move (M)', () => app.setTool('move')],
      ['pattern', 'Linear pattern', () => app.addPattern()],
    ];
    this.rail = el('nav', { class: 'rail' },
      railDefs.map(d => d ? svgBtn(d[0], d[1], d[2], 'rail-btn') : el('div', { class: 'rail-sep' })));
    this.railButtons = {};
    [...this.rail.children].forEach((b, i) => { if (railDefs[i]) this.railButtons[railDefs[i][0]] = b; });

    /* left panel */
    this.tree = el('ul', { class: 'tree' });
    this.sketchToolsBar = el('div', { class: 'sketch-tools hidden' },
      svgBtn('line', 'Line (L)', () => app.sketchEditor.setTool('line')),
      svgBtn('rect', 'Rectangle (R)', () => app.sketchEditor.setTool('rect')),
      svgBtn('circle', 'Circle (C)', () => app.sketchEditor.setTool('circle')),
      svgBtn('polygon', 'Polygon (P)', () => app.sketchEditor.setTool('polygon')),
      el('span', { class: 'st-label' }, 'sides'),
      this.sidesInput = el('input', { class: 'mini-num', type: 'number', min: 3, max: 64, value: 6,
        oninput: () => { app.state.polygonSides = +this.sidesInput.value || 6; } }),
      el('div', { class: 'flex-grow' }),
      el('button', { class: 'btn ok', onclick: () => app.finishSketch() }, 'Finish sketch'),
    );
    this.leftPanel = el('aside', { class: 'panel left' },
      el('div', { class: 'panel-head' }, 'Feature tree'),
      this.tree,
      this.sketchToolsBar,
    );

    /* right panel */
    this.props = el('div', { class: 'props-body' });
    this.rightPanel = el('aside', { class: 'panel right' },
      el('div', { class: 'panel-head' }, 'Properties'),
      this.props,
    );

    /* viewport + status bar */
    this.viewport = el('div', { class: 'viewport', id: 'viewport' });
    this.statusHint = el('span', {}, 'Ready');
    this.statusStats = el('span', { class: 'stats' }, '');
    this.statusbar = el('footer', { class: 'statusbar' }, this.statusHint, el('span', { class: 'flex-grow' }), this.statusStats);

    this.root.append(this.topbar, el('div', { class: 'main' }, this.rail, this.leftPanel, this.viewport, this.rightPanel), this.statusbar);
  }

  setHint(t) { this.statusHint.textContent = t; }
  setStats(t) { this.statusStats.textContent = t; }
  toast(msg, kind = 'info') {
    const t = el('div', { class: `toast ${kind}` }, msg);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
  }

  /* ----- tool rail active state ----- */
  setActiveTool(name) {
    Object.entries(this.railButtons).forEach(([k, b]) => b.classList.toggle('active', k === name));
  }

  /* ----- feature tree ----- */
  renderTree() {
    const app = this.app;
    this.tree.innerHTML = '';
    const TYPE_ICON = { sketch: 'sketch', extrude: 'extrude', revolve: 'revolve', primitive: app.feature?.prim || 'box', transform: 'move', pattern: 'pattern' };
    for (const f of [...app.doc.features].reverse()) {
      const icon = f.type === 'primitive' ? (f.prim || 'box') : TYPE_ICON[f.type];
      const li = el('li', {
        class: 'tree-item' + (f.id === app.state.selectedId ? ' selected' : '') + (f.id === app.state.editingSketchId ? ' editing' : '') + (app.state.errors[f.id] ? ' error' : ''),
        onclick: () => app.selectFeature(f.id),
        ondblclick: () => { if (f.type === 'sketch') app.editSketch(f.id); },
      },
        el('span', { class: 'tree-icon', html: ICONS[icon] || ICONS.box }),
        el('span', { class: 'tree-name' }, f.name || f.type),
        el('span', { class: 'tree-type' }, f.type),
      );
      this.tree.append(li);
    }
    if (!app.doc.features.length) {
      this.tree.append(el('li', { class: 'tree-empty' }, 'No features yet. Press S to start a sketch, or add a primitive.'));
    }
  }

  /* ----- properties ----- */
  renderProps() {
    const app = this.app;
    const P = this.props;
    P.innerHTML = '';

    // sketch tool active: plane picker
    if (app.state.tool === 'sketch-pick') {
      P.append(el('div', { class: 'props-title' }, 'New sketch'),
        el('div', { class: 'hint' }, 'Pick an origin plane or click a flat face of a body.'));
      for (const [id, p] of Object.entries(ORIGIN_PLANES)) {
        P.append(el('button', { class: 'btn wide', onclick: () => app.createSketchOnOriginPlane(id) }, p.name + ' plane'));
      }
      P.append(el('button', { class: 'btn wide subtle', onclick: () => app.setTool('select') }, 'Cancel'));
      return;
    }

    const f = app.selectedFeature();
    if (f) this.featureProps(f);
    else P.append(el('div', { class: 'hint' }, 'Select a feature in the tree, or create one from the left rail.'));
  }

  fieldRow(label, input) {
    return el('label', { class: 'frow' }, el('span', {}, label), input);
  }

  numField(value, oninput, opts = {}) {
    const i = el('input', {
      class: 'num', type: 'number', value,
      step: opts.step ?? 1, min: opts.min ?? '', disabled: opts.disabled ? '' : undefined,
    });
    i.addEventListener('input', () => oninput(i.value === '' ? (opts.default ?? 0) : +i.value));
    i.addEventListener('change', () => { if (this.app) this.app.commit(opts.label || 'Edit'); });
    return i;
  }

  selectField(options, value, onchange) {
    const s = el('select', { class: 'sel' },
      options.map(([v, t]) => el('option', { value: v, ...(v === value ? { selected: '' } : {}) }, t)));
    s.addEventListener('change', () => onchange(s.value));
    return s;
  }

  featureProps(f) {
    const app = this.app;
    const P = this.props;
    P.append(el('div', { class: 'props-title' }, f.name || f.type));
    const rename = el('input', { class: 'text', value: f.name || '', onchange: () => { f.name = rename.value || f.type; app.commit('Rename'); } });
    P.append(this.fieldRow('Name', rename));

    if (f.type === 'sketch') {
      const planeName = f.plane.kind === 'origin' ? ORIGIN_PLANES[f.plane.id].name + ' plane' : 'Face';
      P.append(this.fieldRow('Plane', el('span', { class: 'static' }, planeName)),
        el('div', { class: 'props-title' }, `Entities (${f.entities.length})`));
      f.entities.forEach((e, i) => {
        const label = e.type === 'circle' ? `Circle r=${(+e.r).toFixed(1)}` : e.type === 'polyline' ? `Polyline (${e.pts.length} pts)` : e.type;
        P.append(el('div', { class: 'entity-row' + (app.sketchEditor.selectedEntity === i ? ' selected' : ''),
          onclick: () => { app.editSketch(f.id); app.sketchEditor.selectedEntity = i; app.sketchEditor.redraw(); } }, label));
      });
      P.append(el('button', { class: 'btn wide primary', onclick: () => app.editSketch(f.id) }, 'Edit sketch'));
    }

    if (f.type === 'primitive') {
      const prim = f.prim, p = f.params;
      const upd = () => app.softRebuild();
      const num = (v, cb, o) => this.numField(v, x => { cb(x); upd(); }, o);
      if (prim === 'box') P.append(
        this.fieldRow('Width X', num(p.w, v => p.w = v)),
        this.fieldRow('Height Y', num(p.h, v => p.h = v)),
        this.fieldRow('Depth Z', num(p.d, v => p.d = v)));
      if (prim === 'cylinder' || prim === 'cone') P.append(
        this.fieldRow('Radius', num(p.r, v => p.r = v, { min: 0.1 })),
        this.fieldRow('Height', num(p.h, v => p.h = v, { min: 0.1 })));
      if (prim === 'sphere') P.append(this.fieldRow('Radius', num(p.r, v => p.r = v, { min: 0.1 })));
      if (prim === 'torus') P.append(
        this.fieldRow('Radius', num(p.r, v => p.r = v, { min: 0.1 })),
        this.fieldRow('Tube', num(p.tube, v => p.tube = v, { min: 0.1 })));
      P.append(el('div', { class: 'props-title' }, 'Position'));
      for (const [k, axis] of [['x', 'X'], ['y', 'Y'], ['z', 'Z']]) {
        P.append(this.fieldRow(axis, num(f.position[axis], v => f.position[k] = v)));
      }
      P.append(el('div', { class: 'props-title' }, 'Boolean'));
      P.append(this.fieldRow('Operation', this.selectField([['new', 'New body'], ['add', 'Add (union)']], f.op, v => { f.op = v; app.commit('Boolean'); })));
      if (f.op === 'add') P.append(this.fieldRow('Target', this.bodySelect(f, v => { f.target = v; app.commit('Target'); })));
    }

    if (f.type === 'extrude' || f.type === 'revolve') {
      const sk = app.getSketch(f.sketchId);
      P.append(this.fieldRow('Sketch', el('span', { class: 'static' }, sk ? sk.name : 'missing!')));
      if (f.type === 'extrude') {
        P.append(this.fieldRow('Distance', this.numField(f.distance, v => { f.distance = v; app.softRebuild(); }, { label: 'Extrude distance' })));
        P.append(this.fieldRow('', el('label', { class: 'check' },
          el('input', { type: 'checkbox', ...(f.symmetric ? { checked: '' } : {}), onchange: e => { f.symmetric = e.target.checked; app.commit('Symmetric'); } }),
          ' Symmetric')));
      } else {
        P.append(this.fieldRow('Angle °', this.numField(f.angle, v => { f.angle = v; app.softRebuild(); }, { label: 'Revolve angle' })));
        P.append(this.fieldRow('Axis', this.selectField([['u', 'Sketch X'], ['v', 'Sketch Y']], f.axis || 'u', v => { f.axis = v; app.commit('Axis'); })));
      }
      P.append(el('div', { class: 'props-title' }, 'Boolean'));
      P.append(this.fieldRow('Operation', this.selectField(
        [['new', 'New body'], ['add', 'Add (union)'], ['cut', 'Cut (subtract)']], f.op,
        v => { f.op = v; app.commit('Operation'); })));
      if (f.op !== 'new') {
        P.append(this.fieldRow('Target', this.bodySelect(f, v => { f.target = v; app.commit('Target'); }, f.op === 'cut')));
      }
    }

    if (f.type === 'transform') {
      P.append(this.fieldRow('Body', el('span', { class: 'static' }, app.bodyName(f.bodyId))));
      P.append(el('div', { class: 'props-title' }, 'Offset'));
      for (const [k, axis] of [['x', 'X'], ['y', 'Y'], ['z', 'Z']]) {
        P.append(this.fieldRow(axis, this.numField(f.pos[k], v => { f.pos[k] = v; app.softRebuild(); }, { label: 'Move' })));
      }
      P.append(el('div', { class: 'props-title' }, 'Rotation °'));
      for (const [k, axis] of [['x', 'X'], ['y', 'Y'], ['z', 'Z']]) {
        P.append(this.fieldRow(axis, this.numField(f.rot[k], v => { f.rot[k] = v; app.softRebuild(); }, { label: 'Rotate' })));
      }
      P.append(el('div', { class: 'hint' }, 'Drag the gizmo in the viewport, or type values here.'));
    }

    if (f.type === 'pattern') {
      P.append(this.fieldRow('Body', el('span', { class: 'static' }, app.bodyName(f.bodyId))));
      P.append(this.fieldRow('Direction', this.selectField(
        [['x', '+X'], ['y', '+Y'], ['z', '+Z']],
        f.dirKey || 'x', v => { f.dirKey = v; f.dir = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[v]; app.commit('Direction'); })));
      P.append(this.fieldRow('Count', this.numField(f.count, v => { f.count = Math.max(1, v); app.softRebuild(); }, { min: 1, label: 'Pattern count' })));
      P.append(this.fieldRow('Spacing', this.numField(f.spacing, v => { f.spacing = v; app.softRebuild(); }, { label: 'Pattern spacing' })));
    }

    // danger zone
    P.append(el('div', { class: 'props-title' }, ''));
    P.append(el('button', { class: 'btn wide danger', onclick: () => app.deleteSelected() }, 'Delete feature'));
  }

  bodySelect(forFeature, onchange, excludeSelf = false) {
    const app = this.app;
    const opts = app.state.bodies.map(b => [b.id, b.name]);
    if (!opts.length) opts.push(['', '— no bodies —']);
    return this.selectField(opts, forFeature.target || (opts[0]?.[0] ?? ''), onchange);
  }

  showSketchEntityProps(entity) {
    const app = this.app;
    const P = this.props;
    // rebuild props but append entity editor
    if (!entity) { this.renderProps(); return; }
    this.renderProps();
    P.append(el('div', { class: 'props-title' }, 'Entity'));
    if (entity.type === 'circle') {
      P.append(this.fieldRow('Center X', this.numField(entity.c[0], v => { entity.c[0] = v; app.sketchEditor.redraw(); }, { label: 'Edit sketch' })));
      P.append(this.fieldRow('Center Y', this.numField(entity.c[1], v => { entity.c[1] = v; app.sketchEditor.redraw(); }, { label: 'Edit sketch' })));
      P.append(this.fieldRow('Radius', this.numField(entity.r, v => { entity.r = Math.max(0.1, v); app.sketchEditor.redraw(); }, { label: 'Edit sketch', min: 0.1 })));
    } else if (entity.type === 'polyline') {
      entity.pts.forEach((p, i) => {
        P.append(this.fieldRow(`P${i + 1}`, el('span', { class: 'static' }, `X ${p[0].toFixed(1)}, Y ${p[1].toFixed(1)} (drag in sketch)`)));
      });
    }
    P.append(el('button', { class: 'btn wide danger', onclick: () => {
      const sk = app.sketchEditor.sketch;
      const i = sk.entities.indexOf(entity);
      if (i >= 0) { sk.entities.splice(i, 1); app.sketchEditor.selectedEntity = -1; app.commit('Delete entity'); app.ui.showSketchEntityProps(null); }
    } }, 'Delete entity'));
    P.append(el('div', { class: 'hint' }, 'Changes apply when you press Finish sketch.'));
  }

  /* ----- sketch mode chrome ----- */
  enterSketchMode(sketch) {
    this.sketchToolsBar.classList.remove('hidden');
    this.tree.classList.add('dimmed');
    this.setHint(`Sketch — ${sketch.name}. L line · R rect · C circle · P polygon · Esc finish`);
  }
  exitSketchMode() {
    this.sketchToolsBar.classList.add('hidden');
    this.tree.classList.remove('dimmed');
    this.setHint('Ready');
  }

  /* ----- export modal ----- */
  exportModal() {
    const app = this.app;
    if (!app.state.bodies.length) { this.toast('Nothing to export yet', 'warn'); return; }
    const root = document.getElementById('modalRoot');
    root.innerHTML = '';

    let format = '3mf';
    const bodyOpts = [['all', 'Whole part (all bodies)']].concat(app.state.bodies.map(b => [b.id, b.name]));
    let scope = 'all';

    const fmtSel = this.selectField([['3mf', '3MF — Bambu Studio (recommended)'], ['stl', 'STL (binary)'], ['obj', 'OBJ']], format, v => format = v);
    const scopeSel = this.selectField(bodyOpts, scope, v => scope = v);

    const close = () => { root.innerHTML = ''; };
    const doExport = () => {
      const bodies = scope === 'all' ? app.state.bodies : app.state.bodies.filter(b => b.id === scope);
      const name = (app.docName || 'part').replace(/[^\w-]+/g, '_');
      const blob = format === 'stl' ? exportSTL(bodies) : format === 'obj' ? exportOBJ(bodies) : export3MF(bodies, app.docName);
      download(blob, `${name}.${format}`);
      this.toast(`Exported ${name}.${format} (${bodies.length} body${bodies.length > 1 ? 'ies' : ''}) — drop it into Bambu Studio`, 'ok');
      close();
    };

    const modal = el('div', { class: 'modal-back', onclick: e => { if (e.target === modal) close(); } },
      el('div', { class: 'modal' },
        el('div', { class: 'modal-title' }, 'Export'),
        this.fieldRow('Format', fmtSel),
        this.fieldRow('Bodies', scopeSel),
        el('div', { class: 'hint' }, 'Units are millimetres, Z-up — ready for Bambu Studio / PrusaSlicer / Cura.'),
        el('div', { class: 'modal-actions' },
          el('button', { class: 'btn', onclick: close }, 'Cancel'),
          el('button', { class: 'btn primary', onclick: doExport }, 'Export'),
        )));
    root.append(modal);
  }
}
