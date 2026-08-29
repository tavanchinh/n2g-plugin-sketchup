// ── tp-profile.js — Vẽ toolpath profile dao phẳng (cut_in/cut_out/cut_on) ──
// Load SAU cam-geometry.js. Dao V-Bit tách riêng sang tp-vbit.js.

// ── LÙI ĐIỂM XUỐNG DAO (chống bay ván) ───────────────────────────────────────
// pts: vòng KÍN, thứ tự = CHIỀU CẮT, pts[0] = điểm xuống dao hiện tại.
// Lùi điểm bắt đầu d mm NGƯỢC chiều cắt → trả vòng ĐÃ ĐÓNG: [S', ..., S'].
// Khớp backoff_start ở gcode_engine.rb.
function backoffStartJS(pts, d){
  var n = pts.length;
  if(n < 3 || d <= 0) return pts.concat([pts[0]]);
  var peri = 0, i, a, b, seg;
  for(i=0;i<n;i++){
    a=pts[i]; b=pts[(i+1)%n];
    peri += Math.sqrt((b.x-a.x)*(b.x-a.x)+(b.y-a.y)*(b.y-a.y));
  }
  if(peri <= 0.001) return pts.concat([pts[0]]);
  d = Math.min(d, peri*0.4);           // kẹp an toàn: không lùi quá 40% chu vi

  var rem = d, k = n-1, sp = null;
  for(i=0;i<n;i++){
    a = pts[k]; b = pts[(k+1)%n];
    seg = Math.sqrt((b.x-a.x)*(b.x-a.x)+(b.y-a.y)*(b.y-a.y));
    if(seg > 1e-9 && seg >= rem){
      var t = (seg - rem)/seg;         // S' trên đoạn a→b, cách b đúng rem
      sp = { x: a.x + (b.x-a.x)*t, y: a.y + (b.y-a.y)*t };
      break;
    }
    rem -= seg;
    k = (k - 1 + n) % n;
  }
  if(!sp) return pts.concat([pts[0]]);

  var seq = [sp], idx = (k+1)%n;
  for(i=0;i<n;i++){ seq.push(pts[idx]); idx = (idx+1)%n; }
  seq.push(sp);
  return seq;
}

// Đi tiếp r mm dọc theo seq kể từ seq[0] → các điểm CẮT CHỒNG (tránh gờ nối).
// Khớp overlap_points ở gcode_engine.rb.
function overlapPointsJS(seq, r){
  if(r <= 0 || seq.length < 2) return [];
  var out = [], rem = r;
  for(var i=0;i<seq.length-1;i++){
    var a=seq[i], b=seq[i+1];
    var seg = Math.sqrt((b.x-a.x)*(b.x-a.x)+(b.y-a.y)*(b.y-a.y));
    if(seg < 1e-9) continue;
    if(seg >= rem){
      var t = rem/seg;
      out.push({ x: a.x + (b.x-a.x)*t, y: a.y + (b.y-a.y)*t });
      return out;
    }
    out.push(b);
    rem -= seg;
  }
  return out;
}

// Layer có phải cuttinglines? (khớp is_cutting_layer ở gcode_engine.rb)
function isCuttingLayerJS(name){
  var s = String(name||'').toLowerCase();
  return s.indexOf('cuttinglines') >= 0 || s.indexOf('cutting_lines') >= 0;
}

