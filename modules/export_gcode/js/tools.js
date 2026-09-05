function n2gSafeRpm(value){
  var rpm=Number(value);
  return isFinite(rpm) && rpm>0 ? rpm : 17000;
}

function n2gInit(sheets,tools,posts,defaultPost,allLayers,allToolsList,toolGroups,noNesting){
  SHEETS=[];  // reset — sẽ được fill bởi n2gAddSheet
  TOOLS=tools.map(function(t){
    return Object.assign({},t,{tool_number:t.tool_number||null,rpm:n2gSafeRpm(t.rpm)});
  });
  ALL_LAYERS=(allLayers||[]).map(function(l){ return normalizeLayer(l); });
  ALL_TOOLS_LIST=allToolsList||[];
  ALL_TOOL_GROUPS=toolGroups||[];
  ALL_TOOL_GROUPS.forEach(function(group){
    (group.tools||[]).forEach(function(tool){ tool.rpm=n2gSafeRpm(tool.rpm); });
  });
  posts.forEach(function(p){ PRESETS[p.id]=p; });
  buildPresetBar(posts,defaultPost);
  loadPreset(defaultPost);
  renderToolTable();
  // Không renderSheets ở đây — chờ n2gAddSheet gọi xong hết

  if(noNesting){
    document.getElementById('btn-export').disabled=true;
    var banner = document.getElementById('no-nesting-banner');
    if(banner){ banner.style.display='flex'; }
    setStatus('warn','⚠ Chưa nesting — Mở file SketchUp đã nesting để xuất G-code. Bạn vẫn có thể cấu hình dao và post processor.');
    loadIgnoredLayers();
    document.getElementById('overlay').style.display='none';
    return;
  }

  document.getElementById('btn-export').disabled=false;
  loadIgnoredLayers();
}

function switchTab(n){
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('panel-'+n).classList.add('active');
  document.getElementById('tab-'+n).classList.add('active');
  if(n==='settings') stgApplyToUI();
  if(n==='history') n2gRefreshHistory();
}

function buildPresetBar(posts,activeId){
  // Ẩn preset-bar cũ (không dùng nữa)
  const bar=document.getElementById('preset-bar');
  if(bar) bar.style.display='none';
  // Render sidebar
  renderPostSidebar(PRESETS, activeId);
  if(activeId) selectPostItem(activeId);
}

function loadPreset(id){
  sketchup.save_active_post_callback(id);
  const p=PRESETS[id];if(!p)return;
  const g=(k1,k2)=>p[k1]!==undefined?p[k1]:(p[k2]||'');
  document.getElementById('pp-unit').value        =g('unit');
  document.getElementById('pp-safez').value       =g('safe_z','safez');
  document.getElementById('pp-clearz').value      =g('clear_z','clearz');
  document.getElementById('pp-ext').value         =g('ext');
  document.getElementById('pp-comment').value     =g('comment');
  document.getElementById('pp-spindle-on').value  =g('spindle_on','spindleOn');
  document.getElementById('pp-spindle-off').value =g('spindle_off','spindleOff');
  document.getElementById('pp-cool-on').value     =g('cool_on','coolOn');
  document.getElementById('pp-cool-off').value    =g('cool_off','coolOff');
  var tcDefault = '( === {layer_name} | {tool_name} D{diameter} Z{depth} === )\n{spindle_off}\nT{tool_number}\nG43 H{tool_number}\n{spindle_on} S{rpm}';
  var tcVal = g('toolchange','toolcall');
  document.getElementById('pp-toolchange').value  = tcVal || tcDefault;
  document.getElementById('pp-header').value      =g('header');
  document.getElementById('pp-footer').value      =g('footer');
  document.getElementById('pp-parsed-preview').style.display='block';
  document.getElementById('pp-manual-section').style.display='none';
  document.getElementById('pp-aspire-section').style.display='none';
  if(p.name) document.getElementById('pp-save-name').value=p.name;
  selectPostItem(id);
}

function renderToolTable(){
  // Không sort ở đây — giữ nguyên thứ tự user đã sắp xếp
  const types=['profile','drill','pocket'];
  const typeLabels={'profile':'Cắt','drill':'Khoan','pocket':'Hạ nền'};
  const profileStrats=['cut_out','cut_in','cut_on'];
  const stratLabels={'cut_out':'Cắt ngoài','cut_in':'Cắt trong','cut_on':'Cắt giữa'};
  const allLayerSet = new Set(ALL_LAYERS);
  const lOpts=cur=>{
    const inList = allLayerSet.has(cur);
    const missingOpt = (!inList && cur)
      ? `<option value="${esc(cur)}" selected>⚠ ${esc(cur)}</option>` : '';
    const opts = ALL_LAYERS.map(l=>
      `<option value="${esc(l)}" ${l===cur&&inList?'selected':''}>${esc(l)}</option>`
    ).join('');
    return `${missingOpt}${opts}<option value="__custom__">✏ Nhập tên layer...</option>`;
  };
  const tOpts=cur=>{
    if(!ALL_TOOLS_LIST.length) return `<option value="${esc(cur)}">${esc(cur)}</option>`;
    if(ALL_TOOL_GROUPS.length){
      return ALL_TOOL_GROUPS.map(g=>
        `<optgroup label="${esc(g.name)}">${
          g.tools.map(t=>`<option value="${esc(t.name)}" ${t.name===cur?'selected':''}>${esc(t.name)}</option>`).join('')
        }</optgroup>`
      ).join('');
    }
    return ALL_TOOLS_LIST.map(t=>
      `<option value="${esc(t.name)}" ${t.name===cur?'selected':''}>${esc(t.name)}</option>`
    ).join('');
  };
  const stratCell=(t,i)=>t.type==='profile'
    ?`<select class="tf" data-field="strategy" onchange="TOOLS[${i}].strategy=this.value;checkToolDiameterWarnings()" onclick="event.stopPropagation()">${profileStrats.map(v=>`<option value="${v}" ${t.strategy===v?'selected':''}>${stratLabels[v]||v}</option>`).join('')}</select>`
    :`<span style="color:var(--text3);font-size:11px;padding:0 4px">${t.type==='pocket'?'Hạ nền':'—'}</span>`;

  const bitTypeCell=(t,i)=>`<select class="tf" data-field="bit_type" onchange="onBitTypeChange(${i},this.value)" onclick="event.stopPropagation()">
      <option value="flat" ${(t.bit_type||'flat')==='flat'?'selected':''}>Dao cắt</option>
      <option value="vbit" ${t.bit_type==='vbit'?'selected':''}>V-Bit</option>
     </select>`;

  const vbitAngleCell=(t,i)=>{
    const isVbit = t.bit_type==='vbit';
    if(!isVbit) return `<span style="color:var(--text3);font-size:11px;padding:0 9px;display:block;text-align:center;opacity:0.5">—</span>`;
    return `<input class="tf" type="number" value="${t.vbit_angle||120}" step="1" min="1" max="179"
      onchange="TOOLS[${i}].vbit_angle=Math.max(1,Math.min(179,+this.value||120));this.value=TOOLS[${i}].vbit_angle;checkToolDiameterWarnings()"
      onclick="event.stopPropagation()" title="Góc V-Bit (độ)">`;
  };

  const dirCell=(t,i)=>{
    if(t.type==='drill')
      return `<span style="color:var(--text3);font-size:11px;padding:0 4px">—</span>`;
    // Pocket (hạ nền): hướng quét ngoài↔trong (cw/ccw không có ý nghĩa với pocket)
    if(t.type==='pocket'){
      var d = (t.direction==='out_in') ? 'out_in' : 'in_out';
      // Tương thích dữ liệu cũ: cw/ccw → out_in (chuẩn hoá luôn trong TOOLS)
      if(t.direction!=='out_in' && t.direction!=='in_out') t.direction='in_out';
      return `<select class="tf" data-field="direction" onchange="TOOLS[${i}].direction=this.value" onclick="event.stopPropagation()">
        <option value="out_in" ${d==='out_in'?'selected':''}>⊡ Ngoài vào trong</option>
        <option value="in_out" ${d==='in_out'?'selected':''}>⊞ Trong ra ngoài</option>
       </select>`;
    }
    // Profile / vbit / mark: chọn thuận/ngược. Chưa chỉnh (nil) → hiện đúng giá trị
    // cài đặt chung (afvDir); chọn riêng thì override cho dao này.
    var _glob = (typeof afvDir!=='undefined' && afvDir==='cw') ? 'cw' : 'ccw';
    var _pd = (t.direction==='cw' || t.direction==='ccw') ? t.direction : _glob;
    return `<select class="tf" data-field="direction" onchange="TOOLS[${i}].direction=this.value" onclick="event.stopPropagation()">
        <option value="cw"  ${_pd==='cw'?'selected':''}>↻ Thuận chiều</option>
        <option value="ccw" ${_pd==='ccw'?'selected':''}>↺ Ngược chiều</option>
       </select>`;
  };

  document.getElementById('tool-tbody').innerHTML=TOOLS.map((t,i)=>{
    const layerMissing = t.layer && ALL_LAYERS.length>0 && !allLayerSet.has(t.layer);
    const rowClass = `${i===selectedToolRow?'tr-sel':''} ${layerMissing?'row-missing':''}`;
    const rowTitle = layerMissing ? `title="Layer '${t.layer}' chưa có trong nesting lần này"` : '';
    const missingBadge = '';
    return `
    <tr class="${rowClass}" ${rowTitle} onclick="selectToolRow(${i})" data-tool-index="${i}"
        draggable="true" data-idx="${i}"
        ondragstart="toolDragStart(event,${i})"
        ondragover="toolDragOver(event,${i})"
        ondrop="toolDrop(event,${i})"
        ondragend="toolDragEnd(event)">
      <td class="rn" style="cursor:grab;user-select:none" title="Kéo để sắp xếp">☰ ${i+1}</td>
      <td><select class="tf" onchange="onLayerChange(${i},this)" onclick="event.stopPropagation()">${lOpts(t.layer)}</select>${missingBadge}</td>
      <td><select class="tf" onchange="updateToolName(${i},this.value,this)" onclick="event.stopPropagation()">${tOpts(t.name)}</select></td>
      <td><input class="tf" type="number" value="${t.diameter}" step="0.1" min="1"
        onchange="TOOLS[${i}].diameter=Math.max(1,+this.value);this.value=TOOLS[${i}].diameter;checkToolDiameterWarnings()"
        onclick="event.stopPropagation()"></td>
      <td onclick="event.stopPropagation()">${bitTypeCell(t,i)}</td>
      <td onclick="event.stopPropagation()">${vbitAngleCell(t,i)}</td>
      <td><select class="tf" onchange="onTypeChange(${i},this.value)" onclick="event.stopPropagation()">${types.map(v=>`<option value="${v}" ${t.type===v?'selected':''}>${typeLabels[v]||v}</option>`).join('')}</select></td>
      <td onclick="event.stopPropagation()">${stratCell(t,i)}</td>
      <td onclick="event.stopPropagation()">${dirCell(t,i)}</td>
      <td><input class="tf" type="text" value="${t.depth}" style="width:70px"
        onchange="TOOLS[${i}].depth=validateDepth(this)" onclick="event.stopPropagation()"
        title="Nhập số dương (vd: 10) hoặc công thức Z-1.2 / Z+0.1"></td>
      <td><input class="tf" type="number" value="${t.stepover}" min="10" max="100" step="1" data-field="stepover"
        onchange="TOOLS[${i}].stepover=Math.min(100,Math.max(10,+this.value));this.value=TOOLS[${i}].stepover"
        onclick="event.stopPropagation()"></td>
      <td><input class="tf" type="number" value="${n2gSafeRpm(t.rpm)}" step="500" data-field="rpm" onchange="TOOLS[${i}].rpm=n2gSafeRpm(this.value);this.value=TOOLS[${i}].rpm" onclick="event.stopPropagation()"></td>
      <td>${t.type==='drill'
        ? '<span style="color:var(--text3);font-size:11px;padding:0 9px">—</span>'
        : `<input class="tf" type="number" value="${t.feed}" step="50" data-field="feed" onchange="TOOLS[${i}].feed=+this.value" onclick="event.stopPropagation()">`
      }</td>
      <td><input class="tf" type="number" value="${t.z_feed}" step="50" data-field="z_feed" onchange="TOOLS[${i}].z_feed=+this.value" onclick="event.stopPropagation()"></td>
      <td><input class="tf" type="number" value="${t.tool_number!==null&&t.tool_number!==undefined?t.tool_number:''}" step="1" min="1" placeholder="—" data-field="tool_number"
        onchange="const v=Math.max(1,Math.floor(+this.value||1));TOOLS[${i}].tool_number=v;this.value=v"
        onclick="event.stopPropagation()"></td>
      <td style="width:64px;text-align:center;padding:0;white-space:nowrap">
        <button class="row-edit-btn" onclick="event.stopPropagation();openLayerToolEditor(${i})" title="Chỉnh sửa dao"><svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10z"/></svg></button>
        <button class="row-del-btn" onclick="event.stopPropagation();TOOLS.splice(${i},1);renderToolTable();checkToolDiameterWarnings()" title="Xóa dòng">✕</button>
      </td>
    </tr>`;
  }).join('');
}

