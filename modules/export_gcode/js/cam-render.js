// ── cam-render.js — Render sheet preview, sidebar, focus layer ──
// Load SAU cam-geometry.js
// Ghi chú: Zoom modal cũ (openZoomModal/redrawZoom) + drawCutOrder đã BỎ —
// chức năng thứ tự cắt/xem đường dao nay nằm trong modal "Chi tiết" (tp-dispatch.js).
// Card preview KHÔNG còn vẽ số thứ tự cắt (chỉ hiện khi mở modal Chi tiết).

function renderLegend(container, layers) {
  container.innerHTML = '<span style="font-size:9px;color:var(--text3);letter-spacing:1px;text-transform:uppercase;margin-right:6px;flex-shrink:0">Layers</span>';
  layers.forEach(l => {
    const hidden = hiddenLayers.has(l);
    const color  = getLayerColor(l);
    const chip   = document.createElement('div');
    chip.dataset.layer = l;
    chip.title = hidden ? 'Click để hiện' : 'Click để ẩn';
    chip.style.cssText = `
      display:inline-flex;align-items:center;gap:5px;
      padding:3px 10px 3px 7px;border-radius:20px;
      border:1px solid ${hidden ? 'var(--border2)' : color+'55'};
      background:${hidden ? 'var(--surface2)' : color+'15'};
      font-size:10px;font-family:var(--mono);
      color:${hidden ? 'var(--text3)' : color};
      cursor:pointer;user-select:none;
      transition:all .15s;opacity:${hidden ? '0.5' : '1'};
    `;
    chip.innerHTML = `
      <div style="width:8px;height:8px;border-radius:50%;
        background:${hidden ? 'var(--border2)' : color};
        flex-shrink:0;transition:background .15s"></div>
      ${hidden ? '<s style="opacity:.5">'+l+'</s>' : l}
      <span style="font-size:9px;margin-left:2px;opacity:.6">${hidden?'●○':'●'}</span>
    `;
    chip.addEventListener('click', () => toggleLayer(l));
    chip.addEventListener('mouseenter', () => {
      if(!hiddenLayers.has(l)) chip.style.background = color+'28';
    });
    chip.addEventListener('mouseleave', () => {
      chip.style.background = hiddenLayers.has(l) ? 'var(--surface2)' : color+'15';
    });
    container.appendChild(chip);
  });
}

function toggleLayerVisibility(layerName, item){
  if(hiddenLayers.has(layerName)){
    hiddenLayers.delete(layerName);
    item.classList.remove('hidden-layer');
    item.querySelector('.layer-eye').textContent='●';
  } else {
    hiddenLayers.add(layerName);
    item.classList.add('hidden-layer');
    item.querySelector('.layer-eye').textContent='○';
  }
  redrawAllSheets();
  const count=hiddenLayers.size;
  setStatus(count>0?'warn':'ok', count>0?`Đang ẩn ${count} layer`:'');
}

function toggleLayer(layerName) {
  if (hiddenLayers.has(layerName)) {
    hiddenLayers.delete(layerName);
  } else {
    hiddenLayers.add(layerName);
  }
  redrawAllSheets();
  // Sync sidebar
  document.querySelectorAll('.layer-item').forEach(item=>{
    if(item.dataset.layer===layerName){
      item.classList.toggle('hidden-layer', hiddenLayers.has(layerName));
      item.querySelector('.layer-eye').textContent=hiddenLayers.has(layerName)?'○':'●';
    }
  });
  const count=hiddenLayers.size;
  setStatus('ok', count > 0 ? `Đang ẩn ${count} layer — click lại để hiện` : `Hiện tất cả layers`);
}

