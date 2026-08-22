// ── cam-geometry.js — Hàm hình học & màu layer dùng chung ──
// Load TRƯỚC các file tp-*.js và cam-render.js

const PALETTE = [
  '#2563a8','#c0392b','#16a34a','#d97706','#7c3aed',
  '#0891b2','#be185d','#15803d','#b45309','#6d28d9',
  '#0e7490','#9d174d','#166534','#92400e','#5b21b6',
  '#1d4ed8','#dc2626','#15803d','#b45309','#7c3aed',
];
const layerColorMap = {};
let colorIdx = 0;

// Layer ưu tiên đặc biệt
const LAYER_PRIORITY = {
  sheetborder: { zIndex:0, fill:'#e0e0da', stroke:'#a0a098', lineWidth:0.8, dash:[] },
  label:       { zIndex:1, fill:null,      stroke:'#888888', lineWidth:0.7, dash:[], opacity:1.0 },
};

function getLayerPriority(name) {
  const l = name.toLowerCase();
  if (l.includes('sheetborder') || l === 'abf_sheetborder') return 'sheetborder';
  if (l.includes('label') || l === 'abf_label')              return 'label';
  return null;
}

function getLayerColor(layerName) {
  if (!layerColorMap[layerName]) {
    layerColorMap[layerName] = PALETTE[colorIdx % PALETTE.length];
    colorIdx++;
  }
  return layerColorMap[layerName];
}


function buildPolygon(vecs, tx, ty) {
  if (!vecs.length) return null;
  const pts = [];
  const remaining = vecs.map(v => ({
    x1:tx(v.x1),y1:ty(v.y1),x2:tx(v.x2),y2:ty(v.y2)
  }));
  let cur = remaining.shift();
  pts.push([cur.x1, cur.y1]);
  pts.push([cur.x2, cur.y2]);
  const THRESH = 2;
  let changed = true;
  while (remaining.length && changed) {
    changed = false;
    const last = pts[pts.length - 1];
    for (let i = 0; i < remaining.length; i++) {
      const e = remaining[i];
      if (Math.hypot(e.x1-last[0], e.y1-last[1]) < THRESH) {
        pts.push([e.x2, e.y2]); remaining.splice(i,1); changed=true; break;
      }
      if (Math.hypot(e.x2-last[0], e.y2-last[1]) < THRESH) {
        pts.push([e.x1, e.y1]); remaining.splice(i,1); changed=true; break;
      }
    }
  }
  return pts.length > 2 ? pts : null;
}

function drawLoopArrows(ctx,loop,tx,ty,color,dpr){
  let dist=0;
  loop.forEach(e=>{
    const x1=tx(e.x1),y1=ty(e.y1),x2=tx(e.x2),y2=ty(e.y2);
    const dx=x2-x1,dy=y2-y1,len=Math.sqrt(dx*dx+dy*dy);
    dist+=len;
    if(dist>50*dpr){
      dist=0;
      drawArrow(ctx,(x1+x2)/2-dx*0.1,(y1+y2)/2-dy*0.1,(x1+x2)/2+dx*0.1,(y1+y2)/2+dy*0.1,color,dpr);
    }
  });
}

// Offset polygon đóng vào trong khoảng dist (>0 = vào trong), miter join chuẩn.
// Dùng cho V-Bit: đơn giản, chính xác, không threshold phức tạp như offsetLoopJS.
// roundSharp=true → góc nhọn được BO CUNG bán kính |dist| thay vì để đỉnh miter vọt
// xa. CHỈ dùng khi offset RA NGOÀI (cut_out): cung nằm ngoài vật liệu nên vô hại.
// KHÔNG dùng khi offset VÀO TRONG (pocket/cut_in/V-Bit) — ở đó đỉnh miter dài mới
// đúng; bo cung sẽ đưa tâm dao tới quá gần đỉnh nhọn và cắt lẹm ra ngoài biên.
function offsetPolygonMiter(loop, dist, roundSharp, bevelConcave){
  if(!loop || loop.length < 2) return null;
  // Lấy danh sách đỉnh từ edges (điểm đầu mỗi edge)
  var verts = loop.map(function(e){ return {x:e.x1, y:e.y1}; });
  var n = verts.length;
  if(n < 3) return null;

  // Winding: area>0 (canvas Y-down) → CW. Offset vào trong cần normal hướng vào.
  var area = 0;
  for(var i=0;i<n;i++){
    var a=verts[i], b=verts[(i+1)%n];
    area += (a.x*b.y - b.x*a.y);
  }
  // area>0 trong canvas Y-down = polygon đi CW; vào trong = normal trái * -dist
  var inwardSign = area > 0 ? 1 : -1;

  var out = [];
  for(var i=0;i<n;i++){
    var prev = verts[(i-1+n)%n];
    var cur  = verts[i];
    var next = verts[(i+1)%n];

    // Vector 2 cạnh kề đỉnh cur
    var d1x=cur.x-prev.x, d1y=cur.y-prev.y;
    var d2x=next.x-cur.x, d2y=next.y-cur.y;
    var l1=Math.hypot(d1x,d1y), l2=Math.hypot(d2x,d2y);
    if(l1<1e-6 || l2<1e-6){ out.push({x:cur.x, y:cur.y}); continue; }
    d1x/=l1; d1y/=l1; d2x/=l2; d2y/=l2;

    // Normal trái của mỗi cạnh (canvas)
    var n1x=-d1y, n1y=d1x;
    var n2x=-d2y, n2y=d2x;

    // Hướng miter = trung bình 2 normal, chuẩn hóa
    var mx=n1x+n2x, my=n1y+n2y;
    var ml=Math.hypot(mx,my);
    if(ml<1e-6){ // 2 cạnh ngược hướng (180°) → dùng normal cạnh 1
      mx=n1x; my=n1y; ml=1;
    }
    mx/=ml; my/=ml;

    // Độ dài miter = dist / cos(nửa góc) = dist / (m · n1)
    var cosHalf = mx*n1x + my*n1y;
    if(Math.abs(cosHalf) < 1e-6) cosHalf = 1;
    var miterLen = dist / cosHalf;
    var turn = d1x*d2y - d1y*d2x;
    var concave = (area > 0 && turn < -1e-7) || (area < 0 && turn > 1e-7);
    if(bevelConcave && concave){
      var bs = dist * inwardSign;
      out.push({x:cur.x+n1x*bs,y:cur.y+n1y*bs});
      out.push({x:cur.x+n2x*bs,y:cur.y+n2y*bs});
      continue;
    }

    // ── GIỚI HẠN MITER (góc nhọn) ──────────────────────────────────────────
    // Góc càng nhọn thì đỉnh miter càng vọt xa (dao D6 tại góc 10° vọt 34mm ≈
    // 11× bán kính) → đường dao chạy ra ngoài chi tiết rất xa. Vượt ngưỡng thì
    // thay đỉnh nhọn bằng CUNG TRÒN bán kính |dist| quanh đỉnh — đúng vật lý
    // (dao tròn không tạo được mũi nhọn). Góc tù giữ miter như cũ.
    // KHỚP Ruby offset_polygon_miter (MITER_LIMIT).
    if(!roundSharp || Math.abs(miterLen) <= MITER_LIMIT_JS * Math.abs(dist)){
      out.push({
        x: cur.x + mx * miterLen * inwardSign,
        y: cur.y + my * miterLen * inwardSign
      });
    } else {
      var s  = dist * inwardSign;
      var r  = Math.abs(s);
      var a1 = Math.atan2(n1y * s, n1x * s);
      var a2 = Math.atan2(n2y * s, n2x * s);
      var da = a2 - a1;
      while(da <= -Math.PI) da += 2*Math.PI;
      while(da >   Math.PI) da -= 2*Math.PI;
      var steps = Math.max(Math.ceil(Math.abs(da) / (Math.PI/12)), 1);
      for(var k=0; k<=steps; k++){
        var a = a1 + da * k / steps;
        out.push({ x: cur.x + Math.cos(a)*r, y: cur.y + Math.sin(a)*r });
      }
    }
  }
  return out;
}

// Diện tích có dấu của mảng điểm (canvas Y-down: >0 = CW).
function polySignedAreaJS(pts){
  var a=0, n=pts.length;
  for(var i=0;i<n;i++){ var p=pts[i], q=pts[(i+1)%n]; a += (p.x*q.y - q.x*p.y); }
  return a/2;
}

