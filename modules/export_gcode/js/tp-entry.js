// ── tp-entry.js — Can thiệp thủ công ĐIỂM XUỐNG DAO (entry point) ──
//
// Trong tab "Xem đường dao": click 1 chi tiết → hiện các ĐỈNH THẬT của hình
// (tam giác 3 đỉnh, ngũ giác 5 đỉnh, chữ nhật 4 đỉnh) → click đỉnh để đặt
// điểm xuống dao. Chi tiết chưa can thiệp → theo setting vùng (như cũ).
//
// Override lưu TỌA ĐỘ đỉnh đã chọn (px,py) — KHÔNG dùng chỉ số góc bbox,
// vì góc bbox có thể không nằm trên hình (tam giác, ngũ giác...).

var ENTRY_OVERRIDES = (typeof ENTRY_OVERRIDES!=='undefined') ? ENTRY_OVERRIDES : {};
var entrySelLoop = -1;   // loop đang chọn (index trong tpZm.loops)

// Ngưỡng góc bẻ để coi là "đỉnh" (độ). Đường tròn 24 đoạn bẻ 15°/đỉnh → bị loại.
var ENTRY_CORNER_ANGLE = 20;

// Định danh loop: part_id + tâm + kích thước
function entryLoopKey(loop){
  var xs=[], ys=[];
  loop.forEach(function(e){ xs.push(e.x1,e.x2); ys.push(e.y1,e.y2); });
  var minX=Math.min.apply(null,xs), maxX=Math.max.apply(null,xs);
  var minY=Math.min.apply(null,ys), maxY=Math.max.apply(null,ys);
  var pid=null;
  for(var i=0;i<loop.length;i++){ if(loop[i].part_id!=null && loop[i].part_id!==''){ pid=loop[i].part_id; break; } }
  return {
    pid: pid,
    cx: Math.round((minX+maxX)/2), cy: Math.round((minY+maxY)/2),
    w: Math.round(maxX-minX), h: Math.round(maxY-minY)
  };
}

function entryKeyMatch(a,b){
  var tol=1;
  return (a.pid||null)===(b.pid||null) &&
         Math.abs(a.cx-b.cx)<=tol && Math.abs(a.cy-b.cy)<=tol &&
         Math.abs(a.w-b.w)<=tol && Math.abs(a.h-b.h)<=tol;
}

// Dãy điểm theo thứ tự của loop (edge đã nối chuỗi bởi buildLoopsJS)
function entryLoopPoints(loop){
  var pts=[];
  loop.forEach(function(e){ pts.push({x:e.x1, y:e.y1}); });
  return pts;
}

// Các ĐỈNH THẬT: điểm có góc bẻ lớn (bỏ điểm giữa cạnh thẳng / trên cung tròn)
function entryVertices(loop){
  var pts = entryLoopPoints(loop);
  var n = pts.length;
  if(n < 3) return [];
  var out=[];
  for(var i=0;i<n;i++){
    var p  = pts[i];
    var pv = pts[(i-1+n)%n];
    var nx = pts[(i+1)%n];
    var v1x=p.x-pv.x, v1y=p.y-pv.y;
    var v2x=nx.x-p.x, v2y=nx.y-p.y;
    var l1=Math.sqrt(v1x*v1x+v1y*v1y), l2=Math.sqrt(v2x*v2x+v2y*v2y);
    if(l1<0.001 || l2<0.001) continue;
    var dot=(v1x*v2x+v1y*v2y)/(l1*l2);
    dot=Math.max(-1,Math.min(1,dot));
    var turn=Math.acos(dot)*180/Math.PI;   // góc bẻ
    if(turn >= ENTRY_CORNER_ANGLE) out.push({x:p.x, y:p.y});
  }
  return out;
}

// Override của loop → {x,y} hoặc null
function entryFindPoint(loop){
  if(!tpZm || !tpZm.sheet) return null;
  var arr = ENTRY_OVERRIDES[tpZm.sheet.name];
  if(!arr || !arr.length) return null;
  var k = entryLoopKey(loop);
  for(var i=0;i<arr.length;i++){
    if(entryKeyMatch(arr[i], k)) return {x:arr[i].px, y:arr[i].py};
  }
  return null;
}