function redrawAllSheets() {
  // Lazy-aware: chỉ vẽ lại canvas ĐÃ hiện (drawn=1). Canvas chưa hiện thì đánh dấu
  // drawn=0 + cho observer theo dõi lại, để vẽ mới khi cuộn tới (đúng trạng thái layer).
  const canvases = document.querySelectorAll('#preview-content canvas[data-sheet-idx]');
  canvases.forEach((cv) => {
    const si = parseInt(cv.dataset.sheetIdx, 10);
    if (isNaN(si) || !SHEETS[si]) return;
    if (cv.dataset.drawn === '1') {
      drawSheet(cv, SHEETS[si], cv.width, cv.height);   // đã hiện → vẽ lại ngay
    } else {
      cv.dataset.drawn = '0';                            // chưa hiện → để lazy vẽ sau
      if (_lazyObserver) { try { _lazyObserver.observe(cv); } catch(e){} }
    }
  });
}

// Update badge ? trong sidebar khi TOOLS thay đổi mà không reload toàn bộ
function updateSidebarLayerStatus(){
  document.querySelectorAll('.layer-item').forEach(function(item){
    var l=item.dataset.layer;
    if(!l) return;
    var hasTool=SYSTEM_IGNORED_LAYERS.has(l)||TOOLS.some(function(t){return t.layer===l;});
    if(hasTool){
      item.classList.remove('layer-no-tool');
      var warn=item.querySelector('.layer-warn');
      if(warn) warn.remove();
    } else {
      item.classList.add('layer-no-tool');
      if(!item.querySelector('.layer-warn')){
        var eye=item.querySelector('.layer-eye');
        var badge=document.createElement('span');
        badge.className='layer-warn';
        badge.title='Chưa được gán dao';
        badge.textContent='?';
        if(eye) item.insertBefore(badge,eye);
        else item.appendChild(badge);
      }
    }
  });
}

function renderSheets(){
  // Reset color map để assign màu nhất quán
  Object.keys(layerColorMap).forEach(k=>delete layerColorMap[k]);
  colorIdx=0;

  // Pre-assign màu theo thứ tự layer xuất hiện (nhất quán giữa các sheet)
  // Lấy tất cả layer từ display vectors + ALL_LAYERS (từ Ruby)
  const allLayers=[];
  SHEETS.forEach(function(s){ s.display.forEach(function(v){
    if(!allLayers.includes(v.layer)) allLayers.push(v.layer);
  }); });
  // Thêm layer từ ALL_LAYERS chưa có trong display (vd: layer chỉ có drill)
  (ALL_LAYERS||[]).forEach(function(l){
    if(!allLayers.includes(l)) allLayers.push(l);
  });
  allLayers.forEach(l=>getLayerColor(l));

  // Render sidebar layers
  const sidebar=document.getElementById('preview-sidebar');
  sidebar.innerHTML=`<div id="preview-sidebar-title">Layers</div>`;
  const cutLayers  = allLayers.filter(l => !SYSTEM_IGNORED_LAYERS.has(l));
  const dispLayers = allLayers.filter(l =>  SYSTEM_IGNORED_LAYERS.has(l));

  const renderLayerItem = (l) => {
    const color   = getLayerColor(l);
    const ign     = IGNORED_LAYERS.has(l);
    const hasTool = SYSTEM_IGNORED_LAYERS.has(l) || TOOLS.some(function(t){ return t.layer === l; });
    const item    = document.createElement('div');
    item.className = 'layer-item' + (ign ? ' hidden-layer' : '') + (hasTool ? '' : ' layer-no-tool');
    item.dataset.layer = l;
    item.innerHTML = `<div class="layer-dot" style="background:${color}"></div>
      <span class="layer-name" title="${l}">${l}</span>
      ${hasTool ? '' : '<span class="layer-warn" title="Chưa được gán dao">?</span>'}
      <span class="layer-focus" title="Tìm vị trí trên tấm" onclick="event.stopPropagation();focusLayer('${l.replace(/'/g,"\\'")}')"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></svg></span>
      <span class="layer-eye">${ign ? '○' : '●'}</span>`;
    item.onclick = () => toggleLayerVisibility(l, item);
    sidebar.appendChild(item);
  };

  cutLayers.forEach(renderLayerItem);

  if(dispLayers.length > 0){
    const sep = document.createElement('div');
    sep.style.cssText = 'padding:6px 14px 3px;font-size:9px;font-weight:600;color:var(--text3);letter-spacing:1px;text-transform:uppercase;border-top:1px solid var(--border);margin-top:6px';
    sep.textContent = 'Display only';
    sidebar.appendChild(sep);
    dispLayers.forEach(renderLayerItem);
  }

  // Render sheet cards vào content — giữ lại banner
  const main=document.getElementById('preview-content');
  // Xóa chỉ các sheet cards, không xóa banner
  Array.from(main.children).forEach(el=>{
    if(el.id !== 'no-nesting-banner') el.remove();
  });

  SHEETS.forEach((s,si)=>{
    const dc=s.display.filter(v=>v.is_drill_center).length;
    const pc=s.display.filter(v=>!v.is_drill_center).length;
    const card=document.createElement('div');card.className='sheet-card';
    card.style.cursor='pointer'; card.title='Click để xem chi tiết';
    card.innerHTML=`<div class="sheet-head">
      <span class="sheet-name">${s.name}</span>
      <span class="sheet-dim">${Math.round(s.width)} × ${Math.round(s.height)} mm</span>
    </div>`;
    const CW=560,CH=Math.round(CW*(s.height>0?s.height/s.width:0.6));
    const dpr=Math.max(1,window.devicePixelRatio||1);
    const cv=document.createElement('canvas');
    cv.width=Math.round(CW*dpr);cv.height=Math.round(CH*dpr);
    cv.dataset.logicalWidth=CW;cv.dataset.logicalHeight=CH;cv.dataset.dpr=dpr;
    cv.dataset.sheetIdx=si;      // để vẽ on-demand theo index
    cv.dataset.drawn='0';        // chưa vẽ
    card.appendChild(cv);
    const ft=document.createElement('div');ft.className='sheet-footer';
    ft.innerHTML=`<button class="tbtn tbtn-o" style="width:100%;justify-content:center;font-size:11px;padding:5px 0" onclick="event.stopPropagation();openToolpathModal(SHEETS[${si}])">⚙ Chi tiết</button>`;
    card.appendChild(ft);main.appendChild(card);
    card.addEventListener('click',()=>openToolpathModal(s));
    // KHÔNG vẽ ngay — để lazy render lo (vẽ khi card lọt vào viewport).
  });

  // ── Lazy render: chỉ vẽ canvas khi card cuộn vào tầm nhìn ──────────────────
  // Với hàng trăm sheet, vẽ tất cả cùng lúc gây treo trên máy yếu. Thay vào đó
  // chỉ vẽ khi cần. Fallback: nếu không có IntersectionObserver → vẽ hết như cũ.
  _setupLazyRender();
}


