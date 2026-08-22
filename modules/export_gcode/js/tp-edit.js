// ── tp-edit.js — Tab Chỉnh sửa: đổi layer cho từng loop (chỉ ảnh hưởng G-code) ──
//
// Định danh loop theo (A): part_id + tâm + kích thước. Override lưu ở JS,
// áp vào preview + gửi xuống Ruby khi xuất.
//
// Bước 1: chọn loop trên canvas (highlight nét đứt, giữ màu).

// Override đã tạo: theo sheet name → mảng {kind, pid, cx, cy, w, h, fromLayer, toLayer}
var LAYER_OVERRIDES = (typeof LAYER_OVERRIDES!=='undefined') ? LAYER_OVERRIDES : {};

// Loop đang được chọn trong tab chỉnh sửa (index trong tpZm.loops)
var editSelLoop = -1;
var editSelObj = null;  // đối tượng đang chọn (loop hoặc drill) — chọn đơn
var editSelObjs = [];   // nhiều đối tượng (quét chọn)
var editHiddenLayers = null;  // Set layer bị ẩn (null = hiện tất cả)
var editSelLayer = null;      // layer đang chọn nhanh (chọn cả layer)

// ── QUÉT CHỌN (window/crossing như SketchUp) ─────────────────────────────────
// start,cur: {x,y} tọa độ model. Trái→phải = window (nét liền, chọn trọn vẹn).
// Phải→trái = crossing (nét đứt, chạm 1 phần là chọn).
function editBoxSelect(start, cur, addToSel){
  editBuildObjects();
  if(!editObjects) return;
  var x1=Math.min(start.x,cur.x), x2=Math.max(start.x,cur.x);
  var y1=Math.min(start.y,cur.y), y2=Math.max(start.y,cur.y);
  var isWindow = (cur.x >= start.x);  // kéo sang phải = window

  var hits=[];
  editObjects.forEach(function(obj){
    if(editHiddenLayers && editHiddenLayers.has(obj.layer)) return;
    if(editObjInBox(obj, x1, y1, x2, y2, isWindow)) hits.push(obj);
  });

  if(addToSel){
    // Giữ Shift: cộng dồn vào lựa chọn hiện có (không trùng)
    if(!editSelObjs) editSelObjs=[];
    hits.forEach(function(obj){
      if(editFindInSel(obj)<0) editSelObjs.push(obj);
    });
  } else {
    editSelObjs=hits;
  }
  editSelObj = (editSelObjs.length===1) ? editSelObjs[0] : null;
  editSelLayer=null;
  editShowSelectionMulti();
}

// Đối tượng có nằm trong/chạm khung không?
// isWindow=true: phải nằm TRỌN trong khung. false: chỉ cần CHẠM.
function editObjInBox(obj, x1, y1, x2, y2, isWindow){
  if(obj.kind==='drill'){
    // điểm khoan: coi như 1 điểm (tâm)
    var inx = obj.cx>=x1 && obj.cx<=x2 && obj.cy>=y1 && obj.cy<=y2;
    return inx;  // điểm: window hay crossing đều xét tâm nằm trong
  }
  // loop: xét các điểm
  var pts=[];
  obj.edges.forEach(function(e){ pts.push({x:e.x1,y:e.y1},{x:e.x2,y:e.y2}); });
  if(isWindow){
    // trọn vẹn: MỌI điểm nằm trong khung
    return pts.every(function(p){ return p.x>=x1 && p.x<=x2 && p.y>=y1 && p.y<=y2; });
  } else {
    // chạm: có điểm nằm trong, HOẶC cạnh cắt khung
    var anyIn = pts.some(function(p){ return p.x>=x1 && p.x<=x2 && p.y>=y1 && p.y<=y2; });
    if(anyIn) return true;
    // cạnh cắt khung? kiểm tra từng cạnh với 4 cạnh khung
    return obj.edges.some(function(e){
      return editSegIntersectBox(e.x1,e.y1,e.x2,e.y2, x1,y1,x2,y2);
    });
  }
}