// ── Modal chỉnh sửa chi tiết 1 dao (theo layer) ─────────────────────────────
// Bấm nút bút ✎ trên dòng dao → mở modal chứa toàn bộ thuộc tính. Trước mắt gồm
// các field hiện có; dễ bổ sung thêm sau (thêm 1 khối .lte-field là xong).
var _lteIndex = -1;

function openLayerToolEditor(i){
  if(i<0 || i>=TOOLS.length) return;
  _lteIndex = i;
  var t = TOOLS[i];

  var typeLabels  = {'profile':'Cắt','drill':'Khoan','pocket':'Hạ nền'};
  var stratLabels = {'cut_out':'Cắt ngoài','cut_in':'Cắt trong','cut_on':'Cắt giữa'};

  // options layer
  var layerOpts = (ALL_LAYERS||[]).map(function(l){
    return '<option value="'+esc(l)+'" '+(l===t.layer?'selected':'')+'>'+esc(l)+'</option>';
  }).join('');
  if(t.layer && !(ALL_LAYERS||[]).includes(t.layer)){
    layerOpts = '<option value="'+esc(t.layer)+'" selected>⚠ '+esc(t.layer)+'</option>' + layerOpts;
  }

  // options tên dao
  var nameOpts = '';
  if((ALL_TOOL_GROUPS||[]).length){
    nameOpts = ALL_TOOL_GROUPS.map(function(g){
      return '<optgroup label="'+esc(g.name)+'">'+g.tools.map(function(tt){
        return '<option value="'+esc(tt.name)+'" '+(tt.name===t.name?'selected':'')+'>'+esc(tt.name)+'</option>';
      }).join('')+'</optgroup>';
    }).join('');
  } else {
    nameOpts = (ALL_TOOLS_LIST||[]).map(function(tt){
      return '<option value="'+esc(tt.name)+'" '+(tt.name===t.name?'selected':'')+'>'+esc(tt.name)+'</option>';
    }).join('');
    if(!nameOpts) nameOpts = '<option value="'+esc(t.name||'')+'" selected>'+esc(t.name||'')+'</option>';
  }

  var typeOpts = ['profile','drill','pocket'].map(function(v){
    return '<option value="'+v+'" '+(t.type===v?'selected':'')+'>'+(typeLabels[v]||v)+'</option>';
  }).join('');
  var stratOpts = ['cut_out','cut_in','cut_on'].map(function(v){
    return '<option value="'+v+'" '+(t.strategy===v?'selected':'')+'>'+(stratLabels[v]||v)+'</option>';
  }).join('');

  var old = document.getElementById('lte-modal');
  if(old) old.remove();

  // Options hướng chạy theo LOẠI dao (pocket khác profile). Drill không có hướng.
  var dirOpts = lteDirOptions(t.type, t.direction);

  var html =
    '<div id="lte-modal" class="lte-modal">'+
    '<div class="lte-box">'+
      '<div class="lte-hdr"><div class="lte-title">Chỉnh sửa dao <span style="color:var(--accent)">'+esc(t.name||'')+'</span></div>'+
        '<button class="lte-close" onclick="closeLayerToolEditor(false)" title="Đóng">✕</button></div>'+
      '<div class="lte-body">'+

        // ── KHỐI 1: Layer ──
        '<div class="lte-sect">'+
          '<div class="lte-sect-title">Layer</div>'+
          '<div class="lte-grid lte-grid-1">'+
            fieldSel('lte-layer','Tên layer', layerOpts)+
          '</div>'+
        '</div>'+

        // ── KHỐI 2: Thông tin dao ──
        '<div class="lte-sect">'+
          '<div class="lte-sect-title">Thông tin dao</div>'+
          '<div class="lte-grid lte-grid-2">'+
            fieldSel('lte-name','Tên dao', nameOpts)+
            fieldNum('lte-diameter','Đường kính dao (mm)', t.diameter, '0.1', '1')+
            fieldNum('lte-tool_number','Số thứ tự dao (T)', (t.tool_number!=null?t.tool_number:''), '1', '1')+
            fieldSel('lte-bit_type','Kiểu dao',
              '<option value="flat" '+((t.bit_type||'flat')==='flat'?'selected':'')+'>Dao cắt</option>'+
              '<option value="vbit" '+(t.bit_type==='vbit'?'selected':'')+'>V-Bit</option>', 'onchange="lteToggleVbit()"')+
            '<label class="lte-field" id="lte-vbit-field"><span>Góc V-Bit (độ)</span>'+
              '<input id="lte-vbit_angle" type="number" step="1" min="1" max="179" value="'+(t.vbit_angle||120)+'"></label>'+
          '</div>'+
        '</div>'+

        // ── KHỐI 3: Cách làm việc ──
        '<div class="lte-sect">'+
          '<div class="lte-sect-title">Cách làm việc</div>'+
          '<div class="lte-grid lte-grid-2">'+
            fieldSel('lte-type','Kiểu chạy', typeOpts, 'onchange="lteToggleStrat();lteUpdateDir()"')+
            '<label class="lte-field" id="lte-strat-field"><span>Chiến lược cắt</span>'+
              '<select id="lte-strategy">'+stratOpts+'</select></label>'+
            '<label class="lte-field" id="lte-dir-field"><span>Hướng chạy</span>'+
              '<select id="lte-direction">'+dirOpts+'</select></label>'+
            '<label class="lte-field"><span>Độ sâu (số hoặc Z-1.2)</span><input id="lte-depth" type="text" value="'+esc(t.depth!=null?String(t.depth):'')+'" onchange="lteCheckStepWarn()"></label>'+
            '<label class="lte-field"><span>Sâu tối đa mỗi lần hạ dao (mm)</span><input id="lte-max_depth" type="number" step="0.5" min="1" value="'+(t.max_depth!=null?Math.abs(t.max_depth):20)+'"></label>'+
            fieldNum('lte-stepover','Bước qua — Stepover (%)', t.stepover, '1', '10', '100')+
            fieldNum('lte-feed','F.xy — Tốc độ cắt (mm/ph)', t.feed, '50')+
            fieldNum('lte-z_feed','F.z — Tốc độ xuống Z (mm/ph)', t.z_feed, '50')+
            fieldNum('lte-rpm','Tốc độ trục (RPM)', n2gSafeRpm(t.rpm), '500')+
          '</div>'+
        '</div>'+

        // ── KHỐI 4: Nhiều lượt xuống dao (A: lớp cắt cuối, B: số lần xuống dao) ──
        // Áp cho MỌI loại dao (profile/pocket/drill). Mốc độ sâu tính tự động từ A,B và
        // độ sâu cắt C(=depth): B=1→[C]; A=0 hoặc A>=C→chia đều C thành B bước; else→
        // (C-A)*k/(B-1) cho k=1..B-1 rồi lần cuối=C.
        '<div class="lte-sect" id="lte-mp-sect">'+
          '<div class="lte-sect-title">Nhiều lượt xuống dao</div>'+
          '<div class="lte-grid lte-grid-2">'+
            '<label class="lte-field"><span>Độ dày lớp cắt cuối (mm)</span>'+
              '<input id="lte-finish_thickness" type="number" step="0.1" min="0" value="'+
              (t.finish_thickness!=null?Math.abs(t.finish_thickness):0)+'" onchange="lteCheckStepWarn()"></label>'+
            '<label class="lte-field"><span>Số lần xuống dao</span>'+
              '<input id="lte-num_passes" type="number" step="1" min="1" value="'+
              (t.num_passes!=null?Math.max(1,Math.round(t.num_passes)):1)+'" onchange="lteCheckStepWarn()"></label>'+
          '</div>'+
          // Cảnh báo khi bước ăn dao > độ dày ván (Z)
          '<div id="lte-step-warn" style="display:none;font-size:11px;color:#c0392b;background:var(--surface);border:1px solid #c0392b;border-radius:6px;padding:8px 10px;line-height:1.5;margin-top:8px"></div>'+
        '</div>'+

        // ── KHỐI 5: Đoạn dốc xuống dao (ramp) — chỉ dao cắt (profile) ──
        // Dao hạ Z dần dọc L mm đầu thay vì cắm thẳng. Chỉ lượt xuống dao đầu,
        // cuttinglines. Đường ngắn hơn L → tự giảm cho vừa chu vi.
        '<div class="lte-sect" id="lte-ramp-sect">'+
          '<div class="lte-sect-title">Đoạn dốc xuống dao</div>'+
          '<div class="lte-grid lte-grid-2">'+
            '<label class="lte-field"><span>Thêm đoạn dốc</span>'+
              '<select id="lte-ramp_on" onchange="lteToggleRamp()">'+
                '<option value="0" '+(t.ramp_on?'':'selected')+'>Tắt</option>'+
                '<option value="1" '+(t.ramp_on?'selected':'')+'>Bật</option></select></label>'+
            '<label class="lte-field" id="lte-ramp-len-field"><span>Độ dài đoạn dốc (mm)</span>'+
              '<input id="lte-ramp_len" type="number" step="1" min="2" max="200" value="'+
              (t.ramp_len!=null?Math.abs(t.ramp_len):20)+'"></label>'+
          '</div>'+
          '<div style="font-size:11px;color:var(--text3);line-height:1.5;margin-top:8px">'+
            'Dao hạ dần dọc L mm đầu thay vì cắm thẳng xuống — giảm tải mũi dao. '+
            'Chỉ áp dụng lượt xuống dao đầu tiên, layer cuttinglines. Đường ngắn hơn L thì tự giảm.'+
          '</div>'+
        '</div>'+

      '</div>'+
      '<div class="lte-footer"><button class="tbtn tbtn-o" onclick="closeLayerToolEditor(false)">Huỷ</button>'+
        '<button class="tbtn tbtn-p" onclick="closeLayerToolEditor(true)">Áp dụng</button></div>'+
    '</div></div>';

  document.body.insertAdjacentHTML('beforeend', html);
  lteToggleVbit();
  lteToggleStrat();
  lteToggleDir();
  lteCheckStepWarn();

  // Esc đóng, click nền đóng
  var m = document.getElementById('lte-modal');
  m.addEventListener('mousedown', function(e){ if(e.target.id==='lte-modal') closeLayerToolEditor(false); });
  document.addEventListener('keydown', lteKeyHandler);
}

