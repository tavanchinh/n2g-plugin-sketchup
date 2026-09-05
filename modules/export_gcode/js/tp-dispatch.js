// ── tp-dispatch.js — Toolpath modal, dispatcher (redrawToolpath), tooltip, hit-test ──
// Load SAU tp-drill/pocket/profile/vbit.js (gọi các hàm drawToolpath*)

// ── Toolpath Preview ─────────────────────────────────────────────────────────
// Dùng var + gán điều kiện để tránh lỗi "already declared" nếu file vô tình nạp 2 lần.
var tpZm = tpZm || {scale:1,ox:0,oy:0,drag:false,lx:0,ly:0,sheet:null};
var detailMode = detailMode || 'order';  // 'order' = thứ tự cắt | 'toolpath' = xem đường dao | 'edit' = chỉnh sửa

// Chuyển chế độ modal Chi tiết (loại trừ nhau)
function setDetailMode(mode){
  detailMode=mode;
  var bOrder=document.getElementById('tp-mode-order');
  var bPath =document.getElementById('tp-mode-path');
  var sideR =document.getElementById('tp-side-right');
  var legend=document.getElementById('tp-legend');
  var bEdit =document.getElementById('tp-mode-edit');
  if(bOrder) bOrder.classList.toggle('active', mode==='order');
  if(bPath)  bPath.classList.toggle('active', mode==='toolpath');
  if(bEdit)  bEdit.classList.toggle('active', mode==='edit');
  // sidebar phải (thứ tự) chỉ hiện ở chế độ order
  if(sideR) sideR.classList.toggle('hidden', mode!=='order');
  // sidebar mô phỏng chỉ hiện ở chế độ xem đường dao
  var simR=document.getElementById('sim-side-right');
  if(simR) simR.classList.toggle('hidden', mode!=='toolpath');
  // sidebar chỉnh sửa chỉ hiện ở chế độ edit
  var editR=document.getElementById('edit-side-right');
  if(editR) editR.classList.toggle('hidden', mode!=='edit');
  // chú thích màu chỉ cần ở chế độ xem đường dao
  if(legend) legend.style.visibility = (mode==='toolpath') ? 'visible' : 'hidden';
  if(mode==='order' && typeof tpUpdateOrderList==='function') tpUpdateOrderList();
  if(typeof redrawToolpath==='function') redrawToolpath();
  // Khi vào chế độ xem đường dao → dựng danh sách layer cho mô phỏng
  if(mode==='toolpath' && typeof simBuildLayerList==='function'){
    setTimeout(simBuildLayerList, 0);
  } else if(mode!=='toolpath' && typeof simStop==='function'){
    simStop();
  }
  // Điểm xuống dao (chỉ ở chế độ xem đường dao)
  if(mode==='toolpath'){
    if(typeof entryRefreshList==='function') setTimeout(entryRefreshList, 0);
  } else if(typeof entrySelLoop!=='undefined'){
    entrySelLoop = -1;
  }
  // Vào/rời chế độ edit
  if(mode==='edit'){
    setTimeout(function(){
      if(typeof editBuildLayerList==='function') editBuildLayerList();
      if(typeof editShowSelection==='function') editShowSelection();
      if(typeof editRefreshOverrideList==='function') editRefreshOverrideList();
    }, 0);
  }
}

// Dựng danh sách tấm bên trái sidebar (phương án B)
function tpBuildSheetList(currentSheet){
  const list=document.getElementById('tp-sheet-list');
  if(!list || typeof SHEETS==='undefined') return;
  let html='';
  SHEETS.forEach((sh,i)=>{
    const active = (sh.name===currentSheet.name);
    html+='<div class="tp-sheet-item'+(active?' active':'')+'" onclick="tpSwitchSheet('+i+')" title="'+(sh.name||'')+'">'
      +tpSheetLabel(sh, i)
      +'</div>';
  });
  list.innerHTML=html;
}

// Nhãn tấm: SỐ (cố định) · TÊN MATERIAL (co lại, cắt "...") · ĐỘ DÀY (luôn hiện).
// CSS ellipsis chỉ cắt ở cuối, nên tách 3 phần để dấu "..." rơi vào GIỮA —
// giữ được độ dày ở cuối dù tên material dài đến đâu.
function tpSheetLabel(sh, i){
  const name = (sh.name||'').toString();
  if(!name) return '<span class="ts-num">['+(i+1)+']</span><span class="ts-sep"> - </span><span class="ts-mat">Tấm</span>';

  // 1) số sheet (+ hậu tố bottom/top nếu có)
  const ms  = name.match(/sheet[\s_-]*(\d+)([\w-]*)/i);
  const num = ms ? ms[1] : (i+1);
  const suf = ms ? (ms[2]||'').replace(/^[-_\s]+/,'') : '';

  // 2) bỏ đuôi sheet-N ra khỏi chuỗi trước khi tìm độ dày
  let rest = ms ? name.replace(ms[0], '') : name;

  // 3) Độ dày = lần khớp "<số>mm" CUỐI CÙNG (tên material có thể chứa 'mm',
  //    vd 'AC024MM' — nếu lấy lần khớp đầu sẽ nhầm thành 024mm).
  //    Dùng exec-loop thay matchAll (matchAll cần Chrome 73+, SU21 không có).
  var all = [];
  var reThk = /(\d+(?:\.\d+)?)\s*mm/gi, mMatch;
  while((mMatch = reThk.exec(rest)) !== null){
    all.push({ 0: mMatch[0], 1: mMatch[1], index: mMatch.index });
    if(reThk.lastIndex === mMatch.index) reThk.lastIndex++; // tránh kẹt vòng lặp
  }
  let thk = '', mat = rest;
  if(all.length){
    const last = all[all.length-1];
    thk = last[1] + 'mm';
    mat = rest.slice(0, last.index) + rest.slice(last.index + last[0].length);
  }
  mat = mat.replace(/[-–·\s_]+/g,' ').trim();

  // Dạng: [số] - màu - độ dày
  let html = '<span class="ts-num">['+num+(suf?' '+suf:'')+']</span>';
  html += '<span class="ts-sep"> - </span>';
  html += '<span class="ts-mat">'+(mat || '—')+'</span>';
  if(thk){
    html += '<span class="ts-sep"> - </span>';
    html += '<span class="ts-thk">'+thk+'</span>';
  }
  return html;
}

// Đổi sang tấm khác (không tắt modal). Giữ nguyên chế độ đang xem.
function tpSwitchSheet(idx){
  if(typeof SHEETS==='undefined' || !SHEETS[idx]) return;
  const sh=SHEETS[idx];
  if(tpZm && tpZm.sheet && tpZm.sheet.name===sh.name) return;  // đã là tấm này
  const keepMode = detailMode;  // giữ chế độ hiện tại
  // dừng animation nếu đang chạy
  if(typeof simStop==='function') simStop();
  if(typeof simState!=='undefined'){
    simState.enabledLayers=null;  // reset lọc layer cho tấm mới
    simState.availableLayers=null;
  }
  openToolpathModal(sh);
  // openToolpathModal mặc định về 'order' — khôi phục lại chế độ đang xem
  if(keepMode && keepMode!=='order' && typeof setDetailMode==='function'){
    setDetailMode(keepMode);
  }
}