// Cạnh (ax,ay)-(bx,by) có cắt khung [x1,y1,x2,y2] không
function editSegIntersectBox(ax,ay,bx,by, x1,y1,x2,y2){
  function segInt(p0x,p0y,p1x,p1y,p2x,p2y,p3x,p3y){
    var s1x=p1x-p0x, s1y=p1y-p0y, s2x=p3x-p2x, s2y=p3y-p2y;
    var den=(-s2x*s1y+s1x*s2y);
    if(Math.abs(den)<1e-9) return false;
    var s=(-s1y*(p0x-p2x)+s1x*(p0y-p2y))/den;
    var t=( s2x*(p0y-p2y)-s2y*(p0x-p2x))/den;
    return s>=0&&s<=1&&t>=0&&t<=1;
  }
  return segInt(ax,ay,bx,by, x1,y1,x2,y1) || // cạnh dưới
         segInt(ax,ay,bx,by, x2,y1,x2,y2) || // cạnh phải
         segInt(ax,ay,bx,by, x2,y2,x1,y2) || // cạnh trên
         segInt(ax,ay,bx,by, x1,y2,x1,y1);   // cạnh trái
}

// Hiện thông tin khi chọn nhiều
function editShowSelectionMulti(){
  var box=document.getElementById('edit-selbox');
  var hint=document.getElementById('edit-hint');
  var info=document.getElementById('edit-sel-info');
  if(!editSelObjs || editSelObjs.length===0){
    editShowSelection(); return;  // không có gì → về hiển thị đơn
  }
  if(editSelObjs.length===1){ editSelObj=editSelObjs[0]; editShowSelection(); return; }
  if(hint) hint.style.display='none';
  if(box) box.classList.remove('hidden');
  if(info){
    info.innerHTML = '<b>Đã chọn '+editSelObjs.length+' đối tượng</b><br>'
      +'<span style="color:var(--text2)">Chọn layer mới để đổi tất cả</span>';
  }
  editFillLayerSelect(null);
}

// Vẽ khung quét chọn (gọi trong lúc kéo)
function editDrawSelectBox(){
  var cv=document.getElementById('tp-canvas');
  if(!cv || !tpZm.selStart || !tpZm.selCur) return;
  var ctx=cv.getContext('2d');
  var dpr=window.devicePixelRatio||1;
  var s=tpZm.sheet, PAD=20;
  var baseSc=Math.min((tpZm.cw-PAD*2)/s.width,(tpZm.ch-PAD*2)/s.height);
  var sc=baseSc*tpZm.scale;
  var tx=function(x){return (x*sc+PAD+tpZm.ox)*dpr;};
  var ty=function(y){return (tpZm.ch-(y*sc+PAD)+tpZm.oy)*dpr;};
  var isWindow=(tpZm.selCur.x>=tpZm.selStart.x);
  var X1=tx(Math.min(tpZm.selStart.x,tpZm.selCur.x)), X2=tx(Math.max(tpZm.selStart.x,tpZm.selCur.x));
  var Y1=ty(Math.max(tpZm.selStart.y,tpZm.selCur.y)), Y2=ty(Math.min(tpZm.selStart.y,tpZm.selCur.y));
  ctx.save();
  if(isWindow){ ctx.setLineDash([]); ctx.strokeStyle='#1a7ad4'; ctx.fillStyle='rgba(26,122,212,0.10)'; }
  else        { ctx.setLineDash([5*dpr,3*dpr]); ctx.strokeStyle='#0fa050'; ctx.fillStyle='rgba(15,160,80,0.10)'; }
  ctx.lineWidth=dpr*1.2;
  ctx.fillRect(X1,Y1,X2-X1,Y2-Y1);
  ctx.strokeRect(X1,Y1,X2-X1,Y2-Y1);
  ctx.restore();
}

