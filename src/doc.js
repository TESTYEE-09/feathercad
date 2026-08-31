// doc.js — document model, profile building, rebuild engine (geometry kernel)
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/* ---------- planes ---------- */

export const ORIGIN_PLANES = {
  top:   { name: 'Top',   normal: [0, 1, 0], u: [1, 0, 0],  v: [0, 0, -1] },
  front: { name: 'Front', normal: [0, 0, 1], u: [1, 0, 0],  v: [0, 1, 0] },
  right: { name: 'Right', normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
};

export function planeBasis(plane) {
  if (plane.kind === 'origin') plane = ORIGIN_PLANES[plane.id] || ORIGIN_PLANES.top;
  const origin = new THREE.Vector3(...(plane.origin || [0, 0, 0]));
  const U = new THREE.Vector3(...plane.u);
  const V = new THREE.Vector3(...plane.v);
  const N = new THREE.Vector3(...plane.normal);
  return { origin, U, V, N };
}

// map sketch (u,v) -> world, with optional height along normal
export function planePoint(plane, u, v, h = 0) {
  const { origin, U, V, N } = planeBasis(plane);
  return origin.clone()
    .addScaledVector(U, u)
    .addScaledVector(V, v)
    .addScaledVector(N, h);
}

export function makeFacePlane(point, normal) {
  const N = normal.clone().normalize();
  // choose stable in-plane axes
  let up = Math.abs(N.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const U = new THREE.Vector3().crossVectors(up, N).normalize();
  const V = new THREE.Vector3().crossVectors(N, U).normalize();
  return {
    kind: 'face',
    normal: N.toArray(),
    origin: point.toArray(),
    u: U.toArray(),
    v: V.toArray(),
  };
}

/* ---------- loops, shapes, profiles ---------- */

function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > pt[1]) !== (yj > pt[1])) &&
      (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function loopPtsFromEntity(e) {
  if (e.type === 'polyline') {
    return e.pts.length >= 3 ? e.pts.map(p => [p[0], p[1]]) : null;
  }
  if (e.type === 'circle') {
    const pts = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      pts.push([e.c[0] + Math.cos(a) * e.r, e.c[1] + Math.sin(a) * e.r]);
    }
    return pts;
  }
  return null;
}

export function sketchLoops(sketch) {
  const loops = [];
  for (const e of sketch.entities) {
    const pts = loopPtsFromEntity(e);
    if (pts) loops.push({ pts, entity: e });
  }
  return loops;
}

// Build THREE.Shape[] with holes from sketch loops
export function buildShapes(loops) {
  const data = loops.map(l => ({ ...l, area: Math.abs(polyArea(l.pts)) }));
  // parent = smallest loop strictly containing this one
  for (const d of data) {
    let best = null;
    for (const o of data) {
      if (o === d || o.area <= d.area) continue;
      if (pointInPoly(d.pts[0], o.pts)) {
        if (!best || o.area < best.area) best = o;
      }
    }
    d.parent = best;
  }
  const shapes = [];
  for (const d of data) {
    if (d.parent) continue;
    const shape = new THREE.Shape(d.pts.map(p => new THREE.Vector2(p[0], p[1])));
    for (const h of data) {
      if (h.parent === d) {
        shape.holes.push(new THREE.Path(h.pts.map(p => new THREE.Vector2(p[0], p[1]))));
      }
    }
    shapes.push(shape);
  }
  return shapes;
}

/* ---------- feature geometry builders ---------- */

export function buildExtrudeGeometry(sketch, feat) {
  const loops = sketchLoops(sketch);
  if (!loops.length) throw new Error('Sketch is empty');
  const shapes = buildShapes(loops);
  const { origin, U, V, N } = planeBasis(sketch.plane);
  const dist = feat.distance ?? 10;
  const geos = shapes.map(s => new THREE.ExtrudeGeometry(s, {
    depth: 1, bevelEnabled: false, curveSegments: 48,
  }));
  for (const g of geos) {
    g.scale(1, 1, feat.symmetric ? dist / 2 : dist);
    if (feat.symmetric) g.translate(0, 0, -0.5);
    g.applyMatrix4(new THREE.Matrix4().makeBasis(U, V, N).setPosition(origin));
  }
  return geos.length === 1 ? geos[0] : mergeGeometries(geos);
}