// Sinh CHUỖI vòng hạ nền theo BIÊN DẠNG THẬT (contour-parallel), đúng cho hình
// bất kỳ hướng nào (kể cả nằm nghiêng) — thay cho rect bbox thẳng trục.
// loop: edges (x1,y1,x2,y2). halfD: bán kính dao. stepover: bước offset.
// Trả mảng các vòng, mỗi vòng là mảng điểm {x,y} (đã khép — điểm cuối = điểm đầu).
// Dừng khi hình co về rỗng: diện tích quá nhỏ, đổi dấu (lật ngược = qua tâm),
// hoặc tăng trở lại (self-intersect). An toàn cho lồi lẫn lõm nhẹ.
// Tâm đường tròn qua 3 điểm (circumcenter). Trả {x,y,r} hoặc null (thẳng hàng).
function _circumcenterJS(a,b,c){
  var ax=a.x,ay=a.y,bx=b.x,by=b.y,cx=c.x,cy=c.y;
  var d=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by));
  if(Math.abs(d)<1e-9) return null;
  var ux=((ax*ax+ay*ay)*(by-cy)+(bx*bx+by*by)*(cy-ay)+(cx*cx+cy*cy)*(ay-by))/d;
  var uy=((ax*ax+ay*ay)*(cx-bx)+(bx*bx+by*by)*(ax-cx)+(cx*cx+cy*cy)*(bx-ax))/d;
  return {x:ux,y:uy,r:Math.hypot(ax-ux,ay-uy)};
}
// Nhận diện CUNG LỒI (bo góc, tâm nằm TRONG hình) trong đa giác verts. Cung lõm (tâm
// ngoài) bị bỏ qua vì offset vào KHÔNG lật. Trả [{idx:[...], r}].
function _detectConvexArcsJS(verts){
  var n=verts.length, arcs=[], i, cc=[];
  if(n<6) return arcs;
  for(i=0;i<n;i++) cc[i]=_circumcenterJS(verts[(i-1+n)%n],verts[i],verts[(i+1)%n]);
  var used=new Array(n).fill(false);
  for(i=0;i<n;i++){
    if(used[i]||!cc[i]) continue;
    var c0=cc[i], grp=[i], j=(i+1)%n, guard=0;
    while(guard++<n){
      if(!cc[j]) break;
      if(Math.hypot(cc[j].x-c0.x,cc[j].y-c0.y)<Math.max(1.0,c0.r*0.1) &&
         Math.abs(cc[j].r-c0.r)<Math.max(0.5,c0.r*0.1)){
        grp.push(j); used[j]=true; j=(j+1)%n;
      } else break;
    }
    // Chỉ nhận cung LỒI: tâm cung nằm trong đa giác (bo góc ngoài). Cung lõm → bỏ.
    if(grp.length>=3 && _pointInPolyJS(c0.x, c0.y, verts)){
      arcs.push({ idx: grp, r: c0.r });
    }
  }
  return arcs;
}
function _lineIntJS(a1,a2,b1,b2){
  var d1x=a2.x-a1.x,d1y=a2.y-a1.y,d2x=b2.x-b1.x,d2y=b2.y-b1.y;
  var den=d1x*d2y-d1y*d2x;
  if(Math.abs(den)<1e-9) return null;
  var t=((b1.x-a1.x)*d2y-(b1.y-a1.y)*d2x)/den;
  return {x:a1.x+t*d1x, y:a1.y+t*d1y};
}
// Với offset 'off': cung nào có r<=off (offset vượt bán kính → sẽ lật) thì thay chuỗi
// đỉnh cung bằng 1 ĐỈNH GÓC (giao 2 cạnh thẳng kề) → góc vuông thay vì cung lật.
function _collapseArcsForOffsetJS(verts, arcs, off){
  var n=verts.length, remove=new Array(n).fill(false), replace={};
  arcs.forEach(function(arc){
    if(off < arc.r - 1e-6) return;   // off < R: giữ cung (offset bình thường)
    var s=arc.idx[0], e=arc.idx[arc.idx.length-1];
    var corner=_lineIntJS(verts[(s-2+n)%n],verts[(s-1+n)%n], verts[(e+1)%n],verts[(e+2)%n]);
    arc.idx.forEach(function(k){ remove[k]=true; });
    if(corner) replace[s]=corner;
  });
  var out=[];
  for(var i=0;i<n;i++){
    if(replace[i]) out.push(replace[i]);
    if(!remove[i]) out.push(verts[i]);
  }
  // Bỏ điểm THẲNG HÀNG (collinear) sinh ra sau collapse (đầu/cuối cung cũ nay nằm
  // thẳng trên cạnh với đỉnh góc) → G-code gọn, tránh điểm thừa.
  if(out.length >= 3){
    var cleaned=[], m=out.length;
    for(var c=0;c<m;c++){
      var pr=out[(c-1+m)%m], cu=out[c], nx=out[(c+1)%m];
      var cr=(cu.x-pr.x)*(nx.y-pr.y)-(cu.y-pr.y)*(nx.x-pr.x);
      if(Math.abs(cr) > 1e-6) cleaned.push(cu);
    }
    if(cleaned.length >= 3) return cleaned;
  }
  return out;
}
function _vertsToEdgesJS(v){
  var e=[]; for(var k=0;k<v.length;k++){ var b=v[(k+1)%v.length]; e.push({x1:v[k].x,y1:v[k].y,x2:b.x,y2:b.y}); }
  return e;
}

// Mẫu 20 cạnh có 4 tai, mỗi tai chiếm 3 điểm giữa hai cạnh lõi.
function collapsePocketEarsJS(loop){
  if(!loop || loop.length!==20) return null;
  var horizontal=loop.filter(function(e){
    return Math.abs(e.y2-e.y1)<0.01 && Math.abs(e.x2-e.x1)>20;
  });
  var vertical=loop.filter(function(e){
    return Math.abs(e.x2-e.x1)<0.01 && Math.abs(e.y2-e.y1)>10;
  });
  if(horizontal.length<2 || vertical.length<2) return null;
  var minX=Math.min.apply(null,vertical.map(function(e){return (e.x1+e.x2)/2;}));
  var maxX=Math.max.apply(null,vertical.map(function(e){return (e.x1+e.x2)/2;}));
  var minY=Math.min.apply(null,horizontal.map(function(e){return (e.y1+e.y2)/2;}));
  var maxY=Math.max.apply(null,horizontal.map(function(e){return (e.y1+e.y2)/2;}));
  var area=0;
  loop.forEach(function(e){ area+=e.x1*e.y2-e.x2*e.y1; });
  var verts=area<0 ?
    [{x:maxX,y:minY},{x:minX,y:minY},{x:minX,y:maxY},{x:maxX,y:maxY}] :
    [{x:minX,y:minY},{x:maxX,y:minY},{x:maxX,y:maxY},{x:minX,y:maxY}];
  return _vertsToEdgesJS(verts);
}

function pocketContourRingsClipper(loop, halfD, stepover, maxRings){
  if(typeof ClipperLib==='undefined' || !loop || loop.length<3) return [];
  var scale=1000, work=loop.filter(function(e){return Math.hypot(e.x2-e.x1,e.y2-e.y1)>1e-6;});
  var verts=work.map(function(e){return {x:e.x1,y:e.y1};});
  if(verts.length>3 && Math.hypot(verts[0].x-verts[verts.length-1].x,verts[0].y-verts[verts.length-1].y)<1e-6) verts.pop();
  var area=polySignedAreaJS(verts); if(Math.abs(area)<1e-6) return [];
  var path=verts.map(function(p){return {X:Math.round(p.x*scale),Y:Math.round(p.y*scale)};});
  var rings=[], off=halfD, lim=maxRings||500;
  var lastGoodOff=null;

  function ringSolutionAt(distance){
    var co=new ClipperLib.ClipperOffset(2,0.25*scale);
    co.AddPath(path,ClipperLib.JoinType.jtRound,ClipperLib.EndType.etClosedPolygon);
    var raw=[];
    co.Execute(raw,-distance*scale);
    return raw.filter(function(poly){
      if(!poly || poly.length<3) return false;
      var pts=poly.map(function(p){return {x:p.X/scale,y:p.Y/scale};});
      return Math.abs(polySignedAreaJS(pts))>=1e-5;
    });
  }

  function appendSolution(solution){
    var added=0;
    solution.forEach(function(poly){
      var pts=poly.map(function(p){return {x:p.X/scale,y:p.Y/scale};});
      pts.push({x:pts[0].x,y:pts[0].y});
      rings.push(pts); added++;
    });
    return added;
  }

  for(var k=0;k<lim;k++){
    var solution=ringSolutionAt(off);
    if(!solution.length){
      // Last +1: bước stepover kế tiếp có thể nhảy qua lõi còn sót và làm Clipper
      // trả rỗng. Tìm offset sâu nhất còn tồn tại giữa vòng cuối và bước thất bại,
      // rồi chèn đúng một vòng cuối để vét phần tâm còn lại.
      if(lastGoodOff!==null){
        var lo=lastGoodOff, hi=off, bestOff=null, bestSolution=null;
        for(var bi=0;bi<12;bi++){
          var mid=(lo+hi)/2;
          var midSolution=ringSolutionAt(mid);
          if(midSolution.length){
            bestOff=mid; bestSolution=midSolution; lo=mid;
          }else{
            hi=mid;
          }
        }
        var minLastStep=Math.max(stepover*0.25,0.5);
        if(bestSolution && bestOff-lastGoodOff>=minLastStep) appendSolution(bestSolution);
      }
      break;
    }
    if(!appendSolution(solution)) break;
    lastGoodOff=off;
    off+=stepover;
  }
  return rings;
}

// Khóa hình học ổn định để Ruby ghép đúng loop nguồn sau khi Ruby sắp lại thứ tự cắt.
function profileLoopKeyJS(loop){
  if(!loop || !loop.length) return '';
  var xs=[],ys=[],peri=0;
  loop.forEach(function(e){
    xs.push(e.x1,e.x2); ys.push(e.y1,e.y2);
    peri+=Math.hypot(e.x2-e.x1,e.y2-e.y1);
  });
  var gid=(loop[0] && loop[0].group_id!=null) ? String(loop[0].group_id) : '';
  return [gid,loop.length,Math.min.apply(null,xs).toFixed(3),Math.max.apply(null,xs).toFixed(3),
    Math.min.apply(null,ys).toFixed(3),Math.max.apply(null,ys).toFixed(3),peri.toFixed(3)].join('|');
}

// ID ghep JS/Ruby khong phu thuoc cach chia segment hay chu vi.
// group_id + bbox nguon la bat bien khi hai ben build lai cung contour.
function profileLoopIdJS(loop){
  if(!loop || !loop.length) return '';
  var xs=[],ys=[];
  loop.forEach(function(e){xs.push(e.x1,e.x2);ys.push(e.y1,e.y2);});
  var gid=(loop[0] && loop[0].group_id!=null) ? String(loop[0].group_id) : '';
  return [gid,Math.min.apply(null,xs).toFixed(3),Math.max.apply(null,xs).toFixed(3),
    Math.min.apply(null,ys).toFixed(3),Math.max.apply(null,ys).toFixed(3)].join('|');
}

// Offset Profile kín bằng Clipper. Trả nhiều run khi cut_in làm hình bị tách vùng.
// cut_out dùng delta dương; cut_in dùng delta âm. Clipper tự chuẩn hóa winding.
// Scope cua Profile Clipper:
// - islands_only (default): outer/cut_out dung engine cu; chi island dung Clipper.
// - all: hanh vi Clipper cho moi profile kin nhu truoc.
if(typeof window!=='undefined' && typeof window.N2G_PROFILE_CLIPPER_SCOPE==='undefined'){
  window.N2G_PROFILE_CLIPPER_SCOPE='islands_only';
}
function profileClipperAppliesJS(isIsland){
  var scope=(typeof window!=='undefined' && window.N2G_PROFILE_CLIPPER_SCOPE) || 'islands_only';
  return scope==='all' || (scope==='islands_only' && isIsland===true);
}

function profileOffsetClipper(loop, halfD, strategy){
  if(typeof ClipperLib==='undefined' || !loop || loop.length<3 ||
     (strategy!=='cut_in' && strategy!=='cut_out')) return [];
  var scale=1000;
  var work=loop.filter(function(e){return Math.hypot(e.x2-e.x1,e.y2-e.y1)>1e-6;});
  var path=work.map(function(e){return {X:Math.round(e.x1*scale),Y:Math.round(e.y1*scale)};});
  if(path.length>3 && path[0].X===path[path.length-1].X && path[0].Y===path[path.length-1].Y) path.pop();
  if(path.length<3) return [];
  var co=new ClipperLib.ClipperOffset(2,0.25*scale), solution=[];
  // Profile cut_out va cut_in deu giu goc vuong bang miter join.
  // MiterLimit=2 o ClipperOffset van gioi han cac dinh qua nhon de tranh vot dai.
  var joinType=ClipperLib.JoinType.jtMiter;
  co.AddPath(path,joinType,ClipperLib.EndType.etClosedPolygon);
  co.Execute(solution,(strategy==='cut_out'?halfD:-halfD)*scale);
  var runs=solution.filter(function(poly){
    return poly && poly.length>=3 && Math.abs(ClipperLib.Clipper.Area(poly))>=10;
  }).map(function(poly){
    return poly.map(function(p){return {x:p.X/scale,y:p.Y/scale};});
  });
  runs=profileCollapsedStepBevelJS(loop,runs,halfD,strategy);
  return profileNarrowSlotReliefJS(loop,runs,halfD,strategy);
}