// Đặt override điểm xuống dao (tọa độ đỉnh)
function entrySetPoint(loop, px, py){
  if(!tpZm || !tpZm.sheet) return;
  var sName = tpZm.sheet.name;
  if(!ENTRY_OVERRIDES[sName]) ENTRY_OVERRIDES[sName] = [];
  var arr = ENTRY_OVERRIDES[sName];
  var k = entryLoopKey(loop);
  for(var i=0;i<arr.length;i++){
    if(entryKeyMatch(arr[i], k)){ arr[i].px=px; arr[i].py=py; entryRefreshList(); if(typeof ovMarkDirty==='function') ovMarkDirty(); return; }
  }
  arr.push({ pid:k.pid, cx:k.cx, cy:k.cy, w:k.w, h:k.h, px:px, py:py });
  entryRefreshList();
  if(typeof ovMarkDirty==='function') ovMarkDirty();
}

// Click trong tab Xem đường dao
function entryHandleClick(mx, my){
  if(!tpZm || !tpZm.loops) return false;
  var sc = tpZm._sc || 1;
  var tolC = 10 / sc;   // bán kính bắt click vào đỉnh (mm)

  // 1) Đang chọn loop → click trúng đỉnh nào?
  if(entrySelLoop >= 0 && tpZm.loops[entrySelLoop]){
    var lp = tpZm.loops[entrySelLoop];
    var verts = entryVertices(lp);
    var best=-1, bestD=Infinity;
    for(var c=0;c<verts.length;c++){
      var dx=mx-verts[c].x, dy=my-verts[c].y;
      var d=Math.sqrt(dx*dx+dy*dy);
      if(d<=tolC && d<bestD){ bestD=d; best=c; }
    }
    if(best>=0){
      entrySetPoint(lp, verts[best].x, verts[best].y);
      redrawToolpath();
      return true;
    }
  }

  // 2) Click vào chi tiết → chọn (hiện các đỉnh)
  var hit = (typeof tpFindLoopAt==='function') ? tpFindLoopAt(mx,my) : -1;
  if(hit >= 0){
    entrySelLoop = hit;
    redrawToolpath();
    return true;
  }

  // 3) Click ra ngoài → bỏ chọn
  if(entrySelLoop >= 0){
    entrySelLoop = -1;
    redrawToolpath();
    return true;
  }
  return false;
}