// Dựng danh sách layer trong sheet hiện tại (ẩn/hiện + click chọn nhanh)
function editBuildLayerList(){
  var list=document.getElementById('edit-layer-list');
  if(!list || !tpZm || !tpZm.sheet) return;
  // Đếm số LOOP mỗi layer (1 hình/1 lỗ = 1), không phải số cạnh.
  var byLayer={}, drillCount={};
  (tpZm.sheet.display||[]).forEach(function(v){
    if(!v.layer) return;
    if(v.is_drill_center){ drillCount[v.layer]=(drillCount[v.layer]||0)+1; return; }
    (byLayer[v.layer]=byLayer[v.layer]||[]).push(v);
  });
  var counts={};
  // layer có đường: đếm loop qua buildLoopsJS
  Object.keys(byLayer).forEach(function(ly){
    var loops=(typeof buildLoopsJS==='function')?buildLoopsJS(byLayer[ly]):[];
    counts[ly]=(counts[ly]||0)+loops.length;
  });
  // layer khoan: mỗi điểm khoan = 1
  Object.keys(drillCount).forEach(function(ly){
    counts[ly]=(counts[ly]||0)+drillCount[ly];
  });
  var names=Object.keys(counts).sort();
  if(!editHiddenLayers) editHiddenLayers=new Set();
  var html='';
  names.forEach(function(ly){
    var checked=!editHiddenLayers.has(ly);
    var col=(typeof getLayerColor==='function')?getLayerColor(ly):'#888';
    html+='<div class="edit-layer-item">'
      +'<input type="checkbox" '+(checked?'checked':'')+' onchange="editToggleLayer(\''+ly.replace(/'/g,"\\'")+'\',this.checked)">'
      +'<span class="el-swatch" style="background:'+col+'"></span>'
      +'<span class="el-name" title="Click để chọn cả layer \''+ly+'\'" onclick="editSelectLayer(\''+ly.replace(/'/g,"\\'")+'\')">'+ly+'</span>'
      +'<span class="el-count">'+counts[ly]+'</span>'
      +'</div>';
  });
  list.innerHTML=html || '<div style="font-size:11px;color:var(--text2);padding:8px">Không có layer</div>';
  editUpdateAllCheckbox();
}

// Ẩn/hiện 1 layer trên canvas
function editToggleLayer(layer, on){
  if(!editHiddenLayers) editHiddenLayers=new Set();
  if(on) editHiddenLayers.delete(layer);
  else   editHiddenLayers.add(layer);
  editUpdateAllCheckbox();
  if(typeof redrawToolpath==='function') redrawToolpath();
}

function editToggleAll(on){
  editHiddenLayers=new Set();
  if(!on){
    // ẩn tất cả
    (tpZm.sheet.display||[]).forEach(function(v){ if(v.layer) editHiddenLayers.add(v.layer); });
  }
  editBuildLayerList();
  if(typeof redrawToolpath==='function') redrawToolpath();
}

function editUpdateAllCheckbox(){
  var all=document.getElementById('edit-check-all');
  if(!all) return;
  var boxes=document.querySelectorAll('#edit-layer-list input[type=checkbox]');
  var total=boxes.length, on=0;
  boxes.forEach(function(b){ if(b.checked) on++; });
  all.checked = total>0 && on===total;
  all.indeterminate = on>0 && on<total;
}

// Chọn nhanh CẢ layer (đổi hàng loạt): chọn tất cả vector của layer này.
function editSelectLayer(layer){
  editSelLayer = layer;
  editSelObj = null;   // không phải chọn 1 đối tượng
  editSelLoop = -1;
  editShowSelectionLayer(layer);
  if(typeof redrawToolpath==='function') redrawToolpath();
}

// Hiện thông tin khi chọn cả layer
function editShowSelectionLayer(layer){
  var box=document.getElementById('edit-selbox');
  var hint=document.getElementById('edit-hint');
  var info=document.getElementById('edit-sel-info');
  var cnt=0;
  (tpZm.sheet.display||[]).forEach(function(v){ if(v.layer===layer) cnt++; });
  if(hint) hint.style.display='none';
  if(box) box.classList.remove('hidden');
  if(info){
    info.innerHTML = '<b>Cả layer:</b> '+layer+'<br>'
      +'<span style="color:var(--text2)">'+cnt+' vector sẽ đổi cùng lúc</span>';
  }
  editFillLayerSelect(layer);
}

// Đối tượng chọn được (mọi layer): {kind:'loop'|'drill', layer, edges|point, ...}
var editObjects = null;

// Dựng danh sách đối tượng chọn được từ toàn bộ display của sheet hiện tại.
// - Đường (cuttinglines, pocket, khấu...): nhóm theo layer → buildLoopsJS → mỗi loop 1 đối tượng
// - Drill (is_drill_center): mỗi điểm 1 đối tượng
function editBuildObjects(){
  editObjects=[];
  if(!tpZm || !tpZm.sheet) return;
  var disp = tpZm.sheet.display||[];
  // Nhóm vector theo layer (trừ drill center)
  var byLayer={};
  disp.forEach(function(v){
    if(v.is_drill_center){
      editObjects.push({kind:'drill', layer:v.layer, cx:(v.x1+v.x2)/2, cy:(v.y1+v.y2)/2,
                        diameter:v.diameter||5, part_id:v.part_id, _vecs:[v]});
      return;
    }
    (byLayer[v.layer]=byLayer[v.layer]||[]).push(v);
  });
  // Mỗi layer → build loops → mỗi loop 1 đối tượng
  Object.keys(byLayer).forEach(function(ly){
    var loops=(typeof buildLoopsJS==='function')?buildLoopsJS(byLayer[ly]):[];
    loops.forEach(function(lp){
      editObjects.push({kind:'loop', layer:ly, edges:lp, _vecs:lp});
    });
  });
}

// Khoảng cách từ điểm (mx,my) tới 1 đối tượng
function editObjDist(obj, mx, my){
  if(obj.kind==='drill'){
    return Math.sqrt((mx-obj.cx)*(mx-obj.cx)+(my-obj.cy)*(my-obj.cy));
  }
  // loop: khoảng cách nhỏ nhất tới các cạnh
  var best=Infinity;
  obj.edges.forEach(function(e){
    var a={x:e.x1,y:e.y1}, b={x:e.x2,y:e.y2};
    var dx=b.x-a.x, dy=b.y-a.y, len2=dx*dx+dy*dy;
    var d;
    if(len2<0.01){ d=Math.sqrt((mx-a.x)*(mx-a.x)+(my-a.y)*(my-a.y)); }
    else{
      var t=Math.max(0,Math.min(1,((mx-a.x)*dx+(my-a.y)*dy)/len2));
      var px=a.x+t*dx, py=a.y+t*dy;
      d=Math.sqrt((mx-px)*(mx-px)+(my-py)*(my-py));
    }
    if(d<best) best=d;
  });
  return best;
}

// Định danh 1 loop hoặc đối tượng: {kind, pid, cx, cy, w, h, fromLayer}
function editObjKey(obj){
  if(obj.kind==='drill'){
    return { kind:'drill', pid:obj.part_id||null,
             cx:Math.round(obj.cx), cy:Math.round(obj.cy), w:0, h:0, fromLayer:obj.layer||'' };
  }
  var xs=[], ys=[];
  obj.edges.forEach(function(e){ xs.push(e.x1,e.x2); ys.push(e.y1,e.y2); });
  var minX=Math.min.apply(null,xs), maxX=Math.max.apply(null,xs);
  var minY=Math.min.apply(null,ys), maxY=Math.max.apply(null,ys);
  var pid=null;
  for(var i=0;i<obj.edges.length;i++){ if(obj.edges[i].part_id!=null && obj.edges[i].part_id!==''){ pid=obj.edges[i].part_id; break; } }
  return {
    kind:'loop', pid:pid,
    cx: Math.round((minX+maxX)/2), cy: Math.round((minY+maxY)/2),
    w: Math.round(maxX-minX), h: Math.round(maxY-minY),
    fromLayer: (obj.edges[0] && obj.edges[0].layer) || ''
  };
}

// Hai key có khớp không (cùng đối tượng)?
function editKeyMatch(a, b){
  var tol=1;
  return (a.kind||'loop')===(b.kind||'loop') && (a.pid||null)===(b.pid||null) &&
         Math.abs(a.cx-b.cx)<=tol && Math.abs(a.cy-b.cy)<=tol &&
         Math.abs(a.w-b.w)<=tol && Math.abs(a.h-b.h)<=tol;
}

// Click trên canvas ở chế độ edit: chọn đối tượng GẦN NHẤT (mọi loại).
function editHandleClick(mx, my, addToSel){
  editBuildObjects();
  if(!editObjects || !editObjects.length) return;
  var tol = 8 / (tpZm._sc || 1);
  var best=-1, bestD=Infinity;
  editObjects.forEach(function(obj, i){
    if(editHiddenLayers && editHiddenLayers.has(obj.layer)) return;  // layer ẩn → không chọn
    var d=editObjDist(obj, mx, my);
    var thresh = obj.kind==='drill' ? Math.max(obj.diameter/2+tol, tol*2) : tol;
    if(d<=thresh && d<bestD){ bestD=d; best=i; }
  });

  if(best<0){
    // Click ra vùng trống → bỏ chọn (trừ khi giữ Shift)
    if(!addToSel){ editClearSelection(); }
    return;
  }

  var obj=editObjects[best];
  if(addToSel){
    // Giữ Shift: toggle đối tượng (thêm nếu chưa có, bỏ nếu đã chọn)
    if(!editSelObjs) editSelObjs=[];
    var idx=editFindInSel(obj);
    if(idx>=0) editSelObjs.splice(idx,1);
    else editSelObjs.push(obj);
    editSelObj = (editSelObjs.length===1)?editSelObjs[0]:null;
    editSelLayer=null;
    editShowSelectionMulti();
  } else {
    // Không Shift: chọn mới 1 đối tượng
    editSelObjs=[obj];
    editSelObj = obj;
    editSelLoop = best;
    editSelLayer = null;
    editShowSelection();
  }
  redrawToolpath();
}

// Tìm đối tượng trong editSelObjs (so theo định danh)
function editFindInSel(obj){
  if(!editSelObjs) return -1;
  var k=editObjKey(obj);
  for(var i=0;i<editSelObjs.length;i++){
    if(editKeyMatch(editObjKey(editSelObjs[i]), k)) return i;
  }
  return -1;
}

// Hiện thông tin đối tượng đã chọn + dropdown layer
function editShowSelection(){
  var box=document.getElementById('edit-selbox');
  var hint=document.getElementById('edit-hint');
  var info=document.getElementById('edit-sel-info');
  if(!editSelObj){
    if(box) box.classList.add('hidden');
    if(hint) hint.style.display='';
    return;
  }
  var k=editObjKey(editSelObj);
  if(hint) hint.style.display='none';
  if(box) box.classList.remove('hidden');
  if(info){
    var sizeStr = k.kind==='drill' ? ('Khoan ⌀'+(editSelObj.diameter||'?')+'mm') : (k.w+'×'+k.h+' mm');
    info.innerHTML = (k.pid?('<b>['+k.pid+']</b> '):'')+sizeStr+'<br>'
      +'<span style="color:var(--text2)">Layer hiện tại: </span>'+(k.fromLayer||'(không rõ)');
  }
  editFillLayerSelect(k.fromLayer);
}

// Đổ danh sách layer vào dropdown (bất kỳ layer nào — từ ALL_LAYERS + TOOLS)
function editFillLayerSelect(current){
  var sel=document.getElementById('edit-layer-select');
  if(!sel) return;
  var layers={};
  if(typeof ALL_LAYERS!=='undefined') ALL_LAYERS.forEach(function(l){ if(l) layers[l]=1; });
  if(typeof TOOLS!=='undefined') TOOLS.forEach(function(t){ if(t.layer) layers[t.layer]=1; });
  if(current) layers[current]=1;
  var names=Object.keys(layers).sort();
  var html='';
  names.forEach(function(n){
    html+='<option value="'+n+'"'+(n===current?' selected':'')+'>'+n+'</option>';
  });
  sel.innerHTML=html;
}

function editClearSelection(){
  editSelLoop=-1; editSelObj=null; editSelLayer=null; editSelObjs=[];
  editShowSelection();
  if(typeof redrawToolpath==='function') redrawToolpath();
}

// Vẽ 1 đối tượng highlight (nét đứt giữ màu)
function editDrawOneObj(ctx, obj, tx, ty, dpr){
  if(obj.kind==='drill'){
    var r=Math.max((obj.diameter/2), 2);
    ctx.setLineDash([5*dpr,3*dpr]); ctx.lineWidth=dpr*2.2;
    ctx.strokeStyle=(obj._vecs[0] && obj._vecs[0].color) || '#e07b00';
    ctx.beginPath();
    ctx.arc(tx(obj.cx), ty(obj.cy), Math.max(r*(tpZm._sc||1)*dpr, 6*dpr), 0, Math.PI*2);
    ctx.stroke();
  } else {
    var lp=obj.edges;
    ctx.setLineDash([6*dpr, 4*dpr]); ctx.lineWidth=dpr*2.4;
    ctx.strokeStyle=(lp[0] && lp[0].color) || '#d94040';
    ctx.beginPath();
    lp.forEach(function(e,i){
      if(i===0) ctx.moveTo(tx(e.x1),ty(e.y1));
      ctx.lineTo(tx(e.x2),ty(e.y2));
    });
    ctx.stroke();
  }
}

// Áp đổi layer: lưu override cho đối tượng đang chọn (hoặc cả layer).
function editApplyLayer(){
  var sel=document.getElementById('edit-layer-select');
  if(!sel || !tpZm || !tpZm.sheet) return;
  var toLayer=sel.value;
  if(!toLayer) return;
  var sheetName=tpZm.sheet.name;
  if(!LAYER_OVERRIDES[sheetName]) LAYER_OVERRIDES[sheetName]=[];

  if(editSelLayer){
    // Đổi CẢ LAYER: mọi đối tượng của layer này → toLayer
    if(editSelLayer===toLayer){ return; }
    editBuildObjects();
    editObjects.forEach(function(obj){
      if(obj.layer!==editSelLayer) return;
      var k=editObjKey(obj); k.toLayer=toLayer;
      editUpsertOverride(sheetName, k);
    });
    editSelLayer=null;
  } else if(editSelObjs && editSelObjs.length>1){
    // Đổi NHIỀU đối tượng (quét chọn)
    editSelObjs.forEach(function(obj){
      var k=editObjKey(obj);
      if(k.fromLayer===toLayer) return;
      k.toLayer=toLayer;
      editUpsertOverride(sheetName, k);
    });
    editSelObjs=[];
  } else if(editSelObj){
    // Đổi 1 ĐỐI TƯỢNG
    var k2=editObjKey(editSelObj);
    if(k2.fromLayer===toLayer){ return; }
    k2.toLayer=toLayer;
    editUpsertOverride(sheetName, k2);
    editSelObj=null; editSelLoop=-1; editSelObjs=[];
  } else {
    return;
  }

  editShowSelection();
  editBuildLayerList();
  editRefreshOverrideList();
  if(typeof redrawToolpath==='function') redrawToolpath();
}

// Thêm/cập nhật 1 override (nếu đã có cùng đối tượng thì ghi đè toLayer)
function editUpsertOverride(sheetName, key){
  var arr=LAYER_OVERRIDES[sheetName];
  for(var i=0;i<arr.length;i++){
    if(editKeyMatch(arr[i], key)){
      // nếu đổi về đúng layer gốc → xóa override
      if(key.toLayer===arr[i].fromLayer){ arr.splice(i,1); if(typeof ovMarkDirty==='function') ovMarkDirty(); return; }
      arr[i].toLayer=key.toLayer;
      if(typeof ovMarkDirty==='function') ovMarkDirty();
      return;
    }
  }
  arr.push(key);
  if(typeof ovMarkDirty==='function') ovMarkDirty();
}

// Lấy layer hiệu lực của 1 vector (sau override) — dùng khi vẽ preview.
// Trả toLayer nếu vector thuộc đối tượng đã override, ngược lại layer gốc.
function editEffectiveLayer(v, sheetName){
  var ovs=LAYER_OVERRIDES[sheetName];
  if(!ovs || !ovs.length) return v.layer;
  // Vector khớp override nào? So theo part_id + nằm trong bbox override.
  for(var i=0;i<ovs.length;i++){
    var o=ovs[i];
    if(o.fromLayer!==v.layer) continue;
    var vpid=(v.part_id!=null?v.part_id:null);
    if((o.pid||null)!==vpid) continue;
    // vector nằm trong vùng đối tượng (tâm ± nửa size + tol)
    var vcx=(v.x1+v.x2)/2, vcy=(v.y1+v.y2)/2;
    var tol=1;
    if(Math.abs(vcx-o.cx)<=o.w/2+tol && Math.abs(vcy-o.cy)<=o.h/2+tol){
      return o.toLayer;
    }
  }
  return v.layer;
}

// Làm mới danh sách override trong sidebar
function editRefreshOverrideList(){
  var list=document.getElementById('edit-ov-list');
  if(!list || !tpZm || !tpZm.sheet) return;
  var arr=LAYER_OVERRIDES[tpZm.sheet.name]||[];
  if(!arr.length){
    list.innerHTML='<div style="font-size:11px;color:var(--text2);padding:6px">Chưa có thay đổi nào.</div>';
    return;
  }
  var html='';
  arr.forEach(function(o,i){
    var label = (o.kind==='drill') ? ('Khoan '+(o.pid?('['+o.pid+'] '):'')) : ((o.pid?('['+o.pid+'] '):'')+o.w+'×'+o.h);
    html+='<div class="edit-ov-item">'
      +'<span class="edit-ov-txt">'+label+'<br><span style="color:var(--text2)">'+o.fromLayer+' → </span><b>'+o.toLayer+'</b></span>'
      +'<span class="edit-ov-del" title="Xóa" onclick="editRemoveOverride('+i+')">✕</span>'
      +'</div>';
  });
  list.innerHTML=html;
}

// Xóa 1 override
function editRemoveOverride(idx){
  var arr=LAYER_OVERRIDES[tpZm.sheet.name];
  if(!arr || !arr[idx]) return;
  arr.splice(idx,1);
  if(typeof ovMarkDirty==='function') ovMarkDirty();
  editRefreshOverrideList();
  editBuildLayerList();
  if(typeof redrawToolpath==='function') redrawToolpath();
}

// Vẽ highlight đối tượng đang chọn: nét đứt, giữ màu.
function editDrawSelection(ctx, tx, ty, dpr){
  // Chọn cả layer: highlight mọi vector của layer đó
  if(editSelLayer){
    var col=(typeof getLayerColor==='function')?getLayerColor(editSelLayer):'#d94040';
    ctx.save();
    ctx.setLineDash([6*dpr,4*dpr]); ctx.lineWidth=dpr*2.2; ctx.strokeStyle=col;
    (tpZm.sheet.display||[]).forEach(function(v){
      if(v.layer!==editSelLayer) return;
      if(v.is_drill_center){
        ctx.beginPath(); ctx.arc(tx((v.x1+v.x2)/2),ty((v.y1+v.y2)/2), Math.max((v.diameter||5)/2*(tpZm._sc||1)*dpr,5*dpr),0,Math.PI*2); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(tx(v.x1),ty(v.y1)); ctx.lineTo(tx(v.x2),ty(v.y2)); ctx.stroke();
      }
    });
    ctx.restore();
    return;
  }
  ctx.save();
  // Nhiều đối tượng (quét chọn)
  if(editSelObjs && editSelObjs.length>0){
    editSelObjs.forEach(function(obj){ editDrawOneObj(ctx, obj, tx, ty, dpr); });
    ctx.restore();
    return;
  }
  // Một đối tượng
  if(editSelObj){ editDrawOneObj(ctx, editSelObj, tx, ty, dpr); }
  ctx.restore();
}