// Aspire-style transition for a concave step whose two short edges are equal
// to the tool radius. Clipper collapses that zero-clearance step to one miter
// vertex. Replace only that vertex with the two offset tangent points, making
// one local diagonal; all other Clipper vertices remain unchanged.
if(typeof window!=='undefined' && typeof window.N2G_PROFILE_COLLAPSED_STEP_ENGINE==='undefined'){
  window.N2G_PROFILE_COLLAPSED_STEP_ENGINE='aspire';
}
function profileCollapsedStepBevelJS(loop,runs,halfD,strategy){
  if(strategy!=='cut_out'||!loop||loop.length<3||!runs||!runs.length) return runs;
  if(typeof window!=='undefined' && window.N2G_PROFILE_COLLAPSED_STEP_ENGINE==='legacy') return runs;
  var verts=loop.map(function(e){return{x:+e.x1,y:+e.y1};});
  var area=polySignedAreaJS(verts);
  if(Math.abs(area)<1e-9) return runs;
  var r=Math.abs(halfD), lenTol=Math.max(0.08,r*0.02), hitTol=Math.max(0.12,r*0.04);
  var replacements=runs.map(function(){return{};});

  function lineHit(px,py,dx,dy,qx,qy,ex,ey){
    var den=dx*ey-dy*ex;
    if(Math.abs(den)<1e-9) return null;
    var t=((qx-px)*ey-(qy-py)*ex)/den;
    return{x:px+t*dx,y:py+t*dy};
  }

  for(var i=0;i<loop.length;i++){
    var incoming=loop[i], outgoing=loop[(i+1)%loop.length];
    var ax=incoming.x2-incoming.x1, ay=incoming.y2-incoming.y1, al=Math.hypot(ax,ay);
    var bx=outgoing.x2-outgoing.x1, by=outgoing.y2-outgoing.y1, bl=Math.hypot(bx,by);
    if(Math.abs(al-r)>lenTol||Math.abs(bl-r)>lenTol) continue;
    var turn=ax*by-ay*bx;
    // The 3 x 3 mm shoulder is the local convex corner of the stepped tab.
    // Its two offset legs meet at the Clipper miter that Aspire bevels.
    if(turn*area<=0) continue;
    var dot=Math.abs((ax*bx+ay*by)/(al*bl));
    if(dot>0.05) continue; // nesting step is orthogonal

    ax/=al; ay/=al; bx/=bl; by/=bl;
    // cut_out normal: right side for CCW, left side for CW.
    var side=area>0?1:-1;
    var n1x=ay*side, n1y=-ax*side, n2x=by*side, n2y=-bx*side;
    var vx=+incoming.x2, vy=+incoming.y2;
    var tIn={x:vx+n1x*r,y:vy+n1y*r};
    var tOut={x:vx+n2x*r,y:vy+n2y*r};
    var miter=lineHit(tIn.x,tIn.y,ax,ay,tOut.x,tOut.y,bx,by);
    if(!miter) continue;

    var best=null;
    runs.forEach(function(run,ri){
      run.forEach(function(p,pi){
        var d=Math.hypot(p.x-miter.x,p.y-miter.y);
        if(d<=hitTol&&(!best||d<best.d)) best={ri:ri,pi:pi,d:d};
      });
    });
    if(!best) continue;
    var sameDirection=polySignedAreaJS(runs[best.ri])*area>0;
    replacements[best.ri][best.pi]=sameDirection?[tIn,tOut]:[tOut,tIn];
  }

  return runs.map(function(run,ri){
    var out=[];
    run.forEach(function(p,pi){
      var rep=replacements[ri][pi];
      if(rep) rep.forEach(function(q){out.push(q);}); else out.push(p);
    });
    return out;
  });
}

// Aspire-style cleanup for a cut_out slot whose width equals the tool diameter.
// Clipper removes this zero-width offset branch. Replace its bridge segment by
// two diagonals through the deepest reachable point on the slot centerline.
if(typeof window!=='undefined' && typeof window.N2G_PROFILE_NARROW_SLOT_ENGINE==='undefined'){
  // Disabled by default until the concave-step rule is validated on real
  // nesting geometry. The former U-slot heuristic can select a thin branch
  // beside the intended corner and produce an unsafe diagonal cut.
  window.N2G_PROFILE_NARROW_SLOT_ENGINE='legacy';
}

function profileNarrowSlotReliefJS(loop,runs,halfD,strategy){
  if(strategy!=='cut_out' || !loop || loop.length<3 || !runs || !runs.length) return runs;
  if(typeof window!=='undefined' && window.N2G_PROFILE_NARROW_SLOT_ENGINE==='legacy') return runs;
  var toolD=halfD*2, tol=Math.max(0.08,toolD*0.02);
  var poly=loop.map(function(e){return {x:+e.x1,y:+e.y1};});
  var polyArea=polySignedAreaJS(poly);
  var slots=[];

  function cross(ax,ay,bx,by){return ax*by-ay*bx;}
  function segmentHit(a,b,c,d){
    var rx=b.x-a.x, ry=b.y-a.y, sx=d.x-c.x, sy=d.y-c.y;
    var den=cross(rx,ry,sx,sy); if(Math.abs(den)<1e-9) return null;
    var qx=c.x-a.x, qy=c.y-a.y;
    var t=cross(qx,qy,sx,sy)/den, u=cross(qx,qy,rx,ry)/den;
    if(t<-1e-6||t>1+1e-6||u<-1e-6||u>1+1e-6) return null;
    return {x:a.x+t*rx,y:a.y+t*ry};
  }

  for(var i=0;i<loop.length;i++){
    var e0=loop[i], e1=loop[(i+1)%loop.length], e2=loop[(i+2)%loop.length];
    var ax=e0.x2-e0.x1, ay=e0.y2-e0.y1, al=Math.hypot(ax,ay);
    var bx=e1.x2-e1.x1, by=e1.y2-e1.y1, bl=Math.hypot(bx,by);
    var cx=e2.x2-e2.x1, cy=e2.y2-e2.y1, cl=Math.hypot(cx,cy);
    // Hai canh ben chi can du sau de tam dao vuot qua mieng khe. Bat buoc
    // tung canh >= ca duong kinh dao se bo sot khe nong (Aspire van vet
    // duoc khi do sau kha dung > ban kinh dao).
    if(Math.abs(bl-toolD)>tol) continue;
    var parallel=(ax*cx+ay*cy)/(al*cl);
    var perp1=Math.abs((ax*bx+ay*by)/(al*bl));
    var perp2=Math.abs((cx*bx+cy*by)/(cl*bl));
    if(parallel>-0.98||perp1>0.05||perp2>0.05) continue;

    // Khe can vet co hai goc tai day la goc LOM cua polygon. Mot ngon/vau
    // vat lieu hep cung co ba canh dang chu U va cung co the rong bang dao,
    // nhung hai goc cua no la goc LOI; chen chu V vao do se cat xuyen vat.
    var turn1=cross(ax,ay,bx,by), turn2=cross(bx,by,cx,cy);
    if(Math.abs(polyArea)<1e-9 || turn1*polyArea>=0 || turn2*polyArea>=0) continue;

    var mouth={x:(e0.x1+e2.x2)/2,y:(e0.y1+e2.y2)/2};
    var cap={x:(e1.x1+e1.x2)/2,y:(e1.y1+e1.y2)/2};
    var dx=cap.x-mouth.x, dy=cap.y-mouth.y, depth=Math.hypot(dx,dy);
    if(depth<=halfD+tol) continue;
    var probe={x:(mouth.x+cap.x)/2,y:(mouth.y+cap.y)/2};
    if(_pointInPolyJS(probe.x,probe.y,poly)) continue; // protrusion/material, not a recess
    var ux=dx/depth, uy=dy/depth;
    slots.push({
      mouth:mouth,
      reach:{x:cap.x-ux*halfD,y:cap.y-uy*halfD},
      ray0:{x:mouth.x-ux*toolD*2,y:mouth.y-uy*toolD*2}
    });
  }

  slots.forEach(function(slot){
    var best=null;
    runs.forEach(function(run,ri){
      for(var j=0;j<run.length;j++){
        var a=run[j], b=run[(j+1)%run.length];
        var hit=segmentHit(a,b,slot.ray0,slot.reach);
        if(!hit) continue;
        var score=Math.hypot(hit.x-slot.mouth.x,hit.y-slot.mouth.y);
        if(!best||score<best.score) best={ri:ri,idx:j,score:score,hit:hit};
      }
    });
    if(best){
      var r=runs[best.ri];
      var before=r[best.idx], after=r[(best.idx+1)%r.length];
      var minMove=Math.max(0.05,halfD*0.05);
      if(Math.hypot(slot.reach.x-before.x,slot.reach.y-before.y)>minMove &&
         Math.hypot(slot.reach.x-after.x,slot.reach.y-after.y)>minMove){
        var sx=after.x-before.x, sy=after.y-before.y, sl=Math.hypot(sx,sy);
        if(sl>halfD*2+tol){
          sx/=sl; sy/=sl;
          var base1={x:best.hit.x-sx*halfD,y:best.hit.y-sy*halfD};
          var base2={x:best.hit.x+sx*halfD,y:best.hit.y+sy*halfD};
          if(Math.hypot(base2.x-before.x,base2.y-before.y)<Math.hypot(base1.x-before.x,base1.y-before.y)){
            var swap=base1;base1=base2;base2=swap;
          }
          r.splice(best.idx+1,0,base1,{x:slot.reach.x,y:slot.reach.y},base2);
        }
      }
    }
  });
  return runs;
}