// Vẽ các đỉnh của loop đang chọn; đỉnh đang áp dụng tô đỏ
function entryDrawCorners(ctx, tx, ty, dpr){
  if(entrySelLoop < 0 || !tpZm.loops || !tpZm.loops[entrySelLoop]) return;
  var lp = tpZm.loops[entrySelLoop];
  var verts = entryVertices(lp);
  var ov = entryFindPoint(lp);

  ctx.save();
  // viền chi tiết đang chọn (nét đứt tím)
  ctx.setLineDash([6*dpr,4*dpr]); ctx.lineWidth=dpr*1.6; ctx.strokeStyle='#7b3fc4';
  ctx.beginPath();
  lp.forEach(function(e,i){
    if(i===0) ctx.moveTo(tx(e.x1),ty(e.y1));
    ctx.lineTo(tx(e.x2),ty(e.y2));
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // chấm tại từng ĐỈNH THẬT
  verts.forEach(function(v){
    var isActive = ov && Math.sqrt((v.x-ov.x)*(v.x-ov.x)+(v.y-ov.y)*(v.y-ov.y)) < 0.5;
    var px=tx(v.x), py=ty(v.y);
    ctx.beginPath();
    ctx.arc(px,py, isActive ? 8*dpr : 6*dpr, 0, Math.PI*2);
    ctx.fillStyle = isActive ? '#d94040' : 'rgba(255,255,255,0.95)';
    ctx.fill();
    ctx.lineWidth = dpr*1.8;
    ctx.strokeStyle = isActive ? '#d94040' : '#7b3fc4';
    ctx.stroke();
  });
  ctx.restore();
}

// ── Danh sách override trong sidebar ──
function entryRefreshList(){
  var box = document.getElementById('entry-ov-list');
  if(!box || !tpZm || !tpZm.sheet) return;
  var arr = ENTRY_OVERRIDES[tpZm.sheet.name] || [];
  if(!arr.length){
    box.innerHTML = '<div style="font-size:11px;color:var(--text2);padding:6px">Chưa có. Click 1 chi tiết rồi click đỉnh để đặt.</div>';
    return;
  }
  var html='';
  arr.forEach(function(o,i){
    var label = (o.pid?('['+o.pid+'] '):'') + o.w+'×'+o.h;
    html += '<div class="edit-ov-item">'
      + '<span class="edit-ov-txt">'+label+'<br><span style="color:var(--text2)">Đỉnh: </span><b>'
      + Math.round(o.px)+', '+Math.round(o.py)+'</b></span>'
      + '<span class="edit-ov-del" title="Xóa" onclick="entryRemoveOverride('+i+')">✕</span>'
      + '</div>';
  });
  box.innerHTML = html;
}

function entryRemoveOverride(idx){
  if(!tpZm || !tpZm.sheet) return;
  var arr = ENTRY_OVERRIDES[tpZm.sheet.name];
  if(!arr || !arr[idx]) return;
  arr.splice(idx,1);
  entryRefreshList();
  if(typeof ovMarkDirty==='function') ovMarkDirty();
  redrawToolpath();
}

// ══ LƯU / NẠP OVERRIDE VÀO FILE SKETCHUP ═════════════════════════════════════
// Lưu cả 2 loại: đổi layer (tab Chỉnh sửa) + điểm xuống dao (tab Xem đường dao).
// Ghi vào attribute dictionary của model (không đụng hình học).

var OV_DIRTY = false;   // có thay đổi chưa lưu?

// Đánh dấu có thay đổi chưa lưu → nút Lưu đổi trạng thái
function ovMarkDirty(){
  OV_DIRTY = true;
  var b=document.getElementById('tp-save-ov');
  if(b){ b.classList.add('ov-dirty'); b.textContent='💾 Lưu thay đổi *'; }
}
function ovMarkClean(){
  OV_DIRTY = false;
  var b=document.getElementById('tp-save-ov');
  if(b){ b.classList.remove('ov-dirty'); b.textContent='💾 Lưu thay đổi'; }
}

// Bấm nút Lưu → gửi xuống Ruby ghi vào file SketchUp
function saveOverridesToModel(){
  var payload = {
    layer_overrides: (typeof LAYER_OVERRIDES!=='undefined') ? LAYER_OVERRIDES : {},
    entry_overrides: (typeof ENTRY_OVERRIDES!=='undefined') ? ENTRY_OVERRIDES : {},
    cut_order:       (typeof CUSTOM_CUT_ORDER!=='undefined') ? CUSTOM_CUT_ORDER : {}
  };
  if(typeof sketchup!=='undefined' && sketchup.save_overrides_callback){
    sketchup.save_overrides_callback(JSON.stringify(payload));
  }
}

// Ruby gọi lại sau khi lưu
function n2gOverridesSaved(ok, msg){
  if(ok) ovMarkClean();
  if(typeof showGConfirm==='function'){
    showGConfirm(
      ok ? 'Đã lưu thay đổi' : 'Lỗi lưu',
      String(msg).replace(/\n/g,'<br>'),
      [{ label:'Đã hiểu', value:'ok', kind:'primary' }],
      ok ? 'info' : 'warn'
    );
  }
}

// Ruby gọi lúc mở dialog → nạp override đã lưu trong file
function n2gLoadOverrides(data){
  if(!data) return;
  if(data.layer_overrides && typeof LAYER_OVERRIDES!=='undefined'){
    LAYER_OVERRIDES = data.layer_overrides;
  }
  if(data.entry_overrides){
    ENTRY_OVERRIDES = data.entry_overrides;
  }
  // Thứ tự cắt: giữ nguyên object gốc (nơi khác đang tham chiếu tới nó)
  if(data.cut_order && typeof CUSTOM_CUT_ORDER!=='undefined'){
    Object.keys(CUSTOM_CUT_ORDER).forEach(function(k){ delete CUSTOM_CUT_ORDER[k]; });
    Object.keys(data.cut_order).forEach(function(k){ CUSTOM_CUT_ORDER[k]=data.cut_order[k]; });
  }
  ovMarkClean();
}