function openToolpathModal(sheet){
  if(typeof tpZoomRenderTimer!=='undefined' && tpZoomRenderTimer){
    clearTimeout(tpZoomRenderTimer); tpZoomRenderTimer=null;
  }
  tpZoomSettling=false;
  tpZm={scale:1,ox:0,oy:0,drag:false,lx:0,ly:0,sheet};
  document.getElementById('tp-title').textContent=`Đường dao — ${sheet.name} (${Math.round(sheet.width)}×${Math.round(sheet.height)}mm)`;
  tpBuildSheetList(sheet);  // dựng danh sách tấm bên trái + highlight tấm hiện tại
  const modal=document.getElementById('tp-modal');
  modal.classList.add('show');
  forceRepaint(modal);
  const body=modal.querySelector('.tp-canvas-wrap') || modal.querySelector('.tp-body');
  const cv=document.getElementById('tp-canvas');
  const dpr=window.devicePixelRatio||1;
  const bw=body.clientWidth-20, bh=body.clientHeight-20;
  cv.width=bw*dpr; cv.height=bh*dpr;
  cv.style.width=bw+'px'; cv.style.height=bh+'px';
  tpZm.cw=bw; tpZm.ch=bh;
  // Loops cho thứ tự cắt: CHỈ lấy vector của layer cuttinglines (tấm phôi cắt rời).
  // Không gom mọi vector — số thứ tự chỉ áp dụng cho tấm cut_out của cuttinglines.
  var cuttingVecs = (sheet.display||[]).filter(function(v){
    return !v.is_drill_center && (v.layer||'').toLowerCase().indexOf('cutting')>=0;
  });
  tpZm.loops = (typeof buildLoopsJS==='function') ? buildLoopsJS(cuttingVecs) : [];
  if(!CUSTOM_CUT_ORDER[sheet.name]) CUSTOM_CUT_ORDER[sheet.name]=[];
  tpZm.cutOrder = CUSTOM_CUT_ORDER[sheet.name];
  setDetailMode('order');  // mặc định chế độ thứ tự cắt
  redrawToolpath();

  // Zoom vào vị trí con trỏ (chuẩn hóa theo tỉ lệ canvas hiển thị → buffer)
  cv.onwheel=e=>{
    e.preventDefault();
    const f=e.deltaY<0?1.12:1/1.12;
    const r=cv.getBoundingClientRect();
    // quy về hệ tọa độ nội bộ (tpZm.cw/ch) giống lúc pan/click
    const mx=(e.clientX-r.left)/r.width*tpZm.cw;
    const my=(e.clientY-r.top)/r.height*tpZm.ch;
    // Giu dung diem model nam duoi con tro khi scale thay doi.
    // X co PAD ben trai; Y cua canvas bi dao va co PAD o day, nen hai cong thuc
    // khong the dung phep scale offset doi xung nhu truoc.
    const PAD=20;
    tpZm.ox=mx-PAD-(mx-PAD-tpZm.ox)*f;
    tpZm.oy=my-tpZm.ch+PAD+(tpZm.ch-my-PAD+tpZm.oy)*f;
    tpZm.scale*=f;
    tpRedrawAfterViewportChange();
  };
  // Nút chuột: 0=trái, 1=giữa, 2=phải. Pan = chuột GIỮA.
  cv.onmousedown=e=>{
    if(e.button===1){
      // Pan bằng chuột giữa
      e.preventDefault();
      tpZm.panning=true; tpZm.lx=e.clientX; tpZm.ly=e.clientY;
      return;
    }
    if(e.button===0){
      // Chuột trái: ở edit/order → bắt đầu quét chọn vùng; mode khác → chuẩn bị click
      tpZm.drag=true; tpZm.lx=e.clientX; tpZm.ly=e.clientY;
      tpZm.downX=e.clientX; tpZm.downY=e.clientY; tpZm.moved=false;
      if(detailMode==='edit' || detailMode==='order'){
        const p=tpClientToModel(e);
        tpZm.selStart={x:p.x, y:p.y, cx:e.clientX, cy:e.clientY};
        tpZm.selecting=true;
      }
    }
  };
  // Chuyển tọa độ chuột (clientX/Y) → tọa độ model
  function tpClientToModel(e){
    const r=cv.getBoundingClientRect();
    const baseSc=Math.min((tpZm.cw-20*2)/tpZm.sheet.width,(tpZm.ch-20*2)/tpZm.sheet.height);
    const sc=baseSc*tpZm.scale;
    const mx=(e.clientX-r.left)/r.width*tpZm.cw;
    const my=(e.clientY-r.top)/r.height*tpZm.ch;
    return { x:(mx-20-tpZm.ox)/sc, y:(tpZm.ch-my-20+tpZm.oy)/sc, sc:sc, mx:mx, my:my };
  }
  tpZm._clientToModel = tpClientToModel;

  // Tooltip hover
  let _tpTooltipTimer=null;
  cv.onmousemove=e=>{
    // Pan bằng chuột giữa
    if(tpZm.panning){
      tpZm.ox+=e.clientX-tpZm.lx; tpZm.oy+=e.clientY-tpZm.ly;
      tpZm.lx=e.clientX; tpZm.ly=e.clientY;
      tpRedrawAfterViewportChange();
      return;
    }
    // Quét chọn (edit/order + chuột trái)
    if(tpZm.selecting && tpZm.selStart){
      const p=tpClientToModel(e);
      tpZm.selCur={x:p.x, y:p.y, cx:e.clientX, cy:e.clientY};
      if(Math.abs(e.clientX-tpZm.downX)>2||Math.abs(e.clientY-tpZm.downY)>2) tpZm.moved=true;
      // ORDER: cấp số REAL-TIME — quét tới đâu, cụm nào bao trọn thì đánh số ngay
      if(detailMode==='order' && tpZm.moved && typeof tpBoxSelectOrder==='function'){
        tpBoxSelectOrder(tpZm.selStart, tpZm.selCur);
      }
      redrawToolpath();
      if(typeof editDrawSelectBox==='function') editDrawSelectBox();
      return;
    }
    // (mode toolpath) kéo bằng chuột trái vẫn pan — giữ tương thích cũ.
    // edit/order dùng chuột trái để QUÉT CHỌN (xử lý ở nhánh selecting phía trên).
    if(tpZm.drag && detailMode!=='edit' && detailMode!=='order'){
      if(Math.abs(e.clientX-tpZm.downX)>3||Math.abs(e.clientY-tpZm.downY)>3) tpZm.moved=true;
      tpZm.ox+=e.clientX-tpZm.lx; tpZm.oy+=e.clientY-tpZm.ly;
      tpZm.lx=e.clientX;tpZm.ly=e.clientY;tpRedrawAfterViewportChange();
      hideToolpathTooltip(); return;
    }
    // Tính tọa độ canvas → model (cho tooltip)
    const r=cv.getBoundingClientRect();
    const baseSc=Math.min((tpZm.cw-20*2)/tpZm.sheet.width,(tpZm.ch-20*2)/tpZm.sheet.height);
    const sc=baseSc*tpZm.scale;
    const mx=(e.clientX-r.left)/r.width*tpZm.cw;
    const my=(e.clientY-r.top)/r.height*tpZm.ch;
    const modelX=(mx-20-tpZm.ox)/sc;
    const modelY=(tpZm.ch-my-20+tpZm.oy)/sc;
    clearTimeout(_tpTooltipTimer);
    if(detailMode==='order'){
      _tpTooltipTimer=setTimeout(()=>{
        const hit=tpFindLoopAt(modelX, modelY);
        if(hit>=0) showOrderTooltip(hit, e.clientX, e.clientY);
        else hideToolpathTooltip();
      }, 400);
    } else if(detailMode==='toolpath'){
      _tpTooltipTimer=setTimeout(()=>{
        const hit=findToolpathHit(modelX, modelY, sc);
        if(hit) showToolpathTooltip(hit, e.clientX, e.clientY);
        else hideToolpathTooltip();
      }, 800);
    }
  };
  cv.onmouseup=e=>{
    // Kết thúc pan chuột giữa
    if(e.button===1 || tpZm.panning){ tpZm.panning=false; return; }

    // Kết thúc quét chọn (edit/order + chuột trái)
    if(tpZm.selecting){
      tpZm.selecting=false;
      var shift=e.shiftKey;
      if(tpZm.moved && tpZm.selStart && tpZm.selCur){
        // Có kéo → quét chọn vùng
        if(detailMode==='edit' && typeof editBoxSelect==='function'){
          editBoxSelect(tpZm.selStart, tpZm.selCur, shift);
        } else if(detailMode==='order' && typeof tpBoxSelectOrder==='function'){
          tpBoxSelectOrder(tpZm.selStart, tpZm.selCur);
        }
      } else {
        // Không kéo → click 1 đối tượng
        const p=tpClientToModel(e);
        tpZm._sc=p.sc;
        if(detailMode==='edit' && typeof editHandleClick==='function'){
          editHandleClick(p.x, p.y, shift);
        } else if(detailMode==='order'){
          const hit=tpFindLoopAt(p.x, p.y);
          if(hit>=0) tpTogglePin(hit);
        }
      }
      tpZm.selStart=null; tpZm.selCur=null; tpZm.drag=false;
      redrawToolpath();
      return;
    }

    // Click (không kéo) ở chế độ order → chọn/bỏ thứ tự tấm
    if(tpZm.drag && !tpZm.moved && detailMode==='order'){
      const p=tpClientToModel(e);
      const hit=tpFindLoopAt(p.x, p.y);
      if(hit>=0) tpTogglePin(hit);
    }
    // Click (không kéo) ở chế độ xem đường dao → chọn chi tiết / đặt điểm xuống dao
    else if(tpZm.drag && !tpZm.moved && detailMode==='toolpath' && typeof entryHandleClick==='function'){
      const p=tpClientToModel(e);
      tpZm._sc=p.sc;
      entryHandleClick(p.x, p.y);
    }
    tpZm.drag=false;
  };
  cv.onmouseleave=()=>{tpZm.drag=false;tpZm.panning=false;tpZm.selecting=false;tpZm.selStart=null;tpZm.selCur=null;clearTimeout(_tpTooltipTimer);hideToolpathTooltip();};
  // Chặn menu chuột phải trên canvas (để dành cho thao tác sau nếu cần)
  cv.oncontextmenu=e=>{ e.preventDefault(); };
}