function pocketContourRings(loop, halfD, stepover, maxRings, collapseEars){
  var rings = [];
  if(!loop || loop.length < 3) return rings;
  if(typeof ClipperLib!=='undefined') return pocketContourRingsClipper(loop,halfD,stepover,maxRings);
  var debugPocket14 = (typeof window !== 'undefined' && window.N2G_DEBUG_POCKET14 === true);
  // Bỏ EDGE cuối nếu là điểm trùng (x1,y1 == x2,y2 hoặc trùng điểm đầu loop) — loop
  // khép kín tường minh (điểm cuối = điểm đầu) tạo cạnh dài 0 → phép tính khoảng
  // cách tới biên trả 0 sai → vòng chèn bị loại oan. Chuẩn hóa loop trước khi dùng.
  var work = loop.filter(function(e){ return Math.hypot(e.x2-e.x1, e.y2-e.y1) > 1e-6; });
  if(work.length < 3) work = loop;
  var baseVerts = work.map(function(e){ return {x:e.x1, y:e.y1}; });
  // Bỏ đỉnh cuối nếu trùng đỉnh đầu (khép kín tường minh).
  if(baseVerts.length > 3){
    var _f=baseVerts[0], _l=baseVerts[baseVerts.length-1];
    if(Math.hypot(_l.x-_f.x, _l.y-_f.y) < 1e-6) baseVerts.pop();
  }
  var loopN = work;
  var baseArea = polySignedAreaJS(baseVerts);
  if(Math.abs(baseArea) < 1e-6) return rings;
  var baseSign = baseArea > 0 ? 1 : -1;
  var baseAbs  = Math.abs(baseArea);

  // Nhận diện cung LỒI (bo góc) 1 lần. Mỗi vòng offset, cung nào bị offset vượt bán
  // kính sẽ được thay bằng GÓC (giao 2 cạnh kề) thay vì để offsetPolygonMiter tạo
  // cung lật ngược. Hình không có cung → mảng rỗng → offset như cũ.
  var _arcs = _detectConvexArcsJS(baseVerts);
  var collapsedLoop = collapseEars ? collapsePocketEarsJS(work) : null;

  var off = halfD;
  var prevAbs = baseAbs;
  var lim = maxRings || 500;
  var lastGoodOff = null;
  for(var p=0; p<lim; p++){
    var sourceLoop = (collapsedLoop && off > halfD + 1e-6) ? collapsedLoop : loopN;
    var _loopEff = (sourceLoop===loopN && _arcs.length) ?
      _vertsToEdgesJS(_collapseArcsForOffsetJS(baseVerts, _arcs, off)) : sourceLoop;
    var r = offsetPolygonMiter(_loopEff, off, true, false);
    if(!r || r.length < 3) break;
    var sa = polySignedAreaJS(r);
    var absA = Math.abs(sa);
    var flipped = (sa === 0 || (sa > 0 ? 1 : -1) !== baseSign);
    var grew    = (absA > prevAbs + 1e-6);
    var selfCrossed = _polygonSelfIntersectsJS(r);
    // Kiểm MỌI điểm vòng này nằm trong biên gốc. Hình MẢNH/CHÉO có thể lật CỤC BỘ
    // (điểm ló ra ngoài) TRƯỚC khi winding tổng đổi dấu → phải bắt bằng point-in-poly,
    // không chỉ dựa vào area. Có điểm ngoài → coi như đã vượt, dừng (+ thử chèn vòng giữa).
    var hasOutside = false;
    for(var _q=0; _q<r.length; _q++){
      if(!_pointInPolyJS(r[_q].x, r[_q].y, baseVerts)){ hasOutside = true; break; }
    }
    // Tâm dao phải cách biên ÍT NHẤT bán kính dao. Chỉ kiểm "nằm trong đa giác" là
    // chưa đủ: hốc nhỏ hơn dao vẫn cho vòng nằm trong nhưng sát biên → dao cắt lẹm ra
    // ngoài (hốc 4x4 với dao D6 → vòng cách biên 1mm, lẹm 2mm). Khớp Ruby.
    var tooClose = false;
    var tooCloseInfo = null;
    for(var _t=0; _t<r.length; _t++){
      var _clearance = _minDistToPolyJS(r[_t].x, r[_t].y, baseVerts);
      if(_clearance < halfD - 0.05){
        tooClose = true;
        tooCloseInfo = { index: _t, x: r[_t].x, y: r[_t].y, clearance: _clearance };
        break;
      }
    }
    if(debugPocket14){
      var debugRing = {
        offset: off,
        point_count: r.length,
        signed_area: sa,
        flipped: flipped,
        grew: grew,
        has_outside: hasOutside,
        too_close: tooClose,
        too_close_info: tooCloseInfo,
        self_crossed: selfCrossed,
        valid: !(flipped || grew || selfCrossed || hasOutside || tooClose)
      };
      console.log('[N2G DEBUG] offset ring ABF_PHAY_14 ' + JSON.stringify(debugRing));
    }
    if(flipped || grew || selfCrossed || hasOutside || tooClose){
      if(lastGoodOff !== null && (off - lastGoodOff) > stepover*0.5 + 1e-6){
        var midResult = _largestValidOffsetRing(loopN, lastGoodOff, off, baseSign, prevAbs, baseVerts, halfD);
        if(debugPocket14){
          console.log('[N2G DEBUG] offset bridge ABF_PHAY_14 ' + JSON.stringify({
            from: lastGoodOff,
            to: off,
            result_offset: midResult ? midResult.off : null,
            delta: midResult ? midResult.off - lastGoodOff : null,
            min_delta: Math.max(stepover*0.25, 0.5),
            inserted: !!(midResult && midResult.ring && (midResult.off - lastGoodOff) >= Math.max(stepover*0.25, 0.5))
          }));
        }
        // Chỉ chèn nếu offset vòng chèn cách vòng TRƯỚC >= nửa stepover. Với hình
        // MẢNH, offset hợp lệ tối đa có thể chỉ nhỉnh hơn vòng trước vài phần mm →
        // 2 vòng dính sát nhau vô nghĩa (dao đã phủ chồng). Bỏ để tránh vòng thừa.
        if(midResult && midResult.ring && (midResult.off - lastGoodOff) >= Math.max(stepover*0.25, 0.5)){
          var mr = midResult.ring.slice(); mr.push({x:midResult.ring[0].x, y:midResult.ring[0].y});
          rings.push(mr);
        }
      }
      break;
    }
    // Dừng khi vòng suy biến về 0. KHÔNG dùng ngưỡng theo % diện tích gốc: ngưỡng đó
    // cắt sớm mấy vòng trong cùng nên tâm hốc bị sót vật liệu. Khớp Ruby.
    if(absA < 1e-6) break;
    var ring = r.slice();
    ring.push({x:r[0].x, y:r[0].y});
    rings.push(ring);
    prevAbs = absA;
    lastGoodOff = off;
    off += stepover;
  }
  return rings;
}

// Khoảng cách từ điểm (px,py) tới đoạn thẳng (ax,ay)-(bx,by).
function _distPointSegJS(px, py, ax, ay, bx, by){
  var dx=bx-ax, dy=by-ay, L2=dx*dx+dy*dy;
  if(L2 < 1e-12) return Math.hypot(px-ax, py-ay);
  var t=((px-ax)*dx+(py-ay)*dy)/L2;
  t = t<0?0:(t>1?1:t);
  var cx=ax+t*dx, cy=ay+t*dy;
  return Math.hypot(px-cx, py-cy);
}

// Khoảng cách nhỏ nhất từ 1 điểm tới BIÊN polygon (mọi cạnh).
function _minDistToPolyJS(px, py, verts){
  var n=verts.length, best=Infinity;
  for(var i=0;i<n;i++){
    var a=verts[i], b=verts[(i+1)%n];
    var d=_distPointSegJS(px, py, a.x, a.y, b.x, b.y);
    if(d<best) best=d;
  }
  return best;
}

function _polygonSelfIntersectsJS(pts){
  if(!pts || pts.length<4) return false;
  function orient(a,b,c){ return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); }
  function onSeg(a,b,p){ return p.x>=Math.min(a.x,b.x)-1e-7 && p.x<=Math.max(a.x,b.x)+1e-7 && p.y>=Math.min(a.y,b.y)-1e-7 && p.y<=Math.max(a.y,b.y)+1e-7; }
  function hit(a,b,c,d){
    var o1=orient(a,b,c),o2=orient(a,b,d),o3=orient(c,d,a),o4=orient(c,d,b);
    if(((o1>1e-7&&o2<-1e-7)||(o1<-1e-7&&o2>1e-7)) && ((o3>1e-7&&o4<-1e-7)||(o3<-1e-7&&o4>1e-7))) return true;
    return (Math.abs(o1)<=1e-7&&onSeg(a,b,c))||(Math.abs(o2)<=1e-7&&onSeg(a,b,d))||(Math.abs(o3)<=1e-7&&onSeg(c,d,a))||(Math.abs(o4)<=1e-7&&onSeg(c,d,b));
  }
  for(var i=0;i<pts.length;i++) for(var j=i+1;j<pts.length;j++){
    if(j===i+1 || (i===0&&j===pts.length-1)) continue;
    if(hit(pts[i],pts[(i+1)%pts.length],pts[j],pts[(j+1)%pts.length])) return true;
  }
  return false;
}

// Kiểm 1 điểm nằm TRONG polygon (ray casting). Dùng để loại vòng offset ló ra ngoài.
function _pointInPolyJS(px, py, verts){
  var inside = false, n = verts.length;
  for(var i=0, j=n-1; i<n; j=i++){
    var xi=verts[i].x, yi=verts[i].y, xj=verts[j].x, yj=verts[j].y;
    if(((yi>py)!==(yj>py)) && (px < (xj-xi)*(py-yi)/(yj-yi+1e-12)+xi)) inside = !inside;
  }
  return inside;
}

// Tìm vòng offset ở khoảng cách LỚN NHẤT còn hợp lệ trong (lo, hi] — dùng cho dải
// hẹp: khi bước stepover nhảy qua ngưỡng tự cắt, ta chèn 1 vòng sát ngưỡng để phủ
// nốt phần giữa. Nhị phân ~10 lần. Hợp lệ = winding đúng + area không phình + mọi
// điểm nằm TRONG biên gốc VÀ cách biên >= minClear (bán kính dao — offset danh nghĩa
// là 2mm thì điểm gần biên nhất cũng phải >= ~2mm, không được chạm vector).
function _largestValidOffsetRing(loop, lo, hi, baseSign, prevAbs, baseVerts, minClear){
  var best = null, bestOff = null;
  var a = lo, b = hi;
  for(var it=0; it<10; it++){
    var mid = (a + b) / 2;
    var r = offsetPolygonMiter(loop, mid);
    var ok = false;
    if(r && r.length >= 3){
      var sa = polySignedAreaJS(r);
      var absA = Math.abs(sa);
      ok = (sa !== 0) && ((sa > 0 ? 1 : -1) === baseSign) && (absA <= prevAbs + 1);
      if(ok && baseVerts){
        for(var k=0;k<r.length;k++){
          if(!_pointInPolyJS(r[k].x, r[k].y, baseVerts)){ ok = false; break; }
          if(minClear && _minDistToPolyJS(r[k].x, r[k].y, baseVerts) < minClear - 0.05){ ok = false; break; }
        }
      }
    }
    if(ok){ best = r; bestOff = mid; a = mid; }   // còn hợp lệ → thử xa hơn
    else  { b = mid; }                            // tự cắt/ló ngoài/sát biên → lùi lại
  }
  return best ? { ring: best, off: bestOff } : null;
}

