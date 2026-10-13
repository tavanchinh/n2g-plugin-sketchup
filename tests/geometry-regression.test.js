'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ClipperLib = require(path.join(__dirname, '..', 'modules', 'export_gcode', 'js', 'clipper-lib.js'));
const context = { console, Math, ClipperLib };
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

function cornerMicroRecess(radius) {
  const angles = [8,7,6,5,4].map(k => Math.PI*k/8);
  return polygonEdges([[0,0]].concat(
    angles.map(a => [100+radius*Math.cos(a),radius*Math.sin(a)]),
    [[100,100],[0,100]]
  ),91);
}

const microRecess = cornerMicroRecess(2.5);
microRecess._closed = true;
assert(context.profileHasMicroDetourJS(microRecess,6),
  'D5 sampled recess must route through micro-envelope for a D6 cutter');
const microRuns = context.profileOffsetClipper(microRecess,3,'cut_out');
assert(microRuns.length>0,'micro-envelope must produce a CUT_OUT run');
microRuns.forEach(run => assert(context.profileLocalMicroEnvelopeSafeJS(microRecess,run),
  'micro-envelope must contain the source without crossing material or itself'));
assert(microRuns.every(run => run.length<100),
  'validated Clipper route should be preferred over the verbose full envelope');
[[103,103],[-3,103],[-3,-3]].forEach(expected => assert(
  microRuns[0].some(p => Math.hypot(p.x-expected[0],p.y-expected[1])<0.002),
  `ordinary 90-degree corner must remain sharp at ${expected}`
));

const ordinaryRectangle = polygonEdges([[0,0],[100,0],[100,100],[0,100]],92);
assert.strictEqual(context.profileHasMicroDetourJS(ordinaryRectangle,6),false,
  'ordinary rectangle must retain the exact CUT_OUT engine');

// A square U-slot exactly as wide as the cutter collapses to zero area in a
// polygon offset. It must survive as one centreline excursion and return over
// the same line. A narrower slot must remain blocked.
function topSquareSlot(width,depth,groupId){
  const x0=50-width/2,x1=50+width/2;
  const lp=polygonEdges([[0,0],[100,0],[100,100],[x1,100],[x1,100-depth],
    [x0,100-depth],[x0,100],[0,100]],groupId);
  lp._closed=true;return lp;
}
const exactDSlot=topSquareSlot(6,20,93);
const exactDSlotRuns=context.profileOffsetClipper(exactDSlot,3,'cut_out');
assert(exactDSlotRuns.length>0,'D6 square slot must retain a CUT_OUT run');
const exactEndIndexes=[];
exactDSlotRuns[0].forEach((p,i)=>{
  if(Math.hypot(p.x-50,p.y-83)<0.001)exactEndIndexes.push(i);
});
assert(exactEndIndexes.length>=2,'D6 square slot must preserve the in/out centreline');
const exactSlotEnd=exactEndIndexes[0],slotBefore=exactDSlotRuns[0][exactSlotEnd-1],
  slotAfter=exactDSlotRuns[0][exactEndIndexes[exactEndIndexes.length-1]+1];
assert(slotBefore&&slotAfter&&Math.hypot(slotBefore.x-slotAfter.x,slotBefore.y-slotAfter.y)<1e-9,
  'slot entry and return must overlap exactly');
const collapsed=context.profileRawCutOutClipperJS(exactDSlot,3);
const restored=context.profileRestoreExactWidthSlotsJS(exactDSlot,collapsed,3);
assert.strictEqual(restored[0].filter(p=>p._n2gExactSlot).length,3,
  'collapsed polygon offset must restore exactly one in/out centreline');
const cornerSlot=polygonEdges([[0,0],[100,0],[100,100],[53,100],[53,80],
  [47,80],[47,90],[0,90]],95);
cornerSlot._closed=true;
const cornerCollapsed=context.profileRawCutOutClipperJS(cornerSlot,3);
const cornerRestored=context.profileRestoreExactWidthSlotsJS(cornerSlot,cornerCollapsed,3);
const cornerBranch=cornerRestored[0].filter(p=>p._n2gExactSlot);
assert.strictEqual(cornerBranch.length,3,
  'D6 corner slot with one long wall must retain one in/out centreline');
assert(Math.abs(cornerBranch[1].x-50)<0.001&&Math.abs(cornerBranch[1].y-83)<0.001,
  'corner slot centreline must stop one radius before its square bottom');
const segmentedSlot=polygonEdges([[0,0],[100,0],[100,50],[100,100],[53,100],
  [53,90],[53,80],[50,80],[47,80],[47,90],[47,100],[0,100]],96);
segmentedSlot._closed=true;
const segmentedCollapsed=context.profileRawCutOutClipperJS(segmentedSlot,3);
const segmentedRestored=context.profileRestoreExactWidthSlotsJS(segmentedSlot,segmentedCollapsed,3);
assert.strictEqual(segmentedRestored[0].filter(p=>p._n2gExactSlot).length,3,
  'segmented square walls and bottom must still restore one centreline');
const radiusDeepSlot=topSquareSlot(6,3,97);
const radiusDeepCollapsed=context.profileRawCutOutClipperJS(radiusDeepSlot,3);
const radiusDeepRestored=context.profileRestoreExactWidthSlotsJS(radiusDeepSlot,radiusDeepCollapsed,3);
const radiusDeepBranch=radiusDeepRestored[0].filter(p=>p._n2gExactSlot);
assert.strictEqual(radiusDeepBranch.length,3,
  'slot depth equal to tool radius must travel from outer offset to its mouth and return');
assert(Math.abs(radiusDeepBranch[1].x-50)<0.001&&Math.abs(radiusDeepBranch[1].y-100)<0.001,
  'R-deep slot must turn exactly at the mouth without cutting past its bottom');
assert(Math.abs(Math.hypot(radiusDeepBranch[1].x-radiusDeepBranch[0].x,
  radiusDeepBranch[1].y-radiusDeepBranch[0].y)-3)<0.001,
  'R-deep slot centreline excursion must equal the slot depth');
const narrowDSlotRuns=context.profileOffsetClipper(topSquareSlot(5,20,94),3,'cut_out');
assert(!narrowDSlotRuns.some(run=>run.some(p=>p._n2gExactSlot)),
  'slot narrower than D6 must remain blocked');

// Avoid-curve must identify the exact owning segment so Preview can insert the
// same interior entry point as Ruby instead of snapping to a nearby vertex.
const entryPath = [{x:0,y:0},{x:100,y:0},{x:100,y:10},{x:0,y:10}];
const straightEntry = context.straightEntryPointJS(entryPath,50,10,15,10);
assert(straightEntry && straightEntry.seg === 2,
  'straight entry must retain its owning segment index');
assert(Math.abs(straightEntry.y-10) < 1e-9 && straightEntry.x > 0 && straightEntry.x < 100,
  'straight entry must stay inside the selected final offset segment');

console.log('JS geometry regression: OK');
