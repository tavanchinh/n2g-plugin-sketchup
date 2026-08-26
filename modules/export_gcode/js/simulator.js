// ── simulator.js — Mô phỏng animation đường dao theo đúng thứ tự G-code ──
//
// Thứ tự chạy:
//   1. Theo thứ tự dao mẫu (TOOLS) — dao xếp trên chạy trước.
//   2. Riêng cuttinglines nhiều loop → theo thứ tự cắt (tpComputeFinalOrder):
//      tấm người dùng click (pinned) trước, còn lại sắp tự động.
//
// Tận dụng lại: tpRenderedPaths (đường dao đã sinh), tpZm.loops + tpComputeFinalOrder
// (thứ tự cắt đã có), TOOLS (thứ tự dao mẫu).

// Trạng thái simulator
var simState = (typeof simState!=='undefined') ? simState : {
  sequence: [],      // danh sách bước [{layer, tool, type, pts:[{x,y}], feed}]
  enabledLayers: null, // Set tên layer được tích; null = tất cả
  speed: 1.0,        // hệ số tốc độ (0.1×..10×), slider giữa = 1×
};

// Có phải layer cuttinglines không (nhiều loop, cần theo cut order)
function simIsCuttingLayer(layer){
  return (layer||'').toLowerCase().includes('cutting');
}

// Diện tích có dấu của polygon: >0 = CCW, <0 = CW (hệ tọa độ y-up).
function simSignedArea(pts){
  let a=0;
  for(let i=0;i<pts.length;i++){
    const p=pts[i], q=pts[(i+1)%pts.length];
    a += p.x*q.y - q.x*p.y;
  }
  return a/2;
}

// Chuẩn hóa chiều pts theo cut_dir setting (cw/ccw). Giữ nguyên điểm bắt đầu,
// chỉ đảo THỨ TỰ các điểm còn lại nếu chiều hiện tại ngược với setting.
// cut_in (kể cả island): đảo NGƯỢC cut_dir — dao bù sang phía đối diện khi cắt trong
// nên phải đổi chiều thì mới CÙNG kiểu phay thuận (climb) như cắt ngoài.
// KHỚP Ruby write_profile.
function simApplyCutDir(pts, strategy, tool){
  if(!pts || pts.length<3) return pts;
  // Hướng cắt: dao chọn cw/ccw → ưu tiên dao; chưa chỉnh → theo cài đặt chung (afvDir).
  var glob = (typeof afvDir!=='undefined') ? afvDir : 'ccw';
  const cutDir = (tool && (tool.direction==='cw' || tool.direction==='ccw')) ? tool.direction : glob;
  const area = simSignedArea(pts);
  const isCCW = area > 0;
  let wantCCW = (cutDir === 'ccw');
  if(strategy === 'cut_in') wantCCW = !wantCCW;
  if(isCCW === wantCCW) return pts;   // đã đúng chiều
  // Đảo chiều nhưng GIỮ điểm đầu: [p0, p1, p2, p3] → [p0, p3, p2, p1]
  const first = pts[0];
  const rest = pts.slice(1).reverse();
  return [first].concat(rest);
}

// Xây sequence đường dao theo ĐÚNG thứ tự G-code cho sheet hiện tại.
// Trả về mảng bước, mỗi bước là 1 đường chạy dao liên tục.
function simBuildSequence(){
  const seq = [];
  if(typeof tpRenderedPaths === 'undefined' || !tpRenderedPaths.length) return seq;

  // Gom path theo layer (giữ nguyên object path gốc)
  const pathsByLayer = {};
  tpRenderedPaths.forEach(p=>{
    const layer = (p.tool && p.tool.layer) || '';
    if(!pathsByLayer[layer]) pathsByLayer[layer] = [];
    pathsByLayer[layer].push(p);
  });

  // Duyệt TOOLS theo thứ tự dao mẫu (ưu tiên 1)
  const toolList = (typeof TOOLS !== 'undefined') ? TOOLS : [];
  toolList.forEach(tool=>{
    const layer = tool.layer;
    if(!layer) return;
    // Bỏ qua layer không được tích (nếu có bộ lọc)
    if(simState.enabledLayers && !simState.enabledLayers.has(layer)) return;
    const paths = pathsByLayer[layer];
    if(!paths || !paths.length) return;

    if(simIsCuttingLayer(layer)){
      // Cuttinglines: sắp path theo thứ tự cắt (ưu tiên 2)
      simPushCuttingPaths(seq, paths, tool);
    } else if(tool.type==='drill'){
      // Drill: tối ưu thứ tự khoan theo nearest-neighbor (giống G-code),
      // gom lỗ gần nhau không phân biệt chi tiết.
      simPushDrillPaths(seq, paths, tool);
    } else if(tool.type==='pocket'){
      // Pocket: tối ưu thứ tự GIỮA các pocket theo nearest-neighbor
      // (gom pocket gần nhau), bên trong mỗi pocket giữ nguyên thứ tự vòng.
      simPushPocketPaths(seq, paths, tool);
    } else if(tool.strategy==='cut_in' || tool.strategy==='cut_on'){
      // Rãnh / khắc / cắt trong (KHÔNG làm rời chi tiết) → sắp theo LÂN CẬN GẦN NHẤT
      // để dao không chạy từ đầu tấm này sang đầu kia rồi vòng lại. Khớp Ruby
      // (write_profile dùng order_loops_nearest cho cut_in/cut_on).
      // cut_out (cuttinglines) KHÔNG áp — giữ thứ tự vùng vì liên quan an toàn.
      simPushPocketPaths(seq, paths, tool);
    } else {
      // Layer khác: giữ nguyên thứ tự path đã sinh
      paths.forEach(p=> simPushPath(seq, p, tool));
    }
  });

  return seq;
}

