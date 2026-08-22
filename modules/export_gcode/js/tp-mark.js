// ── tp-mark.js — Vẽ toolpath layer vạch dấu ABF_MARKSQUARE (chữ L hở, offset ra ngoài) ──
// Load SAU cam-geometry.js. Kịch bản riêng: offset từng cạnh ra NGOÀI viền tấm.
//   - Cạnh dọc (đứng)  → đẩy +X (sang phải, X lớn hơn)
//   - Cạnh ngang (nằm) → đẩy -Y (xuống dưới)
//   - Điểm xuất phát ở Ymax
// Đây là PATH HỞ (không khép kín), không dùng offset polygon thông thường.

// Offset path hở theo từng cạnh ra ngoài. Trả mảng điểm [{x,y}] cùng số đỉnh+1.
// halfD = bán kính dao. Quy ước "ra ngoài": cạnh dọc +X, cạnh ngang -Y.
function offsetMarkPathOutward(edges, halfD){
  if(!edges || edges.length < 1) return null;

  // Mỗi cạnh dịch song song ra ngoài halfD theo hướng của chính nó.
  // Cạnh dọc (|dx|≈0): dịch +X. Cạnh ngang (|dy|≈0): dịch -Y. Cạnh xiên: dùng normal hướng ra xa tâm bbox.
  // Tính tâm bbox để xác định hướng "ra ngoài" cho cạnh xiên.
  var xs = edges.flatMap(function(e){return[e.x1,e.x2];});
  var ys = edges.flatMap(function(e){return[e.y1,e.y2];});
  var cx = (Math.min.apply(null,xs)+Math.max.apply(null,xs))/2;
  var cy = (Math.min.apply(null,ys)+Math.max.apply(null,ys))/2;

  // Với mỗi cạnh, tính vector dịch (shift) ra ngoài
  var shifted = edges.map(function(e){
    var dx = e.x2-e.x1, dy = e.y2-e.y1;
    var len = Math.hypot(dx,dy);
    var sx = 0, sy = 0;
    if(len < 1e-6){ return {x1:e.x1,y1:e.y1,x2:e.x2,y2:e.y2}; }
    var isVertical   = Math.abs(dx) < 1e-3;   // cạnh đứng
    var isHorizontal = Math.abs(dy) < 1e-3;   // cạnh ngang
    if(isVertical){
      sx = halfD; sy = 0;            // +X
    } else if(isHorizontal){
      sx = 0; sy = -halfD;           // -Y
    } else {
      // cạnh xiên: normal hướng ra xa tâm bbox
      var nx = -dy/len, ny = dx/len;
      var midx = (e.x1+e.x2)/2, midy = (e.y1+e.y2)/2;
      // chọn dấu normal sao cho điểm dịch ra xa tâm
      if((midx+nx-cx)*(midx-cx)+(midy+ny-cy)*(midy-cy) < 0){ nx=-nx; ny=-ny; }
      sx = nx*halfD; sy = ny*halfD;
    }
    return {x1:e.x1+sx, y1:e.y1+sy, x2:e.x2+sx, y2:e.y2+sy};
  });

  // Nối các cạnh đã dịch: tại mỗi khớp, giao 2 đường offset (để góc khít).
  // Path hở → giữ điểm đầu cạnh đầu và điểm cuối cạnh cuối nguyên (đã dịch).
  var pts = [];
  pts.push({x:shifted[0].x1, y:shifted[0].y1});
  for(var i=0;i<shifted.length-1;i++){
    var a = shifted[i], b = shifted[i+1];
    var inter = lineIntersect(a.x1,a.y1,a.x2,a.y2, b.x1,b.y1,b.x2,b.y2);
    if(inter) pts.push(inter);
    else { pts.push({x:a.x2,y:a.y2}); pts.push({x:b.x1,y:b.y1}); }
  }
  pts.push({x:shifted[shifted.length-1].x2, y:shifted[shifted.length-1].y2});
  return pts;
}

// Giao 2 đường thẳng (vô hạn) qua 2 đoạn. Trả {x,y} hoặc null nếu song song.
function lineIntersect(x1,y1,x2,y2, x3,y3,x4,y4){
  var d = (x1-x2)*(y3-y4) - (y1-y2)*(x3-x4);
  if(Math.abs(d) < 1e-9) return null;
  var t = ((x1-x3)*(y3-y4) - (y1-y3)*(x3-x4)) / d;
  return { x: x1 + t*(x2-x1), y: y1 + t*(y2-y1) };
}

function drawToolpathMark(ctx,vecs,tool,tx,ty,sc,dpr){
  var loops = buildLoopsJS(vecs.filter(function(v){return !v.is_drill_center;}));
  var halfD = tool.diameter/2;
  var color = '#0fa050';

  loops.forEach(function(loop){
    if(loop.length < 1) return;

    // Sắp xếp để xuất phát từ Ymax: nếu đầu path có Y nhỏ hơn cuối path thì đảo chiều
    var startY = loop[0].y1;
    var endY   = loop[loop.length-1].y2;
    var edges = loop.map(function(e){return {x1:e.x1,y1:e.y1,x2:e.x2,y2:e.y2};});
    if(endY > startY){
      // đảo chiều toàn path để bắt đầu từ điểm Y lớn hơn
      edges = edges.slice().reverse().map(function(e){
        return {x1:e.x2,y1:e.y2,x2:e.x1,y2:e.y1};
      });
    }

    var pts = offsetMarkPathOutward(edges, halfD);
    if(!pts || pts.length < 2) return;

    // Vẽ đường offset (nét đứt xanh giống các profile khác)
    ctx.strokeStyle = color;
    ctx.lineWidth = dpr*1.1;
    ctx.setLineDash([6*dpr,3*dpr]);
    ctx.beginPath();
    ctx.moveTo(tx(pts[0].x), ty(pts[0].y));
    for(var i=1;i<pts.length;i++) ctx.lineTo(tx(pts[i].x), ty(pts[i].y));
    ctx.stroke();
    ctx.setLineDash([]);

    // Mũi tên hướng chạy
    for(var i=0;i<pts.length-1;i+=Math.max(1,Math.floor((pts.length-1)/4))){
      var a=pts[i], b=pts[i+1];
      var mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
      var ddx=tx(b.x)-tx(a.x), ddy=ty(b.y)-ty(a.y);
      drawArrow(ctx, tx(mx)-ddx*0.1, ty(my)-ddy*0.1, tx(mx)+ddx*0.1, ty(my)+ddy*0.1, color, dpr);
    }

    tpRenderedPaths.push({type:'segments', tool, strategy:'mark', pts: pts});

    // Điểm xuống dao ở điểm xuất phát (Ymax)
    var startX = tx(pts[0].x), startYpx = ty(pts[0].y);
    var mr = 7*dpr;
    ctx.beginPath(); ctx.arc(startX, startYpx, mr, 0, Math.PI*2);
    ctx.fillStyle='rgba(220,40,40,0.9)'; ctx.fill();
    ctx.strokeStyle='#fff'; ctx.lineWidth=dpr*1.2; ctx.stroke();
    var sq=mr*0.45;
    ctx.fillStyle='#fff';
    ctx.fillRect(startX-sq, startYpx-sq, sq*2, sq*2);
  });
}