// Widget multipass đang gắn với modal (null khi tắt/không phải profile)
var _mpWidget = null;

// Depth có chứa ký hiệu Z? (vd "Z", "z-1", "Z-1.2") → dùng chế độ %
function lteDepthIsZ(depthStr){
  return /[Zz]/.test(String(depthStr==null?'':depthStr));
}

// Độ sâu tổng (mm dương) suy từ chuỗi depth: "-17.5" → 17.5. Chỉ dùng cho mode mm.
function lteParseDepth(depthStr){
  var m = String(depthStr==null?'':depthStr).match(/-?\d+(?:\.\d+)?/);
  var v = m ? Math.abs(parseFloat(m[0])) : 10;
  return v > 0 ? v : 10;
}

function lteInitMultipass(t){
  // KHÔNG dùng nữa (thay bằng ô A,B + lteCheckStepWarn). Giữ rỗng để lời gọi cũ (nếu
  // còn) không ẩn nhầm khối "Nhiều lượt xuống dao".
  return;
}

// Điều khiển hiển thị theo loại depth:
//  - Depth SỐ  → cho tùy chỉnh thủ công (widget mm)
//  - Depth Z   → CHỈ tự động theo max_depth (ẩn widget, vì mỗi tấm một độ dày,
//                không thể chia thủ công chung cho mọi tấm)
function lteApplyDepthMode(t){
  var isZ = lteDepthIsZ(document.getElementById('lte-depth').value || t.depth);
  var customRow = document.getElementById('lte-mp-custom-row');
  var enable    = document.getElementById('lte-mp-enable');

  lteUpdateAutoNote();

  if(isZ){
    // Ẩn hẳn phần tùy chỉnh, ép về tự động
    if(customRow) customRow.style.display = 'none';
    if(enable) enable.checked = false;
    var cont = document.getElementById('lte-mp-container');
    if(cont) cont.style.display = 'none';
    _mpWidget = null;
    // xóa cấu hình thủ công cũ (không áp cho depth Z)
    if(_lteIndex>=0){ TOOLS[_lteIndex].z_passes = null; TOOLS[_lteIndex].z_passes_mode = null; }
  } else {
    // Depth số → cho tùy chỉnh
    if(customRow) customRow.style.display = '';
    var hasPasses = Array.isArray(t.z_passes) && t.z_passes.length > 1;
    if(enable) enable.checked = hasPasses;
    lteBuildMultipassWidget(t);
    lteToggleMultipass();
  }
}

// Số lượt TỰ ĐỘNG theo max_depth: ceil(D / max_depth). D<=max_depth → 1 lượt.
function lteAutoPassCount(D, maxDepth){
  if(!maxDepth || maxDepth<=0 || !D || D<=0) return 1;
  return Math.max(1, Math.ceil(D / maxDepth));
}