// Sắp path drill theo nearest-neighbor rồi đẩy vào sequence.
function simPushDrillPaths(seq, paths, tool){
  // Lấy tâm mỗi path drill
  var pts = paths.map(function(p){
    var c = simPathCenter(p);
    return { path:p, x:(c?c.x:0), y:(c?c.y:0) };
  });
  if(pts.length<=2){
    pts.forEach(function(o){ simPushPath(seq, o.path, tool); });
    return;
  }
  // nearest-neighbor: bắt đầu từ lỗ gần gốc (0,0)
  var remaining = pts.slice();
  var cur = remaining.reduce(function(a,b){ return (b.x*b.x+b.y*b.y < a.x*a.x+a.y*a.y)?b:a; });
  remaining.splice(remaining.indexOf(cur),1);
  simPushPath(seq, cur.path, tool);
  while(remaining.length){
    var best=null, bestD=Infinity, bi=-1;
    for(var i=0;i<remaining.length;i++){
      var dx=remaining[i].x-cur.x, dy=remaining[i].y-cur.y, d=dx*dx+dy*dy;
      if(d<bestD){ bestD=d; best=remaining[i]; bi=i; }
    }
    remaining.splice(bi,1);
    simPushPath(seq, best.path, tool);
    cur=best;
  }
}

// Sắp thứ tự GIỮA các pocket theo nearest-neighbor (gom pocket gần nhau).
// Bên trong mỗi pocket, simPushPath tự emit các vòng theo thứ tự gốc (ngoài→trong).
function simPushPocketPaths(seq, paths, tool){
  var pts = paths.map(function(p){
    var c = simPathCenter(p);
    return { path:p, x:(c?c.x:0), y:(c?c.y:0) };
  });
  if(pts.length<=2){
    pts.forEach(function(o){ simPushPath(seq, o.path, tool); });
    return;
  }
  var remaining = pts.slice();
  var cur = remaining.reduce(function(a,b){ return (b.x*b.x+b.y*b.y < a.x*a.x+a.y*a.y)?b:a; });
  remaining.splice(remaining.indexOf(cur),1);
  simPushPath(seq, cur.path, tool);
  while(remaining.length){
    var best=null, bestD=Infinity, bi=-1;
    for(var i=0;i<remaining.length;i++){
      var dx=remaining[i].x-cur.x, dy=remaining[i].y-cur.y, d=dx*dx+dy*dy;
      if(d<bestD){ bestD=d; best=remaining[i]; bi=i; }
    }
    remaining.splice(bi,1);
    simPushPath(seq, best.path, tool);
    cur=best;
  }
}

// Đẩy các path cuttinglines theo thứ tự cắt đã tính (tpComputeFinalOrder).
// Mỗi loop cắt (theo thứ tự) → tìm path tương ứng để đẩy.
function simPushCuttingPaths(seq, paths, tool){
  // tpZm.loops = các loop cuttinglines; tpComputeFinalOrder = thứ tự cắt
  if(typeof tpComputeFinalOrder !== 'function' || !tpZm || !tpZm.loops){
    // Không có thông tin thứ tự → giữ nguyên
    paths.forEach(p=> simPushPath(seq, p, tool));
    return;
  }
  const order = tpComputeFinalOrder();  // mảng chỉ số loop theo thứ tự cắt

  // Ghép mỗi loop (theo thứ tự) với path gần nhất (khớp theo tâm loop)
  // paths của cuttinglines thường là type 'segments' hoặc 'circle'.
  const used = new Set();
  order.forEach(loopIdx=>{
    const lp = tpZm.loops[loopIdx];
    if(!lp) return;
    const c = simLoopCenter(lp);
    // tìm path chưa dùng có tâm gần loop này nhất
    let best=-1, bestD=Infinity;
    paths.forEach((p,pi)=>{
      if(used.has(pi)) return;
      const pc = simPathCenter(p);
      if(!pc) return;
      const d=(pc.x-c.x)*(pc.x-c.x)+(pc.y-c.y)*(pc.y-c.y);
      if(d<bestD){ bestD=d; best=pi; }
    });
    if(best>=0){ used.add(best); simPushPath(seq, paths[best], tool); }
  });
  // path còn sót (không khớp loop nào) → đẩy cuối, giữ thứ tự
  paths.forEach((p,pi)=>{ if(!used.has(pi)) simPushPath(seq, p, tool); });
}

// ── Số lượt xuống dao cho MÔ PHỎNG ──────────────────────────────────────────
// Dùng num_passes (B) từ khai báo dao — áp cho MỌI loại (profile/pocket/drill).
// B là số lần xuống dao người dùng nhập trong editor. Chỉ cần SỐ lượt để lặp
// animation; giá trị Z từng mốc không ảnh hưởng đường XY.
function simPassCount(tool){
  if(!tool) return 1;
  var b = Math.round(+tool.num_passes || 1);
  return Math.max(1, b);
}

// Độ dày tấm hiện tại (mm) từ tên sheet; fallback 18mm nếu không đọc được.
function simSheetThickness(){
  var name = (tpZm && tpZm.sheet && tpZm.sheet.name) ? String(tpZm.sheet.name) : '';
  // lấy "<số>mm" cuối cùng (tránh nhầm mã màu có 'mm')
  var all = name.match(/(\d+(?:\.\d+)?)\s*mm/gi);
  if(all && all.length){
    var last = all[all.length-1].match(/(\d+(?:\.\d+)?)/);
    if(last) return parseFloat(last[1]);
  }
  return 18;
}