// Lưu custom cut order per sheet name — dùng chung bởi tp-dispatch, export, history.
var CUSTOM_CUT_ORDER = {};

// ── Lazy render helpers ──────────────────────────────────────────────────────
var _lazyObserver = null;

// Vẽ 1 canvas nếu chưa vẽ (idempotent). Trả true nếu vừa vẽ.
function _drawCanvasIfNeeded(cv){
  if(!cv || cv.dataset.drawn==='1') return false;
  var si = parseInt(cv.dataset.sheetIdx, 10);
  if(isNaN(si) || !SHEETS[si]) return false;
  drawSheet(cv, SHEETS[si], cv.width, cv.height);
  cv.dataset.drawn='1';
  return true;
}

// Đảm bảo canvas của sheet index si đã được vẽ (dùng cho focusLayer on-demand).
function _ensureSheetDrawn(si){
  var cv = document.querySelector('#preview-content canvas[data-sheet-idx="'+si+'"]');
  if(cv) _drawCanvasIfNeeded(cv);
}

// Thiết lập lazy render cho tất cả canvas hiện có.
function _setupLazyRender(){
  // dọn observer cũ nếu render lại danh sách
  if(_lazyObserver){ try{ _lazyObserver.disconnect(); }catch(e){} _lazyObserver=null; }
  var canvases = document.querySelectorAll('#preview-content canvas[data-sheet-idx]');

  // Fallback: không có IntersectionObserver (trình duyệt rất cũ) → vẽ hết như cũ.
  if(typeof IntersectionObserver==='undefined'){
    canvases.forEach(function(cv){ _drawCanvasIfNeeded(cv); });
    return;
  }

  // rootMargin 400px: vẽ trước 1 chút khi card sắp vào tầm nhìn → cuộn mượt, ít thấy trống.
  _lazyObserver = new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(en.isIntersecting){
        _drawCanvasIfNeeded(en.target);
        _lazyObserver.unobserve(en.target);   // vẽ xong thì thôi theo dõi
      }
    });
  }, { root: document.getElementById('preview-content'), rootMargin: '400px 0px', threshold: 0.01 });

  canvases.forEach(function(cv){ _lazyObserver.observe(cv); });
}


