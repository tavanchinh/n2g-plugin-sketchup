// ── tp-vbit.js — Vẽ toolpath dao V-Bit cut_in (vát góc / chamfer) ──
// Load SAU cam-geometry.js. Tách riêng để sửa V-Bit không ảnh hưởng profile/pocket/drill.

function drawToolpathVbit(ctx,vecs,tool,tx,ty,sc,dpr){
  const loops=buildLoopsJS(vecs.filter(v=>!v.is_drill_center))
    .filter(function(lp){
      var xs=lp.flatMap(function(e){return[e.x1,e.x2];}),ys=lp.flatMap(function(e){return[e.y1,e.y2];});
      return (Math.max.apply(null,xs)-Math.min.apply(null,xs))>1.0 ||
             (Math.max.apply(null,ys)-Math.min.apply(null,ys))>1.0;
    });

  // Detect island: bbox nằm trong bbox loop khác → force cut_in
  const bbs=loops.map(loop=>{
    const xs=loop.flatMap(v=>[v.x1,v.x2]),ys=loop.flatMap(v=>[v.y1,v.y2]);
    return{xMin:Math.min(...xs),xMax:Math.max(...xs),yMin:Math.min(...ys),yMax:Math.max(...ys)};
  });
  const isIsland=detectIslandJS(loops,bbs);


  loops.forEach((loop,li)=>{
    const strategy = isIsland[li] ? "cut_in" : tool.strategy;
    if(!(tool.bit_type==="vbit" && strategy==="cut_in")) return;

      const angle = tool.vbit_angle || 120;
      const depth = parseFloat(tool.depth) || 0;
      // L = depth / tan(90 - angle/2)
      const L = depth / Math.tan((90 - angle/2) * Math.PI/180);

      const vbitColor = '#0fa050';
      // Mặc định giữ đỉnh miter nhọn (không bo cung) — khớp Ruby vbit_offset_miter,
      // và giữ đúng số điểm = số đỉnh vì Ruby bỏ qua loop nếu off.size != verts.size.
      let offPtsL = offsetPolygonMiter(loop, L);
      if(offPtsL && offPtsL.length>1){
        // Rotate theo entry point (giống profile cut_in)
        var spV = getStartPointJS(loop, -L, tpZm.sheet.width, tpZm.sheet.height);
        if(spV){
          var bV=0, bdV=Infinity;
          for(var oi=0;oi<offPtsL.length;oi++){
            var ddx=offPtsL[oi].x-spV.x, ddy=offPtsL[oi].y-spV.y, dd=ddx*ddx+ddy*ddy;
            if(dd<bdV){bdV=dd;bV=oi;}
          }
          offPtsL = offPtsL.slice(bV).concat(offPtsL.slice(0,bV));
        }

        ctx.strokeStyle = vbitColor;
        ctx.lineWidth = dpr*1.1;
        ctx.setLineDash([5*dpr,3*dpr]);
        ctx.beginPath();
        ctx.moveTo(tx(offPtsL[0].x), ty(offPtsL[0].y));
        offPtsL.forEach(p=>ctx.lineTo(tx(p.x), ty(p.y)));
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);

        // Đường vuốt góc: nối góc loop gốc → góc offset tương ứng (dao đi chéo xuống đáy)
        // offPtsL[i] ứng với đỉnh loop verts[i] = {x:loop[i].x1, y:loop[i].y1}
        // nhưng offPtsL đã bị rotate theo entry — cần map lại theo tọa độ gần nhất
        var origVerts = loop.map(function(e){ return {x:e.x1, y:e.y1}; });
        ctx.setLineDash([5*dpr,3*dpr]);
        ctx.lineWidth = dpr*1.0;
        offPtsL.forEach(function(op){
          // tìm đỉnh gốc gần nhất với điểm offset này
          var best=null, bd=Infinity;
          origVerts.forEach(function(v){
            var dd=(v.x-op.x)*(v.x-op.x)+(v.y-op.y)*(v.y-op.y);
            if(dd<bd){bd=dd;best=v;}
          });
          if(best){
            ctx.beginPath();
            ctx.moveTo(tx(best.x), ty(best.y));
            ctx.lineTo(tx(op.x), ty(op.y));
            ctx.stroke();
          }
        });
        ctx.setLineDash([]);

        // Mũi tên hướng chạy
        for(let i=0;i<offPtsL.length;i+=Math.max(1,Math.floor(offPtsL.length/6))){
          const a=offPtsL[i],b=offPtsL[(i+1)%offPtsL.length];
          const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
          const dx=tx(b.x)-tx(a.x),dy=ty(b.y)-ty(a.y);
          drawArrow(ctx,tx(mx)-dx*0.1,ty(my)-dy*0.1,tx(mx)+dx*0.1,ty(my)+dy*0.1,vbitColor,dpr);
        }

        tpRenderedPaths.push({type:'vbit_inner', tool, strategy, pts: offPtsL, z:-depth, L});

        // Điểm xuống dao tại điểm đầu offset
        const startX = tx(offPtsL[0].x), startY = ty(offPtsL[0].y);
        const mr = 7*dpr;
        ctx.beginPath();ctx.arc(startX, startY, mr, 0, Math.PI*2);
        ctx.fillStyle='rgba(220,40,40,0.9)';ctx.fill();
        ctx.strokeStyle='#fff';ctx.lineWidth=dpr*1.2;ctx.stroke();
        const sq=mr*0.45;
        ctx.fillStyle='#fff';
        ctx.fillRect(startX-sq, startY-sq, sq*2, sq*2);
      }
  });
}