// ── Vét sạch vành khăn giữa biên NGOÀI và ISLAND (contour-parallel, tổng quát) ──
// islandLoop, outerLoop: mảng edges {x1,y1,x2,y2}. halfD, stepover: thông số dao.
// Offset ISLAND ra ngoài từng vòng theo BIÊN DẠNG THẬT (giữ mọi bo góc/cong/nghiêng),
// mỗi vòng CẮT lấy phần hợp lệ (tâm dao nằm trong biên ngoài VÀ cách biên ngoài >=
// halfD → mép dao không vượt biên ngoài). Vòng cắt thành nhiều đoạn → mỗi đoạn 1
// đường HỞ. Vét tới khi không còn điểm hợp lệ (sát biên ngoài) = vét SẠCH.
// Không dùng bbox nên đúng cho MỌI biên dạng. Trả [{closed:bool, pts:[{x,y}]}].
function islandClearingRuns(islandLoop, outerLoop, halfD, stepover, maxRings){
  var runs = [];
  if(!islandLoop || islandLoop.length < 3 || !outerLoop || outerLoop.length < 3) return runs;
  var outerVerts = outerLoop.map(function(e){ return {x:e.x1, y:e.y1}; });
  function valid(pt){
    if(!_pointInPolyJS(pt.x, pt.y, outerVerts)) return false;
    if(_minDistToPolyJS(pt.x, pt.y, outerVerts) < halfD - 0.05) return false;
    return true;
  }
  var lim = maxRings || 500;
  var d = halfD;
  var anyValidEver = false;
  var lastValidD = null;   // d của vòng hợp lệ gần nhất
  for(var p=0; p<lim; p++){
    var off = offsetLoopJS(islandLoop, d, false);
    if(!off || off.length < 3) break;
    var flags = off.map(valid);
    var nValid = 0;
    for(var fi=0; fi<flags.length; fi++){ if(flags[fi]) nValid++; }
    if(nValid === 0){
      // Vòng ở d này vượt biên ngoài. Nếu vòng hợp lệ gần nhất vẫn còn cách biên
      // (còn hở dải), chèn 1 vòng KẸP ở khoảng cách tối đa còn hợp lệ thay vì bỏ
      // hẳn. Tránh sót dải sát biên ngoài (dải 10mm dao D6 step 5.4 → vòng 2 vượt
      // d_max=7 nên bị bỏ, chỉ ra 1 vòng). Khớp Ruby island_clearing_runs.
      if(anyValidEver && lastValidD !== null){
        var dMax = _findMaxValidDJS(islandLoop, valid, lastValidD, d);
        if(dMax !== null && (dMax - lastValidD) >= stepover * 0.5){
          var offC = offsetLoopJS(islandLoop, dMax, false);
          if(offC && offC.length >= 3 && offC.every(valid)){
            var ringC = offC.slice(); ringC.push({x:offC[0].x, y:offC[0].y});
            runs.push({closed:true, pts:ringC});
          }
        }
        break;
      }
      if(anyValidEver) break;   // đã vét xong (không còn khoảng trống)
      d += stepover;
      if(p > 5) break;          // island quá sát biên ngoài, không có vùng vét
      continue;
    }
    anyValidEver = true;
    lastValidD = d;
    if(nValid === off.length){
      var ring = off.slice(); ring.push({x:off[0].x, y:off[0].y});
      runs.push({closed:true, pts:ring});
    } else {
      // Vòng bị cắt → tách các ĐOẠN HỞ liên tiếp điểm hợp lệ (bắt đầu từ 1 điểm
      // KHÔNG hợp lệ để không cắt ngang đoạn hợp lệ).
      var n = off.length, start = -1;
      for(var i=0;i<n;i++){ if(!flags[i]){ start = i; break; } }
      var seg = [];
      for(var k=1;k<=n;k++){
        var idx = (start + k) % n;
        if(flags[idx]){ seg.push({x:off[idx].x, y:off[idx].y}); }
        else { if(seg.length >= 2) runs.push({closed:false, pts:seg}); seg = []; }
      }
      if(seg.length >= 2) runs.push({closed:false, pts:seg});
    }
    d += stepover;
  }
  return runs;
}

// Vét Pocket có island bằng Clipper. Giữ riêng islandClearingRuns/nhánh bbox cũ
// để có thể chuyển engine khi cần kiểm tra hồi quy.
// Sinh contour từ island ra ngoài: outer co vào halfD, island nở từ halfD theo
// stepover, sau đó cắt trong vùng outer an toàn.
function islandClearingRunsClipper(islandLoops, outerLoop, halfD, stepover, maxRings){
  var runs=[];
  if(typeof ClipperLib==='undefined' || !outerLoop || outerLoop.length<3 ||
     !islandLoops || !islandLoops.length) return runs;

  var scale=1000;
  function loopPath(loop){
    var edges=loop.filter(function(e){return Math.hypot(e.x2-e.x1,e.y2-e.y1)>1e-6;});
    var path=edges.map(function(e){return {X:Math.round(e.x1*scale),Y:Math.round(e.y1*scale)};});
    if(path.length>3 && path[0].X===path[path.length-1].X && path[0].Y===path[path.length-1].Y) path.pop();
    // Chuẩn hóa cùng orientation để union nhiều island không bị hiểu thành hole.
    if(path.length>=3 && !ClipperLib.Clipper.Orientation(path)) path.reverse();
    return path;
  }
  function offsetPaths(paths, delta){
    var co=new ClipperLib.ClipperOffset(2,0.25*scale), out=[];
    co.AddPaths(paths,ClipperLib.JoinType.jtRound,ClipperLib.EndType.etClosedPolygon);
    co.Execute(out,delta*scale);
    return out.filter(function(p){return p && p.length>=3 && Math.abs(ClipperLib.Clipper.Area(p))>=10;});
  }
  function unionPaths(paths){
    var c=new ClipperLib.Clipper(), out=[];
    c.AddPaths(paths,ClipperLib.PolyType.ptSubject,true);
    c.Execute(ClipperLib.ClipType.ctUnion,out,
      ClipperLib.PolyFillType.pftNonZero,ClipperLib.PolyFillType.pftNonZero);
    return out;
  }
  function clipContourLines(subject,clip){
    var lines=subject.map(function(p){
      var q=p.slice(); q.push({X:p[0].X,Y:p[0].Y}); return q;
    });
    var c=new ClipperLib.Clipper(), tree=new ClipperLib.PolyTree();
    c.AddPaths(lines,ClipperLib.PolyType.ptSubject,false);
    c.AddPaths(clip,ClipperLib.PolyType.ptClip,true);
    c.Execute(ClipperLib.ClipType.ctIntersection,tree,
      ClipperLib.PolyFillType.pftNonZero,ClipperLib.PolyFillType.pftNonZero);
    return ClipperLib.Clipper.OpenPathsFromPolyTree(tree).filter(function(p){return p && p.length>=2;});
  }

  var outerPath=loopPath(outerLoop);
  var islandPaths=islandLoops.map(loopPath).filter(function(p){return p.length>=3;});
  if(outerPath.length<3 || !islandPaths.length) return runs;

  var safeOuter=offsetPaths([outerPath],-halfD);
  if(!safeOuter.length) return runs;
  var d=halfD, lim=maxRings||500;
  var closedRuns=[], cornerRuns=[], finishRuns=[], runSeq=0;
  var safeXs=[], safeYs=[];
  safeOuter.forEach(function(poly){
    poly.forEach(function(p){safeXs.push(p.X/scale);safeYs.push(p.Y/scale);});
  });
  var safeCx=(Math.min.apply(null,safeXs)+Math.max.apply(null,safeXs))/2;
  var safeCy=(Math.min.apply(null,safeYs)+Math.max.apply(null,safeYs))/2;
  function cornerIndex(pts){
    var cx=0,cy=0;
    pts.forEach(function(p){cx+=p.x;cy+=p.y;});
    cx/=pts.length; cy/=pts.length;
    if(cy<safeCy) return cx<safeCx ? 0 : 1;
    return cx>=safeCx ? 2 : 3;
  }

  for(var pass=0;pass<lim;pass++){
    var expanded=offsetPaths(islandPaths,d);
    if(!expanded.length) break;
    expanded=unionPaths(expanded);
    var clipped=clipContourLines(expanded,safeOuter);
    if(!clipped.length){
      // Island đã nở phủ qua toàn bộ safe outer: chạy biên outer an toàn đúng
      // một lần để dọn các góc còn lại, rồi kết thúc.
      safeOuter.forEach(function(poly){
        var pts=poly.map(function(p){return {x:p.X/scale,y:p.Y/scale};});
        pts.push({x:pts[0].x,y:pts[0].y});
        finishRuns.push({closed:true,pts:pts});
      });
      break;
    }

    clipped.forEach(function(line){
      var pts=line.map(function(p){return {x:p.X/scale,y:p.Y/scale};});
      var closed=pts.length>2 && Math.hypot(pts[0].x-pts[pts.length-1].x,pts[0].y-pts[pts.length-1].y)<0.002;
      if(closed) pts[pts.length-1]={x:pts[0].x,y:pts[0].y};
      var run={closed:closed,pts:pts};
      if(closed){
        closedRuns.push(run);
      }else{
        cornerRuns.push({run:run,corner:cornerIndex(pts),pass:pass,seq:runSeq++});
      }
    });
    d+=stepover;
  }
  // Xử lý hết mọi offset của một góc rồi mới chuyển sang góc kế tiếp.
  // Trong mỗi góc giữ thứ tự island → outer (pass tăng dần).
  cornerRuns.sort(function(a,b){return a.corner-b.corner || a.pass-b.pass || a.seq-b.seq;});
  runs=closedRuns.concat(cornerRuns.map(function(item){return item.run;}),finishRuns);
  // maxRings chỉ là chốt an toàn. Không tự thêm outer khi dừng bởi giới hạn vì
  // như vậy có thể tạo một bước nhảy lớn qua vùng chưa vét.
  return runs;
}