function drawSheet(cv,s,CW,CH){
  const ctx=cv.getContext('2d');
  const dpr=Math.max(1,+(cv.dataset.dpr||window.devicePixelRatio||1));
  CW=+(cv.dataset.logicalWidth||CW||cv.clientWidth||cv.width/dpr);
  CH=+(cv.dataset.logicalHeight||CH||cv.clientHeight||cv.height/dpr);
  const backingW=Math.round(CW*dpr),backingH=Math.round(CH*dpr);
  if(cv.width!==backingW) cv.width=backingW;
  if(cv.height!==backingH) cv.height=backingH;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,CW,CH);
  // Keep tiny square tenons visually square at fit-to-card zoom. The backing
  // canvas is HiDPI; miter/butt avoids rounded joins adding another artefact.
  ctx.lineJoin='miter';
  ctx.lineCap='butt';
  const PAD=14;
  const sc=Math.min((CW-PAD*2)/s.width,(CH-PAD*2)/s.height);
  const tx=x=>x*sc+PAD, ty=y=>CH-(y*sc+PAD);

  // Nền xám giống ABF
  ctx.fillStyle='#d0d0cc';
  ctx.fillRect(0,0,CW,CH);

  // Gom vectors theo layer, dedupe edges trùng (do component lồng nhau)
  const byLayer={};
  const drillSeen={};
  const drillByLayer={};
  s.display.forEach(v=>{
    if(v.is_drill_center){
      const dk=`${v.layer},${v.x1.toFixed(1)},${v.y1.toFixed(1)}`;
      if(!drillSeen[dk]){
        drillSeen[dk]=true;
        (drillByLayer[v.layer]=drillByLayer[v.layer]||[]).push(v);
      }
      return;
    }
    // Dedupe edge: key theo tọa độ làm tròn
    const k=`${Math.round(v.x1)},${Math.round(v.y1)},${Math.round(v.x2)},${Math.round(v.y2)}`;
    const k2=`${Math.round(v.x2)},${Math.round(v.y2)},${Math.round(v.x1)},${Math.round(v.y1)}`;
    if(!byLayer[v.layer]) byLayer[v.layer]={seen:new Set(),vecs:[]};
    if(typeof byLayer[v.layer]==='object'&&byLayer[v.layer].seen){
      if(!byLayer[v.layer].seen.has(k)&&!byLayer[v.layer].seen.has(k2)){
        byLayer[v.layer].seen.add(k);
        byLayer[v.layer].vecs.push(v);
      }
    }
  });
  // Normalize: drill layers là array, edge layers dùng .vecs
  const getVecs = (l) => Array.isArray(byLayer[l]) ? byLayer[l] : ((byLayer[l]||{}).vecs||[]);

  const isCutting = l => l.toLowerCase().includes('cutting');
  const isSheetBorder = l => l.toLowerCase().includes('sheetborder');
  const isLabel = l => l.toLowerCase().includes('label');
  const isDrill = l => {
    if(drillByLayer[l] && drillByLayer[l].length>0) return true;
    const v=getVecs(l); return v.length>0 && v[0].is_drill_center;
  };

  // Phân loại layers theo thứ tự vẽ
  // Gộp cả layer chỉ-có-drill-center (nằm trong drillByLayer, không có trong byLayer)
  const layers = Array.from(new Set([...Object.keys(byLayer), ...Object.keys(drillByLayer)]));
  // getVecs cho drill-only layer: trả mảng drill center
  const getVecsAll = (l) => {
    if(Array.isArray(byLayer[l])) return byLayer[l];
    if((byLayer[l]||{}).vecs) return byLayer[l].vecs;
    if(drillByLayer[l]) return drillByLayer[l];
    return [];
  };
  const borderLayers  = layers.filter(isSheetBorder);
  const cuttingLayers = layers.filter(l=>isCutting(l)&&!hiddenLayers.has(l));
  const drillLayers   = layers.filter(l=>isDrill(l)&&!hiddenLayers.has(l));
  const labelLayers   = layers.filter(l=>isLabel(l)&&!hiddenLayers.has(l));
  const otherLayers   = layers.filter(l=>!isSheetBorder(l)&&!isCutting(l)&&!isDrill(l)&&!isLabel(l)&&!hiddenLayers.has(l));

  // 1. SheetBorder: fill xám nhạt = tấm ván
  borderLayers.forEach(l=>{
    const vecs=getVecs(l);
    const poly=buildPolygon(vecs,tx,ty);
    if(poly){
      ctx.beginPath();ctx.moveTo(poly[0][0],poly[0][1]);
      poly.slice(1).forEach(p=>ctx.lineTo(p[0],p[1]));
      ctx.closePath();
      ctx.fillStyle='#e4e4e0';ctx.fill();
      ctx.strokeStyle='#a8a8a0';ctx.lineWidth=0.8;ctx.stroke();
    } else {
      // An incomplete border must not be force-closed with an invented
      // diagonal. Preserve the source geometry by drawing its edges directly.
      ctx.strokeStyle='#a8a8a0';ctx.lineWidth=0.8;
      vecs.forEach(v=>{
        ctx.beginPath();ctx.moveTo(tx(v.x1),ty(v.y1));
        ctx.lineTo(tx(v.x2),ty(v.y2));ctx.stroke();
      });
    }
  });

  // 2. CuttingLines: fill trắng cho từng tấm con (giống ABF)
  // Gom theo closed polygon riêng biệt
  cuttingLayers.forEach(l=>{
    const vecs=getVecs(l);
    const color=getLayerColor(l);
    // Thử fill polygon — nếu thành công tấm con sẽ nổi lên nền trắng
    const groups=buildLoopsJS(vecs);
    groups.forEach(group=>{
      // Lấy 1 nhóm edges liên kết
      if(group.length>=3){
        const poly=buildPolygon(group,tx,ty);
        if(poly&&poly.length>=3){
          ctx.beginPath();ctx.moveTo(poly[0][0],poly[0][1]);
          poly.slice(1).forEach(p=>ctx.lineTo(p[0],p[1]));
          ctx.closePath();
          ctx.fillStyle='#f0f0ec';ctx.fill();  // trắng ấm — tấm con nổi lên
          ctx.strokeStyle=color;ctx.lineWidth=1.1;ctx.stroke();
        } else {
          // Không tạo được polygon → vẽ từng edge
          ctx.strokeStyle=color;ctx.lineWidth=1.1;
          group.forEach(v=>{ctx.beginPath();ctx.moveTo(tx(v.x1),ty(v.y1));ctx.lineTo(tx(v.x2),ty(v.y2));ctx.stroke()});
        }
      }
    });
  });

  // 3. Other layers (edgeBanding, ranhHau, MONG...) — mỗi layer 1 màu
  otherLayers.forEach(l=>{
    const vecs=getVecs(l);
    const color=getLayerColor(l);
    ctx.strokeStyle=color;ctx.lineWidth=0.9;ctx.setLineDash([]);
    vecs.forEach(v=>{ctx.beginPath();ctx.moveTo(tx(v.x1),ty(v.y1));ctx.lineTo(tx(v.x2),ty(v.y2));ctx.stroke()});
  });

  // 4. Label — mờ nhẹ để không rối mắt nhưng vẫn đọc được
  labelLayers.forEach(l=>{
    const vecs=getVecs(l);
    ctx.save();ctx.globalAlpha=0.45;
    ctx.strokeStyle='#606060';ctx.lineWidth=0.6;ctx.setLineDash([]);
    vecs.forEach(v=>{ctx.beginPath();ctx.moveTo(tx(v.x1),ty(v.y1));ctx.lineTo(tx(v.x2),ty(v.y2));ctx.stroke()});
    ctx.setLineDash([]);ctx.restore();
  });

  // 5. Drill centers — vẽ cuối cùng, nổi trên tất cả
  const drawnDrills=new Set();
  drillLayers.forEach(l=>{
    const vecs=getVecsAll(l);
    const color=getLayerColor(l);
    const rReal=((vecs[0]||{}).diameter||6)*sc/2;
    const r=Math.max(2.5,Math.min(rReal,7));
    vecs.forEach(v=>{
      const cx=tx(v.x1),cy=ty(v.y1);
      const key=`${Math.round(cx)},${Math.round(cy)}`;
      if(drawnDrills.has(key))return; drawnDrills.add(key);
      ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);
      ctx.fillStyle='rgba(255,255,255,0.85)';ctx.fill();
      ctx.strokeStyle=color;ctx.lineWidth=0.9;ctx.stroke();
      const cr=Math.min(r*0.5,3);
      ctx.lineWidth=0.65;
      ctx.beginPath();ctx.moveTo(cx-cr,cy);ctx.lineTo(cx+cr,cy);ctx.stroke();
      ctx.beginPath();ctx.moveTo(cx,cy-cr);ctx.lineTo(cx,cy+cr);ctx.stroke();
    });
  });

  // Ghi chú: KHÔNG vẽ số thứ tự cắt trên card preview nữa —
  // số chỉ hiện khi mở modal "Chi tiết" của từng tấm (tp-dispatch.js).
}

