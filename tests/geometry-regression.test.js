'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const context = { console, Math };
vm.createContext(context);
const geometry = fs.readFileSync(
  path.join(__dirname, '..', 'modules', 'export_gcode', 'js', 'cam-geometry.js'),
  'utf8'
);
vm.runInContext(geometry, context);

function polygonEdges(points, groupId = 1) {
  return points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    return { x1:p[0], y1:p[1], x2:q[0], y2:q[1], group_id:groupId };
  });
}

function regularPolygon(n, radius = 50, rotation = 0) {
  return polygonEdges(Array.from({length:n}, (_, i) => {
    const a = rotation + 2 * Math.PI * i / n;
    return [radius * Math.cos(a), radius * Math.sin(a)];
  }));
}

function splitRectangle(width, height, splits = 2) {
  const corners = [[0,0], [width,0], [width,height], [0,height]];
  const points = [];
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % corners.length];
    for(let j=0; j<splits; j++) {
      const t = j / splits;
      points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  });
  return polygonEdges(points);
}

[8, 12, 24, 48].forEach(n => {
  assert(context.detectCircleJS(regularPolygon(n, 50, Math.PI / (n * 2))),
    `${n}-segment circle should be recognized by JS`);
});
assert.strictEqual(context.detectCircleJS(splitRectangle(100, 100, 2)), null);
assert.strictEqual(context.detectCircleJS(splitRectangle(100, 100, 6)), null);
assert.strictEqual(context.detectCircleJS(splitRectangle(100, 80, 4)), null);

const island = regularPolygon(24, 20);
island._closed = false;
context.profileCloseSmallIslandGapsJS([island], [true], 0.75);
assert.strictEqual(island._closed, true, 'exact terminal gap should close an island');

const open = regularPolygon(24, 20);
open[open.length - 1].x2 += 1.0;
open._closed = false;
context.profileCloseSmallIslandGapsJS([open], [true], 0.75);
assert.strictEqual(open._closed, false, 'gap over 0.75 mm must stay open');

function assertFiniteBoundedOffset(points, source, maxVertexDistance, label) {
  assert(points.length >= 3, `${label}: offset must contain a usable path`);
  points.forEach(p => {
    assert(Number.isFinite(p.x) && Number.isFinite(p.y), `${label}: finite XY required`);
    const nearest = Math.min(...source.map(e => Math.hypot(p.x-e.x1, p.y-e.y1)));
    assert(nearest <= maxVertexDistance, `${label}: offset escaped too far (${nearest})`);
  });
}

// Acute convex corner: enabling sharp outside corners may use the true miter,
// but never beyond the production 4R limit.
context.STG = { sharp_outside_corner:true };
const acuteConvex = polygonEdges([[0,0],[100,0],[8,22]]);
assertFiniteBoundedOffset(
  context.profileExactCutOutOffsetJS(acuteConvex,3), acuteConvex,12.001,
  'acute convex CUT_OUT'
);

// Narrow concave notch: it must turn through the local R relief instead of
// following an offset-line intersection tens of millimetres away.
const narrowConcave = polygonEdges([[0,0],[100,0],[100,100],[55,100],[50,20],[45,100],[0,100]]);
assertFiniteBoundedOffset(
  context.profileExactCutOutOffsetJS(narrowConcave,3), narrowConcave,12.001,
  'narrow concave CUT_OUT'
);

console.log('JS geometry regression: OK');