// Cập nhật dòng thông báo chế độ tự động (theo max_depth + depth hiện tại)
function lteUpdateAutoNote(){
  var el = document.getElementById('lte-mp-auto-note');
  if(!el) return;
  var depthStr = document.getElementById('lte-depth').value;
  var maxD = Math.abs(+ (document.getElementById('lte-max_depth') ?
                          document.getElementById('lte-max_depth').value :
                          (_lteIndex>=0 ? TOOLS[_lteIndex].max_depth : 20)) ) || 20;
  var isZ = lteDepthIsZ(depthStr);
  if(isZ){
    el.innerHTML = '⚡ <b>Tự động</b>: mỗi tấm chia <b>⌈độ dày ÷ '+maxD+'mm⌉</b> lượt theo độ dày thật.'+
      '<br><span style="color:var(--text3)">Ví dụ: ván 25mm → '+lteAutoPassCount(25,maxD)+' lượt · ván 7mm → '+lteAutoPassCount(7,maxD)+' lượt.</span>';
  } else {
    var D = lteParseDepth(depthStr);
    var n = lteAutoPassCount(D, maxD);
    el.innerHTML = '⚡ <b>Tự động</b>: cắt <b>'+n+' lượt</b> (độ sâu '+D+'mm ÷ tối đa '+maxD+'mm/lượt), mỗi lượt '+round1v(D/n)+'mm.';
  }
}
function round1v(v){ return Math.round(v*10)/10; }

function lteBuildMultipassWidget(t){
  var container = document.getElementById('lte-mp-container');
  if(!container || typeof MultiPassUI==='undefined') return;
  // Chỉ gọi khi depth là SỐ (depth Z không có widget). Widget luôn chế độ mm.
  var depthStr = document.getElementById('lte-depth').value || t.depth;
  var total = lteParseDepth(depthStr);
  var passes = (Array.isArray(t.z_passes) && t.z_passes.length && t.z_passes_mode==='mm')
                 ? t.z_passes.slice() : null;
  _mpWidget = MultiPassUI.create(container, { mode: 'mm', totalDepth: total, passes: passes || [total] });
}

// Bật/tắt: tắt = dùng TỰ ĐỘNG (max_depth); bật = TÙY CHỈNH thủ công (widget)
function lteToggleMultipass(){
  var on = document.getElementById('lte-mp-enable').checked;
  var cont = document.getElementById('lte-mp-container');
  var auto = document.getElementById('lte-mp-auto-note');
  if(cont) cont.style.display = on ? '' : 'none';
  if(auto) auto.style.opacity = on ? '0.45' : '1';   // mờ dòng tự động khi đang tùy chỉnh
  if(on && _mpWidget && _mpWidget.getMode() === 'mm'){
    _mpWidget.setTotalDepth(lteParseDepth(document.getElementById('lte-depth').value));
  }
}

function fieldNum(id,label,val,step,min,max){
  return '<label class="lte-field"><span>'+label+'</span><input id="'+id+'" type="number" value="'+(val!=null?val:'')+'"'+
    (step?' step="'+step+'"':'')+(min?' min="'+min+'"':'')+(max?' max="'+max+'"':'')+'></label>';
}
function fieldTxt(id,label,val){
  return '<label class="lte-field"><span>'+label+'</span><input id="'+id+'" type="text" value="'+esc(val!=null?String(val):'')+'"></label>';
}
function fieldSel(id,label,opts,extra){
  return '<label class="lte-field"><span>'+label+'</span><select id="'+id+'" '+(extra||'')+'>'+opts+'</select></label>';
}

function lteToggleVbit(){
  var el=document.getElementById('lte-bit_type'); if(!el) return;
  var f=document.getElementById('lte-vbit-field');
  if(f) f.style.display = (el.value==='vbit') ? '' : 'none';
}
function lteToggleStrat(){
  var el=document.getElementById('lte-type'); if(!el) return;
  var f=document.getElementById('lte-strat-field');
  if(f) f.style.display = (el.value==='profile') ? '' : 'none';
  // KHỐI "Nhiều lượt xuống dao" (A,B): áp cho profile + drill. Pocket CHƯA hỗ trợ
  // (write_pocket chưa lặp z_levels) → ẩn để tránh nhầm. Sẽ thêm sau.
  var mpSect=document.getElementById('lte-mp-sect');
  if(mpSect) mpSect.style.display = (el.value==='pocket') ? 'none' : '';
  // KHỐI "Đoạn dốc": chỉ dao cắt (profile). Khoan/hạ nền không có ramp.
  var rampSect=document.getElementById('lte-ramp-sect');
  if(rampSect) rampSect.style.display = (el.value==='profile') ? '' : 'none';
  lteToggleRamp();
  lteCheckStepWarn();
}

// Ẩn ô "Độ dài" khi tắt ramp (mờ đi cho rõ trạng thái).
function lteToggleRamp(){
  var on = (document.getElementById('lte-ramp_on')||{}).value === '1';
  var f  = document.getElementById('lte-ramp-len-field');
  if(f){
    f.style.opacity       = on ? '1' : '0.4';
    f.style.pointerEvents = on ? '' : 'none';
  }
}

// Đổi ô Độ sâu → cập nhật widget. Nếu chuyển giữa Z↔số (đổi chế độ) thì dựng lại.
function lteSyncMpTotal(){
  if(_lteIndex<0) return;
  // Đổi depth → xét lại chế độ (Z ẩn widget / số hiện widget) + cập nhật tổng.
  lteApplyDepthMode(TOOLS[_lteIndex]);
}

// Tạo <option> hướng chạy theo LOẠI dao (khớp dirCell ở bảng):
//  - pocket: ngoài↔trong (out_in/in_out)
//  - profile/vbit: thuận↔ngược (cw/ccw)
//  - drill: không có hướng
function lteDirOptions(type, cur){
  if(type==='pocket'){
    var d = (cur==='in_out') ? 'in_out' : 'out_in';   // cw/ccw cũ → out_in
    if(cur!=='out_in' && cur!=='in_out') d='in_out';
    return '<option value="out_in" '+(d==='out_in'?'selected':'')+'>⊡ Ngoài vào trong</option>'+
           '<option value="in_out" '+(d==='in_out'?'selected':'')+'>⊞ Trong ra ngoài</option>';
  }
  // profile / vbit / mark: thuận/ngược. Chưa chỉnh → mặc định theo cài đặt chung.
  var _glob = (typeof afvDir!=='undefined' && afvDir==='cw') ? 'cw' : 'ccw';
  var c = (cur==='cw' || cur==='ccw') ? cur : _glob;
  return '<option value="cw" '+(c==='cw'?'selected':'')+'>↻ Thuận chiều</option>'+
         '<option value="ccw" '+(c==='ccw'?'selected':'')+'>↺ Ngược chiều</option>';
}

// Field "Hướng chạy" ẩn khi loại dao là Khoan (drill không có hướng); các loại khác
// (profile/vbit/mark: thuận↔ngược; pocket: ngoài↔trong) đều hiện.
function lteToggleDir(){
  var el=document.getElementById('lte-type'); if(!el) return;
  var f=document.getElementById('lte-dir-field');
  if(f) f.style.display = (el.value==='drill') ? 'none' : '';
}

// Khi đổi Kiểu chạy → dựng lại options hướng cho đúng loại, giữ lựa chọn hợp lệ
function lteUpdateDir(){
  var typeEl=document.getElementById('lte-type');
  var dirEl =document.getElementById('lte-direction');
  if(!typeEl || !dirEl) return;
  dirEl.innerHTML = lteDirOptions(typeEl.value, dirEl.value);
  lteToggleDir();
}

function lteKeyHandler(e){
  if(e.key==='Escape') closeLayerToolEditor(false);
}

