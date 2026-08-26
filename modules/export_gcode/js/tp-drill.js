
// ── tp-drill.js — Vẽ toolpath khoan ──
// Load SAU cam-geometry.js

function drawToolpathDrill(ctx,vecs,tool,tx,ty,sc,dpr){
  const r=Math.max((tool.diameter/2)*sc*dpr, 1*dpr);
  const seen=new Set();

  // Hàm vẽ 1 điểm khoan tại (mx,my) [tọa độ model]
  function drawOne(mx,my){
    const key=`${mx.toFixed(1)},${my.toFixed(1)}`;
    if(seen.has(key))return;
    seen.add(key);
    tpRenderedPaths.push({type:'drill',tool,cx:mx,cy:my,r:tool.diameter/2});
    const cx=tx(mx),cy=ty(my);
    ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.strokeStyle='rgba(220,120,0,0.7)';ctx.lineWidth=dpr*0.9;ctx.stroke();
    ctx.fillStyle='rgba(220,120,0,0.08)';ctx.fill();
    const cr=Math.min(r*0.6,8*dpr);
    ctx.strokeStyle='rgba(220,120,0,0.9)';ctx.lineWidth=dpr*1.5;
    ctx.beginPath();ctx.moveTo(cx-cr,cy);ctx.lineTo(cx+cr,cy);ctx.stroke();
    ctx.beginPath();ctx.moveTo(cx,cy-cr);ctx.lineTo(cx,cy+cr);ctx.stroke();
  }

  // 1) Điểm khoan sẵn có (is_drill_center)
  vecs.filter(v=>v.is_drill_center).forEach(v=>drawOne(v.x1,v.y1));

  // 2) Đường (không phải drill_center) được gán sang layer khoan:
  //    gom loop, phát hiện đường tròn → khoan tại TÂM.
  const lineVecs=vecs.filter(v=>!v.is_drill_center);
  if(lineVecs.length && typeof buildLoopsJS==='function'){
    const loops=buildLoopsJS(lineVecs);
    loops.forEach(lp=>{
      // tâm hình học của loop
      let xs=[],ys=[];
      lp.forEach(e=>{ xs.push(e.x1,e.x2); ys.push(e.y1,e.y2); });
      const cx=(Math.min.apply(null,xs)+Math.max.apply(null,xs))/2;
      const cy=(Math.min.apply(null,ys)+Math.max.apply(null,ys))/2;
      drawOne(cx,cy);
    });
  }
}