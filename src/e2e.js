// e2e.js — headless smoke test: run with ?e2e=1, results written to #e2e-results
export async function runE2E(app) {
  const results = {};
  const report = () => {
    let el = document.getElementById('e2e-results');
    if (!el) { el = document.createElement('div'); el.id = 'e2e-results'; document.body.append(el); }
    el.textContent = 'E2E:' + JSON.stringify(results);
  };
  try {
    // 1. primitive
    app.addPrimitive('box');
    results.primitive = app.state.bodies.length === 1 && Object.keys(app.state.errors).length === 0;

    // 2. sketch on top plane with a circle
    app.createSketchOnOriginPlane('top');
    const sk = app.sketchEditor.sketch;
    sk.entities.push({ type: 'circle', c: [0, 0], r: 5 });
    app.sketchEditor.stop();
    app.commit('e2e sketch');
    results.sketch = !!app.getSketch(sk.id);

    // 3. extrude cut through the box
    app.state.selectedId = sk.id;
    app.startExtrude();
    const ex = app.selectedFeature();
    ex.distance = 40;
    ex.op = 'cut';
    ex.target = app.state.bodies[0].id;
    app.commit('e2e cut');
    results.cut = !app.state.errors[ex.id];

    // 4. pattern
    app.addPattern();
    const pat = app.selectedFeature();
    pat.count = 3; pat.spacing = 50;
    app.commit('e2e pattern');
    results.pattern = !app.state.errors[pat.id];

    const g = app.state.bodies[0].geometry;
    g.computeBoundingBox();
    results.bboxX = [Math.round(g.boundingBox.min.x), Math.round(g.boundingBox.max.x)];
    results.bodyCount = app.state.bodies.length;

    // 5. undo/redo round trip (feature creation and its first edit are
    // separate commits, so undo until the feature is gone)
    const nBefore = app.doc.features.length;
    let undos = 0;
    while (app.doc.features.length === nBefore && undos++ < 5) app.undo();
    results.undo = app.doc.features.length === nBefore - 1;
    while (app.doc.features.length < nBefore) app.redo();
    results.redo = app.doc.features.length === nBefore;

    // 6. exports
    const { exportSTL, exportOBJ, export3MF } = await import('./exporters.js');
    results.stl = (await exportSTL(app.state.bodies)).size;
    results.obj = (await exportOBJ(app.state.bodies)).size;
    results.threemf = (await export3MF(app.state.bodies, 'E2E')).size;

    results.pass = Object.values(results).every(v => v !== false && v !== undefined && v !== 0 || v === true);
  } catch (e) {
    results.exception = e.message;
  }
  report();
}