function drawToolpathProfile(ctx,vecs,tool,tx,ty,sc,dpr){
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
    // Override strategy nếu là island — vẫn màu cut_out nhưng nét mảnh hơn
    const strategy = isIsland[li] ? 'cut_in' : tool.strategy;

    const color = strategy==='cut_in' ? '#0fa050' : strategy==='cut_out' ? '#0fa050' : '#888';
    const dash  = strategy==='cut_in' ? [5*dpr,3*dpr] : strategy==='cut_out' ? [8*dpr,4*dpr] : [3*dpr,3*dpr];
    const lw = dpr*1.1;
    const offsetDist = strategy==='cut_out' ? tool.diameter/2 : strategy==='cut_in' ? -tool.diameter/2 : 0;

    const circ=detectCircleJS(loop);
    ctx.strokeStyle=color; ctx.lineWidth=lw; ctx.setLineDash(dash);
    let offPts=null, rOff=0;

    if(circ){
      // Island/cut_in nho hon duong kinh dao: tam dao khong con vung hop le.
      // Khong ep thanh vong R=1mm vi se tao duong dao gia.
      if(strategy==='cut_in' && circ.r <= (+tool.diameter||0)/2 + 0.001) return;
      rOff=Math.max(
        strategy==='cut_in'  ? circ.r - tool.diameter/2 :
        strategy==='cut_out' ? circ.r + tool.diameter/2 : circ.r, 1);
      ctx.beginPath();
      ctx.arc(tx(circ.cx), ty(circ.cy), rOff*sc*dpr, 0, Math.PI*2);
      ctx.stroke();
      const ax=tx(circ.cx)+rOff*sc*dpr, ay=ty(circ.cy);
      drawArrow(ctx,ax,ay-8*dpr,ax,ay+8*dpr,color,dpr);
      if(tool && tool.ramp_on===true){
        var rampArc=Math.min(Math.PI*2,Math.max(2,+tool.ramp_len||20)/rOff);
        ctx.save();ctx.strokeStyle='#e8820c';ctx.lineWidth=lw*1.8;ctx.setLineDash([]);
        ctx.beginPath();ctx.arc(tx(circ.cx),ty(circ.cy),rOff*sc*dpr,0,rampArc);ctx.stroke();ctx.restore();
      }
      tpRenderedPaths.push({type:'circle',tool,strategy,cx:circ.cx,cy:circ.cy,r:rOff,_closed:true});
    } else if(Math.abs(offsetDist)<0.01){
      ctx.beginPath();
      ctx.moveTo(tx(loop[0].x1),ty(loop[0].y1));
      loop.forEach(e=>ctx.lineTo(tx(e.x2),ty(e.y2)));
      ctx.stroke();
      drawLoopArrows(ctx,loop,tx,ty,color,dpr);
      // pts phải khớp CÁCH VẼ: điểm đầu (x1,y1) + điểm cuối mỗi cạnh (x2,y2).
      // Trước đây chỉ lấy x1,y1 mỗi cạnh → THIẾU điểm cuối (đường hở 1 cạnh chỉ
      // còn 1 điểm → simulator bỏ qua vì cần >=2 điểm). _closed theo loop thật.
      var onPts = [{x:loop[0].x1, y:loop[0].y1}];
      loop.forEach(function(e){ onPts.push({x:e.x2, y:e.y2}); });
      tpRenderedPaths.push({type:'segments',tool,strategy,pts:onPts, _closed:!!loop._closed});
    } else {
      // Loop kín: dùng offsetPolygonMiter (miter join chuẩn, không méo ở hình nhiều góc lõm
      // như mộng dương). Loop hở: giữ offsetLoopJS. dist>0 của miter = vào trong nên đảo dấu.
      var profileClipperExtra=[];
      var profileEngine=(typeof window!=='undefined' && window.N2G_PROFILE_OFFSET_ENGINE) || 'clipper';
      var profileScopeOK=(typeof profileClipperAppliesJS==='function') ?
        profileClipperAppliesJS(!!isIsland[li]) : !!isIsland[li];
      if(loop._closed && profileEngine!=='legacy' && profileScopeOK &&
         (strategy==='cut_in'||strategy==='cut_out') && typeof profileOffsetClipper==='function'){
        var profileClipperRuns=profileOffsetClipper(loop,tool.diameter/2,strategy);
        var hasMicroDetour=strategy==='cut_out'&&typeof profileHasMicroDetourJS==='function'&&
          profileHasMicroDetourJS(loop,tool.diameter);
        if(hasMicroDetour && typeof profileCutOutRunSafeJS==='function'){
          profileClipperRuns=profileClipperRuns.filter(function(run){return profileCutOutRunSafeJS(loop,run,tool.diameter/2);});
        }
        if(profileClipperRuns.length){
          offPts=profileClipperRuns[0];
          profileClipperExtra=profileClipperRuns.slice(1);
        }else if(strategy==='cut_in'){
          // Clipper co vao rong = dao khong lot. Khong fallback miter.
          return;
        }else{
          offPts=offsetPolygonMiter(loop,-offsetDist,strategy==='cut_out');
          if(hasMicroDetour && typeof profileCutOutRunSafeJS==='function' &&
             !profileCutOutRunSafeJS(loop,offPts,tool.diameter/2)){
            var safeClipperFallback=profileSafeCutOutClipperJS(loop,tool.diameter/2);
            if(!safeClipperFallback.length){
              if(typeof profileLogRejectedMicroCutOutJS==='function') profileLogRejectedMicroCutOutJS(loop,tool);
              return;
            }
            offPts=safeClipperFallback[0];
            profileClipperExtra=safeClipperFallback.slice(1);
          }
        }
      } else if(loop._closed){
        // Bo cung góc nhọn CHỈ khi cắt NGOÀI (khớp Ruby write_profile): cung nằm ngoài
        // vật liệu nên an toàn. Cắt TRONG giữ miter để dao không lẹm vào biên dạng.
        offPts=offsetPolygonMiter(loop, -offsetDist, strategy==='cut_out');
        if(strategy==='cut_out' && typeof profileHasMicroDetourJS==='function' &&
           profileHasMicroDetourJS(loop,tool.diameter) && typeof profileCutOutRunSafeJS==='function' &&
           !profileCutOutRunSafeJS(loop,offPts,tool.diameter/2)){
          var safeFallback=profileSafeCutOutClipperJS(loop,tool.diameter/2);
          if(!safeFallback.length){
            if(typeof profileLogRejectedMicroCutOutJS==='function') profileLogRejectedMicroCutOutJS(loop,tool);
            return;
          }
          offPts=safeFallback[0];
          profileClipperExtra=safeFallback.slice(1);
        }
      } else {
        // Loop hở (C/L/U): offset theo TÂM bbox — cut_out ra xa tâm, cut_in gần tâm.
        // Khớp Ruby write_profile is_open. Không phụ thuộc chiều vẽ.
        offPts=offsetOpenCenterJS(loop.edges||loop, Math.abs(offsetDist), strategy==='cut_out');
      }
      if(offPts&&offPts.length>1){
       // CHỈ path KÍN mới xoay điểm xuống dao + chuẩn hóa chiều. Path HỞ (C/L/U) phải
       // giữ nguyên thứ tự đầu→cuối: dao vào ở một đầu, ra ở đầu kia.
       if(loop._closed){
        // Rotate off_pts theo CCW entry point
        // preferStraight: CHỈ cuttinglines VÀ khi bật "Tránh đoạn cong" trong cài đặt
        // (dời điểm xuống dao sang cạnh thẳng, tránh gợn khi cắm giữa cung).
        // Khớp Ruby write_profile.
        var _isCut = (tool.layer||'').toUpperCase().replace(/[^A-Z]/g,'').indexOf('CUTTING')>=0;
        var _avoidCv = (typeof STG!=='undefined' && STG.avoid_curve === true);
        var sp0=getStartPointJS(loop, offsetDist, tpZm.sheet.width, tpZm.sheet.height, _isCut && _avoidCv);
        // Keep a manual override unchanged. Otherwise, a clear rectangle may
        // move to the nearest corner whose final cut edge is the long edge.
        var _glob0 = (typeof afvDir!=='undefined') ? afvDir : 'ccw';
        var _eff0  = (tool.direction==='cw' || tool.direction==='ccw') ? tool.direction : _glob0;
        var _wantCCW0 = (_eff0==='ccw');
        if(strategy==='cut_in') _wantCCW0=!_wantCCW0;
        var _manualEntry=(typeof entryFindPoint==='function') ? entryFindPoint(loop) : null;
        if(!_manualEntry && typeof preferLongFinalEntryJS==='function'){
          sp0=preferLongFinalEntryJS(loop,offPts,sp0,_wantCCW0);
        }
        if(sp0){
          var bestI=0, bestD=Infinity;
          for(var oi=0;oi<offPts.length;oi++){
            var ddx=offPts[oi].x-sp0.x, ddy=offPts[oi].y-sp0.y, dd=ddx*ddx+ddy*ddy;
            if(dd<bestD){bestD=dd;bestI=oi;}
          }
          offPts=offPts.slice(bestI).concat(offPts.slice(0,bestI));
        }

        // ── CHUẨN HÓA CHIỀU theo hướng hiệu lực (dao override / cài đặt chung) ──
        // Khớp Ruby (write_profile) + simulator (simApplyCutDir): cut_out theo hướng;
        // cut_in/island ngược lại. Giữ điểm đầu (điểm xuống dao). Mũi tên vẽ theo
        // offPts nên tự đúng chiều.
        if(isCuttingLayerJS(tool.layer) && offPts.length>2){
          var _glob = (typeof afvDir!=='undefined') ? afvDir : 'ccw';
          var _eff  = (tool.direction==='cw' || tool.direction==='ccw') ? tool.direction : _glob;
          var _ar = 0;
          for(var _k=0; _k<offPts.length; _k++){
            var _p=offPts[_k], _q=offPts[(_k+1)%offPts.length];
            _ar += _p.x*_q.y - _q.x*_p.y;
          }
          var _wantCCW = (_eff==='ccw');
          if(strategy==='cut_in') _wantCCW = !_wantCCW;
          if((_ar>0) !== _wantCCW){
            var _f=offPts[0]; offPts=[_f].concat(offPts.slice(1).reverse());
          }
        }
       }

        // ── LÙI ĐIỂM XUỐNG DAO + CẮT CHỒNG (chỉ cuttinglines, khi bật) ──
        // Khớp gcode_engine.rb: lùi d mm ngược chiều cắt, rồi cắt lố 1 bán kính dao.
        var backOn = loop._closed &&
                     isCuttingLayerJS(tool.layer) &&
                     (typeof afvBackOn !== 'undefined' && afvBackOn === true) &&
                     (typeof afvBackMm !== 'undefined' && afvBackMm > 0);
        if(backOn){
          offPts = backoffStartJS(offPts, afvBackMm);          // [S', ..., S']
          offPts = offPts.concat(overlapPointsJS(offPts, tool.diameter/2));
          sp0 = offPts[0];                                     // dấu điểm xuống dao dời theo
        }

        ctx.beginPath();
        ctx.moveTo(tx(offPts[0].x),ty(offPts[0].y));
        offPts.forEach(p=>ctx.lineTo(tx(p.x),ty(p.y)));
        if(loop._closed && !backOn) ctx.closePath();   // khi lùi: đường đã tự khép + cắt chồng
        ctx.stroke();

        // ── ĐOẠN DỐC (ramp): vẽ đè L mm đầu bằng màu cam để phân biệt ──
        // Chỉ profile cuttinglines, loop kín, dao bật ramp. Đường dốc là đoạn dao hạ
        // Z dần — trên preview 2D chỉ đánh dấu VỊ TRÍ + ĐỘ DÀI L.
        if(tool && tool.ramp_on===true){
          var _rl = Math.max(2, +tool.ramp_len || 20);
          var _acc = 0, _rp = [offPts[0]];
          for(var _ri=0; _ri<offPts.length-1; _ri++){
            var _a=offPts[_ri], _b=offPts[_ri+1];
            var _s=Math.hypot(_b.x-_a.x, _b.y-_a.y);
            if(_acc+_s >= _rl){
              var _t=(_rl-_acc)/_s;
              _rp.push({x:_a.x+(_b.x-_a.x)*_t, y:_a.y+(_b.y-_a.y)*_t});
              break;
            }
            _acc+=_s; _rp.push(_b);
          }
          if(_rp.length>=2){
            ctx.save();
            ctx.strokeStyle='#e8820c';               // cam = đoạn dốc
            ctx.lineWidth=(ctx.lineWidth||1)*1.8;
            ctx.beginPath();
            ctx.moveTo(tx(_rp[0].x),ty(_rp[0].y));
            _rp.forEach(p=>ctx.lineTo(tx(p.x),ty(p.y)));
            ctx.stroke();
            ctx.restore();
          }
        }
        for(let i=0;i<offPts.length-1;i+=Math.max(1,Math.floor(offPts.length/6))){
          const a=offPts[i],b=offPts[(i+1)%offPts.length];
          const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
          const dx=tx(b.x)-tx(a.x),dy=ty(b.y)-ty(a.y);
          drawArrow(ctx,tx(mx)-dx*0.1,ty(my)-dy*0.1,tx(mx)+dx*0.1,ty(my)+dy*0.1,color,dpr);
        }
        tpRenderedPaths.push({type:'segments',tool,strategy,pts:offPts, _closed:!!loop._closed});

        // cut_in có cổ hẹp có thể được Clipper tách thành nhiều polygon. Vẽ và
        // chuyển từng polygon thành path riêng; tuyệt đối không nối chúng bằng G1.
        profileClipperExtra.forEach(function(extraPts){
          if(!extraPts || extraPts.length<3) return;
          var ep=extraPts.slice();
          var ea=0;
          for(var ei=0;ei<ep.length;ei++){
            var eq=ep[(ei+1)%ep.length]; ea+=ep[ei].x*eq.y-eq.x*ep[ei].y;
          }
          var wantCCW=((typeof _eff!=='undefined'?_eff:'ccw')==='ccw');
          if(strategy==='cut_in') wantCCW=!wantCCW;
          if((ea>0)!==wantCCW) ep.reverse();
          if(typeof sp0!=='undefined' && sp0){
            var esi=0,esd=Infinity;
            ep.forEach(function(pp,ii){var dx=pp.x-sp0.x,dy=pp.y-sp0.y,dd=dx*dx+dy*dy;if(dd<esd){esd=dd;esi=ii;}});
            ep=ep.slice(esi).concat(ep.slice(0,esi));
          }
          if(typeof backOn!=='undefined' && backOn){
            ep=backoffStartJS(ep,afvBackMm);
            ep=ep.concat(overlapPointsJS(ep,tool.diameter/2));
          }else ep=ep.concat([{x:ep[0].x,y:ep[0].y}]);
          ctx.beginPath();ctx.moveTo(tx(ep[0].x),ty(ep[0].y));
          ep.slice(1).forEach(function(pp){ctx.lineTo(tx(pp.x),ty(pp.y));});ctx.stroke();
          tpRenderedPaths.push({type:'segments',tool,strategy,pts:ep,_closed:true});
        });
      }
    }

    ctx.setLineDash([]);
    // Điểm xuống dao — dùng lại sp0 đã tính, tránh gọi getStartPointJS 2 lần
    let startX, startY;
    if(circ){
      startX = tx(circ.cx) + rOff*sc*dpr;
      startY = ty(circ.cy);
    } else {
      var spEntry = (typeof sp0 !== 'undefined' && sp0) ? sp0
                  : offPts && offPts.length > 0 ? offPts[0]
                  : {x: loop[0].x1, y: loop[0].y1};
      startX = tx(spEntry.x); startY = ty(spEntry.y);
    }
    const mr = 7*dpr;
    ctx.beginPath();ctx.arc(startX, startY, mr, 0, Math.PI*2);
    ctx.fillStyle='rgba(220,40,40,0.9)';ctx.fill();
    ctx.strokeStyle='#fff';ctx.lineWidth=dpr*1.2;ctx.stroke();
    const sq=mr*0.45;
    ctx.fillStyle='#fff';
    ctx.fillRect(startX-sq, startY-sq, sq*2, sq*2);
  });
}