function showToolpathTooltip(hit, cx, cy){
  const el=document.getElementById('tp-tooltip');
  const action = hit.type==='drill'?'Khoan':hit.type==='pocket'?'Phay pocket':
    hit.strategy==='cut_out'?'Cắt ngoài':hit.strategy==='cut_in'?'Cắt trong':'Cắt trên đường';
  // Lấy thông tin tool
  const tool = TOOLS.find(t=>t.layer===hit.layer);
  const feed = tool ? (hit.type==='drill' ? `F${tool.z_feed}` : `F${tool.feed}`) : '—';

  if(hit.vbitEdge){
    // V-Bit: hiển thị Z cụ thể của cạnh đang hover + góc + L
    const zLabel = hit.vbitEdge==='outer' ? 'Z 0 (mặt ván)' : `Z ${hit.vbitZ}mm (đáy)`;
    const edgeLabel = hit.vbitEdge==='outer' ? 'Viền vát (mặt ván)' : 'Viền đáy (offset L)';
    el.innerHTML=`
      <b style="font-size:12px">${hit.name||'—'}</b>
      <div style="opacity:.7;margin-top:2px">V-Bit ${action} · ${edgeLabel}</div>
      <div style="display:flex;gap:10px;margin-top:4px;opacity:.85">
        <span>${zLabel}</span>
        <span>${feed} mm/min</span>
      </div>
      <div style="opacity:.6;margin-top:3px;font-size:10px">Góc ${(tool && tool.vbit_angle)||120}° · L=${hit.vbitL?hit.vbitL.toFixed(2):'—'}mm</div>
      <div style="opacity:.45;margin-top:3px;font-size:10px">${hit.layer}</div>
    `;
  } else {
    const depth = tool ? `${tool.depth}mm` : '—';
    el.innerHTML=`
      <b style="font-size:12px">${hit.name||'—'}</b>
      <div style="opacity:.7;margin-top:2px">${action}</div>
      <div style="display:flex;gap:10px;margin-top:4px;opacity:.85">
        <span>Z ${depth}</span>
        <span>${feed} mm/min</span>
      </div>
      <div style="opacity:.45;margin-top:3px;font-size:10px">${hit.layer}</div>
    `;
  }
  el.style.display='block';
  el.style.left=(cx+14)+'px';
  el.style.top=(cy-10)+'px';
}

function hideToolpathTooltip(){
  document.getElementById('tp-tooltip').style.display='none';
}

function findToolpathHit(mx, my, sc){
  const tol=8/sc;
  for(const path of tpRenderedPaths){
    if(path.type==='drill'){
      const d=Math.sqrt((mx-path.cx)**2+(my-path.cy)**2);
      if(d<=Math.max(path.r+tol, tol*2))
        return {name:path.tool.name,type:'drill',layer:path.tool.layer,strategy:'drill'};
    } else if(path.type==='circle'){
      const d=Math.sqrt((mx-path.cx)**2+(my-path.cy)**2);
      if(Math.abs(d-path.r)<=tol)
        return {name:path.tool.name,type:path.tool.type,layer:path.tool.layer,strategy:path.strategy};
    } else if(path.type==='pocket'){
      if(mx>=path.bxMin-tol&&mx<=path.bxMax+tol&&my>=path.byMin-tol&&my<=path.byMax+tol)
        return {name:path.tool.name,type:'pocket',layer:path.tool.layer,strategy:'pocket'};
    } else if(path.type==='segments' && path.pts.length>1){
      const pts=path.pts;
      for(let i=0;i<pts.length-1;i++){
        const a=pts[i],b=pts[(i+1)%pts.length];
        const dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;
        if(len2<0.01) continue;
        const t=Math.max(0,Math.min(1,((mx-a.x)*dx+(my-a.y)*dy)/len2));
        const px=a.x+t*dx,py=a.y+t*dy;
        if(Math.sqrt((mx-px)**2+(my-py)**2)<=tol)
          return {name:path.tool.name,type:path.tool.type,layer:path.tool.layer,strategy:path.strategy};
      }
    } else if((path.type==='vbit_outer'||path.type==='vbit_inner') && path.pts.length>1){
      const pts=path.pts;
      const n = path.type==='vbit_outer' && !pts._closed ? pts.length-1 : pts.length;
      for(let i=0;i<pts.length;i++){
        const a=pts[i],b=pts[(i+1)%pts.length];
        const dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;
        if(len2<0.01) continue;
        const t=Math.max(0,Math.min(1,((mx-a.x)*dx+(my-a.y)*dy)/len2));
        const px=a.x+t*dx,py=a.y+t*dy;
        if(Math.sqrt((mx-px)**2+(my-py)**2)<=tol)
          return {
            name:path.tool.name, type:path.tool.type, layer:path.tool.layer, strategy:path.strategy,
            vbitZ: path.z, vbitL: path.L, vbitEdge: path.type==='vbit_outer' ? 'outer' : 'inner'
          };
      }
    }
  }
  return null;
}