// ── RAMP ENTRY cho mô phỏng ────────────────────────────────────────────────
// Dựng đường dao có đoạn dốc: đi hết vòng (chu vi) rồi lặp lại đoạn L đầu, khớp
// ramp_entry_lines (Ruby). Trả { pts, rampEnd } — pts là đường XY đầy đủ, rampEnd
// = số ĐOẠN đầu thuộc phần dốc (để tô màu). pts vào phải là vòng kín KHÔNG lặp
// điểm cuối. Mất mát Z (2D) — chỉ thể hiện đoạn dốc bằng màu.
function simRampPath(loopPts, rampLen){
  // Nếu điểm cuối trùng điểm đầu (vòng đã đóng) → bỏ điểm lặp.
  if(loopPts.length >= 2){
    var f0=loopPts[0], l0=loopPts[loopPts.length-1];
    if(Math.hypot(f0.x-l0.x, f0.y-l0.y) < 1e-6) loopPts = loopPts.slice(0,-1);
  }
  var n = loopPts.length;
  if(n < 2) return null;
  var seg = [], total = 0;
  for(var i=0;i<n;i++){
    var a=loopPts[i], b=loopPts[(i+1)%n];
    var d=Math.hypot(b.x-a.x, b.y-a.y); seg.push(d); total+=d;
  }
  if(total < 1e-6) return null;
  var lEff = Math.min(rampLen, total);
  if(lEff <= 0) lEff = total;
  var target = total + lEff;

  // walk: đi vòng tới khi quãng ≥ target, kèm cum
  var walk = [{ x: loopPts[0].x, y: loopPts[0].y, cum: 0 }];
  var cum=0, i2=0;
  while(cum < target - 1e-6){
    var b2 = loopPts[(i2+1)%n]; cum += seg[i2%n];
    walk.push({ x: b2.x, y: b2.y, cum: cum }); i2++;
  }
  // chèn mốc lEff và target nếu rơi giữa cạnh
  [lEff, target].forEach(function(mark){
    if(walk.some(function(w){return Math.abs(w.cum-mark)<1e-6;})) return;
    for(var k=0;k<walk.length-1;k++){
      var a=walk[k], b=walk[k+1];
      if(a.cum < mark-1e-6 && b.cum > mark+1e-6){
        var t=(mark-a.cum)/(b.cum-a.cum);
        walk.splice(k+1,0,{ x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, cum:mark });
        break;
      }
    }
  });
  var kept = walk.filter(function(w){return w.cum <= target+1e-6;});
  var rampEnd = 0;
  for(var j=0;j<kept.length;j++){ if(kept[j].cum <= lEff+1e-6) rampEnd=j; }
  return { pts: kept.map(function(w){return {x:w.x,y:w.y};}), rampEnd: rampEnd };
}

function simRampOpenPath(pathPts, rampLen){
  if(!pathPts || pathPts.length<2) return null;
  var total=0, seg=[];
  for(var i=0;i<pathPts.length-1;i++){
    var d=Math.hypot(pathPts[i+1].x-pathPts[i].x,pathPts[i+1].y-pathPts[i].y);
    seg.push(d); total+=d;
  }
  if(total<1e-6) return null;
  var lEff=Math.max(1e-6,Math.min(rampLen,total));
  var out=[{x:pathPts[0].x,y:pathPts[0].y}], cum=0, rampEnd=0;
  for(var j=0;j<seg.length;j++){
    var a=pathPts[j],b=pathPts[j+1],sd=seg[j];
    if(sd>1e-9 && cum<lEff-1e-6 && cum+sd>lEff+1e-6){
      var t=(lEff-cum)/sd;
      out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}); rampEnd=out.length-1;
    }
    cum+=sd; out.push({x:b.x,y:b.y});
    if(cum<=lEff+1e-6) rampEnd=out.length-1;
  }
  // Sau ramp, lui theo dung vet ramp ve diem dau roi cat toan bo path o Z day.
  // Nhu vay doan dau cua vector ho khong bi cat nong va bo sot.
  var rampPts=out.slice(0,rampEnd+1);
  var returnPts=out.slice(0,rampEnd).reverse();
  var fullCut=pathPts.slice(1).map(function(p){return {x:p.x,y:p.y};});
  return {pts:rampPts.concat(returnPts,fullCut),rampEnd:rampEnd};
}