// ── Focus layer: tìm vị trí vector của 1 layer trên TẤT CẢ card và khoanh khung pulse nhẹ ──
function focusLayer(layerName){
  // Gom tất cả sheet (card) chứa vector của layer này
  var hits = [];
  for(var si=0; si<SHEETS.length; si++){
    var v = SHEETS[si].display.filter(function(d){ return d.layer===layerName; });
    if(v.length) hits.push({ idx:si, vecs:v });
  }
  if(!hits.length){
    setStatus('warn', 'Layer "'+layerName+'" không có vector trên tấm nào');
    return;
  }

  // Nếu layer đang ẩn → hiện tạm để nhìn thấy
  if(hiddenLayers.has(layerName)){
    hiddenLayers.delete(layerName);
    document.querySelectorAll('.layer-item').forEach(function(item){
      if(item.dataset.layer===layerName){
        item.classList.remove('hidden-layer');
        var eye=item.querySelector('.layer-eye'); if(eye) eye.textContent='●';
      }
    });
    redrawAllSheets();
  }

  var cards = document.querySelectorAll('#preview-content .sheet-card');

  // Ép vẽ canvas của các card mục tiêu TRƯỚC (nếu lazy chưa vẽ tới) — để khung
  // focus không nằm trên canvas trống.
  hits.forEach(function(hit){ _ensureSheetDrawn(hit.idx); });

  // Vẽ khung trên từng card có chứa layer
  hits.forEach(function(hit, k){
    if(hit.idx >= cards.length) return;
    drawFocusBox(cards[hit.idx], SHEETS[hit.idx], hit.vecs, layerName);
  });

  // Cuộn đến card đầu tiên
  if(hits[0].idx < cards.length){
    cards[hits[0].idx].scrollIntoView({behavior:'smooth', block:'center'});
  }
}