function closeToolpathModal(){
  if(tpZoomRenderTimer){ clearTimeout(tpZoomRenderTimer); tpZoomRenderTimer=null; }
  tpZoomSettling=false;
  document.getElementById('tp-modal').classList.remove('show');
  const cv=document.getElementById('tp-canvas');
  cv.onwheel=cv.onmousedown=cv.onmousemove=cv.onmouseup=cv.onmouseleave=null;
}

// Lưu các path đã render để hit test
var tpRenderedPaths = (typeof tpRenderedPaths!=='undefined') ? tpRenderedPaths : [];
var tpZoomRenderTimer = null;
var tpZoomSettling = false;

// Zoom/pan trong tab toolpath: ve nen ngay, doi 400ms sau thao tac cuoi moi ve duong dao nang.
function tpRedrawAfterViewportChange(){
  if(detailMode!=='toolpath'){
    redrawToolpath();
    return;
  }
  tpZoomSettling=true;
  redrawToolpath({hideToolpath:true});
  if(tpZoomRenderTimer) clearTimeout(tpZoomRenderTimer);
  tpZoomRenderTimer=setTimeout(function(){
    tpZoomRenderTimer=null;
    tpZoomSettling=false;
    if(typeof simRedrawOrToolpath==='function') simRedrawOrToolpath();
    else redrawToolpath();
  },400);
}

// ── Chế độ thứ tự cắt: tìm tấm, chọn thứ tự, danh sách ──
// (Cũ) Nút Lưu riêng ở tab Thứ tự cắt đã bỏ — dùng nút "Lưu thay đổi" trên header,
// lưu chung cả thứ tự cắt + đổi layer + điểm xuống dao vào file SketchUp.
function tpSaveOrder(){
  if(typeof saveOverridesToModel==='function') saveOverridesToModel();
}

// Toast giữa màn hình, tự mờ dần sau ~1.6s
function showTpToast(msg){
  var t=document.getElementById('tp-toast');
  if(!t){
    t=document.createElement('div'); t.id='tp-toast';
    t.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);'
      +'z-index:400;background:rgba(20,20,20,0.9);color:#fff;font-size:15px;font-weight:600;'
      +'padding:16px 28px;border-radius:10px;box-shadow:0 6px 30px rgba(0,0,0,0.4);'
      +'pointer-events:none;opacity:0;transition:opacity .3s;display:flex;align-items:center;gap:10px';
    document.body.appendChild(t);
  }
  t.innerHTML='<span style="color:#3ddc84;font-size:18px">✓</span>'+msg;
  // hiện
  clearTimeout(t._hideTimer); clearTimeout(t._fadeTimer);
  t.style.display='flex';
  // ép reflow để transition chạy lại
  void t.offsetWidth;
  t.style.opacity='1';
  // giữ ~1.3s rồi mờ dần .3s
  t._fadeTimer=setTimeout(function(){ t.style.opacity='0'; }, 1300);
  t._hideTimer=setTimeout(function(){ t.style.display='none'; }, 1650);
}

function tpResetOrder(){
  if(tpZm.sheet){
    CUSTOM_CUT_ORDER[tpZm.sheet.name]=[];
    tpZm.cutOrder=CUSTOM_CUT_ORDER[tpZm.sheet.name];
  }
  if(typeof ovMarkDirty==='function') ovMarkDirty();
  tpUpdateOrderList();
  redrawToolpath();
}

function tpFindLoopAt(modelX, modelY){
  if(!tpZm.loops || !tpZm.loops.length) return -1;
  // Ưu tiên click theo BADGE: chọn loop có badge gần điểm click nhất (trong bán kính).
  // Nhờ badge của island và loop cha đã tách vị trí, cả hai đều click riêng được.
  // Bán kính bắt badge quy ra model theo scale hiện tại (~14px).
  var sc = (tpZm.sheet && tpZm.cw) ? Math.min((tpZm.cw-40)/tpZm.sheet.width,(tpZm.ch-40)/tpZm.sheet.height)*tpZm.scale : 1;
  var hitR = 14 / (sc || 1);   // model-mm tương ứng ~14px
  var best=-1, bestD=Infinity;
  for(var i=0;i<tpZm.loops.length;i++){
    var bp=tpLoopBadgePos(i);
    var d=Math.hypot(modelX-bp.x, modelY-bp.y);
    if(d<hitR && d<bestD){ bestD=d; best=i; }
  }
  if(best>=0) return best;

  // Không trúng badge nào → fallback theo bbox: ưu tiên loop NHỎ nhất chứa điểm
  // (để island nằm trong cha vẫn chọn được khi click vào vùng island).
  var hit=-1, hitArea=Infinity;
  tpZm.loops.forEach(function(lp,i){
    var b=tpLoopBBox(lp);
    if(modelX>=b.xMin&&modelX<=b.xMax&&modelY>=b.yMin&&modelY<=b.yMax){
      var area=(b.xMax-b.xMin)*(b.yMax-b.yMin);
      if(area<hitArea){ hitArea=area; hit=i; }
    }
  });
  return hit;
}

function tpTogglePin(loopIdx){
  var order=tpZm.cutOrder;
  var idx=order.indexOf(loopIdx);
  if(idx>=0) order.splice(idx,1);
  else order.push(loopIdx);
  if(typeof ovMarkDirty==='function') ovMarkDirty();
  tpUpdateOrderList();
  redrawToolpath();
}

// Lấy layer của 1 loop (từ edge đầu có layer). Dùng để nhận diện sheet_border.
function tpLoopLayer(lp){
  if(!lp || !lp.length) return null;
  for(var i=0;i<lp.length;i++){ if(lp[i].layer) return lp[i].layer; }
  return null;
}