function closeLayerToolEditor(apply){
  var m=document.getElementById('lte-modal');
  if(apply && _lteIndex>=0 && _lteIndex<TOOLS.length){
    var t=TOOLS[_lteIndex];
    var val=function(id){ var e=document.getElementById(id); return e?e.value:undefined; };
    var numv=function(id){ var e=document.getElementById(id); return e?+e.value:undefined; };

    t.layer      = val('lte-layer');
    t.name       = val('lte-name');
    t.diameter   = Math.max(1, numv('lte-diameter')||6);
    t.bit_type   = val('lte-bit_type');
    t.vbit_angle = Math.max(1, Math.min(179, numv('lte-vbit_angle')||120));
    t.type       = val('lte-type');
    t.strategy   = val('lte-strategy');
    // Hướng chạy: pocket (ngoài↔trong) và profile/vbit/mark (thuận↔ngược) đều lưu;
    // drill không có hướng.
    if(t.type!=='drill'){
      var dv = val('lte-direction');
      if(dv) t.direction = dv;
    }
    t.depth      = val('lte-depth');
    t.stepover   = Math.min(100, Math.max(10, numv('lte-stepover')||90));
    t.max_depth  = Math.abs(numv('lte-max_depth')) || 20;
    t.rpm        = n2gSafeRpm(numv('lte-rpm'));
    t.feed       = numv('lte-feed');
    t.z_feed     = numv('lte-z_feed');
    var tn = numv('lte-tool_number');
    t.tool_number = (tn && tn>=1) ? Math.floor(tn) : t.tool_number;

    // Nhiều lượt xuống dao: A (độ dày lớp cắt cuối) + B (số lần xuống dao). Áp cho MỌI
    // loại dao. Mốc độ sâu tính lúc export (khi biết độ dày ván → C). Lưu A, B thô.
    var ftEl = document.getElementById('lte-finish_thickness');
    var npEl = document.getElementById('lte-num_passes');
    t.finish_thickness = ftEl ? Math.max(0, Math.abs(+ftEl.value||0)) : 0;
    t.num_passes       = npEl ? Math.max(1, Math.round(+npEl.value||1)) : 1;
    // Bỏ cơ chế z_passes cũ (widget kéo thả) — không dùng nữa.
    t.z_passes = null; t.z_passes_mode = null;

    // Đoạn dốc xuống dao (ramp) — chỉ dao cắt (profile).
    if(t.type==='profile'){
      var roEl = document.getElementById('lte-ramp_on');
      var rlEl = document.getElementById('lte-ramp_len');
      t.ramp_on  = roEl ? (roEl.value==='1') : false;
      t.ramp_len = rlEl ? Math.min(200, Math.max(2, +rlEl.value||20)) : 20;
    } else {
      t.ramp_on = false;
    }

    selectedToolRow = _lteIndex;
    renderToolTable();
    if(typeof checkToolDiameterWarnings==='function') checkToolDiameterWarnings();
    // Persist thay đổi dao (gồm ramp). Preset là nguồn THẮNG khi mở lại dialog
    // (loadToolPreset ghi đè layer_map), nên phải cập nhật preset ĐANG ACTIVE rồi
    // lưu — mỗi preset giữ ramp riêng, không lẫn sang preset khác.
    try{
      if(typeof ACTIVE_PRESET_ID!=='undefined' && ACTIVE_PRESET_ID!=null &&
         typeof TOOL_PRESETS!=='undefined'){
        var _ap = TOOL_PRESETS.find(function(p){ return String(p.id)===String(ACTIVE_PRESET_ID); });
        if(_ap){
          _ap.tools = JSON.parse(JSON.stringify(TOOLS));
          if(typeof savePresetsToRuby==='function') savePresetsToRuby();
        }
      }
      // Vẫn lưu layer_map (dùng cho scan + fallback khi không có preset active).
      if(typeof sketchup!=='undefined' && sketchup.save_layer_map_callback){
        sketchup.save_layer_map_callback(JSON.stringify(TOOLS));
      }
    }catch(e){}
  }
  document.removeEventListener('keydown', lteKeyHandler);
  if(m) m.remove();
  _lteIndex = -1;
}

const SYSTEM_IGNORED_LAYERS = new Set([
  'ABF_EDGEBANDING','ABF_SHEETBORDER','ABF_PARTBORDER',
  'ABF_LABEL','ABF_SHEETID','ABF_SHEETMATERIAL'
]);

function isIgnoredLayer(l){
  const n = normalizeLayer(l);
  return SYSTEM_IGNORED_LAYERS.has(n) ||
         IGNORED_LAYERS.has(l) ||
         IGNORED_LAYERS.has(n);
}

function detectLayerConfig(layerName){
  const n = layerName.toUpperCase();
  // Khoan: có D+số, hoặc chứa KHOAN/DRILL
  if(/[_\-\s]D\d+/.test(n) || /KHOAN|DRILL/.test(n)){
    return { type:'drill', strategy:'drill' };
  }
  // Specific trước: Rãnh uốn cong, rãnh bảo vệ → cắt giữa z-1
  if(/RANH_UONCONG|RANH_BAOVE/.test(n)){
    return { type:'profile', strategy:'cut_on', depth:'Z-1' };
  }
  // Khấu âm dương → cắt trong z+0.1
  if(/KHAU_?AM_?DUONG|AM_?DUONG/.test(n)){
    return { type:'profile', strategy:'cut_in', depth:'Z+0.1' };
  }
  // CuttingLines → cắt ngoài z+0.1
  if(n === 'ABF_CUTTINGLINES'){
    return { type:'profile', strategy:'cut_out', depth:'Z+0.1' };
  }
  // MarkSquare → cắt ngoài z+0.1
  if(n === 'ABF_MARKSQUARE' || /MARKSQUARE/.test(n)){
    return { type:'profile', strategy:'cut_out', depth:'Z+0.1' };
  }
  // Hạ nền: HANEN, HA_NEN, POCKET, DOGBONE, RANH
  if(/HA_?NEN|POCKET|DOGBONE|RANH/.test(n)){
    return { type:'pocket', strategy:'pocket' };
  }
  // Cắt profile: CAT, PROFILE, LINE
  if(/CAT|PROFILE|LINE/.test(n)){
    return { type:'profile', strategy:'cut_out' };
  }
  // Default: cắt
  return { type:'profile', strategy:'cut_out' };
}

async function onLayerChange(i, sel){
  if(sel.value==='__custom__'){
    const name = await showInputModal('Nhập tên layer (ví dụ: ABF_DOGBONE)');
    if(name && name.trim()){
      const normalized = normalizeLayer(name.trim());
      TOOLS[i].layer = normalized;
      const cfg = detectLayerConfig(normalized);
      TOOLS[i].type     = cfg.type;
      TOOLS[i].strategy = cfg.strategy;
      if(cfg.depth) TOOLS[i].depth = cfg.depth;
    }
    renderToolTable();
    return;
  }
  const normalized = normalizeLayer(sel.value);
  TOOLS[i].layer = normalized;
  const cfg = detectLayerConfig(normalized);
  TOOLS[i].type     = cfg.type;
  TOOLS[i].strategy = cfg.strategy;
  if(cfg.depth) TOOLS[i].depth = cfg.depth;
  renderToolTable();
}

function validateDepth(input){
  const raw = input.value.trim();
  // Formula: Z-1.2 hoặc Z+0.1
  const formula = raw.match(/^[Zz]([+-]\d+(?:\.\d+)?)$/);
  if(formula){
    // Lưu công thức dạng chuỗi, highlight xanh
    input.style.color = 'var(--accent)';
    input.title = `Công thức: độ dày ván ${formula[1]}mm`;
    return raw.toUpperCase(); // lưu "Z-1.2" hoặc "Z+0.1"
  }
  // Số thuần: phải dương, tự thêm dấu trừ nội bộ
  const n = parseFloat(raw);
  if(isNaN(n) || n < 0){
    // Số âm hoặc không hợp lệ → lấy absolute value
    const abs = Math.abs(n) || 0;
    input.value = abs;
    input.style.color = '';
    return abs;
  }
  input.style.color = '';
  return n;
}

function checkToolDiameterWarnings(){
  const gap = STG.nesting_gap || 6.5;
  let warned = false;
  document.querySelectorAll('#tool-tbody tr').forEach((row, i)=>{
    if(i >= TOOLS.length) return;
    const t = TOOLS[i];
    const isCuttingOut = t.layer && t.layer.toLowerCase().includes('cuttinglines') &&
                         t.strategy === 'cut_out';
    const tooLarge = isCuttingOut && t.diameter > gap;
    const cells = row.querySelectorAll('td');
    const diamCell = cells[3];
    if(!diamCell) return;
    if(tooLarge){
      diamCell.style.color = '#c0392b';
      diamCell.style.fontWeight = '700';
      diamCell.title = `⚠ D${t.diameter} > gap ${gap}mm → ảnh hưởng tấm bên cạnh!`;
      row.style.background = 'rgba(192,57,43,0.1)';
      warned = true;
    } else {
      diamCell.style.color = '';
      diamCell.style.fontWeight = '';
      diamCell.title = '';
      row.style.background = '';
    }

    // V-Bit: kiểm tra depth không vượt max_depth = halfD/tan(angle/2)
    if(t.bit_type==='vbit'){
      const maxD = vbitMaxDepth(t);
      const depthVal = parseFloat(String(t.depth).replace(/^[Zz][+-]?/,'')) || 0;
      const depthAbs = typeof t.depth==='number' ? Math.abs(t.depth) : Math.abs(depthVal);
      const depthCell = cells[9]; // cột "Sâu" — sau khi chèn 2 cột mới (bit_type, vbit_angle)
      if(depthCell && depthAbs > maxD + 0.01){
        depthCell.style.color = '#c0392b';
        depthCell.style.fontWeight = '700';
        depthCell.title = `⚠ Depth ${depthAbs}mm > max_depth V-Bit ${maxD.toFixed(2)}mm (D${t.diameter}, góc ${t.vbit_angle}°)`;
        warned = true;
      } else if(depthCell){
        depthCell.style.color = '';
        depthCell.style.fontWeight = '';
        depthCell.title = '';
      }
    }
  });
  if(warned){
    const t = TOOLS.find(function(t){ return t.layer && t.layer.toLowerCase().includes('cuttinglines')&&t.strategy==='cut_out'&&t.diameter>gap; });
    if(t) setStatus('warn', '⚠ ABF_cuttingLines: D'+(t?t.diameter:'?')+'mm > gap '+gap+'mm — có thể ảnh hưởng tấm bên cạnh!');
  }
}