// Chuyển 1 path thành bước sequence (chuẩn hóa pts)
function simPushPath(seq, path, tool){
  // Pocket (hạ nền): emit từng vòng chạy thật (runs) thành các bước riêng.
  if(path.type==='pocket'){
    const feedP = (+tool.feed||3000);
    if(path.runs && path.runs.length){
      // runs được thu thập THEO ĐÚNG THỨ TỰ chạy dao của G-code (collectRun chạy
      // cùng thứ tự mà engine xuất G-code — đã tính sẵn hướng in_out/out_in ở khâu
      // sinh runs). Nên simulator KHÔNG đảo lại, chỉ chạy y hệt để khớp G-code.
      var runs = path.runs;
      // runs collectRun luôn thu NGOÀI→TRONG (mọi nhánh). in_out (trong ra ngoài)
      // → đảo để chạy trong→ngoài. Áp ĐỀU cho mọi nhánh (dogbone/circle/concave/rect).
      if((tool.direction||'out_in')==='in_out' && runs.length>1){
        runs = runs.slice().reverse();
      }
      // NHIỀU LƯỢT: lặp toàn bộ runs B lần (mỗi lượt xuống sâu hơn). B=num_passes.
      var nPassPk = simPassCount(tool);
      for(var pk=0; pk<Math.max(1,nPassPk); pk++){
        // Offsets of one Pocket stay at cutting Z. Join them so animation
        // includes the same G1 connectors emitted by Ruby.
        var joined=[];
        var chunks=[];
        runs.forEach(function(run){
          if(!run || run.length<2){
            if(joined.length>1) chunks.push(joined);
            joined=[];
            return;
          }
          // Final-order safety check. This runs AFTER in_out reversal, so it
          // validates the exact connector that animation and Ruby will use.
          if(joined.length){
            var prevEnd=joined[joined.length-1], nextStart=run[0];
            var stepAbs=(+tool.diameter||0)*((+tool.stepover||90)/100);
            var maxConnector=Math.max(stepAbs*1.5,(+tool.diameter||0)*1.25,1.0);
            if(Math.hypot(nextStart.x-prevEnd.x,nextStart.y-prevEnd.y)>maxConnector){
              if(joined.length>1) chunks.push(joined);
              joined=[];
            }
          }
          run.forEach(function(p){ joined.push({x:p.x,y:p.y}); });
        });
        if(joined.length>1) chunks.push(joined);
        chunks.forEach(function(chunk){
          seq.push({ layer: tool.layer, tool, type:'pocket', strategy: path.strategy,
                     pts: chunk, feed: feedP, closed:false,
                     passInfo: nPassPk>1 ? { idx: pk+1, total: nPassPk } : undefined });
        });
      }
    }
    return;  // không có runs → bỏ qua (không vẽ điểm giữa vô nghĩa)
  }
  const feed = (path.type==='drill') ? (+tool.z_feed||1000) : (+tool.feed||3000);
  let pts = null;
  if(path.pts && path.pts.length){
    pts = path.pts.map(p=>({x:p.x, y:p.y}));
  } else if(path.type==='circle'){
    // đường tròn → xấp xỉ bằng đa giác để animation chạy
    pts = simCircleToPts(path.cx, path.cy, path.r);
  } else if(path.type==='drill'){
    // khoan: 1 điểm (chấm tại tâm)
    pts = [{x:path.cx, y:path.cy}];
  }
  if(!pts || !pts.length) return;
  // Cuttinglines: chuẩn hóa chiều chạy theo cut_dir setting (cw/ccw) cho đồng nhất.
  // NHƯNG cut_on (đi thẳng theo biên, không offset) KHÔNG chuẩn hóa chiều — phần
  // tĩnh (tp-profile) và G-code (Ruby) đều đi theo thứ tự loop GỐC, nên simulator
  // cũng phải giữ nguyên để 3 bên khớp nhau.
  // cut_on = strategy KHÔNG phải cut_out cũng KHÔNG phải cut_in (offset 0).
  var _strat = path.strategy || (tool && tool.strategy) || '';
  var isCutOn = (_strat !== 'cut_out' && _strat !== 'cut_in');
  // CHỈ path KÍN mới chuẩn hóa chiều. Path HỞ (C/L/U) giữ nguyên thứ tự đầu→cuối,
  // nếu đảo sẽ hoán đổi 2 đầu vào/ra. Khớp tp-profile + Ruby.
  if(simIsCuttingLayer(tool.layer) && pts.length>2 && !isCutOn && !!path._closed){
    pts = simApplyCutDir(pts, _strat, tool);
  }
  // ── RAMP ENTRY: profile cuttinglines, ramp bật (theo DAO), 1 lượt, loop kín ──
  // Thay đường + plunge bằng đường có đoạn dốc. Đoạn dốc tách segment riêng (màu).
  // nPass phải tính TRƯỚC block ramp (điều kiện dùng tới) — nếu để sau, do hoisting
  // nPass=undefined ở đây → undefined<=1 là false → ramp không bao giờ chạy.
  var nPass = simPassCount(tool);
  var _rampOn = tool && tool.ramp_on === true;
  if(_rampOn && pts.length >= 2){
    var _rl = Math.max(2, +tool.ramp_len || 20);
    var _rp = path._closed ? simRampPath(pts, _rl) : simRampOpenPath(pts, _rl);
    if(_rp && _rp.pts.length >= 2 && _rp.rampEnd >= 1){
      // đoạn DỐC (màu riêng): pts[0..rampEnd]
      for(var rpass=0;rpass<nPass;rpass++){
        var rpi=nPass>1 ? {idx:rpass+1,total:nPass} : undefined;
        seq.push({ layer: tool.layer, tool, type: path.type, strategy: path.strategy,
                   pts: _rp.pts.slice(0, _rp.rampEnd+1), feed, closed:false,
                   isRamp:true, passInfo:rpi });
      // phần CÒN LẠI ở đáy
        seq.push({ layer: tool.layer, tool, type: path.type, strategy: path.strategy,
                   pts: _rp.pts.slice(_rp.rampEnd), feed, closed:false, passInfo:rpi });
      }
      return;
    }
  }
  // ── NHIỀU LƯỢT XUỐNG DAO: dao chạy lại vòng B lần (mỗi lượt sâu hơn) ──
  // B = num_passes từ khai báo dao, áp cho mọi loại tới nhánh này (profile/segments).
  // (nPass đã khai báo ở trên, trước block ramp)
  if(nPass > 1){
    for(var pass=0; pass<nPass; pass++){
      seq.push({ layer: tool.layer, tool, type: path.type, strategy: path.strategy,
                 pts: pts.map(p=>({x:p.x,y:p.y})), feed, closed: !!path._closed,
                 passInfo: { idx: pass+1, total: nPass } });
    }
  } else {
    seq.push({ layer: tool.layer, tool, type: path.type, strategy: path.strategy, pts, feed, closed: !!path._closed });
  }
}