// Quét chọn vùng → đánh số các chi tiết được vùng chọn BAO TRỌN. Hai quy tắc:
//  1) BỎ QUA loop sheet_border (đường bao phôi) — không đánh số, không tính vào cụm.
//  2) Chi tiết có island (lỗ): phải bao trọn CẢ loop ngoài LẪN island thì mới cấp số
//     cho cả cụm; bao thiếu một phần → không cấp.
// Các chi tiết mới nối vào cuối danh sách, sắp theo thứ tự cắt tự nhiên (island trước
// cha). Danh sách đang trống thì số bắt đầu từ 1.
function tpBoxSelectOrder(start, cur){
  if(!tpZm.loops || !tpZm.loops.length) return;
  var x0=Math.min(start.x,cur.x), x1=Math.max(start.x,cur.x);
  var y0=Math.min(start.y,cur.y), y1=Math.max(start.y,cur.y);
  var flags=tpIslandFlags();

  function bboxOf(i){ return tpLoopBBox(tpZm.loops[i]); }
  function inBox(i){
    var b=bboxOf(i);
    return b.xMin>=x0 && b.xMax<=x1 && b.yMin>=y0 && b.yMax<=y1;
  }
  function isBorder(i){
    var lyr=(tpLoopLayer(tpZm.loops[i])||'').toLowerCase();
    return lyr.indexOf('border')>=0;   // sheet_border / *border*
  }
  function bboxInside(ib, pb){
    return ib.xMin>=pb.xMin && ib.xMax<=pb.xMax && ib.yMin>=pb.yMin && ib.yMax<=pb.yMax;
  }

  // ── Gom CỤM: mỗi loop ngoài (không island, không border) là 1 cụm; các island nằm
  // trong nó được gộp vào cùng cụm (theo bbox chứa, chọn cha nhỏ nhất). ──
  var clusters={};   // key → [loopIdx...]
  var n=tpZm.loops.length;
  for(var i=0;i<n;i++){
    if(isBorder(i) || flags[i]) continue;      // chỉ khởi tạo cụm cho loop NGOÀI
    clusters['c'+i]=[i];
  }
  for(var k=0;k<n;k++){
    if(!flags[k] || isBorder(k)) continue;     // island cần gán vào cụm cha
    var ib=bboxOf(k), best=null, bestArea=Infinity;
    for(var key in clusters){
      var pIdx=clusters[key][0];
      var pb=bboxOf(pIdx);
      if(bboxInside(ib, pb)){
        var area=(pb.xMax-pb.xMin)*(pb.yMax-pb.yMin);
        if(area<bestArea){ bestArea=area; best=key; }
      }
    }
    if(best!==null) clusters[best].push(k);
    else clusters['solo'+k]=[k];               // island không tìm được cha → cụm riêng
  }

  // ── Cụm nào được BAO TRỌN HẾT (mọi loop trong cụm) và CHƯA có số → cấp cả cụm ──
  var newIdxs=[];
  for(var ck in clusters){
    var g=clusters[ck];
    if(g.some(function(idx){ return tpZm.cutOrder.indexOf(idx)>=0; })) continue; // cụm đã có số
    var allIn=true;
    for(var gi=0; gi<g.length; gi++){ if(!inBox(g[gi])){ allIn=false; break; } }
    if(allIn) newIdxs=newIdxs.concat(g);
  }
  if(!newIdxs.length) return;

  var sorted=(typeof tpSortAutoOrder==='function')?tpSortAutoOrder(newIdxs):newIdxs;
  sorted.forEach(function(idx){ if(tpZm.cutOrder.indexOf(idx)<0) tpZm.cutOrder.push(idx); });
  if(typeof ovMarkDirty==='function') ovMarkDirty();
  tpUpdateOrderList();
  return true;   // có cấp số mới → caller tự vẽ lại
}

function tpLoopSize(lp){
  var xs=[],ys=[];
  lp.forEach(function(v){xs.push(v.x1,v.x2);ys.push(v.y1,v.y2);});
  return {
    w: Math.round(Math.max.apply(null,xs)-Math.min.apply(null,xs)),
    h: Math.round(Math.max.apply(null,ys)-Math.min.apply(null,ys)),
    cx:(Math.min.apply(null,xs)+Math.max.apply(null,xs))/2,
    cy:(Math.min.apply(null,ys)+Math.max.apply(null,ys))/2
  };
}

// Bbox thô của 1 loop (không làm tròn) — cho tính vị trí badge.
function tpLoopBBox(lp){
  var xs=[],ys=[];
  lp.forEach(function(v){xs.push(v.x1,v.x2);ys.push(v.y1,v.y2);});
  return {xMin:Math.min.apply(null,xs),xMax:Math.max.apply(null,xs),
          yMin:Math.min.apply(null,ys),yMax:Math.max.apply(null,ys)};
}

// Mảng đánh dấu loop nào là island (đảo bên trong), cache theo tpZm.loops.
// Dùng detectIslandJS (có xét group_id) để chính xác như engine.
function tpIslandFlags(){
  if(!tpZm.loops) return [];
  if(tpZm._islandFlags && tpZm._islandFlagsFor===tpZm.loops) return tpZm._islandFlags;
  var bbs=tpZm.loops.map(function(lp){
    var b=tpLoopBBox(lp); return {xMin:b.xMin,xMax:b.xMax,yMin:b.yMin,yMax:b.yMax};
  });
  var flags = (typeof detectIslandJS==='function')
    ? detectIslandJS(tpZm.loops, bbs)
    : tpZm.loops.map(function(){return false;});
  tpZm._islandFlags=flags; tpZm._islandFlagsFor=tpZm.loops;
  return flags;
}

// Vị trí vẽ SỐ THỨ TỰ của 1 loop. Với tấm có island, tách 2 số ra để click riêng:
//   - Loop CHA (chứa island): số nằm LỆCH TRÁI — giữa biên trái ngoài và biên trái island
//   - ISLAND: số ở tâm island
//   - Thường (không island): tâm bbox
function tpLoopBadgePos(loopIdx){
  var lp=tpZm.loops[loopIdx];
  var b=tpLoopBBox(lp);
  var cx=(b.xMin+b.xMax)/2, cy=(b.yMin+b.yMax)/2;
  if(!lp) return {x:cx,y:cy};
  var flags=tpIslandFlags();

  // Nếu loop này là ISLAND → tâm island (giữ nguyên tâm bbox của nó)
  if(flags[loopIdx]) return {x:cx,y:cy};

  // Nếu loop này là CHA của một island → lệch số sang trái, đặt giữa
  // biên trái ngoài (b.xMin) và biên trái của island gần nhất bên trong.
  var innerXMin=null;
  for(var j=0;j<tpZm.loops.length;j++){
    if(j===loopIdx || !flags[j]) continue;
    var ib=tpLoopBBox(tpZm.loops[j]);
    // island nằm gọn trong loop này?
    if(ib.xMin>b.xMin && ib.xMax<b.xMax && ib.yMin>b.yMin && ib.yMax<b.yMax){
      if(innerXMin===null || ib.xMin<innerXMin) innerXMin=ib.xMin;
    }
  }
  if(innerXMin!==null){
    // giữa biên trái ngoài và biên trái island, cùng tâm Y
    return {x:(b.xMin+innerXMin)/2, y:cy};
  }
  return {x:cx,y:cy};
}