// Vẽ 1 khung focus (pulse-ring nhẹ) quanh bbox vector layer trên 1 card
function drawFocusBox(card, s, vecs, layerName){
  var cv = card.querySelector('canvas');
  if(!cv) return;

  // bbox model
  var xs=[], ys=[];
  vecs.forEach(function(d){ xs.push(d.x1,d.x2); ys.push(d.y1,d.y2); });
  var xMin=Math.min.apply(null,xs), xMax=Math.max.apply(null,xs);
  var yMin=Math.min.apply(null,ys), yMax=Math.max.apply(null,ys);

  // transform giống drawSheet
  var dpr=Math.max(1,+(cv.dataset.dpr||window.devicePixelRatio||1));
  var CW=+(cv.dataset.logicalWidth||cv.width/dpr);
  var CH=+(cv.dataset.logicalHeight||cv.height/dpr), PAD=14;
  var sc=Math.min((CW-PAD*2)/s.width,(CH-PAD*2)/s.height);
  var tx=function(x){return x*sc+PAD;};
  var ty=function(y){return CH-(y*sc+PAD);};

  var rect=cv.getBoundingClientRect();
  var scaleX=rect.width/CW, scaleY=rect.height/CH;

  var pxMin=tx(xMin)*scaleX, pxMax=tx(xMax)*scaleX;
  var pyTop=ty(yMax)*scaleY, pyBot=ty(yMin)*scaleY;

  var padPx=12;
  var boxL=Math.min(pxMin,pxMax)-padPx;
  var boxT=Math.min(pyTop,pyBot)-padPx;
  var boxW=Math.abs(pxMax-pxMin)+padPx*2;
  var boxH=Math.abs(pyBot-pyTop)+padPx*2;
  var MIN=36;
  if(boxW<MIN){ boxL-=(MIN-boxW)/2; boxW=MIN; }
  if(boxH<MIN){ boxT-=(MIN-boxH)/2; boxH=MIN; }

  var prev=card.querySelector('.layer-focus-box');
  if(prev) prev.remove();
  if(window.getComputedStyle(card).position==='static') card.style.position='relative';

  var cvT=cv.offsetTop, cvL=cv.offsetLeft;

  // Khung tĩnh, bo tròn, màu accent — fade-in rồi fade-out êm
  var box=document.createElement('div');
  box.className='layer-focus-box';
  box.style.cssText=
    'position:absolute;pointer-events:none;z-index:50;'+
    'left:'+(cvL+boxL)+'px;top:'+(cvT+boxT)+'px;'+
    'width:'+boxW+'px;height:'+boxH+'px;'+
    'border:2px solid var(--accent,#2563a8);border-radius:6px;'+
    'background:rgba(37,99,168,0.06);'+
    'animation:layerFocusFade 2.8s ease-out forwards;';

  // Pulse-ring: 1 lớp ring lan ra rồi mờ (kiểu radar), nhẹ nhàng
  var ring=document.createElement('div');
  ring.style.cssText=
    'position:absolute;inset:-2px;border-radius:6px;'+
    'border:2px solid var(--accent,#2563a8);'+
    'animation:layerFocusPulse 1.4s ease-out 2;';
  box.appendChild(ring);

  // Label tên layer — nhỏ, bo tròn, màu accent
  var lbl=document.createElement('div');
  lbl.style.cssText=
    'position:absolute;left:0;top:-20px;white-space:nowrap;'+
    'background:var(--accent,#2563a8);color:#fff;font-size:10px;font-weight:600;'+
    'padding:1px 7px;border-radius:10px;font-family:var(--sans,sans-serif);'+
    'opacity:0.95';
  lbl.textContent=layerName;
  box.appendChild(lbl);

  card.appendChild(box);
  setTimeout(function(){ if(box && box.parentNode) box.remove(); }, 2900);
}

// Inject keyframes 1 lần
(function(){
  if(document.getElementById('layer-focus-style')) return;
  var st=document.createElement('style');
  st.id='layer-focus-style';
  st.textContent=
    '@keyframes layerFocusFade{0%{opacity:0}12%{opacity:1}75%{opacity:1}100%{opacity:0}}'+
    '@keyframes layerFocusPulse{0%{transform:scale(1);opacity:0.7}100%{transform:scale(1.18);opacity:0}}'+
    '.layer-focus{cursor:pointer;opacity:0.5;margin:0 2px;display:inline-flex;align-items:center;transition:opacity .15s}'+
    '.layer-focus:hover{opacity:1}';
  document.head.appendChild(st);
})();