// Tâm của 1 loop (từ edges)
function simLoopCenter(lp){
  let xs=[], ys=[];
  (lp.edges||lp||[]).forEach(e=>{
    if(e.x1!=null){ xs.push(e.x1,e.x2); ys.push(e.y1,e.y2); }
  });
  if(!xs.length) return {x:0,y:0};
  return { x:(Math.min(...xs)+Math.max(...xs))/2, y:(Math.min(...ys)+Math.max(...ys))/2 };
}

// Tâm của 1 path
function simPathCenter(p){
  if(p.pts && p.pts.length){
    let xs=p.pts.map(q=>q.x), ys=p.pts.map(q=>q.y);
    return { x:(Math.min(...xs)+Math.max(...xs))/2, y:(Math.min(...ys)+Math.max(...ys))/2 };
  }
  if(p.type==='circle') return {x:p.cx, y:p.cy};
  if(p.type==='drill')  return {x:p.cx, y:p.cy};
  if(p.type==='pocket') return {x:(p.bxMin+p.bxMax)/2, y:(p.byMin+p.byMax)/2};
  return null;
}

// Xấp xỉ đường tròn thành các điểm
function simCircleToPts(cx, cy, r, n=32){
  const pts=[];
  for(let i=0;i<=n;i++){
    const a=(i/n)*Math.PI*2;
    pts.push({x:cx+r*Math.cos(a), y:cy+r*Math.sin(a)});
  }
  return pts;
}