// Lấy ID chi tiết của 1 loop (từ part_id của edge đầu, do scanner tách từ tên).
function tpLoopPartId(lp){
  if(!lp || !lp.length) return null;
  for(var i=0;i<lp.length;i++){
    if(lp[i].part_id!=null && lp[i].part_id!=='') return lp[i].part_id;
  }
  return null;
}

// Nhãn hiển thị: "[ID] - rộng×cao mm" (hoặc chỉ kích thước nếu không có ID)
function tpLoopLabel(lp){
  var s=tpLoopSize(lp);
  var pid=tpLoopPartId(lp);
  var size=s.w+'×'+s.h+' mm';
  return pid ? ('['+pid+'] - '+size) : size;
}

function tpUpdateOrderList(){
  var list=document.getElementById('tp-order-list');
  if(!list||!tpZm.loops) return;
  var pinned=tpZm.cutOrder||[];
  var html='';
  pinned.forEach(function(loopIdx,rank){
    var lp=tpZm.loops[loopIdx]; if(!lp) return;
    html+='<div class="tp-order-item pinned" onclick="tpTogglePin('+loopIdx+')">'
      +'<span class="tp-order-num">'+(rank+1)+'</span>'
      +'<span>'+tpLoopLabel(lp)+'</span></div>';
  });
  if(pinned.length>0 && tpZm.loops.length>pinned.length){
    html+='<div style="font-size:9px;color:var(--text2);padding:4px 2px;letter-spacing:.5px">TỰ ĐỘNG</div>';
  }
  var autoRank=pinned.length;
  var autoIdxs=[];
  tpZm.loops.forEach(function(lp,i){ if(pinned.indexOf(i)<0) autoIdxs.push(i); });
  tpSortAutoOrder(autoIdxs).forEach(function(i){
    var lp=tpZm.loops[i]; if(!lp) return;
    html+='<div class="tp-order-item auto" onclick="tpTogglePin('+i+')">'
      +'<span class="tp-order-num">'+(++autoRank)+'</span>'
      +'<span>'+tpLoopLabel(lp)+'</span></div>';
  });
  list.innerHTML=html;
}

function showOrderTooltip(loopIdx, cx, cy){
  var lp=tpZm.loops[loopIdx]; if(!lp) return;
  var s=tpLoopSize(lp);
  var pinned=tpZm.cutOrder||[];
  var rank=pinned.indexOf(loopIdx);
  var label = (rank>=0? 'Thứ tự '+(rank+1) : 'Chưa gán') + ' · ' + s.w+'×'+s.h+' mm';
  var tip=document.getElementById('tp-tooltip');
  if(!tip){ tip=document.createElement('div'); tip.id='tp-tooltip';
    tip.style.cssText='position:fixed;z-index:300;background:rgba(20,20,20,0.92);color:#fff;font-size:11px;padding:4px 8px;border-radius:4px;pointer-events:none;white-space:nowrap';
    document.body.appendChild(tip); }
  tip.textContent=label; tip.style.left=(cx+12)+'px'; tip.style.top=(cy+12)+'px'; tip.style.display='block';
}

// Nhãn thứ tự cắt cho từng loop theo finalOrder.
// Quy tắc:
//   - Loop nằm TRỰC TIẾP trong 1 island → thập phân của island đó (island 9 → 9.1, 9.2)
//   - Mọi loop khác (loop ngoài cùng, island, loop thường) → SỐ NGUYÊN theo thứ tự chạy
// Trả map: loopIdx → nhãn (string).
function tpBuildOrderLabels(finalOrder){
  var nest=tpNestInfo();
  // Loop i là island? (độ sâu lồng lẻ). depth = contain.
  function isIsland(i){ return (nest.depth[i] % 2) === 1; }
  // Loop i là con-trực-tiếp-của-island? parent tồn tại và parent là island.
  function childOfIsland(i){
    var p=nest.parent[i];
    return p!==i && isIsland(p);
  }

  var labels={};
  var intNo={};      // loopIdx → số nguyên (cho loop KHÔNG phải con-của-island)
  var nextInt=1;
  // Lần 1: gán SỐ NGUYÊN theo thứ tự chạy, BỎ QUA con-của-island (chúng lấy thập phân)
  finalOrder.forEach(function(loopIdx){
    if(childOfIsland(loopIdx)) return;      // con-của-island không chiếm số nguyên
    intNo[loopIdx]=nextInt++;
    labels[loopIdx]=String(intNo[loopIdx]);
  });
  // Lần 2: gán THẬP PHÂN cho con-của-island theo thứ tự chạy, dựa số nguyên của island cha
  var subCount={};   // islandIdx → đếm con đã gán
  finalOrder.forEach(function(loopIdx){
    if(!childOfIsland(loopIdx)) return;
    var isl=nest.parent[loopIdx];
    var islN=intNo[isl];                    // số nguyên của island cha (đã gán ở lần 1)
    subCount[isl]=(subCount[isl]||0)+1;
    labels[loopIdx]=(islN!=null?islN:'?')+'.'+subCount[isl];
  });
  return labels;
}


// contain[i] = số loop CÙNG chi tiết bao quanh loop i (độ sâu lồng).
// parent[i]  = loop bao trực tiếp (contain nhỏ hơn 1 bậc), hoặc i nếu là root.
// root[i]    = loop ngoài cùng (contain=0) của cụm chứa i.
// depth[i]   = contain[i] (alias, cho dễ đọc).
// Dùng group_id (như detectIslandJS) để KHÔNG nhầm 2 chi tiết khác nhau là lồng.
function tpNestInfo(){
  if(tpZm._nestInfo && tpZm._nestInfoFor===tpZm.loops) return tpZm._nestInfo;
  var loops=tpZm.loops||[];
  var bb=loops.map(function(lp){
    var xs=[],ys=[]; lp.forEach(function(v){xs.push(v.x1,v.x2);ys.push(v.y1,v.y2);});
    return {xmin:Math.min.apply(null,xs),xmax:Math.max.apply(null,xs),
            ymin:Math.min.apply(null,ys),ymax:Math.max.apply(null,ys)};
  });
  var gids=loops.map(function(lp){ return (lp&&lp[0]&&lp[0].group_id!=null)?lp[0].group_id:null; });

  // j bao quanh i? Chỉ xét bbox lồng — KHÔNG đòi cùng group_id, vì loop bên trong
  // island thường là CHI TIẾT RIÊNG (group khác) lọt trong lỗ. Độ sâu lồng (số loop
  // bao quanh) quyết định island(lẻ)/đặc(chẵn), không phụ thuộc chi tiết.
  function contains(j,i){
    if(j===i) return false;
    var a=bb[j], b=bb[i];
    // bbox j chứa HẲN bbox i (chặt hơn: có biên trong, tránh 2 loop trùng khít
    // do sai số bị coi là lồng nhau)
    return a.xmin<=b.xmin && a.xmax>=b.xmax && a.ymin<=b.ymin && a.ymax>=b.ymax &&
           (a.xmax-a.xmin)*(a.ymax-a.ymin) > (b.xmax-b.xmin)*(b.ymax-b.ymin) + 0.01;
  }

  var n=loops.length;
  var contain=new Array(n), parent=new Array(n), root=new Array(n);
  for(var i=0;i<n;i++){
    // đếm số loop bao quanh i
    var enclosers=[];
    for(var j=0;j<n;j++){ if(contains(j,i)) enclosers.push(j); }
    contain[i]=enclosers.length;
    // parent = encloser có bbox NHỎ nhất (bao sát nhất)
    var par=i, parArea=Infinity;
    enclosers.forEach(function(j){
      var a=bb[j], area=(a.xmax-a.xmin)*(a.ymax-a.ymin);
      if(area<parArea){ parArea=area; par=j; }
    });
    parent[i]=par;
  }
  // root: đi ngược parent tới loop contain=0
  for(var k=0;k<n;k++){
    var cur=k, guard=0;
    while(contain[cur]>0 && parent[cur]!==cur && guard++<64) cur=parent[cur];
    root[k]=cur;
  }
  var info={bb:bb, contain:contain, parent:parent, root:root, depth:contain};
  tpZm._nestInfo=info; tpZm._nestInfoFor=tpZm.loops;
  return info;
}