// Nhị phân tìm offset LỚN NHẤT trong (lo..hi) mà offsetLoopJS còn cho vòng hợp lệ.
// Dùng để "kẹp" vòng cuối vào sát biên ngoài. Khớp Ruby find_max_valid_d.
function _findMaxValidDJS(islandLoop, validFn, lo, hi){
  if(hi <= lo) return null;
  var best = null;
  for(var it=0; it<20; it++){
    var mid = (lo + hi) / 2;
    var off = offsetLoopJS(islandLoop, mid, false);
    var ok = off && off.length >= 3 && off.every(validFn);
    if(ok){ best = mid; lo = mid; }
    else  { hi = mid; }
    if((hi - lo) < 0.05) break;
  }
  return best;
}

// Offset path HỞ theo TÂM bbox (khớp Ruby write_profile is_open): cut_out = ra XA
// tâm (mặt ngoài), cut_in = về GẦN tâm (mặt trong). Không phụ thuộc chiều vẽ. Áp
// cho C/L/U và mọi hướng. edges = mảng {x1,y1,x2,y2}. Trả mảng [{x,y}].
function offsetOpenCenterJS(edges, halfD, wantOut){
  var n = edges.length;
  if(!n) return null;
  var xs=[], ys=[];
  edges.forEach(function(e){ xs.push(e.x1, e.x2); ys.push(e.y1, e.y2); });
  var ocx=(Math.min.apply(null,xs)+Math.max.apply(null,xs))/2;
  var ocy=(Math.min.apply(null,ys)+Math.max.apply(null,ys))/2;
  function shift(x1,y1,x2,y2){
    var dx=x2-x1, dy=y2-y1, len=Math.hypot(dx,dy);
    if(len<1e-6) return [0,0];
    var nx=-dy/len, ny=dx/len;
    var mx=(x1+x2)/2, my=(y1+y2)/2;
    if(nx*(mx-ocx)+ny*(my-ocy) < 0){ nx=-nx; ny=-ny; }  // pháp tuyến ra XA tâm
    var s = wantOut ? halfD : -halfD;
    return [nx*s, ny*s];
  }
  var off=[];
  var e0=edges[0], s0=shift(e0.x1,e0.y1,e0.x2,e0.y2);
  if(s0[0]!==0||s0[1]!==0) off.push({x:e0.x1+s0[0], y:e0.y1+s0[1]});
  for(var i=0;i<n-1;i++){
    var e1=edges[i], e2=edges[i+1];
    var dx1=e1.x2-e1.x1, dy1=e1.y2-e1.y1, l1=Math.hypot(dx1,dy1);
    var dx2=e2.x2-e2.x1, dy2=e2.y2-e2.y1, l2=Math.hypot(dx2,dy2);
    if(l1<0.01||l2<0.01) continue;
    var s1=shift(e1.x1,e1.y1,e1.x2,e1.y2), s2=shift(e2.x1,e2.y1,e2.x2,e2.y2);
    var ox1=e1.x2+s1[0], oy1=e1.y2+s1[1];
    var ox2=e2.x1+s2[0], oy2=e2.y1+s2[1];
    var denom=dx1*dy2-dy1*dx2;
    if(Math.abs(denom)<0.001){
      off.push({x:(ox1+ox2)/2, y:(oy1+oy2)/2});
    } else {
      var t=((ox2-ox1)*dy2-(oy2-oy1)*dx2)/denom;
      var ix=ox1+t*dx1, iy=oy1+t*dy1;
      var dist=Math.hypot(ix-e1.x2, iy-e1.y2);
      off.push(dist>halfD*3 ? {x:(ox1+ox2)/2,y:(oy1+oy2)/2} : {x:ix,y:iy});
    }
  }
  var eL=edges[n-1], sL=shift(eL.x1,eL.y1,eL.x2,eL.y2);
  if(sL[0]!==0||sL[1]!==0) off.push({x:eL.x2+sL[0], y:eL.y2+sL[1]});
  return off;
}

function offsetLoopJS(loop, d, isOpen=false){
  if(!loop||loop.length<2) return null;
  let sign;
  if(isOpen){
    // Open path: d>0 = offset sang phải theo hướng đi
    sign = d > 0 ? 1 : -1;
  } else {
    // Closed path: tính winding trong canvas Y-down
    // area>0 → edges đi CW canvas = CCW CNC → offset ra ngoài cần sign=+d
    // area<0 → edges đi CCW canvas = CW CNC → offset ra ngoài cần sign=-d
    let area=0;
    loop.forEach(e=>area+=(e.x1*e.y2-e.x2*e.y1));
    const windSign = area > 0 ? -1 : 1;
    sign = d * windSign;
  }

  const n=loop.length;
  const pts=[];
  // Pre-compute bbox của loop gốc để check điểm giao
  const bboxXMin=Math.min.apply(null,loop.flatMap(function(e){return[e.x1,e.x2];}));
  const bboxXMax=Math.max.apply(null,loop.flatMap(function(e){return[e.x1,e.x2];}));
  const bboxYMin=Math.min.apply(null,loop.flatMap(function(e){return[e.y1,e.y2];}));
  const bboxYMax=Math.max.apply(null,loop.flatMap(function(e){return[e.y1,e.y2];}));

  if(isOpen){
    // Open path: tính offset từng điểm, không wrap i+1
    // Điểm đầu: chỉ dùng normal của edge đầu
    const e0=loop[0];
    const dx0=e0.x2-e0.x1,dy0=e0.y2-e0.y1,len0=Math.sqrt(dx0*dx0+dy0*dy0);
    if(len0>0.01){
      const nx=-dy0/len0,ny=dx0/len0;
      pts.push({x:e0.x1+nx*sign*Math.abs(d), y:e0.y1+ny*sign*Math.abs(d)});
    }
    // Các điểm giữa: dùng miter của edge[i-1] và edge[i]
    for(let i=0;i<n-1;i++){
      const e1=loop[i],e2=loop[i+1];
      const dx1=e1.x2-e1.x1,dy1=e1.y2-e1.y1,len1=Math.sqrt(dx1*dx1+dy1*dy1);
      const dx2=e2.x2-e2.x1,dy2=e2.y2-e2.y1,len2=Math.sqrt(dx2*dx2+dy2*dy2);
      if(len1<0.01||len2<0.01) continue;
      const nx1=-dy1/len1,ny1=dx1/len1;
      const nx2=-dy2/len2,ny2=dx2/len2;
      const ox1=e1.x2+nx1*sign*Math.abs(d),oy1=e1.y2+ny1*sign*Math.abs(d);
      const ox2=e2.x1+nx2*sign*Math.abs(d),oy2=e2.y1+ny2*sign*Math.abs(d);
      const denom=dx1*dy2-dy1*dx2;
      if(Math.abs(denom)<0.001){
        pts.push({x:(ox1+ox2)/2,y:(oy1+oy2)/2});
      } else {
        const t=((ox2-ox1)*dy2-(oy2-oy1)*dx2)/denom;
        const ix=ox1+t*dx1,iy=oy1+t*dy1;
        const dist=Math.sqrt((ix-e1.x2)**2+(iy-e1.y2)**2);
        pts.push(dist>Math.abs(d)*3 ? {x:(ox1+ox2)/2,y:(oy1+oy2)/2} : {x:ix,y:iy});
      }
    }
    // Điểm cuối: chỉ dùng normal của edge cuối
    const eL=loop[n-1];
    const dxL=eL.x2-eL.x1,dyL=eL.y2-eL.y1,lenL=Math.sqrt(dxL*dxL+dyL*dyL);
    if(lenL>0.01){
      const nx=-dyL/lenL,ny=dxL/lenL;
      pts.push({x:eL.x2+nx*sign*Math.abs(d), y:eL.y2+ny*sign*Math.abs(d)});
    }
    return pts;
  }

  for(let i=0;i<n;i++){
    const e1=loop[i];
    const e2=loop[(i+1)%n];
    // Normal của e1 (vuông góc trái)
    const dx1=e1.x2-e1.x1, dy1=e1.y2-e1.y1;
    const len1=Math.sqrt(dx1*dx1+dy1*dy1);
    if(len1<0.01){pts.push({x:e1.x2,y:e1.y2});continue;}
    const nx1=-dy1/len1, ny1=dx1/len1;
    // Normal của e2
    const dx2=e2.x2-e2.x1, dy2=e2.y2-e2.y1;
    const len2=Math.sqrt(dx2*dx2+dy2*dy2);
    if(len2<0.01){pts.push({x:e1.x2+nx1*sign,y:e1.y2+ny1*sign});continue;}
    const nx2=-dy2/len2, ny2=dx2/len2;

    // Giao điểm 2 đường offset (line intersection)
    // Line 1: e1.x2+nx1*sign + t*(dx1,dy1)
    // Line 2: e2.x1+nx2*sign + s*(dx2,dy2)
    const ox1=e1.x2+nx1*sign, oy1=e1.y2+ny1*sign;
    const ox2=e2.x1+nx2*sign, oy2=e2.y1+ny2*sign;
    const denom=dx1*dy2-dy1*dx2;
    if(Math.abs(denom)<0.001){
      // Song song → dùng trung bình
      pts.push({x:(ox1+ox2)/2, y:(oy1+oy2)/2});
    } else {
      const t=((ox2-ox1)*dy2-(oy2-oy1)*dx2)/denom;
      const ix=ox1+t*dx1, iy=oy1+t*dy1;
      const dist=Math.sqrt((ix-e1.x2)**2+(iy-e1.y2)**2);
      const tMax = (len1+Math.abs(d)) / Math.max(len1, 0.01);
      const tMin = len1 > Math.abs(d)*2 ? -(Math.abs(d)/Math.max(len1,0.01))*0.8 : -1.0;
      const outOfBbox = ix < bboxXMin-Math.abs(d)-0.5 || ix > bboxXMax+Math.abs(d)+0.5 ||
                        iy < bboxYMin-Math.abs(d)-0.5 || iy > bboxYMax+Math.abs(d)+0.5;
      if(dist > Math.abs(d)*3 || t < tMin || t > tMax || outOfBbox){
        // Fallback: dùng ox1 (endpoint edge1 offset) thay vì midpoint
        // Tránh jump do midpoint của edge dài bị lệch xa
        pts.push({x:ox1, y:oy1});
      } else {
        pts.push({x:ix, y:iy});
      }
    }
  }
  return pts;
}