// ── UI: Danh sách checkbox layer ────────────────────────────────────────────
// Dựng từ các layer CÓ đường dao trong sheet (theo thứ tự dao mẫu TOOLS).
function simBuildLayerList(){
  const list=document.getElementById('sim-layer-list');
  if(!list) return;
  // Các layer có path (theo tpRenderedPaths), giữ thứ tự TOOLS
  const present={};
  if(typeof tpRenderedPaths!=='undefined'){
    tpRenderedPaths.forEach(p=>{
      const ly=(p.tool&&p.tool.layer)||'';
      if(ly) present[ly]=(present[ly]||0)+1;
    });
  }
  const toolList=(typeof TOOLS!=='undefined')?TOOLS:[];
  const seen={};
  let html='';
  toolList.forEach(t=>{
    const ly=t.layer;
    if(!ly || seen[ly] || !present[ly]) return;
    seen[ly]=true;
    // Khởi tạo: mặc định bật hết
    if(simState.enabledLayers && !simState.enabledLayers.has(ly)) { /* giữ trạng thái cũ */ }
    const checked = !simState.enabledLayers || simState.enabledLayers.has(ly);
    const col=(typeof getLayerColor==='function')?getLayerColor(ly):'#888';
    html+='<label class="sim-layer-item">'
      +'<input type="checkbox" '+(checked?'checked':'')+' onchange="simToggleLayer(\''+ly.replace(/'/g,"\\'")+'\',this.checked)">'
      +'<span class="sim-swatch" style="background:'+col+'"></span>'
      +'<span class="sim-lname" title="'+ly+'">'+ly+'</span>'
      +'<span class="sim-lcount">'+present[ly]+'</span>'
      +'</label>';
  });
  list.innerHTML = html || '<div style="font-size:11px;color:var(--text2);padding:12px 4px">Không có đường dao</div>';

  // Khởi tạo enabledLayers = tất cả (nếu chưa có)
  if(!simState.enabledLayers){
    simState.enabledLayers=new Set(Object.keys(seen));
  }
  simUpdateAllCheckbox();
}

function simToggleLayer(layer, on){
  if(!simState.enabledLayers) simState.enabledLayers=new Set();
  if(on) simState.enabledLayers.add(layer);
  else   simState.enabledLayers.delete(layer);
  simUpdateAllCheckbox();
  simReset();  // đổi lựa chọn → dựng lại sequence, reset animation
}

function simToggleAll(on){
  const boxes=document.querySelectorAll('#sim-layer-list input[type=checkbox]');
  simState.enabledLayers=new Set();
  boxes.forEach(b=>{
    b.checked=on;
    if(on){
      // lấy layer từ onchange attr
      const m=b.getAttribute('onchange').match(/simToggleLayer\('([^']+)'/);
      if(m) simState.enabledLayers.add(m[1]);
    }
  });
  simReset();
}

function simUpdateAllCheckbox(){
  const all=document.getElementById('sim-check-all');
  if(!all) return;
  const boxes=document.querySelectorAll('#sim-layer-list input[type=checkbox]');
  const total=boxes.length;
  let on=0; boxes.forEach(b=>{ if(b.checked) on++; });
  all.checked = total>0 && on===total;
  all.indeterminate = on>0 && on<total;
}

// ── ANIMATION ────────────────────────────────────────────────────────────────
// Nối sequence thành các đoạn thẳng liên tiếp, mỗi đoạn có độ dài + feed.
// Đầu dao chạy theo tổng quãng đường; vẽ vệt đã đi + chấm đầu dao.

function simBuildSegments(){
  const seq = simBuildSequence();
  const segs = [];        // [{x1,y1,x2,y2,len,feed,isTravel}]
  let prev = null;
  seq.forEach(step=>{
    const pts = step.pts;
    if(!pts || !pts.length) return;
    // Di chuyển nhanh (travel) từ điểm cuối đường trước → điểm đầu đường này.
    // Dùng feed của chính đường sắp cắt (travelMul sẽ nhân đôi ở simTick).
    if(prev){
      segs.push({x1:prev.x, y1:prev.y, x2:pts[0].x, y2:pts[0].y,
                 len:Math.hypot(pts[0].x-prev.x, pts[0].y-prev.y),
                 feed: step.feed, isTravel:true});
    }
    // Các đoạn cắt trong đường
    for(let i=0;i<pts.length-1;i++){
      const a=pts[i], b=pts[i+1];
      segs.push({x1:a.x,y1:a.y,x2:b.x,y2:b.y,
                 len:Math.hypot(b.x-a.x,b.y-a.y), feed:step.feed, isTravel:false,
                 type:step.type, strategy:step.strategy, isRamp:step.isRamp});
    }
    // Loop khép kín: thêm cạnh đóng từ điểm cuối về điểm đầu (nếu chưa trùng)
    if(step.closed && pts.length>2){
      const a=pts[pts.length-1], b=pts[0];
      const d=Math.hypot(b.x-a.x, b.y-a.y);
      if(d>0.01){
        segs.push({x1:a.x,y1:a.y,x2:b.x,y2:b.y,len:d,feed:step.feed,isTravel:false,
                   type:step.type, strategy:step.strategy});
      }
    }
    // drill 1 điểm: tạo đoạn 0 để có điểm dừng
    if(pts.length===1){
      segs.push({x1:pts[0].x,y1:pts[0].y,x2:pts[0].x,y2:pts[0].y,len:0,feed:step.feed,isTravel:false,isDrill:true,
                 type:step.type, strategy:step.strategy});
    }
    // Điểm kết thúc thật của đường (nơi đầu dao dừng, để travel tiếp nối đúng):
    // - Loop khép kín: sau cạnh đóng, đầu dao quay về điểm ĐẦU (pts[0]).
    // - Đường hở: điểm CUỐI mảng.
    if(step.closed && pts.length>2){
      prev = pts[0];
    } else {
      prev = pts[pts.length-1];
    }
  });
  return segs;
}

var simAnim = (typeof simAnim!=='undefined') ? simAnim : { raf:null, segs:[], segIdx:0, segDist:0, playing:false, done:false, lastT:0, totalLen:0, doneLen:0 };

function simTogglePlay(){
  if(simAnim.playing){ simPause(); return; }
  if(simAnim.done || !simAnim.segs.length){
    simPrepare();
  }
  if(!simAnim.segs.length) return;
  simAnim.playing = true;
  simAnim.done = false;
  simAnim.lastT = performance.now();
  simSetPlayBtn(true);
  simAnim.raf = requestAnimationFrame(simTick);
}

function simPrepare(){
  simAnim.segs = simBuildSegments();
  simAnim.segIdx = 0;
  simAnim.segDist = 0;
  simAnim.done = false;
  simAnim.totalLen = simAnim.segs.reduce((s,g)=>s+g.len,0) || 1;
  simAnim.doneLen = 0;
}

function simPause(){
  simAnim.playing=false;
  if(simAnim.raf){ cancelAnimationFrame(simAnim.raf); simAnim.raf=null; }
  simSetPlayBtn(false);
}

function simReset(){
  simPause();
  simAnim.segs=[]; simAnim.segIdx=0; simAnim.segDist=0; simAnim.done=false; simAnim.doneLen=0;
  simSetProgress(0);
  if(typeof redrawToolpath==='function') redrawToolpath();
}

function simStop(){ simReset(); }

function simTick(now){
  if(!simAnim.playing) return;
  const dt = Math.min(0.1, (now - simAnim.lastT)/1000);
  simAnim.lastT = now;

  const DISPLAY_SCALE = 4.5;  // tăng gấp 3 so với 1.5 trước
  let budget = 0;

  while(true){
    if(simAnim.segIdx >= simAnim.segs.length){ simAnim.done=true; break; }
    const seg = simAnim.segs[simAnim.segIdx];
    if(budget<=0){
      // Travel (di chuyển không cắt) chạy nhanh gấp 2 lần đoạn cắt
      const travelMul = seg.isTravel ? 2 : 1;
      const mmPerSec = (seg.feed/60) * simState.speed * DISPLAY_SCALE * travelMul;
      budget = mmPerSec * dt;
      if(budget<=0) budget = 0.001;
    }
    if(seg.len===0){ simAnim.segIdx++; simAnim.segDist=0; continue; }
    const remain = seg.len - simAnim.segDist;
    if(budget < remain){
      simAnim.segDist += budget;
      break;
    } else {
      budget -= remain;
      simAnim.doneLen += seg.len;
      simAnim.segIdx++;
      simAnim.segDist=0;
    }
  }

  // Khi dang zoom/pan, chi giu canvas nen nhe; frame nang ve lai sau debounce 400ms.
  if(typeof tpZoomSettling==='undefined' || !tpZoomSettling) simRenderFrame();
  simSetProgress(Math.min(100, (simAnim.doneLen/simAnim.totalLen)*100));

  if(simAnim.done){
    simAnim.playing=false;
    simSetPlayBtn(false);
    simSetProgress(100);
    return;
  }
  simAnim.raf = requestAnimationFrame(simTick);
}

function simRenderFrame(){
  const cv=document.getElementById('tp-canvas');
  if(!cv || !tpZm.sheet) return;
  const ctx=cv.getContext('2d');
  const dpr=window.devicePixelRatio||1;
  const s=tpZm.sheet;
  const PAD=20;
  const baseSc=Math.min((tpZm.cw-PAD*2)/s.width,(tpZm.ch-PAD*2)/s.height);
  const sc=baseSc*tpZm.scale;
  const tx=x=>(x*sc+PAD+tpZm.ox)*dpr;
  const ty=y=>(tpZm.ch-(y*sc+PAD)+tpZm.oy)*dpr;

  ctx.clearRect(0,0,cv.width,cv.height);
  ctx.fillStyle='#fafafa'; ctx.fillRect(0,0,cv.width,cv.height);
  const layerGroups={};
  s.display.forEach(v=>{ if(v.is_drill_center)return; (layerGroups[v.layer]=layerGroups[v.layer]||[]).push(v); });
  Object.entries(layerGroups).forEach(([layer,vecs])=>{
    const col=(typeof getLayerColor==='function')?getLayerColor(layer):'#888';
    ctx.strokeStyle=col+'55'; ctx.lineWidth=dpr*1.1; ctx.setLineDash([]);
    vecs.forEach(v=>{ ctx.beginPath();ctx.moveTo(tx(v.x1),ty(v.y1));ctx.lineTo(tx(v.x2),ty(v.y2));ctx.stroke(); });
  });

  // Toolpath ĐẦY ĐỦ dạng mờ làm nền (để thấy phần chưa chạy tới: khoan, đường dao...)
  simDrawToolpathFaint(ctx, tx, ty, sc, dpr);

  ctx.lineCap='round'; ctx.lineJoin='round';
  let head=null;
  for(let i=0;i<=simAnim.segIdx && i<simAnim.segs.length;i++){
    const seg=simAnim.segs[i];
    let ex=seg.x2, ey=seg.y2;
    if(i===simAnim.segIdx && seg.len>0){
      const t=simAnim.segDist/seg.len;
      ex=seg.x1+(seg.x2-seg.x1)*t; ey=seg.y1+(seg.y2-seg.y1)*t;
    }
    if(seg.isTravel){
      ctx.strokeStyle='#bbb'; ctx.setLineDash([dpr*4,dpr*3]); ctx.lineWidth=dpr*1;
    } else if(seg.isRamp){
      ctx.strokeStyle=simSegColor(seg); ctx.setLineDash([]); ctx.lineWidth=dpr*3.4;  // dốc: cam, dày hơn
    } else {
      ctx.strokeStyle=simSegColor(seg); ctx.setLineDash([]); ctx.lineWidth=dpr*2.2;
    }
    ctx.beginPath(); ctx.moveTo(tx(seg.x1),ty(seg.y1)); ctx.lineTo(tx(ex),ty(ey)); ctx.stroke();
    head={x:ex,y:ey};
  }
  ctx.setLineDash([]);

  if(head){
    ctx.beginPath(); ctx.arc(tx(head.x),ty(head.y), dpr*5, 0, Math.PI*2);
    ctx.fillStyle='#d9342b'; ctx.fill();
    ctx.strokeStyle='#fff'; ctx.lineWidth=dpr*1.5; ctx.stroke();

    // Nhãn "Lượt N/M" khi đang mô phỏng multipass
    var curSeg = simAnim.segs[simAnim.segIdx];
    if(curSeg && curSeg.passInfo && curSeg.passInfo.total>1){
      var label = 'Lượt '+curSeg.passInfo.idx+'/'+curSeg.passInfo.total;
      ctx.save();
      ctx.font = 'bold '+(dpr*11)+'px sans-serif';
      ctx.textAlign='left'; ctx.textBaseline='middle';
      var lx=tx(head.x)+dpr*10, ly=ty(head.y)-dpr*10;
      var tw=ctx.measureText(label).width+dpr*10;
      ctx.fillStyle='rgba(217,52,43,0.92)';
      ctx.beginPath(); ctx.roundRect(lx, ly-dpr*9, tw, dpr*18, dpr*4); ctx.fill();
      ctx.fillStyle='#fff'; ctx.fillText(label, lx+dpr*5, ly);
      ctx.restore();
    }
  }
}

// Vẽ toàn bộ toolpath dạng MỜ làm nền (phần chưa chạy tới vẫn thấy được).
// Chỉ vẽ các layer được tích chọn.
function simDrawToolpathFaint(ctx, tx, ty, sc, dpr){
  if(typeof tpRenderedPaths==='undefined' || !tpRenderedPaths.length) return;
  ctx.save();
  ctx.setLineDash([]);
  tpRenderedPaths.forEach(p=>{
    const ly=(p.tool&&p.tool.layer)||'';
    if(simState.enabledLayers && !simState.enabledLayers.has(ly)) return;  // layer bị bỏ tích
    if(p.type==='drill'){
      // vòng tròn khoan mờ
      const r=Math.max((p.r||2.5)*sc*dpr, 1*dpr);
      ctx.beginPath(); ctx.arc(tx(p.cx),ty(p.cy), r, 0, Math.PI*2);
      ctx.strokeStyle='rgba(220,120,0,0.28)'; ctx.lineWidth=dpr*0.9; ctx.stroke();
    } else if(p.type==='circle'){
      ctx.beginPath(); ctx.arc(tx(p.cx),ty(p.cy), (p.r||1)*sc*dpr, 0, Math.PI*2);
      ctx.strokeStyle='rgba(60,120,60,0.28)'; ctx.lineWidth=dpr*1.2; ctx.stroke();
    } else if((p.type==='segments'||p.type==='vbit_inner') && p.pts && p.pts.length>1){
      ctx.beginPath();
      ctx.moveTo(tx(p.pts[0].x),ty(p.pts[0].y));
      for(let i=1;i<p.pts.length;i++) ctx.lineTo(tx(p.pts[i].x),ty(p.pts[i].y));
      if(p._closed && p.pts.length>2) ctx.closePath();
      ctx.strokeStyle='rgba(60,120,60,0.28)'; ctx.lineWidth=dpr*1.4; ctx.stroke();
    } else if(p.type==='pocket'){
      // pocket: vẽ các vòng chạy thật mờ (nếu có), fallback khung bao
      if(p.runs && p.runs.length){
        ctx.strokeStyle='rgba(123,63,196,0.28)'; ctx.lineWidth=dpr*1.2;
        p.runs.forEach(run=>{
          if(!run || run.length<2) return;
          ctx.beginPath();
          ctx.moveTo(tx(run[0].x),ty(run[0].y));
          for(let i=1;i<run.length;i++) ctx.lineTo(tx(run[i].x),ty(run[i].y));
          ctx.stroke();
        });
      } else {
        ctx.strokeStyle='rgba(123,63,196,0.22)'; ctx.lineWidth=dpr*1;
        ctx.strokeRect(tx(p.bxMin),ty(p.byMax),(p.bxMax-p.bxMin)*sc*dpr,(p.byMax-p.byMin)*sc*dpr);
      }
    }
  });
  ctx.restore();
}

// Màu vệt cắt khớp với chú thích #tp-legend trên header.
//   Drill #e07b00 · cut_out #0fa050 · cut_in #1a7ad4 · cut_on #888 · Pocket #7b3fc4
function simSegColor(seg){
  if(seg.isRamp)         return '#e8820c';  // đoạn dốc xuống dao (cam)
  if(seg.type==='drill')  return '#e07b00';
  if(seg.type==='pocket') return '#7b3fc4';
  // cuttinglines: theo strategy
  const st=(seg.strategy||'').toString().toLowerCase();
  if(st.indexOf('cut_out')>=0 || st==='out') return '#0fa050';
  if(st.indexOf('cut_in')>=0  || st==='in')  return '#1a7ad4';
  if(st.indexOf('cut_on')>=0  || st==='on')  return '#888888';
  return '#0fa050';  // mặc định xanh lá (cut_out)
}

function simSetPlayBtn(playing){
  const b=document.getElementById('sim-play-btn');
  if(b) b.innerHTML = playing ? '❚❚ Tạm dừng' : '▶ Chạy';
}
function simSetProgress(pct){
  const p=document.getElementById('sim-progress');
  if(p) p.style.width=pct+'%';
}

// Có đang ở trạng thái animation cần giữ hiển thị (đã chạy được phần nào)?
// Dùng khi zoom/pan để vẽ lại FRAME animation thay vì toolpath tĩnh.
function simHasActiveFrame(){
  return simAnim && simAnim.segs && simAnim.segs.length>0 && (simAnim.segIdx>0 || simAnim.playing || simAnim.done);
}

// Vẽ lại (dùng chung cho zoom/pan): nếu animation đang có vệt → vẽ frame, ngược lại toolpath thường.
function simRedrawOrToolpath(){
  if(typeof detailMode!=='undefined' && detailMode==='toolpath' && simHasActiveFrame()){
    simRenderFrame();
  } else if(typeof redrawToolpath==='function'){
    redrawToolpath();
  }
}

function simSetSpeed(v){
  // Thang LOGARITHM: slider 0..100, giữa (50)=1×, 0=0.1×, 100=10×.
  // mult = 10^((v-50)/50) → v=0→0.1×, v=50→1×, v=100→10×
  const mult = Math.pow(10, ((+v) - 50) / 50);
  const lbl=document.getElementById('sim-speed-val');
  if(lbl) lbl.textContent = mult.toFixed(mult<1 ? 2 : 1)+'×';
  simState.speed = mult;
}

// Gọi trong Console (bản không mã hóa) hoặc gắn nút tạm.
function simDebugOrder(){
  const seq = simBuildSequence();
  console.log('=== THỨ TỰ SIMULATOR (', seq.length, 'bước) ===');
  seq.forEach((step,i)=>{
    const c = simPathCenter({pts:step.pts, type:step.type});
    let label = c ? ('@('+Math.round(c.x)+','+Math.round(c.y)+')') : '';
    // Với cuttinglines: hiển thị "tấm rộng×cao mm" (nhận diện tấm)
    if(simIsCuttingLayer(step.layer) && step.pts && step.pts.length){
      const xs=step.pts.map(p=>p.x), ys=step.pts.map(p=>p.y);
      const w=Math.round(Math.max(...xs)-Math.min(...xs));
      const h=Math.round(Math.max(...ys)-Math.min(...ys));
      label = '(tấm '+w+'×'+h+' mm) '+label;
    }
    console.log(
      (i+1)+'.',
      'layer='+step.layer,
      'dao='+(step.tool.name||'?'),
      'type='+step.type,
      'feed='+step.feed,
      label
    );
  });
  return seq.length;
}