export function buildRevolveGeometry(sketch, feat) {
  const loops = sketchLoops(sketch);
  if (!loops.length) throw new Error('Sketch is empty');
  const { origin, U, V } = planeBasis(sketch.plane);
  const axisU = feat.axis === 'u';
  const axisDir = axisU ? U : V;          // revolve axis direction (world)
  const radial = axisU ? V : U;           // initial radial direction
  const angle = ((feat.angle ?? 360) * Math.PI) / 180;
  const segs = Math.max(8, Math.ceil(64 * (angle / (Math.PI * 2))));
  const geos = [];
  for (const loop of loops) {
    // lathe profile: x = radius, y = height along axis
    const pts = loop.pts.map(([u, v]) => {
      const t = axisU ? u : v;
      const r = axisU ? v : u;
      // exact 0 keeps on-axis points as single welded cone tips
      return new THREE.Vector2(Math.abs(r) < 1e-9 ? 0 : Math.abs(r), t);
    });
    // close the loop for a solid revolve
    const closed = pts.length >= 3 &&
      pts[0].distanceTo(pts[pts.length - 1]) < 1e-6 ? pts : [...pts, pts[0].clone()];
    const g = new THREE.LatheGeometry(closed, segs, 0, angle);
    geos.push(g);
  }
  const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos);
  const xBasis = radial.clone(), yBasis = axisDir.clone();
  const zBasis = new THREE.Vector3().crossVectors(xBasis, yBasis);
  geo.applyMatrix4(new THREE.Matrix4().makeBasis(xBasis, yBasis, zBasis).setPosition(origin));
  ensureOutward(geo);
  return geo;
}

// flip winding if signed volume is negative (inward normals)
export function ensureOutward(geo) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const tri = idx ? idx.array : null;
  let vol = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = tri ? tri.length / 3 : pos.count / 3;
  for (let i = 0; i < n; i++) {
    const i0 = tri ? tri[i * 3] : i * 3, i1 = tri ? tri[i * 3 + 1] : i * 3 + 1, i2 = tri ? tri[i * 3 + 2] : i * 3 + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    vol += a.dot(b.clone().cross(c)) / 6;
  }
  if (vol < 0 && idx) {
    for (let i = 0; i < tri.length; i += 3) {
      const t = tri[i + 1]; tri[i + 1] = tri[i + 2]; tri[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
  geo.computeVertexNormals();
  return geo;
}

const PRIM_BUILDERS = {
  box: p => new THREE.BoxGeometry(p.w, p.h, p.d),
  cylinder: p => new THREE.CylinderGeometry(p.r, p.r, p.h, 48),
  sphere: p => new THREE.SphereGeometry(p.r, 48, 32),
  cone: p => new THREE.ConeGeometry(p.r, p.h, 48),
  torus: p => new THREE.TorusGeometry(p.r, p.tube, 24, 64),
};

export function buildPrimitiveGeometry(feat) {
  const g = PRIM_BUILDERS[feat.prim](feat.params);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...(feat.position || [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(
      ...(feat.rotation || [0, 0, 0]).map(d => d * Math.PI / 180))),
    new THREE.Vector3(1, 1, 1),
  );
  g.applyMatrix4(m);
  return g;
}

/* ---------- booleans (manifold-3d kernel) ---------- */

let M = null;
export async function initKernel() {
  if (M) return;
  const wasm = await import('manifold-3d/lib/wasm.js');
  // browser (vite): point emscripten at the wasm asset explicitly
  try {
    const { default: wasmUrl } = await import('manifold-3d/manifold.wasm?url');
    wasm.setWasmUrl(wasmUrl);
  } catch { /* node: resolves the wasm itself */ }
  M = await wasm.getManifoldModule();
}

function toManifold(geo) {
  // strip to position-only, snap to a fine grid, then weld coincident verts.
  // snapping avoids mergeVertices' hash-grid boundary effects (micro-cracks
  // between faces that should share an edge)
  const src = geo.attributes.position;
  const snapped = new Float32Array(src.count * 3);
  for (let i = 0; i < src.count * 3; i++) snapped[i] = Math.round(src.array[i] * 1e5) / 1e5;
  const bare = new THREE.BufferGeometry();
  bare.setAttribute('position', new THREE.BufferAttribute(snapped, 3));
  if (geo.index) bare.setIndex(geo.index.clone()); // keep the real triangle list
  const welded = mergeVertices(bare, 1e-4);
  const pos = welded.attributes.position;
  const mesh = new M.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(pos.array.buffer, pos.array.byteOffset, pos.count * 3),
    triVerts: new Uint32Array(welded.index.array),
  });
  const man = new M.Manifold(mesh);
  const st = man.status();
  if (st !== 'NoError') throw new Error('Geometry error: ' + st);
  return man;
}