// trong cụm, loop LỒNG SÂU NHẤT chạy trước, loop ngoài cùng chạy cuối.
// Các cụm sắp trên tấm theo zone/side (dựa loop ngoài cùng = root).
// loopIdxs: các index chưa pin. Trả về mảng đã sắp.
function tpSortAutoOrder(loopIdxs){
  if(!tpZm.loops || !tpZm.sheet) return loopIdxs.slice();
  var sheetW = tpZm.sheet.width;
  var sheetH = tpZm.sheet.height;
  var smallTh = (typeof STG!=='undefined' && STG.small_threshold) ? STG.small_threshold : 300;
  var thBot = (typeof afvThreshBot!=='undefined') ? afvThreshBot : 300;
  var thTop = (typeof afvThreshTop!=='undefined') ? afvThreshTop : 300;

  var nest = tpNestInfo();   // {contain, parent, root, depth} theo tpZm.loops
  var bb = nest.bb;

  function zoneOf(pb){
    var w = pb.xmax - pb.xmin, h = pb.ymax - pb.ymin;
    var horiz = w > h;
    if(horiz && pb.ymax <= thBot)            return 'bottom';
    if(horiz && pb.ymin >= sheetH - thTop)   return 'top';
    return 'lr';
  }

  // Khóa sắp CỤM (theo root): group nhỏ/lớn + zone + side + pos — như logic cũ.
  function clusterKey(rootIdx){
    var pb=bb[rootIdx];
    var pcx=(pb.xmin+pb.xmax)/2, pcy=(pb.ymin+pb.ymax)/2;
    var pbw=pb.xmax-pb.xmin, pbh=pb.ymax-pb.ymin;
    var pIsSmall=(Math.min(pbw,pbh)<smallTh)?0:1;
    var z=zoneOf(pb);
    var zoneRank=(z==='bottom')?0:(z==='top')?1:2;
    var zonePos=(z==='bottom')?pcy:(z==='top')?-pcy:0;
    var side=pcx>sheetW/2?0:1;
    // Dùng X ĐẠI DIỆN của cột (gom theo tâm, dung sai COL_TOL) thay tâm thật, để các
    // chi tiết cùng cột hòa ở 'pos' rồi phân giải theo Y.
    var _colx = (typeof _colOf!=='undefined' && _colOf[rootIdx]!=null) ? _colX[_colOf[rootIdx]] : pcx;
    var pos=side===0?-_colx:_colx;
    // Vùng TRÁI/PHẢI: cùng cột X thì sắp theo Y GIẢM DẦN liên tục — từ trên xuống
    // giữa, rồi từ giữa xuống đáy (dao đi liền mạch, không nhảy vọt xuống đáy).
    var yHalf=0, ySort=0;
    if(z==='lr'){
      ySort = -pcy;   // Y cao trước → thấp dần
    }
    return [pIsSmall, zoneRank, zonePos, side, pos, yHalf, ySort];
  }

  // Chỉ sắp trong tập loopIdxs (chưa pin). Gom theo root.
  var inSet={}; loopIdxs.forEach(function(i){ inSet[i]=true; });
  var clusters={};   // rootIdx → [loop indices trong set]
  loopIdxs.forEach(function(i){
    var r=nest.root[i];
    (clusters[r]=clusters[r]||[]).push(i);
  });

  // Thứ tự các cụm theo clusterKey (dùng root làm đại diện)
  var roots=Object.keys(clusters).map(Number);

  // GOM CỘT theo TÂM X: chi tiết có tâm X gần nhau (≤ COL_TOL) coi CÙNG cột, dùng
  // chung một X đại diện → khi cùng cột sẽ hòa ở 'pos' và phân giải theo Y.
  var COL_TOL = 20;   // mm — tăng nếu chi tiết cùng cột lệch tâm nhiều; giảm nếu 2 cột gần nhau bị gộp nhầm
  var _cxOf = function(r){ return (bb[r].xmin + bb[r].xmax) / 2; };
  var _byX = roots.slice().sort(function(a,b){ return _cxOf(a) - _cxOf(b); });
  var _colOf = {}, _colX = {}, _cid = 0, _prevX = null;
  _byX.forEach(function(r){
    var x = _cxOf(r);
    if(_prevX === null || Math.abs(x - _prevX) > COL_TOL){ _cid++; _colX[_cid] = x; }
    _colOf[r] = _cid; _prevX = x;
  });

  roots.sort(function(a,b){
    var ka=clusterKey(a), kb=clusterKey(b);
    for(var i=0;i<ka.length;i++){ if(ka[i]!==kb[i]) return ka[i]-kb[i]; }
    return a-b;
  });

  // Trong mỗi cụm: depth GIẢM DẦN (sâu nhất trước), cùng depth giữ thứ tự index.
  var out=[];
  roots.forEach(function(r){
    var members=clusters[r].slice();
    members.sort(function(a,b){
      if(nest.depth[b]!==nest.depth[a]) return nest.depth[b]-nest.depth[a]; // sâu trước
      return a-b;
    });
    out=out.concat(members);
  });
  return out;
}

