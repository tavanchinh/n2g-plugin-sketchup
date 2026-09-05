// ── tp-pocket.js — Vẽ toolpath hạ nền (pocket) ──
// Load SAU cam-geometry.js

// Vẽ 1 đường chạy dao (mảng điểm canvas) với NÉT ĐỨT + MŨI TÊN cách quãng.
// pts: [{x,y}...] đã transform sang toạ độ canvas. arrowGap: khoảng cách px giữa mũi tên.
function pocketDisplayStyle(index){
  index = Math.max(0, index || 0);
  if(index === 0) return { color:'rgba(150,85,225,0.95)', width:1.1 };
  return index % 2 === 0
    ? { color:'rgba(123,63,196,0.84)', width:0.9 }
    : { color:'rgba(145,82,210,0.84)', width:0.9 };
}

function strokePocketPath(ctx, pts, color, dpr, arrowGap, lineWidth){
  if(!pts || pts.length < 2) return;
  arrowGap = arrowGap || 55*dpr;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = dpr*(lineWidth || 0.9);
  ctx.setLineDash([5*dpr, 4*dpr]);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for(var i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();
  // Mũi tên cách quãng theo tổng chiều dài tích luỹ
  var acc = 0, nextAt = arrowGap*0.5;
  for(var j=1;j<pts.length;j++){
    var x1=pts[j-1].x, y1=pts[j-1].y, x2=pts[j].x, y2=pts[j].y;
    var segLen = Math.hypot(x2-x1, y2-y1);
    if(segLen < 0.01) continue;
    while(acc + segLen >= nextAt){
      var t = (nextAt - acc) / segLen;
      var ax = x1 + (x2-x1)*t, ay = y1 + (y2-y1)*t;
      drawArrow(ctx, x1, y1, ax, ay, color, dpr);
      nextAt += arrowGap;
    }
    acc += segLen;
  }
}

// ── Offset đa giác LÕM (concave) — cho pocket hình L/U ──
// Diện tích có dấu: >0 = CCW, <0 = CW
function polyAreaSignedJS(pts){
  var a=0, n=pts.length;
  for(var i=0;i<n;i++){ var j=(i+1)%n; a+=pts[i].x*pts[j].y - pts[j].x*pts[i].y; }
  return a/2;
}

// Offset polygon vào trong khoảng d. Trả mảng điểm, hoặc null nếu suy biến.
function offsetConcaveJS(pts, d){
  var n=pts.length;
  if(n<3) return null;
  var ccw = polyAreaSignedJS(pts) > 0;
  var lines=[];
  for(var i=0;i<n;i++){
    var p1=pts[i], p2=pts[(i+1)%n];
    var dx=p2.x-p1.x, dy=p2.y-p1.y, L=Math.hypot(dx,dy);
    if(L<1e-9) continue;
    // normal vào trong: CCW→(-dy,dx), CW→(dy,-dx)
    var nx = ccw ? -dy/L : dy/L;
    var ny = ccw ?  dx/L : -dx/L;
    lines.push({x:p1.x+nx*d, y:p1.y+ny*d, dx:dx, dy:dy});
  }
  var m=lines.length;
  if(m<3) return null;
  function intersect(l1,l2){
    var den=l1.dx*l2.dy - l1.dy*l2.dx;
    if(Math.abs(den)<1e-9) return null;
    var t=((l2.x-l1.x)*l2.dy - (l2.y-l1.y)*l2.dx)/den;
    return {x:l1.x+l1.dx*t, y:l1.y+l1.dy*t};
  }
  var res=[];
  for(var k=0;k<m;k++){
    var pt=intersect(lines[(k-1+m)%m], lines[k]);
    if(!pt) return null;
    res.push(pt);
  }
  return res;
}

// Detect hình LÕM (concave): có đỉnh phản (reflex) → không lồi.
// Trả true nếu polygon lõm (cần pocket offset theo biên dạng).
function isConcaveJS(pts){
  var n=pts.length;
  if(n<4) return false;
  var sign=0;
  for(var i=0;i<n;i++){
    var a=pts[i], b=pts[(i+1)%n], c=pts[(i+2)%n];
    var cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
    if(Math.abs(cross)<1e-9) continue;
    var s = cross>0 ? 1 : -1;
    if(sign===0) sign=s;
    else if(s!==sign) return true; // đổi dấu → có đỉnh lõm
  }
  return false;
}

// Detect hình CÓ CẠNH CONG (cung tròn): đếm điểm rẽ nhẹ đều.
// Ổn định hơn isConcaveJS (không nhạy với sai số làm tròn của cung rời rạc).
// Dùng để: hình bo tròn / có cung → offset theo BIÊN THẬT thay vì coi là rect.
// Trả true nếu có đủ nhiều điểm cong (cung tròn cần ≥ ~6 điểm rẽ nhẹ).
function hasCurvedEdgesJS(pts, minCurved){
  minCurved = minCurved || 6;
  var n=pts.length;
  if(n<8) return false;
  var curved=0;
  for(var i=0;i<n;i++){
    var a=pts[(i-1+n)%n], b=pts[i], c=pts[(i+1)%n];
    var v1x=b.x-a.x, v1y=b.y-a.y, v2x=c.x-b.x, v2y=c.y-b.y;
    var l1=Math.sqrt(v1x*v1x+v1y*v1y), l2=Math.sqrt(v2x*v2x+v2y*v2y);
    if(l1<0.01||l2<0.01) continue;
    var dot=(v1x*v2x+v1y*v2y)/(l1*l2);
    var ang=Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI;
    if(ang>1 && ang<40) curved++;   // rẽ nhẹ đều = điểm trên cung
  }
  return curved >= minCurved;
}

// Kiểm tra mọi điểm offset còn nằm TRONG polygon gốc (an toàn — không lấn ra ngoài)
function allInsideJS(offPts, origPts, tol){
  tol = tol || 0.1;
  for(var i=0;i<offPts.length;i++){
    if(!pointInPolyJS(offPts[i].x, offPts[i].y, origPts)) return false;
  }
  return true;
}

// Nối edge thành polygon khép kín đúng thứ tự (cho point-in-poly)
function orderLoopPointsJS(edges, tol){
  tol = tol || 0.05;
  if(!edges || !edges.length) return [];
  var used = new Array(edges.length).fill(false);
  var loop = [{x:edges[0].x1,y:edges[0].y1},{x:edges[0].x2,y:edges[0].y2}];
  used[0]=true;
  for(var k=0;k<edges.length*3;k++){
    var cx=loop[loop.length-1].x, cy=loop[loop.length-1].y, found=false;
    for(var i=0;i<edges.length;i++){
      if(used[i]) continue;
      if(Math.abs(edges[i].x1-cx)<tol && Math.abs(edges[i].y1-cy)<tol){
        loop.push({x:edges[i].x2,y:edges[i].y2}); used[i]=true; found=true; break;
      } else if(Math.abs(edges[i].x2-cx)<tol && Math.abs(edges[i].y2-cy)<tol){
        loop.push({x:edges[i].x1,y:edges[i].y1}); used[i]=true; found=true; break;
      }
    }
    if(!found) break;
  }
  var clean=[loop[0]];
  for(var j=1;j<loop.length;j++){
    if(Math.abs(loop[j].x-clean[clean.length-1].x)>tol || Math.abs(loop[j].y-clean[clean.length-1].y)>tol)
      clean.push(loop[j]);
  }
  // Bỏ điểm CUỐI nếu trùng điểm ĐẦU (điểm đóng vòng bị lặp). Giữ lại thì mọi phép
  // duyệt theo bộ ba đỉnh (isConcaveJS, hasCurvedEdgesJS...) cho tích có hướng = 0
  // tại ĐÚNG đỉnh đầu tiên, nên đỉnh đó bị bỏ sót. Khớp Ruby order_loop_points.
  if(clean.length>2 &&
     Math.abs(clean[0].x-clean[clean.length-1].x)<=tol &&
     Math.abs(clean[0].y-clean[clean.length-1].y)<=tol){
    clean.pop();
  }
  return clean;
}

function pointInPolyJS(x,y,poly){
  var n=poly.length, inside=false, j=n-1;
  for(var i=0;i<n;i++){
    var xi=poly[i].x, yi=poly[i].y, xj=poly[j].x, yj=poly[j].y;
    if(((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi+1e-12)+xi)) inside=!inside;
    j=i;
  }
  return inside;
}

// Thử detect dogbone theo MỘT trục cụ thể (longIsX = true/false)
function tryDogboneAxis(loopPts, halfD, longIsX){
  var xs=loopPts.map(function(p){return p.x;}), ys=loopPts.map(function(p){return p.y;});
  var x0=Math.min.apply(null,xs), x1=Math.max.apply(null,xs);
  var y0=Math.min.apply(null,ys), y1=Math.max.apply(null,ys);
  // Các đỉnh lõm của dogbone là chỗ tai relief nối vào thân và phải nằm gần
  // hai ĐẦU của trục dài. Khấc lớn nằm giữa chi tiết không phải dogbone.
  var signedArea=0;
  for(var ai=0;ai<loopPts.length;ai++){
    var aj=(ai+1)%loopPts.length;
    signedArea+=loopPts[ai].x*loopPts[aj].y-loopPts[aj].x*loopPts[ai].y;
  }
  var areaSign=signedArea>=0?1:-1,reflexCount=0;
  var endTol=Math.max(halfD*3,1.0);
  for(var ri=0;ri<loopPts.length;ri++){
    var ra=loopPts[(ri-1+loopPts.length)%loopPts.length];
    var rb=loopPts[ri],rc=loopPts[(ri+1)%loopPts.length];
    var cross=(rb.x-ra.x)*(rc.y-rb.y)-(rb.y-ra.y)*(rc.x-rb.x);
    if(cross*areaSign < -1e-7){
      reflexCount++;
      var lc=longIsX?rb.x:rb.y;
      var l0=longIsX?x0:y0, l1=longIsX?x1:y1;
      if(Math.min(Math.abs(lc-l0),Math.abs(l1-lc))>endTol) return null;
    }
  }
  if(reflexCount<2) return null;
  var lr,rr,sr,bx0,bx1,by0,by1;
  if(longIsX){ bx0=x0+halfD; bx1=x1-halfD; lr=[x0,bx0]; rr=[bx1,x1]; sr=[y0,y1]; }
  else       { by0=y0+halfD; by1=y1-halfD; lr=[y0,by0]; rr=[by1,y1]; sr=[x0,x1]; }
  function cov(lrng,srng){
    var nl=8,ns=30,ins=0,tot=0;
    for(var i=0;i<nl;i++){
      var lp=lrng[0]+(lrng[1]-lrng[0])*(i+0.5)/nl;
      for(var jj=0;jj<ns;jj++){
        var sp=srng[0]+(srng[1]-srng[0])*(jj+0.5)/ns; tot++;
        var px=longIsX?lp:sp, py=longIsX?sp:lp;
        if(pointInPolyJS(px,py,loopPts)) ins++;
      }
    }
    return tot>0?ins/tot:0;
  }
  var cl=cov(lr,sr), cr=cov(rr,sr);
  if(!(cl<0.9 && cr<0.9 && cl>0.05 && cr>0.05)) return null;
  // Loại chữ nhật bo góc: hull/bbox < 0.98 (góc bo lõm vào)
  var hull=convexHullJS(loopPts);
  var hullArea=polyAreaJS(hull), bboxArea=(x1-x0)*(y1-y0);
  var ratio=bboxArea>0?hullArea/bboxArea:0;
  if(ratio<0.98) return null;
  // Chốt chặn BO GÓC triệt để: 4 góc hộp bao lùi chéo vào một đoạn nhỏ phải nằm
  // TRONG hình. Góc VUÔNG (dogbone) → điểm lùi trong vật liệu; góc BO TRÒN → NGOÀI.
  // Bắt cả bo bán kính nhỏ-vừa mà ngưỡng hull/bbox bỏ sót. Khớp Ruby.
  var _inset = Math.min(halfD*0.4, 3.0); if(_inset<1.0) _inset=1.0;
  var _cs = [[x0,y0,1,1],[x1,y0,-1,1],[x1,y1,-1,-1],[x0,y1,1,-1]];
  for(var _ci=0;_ci<4;_ci++){
    if(!pointInPolyJS(_cs[_ci][0]+_cs[_ci][2]*_inset, _cs[_ci][1]+_cs[_ci][3]*_inset, loopPts)) return null;
  }
  if(longIsX) return {longIsX:true, bx0:x0+halfD, bx1:x1-halfD, by0:y0, by1:y1};
  return {longIsX:false, bx0:x0, bx1:x1, by0:y0+halfD, by1:y1-halfD};
}

// Detect dogbone: trả về {longIsX,bx0,bx1,by0,by1} hoặc null.
// Hình gần VUÔNG (tai 4 cạnh, đối xứng) → thử cả 2 trục, nhận cái hợp lệ.
function detectDogboneJS(loopPts, halfD){
  if(!loopPts || loopPts.length<4 || halfD<=0) return null;
  // Dogbone thật phải có ít nhất một đỉnh lõm tại chỗ tai relief nối với
  // thân. Polygon hoàn toàn lồi (ví dụ chữ nhật bo góc) không phải dogbone.
  if(!isConcaveJS(loopPts)) return null;
  var xs=loopPts.map(function(p){return p.x;}), ys=loopPts.map(function(p){return p.y;});
  var bw=Math.max.apply(null,xs)-Math.min.apply(null,xs);
  var bh=Math.max.apply(null,ys)-Math.min.apply(null,ys);
  if(bw<halfD*2 || bh<halfD*2) return null;
  // gần vuông nếu chênh lệch < 5% cạnh lớn → thử cả 2 trục
  var nearSquare = Math.abs(bw-bh)/Math.max(bw,bh) < 0.05;
  if(nearSquare){
    return tryDogboneAxis(loopPts,halfD,true) || tryDogboneAxis(loopPts,halfD,false);
  }
  return tryDogboneAxis(loopPts, halfD, bw>=bh);
}

// Xoay 1 điểm quanh tâm (cx,cy) theo góc rad.
function _rotPtJS(p, cx, cy, ca, sa){
  var dx=p.x-cx, dy=p.y-cy;
  return { x: cx+dx*ca-dy*sa, y: cy+dx*sa+dy*ca };
}

// Phát hiện dogbone NGHIÊNG: xoay hình về thẳng trục (theo cạnh dài nhất) rồi thử
// detectDogboneJS. Nếu là dogbone, trả về { rotated: {...dog}, angle, cx, cy } để
// bên vẽ dựng đường trong hệ xoay rồi xoay NGƯỢC về gốc. Trả null nếu không phải.
function detectDogboneRotatedJS(loopPts, halfD){
  if(!loopPts || loopPts.length<4) return null;
  // Góc = hướng cạnh DÀI NHẤT (trục chính của rãnh/mộng).
  var maxLen=0, angle=0;
  for(var i=0;i<loopPts.length;i++){
    var a=loopPts[i], b=loopPts[(i+1)%loopPts.length];
    var d=Math.hypot(b.x-a.x, b.y-a.y);
    if(d>maxLen){ maxLen=d; angle=Math.atan2(b.y-a.y, b.x-a.x); }
  }
  // Đã gần thẳng trục (|góc| < 2° hoặc gần 90°) → để detectDogboneJS thường lo.
  var deg=Math.abs(angle*180/Math.PI) % 90;
  if(deg < 2 || deg > 88) return null;
  var cx=0, cy=0, n=loopPts.length;
  for(var k=0;k<n;k++){ cx+=loopPts[k].x; cy+=loopPts[k].y; }
  cx/=n; cy/=n;
  // Xoay -angle về thẳng trục.
  var ca=Math.cos(-angle), sa=Math.sin(-angle);
  var rotPts=loopPts.map(function(p){ return _rotPtJS(p, cx, cy, ca, sa); });
  var dog=detectDogboneJS(rotPts, halfD);
  if(!dog) return null;
  return { rotated: dog, rotPts: rotPts, angle: angle, cx: cx, cy: cy };
}

function convexHullJS(pts){
  var uniq=pts.map(function(p){return [Math.round(p.x*1000)/1000,Math.round(p.y*1000)/1000];});
  var seen={},u=[];
  uniq.forEach(function(c){var k=c[0]+','+c[1];if(!seen[k]){seen[k]=1;u.push(c);}});
  u.sort(function(a,b){return a[0]-b[0]||a[1]-b[1];});
  if(u.length<3) return u.map(function(c){return {x:c[0],y:c[1]};});
  function cross(o,a,b){return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);}
  var lower=[];
  u.forEach(function(p){
    while(lower.length>=2 && cross(lower[lower.length-2],lower[lower.length-1],p)<=0) lower.pop();
    lower.push(p);
  });
  var upper=[];
  for(var i=u.length-1;i>=0;i--){
    var p=u[i];
    while(upper.length>=2 && cross(upper[upper.length-2],upper[upper.length-1],p)<=0) upper.pop();
    upper.push(p);
  }
  var h=lower.slice(0,-1).concat(upper.slice(0,-1));
  return h.map(function(c){return {x:c[0],y:c[1]};});
}