// Detect full circle từ loop edges (port từ Ruby classify_segments)
// Port chính xác logic Ruby: tìm start point của toolpath cho is_small loop
function getStartPointJS(loop, offsetDist, sheetW, sheetH, preferStraight){
  const xs=loop.flatMap(function(e){return[e.x1,e.x2];}),
        ys=loop.flatMap(function(e){return[e.y1,e.y2];});
  const xMin=Math.min.apply(null,xs), xMax=Math.max.apply(null,xs);
  const yMin=Math.min.apply(null,ys), yMax=Math.max.apply(null,ys);
  const lp_cx=(xMin+xMax)/2, lp_cy=(yMin+yMax)/2;

  var sw = sheetW  || (typeof tpZm!=='undefined'&&tpZm.sheet ? tpZm.sheet.width  : 1220);
  var sh = sheetH  || (typeof tpZm!=='undefined'&&tpZm.sheet ? tpZm.sheet.height : 2440);
  var thresh_bot = (typeof afvThreshBot!=='undefined') ? afvThreshBot : 300;
  var thresh_top = (typeof afvThreshTop!=='undefined') ? afvThreshTop : 300;
  var cut_dir    = (typeof afvDir!=='undefined')       ? afvDir       : 'ccw';

  // Xác định vùng (DƯỚI/TRÊN ưu tiên)
  // QUY TẮC MỚI cho vùng trên/dưới — phải thỏa CẢ HAI:
  //   1. Tấm nằm NGANG (rộng > cao)
  //   2. Tấm lọt 100% trong dải ngưỡng (dùng bbox, KHÔNG dùng tâm)
  // Không thỏa → xét trái/phải theo tâm như cũ.
  var lp_w = xMax - xMin, lp_h = yMax - yMin;
  var isHoriz = lp_w > lp_h;
  var zone;
  if(isHoriz && yMax <= thresh_bot)              zone='bottom';   // trọn vẹn trong dải dưới
  else if(isHoriz && yMin >= sh - thresh_top)    zone='top';      // trọn vẹn trong dải trên
  else if(lp_cx < sw/2)                          zone='left';
  else                                           zone='right';

  // Entry corner theo SETTING người dùng (afvSel[zone]), không hardcode.
  // idx góc (canvas y-down): 0=trên-trái 1=trên-phải 2=dưới-phải 3=dưới-trái
  // Chuyển sang CNC (y-up, yMax=trên):
  //   0→(xMin,yMax) 1→(xMax,yMax) 2→(xMax,yMin) 3→(xMin,yMin)
  // ƯU TIÊN 1: override thủ công — TỌA ĐỘ ĐỈNH thật của chi tiết (tab Xem đường dao).
  var ovPt = (typeof entryFindPoint==='function') ? entryFindPoint(loop) : null;
  var sel = (typeof afvSel!=='undefined' && afvSel && afvSel[zone]!=null) ? afvSel[zone] : null;
  var ex, ey; // tọa độ CNC
  if(ovPt){
    ex = ovPt.x; ey = ovPt.y;
  } else if(sel!=null){
    if(sel===0)      { ex=xMin; ey=yMax; }
    else if(sel===1) { ex=xMax; ey=yMax; }
    else if(sel===2) { ex=xMax; ey=yMin; }
    else             { ex=xMin; ey=yMin; }
  } else if(cut_dir==='ccw'){
    if(zone==='left')   { ex=xMax; ey=yMax; }
    else if(zone==='right')  { ex=xMin; ey=yMin; }
    else if(zone==='top')    { ex=xMax; ey=yMin; }
    else                     { ex=xMin; ey=yMax; }
  } else {
    if(zone==='left')   { ex=xMin; ey=yMin; }
    else if(zone==='right')  { ex=xMax; ey=yMax; }
    else if(zone==='top')    { ex=xMin; ey=yMax; }
    else                     { ex=xMax; ey=yMin; }
  }

  // Tính offset_loop rồi snap đến điểm gần entry corner nhất
  var offPts = offsetLoopJS(loop, offsetDist, false);
  if(!offPts || offPts.length < 2) return null;

  // ── ĐIỂM XUỐNG DAO: ưu tiên nằm trên ĐOẠN THẲNG, tránh đoạn cong ──
  // CHỈ cho cuttinglines (preferStraight=true). Khớp Ruby straight_entry_point.
  if(preferStraight){
    var _dBack = (typeof STG!=='undefined' && STG.entry_backoff) ? (+STG.entry_backoff_mm||10) : 0;
    var _minSeg = Math.max(Math.abs(offsetDist)*2*3, 15);
    var _sp = straightEntryPointJS(offPts, ex, ey, _minSeg, _dBack);
    if(_sp) return _sp;
  }

  var bestI = 0, bestDist = Infinity;
  for(var i=0; i<offPts.length; i++){
    var dx=offPts[i].x-ex, dy=offPts[i].y-ey;
    var d=dx*dx+dy*dy;
    if(d<bestDist){ bestDist=d; bestI=i; }
  }
  return offPts[bestI];
}

// Entry-point engine. Set to 'legacy' to restore the previous corner selection.
if(typeof window!=='undefined' && typeof window.N2G_ENTRY_POINT_ENGINE==='undefined'){
  window.N2G_ENTRY_POINT_ENGINE='long-final-edge';
}

// For a clear rectangle, prefer a corner whose incoming (last-cut) edge is long.
function preferLongFinalEntryJS(loop, offPts, entryPt, wantCCW){
  if(!entryPt || !offPts || offPts.length<4) return entryPt;
  if(typeof window!=='undefined' && window.N2G_ENTRY_POINT_ENGINE==='legacy') return entryPt;
  if(typeof STG!=='undefined' && STG.long_final_edge===false) return entryPt;
  var src=(loop&&loop.edges)||loop;
  if(!src || src.length<4) return entryPt;
  var verts=src.map(function(e){return {x:+e.x1,y:+e.y1};});
  var xs=verts.map(function(p){return p.x;}), ys=verts.map(function(p){return p.y;});
  var xmin=Math.min.apply(null,xs), xmax=Math.max.apply(null,xs);
  var ymin=Math.min.apply(null,ys), ymax=Math.max.apply(null,ys);
  var w=xmax-xmin, h=ymax-ymin;
  if(w<0.01 || h<0.01 || Math.max(w,h)/Math.min(w,h)<1.15) return entryPt;
  var area=0;
  for(var i=0;i<verts.length;i++){
    var va=verts[i], vb=verts[(i+1)%verts.length];
    area+=va.x*vb.y-vb.x*va.y;
  }
  if(Math.abs(area)*0.5 < w*h*0.995) return entryPt;
  var pathArea=0;
  for(i=0;i<offPts.length;i++){
    var pa=offPts[i], pb=offPts[(i+1)%offPts.length];
    pathArea+=pa.x*pb.y-pb.x*pa.y;
  }
  var sameWinding=((pathArea>0)===!!wantCCW);
  var corners=[{x:xmin,y:ymax},{x:xmax,y:ymax},{x:xmax,y:ymin},{x:xmin,y:ymin}];
  var best=null;
  corners.forEach(function(c){
    var ci=0, cd=Infinity;
    for(var j=0;j<offPts.length;j++){
      var d=(offPts[j].x-c.x)*(offPts[j].x-c.x)+(offPts[j].y-c.y)*(offPts[j].y-c.y);
      if(d<cd){cd=d;ci=j;}
    }
    var ii=sameWinding ? (ci-1+offPts.length)%offPts.length : (ci+1)%offPts.length;
    var incoming=Math.hypot(offPts[ci].x-offPts[ii].x,offPts[ci].y-offPts[ii].y);
    var target=(c.x-entryPt.x)*(c.x-entryPt.x)+(c.y-entryPt.y)*(c.y-entryPt.y);
    if(!best || incoming>best.incoming+0.01 ||
       (Math.abs(incoming-best.incoming)<=0.01 && target<best.target)){
      best={pt:offPts[ci],incoming:incoming,target:target};
    }
  });
  return best ? {x:best.pt.x,y:best.pt.y} : entryPt;
}

// Tìm điểm xuống dao nằm SÂU trong một đoạn thẳng dài, gần (ex,ey) nhất.
// Nhận biết đoạn thẳng bằng ĐỘ DÀI: cung luôn bị chia thành nhiều khúc ngắn, còn
// cạnh thẳng là một đoạn dài liền mạch. Trả null nếu biên dạng toàn cung.
// Port từ Ruby straight_entry_point — phải giữ khớp.
function straightEntryPointJS(pts, ex, ey, minLen, backD){
  var n = pts.length;
  if(n < 3) return null;
  var segs = [], i, a, b;
  for(i=0; i<n; i++){
    a = pts[i]; b = pts[(i+1)%n];
    segs.push(Math.hypot(b.x-a.x, b.y-a.y));
  }
  // Đỉnh gần điểm xuống dao nhất. Nếu CẢ HAI cạnh kề đủ dài (≥ minLen) → đây là GÓC
  // của hai đoạn thẳng, KHÔNG phải cung → xuống dao ở góc là hợp lệ, không dời.
  // Khớp Ruby straight_entry_point.
  var vi = 0, vd = Infinity;
  for(i=0; i<n; i++){
    var dd = (pts[i].x-ex)*(pts[i].x-ex) + (pts[i].y-ey)*(pts[i].y-ey);
    if(dd < vd){ vd = dd; vi = i; }
  }
  var lenIn = segs[(vi-1+n)%n], lenOut = segs[vi];
  if(lenIn >= minLen && lenOut >= minLen) return null;

  var best = -1, bestD = Infinity;
  for(i=0; i<n; i++){
    if(segs[i] < minLen) continue;
    a = pts[i]; b = pts[(i+1)%n];
    var mx = (a.x+b.x)/2, my = (a.y+b.y)/2;
    var d = (mx-ex)*(mx-ex) + (my-ey)*(my-ey);
    if(d < bestD){ bestD = d; best = i; }
  }
  if(best < 0) return null;
  a = pts[best]; b = pts[(best+1)%n];
  var len = segs[best];
  var da = (a.x-ex)*(a.x-ex) + (a.y-ey)*(a.y-ey);
  var db = (b.x-ex)*(b.x-ex) + (b.y-ey)*(b.y-ey);
  var t;
  // Đoạn không đủ dài để lùi (lùi sẽ chạm cung đầu kia) → trung điểm: xa cả 2 cung nhất
  if(backD <= 0 || len <= backD*2) t = 0.5;
  else if(da <= db)                t = backD/len;
  else                             t = 1 - backD/len;
  return { x: a.x + (b.x-a.x)*t, y: a.y + (b.y-a.y)*t };
}