function redrawToolpath(options){
  options=options||{};
  const hideToolpath=options.hideToolpath===true;
  const cv=document.getElementById('tp-canvas');
  const ctx=cv.getContext('2d');
  const dpr=window.devicePixelRatio||1;
  const s=tpZm.sheet;
  const PAD=20;
  const baseSc=Math.min((tpZm.cw-PAD*2)/s.width,(tpZm.ch-PAD*2)/s.height);
  const sc=baseSc*tpZm.scale;
  const tx=x=>(x*sc+PAD+tpZm.ox)*dpr;
  const ty=y=>(tpZm.ch-(y*sc+PAD)+tpZm.oy)*dpr;

  ctx.clearRect(0,0,cv.width,cv.height);
  // Nền trắng
  ctx.fillStyle='#fafafa'; ctx.fillRect(0,0,cv.width,cv.height);

  // Vẽ vectors gốc làm nền — rõ hơn để phân biệt với toolpath
  const layerGroups={};
  const _shName = s.name;
  s.display.forEach(v=>{
    if(v.is_drill_center)return;
    // Layer hiệu lực sau override (chỉnh sửa)
    const effLayer = (typeof editEffectiveLayer==='function') ? editEffectiveLayer(v, _shName) : v.layer;
    // Ở chế độ chỉnh sửa: bỏ qua layer bị ẩn
    if(detailMode==='edit' && typeof editHiddenLayers!=='undefined' && editHiddenLayers && editHiddenLayers.has(effLayer)) return;
    if(!layerGroups[effLayer])layerGroups[effLayer]=[];
    layerGroups[effLayer].push(v);
  });
  Object.entries(layerGroups).forEach(([layer,vecs])=>{
    // Trong chế độ mô phỏng, checkbox layer điều khiển cả vector gốc lẫn
    // toolpath. Các chế độ Thứ tự cắt/Chỉnh sửa không bị ảnh hưởng.
    if(detailMode==='toolpath' && typeof simState!=='undefined' &&
       simState.availableLayers && simState.availableLayers.has(layer) &&
       simState.enabledLayers && !simState.enabledLayers.has(layer)) return;
    const col=getLayerColor(layer);
    ctx.strokeStyle=col+'99'; // 60% opacity
    ctx.lineWidth=dpr*1.2;
    ctx.setLineDash([]);
    vecs.forEach(v=>{
      ctx.beginPath();ctx.moveTo(tx(v.x1),ty(v.y1));ctx.lineTo(tx(v.x2),ty(v.y2));ctx.stroke();
    });
  });

  // Vẽ điểm khoan (drill center) ở chế độ order/edit để thấy — toolpath mode tự vẽ riêng
  if(detailMode!=='toolpath'){
    s.display.forEach(v=>{
      if(!v.is_drill_center) return;
      const effLayer = (typeof editEffectiveLayer==='function') ? editEffectiveLayer(v, s.name) : v.layer;
      if(detailMode==='edit' && editHiddenLayers && editHiddenLayers.has(effLayer)) return;
      const col=getLayerColor(effLayer);
      const cx=(v.x1+v.x2)/2, cy=(v.y1+v.y2)/2;
      const r=Math.max((v.diameter||5)/2*sc*dpr, 1*dpr);
      ctx.beginPath(); ctx.arc(tx(cx),ty(cy),r,0,Math.PI*2);
      ctx.strokeStyle=col+'99'; ctx.lineWidth=dpr*1.2; ctx.setLineDash([]); ctx.stroke();
    });
  }

  // Vẽ toolpath theo từng tool — CHỈ ở chế độ xem đường dao
  if(!hideToolpath) tpRenderedPaths = [];
  if(detailMode==='toolpath' && !hideToolpath){
    TOOLS.forEach(tool=>{
      if(typeof simState!=='undefined' && simState.availableLayers &&
         simState.availableLayers.has(tool.layer) && simState.enabledLayers &&
         !simState.enabledLayers.has(tool.layer)) return;
      // Lọc theo layer HIỆU LỰC (sau override chỉnh sửa), không phải layer gốc
      const vecs=s.display.filter(v=>{
        const eff=(typeof editEffectiveLayer==='function')?editEffectiveLayer(v, s.name):v.layer;
        return eff===tool.layer;
      });
      if(!vecs.length)return;
      const layerNorm = (tool.layer||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(layerNorm==='ABFPHAY14'){
        console.log('[N2G DEBUG] dispatcher ABF_PHAY_14', {
          type: tool.type,
          strategy: tool.strategy,
          bit_type: tool.bit_type,
          direction: tool.direction,
          vector_count: vecs.length,
          sheet: s.name
        });
      }
      if(tool.type==='drill') drawToolpathDrill(ctx,vecs,tool,tx,ty,sc,dpr);
      else if(tool.type==='pocket') drawToolpathPocket(ctx,vecs,tool,tx,ty,sc,dpr);
      else if(layerNorm==='ABFMARKSQUARE') drawToolpathMark(ctx,vecs,tool,tx,ty,sc,dpr);
      else if(tool.bit_type==='vbit' && tool.strategy==='cut_in') drawToolpathVbit(ctx,vecs,tool,tx,ty,sc,dpr);
      else drawToolpathProfile(ctx,vecs,tool,tx,ty,sc,dpr);
    });
  }

  // Chế độ THỨ TỰ CẮT: vẽ số thứ tự trên mỗi tấm (phân cấp N / N.k cho cụm lồng)
  if(detailMode==='order' && tpZm.loops){
    const pinned=tpZm.cutOrder||[];
    const finalOrder=tpComputeFinalOrder();
    const labels=tpBuildOrderLabels(finalOrder);
    finalOrder.forEach((loopIdx,rank)=>{
      const lp=tpZm.loops[loopIdx]; if(!lp) return;
      const bp=tpLoopBadgePos(loopIdx);
      const isPinned=pinned.indexOf(loopIdx)>=0;
      const txt=labels[loopIdx]||String(rank+1);
      const isSub=txt.indexOf('.')>=0;                 // con (N.k) → badge nhỏ hơn
      const px=tx(bp.x), py=ty(bp.y);
      const rad=(isSub?9:11)*dpr;
      ctx.beginPath(); ctx.arc(px,py,rad,0,Math.PI*2);
      ctx.fillStyle = isPinned ? 'rgba(40,200,100,0.9)'
                    : isSub    ? 'rgba(196,110,63,0.7)'   // con: cam nhạt để phân biệt
                    :            'rgba(123,63,196,0.55)';  // ngoài cùng/đơn: tím
      ctx.fill();
      ctx.fillStyle='#fff'; ctx.font=((isSub?9:11)*dpr)+'px sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(txt, px, py);
    });
    ctx.textAlign='start'; ctx.textBaseline='alphabetic';
  }
  // Chế độ CHỈNH SỬA: highlight loop đang chọn (nét đứt, giữ màu)
  if(detailMode==='edit' && typeof editDrawSelection==='function'){
    editDrawSelection(ctx, tx, ty, dpr);
  }
  // Chế độ XEM ĐƯỜNG DAO: vẽ 4 góc chọn điểm xuống dao (nếu đang chọn chi tiết)
  if(detailMode==='toolpath' && !hideToolpath && typeof entryDrawCorners==='function'){
    entryDrawCorners(ctx, tx, ty, dpr);
  }
}

// Thứ tự cắt cuối cùng của cuttinglines (tấm) trong sheet hiện tại:
// pinned (người dùng click) trước, rồi các tấm còn lại sắp tự động.
// Dùng chung cho cả hiển thị số thứ tự VÀ simulator animation.
function tpComputeFinalOrder(){
  if(!tpZm.loops) return [];
  const pinned=tpZm.cutOrder||[];
  const autoIdxs=[];
  tpZm.loops.forEach((lp,i)=>{ if(pinned.indexOf(i)<0) autoIdxs.push(i); });
  return pinned.concat(tpSortAutoOrder(autoIdxs));
}


// ESC đóng toolpath modal
document.addEventListener("keydown",e=>{
  if(e.key==="Escape") closeToolpathModal();
});