function onBitTypeChange(i, val){
  TOOLS[i].bit_type = val;
  if(val!=='vbit' && !TOOLS[i].vbit_angle) TOOLS[i].vbit_angle = 120;
  renderToolTable();
  checkToolDiameterWarnings();
}

function vbitMaxDepth(tool){
  // max_depth = halfD / tan(angle/2)
  const halfD = tool.diameter/2;
  const rad = (tool.vbit_angle||120) * Math.PI/180/2;
  return halfD / Math.tan(rad);
}

function onTypeChange(i, val){
  TOOLS[i].type = val;
  if(val==='pocket'){
    TOOLS[i].strategy = 'pocket';
    TOOLS[i].direction = 'in_out';
  }
  else if(val==='drill') TOOLS[i].strategy = 'drill';
  else if(!['cut_out','cut_in','cut_on'].includes(TOOLS[i].strategy))
                         TOOLS[i].strategy = 'cut_out';

  if(val==='pocket'){
    const layer = TOOLS[i].layer;
    const vecs = ((SHEETS[0]&&SHEETS[0].display)||[]).filter(v=>v.layer===layer&&!v.is_drill_center);
    if(vecs.length > 0){
      const open = checkOpenLoops(vecs);
      if(open > 0)
        setStatus('warn', `⚠ Layer "${layer}" có ${open} loop không kín — pocket có thể không chính xác!`);
      else
        setStatus('ok', `Layer "${layer}": tất cả loops kín ✓`);
    }
  }
  renderToolTable();
  checkToolDiameterWarnings();
}

function checkOpenLoops(vecs){
  let remaining=[...vecs], openCount=0;
  while(remaining.length>0){
    const loop=[remaining.shift()];
    let changed=true;
    while(changed){
      changed=false;
      for(let i=remaining.length-1;i>=0;i--){
        const last=loop[loop.length-1],e=remaining[i],T=1;
        if(Math.hypot(e.x1-last.x2,e.y1-last.y2)<T||Math.hypot(e.x2-last.x2,e.y2-last.y2)<T){
          loop.push(remaining.splice(i,1)[0]);changed=true;
        }
      }
    }
    const f=loop[0],l=loop[loop.length-1];
    if(Math.hypot(l.x2-f.x1,l.y2-f.y1)>=1) openCount++;
  }
  return openCount;
}


let dragSrcIdx = -1;

function toolDragStart(e, idx){
  dragSrcIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '0.4';
}

function toolDragOver(e, idx){
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  // Highlight target row
  document.querySelectorAll('#tool-tbody tr').forEach((r,i)=>{
    r.style.borderTop = (i===idx && idx!==dragSrcIdx) ? '2px solid var(--accent)' : '';
  });
}

function toolDrop(e, idx){
  e.preventDefault();
  if(dragSrcIdx < 0 || dragSrcIdx === idx) return;
  flushAll();
  // Reorder TOOLS array
  const moved = TOOLS.splice(dragSrcIdx, 1)[0];
  const insertAt = dragSrcIdx < idx ? idx - 1 : idx;
  TOOLS.splice(insertAt, 0, moved);
  selectedToolRow = insertAt;
  renderToolTable();
  setStatus('ok', `Đã di chuyển dao từ vị trí ${dragSrcIdx+1} → ${insertAt+1}`);
}

function toolDragEnd(e){
  dragSrcIdx = -1;
  e.currentTarget.style.opacity = '';
  document.querySelectorAll('#tool-tbody tr').forEach(r=>r.style.borderTop='');
}

function selectToolRow(i){selectedToolRow=(selectedToolRow===i)?-1:i;renderToolTable()}

function addToolRow(){
  const layer=ALL_LAYERS[0]||'';
  // Lấy dao đầu tiên từ tool groups
  let firstTool=null;
  for(const g of ALL_TOOL_GROUPS){ if(g.tools&&g.tools.length){firstTool=g.tools[0];break;} }
  if(!firstTool&&ALL_TOOLS_LIST.length) firstTool=ALL_TOOLS_LIST[0];
  TOOLS.push({
    layer,
    name:        firstTool && firstTool.name    || '',
    diameter:    firstTool && firstTool.diameter || 6,
    type:        'profile',
    strategy:    'cut_out',
    bit_type:    'flat',
    vbit_angle:  120,
    depth:       'Z',
    stepover:    firstTool && firstTool.stepover  || 90,
    rpm:         firstTool && firstTool.rpm       || 18000,
    feed:        firstTool && firstTool.feed      || 2000,
    z_feed:      firstTool && firstTool.z_feed    || 600,
    max_depth:   firstTool && Math.abs(firstTool.max_depth) || 20,
    tool_number: firstTool && firstTool.tool_number || null
  });
  selectedToolRow=TOOLS.length-1;
  flushAndRender();
  setStatus('ok',`Đã thêm dòng ${TOOLS.length} — chọn tên dao để điền thông số`);
}

function deleteSelectedRow(){
  if(selectedToolRow<0||selectedToolRow>=TOOLS.length){setStatus('error','Chọn 1 dòng trước');return}
  flushAndRender();TOOLS.splice(selectedToolRow,1);
  selectedToolRow=Math.min(selectedToolRow,TOOLS.length-1);
  renderToolTable();setStatus('ok','Đã xóa dòng');
}

let _presetResolve=null, _presetOverwriteId=null;

function renamePreset(id, el){
  const p = TOOL_PRESETS.find(p=>String(p.id)===String(id));
  if(!p) return;
  const oldName = p.name;
  const inp = document.createElement('input');
  inp.value = oldName;
  inp.style.cssText = 'width:100%;font-size:inherit;padding:1px 4px;border:1px solid var(--accent);border-radius:3px;background:var(--bg);color:var(--text1);outline:none';
  el.replaceWith(inp);
  inp.focus(); inp.select();
  const save = ()=>{
    const name = inp.value.trim() || oldName;
    p.name = name;
    savePresetsToRuby();
    renderToolPresets();
    // Restore active state
    setTimeout(()=>{
      const item = document.querySelector(`.preset-item[data-id="${id}"]`);
      if(item) item.classList.add('active-preset');
    }, 30);
  };
  inp.addEventListener('blur', save);
  inp.addEventListener('keydown', e=>{
    if(e.key==='Enter') inp.blur();
    if(e.key==='Escape'){ inp.value=oldName; inp.blur(); }
  });
}

function deselectPreset(e){
  if(e && e.target.closest('.preset-item')) return;
  document.querySelectorAll('.preset-item').forEach(i=>i.classList.remove('active-preset'));
  ACTIVE_PRESET_ID = null;
}

function flushAll(){
  document.querySelectorAll('.ttable-wrap tr[data-tool-index]').forEach(function(row){
    var i = +row.getAttribute('data-tool-index');
    if(!TOOLS[i]) return;
    row.querySelectorAll('input.tf[data-field]').forEach(function(inp){
      var field = inp.getAttribute('data-field');
      var val = inp.value;
      if(field === 'tool_number'){
        TOOLS[i][field] = Math.max(1, Math.floor(+val||1));
      } else if(field === 'depth'){
        // depth handled by validateDepth
      } else if(field === 'rpm'){
        TOOLS[i][field] = n2gSafeRpm(val);
        inp.value = TOOLS[i][field];
      } else {
        TOOLS[i][field] = +val;
      }
    });
    // Drill: đảm bảo feed mặc định
    if(TOOLS[i].type === 'drill' && (!TOOLS[i].feed || TOOLS[i].feed < 100)){
      TOOLS[i].feed = 6000;
    }
  });
}

function saveToolPreset(){
  flushAll();
  // Tìm preset đang active trong sidebar
  const activeItem = document.querySelector('.preset-item.active-preset');
  const activeId = activeItem ? activeItem.dataset.id : null;
  const activePreset = activeId ? TOOL_PRESETS.find(p=>String(p.id)===String(activeId)) : null;

  if(activePreset){
    // Đang active → lưu đè trực tiếp không hỏi
    activePreset.tools = JSON.parse(JSON.stringify(TOOLS));
    savePresetsToRuby();
    sketchup.save_layer_map_callback(JSON.stringify(TOOLS));
    renderToolPresets();
    updateSidebarLayerStatus();
    setTimeout(function(){
      var item = document.querySelector('.preset-item[data-id="'+activeId+'"]');
      if(item) item.classList.add('active-preset');
    }, 50);
    setStatus('ok', 'Đã lưu đè mẫu: "'+activePreset.name+'"');
    return;
  }

  // Không có active → mở modal đặt tên mới
  _presetOverwriteId = null;
  const input = document.getElementById('preset-name-input');
  const hint = document.getElementById('preset-overwrite-hint');
  input.value = `Mẫu ${TOOL_PRESETS.length+1}`;
  hint.style.display = 'none';
  document.getElementById('preset-modal').classList.add('show');
  forceRepaint(document.getElementById('preset-modal'));
  setTimeout(()=>{input.focus();input.select();}, 50);
}