function fromManifold(man) {
  const mesh = man.getMesh();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.vertProperties), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export function booleanOp(geomA, geomB, op) {
  if (!M) throw new Error('Kernel not initialised');
  const a = toManifold(geomA), b = toManifold(geomB);
  return fromManifold(op === 'cut' ? a.subtract(b) : a.add(b));
}

/* ---------- rebuild engine ---------- */

export function rebuild(doc) {
  const bodies = [];          // {id, name, geometry}
  const errors = {};          // featureId -> message
  const sketches = {};        // featureId -> sketch feature

  const findBody = id => bodies.find(b => b.id === id);
  const primaryBody = () => bodies[0] || null;

  for (const f of doc.features) {
    try {
      switch (f.type) {
        case 'sketch':
          sketches[f.id] = f;
          break;

        case 'primitive': {
          const geo = buildPrimitiveGeometry(f);
          if (f.op === 'add' && f.target && findBody(f.target)) {
            findBody(f.target).geometry = booleanOp(findBody(f.target).geometry, geo, 'add');
          } else if (f.op === 'cut') {
            if (f.target && findBody(f.target)) {
              findBody(f.target).geometry = booleanOp(findBody(f.target).geometry, geo, 'cut');
            } else {
              for (const b of bodies) b.geometry = booleanOp(b.geometry, geo, 'cut');
            }
          } else {
            bodies.push({ id: f.id, name: f.name, geometry: geo });
          }
          break;
        }

        case 'extrude':
        case 'revolve': {
          const sk = sketches[f.sketchId];
          if (!sk) throw new Error('Missing sketch');
          const geo = f.type === 'extrude'
            ? buildExtrudeGeometry(sk, f)
            : buildRevolveGeometry(sk, f);
          if (f.op === 'cut') {
            if (f.target && findBody(f.target)) {
              findBody(f.target).geometry = booleanOp(findBody(f.target).geometry, geo, 'cut');
            } else {
              for (const b of bodies) b.geometry = booleanOp(b.geometry, geo, 'cut');
            }
          } else if (f.op === 'add' && f.target && findBody(f.target)) {
            findBody(f.target).geometry = booleanOp(findBody(f.target).geometry, geo, 'add');
          } else {
            bodies.push({ id: f.id, name: f.name, geometry: geo });
          }
          break;
        }

        case 'transform': {
          const b = findBody(f.bodyId);
          if (b) {
            const m = new THREE.Matrix4().compose(
              new THREE.Vector3(...(f.pos || [0, 0, 0])),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(
                ...(f.rot || [0, 0, 0]).map(d => d * Math.PI / 180))),
              new THREE.Vector3(1, 1, 1),
            );
            b.geometry = b.geometry.clone().applyMatrix4(m);
          }
          break;
        }

        case 'pattern': {
          const b = findBody(f.bodyId);
          if (b) {
            const base = b.geometry;
            const dir = new THREE.Vector3(...(f.dir || [1, 0, 0])).normalize();
            for (let i = 1; i < (f.count || 2); i++) {
              const g = base.clone();
              g.translate(dir.x * f.spacing * i, dir.y * f.spacing * i, dir.z * f.spacing * i);
              b.geometry = booleanOp(b.geometry, g, 'add');
            }
          }
          break;
        }
      }
    } catch (err) {
      errors[f.id] = err.message || String(err);
    }
  }
  return { bodies, errors, sketches };
}

/* ---------- doc helpers ---------- */

export function newDoc() {
  return { features: [] };
}

let counter = 0;
export function uid() {
  return 'f' + Date.now().toString(36) + (counter++).toString(36);
}

export function nextName(doc, base) {
  let n = 1;
  for (const f of doc.features) {
    const m = f.name && f.name.match(new RegExp('^' + base + ' (\\d+)$'));
    if (m) n = Math.max(n, +m[1] + 1);
  }
  return `${base} ${n}`;
}

export function getSketch(doc, id) {
  return doc.features.find(f => f.id === id && f.type === 'sketch') || null;
}
