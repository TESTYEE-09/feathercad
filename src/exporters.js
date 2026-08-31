// exporters.js — STL (binary), OBJ, 3MF, all in millimeters with Z-up for slicers
import * as THREE from 'three';
import { zipSync, strToU8 } from 'fflate';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// three.js is Y-up; slicers (Bambu Studio etc.) expect Z-up
function toZUp(geometry) {
  const g = geometry.clone();
  const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2); // (x, y, z) -> (x, -z, y)... apply via basis
  m.set(
    1, 0, 0, 0,
    0, 0, -1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
  );
  g.applyMatrix4(m);
  g.computeVertexNormals();
  return g;
}

export function mergedGeometry(bodies) {
  const geos = bodies.map(b => b.geometry);
  return geos.length === 1 ? geos[0] : mergeGeometries(geos);
}

/* ---------- STL (binary) ---------- */

export function exportSTL(bodies) {
  const geo = toZUp(mergedGeometry(bodies));
  const pos = geo.attributes.position;
  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  const header = 'FeatherCAD binary STL (mm)';
  for (let i = 0; i < 80; i++) view.setUint8(i, i < header.length ? header.charCodeAt(i) : 32);
  view.setUint32(80, triCount, true);
  let off = 84;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), cb = new THREE.Vector3(), n = new THREE.Vector3();
  const writeTri = (i0, i1, i2) => {
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    cb.subVectors(c, b); ab.subVectors(a, b);
    n.crossVectors(cb, ab).normalize();
    view.setFloat32(off, n.x, true); view.setFloat32(off + 4, n.y, true); view.setFloat32(off + 8, n.z, true);
    off += 12;
    for (const v of [a, b, c]) {
      view.setFloat32(off, v.x, true); view.setFloat32(off + 4, v.y, true); view.setFloat32(off + 8, v.z, true);
      off += 12;
    }
    view.setUint16(off, 0, true); off += 2;
  };
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) writeTri(idx.array[i], idx.array[i + 1], idx.array[i + 2]);
  } else {
    for (let i = 0; i < pos.count; i += 3) writeTri(i, i + 1, i + 2);
  }
  return new Blob([buffer], { type: 'model/stl' });
}

/* ---------- OBJ ---------- */

export function exportOBJ(bodies) {
  const geo = toZUp(mergedGeometry(bodies));
  const pos = geo.attributes.position;
  const idx = geo.index;
  const lines = ['# FeatherCAD export (mm)', 'o Part'];
  for (let i = 0; i < pos.count; i++) {
    lines.push(`v ${pos.getX(i).toFixed(4)} ${pos.getY(i).toFixed(4)} ${pos.getZ(i).toFixed(4)}`);
  }
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      lines.push(`f ${idx.array[i] + 1} ${idx.array[i + 1] + 1} ${idx.array[i + 2] + 1}`);
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      lines.push(`f ${i + 1} ${i + 2} ${i + 3}`);
    }
  }
  return new Blob([lines.join('\n')], { type: 'text/plain' });
}

/* ---------- 3MF (Bambu Studio native) ---------- */

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

function esc(s) {
  return s.replace(/[<>&'"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch]));
}

export function export3MF(bodies, docName = 'FeatherCAD Part') {
  // rotate to Z-up
  const rotated = bodies.map(b => ({ ...b, geometry: toZUp(b.geometry) }));
  const geo = mergedGeometry(rotated);
  const pos = geo.attributes.position;
  const idx = geo.index;

  const verts = [];
  for (let i = 0; i < pos.count; i++) {
    verts.push(`<v x="${pos.getX(i).toFixed(4)}" y="${pos.getY(i).toFixed(4)}" z="${pos.getZ(i).toFixed(4)}"/>`);
  }
  const tris = [];
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      tris.push(`<triangle v1="${idx.array[i]}" v2="${idx.array[i + 1]}" v3="${idx.array[i + 2]}"/>`);
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      tris.push(`<triangle v1="${i}" v2="${i + 1}" v3="${i + 2}"/>`);
    }
  }

  const model = `${XML_HEADER}
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Title">${esc(docName)}</metadata>
 <metadata name="Application">FeatherCAD</metadata>
 <resources>
  <object id="1" name="${esc(docName)}" type="model">
   <mesh>
    <vertices>${verts.join('')}</vertices>
    <triangles>${tris.join('')}</triangles>
   </mesh>
  </object>
 </resources>
 <build><item objectid="1"/></build>
</model>`;

  const contentTypes = `${XML_HEADER}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

  const rels = `${XML_HEADER}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

  const zipped = zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(model),
  });
  return new Blob([zipped], { type: 'model/3mf' });
}

/* ---------- helpers ---------- */

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