function closePresetModal(ok){
  document.getElementById('preset-modal').classList.remove('show');
  if(!ok) return;
  const name=document.getElementById('preset-name-input').value.trim();
  if(!name) return;

  var savedId = null;

  // Kiểm tra có trùng tên với mẫu khác không → nếu có thì overwrite mẫu đó
  const existingByName=TOOL_PRESETS.find(p=>p.name===name&&p.id!==_presetOverwriteId);
  if(existingByName){
    existingByName.tools=JSON.parse(JSON.stringify(TOOLS));
    savedId = existingByName.id;
    savePresetsToRuby();sketchup.save_layer_map_callback(JSON.stringify(TOOLS));
    renderToolPresets();setStatus('ok','Đã cập nhật mẫu: "'+name+'"');
  } else if(_presetOverwriteId){
    const p=TOOL_PRESETS.find(p=>p.id===_presetOverwriteId);
    if(p){
      p.name=name; p.tools=JSON.parse(JSON.stringify(TOOLS));
      savedId = p.id;
      savePresetsToRuby();sketchup.save_layer_map_callback(JSON.stringify(TOOLS));
      renderToolPresets();setStatus('ok','Đã cập nhật mẫu: "'+name+'"');
    }
  } else {
    savedId = Date.now();
    TOOL_PRESETS.push({id:savedId, name, tools:JSON.parse(JSON.stringify(TOOLS))});
    savePresetsToRuby();sketchup.save_layer_map_callback(JSON.stringify(TOOLS));
    renderToolPresets();setStatus('ok','Đã lưu mẫu mới: "'+name+'"');
  }

  // Active vào mẫu vừa lưu
  if(savedId){
    ACTIVE_PRESET_ID = savedId;
    updateSidebarLayerStatus();
    setTimeout(function(){
      document.querySelectorAll('.preset-item').forEach(function(i){ i.classList.remove('active-preset'); });
      var item = document.querySelector('.preset-item[data-id="'+savedId+'"]');
      if(item) item.classList.add('active-preset');
      try{ sketchup.save_settings_callback(JSON.stringify(STG)); }catch(e){}
      try{ sketchup.save_active_preset_callback(String(savedId)); }catch(e){}
    }, 50);
  }
}

function loadToolPreset(id,el,isInit){
  const p=TOOL_PRESETS.find(p=>String(p.id)===String(id));if(!p)return;
  // Validate depth
  const tools = JSON.parse(JSON.stringify(p.tools)).map(t=>{
    t.rpm = n2gSafeRpm(t.rpm);
    if(Math.abs(+t.depth) > 200) t.depth = 17.1;
    // Fix giá trị feed bị lưu sai (< 100 → nhân 1000)
    if(t.z_feed && +t.z_feed < 100) t.z_feed = +t.z_feed * 1000;
    if(t.feed   && +t.feed   < 100) t.feed   = +t.feed   * 1000;
    return t;
  });
  TOOLS=tools;
  ACTIVE_PRESET_ID = id;   // nhớ mẫu đang active để giữ qua các lần re-render
  // Lưu active preset — KHÔNG lưu lúc init (isInit) để không ghi đè lựa chọn phiên trước.
  if(STG_READY && !isInit){
    try{ sketchup.save_settings_callback(JSON.stringify(STG)); }catch(e){}
    try{ sketchup.save_active_preset_callback(String(id)); }catch(e){}
  }
  selectedToolRow=-1;renderToolTable();checkToolDiameterWarnings();
  document.querySelectorAll('.preset-item').forEach(c=>c.classList.remove('active-preset'));
  const item=document.querySelector(`.preset-item[data-id="${id}"]`);
  if(item) item.classList.add('active-preset');
  const allLayers=new Set(ALL_LAYERS);
  const missing=p.tools.filter(t=>t.layer&&!allLayers.has(t.layer)).length;
  setStatus(missing>0?'warn':'ok', missing>0
    ?`Đã load mẫu "${p.name}" — ${missing} layer chưa có trong nesting`
    :`Đã load mẫu: "${p.name}"`);
}

function deleteToolPreset(id){
  TOOL_PRESETS=TOOL_PRESETS.filter(p=>p.id!==id);savePresetsToRuby();renderToolPresets();
}

function renderToolPresets(){
  const sidebar=document.getElementById('chip-bar-sidebar');
  if(sidebar){
    sidebar.innerHTML=TOOL_PRESETS.length?TOOL_PRESETS.map(p=>`
      <div class="preset-item" data-id="${p.id}" onclick="loadToolPreset(${p.id},this)">
        <span class="preset-item-name" title="Double click để đổi tên" ondblclick="event.stopPropagation();renamePreset(${p.id},this)">${esc(p.name)}</span>
        <span class="preset-item-dup" onclick="event.stopPropagation();duplicateToolPreset(${p.id})" title="Nhân bản mẫu này"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 11V4a1 1 0 0 1 1-1h7"/></svg></span>
        <span class="preset-item-del" onclick="event.stopPropagation();confirmDeletePreset(${p.id},this)" title="Xóa mẫu">✕</span>
      </div>`).join('')
    :`<div style="padding:10px 14px;font-size:10px;color:var(--text3)">Chưa có mẫu nào</div>`;
  }
  const w=document.getElementById('chip-wrap');
  if(w) w.style.display='none';
  // Khôi phục đánh dấu active sau khi render lại (tránh mất active khi preview/redraw)
  if(ACTIVE_PRESET_ID!=null){
    const act=document.querySelector(`.preset-item[data-id="${ACTIVE_PRESET_ID}"]`);
    if(act) act.classList.add('active-preset');
  }
}

function confirmDeletePreset(id, el){
  // Hiện confirm inline thay vì dialog
  const item = el.closest('.preset-item');
  const found = TOOL_PRESETS.find(p=>String(p.id)===String(id));
  const name = found ? found.name : '';
  item.innerHTML = `
    <span style="font-size:10px;color:#e05050;flex:1">Xóa "${esc(name)}"?</span>
    <span style="cursor:pointer;font-size:10px;color:var(--accent);padding:0 6px"
      onclick="event.stopPropagation();deleteToolPreset(${id})">Có</span>
    <span style="cursor:pointer;font-size:10px;color:var(--text3);padding:0 4px"
      onclick="event.stopPropagation();renderToolPresets()">Không</span>
  `;
}

function updateToolPreset(id){
  const p=TOOL_PRESETS.find(p=>p.id===id);if(!p)return;
  flushAll();
  p.tools=JSON.parse(JSON.stringify(TOOLS));
  savePresetsToRuby();sketchup.save_layer_map_callback(JSON.stringify(TOOLS));
  setStatus('ok',`Đã cập nhật mẫu: "${p.name}"`);
}

function duplicateToolPreset(id){
  const src=TOOL_PRESETS.find(p=>String(p.id)===String(id));
  if(!src)return;
  // Tên bản sao không trùng: thêm "(copy)", nếu đã tồn tại thì thêm số
  let base=src.name+' (copy)';
  let name=base, n=2;
  while(TOOL_PRESETS.some(p=>p.name===name)){ name=base+' '+n; n++; }
  const newId=Date.now();
  TOOL_PRESETS.push({
    id:newId,
    name:name,
    tools:JSON.parse(JSON.stringify(src.tools||[]))
  });
  savePresetsToRuby();
  renderToolPresets();
  setStatus('ok',`Đã nhân bản mẫu: "${src.name}" → "${name}"`);
}

function savePresetsToRuby(){sketchup.save_tool_presets_callback(JSON.stringify(TOOL_PRESETS))}
// ── Input Modal ──────────────────────────────────────────────────────────────
let _inputExResolve=null;
// ── New Toolset Modal ─────────────────────────────────────────────────────────
function showNewToolsetModal(){
  const list = document.getElementById('ntm-layer-list');
  list.innerHTML = ALL_LAYERS.filter(l=>!isIgnoredLayer(l)).map(l=>`
    <label style="display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--border);border-radius:5px;cursor:pointer;font-size:11px;transition:background .1s" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
      <input type="checkbox" value="${esc(l)}" checked style="accent-color:var(--accent);width:14px;height:14px;flex-shrink:0" onchange="ntmUpdateCount()">
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l)}">${esc(l)}</span>
    </label>`).join('');
  ntmUpdateCount();
  document.getElementById('new-toolset-modal').style.display='flex';
}

function ntmUpdateCount(){
  const n = document.querySelectorAll('#ntm-layer-list input:checked').length;
  const el = document.getElementById('ntm-count');
  if(el) el.textContent = `${n} / ${ALL_LAYERS.length} layer`;
}

function ntmCheckAll(val){
  document.querySelectorAll('#ntm-layer-list input').forEach(i=>i.checked=val);
  ntmUpdateCount();
}