function detectCircleJS(loop){
  if(loop.length < 8) return null;
  const n=loop.length;
  const p1={x:loop[0].x1,                    y:loop[0].y1};
  const p2={x:loop[Math.floor(n/3)].x1,       y:loop[Math.floor(n/3)].y1};
  const p3={x:loop[Math.floor(n*2/3)].x1,     y:loop[Math.floor(n*2/3)].y1};
  const cc=circumcenterJS(p1,p2,p3);
  if(!cc) return null;
  const r=Math.sqrt((p1.x-cc.x)**2+(p1.y-cc.y)**2);
  const tol=Math.max(r*0.015, 1.5);
  const allOn=loop.every(e=>
    Math.abs(Math.sqrt((e.x1-cc.x)**2+(e.y1-cc.y)**2)-r)<=tol &&
    Math.abs(Math.sqrt((e.x2-cc.x)**2+(e.y2-cc.y)**2)-r)<=tol
  );
  const closed=Math.abs(loop[n-1].x2-loop[0].x1)<1.0 &&
               Math.abs(loop[n-1].y2-loop[0].y1)<1.0;
  if(!allOn || !closed) return null;

  // Đồng bộ với Ruby: kiểm tra bbox ratio và center
  const xs=loop.flatMap(e=>[e.x1,e.x2]), ys=loop.flatMap(e=>[e.y1,e.y2]);
  const bw=Math.max(...xs)-Math.min(...xs), bh=Math.max(...ys)-Math.min(...ys);
  const ratio = Math.max(bw,bh) / Math.max(Math.min(bw,bh), 0.001);
  const bboxCx=(Math.min(...xs)+Math.max(...xs))/2;
  const bboxCy=(Math.min(...ys)+Math.max(...ys))/2;
  const centerOk = Math.abs(cc.x-bboxCx) < r*0.1 && Math.abs(cc.y-bboxCy) < r*0.1;
  if(ratio >= 1.15 || !centerOk) return null; // viên thuốc hoặc shape bất thường

  return {cx:cc.x, cy:cc.y, r};
}

function circumcenterJS(p1,p2,p3){
  const ax=p1.x,ay=p1.y,bx=p2.x,by=p2.y,cx=p3.x,cy=p3.y;
  const D=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by));
  if(Math.abs(D)<1e-10) return null;
  const ux=((ax*ax+ay*ay)*(by-cy)+(bx*bx+by*by)*(cy-ay)+(cx*cx+cy*cy)*(ay-by))/D;
  const uy=((ax*ax+ay*ay)*(cx-bx)+(bx*bx+by*by)*(ax-cx)+(cx*cx+cy*cy)*(bx-ax))/D;
  return {x:ux, y:uy};
}

function drawArrow(ctx,x1,y1,x2,y2,color,dpr){
  const dx=x2-x1,dy=y2-y1,len=Math.sqrt(dx*dx+dy*dy);
  if(len<2)return;
  const ux=dx/len,uy=dy/len;
  const hs=8*dpr;  // chiều dài mũi tên
  const hw=0.5;    // độ rộng mũi tên
  ctx.fillStyle=color;
  ctx.beginPath();
  ctx.moveTo(x2,y2);
  ctx.lineTo(x2-ux*hs-uy*hs*hw,y2-uy*hs+ux*hs*hw);
  ctx.lineTo(x2-ux*hs+uy*hs*hw,y2-uy*hs-ux*hs*hw);
  ctx.closePath();ctx.fill();
}

function buildLoopsJS(vecs){
  if(!vecs||!vecs.length) return [];
  var remaining = vecs.slice();
  var loops = [];
  while(remaining.length > 0){
    var loop = [remaining.shift()];
    var maxIter = remaining.length*2 + 4;
    var iter = 0;
    var changed = true;
    while(changed && remaining.length > 0 && iter < maxIter){
      changed = false;
      iter++;
      var first0 = loop[0];
      var last = loop[loop.length-1];
      var tailX = last.x2, tailY = last.y2;
      // Loop ĐÃ KHÉP KÍN (đuôi về gần đầu, đủ cạnh) → DỪNG, không nối thêm. Tránh nối
      // tiếp sang hình KHÁC ở sát cạnh (vd 2 dogbone tai tròn gần nhau bị gộp 1 loop).
      if(loop.length >= 3 && Math.hypot(tailX-first0.x1, tailY-first0.y1) < 0.5) break;

      // 1) Nối vào ĐUÔI: tìm edge gần tail NHẤT (tránh nhảy sang hình khác).
      var bestI = -1, bestFlip = false, bestD = Infinity;
      for(var i = remaining.length-1; i >= 0; i--){
        var e = remaining[i];
        var d1 = Math.hypot(e.x1-tailX, e.y1-tailY);
        var d2 = Math.hypot(e.x2-tailX, e.y2-tailY);
        var dm = Math.min(d1, d2);
        if(dm < 0.5 && dm < bestD){ bestD = dm; bestI = i; bestFlip = (d2 < d1); }
      }
      if(bestI >= 0){
        var edge = remaining.splice(bestI, 1)[0];
        if(bestFlip){
          edge = {x1:edge.x2, y1:edge.y2, x2:edge.x1, y2:edge.y1,
                  color:edge.color, layer:edge.layer, is_drill_center:edge.is_drill_center,
                  group_id:edge.group_id};
        }
        loop.push(edge);
        changed = true;
        continue;
      }

      // 2) Hết edge nối đuôi → nối vào ĐẦU (prepend). Cần thiết cho ĐƯỜNG HỞ khi edge
      // khởi đầu nằm GIỮA đường (vd zigzag liền mạch): trước đây chỉ nối 1 chiều nên
      // phần phía trước bị bỏ lại thành loop riêng → dao nhấc lên chạy rời rạc.
      var headX = first0.x1, headY = first0.y1;
      var hI = -1, hFlip = false, hD = Infinity;
      for(var j = remaining.length-1; j >= 0; j--){
        var e2 = remaining[j];
        var e1d = Math.hypot(e2.x2-headX, e2.y2-headY);   // đuôi e2 chạm đầu loop → nối thẳng
        var e2d = Math.hypot(e2.x1-headX, e2.y1-headY);   // đầu e2 chạm đầu loop → cần lật
        var dmh = Math.min(e1d, e2d);
        if(dmh < 0.5 && dmh < hD){ hD = dmh; hI = j; hFlip = (e2d < e1d); }
      }
      if(hI >= 0){
        var edgeH = remaining.splice(hI, 1)[0];
        if(hFlip){
          edgeH = {x1:edgeH.x2, y1:edgeH.y2, x2:edgeH.x1, y2:edgeH.y1,
                   color:edgeH.color, layer:edgeH.layer, is_drill_center:edgeH.is_drill_center,
                   group_id:edgeH.group_id};
        }
        loop.unshift(edgeH);
        changed = true;
      }
    }
    var first = loop[0], last2 = loop[loop.length-1];
    loop._closed = Math.hypot(last2.x2-first.x1, last2.y2-first.y1) < 1.0;
    loops.push(loop);
  }
  return loops;
}

function minDistBorder(loop,sw,sh){
  const xs=loop.flatMap(v=>[v.x1,v.x2]),ys=loop.flatMap(v=>[v.y1,v.y2]);
  return Math.min(Math.min(...xs),sw-Math.max(...xs),Math.min(...ys),sh-Math.max(...ys));
}

// Detect island đúng: containedBy % 2 === 1 → island thực
// containedBy=0 → outer, =1 → island, =2 → tấm con trong island (cut_out), =3 → island trong island...
// ── Loop `inner` có THỰC SỰ nằm trong loop `outer` không ──────────────────────
// Chỉ so bbox lồng nhau là không đủ: hình LÕM (L/U/C) có bbox rộng hơn vùng vật
// liệu thật, nên chi tiết nằm trong phần KHUYẾT bị nhận nhầm là island → đường
// chạy dao sai. Lọc nhanh bằng bbox, rồi kiểm thật bằng point-in-polygon trên
// nhiều điểm mẫu (đỉnh + trung điểm cạnh), quá nửa nằm trong thì mới coi là lồng.
// Khớp Ruby loop_inside_loop?.
function loopInsideLoopJS(innerEdges, outerEdges){
  if(!innerEdges || !outerEdges) return false;
  if(innerEdges.length < 2 || outerEdges.length < 3) return false;
  var ixs=[], iys=[], oxs=[], oys=[], i;
  for(i=0;i<innerEdges.length;i++){ ixs.push(innerEdges[i].x1, innerEdges[i].x2);
                                    iys.push(innerEdges[i].y1, innerEdges[i].y2); }
  for(i=0;i<outerEdges.length;i++){ oxs.push(outerEdges[i].x1, outerEdges[i].x2);
                                    oys.push(outerEdges[i].y1, outerEdges[i].y2); }
  if(!(Math.min.apply(null,ixs) > Math.min.apply(null,oxs) &&
       Math.max.apply(null,ixs) < Math.max.apply(null,oxs) &&
       Math.min.apply(null,iys) > Math.min.apply(null,oys) &&
       Math.max.apply(null,iys) < Math.max.apply(null,oys))) return false;
  var poly = outerEdges.map(function(e){ return {x:e.x1, y:e.y1}; });
  var samples = [];
  for(i=0;i<innerEdges.length;i++){
    var e = innerEdges[i];
    samples.push({x:e.x1, y:e.y1});
    samples.push({x:(e.x1+e.x2)/2, y:(e.y1+e.y2)/2});
  }
  if(!samples.length) return false;
  var inside = 0;
  for(i=0;i<samples.length;i++){
    if(_pointInPolyJS(samples[i].x, samples[i].y, poly)) inside++;
  }
  return inside*2 > samples.length;
}

function detectIslandJS(loops, bbs){
  // group_id của mỗi loop (lấy từ edge đầu). Island chỉ xét trong CÙNG group_id:
  // 2 loop khác chi tiết (khác group_id) không bao giờ là island, dù bbox lồng nhau
  // (vd chi tiết nhỏ nằm trong phần khuyết của chi tiết lớn).
  var gids = loops.map(function(loop){
    return (loop && loop[0] && loop[0].group_id != null) ? loop[0].group_id : null;
  });
  var containCount=loops.map(function(_,i){
    return bbs.filter(function(_,j){
      if(i===j) return false;
      // Chỉ tính loop j bao quanh loop i nếu CÙNG group_id (cùng chi tiết)
      if(gids[i]!=null && gids[j]!=null && gids[i]!==gids[j]) return false;
      // Lồng THẬT, không chỉ lồng bbox (xem loopInsideLoopJS)
      return loopInsideLoopJS(loops[i], loops[j]);
    }).length;
  });
  return containCount.map(function(c){ return c%2===1; });
}