function polyAreaJS(poly){
  var a=0, n=poly.length;
  for(var i=0;i<n;i++){var j=(i+1)%n; a+=poly[i].x*poly[j].y-poly[j].x*poly[i].y;}
  return Math.abs(a)/2;
}

function drawToolpathPocket(ctx,vecs,tool,tx,ty,sc,dpr){
  if(typeof window !== 'undefined'){
    window.N2G_DEBUG_POCKET14 = ((tool.layer||'').toUpperCase().replace(/[^A-Z0-9]/g,'')==='ABFPHAY14');
  }
  const loops=buildLoopsJS(vecs.filter(function(v){return !v.is_drill_center;}))
    .filter(function(lp){
      var xs=lp.flatMap(function(e){return[e.x1,e.x2];}),ys=lp.flatMap(function(e){return[e.y1,e.y2];});
      return (Math.max.apply(null,xs)-Math.min.apply(null,xs))>1.0 ||
             (Math.max.apply(null,ys)-Math.min.apply(null,ys))>1.0;
    });
  const stepoverMM=(tool.diameter*(tool.stepover||90)/100);
  const step=stepoverMM*sc*dpr;
  const halfD=tool.diameter/2;

  // Detect island
  const bbs=loops.map(function(loop){
    var xs=loop.flatMap(function(v){return[v.x1,v.x2];}),ys=loop.flatMap(function(v){return[v.y1,v.y2];});
    return{xMin:Math.min.apply(null,xs),xMax:Math.max.apply(null,xs),yMin:Math.min.apply(null,ys),yMax:Math.max.apply(null,ys)};
  });
  const isIsland=detectIslandJS(loops,bbs);

  if((tool.layer||'').toUpperCase().replace(/[^A-Z0-9]/g,'')==='ABFPHAY14'){
    console.log('[N2G DEBUG] pocket loops ABF_PHAY_14', {
      loop_count: loops.length,
      island_flags: isIsland,
      diameter: tool.diameter,
      stepover_percent: tool.stepover,
      stepover_mm: stepoverMM
    });
  }


  loops.forEach(function(loop, li){
    const xs=loop.flatMap(function(v){return[v.x1,v.x2];}),ys=loop.flatMap(function(v){return[v.y1,v.y2];});
    const bxMin=Math.min.apply(null,xs),bxMax=Math.max.apply(null,xs);
    const byMin=Math.min.apply(null,ys),byMax=Math.max.apply(null,ys);
    if((tool.layer||'').toUpperCase().replace(/[^A-Z0-9]/g,'')==='ABFPHAY14'){
      console.log('[N2G DEBUG] pocket geometry ABF_PHAY_14', {
        loop_index: li,
        edge_count: loop.length,
        closed: !!loop._closed,
        width: bxMax-bxMin,
        height: byMax-byMin,
        half_d: halfD,
        stepover: stepoverMM,
        is_island: !!isIsland[li]
      });
      console.log('[N2G DEBUG] pocket points ABF_PHAY_14 ' + JSON.stringify(
        orderLoopPointsJS(loop).map(function(p){ return {x:p.x, y:p.y}; })
      ));
    }
    // Thu thập ĐƯỜNG CHẠY THẬT (điểm gốc, chưa transform) cho animation.
    var pocketRuns=[];
    function collectRun(origPts, breakBefore, allowNearbyJoin){
      if(origPts && origPts.length>1){
        var forwardJump=null,reverseJump=null,maxSafeConnector=null;
        var nearbyJoinApproved=false;
        // Clipper có thể gắn _breakBefore sau khi contour dogbone từng bị split.
        // Nếu hai đường vẫn thuộc cùng dogbone và khoảng cách hình học không quá
        // stepover thì đây không phải vùng/loop khác: giữ dao ở Z cắt.
        if(allowNearbyJoin && pocketRuns.length){
          var prevGeom=pocketRuns[pocketRuns.length-1];
          if(prevGeom && prevGeom.length>1){
            var minGeomDist=Infinity;
            function pointSegDist(p,a,b){
              var dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
              if(l2<1e-12) return Math.hypot(p.x-a.x,p.y-a.y);
              var t=((p.x-a.x)*dx+(p.y-a.y)*dy)/l2;
              t=Math.max(0,Math.min(1,t));
              return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));
            }
            function scanPathDistance(points,segments){
              points.forEach(function(p){
                for(var si=0;si<segments.length-1;si++){
                  minGeomDist=Math.min(minGeomDist,pointSegDist(p,segments[si],segments[si+1]));
                }
              });
            }
            scanPathDistance(prevGeom,origPts);
            scanPathDistance(origPts,prevGeom);
            if(minGeomDist<=stepoverMM+0.01){
              breakBefore=false;
              nearbyJoinApproved=true;
            }
          }
        }
        // Universal fail-safe: adjacent contour offsets should only be about
        // one stepover apart. A longer jump means another component/region or
        // an unexpected ordering; never make that move at cutting Z.
        if(pocketRuns.length && !breakBefore && !nearbyJoinApproved){
          var prevRun=pocketRuns[pocketRuns.length-1];
          var prevEnd=prevRun && prevRun[prevRun.length-1];
          var prevStart=prevRun && prevRun[0];
          var nextStart=origPts[0];
          var nextEnd=origPts[origPts.length-1];
          maxSafeConnector=Math.max(stepoverMM*1.5,tool.diameter*1.25,1.0);
          forwardJump=(prevEnd&&nextStart) ?
            Math.hypot(nextStart.x-prevEnd.x,nextStart.y-prevEnd.y) : Infinity;
          reverseJump=(nextEnd&&prevStart) ?
            Math.hypot(prevStart.x-nextEnd.x,prevStart.y-nextEnd.y) : Infinity;
          // Chỉ ngắt khi CẢ HAI cách ghép đều quá xa. Với centerline dài, một
          // đầu nối với contour ngoài→trong và đầu đối diện nối khi đảo in_out;
          // dùng OR ở đây làm chèn Safe-Z dù luôn có một đầu hợp lệ.
          if(forwardJump>maxSafeConnector && reverseJump>maxSafeConnector){
            breakBefore=true;
          }
        }
        // G-code keeps Z down between offsets of this same Pocket. Show the
        // real cutting connector in preview as well.
        if(pocketRuns.length && !breakBefore){
          var prev=pocketRuns[pocketRuns.length-1];
          var a=prev[prev.length-1], b=origPts[0];
          // in_out reverses the run list without reversing each open run, so
          // its real connector is current.end -> previous.start.
          var connector=(tool.direction==='in_out') ?
            [origPts[origPts.length-1],prev[0]] : [a,b];
          if(connector[0] && connector[1] &&
             Math.hypot(connector[1].x-connector[0].x,
                        connector[1].y-connector[0].y)>0.001){
            var cs=pocketDisplayStyle(pocketRuns.length);
            strokePocketPath(ctx,connector.map(function(p){return {x:tx(p.x),y:ty(p.y)};}),
              cs.color,dpr,null,cs.width);
          }
        }
        if(breakBefore) pocketRuns.push([]); // Safe-Z separator for Ruby/simulator.
        pocketRuns.push(origPts.map(function(p){return {x:p.x,y:p.y};}));
        if((tool.layer||'').toUpperCase().replace(/[^A-Z0-9]/g,'')==='ABFPHAY14'){
          console.log('[N2G DEBUG] pocket run ABF_PHAY_14', {
            loop_index: li,
            run_index: pocketRuns.length-1,
            point_count: origPts.length
          });
        }
      }
    }
    var pocketPathObj={type:'pocket',tool,bxMin,bxMax,byMin,byMax,runs:pocketRuns};
    tpRenderedPaths.push(pocketPathObj);

    // Island: vẽ viền đỏ nét đứt, không hạ nền vào
    if(isIsland[li]){
      ctx.strokeStyle='rgba(220,60,60,0.7)';
      ctx.lineWidth=dpr*1.2;
      ctx.setLineDash([4*dpr,3*dpr]);
      ctx.beginPath();
      loop.forEach(function(e,i){
        if(i===0) ctx.moveTo(tx(e.x1),ty(e.y1));
        ctx.lineTo(tx(e.x2),ty(e.y2));
      });
      ctx.closePath(); ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    const maxPasses=Math.ceil(Math.min(bxMax-bxMin,byMax-byMin)/(2*stepoverMM))+2;

    // ── Dogbone check: vẽ đường chạy dao mộng dogbone (khớp write_pocket_dogbone) ──
    var dogPts=orderLoopPointsJS(loop);
    var dog=detectDogboneJS(dogPts, halfD);
    // Dogbone NGHIÊNG: nếu không nhận thẳng trục, thử xoay về thẳng trục.
    var dogRot = dog ? null : detectDogboneRotatedJS(dogPts, halfD);
    if(dog || dogRot){
      // Dogbone engine. Clipper offsets the REAL dogbone contour, including all
      // relief ears. Set window.N2G_POCKET_DOGBONE_ENGINE='legacy' to restore
      // the previous rectangle-body + four corner plunges algorithm.
      if(typeof window!=='undefined' && typeof window.N2G_POCKET_DOGBONE_ENGINE==='undefined'){
        window.N2G_POCKET_DOGBONE_ENGINE='clipper';
      }
      var dogboneEngine=(typeof window!=='undefined' && window.N2G_POCKET_DOGBONE_ENGINE) || 'clipper';
      if(dogboneEngine!=='legacy' && typeof pocketContourRingsClipper==='function'){
        var dogClipperRings=pocketContourRingsClipper(loop,halfD,stepoverMM,maxPasses+5);
        if(dogClipperRings.length>0){
          dogClipperRings.forEach(function(ring,ri){
            var dogClipPts=ring.map(function(pt){return {x:tx(pt.x),y:ty(pt.y)};});
            var dogClipStyle=pocketDisplayStyle(ri);
            strokePocketPath(ctx,dogClipPts,dogClipStyle.color,dpr,null,dogClipStyle.width);
            collectRun(ring.map(function(pt){return {x:pt.x,y:pt.y};}),ring._breakBefore===true,true);
          });
          return;
        }
        console.warn('[N2G Pocket] Clipper dogbone did not create a valid path; using legacy.', {
          layer:tool.layer, loop_index:li, rotated:!!dogRot
        });
      }

      var so=stepoverMM;
      var dogStyle=pocketDisplayStyle(0);
      var col=dogStyle.color;
      // Nếu nghiêng: làm việc trong hệ XOAY (dùng dogRot.rotated + rotPts), rồi mọi
      // điểm sinh ra sẽ xoay NGƯỢC về gốc trước khi vẽ/chạy dao.
      var D = dogRot ? dogRot.rotated : dog;
      var caB=0, saB=0, Rcx=0, Rcy=0, isRot=!!dogRot;
      if(isRot){ caB=Math.cos(dogRot.angle); saB=Math.sin(dogRot.angle); Rcx=dogRot.cx; Rcy=dogRot.cy; }
      // Xoay NGƯỢC 1 điểm (từ hệ thẳng trục về gốc nghiêng). Nếu không nghiêng: giữ nguyên.
      function back(px, py){
        if(!isRot) return {x:px, y:py};
        var dx=px-Rcx, dy=py-Rcy;
        return { x: Rcx+dx*caB-dy*saB, y: Rcy+dx*saB+dy*caB };
      }
      // Offset 1 (ngoài) — gom điểm gồm cả động tác đâm 4 góc, theo đúng thứ tự chạy dao
      var o1x0=D.bx0+halfD, o1y0=D.by0+halfD, o1x1=D.bx1-halfD, o1y1=D.by1-halfD;
      var midL=(o1x0+o1x1)/2, midS=(o1y0+o1y1)/2;
      var corners=[{x:o1x0,y:o1y0},{x:o1x1,y:o1y0},{x:o1x1,y:o1y1},{x:o1x0,y:o1y1}];
      var p1=[], p1orig=[];
      corners.forEach(function(c){
        var g=back(c.x,c.y);
        p1.push({x:tx(g.x),y:ty(g.y)}); p1orig.push({x:g.x,y:g.y});
        // đâm góc: ra rồi về (tạo tai) — tính trong hệ xoay rồi back
        var ex,ey;
        if(D.longIsX){ ex=c.x+((c.x<=midL)?-1:1)*halfD; ey=c.y; }
        else          { ex=c.x; ey=c.y+((c.y<=midS)?-1:1)*halfD; }
        var ge=back(ex,ey);
        p1.push({x:tx(ge.x),y:ty(ge.y)}); p1orig.push({x:ge.x,y:ge.y});
        p1.push({x:tx(g.x),y:ty(g.y)}); p1orig.push({x:g.x,y:g.y});
      });
      var g0=back(corners[0].x,corners[0].y);
      p1.push({x:tx(g0.x),y:ty(g0.y)}); // khép vòng
      p1orig.push({x:g0.x,y:g0.y});
      strokePocketPath(ctx, p1, col, dpr, null, dogStyle.width);
      collectRun(p1orig);
      // DỌN NỀN: chạy pocketContourRings trên CHỮ NHẬT TRONG sạch (biên trong sau khi
      // trừ bán kính dao), KHÔNG dùng đường viền dogbone gốc — khấc mộng lõm ở góc sẽ
      // tạo điểm sát biên làm contour rings loại nhầm hết vòng (ra 0 vòng). Chữ nhật
      // trong này là vùng vật liệu thật cần vét. Vòng đầu ~ trùng p1 nên bỏ.
      // Số vòng = 1 (p1) + phần còn lại → KHỚP hình vuông không dogbone.
      // DỌN NỀN: chạy pocketContourRings trên CHỮ NHẬT THÂN sạch (D.bx0..by1) với bán
      // kính dao THẬT — cùng hàm, cùng tham số như hình vuông không dogbone → số vòng
      // KHỚP. Không truyền half_d≈0 (đưa điểm nằm đúng trên biên vào point-in-poly, bị
      // loại nhầm). Vòng ngoài cùng (ở halfD từ biên) = offset 1 (đâm góc) nên bỏ.
      var bodyEdges = [
        {x1:D.bx0, y1:D.by0, x2:D.bx1, y2:D.by0},
        {x1:D.bx1, y1:D.by0, x2:D.bx1, y2:D.by1},
        {x1:D.bx1, y1:D.by1, x2:D.bx0, y2:D.by1},
        {x1:D.bx0, y1:D.by1, x2:D.bx0, y2:D.by0}
      ];
      if(isRot){   // hình nghiêng → đưa chữ nhật thân về hệ gốc
        bodyEdges = bodyEdges.map(function(e){
          var a=back(e.x1,e.y1), b=back(e.x2,e.y2);
          return {x1:a.x, y1:a.y, x2:b.x, y2:b.y};
        });
      }
      var clearRings = (pocketContourRings(bodyEdges, halfD, so, 200) || []).slice(1);
      clearRings.forEach(function(r, ri){
        var pk=[], pkOrig=[];
        r.forEach(function(p){ pk.push({x:tx(p.x),y:ty(p.y)}); pkOrig.push({x:p.x,y:p.y}); });
        var clearStyle=pocketDisplayStyle(ri+1);
        strokePocketPath(ctx, pk, clearStyle.color, dpr, null, clearStyle.width);
        collectRun(pkOrig);
      });
      return;
    }

    const circ=detectCircleJS(loop);
    if(circ){
      var currentR=circ.r-halfD;
      var p=0;
      while(currentR>0.01&&p<maxPasses){
        // rời rạc hoá đường tròn thành điểm để vẽ nét đứt + mũi tên
        var cpts=[], cptsOrig=[], N=48;
        for(var k=0;k<=N;k++){
          var ang=k/N*Math.PI*2;
          cpts.push({x:tx(circ.cx+currentR*Math.cos(ang)), y:ty(circ.cy+currentR*Math.sin(ang))});
          cptsOrig.push({x:circ.cx+currentR*Math.cos(ang), y:circ.cy+currentR*Math.sin(ang)});
        }
        var circleStyle=pocketDisplayStyle(p);
        strokePocketPath(ctx, cpts, circleStyle.color, dpr, null, circleStyle.width);
        collectRun(cptsOrig);
        currentR-=stepoverMM; p++;
      }
      return;
    }

    // ── Nhánh BIÊN DẠNG THẬT: hình LÕM (L/U) HOẶC hình CÓ CUNG TRÒN (bo tròn) ──
    // offsetConcaveJS offset đúng biên cho cả 2 loại. Dùng hasCurvedEdgesJS (ổn định)
    // Kiểm loop này có chứa ISLAND bên trong không. Nếu CÓ → KHÔNG đi nhánh concave
    // (nhánh concave phay đầy toàn hình, sẽ đè island). Để xuống nhánh island xử lý.
    var _hasIslandInside = false;
    loops.forEach(function(other, oj){
      if(oj===li || !isIsland[oj]) return;
      // island oj có nằm trong loop li THẬT không (hình học, không phải bbox):
      // hình lõm có bbox rộng hơn vật liệu nên bbox cho kết quả sai.
      if(loopInsideLoopJS(other, loop)) _hasIslandInside = true;
    });

    // để bắt hình bo tròn mà isConcaveJS hay bỏ sót (sai số cung rời rạc).
    var concavePts = orderLoopPointsJS(loop);
    if(!_hasIslandInside && concavePts.length>=4 && (isConcaveJS(concavePts) || hasCurvedEdgesJS(concavePts))){
      // Offset theo BIÊN DẠNG THẬT bằng pocketContourRings (miter — ổn định cho hình
      // NGHIÊNG, lõm, có cung). offsetConcaveJS cũ giao 2 đường thẳng cạnh kề nên khi
      // hình nghiêng có cạnh gần song song → giao điểm không ổn định → offset méo/ra
      // ngoài biên → dừng sau 1 vòng. Miter dùng trung bình normal nên ổn định.
      // Cần loop (edges x1,y1). concavePts là điểm → dựng edges khép kín.
      var ccLoop = [];
      for(var _i=0;_i<concavePts.length;_i++){
        var _a=concavePts[_i], _b=concavePts[(_i+1)%concavePts.length];
        ccLoop.push({x1:_a.x, y1:_a.y, x2:_b.x, y2:_b.y});
      }
      var ccRings = pocketContourRings(ccLoop, halfD, stepoverMM, maxPasses+5,
        (tool.layer||'').toUpperCase().replace(/[^A-Z0-9]/g,'')==='ABFPHAY14');
      if(ccRings.length > 0){
        ccRings.forEach(function(ring, ri){
          var pts=ring.map(function(pp){return {x:tx(pp.x),y:ty(pp.y)};});
          var ccStyle=pocketDisplayStyle(ri);
          strokePocketPath(ctx, pts, ccStyle.color, dpr, null, ccStyle.width);
          collectRun(ring.map(function(pp){return {x:pp.x,y:pp.y};}),ring._breakBefore===true);
        });
        return;
      }
    }

    // Kiểm tra có arc không (complex shape) — bỏ qua dogbone nhỏ
    function hasArcEdges(loop, minArcR){
      minArcR = minArcR || 5; // arc < 5mm → dogbone, bỏ qua
      if(loop.length < 8) return false;
      for(var i=0; i<loop.length-4; i+=2){
        var cc=circumcenterJS({x:loop[i].x1,y:loop[i].y1},{x:loop[i+2].x1,y:loop[i+2].y1},{x:loop[i+4].x1,y:loop[i+4].y1});
        if(!cc) continue;
        var r=Math.sqrt((loop[i].x1-cc.x)**2+(loop[i].y1-cc.y)**2);
        if(r < minArcR) continue; // dogbone hoặc arc quá nhỏ
        var tol=Math.max(r*0.05,1.0);
        if(Math.abs(Math.sqrt((loop[i+2].x1-cc.x)**2+(loop[i+2].y1-cc.y)**2)-r)<tol &&
           Math.abs(Math.sqrt((loop[i+4].x1-cc.x)**2+(loop[i+4].y1-cc.y)**2)-r)<tol){
          var xs2=loop.flatMap(function(e){return[e.x1,e.x2];}),ys2=loop.flatMap(function(e){return[e.y1,e.y2];});
          var bw2=Math.max.apply(null,xs2)-Math.min.apply(null,xs2),bh2=Math.max.apply(null,ys2)-Math.min.apply(null,ys2);
          if(Math.max(bw2,bh2)/Math.max(Math.min(bw2,bh2),0.01)>1.15) return true;
        }
      }
      return false;
    }
    var hasArc = hasArcEdges(loop, tool.diameter);

    if(hasArc && !_hasIslandInside){
      // Offset theo BIÊN DẠNG THẬT (contour-parallel) — đúng cho hình bo cung ở
      // MỌI hướng (kể cả nằm nghiêng). Trước đây scale theo tâm/bbox thẳng trục nên
      // hình nghiêng bị sai (chỉ ra 1 vòng). pocketContourRings xử lý winding + dừng
      // đúng khi co về rỗng.
      var arcRings = pocketContourRings(loop, halfD, stepoverMM, maxPasses+5);
      arcRings.forEach(function(ring, ri){
        var spts = ring.map(function(pt){ return {x:tx(pt.x), y:ty(pt.y)}; });
        var arcStyle=pocketDisplayStyle(ri);
        strokePocketPath(ctx, spts, arcStyle.color, dpr, null, arcStyle.width);
        collectRun(ring.map(function(pt){ return {x:pt.x, y:pt.y}; }),ring._breakBefore===true);
      });
    } else {
      // Pocket có island: offset từ island ra ngoài (như Aspire)
      // Pocket không có island: rect shrink từ ngoài vào

      // Tìm tất cả islands thuộc loop này
      var islandLoops = [];
      bbs.forEach(function(bb, j){
        if(!isIsland[j] || j===li) return;
        // Lồng THẬT (hình học) thay vì so bbox — xem loopInsideLoopJS.
        if(loopInsideLoopJS(loops[j], loop)){
          islandLoops.push(loops[j]);
        }
      });

      if(islandLoops.length > 0){
        // Biên ngoài có phải CHỮ NHẬT THUẦN không (mọi cạnh song song trục)? Nếu bo
        // góc/cong → bbox rect SAI (vượt biên ngoài, không bo theo biên dạng). Dùng
        // thuật toán vét TỔNG QUÁT (islandClearingRuns) theo biên dạng thật. Chữ nhật
        // thuần → giữ thuật toán cũ (bbox rect + corner cleanup) đã tinh chỉnh kỹ.
        var outerIsRect = true;
        loop.forEach(function(e){
          var dx=Math.abs(e.x2-e.x1), dy=Math.abs(e.y2-e.y1);
          if(dx>0.1 && dy>0.1) outerIsRect = false;   // có cạnh xéo/cong
        });

        // Mặc định dùng Clipper cho mọi biên ngoài có island, bao gồm
        // chữ nhật, bo góc và biên cong. Giữ nhánh cũ bên dưới làm fallback.
        // Có thể đặt
        // window.N2G_POCKET_ISLAND_ENGINE='legacy' trước khi mở preview để dùng lại.
        var islandEngine = (typeof window!=='undefined' && window.N2G_POCKET_ISLAND_ENGINE) || 'clipper';
        if(islandEngine!=='legacy' && typeof islandClearingRunsClipper==='function'){
          var clipperIslandRuns=islandClearingRunsClipper(
            islandLoops,loop,halfD,stepoverMM,maxPasses*4,tool.direction
          );
          // Independent check against the original geometry. This also guards
          // against Clipper orientation differences in expanded island paths.
          if(typeof markUnsafePocketConnectorsJS==='function'){
            clipperIslandRuns=markUnsafePocketConnectorsJS(
              clipperIslandRuns,loop,islandLoops,halfD,tool.direction
            );
          }
          if(clipperIslandRuns.length>0){
            clipperIslandRuns.forEach(function(run,ri){
              var clipPts=run.pts.map(function(pt){return {x:tx(pt.x),y:ty(pt.y)};});
              var clipStyle=pocketDisplayStyle(ri);
              strokePocketPath(ctx,clipPts,clipStyle.color,dpr,null,clipStyle.width);
              collectRun(run.pts.map(function(pt){return {x:pt.x,y:pt.y};}),run.breakBefore===true);
            });
            return;
          }
          console.warn('[N2G Pocket] Clipper island không tạo được đường chạy; dùng legacy.', {
            layer:tool.layer, loop_index:li, island_count:islandLoops.length
          });
        }

        if(!outerIsRect){
          // ── Biên ngoài BO GÓC/CONG → vét tổng quát theo biên dạng thật ──
          var clrRuns = islandClearingRuns(islandLoops[0], loop, halfD, stepoverMM, maxPasses*4);
          if(typeof markUnsafePocketConnectorsJS==='function'){
            clrRuns=markUnsafePocketConnectorsJS(clrRuns,loop,islandLoops,halfD,tool.direction);
          }
          clrRuns.forEach(function(run, ri){
            var spts = run.pts.map(function(pt){ return {x:tx(pt.x), y:ty(pt.y)}; });
            var islandStyle=pocketDisplayStyle(ri);
            strokePocketPath(ctx, spts, islandStyle.color, dpr, null, islandStyle.width);
            collectRun(run.pts.map(function(pt){ return {x:pt.x, y:pt.y}; }),run.breakBefore===true);
          });
          return;
        }

        // ── Biên ngoài CHỮ NHẬT THUẦN → thuật toán cũ (bbox + corner cleanup) ──
        // Tính bbox island
        var iBB = {
          xMin: Math.min.apply(null, islandLoops.map(function(l){ return bbs[loops.indexOf(l)].xMin; })),
          xMax: Math.max.apply(null, islandLoops.map(function(l){ return bbs[loops.indexOf(l)].xMax; })),
          yMin: Math.min.apply(null, islandLoops.map(function(l){ return bbs[loops.indexOf(l)].yMin; })),
          yMax: Math.max.apply(null, islandLoops.map(function(l){ return bbs[loops.indexOf(l)].yMax; }))
        };

        // Khoảng cách từ outer bbox đến island bbox mỗi phía
        var gapL = iBB.xMin - bxMin;
        var gapR = bxMax - iBB.xMax;
        var gapB = iBB.yMin - byMin;
        var gapT = byMax - iBB.yMax;
        // Khoảng hạ nền tối đa = gap - halfD (dao không xâm phạm island)
        var maxOffL = gapL - halfD;
        var maxOffR = gapR - halfD;
        var maxOffB = gapB - halfD;
        var maxOffT = gapT - halfD;

        var currentOffset = halfD;
        var p = 0;
        var _lastOff = null;   // offset thực của vòng trước (để bỏ vòng clamp quá sát)
        while(p < maxPasses * 4){
          var offL = Math.min(currentOffset, maxOffL);
          var offR = Math.min(currentOffset, maxOffR);
          var offB = Math.min(currentOffset, maxOffB);
          var offT = Math.min(currentOffset, maxOffT);
          // Offset "hiệu lực" của vòng này (nhỏ nhất trong 4 phía đã clamp).
          var effOff = Math.min(offL, offR, offB, offT);
          // Nếu vòng này bị CLAMP (currentOffset vượt maxOff) và quá SÁT vòng trước
          // (cách < nửa stepover) → bỏ, tránh vẽ thừa 1 vòng dính sát vòng trước.
          var clamped = currentOffset > effOff + 0.001;
          if(clamped && _lastOff !== null && (effOff - _lastOff) < stepoverMM*0.5){
            break;
          }
          var rx0 = bxMin + offL;
          var rx1 = bxMax - offR;
          var ry0 = byMin + offB;
          var ry1 = byMax - offT;
          if(rx1 <= rx0 || ry1 <= ry0) break;
          var rectStyle=pocketDisplayStyle(p);
          strokePocketPath(ctx, [
            {x:tx(rx0),y:ty(ry0)},{x:tx(rx0),y:ty(ry1)},{x:tx(rx1),y:ty(ry1)},
            {x:tx(rx1),y:ty(ry0)},{x:tx(rx0),y:ty(ry0)}
          ], rectStyle.color, dpr, null, rectStyle.width);
          collectRun([{x:rx0,y:ry0},{x:rx0,y:ry1},{x:rx1,y:ry1},{x:rx1,y:ry0},{x:rx0,y:ry0}]);
          _lastOff = effOff;
          if(currentOffset >= maxOffL && currentOffset >= maxOffR &&
             currentOffset >= maxOffB && currentOffset >= maxOffT) break;
          currentOffset+=stepoverMM; p++;
        }

        // Corner cleanup: 4 góc với L-shape + arc theo biên dạng island
        var midX=(iBB.xMin+iBB.xMax)/2, midY=(iBB.yMin+iBB.yMax)/2;
        var cornerDefs=[
          {name:'BL',getXY:function(d){return{xLine:iBB.xMin+d,yLine:iBB.yMin+d};},
           fx:function(p){return p.x<=midX;},fy:function(p){return p.y<=midY;},
           checkStop:function(xl,yl,gL,gB){return xl>=gB.x||yl>=gL.y;},arcDir:-1},
          {name:'BR',getXY:function(d){return{xLine:iBB.xMax-d,yLine:iBB.yMin+d};},
           fx:function(p){return p.x>=midX;},fy:function(p){return p.y<=midY;},
           checkStop:function(xl,yl,gL,gB){return xl<=gB.x||yl>=gL.y;},arcDir:1},
          {name:'TL',getXY:function(d){return{xLine:iBB.xMin+d,yLine:iBB.yMax-d};},
           fx:function(p){return p.x<=midX;},fy:function(p){return p.y>=midY;},
           checkStop:function(xl,yl,gL,gB){return xl>=gB.x||yl<=gL.y;},arcDir:1},
          {name:'TR',getXY:function(d){return{xLine:iBB.xMax-d,yLine:iBB.yMax-d};},
           fx:function(p){return p.x>=midX;},fy:function(p){return p.y>=midY;},
           checkStop:function(xl,yl,gL,gB){return xl<=gB.x||yl<=gL.y;},arcDir:-1}
        ];

        ctx.save();
        cornerDefs.forEach(function(c){
          for(var pass=0;pass<20;pass++){
            var d=halfD+pass*stepoverMM;
            var xy=c.getXY(d);
            var xLine=xy.xLine, yLine=xy.yLine;

            var offPts=offsetLoopJS(islandLoops[0],d,false);
            if(!offPts||offPts.length<3) break;
            var nn=offPts.length;

            var gLeft=null,gBottom=null,gLeftSeg=-1,gBottomSeg=-1;
            for(var ii=0;ii<nn;ii++){
              var p1=offPts[ii],p2=offPts[(ii+1)%nn];
              if((p1.x-xLine)*(p2.x-xLine)<=0&&Math.abs(p1.x-p2.x)>0.001){
                var tt=(xLine-p1.x)/(p2.x-p1.x),yy=p1.y+tt*(p2.y-p1.y);
                if(c.fy({x:xLine,y:yy})){gLeft={x:xLine,y:yy};gLeftSeg=ii;}
              }
              if((p1.y-yLine)*(p2.y-yLine)<=0&&Math.abs(p1.y-p2.y)>0.001){
                var tt2=(yLine-p1.y)/(p2.y-p1.y),xx2=p1.x+tt2*(p2.x-p1.x);
                if(c.fx({x:xx2,y:yLine})){gBottom={x:xx2,y:yLine};gBottomSeg=ii;}
              }
            }
            if(!gLeft||!gBottom) break;
            if(c.checkStop(xLine,yLine,gLeft,gBottom)) break;

            var arcSeg=[gLeft];
            var fwdSteps = (gBottomSeg - gLeftSeg + nn) % nn;
            var bwdSteps = (gLeftSeg - gBottomSeg + nn) % nn;
            var dir = (fwdSteps <= bwdSteps) ? 1 : -1;
            var cur=gLeftSeg,maxIter=nn;
            while(cur!==gBottomSeg&&maxIter-->0){
              arcSeg.push(offPts[cur]);
              cur=(cur+dir+nn)%nn;
            }
            arcSeg.push(offPts[gBottomSeg]);
            arcSeg.push(gBottom);

            var cpath=[{x:tx(xLine),y:ty(yLine)},{x:tx(gLeft.x),y:ty(gLeft.y)}];
            arcSeg.forEach(function(pt){cpath.push({x:tx(pt.x),y:ty(pt.y)});});
            cpath.push({x:tx(xLine),y:ty(yLine)});
            var cornerStyle=pocketDisplayStyle(pass);
            strokePocketPath(ctx, cpath, cornerStyle.color, dpr, null, cornerStyle.width);

            var origCorner=[{x:xLine,y:yLine},{x:gLeft.x,y:gLeft.y}];
            arcSeg.forEach(function(pt){ origCorner.push({x:pt.x,y:pt.y}); });
            origCorner.push({x:xLine,y:yLine});
            collectRun(origCorner);
          }
        });
        ctx.restore();
      } else {
        // Không island: offset theo BIÊN DẠNG THẬT (contour-parallel) — đúng cho
        // hình bất kỳ hướng nào (kể cả nằm nghiêng). Trước đây rect bbox thẳng trục
        // nên hình nghiêng chỉ ra 1 vòng (bbox lớn hơn hình thật, offset chạm biên sớm).
        var ringsNI = pocketContourRings(loop, halfD, stepoverMM, maxPasses+5);
        ringsNI.forEach(function(ring, ri){
          var spts = ring.map(function(pt){ return {x:tx(pt.x), y:ty(pt.y)}; });
          var niStyle=pocketDisplayStyle(ri);
          strokePocketPath(ctx, spts, niStyle.color, dpr, null, niStyle.width);
          collectRun(ring.map(function(pt){ return {x:pt.x, y:pt.y}; }),ring._breakBefore===true);
        });
      }
    }

    // ── HƯỚNG HẠ NỀN: KHÔNG đảo ở đây. collectRun luôn thu NGOÀI→TRONG cho MỌI
    // nhánh (dogbone/circle/concave/rect). Việc đảo khi in_out do SIMULATOR lo (áp
    // đều mọi nhánh). Trước đây đảo ở đây chỉ tới được nhánh cuối (các nhánh khác
    // return sớm) nên bất nhất → đã chuyển hẳn sang simulator.
  });
}