function closeNewToolsetModal(){
  document.getElementById('new-toolset-modal').style.display='none';
}

function ntmFillFromTool(name){}

function getDefaultFeed(diameter, type){
  if(type==='drill') return 2000;
  if(diameter >= 6) return 12000;
  if(diameter >= 5) return 8000;
  if(diameter >= 4) return 6000;
  return 4000;
}

function getDefaultZFeed(diameter){
  return diameter >= 5 ? 5000 : 3000;
}

function applyNewToolset(){
  const checked=[...document.querySelectorAll('#ntm-layer-list input:checked')].map(i=>i.value);
  if(!checked.length){ setStatus('warn','Chọn ít nhất 1 layer'); return; }

  closeNewToolsetModal();

  // Bỏ active bộ dao đang chọn
  document.querySelectorAll('.preset-item').forEach(function(i){ i.classList.remove('active-preset'); });

  // Loading trong khu vực table
  var wrap = document.getElementById('tools-content');
  var loader = document.createElement('div');
  loader.id = 'tool-table-loader';
  loader.style.cssText = 'position:absolute;inset:0;background:rgba(244,244,242,0.85);display:flex;align-items:center;justify-content:center;z-index:20;border-radius:4px';
  loader.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;gap:10px"><div class="spin"></div><div style="font-size:10px;color:var(--text3);font-family:var(--mono);letter-spacing:1px">ĐANG TẠO BỘ DAO...</div></div>';
  wrap.style.position = 'relative';
  wrap.appendChild(loader);

  setTimeout(function(){

    // Helper: tìm dao theo diameter trong bộ công cụ đang active
    function findToolByDiameter(dia){
      var allTools = [];
      ALL_TOOL_GROUPS.forEach(function(g){ if(g.tools) allTools = allTools.concat(g.tools); });
      if(!allTools.length) allTools = ALL_TOOLS_LIST;
      return allTools.find(function(t){ return Math.abs((t.diameter||0) - dia) < 0.1; }) || null;
    }

    // Helper: tìm diameter từ tên layer (ABF_D5 → 5, ABF_D15 → 15)
    function extractDiameter(layerName){
      var m = layerName.match(/D(\d+(?:\.\d+)?)$/i);
      return m ? parseFloat(m[1]) : null;
    }

    TOOLS = checked.map(function(layer){
      const cfg = detectLayerConfig(layer);
      var dia = cfg.type==='drill' ? 5 : 6;
      var toolName = '';
      var rpm = 18000;
      var toolNumber = 1;

      // Nếu là khoan → tìm diameter từ tên layer rồi match với bộ dao
      if(cfg.type === 'drill'){
        var extractedDia = extractDiameter(layer);
        if(extractedDia) dia = extractedDia;
        var matched = findToolByDiameter(dia);
        if(matched){
          toolName   = matched.name || '';
          dia        = matched.diameter || dia;
          rpm        = matched.rpm || rpm;
          toolNumber = matched.tool_number || 1;
        }
      }

      return {
        layer, name: toolName, color:'#888888',
        diameter: dia,
        depth: cfg.depth || (cfg.type==='drill' ? '10' : '17.1'),
        type: cfg.type,
        strategy: cfg.strategy,
        direction: cfg.type==='pocket' ? 'in_out' : undefined,
        bit_type: 'flat',
        vbit_angle: 120,
        stepover: 95,
        rpm: rpm,
        feed:   getDefaultFeed(dia, cfg.type),
        z_feed: getDefaultZFeed(dia),
        tool_number: toolNumber
      };
    });

    // Sort 1 lần: Khoan (nhỏ→lớn) → Hạ nền → Cắt → ABF_CUTTINGLINES cuối
    TOOLS.sort(function(a,b){
      var order = function(t){
        if(t.layer==='ABF_CUTTINGLINES') return 99;
        if(t.type==='drill')  return 0;
        if(t.type==='pocket') return 1;
        return 2;
      };
      var oa=order(a), ob=order(b);
      if(oa!==ob) return oa-ob;
      if(a.type==='drill'&&b.type==='drill') return a.diameter-b.diameter;
      return 0;
    });

    selectedToolRow = -1;
    var l = document.getElementById('tool-table-loader');
    if(l) l.remove();
    renderToolTable();
    checkToolDiameterWarnings();
    setStatus('ok', 'Đã tạo bộ dao ' + checked.length + ' layer — chọn dao cho từng dòng rồi lưu mẫu');
  }, 500);
}

function showInputModal(title, defaultVal=''){
  return new Promise(resolve=>{
    _inputExResolve=resolve;
    document.getElementById('input-modal-ex-title').textContent=title;
    const f=document.getElementById('input-modal-ex-field');
    f.value=defaultVal||'';
    document.getElementById('input-modal-ex').classList.add('show');
    forceRepaint(document.getElementById('input-modal-ex'));
    setTimeout(()=>{f.focus();f.select();},50);
  });
}
function closeInputModalEx(ok){
  document.getElementById('input-modal-ex').classList.remove('show');
  const val=document.getElementById('input-modal-ex-field').value.trim();
  if(_inputExResolve){_inputExResolve(ok&&val?val:null);_inputExResolve=null;}
}

// ── Tính mốc độ sâu các lần xuống dao (dùng chung preview/sim; port sang Ruby) ──
// C: độ sâu cắt. A: độ dày lớp cắt cuối. B: số lần xuống dao.
// B=1 → [C]. A<=0 hoặc A>=C → chia ĐỀU C thành B bước. Ngược lại → (C-A)*k/(B-1)
// cho k=1..B-1 rồi lần cuối = C. Trả mảng B mốc TĂNG DẦN, cuối = C.
function computePassDepthsJS(C, A, B){
  C = Math.abs(+C || 0);
  A = Math.abs(+A || 0);
  B = Math.max(1, Math.round(+B || 1));
  if(A > C) A = C;
  if(B <= 1) return [Math.round(C*1000)/1000];
  var out = [], k;
  if(A <= 0 || (C - A) < 0.001){
    for(k=1;k<=B;k++) out.push(Math.round(C*k/B*1000)/1000);
  } else {
    for(k=1;k<=B-1;k++) out.push(Math.round((C-A)*k/(B-1)*1000)/1000);
    out.push(Math.round(C*1000)/1000);
  }
  return out;
}

// Giải độ sâu cắt C ra SỐ từ t.depth (số, hoặc biểu thức "Z-1.2"), dùng độ dày ván Z.
function lteResolveDepthNum(depthStr, sheetZ){
  if(depthStr == null) return 0;
  if(typeof depthStr === 'number') return Math.abs(depthStr);
  var s = String(depthStr).trim();
  var num = parseFloat(s);
  if(/[Zz]/.test(s)){
    // dạng Z, Z-1.2, Z+0.1 → thay Z bằng sheetZ
    var m = s.replace(/[Zz]/, '('+(sheetZ||0)+')');
    try { var v = Function('return '+m)(); return Math.abs(+v||0); } catch(e){ return Math.abs(sheetZ||0); }
  }
  return Math.abs(num||0);
}

// Cảnh báo khi BƯỚC ăn dao (chênh lệch giữa 2 lần) > độ dày ván Z.
function lteCheckStepWarn(){
  var el = document.getElementById('lte-step-warn');
  if(!el) return;
  var A = Math.abs(+(document.getElementById('lte-finish_thickness')||{}).value || 0);
  var B = Math.max(1, Math.round(+(document.getElementById('lte-num_passes')||{}).value || 1));
  var depthStr = (document.getElementById('lte-depth')||{}).value;
  var sheetZ = (typeof simSheetThickness==='function') ? (simSheetThickness()||0) : 0;
  var C = lteResolveDepthNum(depthStr, sheetZ);
  if(C <= 0){ el.style.display='none'; return; }
  // B=1: cắt 1 lần → bước = toàn bộ C, đương nhiên > Z. Đây là lựa chọn cố ý của
  // người dùng, KHÔNG cảnh báo. Chỉ cảnh báo khi B>=2 mà bước vẫn quá lớn.
  if(B <= 1){ el.style.display='none'; return; }
  var depths = computePassDepthsJS(C, A, B);
  // bước lớn nhất
  var maxStep = 0, prev = 0;
  for(var i=0;i<depths.length;i++){ var st = depths[i]-prev; if(st>maxStep) maxStep=st; prev=depths[i]; }
  // Ngưỡng = độ dày ván Z. Nếu không có Z (chưa nest), dùng C.
  var limit = sheetZ > 0 ? sheetZ : C;
  if(maxStep > limit + 0.001){
    el.style.display='';
    el.innerHTML = '⚠ Bước ăn dao lớn nhất <b>'+maxStep.toFixed(1)+'mm</b> vượt quá độ dày ván <b>'+limit.toFixed(1)+'mm</b>. Cân nhắc tăng số lần xuống dao.';
  } else {
    el.style.display='none';
  }
}
