// ── Export ────────────────────────────────────────────────────
var _exportPendingResolve = null;
var _thickPendingResolve = null;
var IGNORED_LAYERS = new Set();

// Polyfill CSS.escape cho SketchUp 2021
if(typeof CSS === 'undefined' || !CSS.escape){
  window.CSS = window.CSS || {};
  CSS.escape = function(s){
    return String(s).replace(/([^\w-])/g, '\\$1');
  };
}

function loadIgnoredLayers(){
  try { sketchup.load_ignored_layers_callback(); } catch(e){}
}

function n2gSetIgnoredLayers(arr){
  IGNORED_LAYERS = new Set((arr||[]).map(function(l){ return normalizeLayer(l); }));
  _checkUnconfiguredLayers();
}

function _checkUnconfiguredLayers(){
  if(!ALL_LAYERS || ALL_LAYERS.length === 0) return;
  var configuredLayers = new Set(TOOLS.map(function(t){ return normalizeLayer(t.layer); }));
  var unconfigured = ALL_LAYERS.filter(function(l){ return !configuredLayers.has(l) && !isIgnoredLayer(l); });
  if(unconfigured.length > 0){
    setStatus('warn', '⚠ ' + unconfigured.length + ' layer chưa cấu hình dao: ' + unconfigured.join(', '));
  } else {
    setStatus('ok', SHEETS.length + ' tấm · ' + TOOLS.length + ' dao · ' + ALL_LAYERS.length + ' layers');
  }
}

function showWarnModal(layers, isInit){
  return new Promise(function(resolve){
    _exportPendingResolve = resolve;
    // Khôi phục phần mô tả + hint (có thể đã bị modal cảnh báo độ dày đổi/ẩn)
    var _desc = document.getElementById('warn-desc');
    if(_desc) _desc.innerHTML = 'Các layer sau có trong nesting nhưng <strong>chưa được gán dao</strong> — sẽ <strong style="color:var(--danger)">không được cắt</strong> khi xuất G-code:';
    var _hint = document.getElementById('warn-hint');
    if(_hint) _hint.style.display = '';
    var list = document.getElementById('warn-layer-list');
    list.innerHTML = layers.map(function(l){
      var ign = IGNORED_LAYERS.has(normalizeLayer(l));
      var safeId = l.replace(/[^a-zA-Z0-9_-]/g, '_');
      return '<div class="warn-layer-row' + (ign ? ' ignored' : '') + '" id="wrow-' + safeId + '">' +
        '<label>' +
          '<input type="checkbox" ' + (ign ? 'checked' : '') + ' onchange="toggleIgnoreLayer(\'' + l.replace(/\\/g,'\\\\').replace(/'/g,"\\'") + '\',this.checked)">' +
          '<span class="layer-name">◈ ' + l + '</span>' +
          '<span style="font-size:10px;color:var(--text3);margin-left:auto">' + (ign ? 'bỏ qua' : '') + '</span>' +
        '</label>' +
      '</div>';
    }).join('');
    var title = document.querySelector('#warn-modal .warn-title');
    var footer = document.querySelector('#warn-modal .warn-footer');
    if(isInit){
      if(title) title.textContent = 'Layer chưa được cấu hình dao';
      if(footer) footer.innerHTML =
        '<button class="tbtn" onclick="closeWarnModal(false)">Đã hiểu — Đi cấu hình dao</button>' +
        '<button class="tbtn tbtn-p" onclick="closeWarnModal(true)">Bỏ qua tất cả</button>';
    } else {
      if(title) title.textContent = 'Layer chưa được cấu hình dao';
      if(footer) footer.innerHTML =
        '<button class="tbtn" onclick="closeWarnModal(false)" style="background:transparent;border:1px solid var(--border2);color:var(--text2)">Huỷ — Quay lại cấu hình</button>' +
        '<button class="tbtn tbtn-p" onclick="closeWarnModal(true)">Vẫn xuất G-code</button>';
    }
    document.getElementById('warn-modal').classList.add('show');
    forceRepaint(document.getElementById('warn-modal'));
  });
}

function toggleIgnoreLayer(layer, checked){
  var n = normalizeLayer(layer);
  if(checked) IGNORED_LAYERS.add(n);
  else IGNORED_LAYERS.delete(n);
  var safeId = layer.replace(/[^a-zA-Z0-9_-]/g, '_');
  var row = document.getElementById('wrow-' + safeId);
  if(row){
    row.classList.toggle('ignored', checked);
    var hint = row.querySelector('span:last-child');
    if(hint) hint.textContent = checked ? 'bỏ qua' : '';
  }
  try { sketchup.save_ignored_layers_callback(JSON.stringify([...IGNORED_LAYERS])); } catch(e){}
}

function closeWarnModal(proceed){
  document.getElementById('warn-modal').classList.remove('show');
  if(_exportPendingResolve){ _exportPendingResolve(proceed); _exportPendingResolve = null; }
}

function checkBeforeExport(){
  var configuredLayers = new Set(TOOLS.map(function(t){ return normalizeLayer(t.layer); }));
  var unconfigured = ALL_LAYERS.filter(function(l){ return !configuredLayers.has(l) && !isIgnoredLayer(l); });

  // Sau khi qua bước kiểm layer, kiểm ĐỘ DÀY: nếu có tấm > 20mm (thường do tên vật
  // liệu chứa mã "MM" bị hiểu nhầm là độ dày), cảnh báo để người dùng kiểm tra lại.
  var _afterLayer = function(){
    var over = getThickWarnings(20);
    if(over.length){
      showThickWarnModal(over).then(function(cont){
        if(cont){
          showExportConfirm();          // Xác nhận và tiếp tục
        } else {
          // Kiểm tra lại → mở tab Cài đặt - Vùng gia công để sửa độ dày thực tế
          try{ switchTab('settings'); }catch(e){}
          var el = document.querySelector('.settings-nav-item[data-stg="workarea"]');
          if(el) try{ switchStgTab('workarea', el); }catch(e){}
        }
      });
    } else {
      showExportConfirm();
    }
  };

  if(unconfigured.length > 0){
    showWarnModal(unconfigured, false).then(function(proceed){
      if(proceed) _afterLayer();
    });
  } else {
    _afterLayer();
  }
}

// Trả danh sách độ dày > limit (mm). Độ dày thực = workarea.actual_thickness nếu người
// dùng đã nhập, ngược lại = số đọc từ tên sheet. Khi người dùng sửa actual về <= limit
// thì lần sau không còn cảnh báo (vì tính theo actual).
function getThickWarnings(limit){
  var out = [], seen = {};
  var sheets = (typeof SHEETS !== 'undefined' ? SHEETS : []);
  sheets.forEach(function(s){
    var nm = (s.name||'');
    // Nominal theo đúng field độ dày; fallback lấy cụm "Xmm" cuối (tránh nhầm mã đầu)
    var m = nm.match(/^(.+?)-(\d+(?:\.\d+)?mm)-(.+)$/i);
    var nominal = m ? m[2] : null;
    if(!nominal){ var all = nm.match(/(\d+(?:\.\d+)?mm)/gi); nominal = all ? all[all.length-1] : null; }
    if(!nominal) return;
    var wa = (STG.workarea && STG.workarea[nominal]) ? STG.workarea[nominal] : null;
    var hasActual = wa && wa.actual_thickness != null && wa.actual_thickness !== '';
    var actual = hasActual ? parseFloat(wa.actual_thickness) : parseFloat(nominal);
    if(isNaN(actual)) return;
    if(actual > limit && !seen[nominal]){ seen[nominal] = true; out.push({ key: nominal, mm: actual }); }
  });
  return out;
}

function showThickWarnModal(overList){
  return new Promise(function(resolve){
    _thickPendingResolve = resolve;
    // Đổi phần mô tả sang nội dung độ dày, và ẩn dòng hint "tick bỏ qua" (không dùng ở đây)
    var _desc = document.getElementById('warn-desc');
    if(_desc) _desc.innerHTML = 'Các độ dày sau <strong>vượt 20mm</strong> — thường do tên vật liệu chứa chữ "MM" bị hiểu nhầm là độ dày. Kiểm tra lại độ dày thực tế trước khi cắt:';
    var _hint = document.getElementById('warn-hint');
    if(_hint) _hint.style.display = 'none';
    var list = document.getElementById('warn-layer-list');
    if(list){
      list.innerHTML = overList.map(function(o){
        return '<div class="warn-layer-row"><label>' +
          '<span class="layer-name">⚠ ' + o.key + ' → <b>' + o.mm + 'mm</b>' +
          ' <span style="color:var(--text3);font-size:10px">(vượt 20mm)</span></span>' +
        '</label></div>';
      }).join('');
    }
    var title  = document.querySelector('#warn-modal .warn-title');
    var footer = document.querySelector('#warn-modal .warn-footer');
    if(title) title.textContent = 'Phát hiện độ dày ván bất thường';
    if(footer) footer.innerHTML =
      '<button class="tbtn" onclick="closeThickWarn(false)" style="background:transparent;border:1px solid var(--border2);color:var(--text2)">Kiểm tra lại</button>' +
      '<button class="tbtn tbtn-p" onclick="closeThickWarn(true)">Xác nhận và tiếp tục</button>';
    document.getElementById('warn-modal').classList.add('show');
    forceRepaint(document.getElementById('warn-modal'));
  });
}

function closeThickWarn(proceed){
  document.getElementById('warn-modal').classList.remove('show');
  if(_thickPendingResolve){ _thickPendingResolve(proceed); _thickPendingResolve = null; }
}

var _ecShowAllTools=false;

function ecNestingLayerSet(){
  var layers=new Set();
  (typeof SHEETS!=='undefined' ? SHEETS : []).forEach(function(sheet){
    (sheet.display||[]).forEach(function(v){
      var layer=(typeof editEffectiveLayer==='function') ? editEffectiveLayer(v,sheet.name) : v.layer;
      if(layer) layers.add(normalizeLayer(layer));
    });
  });
  return layers;
}

function ecVisibleToolRecords(){
  var nestingLayers=ecNestingLayerSet();
  return (TOOLS||[]).map(function(tool,index){return {tool:tool,index:index};})
    .filter(function(record){
      return _ecShowAllTools || nestingLayers.has(normalizeLayer(record.tool.layer));
    });
}

function ecToolRowsHtml(records){
  if(!records.length){
    return '<tr><td colspan="7" style="padding:14px 8px;text-align:center;color:var(--text3)">Không có layer của bộ dao trong nesting hiện tại</td></tr>';
  }
  return records.map(function(record){
    var t=record.tool;
    return '<tr style="border-bottom:1px solid var(--border)">' +
      '<td style="padding:6px 8px;color:var(--text3);font-size:10px">' + (record.index+1) + '</td>' +
      '<td style="padding:6px 8px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + (t.color||'#888') + ';margin-right:5px"></span>' + esc(t.layer||'—') + '</td>' +
      '<td style="padding:6px 8px;color:var(--text2)">' + esc(t.name||'—') + '</td>' +
      '<td style="padding:6px 8px;text-align:center">D' + esc(String(t.diameter)) + '</td>' +
      '<td style="padding:6px 8px;text-align:center">' + esc(t.type||'—') + '</td>' +
      '<td style="padding:6px 8px;text-align:center;color:#d94040">' + esc(String(t.depth)) + '</td>' +
      '<td style="padding:6px 8px;text-align:center;color:var(--text3)">' + esc(String(t.feed)) + '</td>' +
    '</tr>';
  }).join('');
}

function ecRenderToolSummary(){
  var records=ecVisibleToolRecords();
  var tbody=document.getElementById('export-confirm-tool-body');
  if(tbody) tbody.innerHTML=ecToolRowsHtml(records);
  var countEl=document.querySelector('#export-confirm-modal [data-tool-count]');
  if(countEl){
    countEl.textContent=_ecShowAllTools ?
      'Bộ dao — toàn bộ '+TOOLS.length+' layer' :
      'Trong nesting — '+records.length+'/'+TOOLS.length+' layer';
  }
  var toggle=document.getElementById('ec-toggle-all-tools');
  if(toggle){
    toggle.style.display=records.length<TOOLS.length || _ecShowAllTools ? '' : 'none';
    toggle.textContent=_ecShowAllTools ? 'Thu gọn' : 'Xem thêm ('+(TOOLS.length-records.length)+')';
  }
}

function ecToggleAllTools(){
  _ecShowAllTools=!_ecShowAllTools;
  ecRenderToolSummary();
}

function showExportConfirm(){
  var postName = (document.getElementById('pp-save-name')||{value:''}).value.trim() || '(chưa đặt tên)';
  var header   = document.getElementById('pp-header').value.trim();
  var footer   = document.getElementById('pp-footer').value.trim();
  var ext      = document.getElementById('pp-ext').value || '.nc';
  var safez    = document.getElementById('pp-safez').value;

  _ecShowAllTools=false;
  var visibleToolRecords=ecVisibleToolRecords();
  var toolRows=ecToolRowsHtml(visibleToolRecords);

  var activeItem = document.querySelector('.preset-item.active-preset');
  var activeId = activeItem ? activeItem.dataset.id : (TOOL_PRESETS[0] ? String(TOOL_PRESETS[0].id) : '');
  var presetOpts = TOOL_PRESETS.map(function(p){
    return '<option value="' + p.id + '" ' + (String(p.id)===String(activeId)?'selected':'') + '>' + p.name + '</option>';
  }).join('');
  var postOpts = Object.values(PRESETS).map(function(p){
    return '<option value="' + p.id + '" ' + (p.name===postName?'selected':'') + '>' + (p.name||p.id) + '</option>';
  }).join('');

  document.getElementById('export-confirm-body').innerHTML =
    '<div style="margin-bottom:14px">' +
      '<div style="font-size:9px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Post Processor</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<span style="background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:3px 10px;font-size:11px;font-weight:600">' + postName + '</span>' +
        '<span style="background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:3px 10px;font-size:11px">' + ext + '</span>' +
        '<span style="background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:3px 10px;font-size:11px">Safe Z: ' + safez + 'mm</span>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">' +
        '<div><div style="font-size:9px;color:var(--text3);margin-bottom:3px">HEADER</div>' +
        '<pre style="margin:0;font-size:10px;background:var(--surface2);padding:6px 8px;border-radius:4px;border:1px solid var(--border);white-space:pre-wrap;color:var(--text2)">' + esc(header||'—') + '</pre></div>' +
        '<div><div style="font-size:9px;color:var(--text3);margin-bottom:3px">FOOTER</div>' +
        '<pre style="margin:0;font-size:10px;background:var(--surface2);padding:6px 8px;border-radius:4px;border:1px solid var(--border);white-space:pre-wrap;color:var(--text2)">' + esc(footer||'—') + '</pre></div>' +
      '</div>' +
    '</div>' +
    '<div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
        '<div style="font-size:9px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:1px" data-tool-count>Trong nesting — ' + visibleToolRecords.length + '/' + TOOLS.length + ' layer</div>' +
        '<div style="flex:1"></div>' +
        '<select id="ec-tool-preset" style="font-size:10px;padding:3px 8px;border:1px solid var(--border2);border-radius:4px;background:var(--surface2);color:var(--text1)" onchange="ecLoadToolPreset(this.value)">' +
          '<option value="">— Chọn bộ dao —</option>' + presetOpts +
        '</select>' +
        '<select id="ec-post-preset" style="font-size:10px;padding:3px 8px;border:1px solid var(--border2);border-radius:4px;background:var(--surface2);color:var(--text1)" onchange="ecLoadPost(this.value)">' +
          '<option value="">— Chọn post —</option>' + postOpts +
        '</select>' +
      '</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
        '<thead><tr style="background:var(--surface2)">' +
          '<th style="padding:5px 8px;text-align:left;font-weight:600;color:var(--text3);font-size:9px">#</th>' +
          '<th style="padding:5px 8px;text-align:left;font-weight:600;color:var(--text3);font-size:9px">LAYER</th>' +
          '<th style="padding:5px 8px;text-align:left;font-weight:600;color:var(--text3);font-size:9px">DAO</th>' +
          '<th style="padding:5px 8px;text-align:center;font-weight:600;color:var(--text3);font-size:9px">D</th>' +
          '<th style="padding:5px 8px;text-align:center;font-weight:600;color:var(--text3);font-size:9px">KIỂU</th>' +
          '<th style="padding:5px 8px;text-align:center;font-weight:600;color:var(--text3);font-size:9px">DEPTH</th>' +
          '<th style="padding:5px 8px;text-align:center;font-weight:600;color:var(--text3);font-size:9px">FEED</th>' +
        '</tr></thead>' +
        '<tbody id="export-confirm-tool-body">' + toolRows + '</tbody>' +
      '</table>' +
      '<div style="display:flex;justify-content:center;margin-top:8px">' +
        '<button id="ec-toggle-all-tools" class="tbtn" onclick="ecToggleAllTools()" style="padding:5px 16px;font-size:10px;' + (visibleToolRecords.length<TOOLS.length?'':'display:none;') + '">Xem thêm (' + (TOOLS.length-visibleToolRecords.length) + ')</button>' +
      '</div>' +
    '</div>';

  document.getElementById('export-confirm-modal').style.display = 'flex';
}

function ecLoadToolPreset(id){
  if(!id) return;
  var p = TOOL_PRESETS.find(function(p){ return String(p.id)===String(id); });
  if(!p||!p.tools) return;
  TOOLS = JSON.parse(JSON.stringify(p.tools));
  renderToolTable();
  _ecShowAllTools=false;
  ecRenderToolSummary();
}

function ecLoadPost(id){
  if(!id) return;
  loadPreset(id);
  showExportConfirm();
}

function closeExportConfirm(){
  document.getElementById('export-confirm-modal').style.display = 'none';
}

function confirmAndExport(){
  closeExportConfirm();
  // Bật overlay NGAY từ đầu (trước cả check_thickness + chọn folder).
  var _ov = document.getElementById('overlay');
  if(_ov) _ov.style.display='flex';
  var _ot = document.querySelector('#overlay .otxt');
  if(_ot) _ot.textContent = 'ĐANG CHUẨN BỊ...';
  // Nhả 2 khung hình cho overlay VẼ trước, rồi mới gọi Ruby (Ruby chiếm luồng).
  requestAnimationFrame(function(){
    requestAnimationFrame(function(){
      // Kiểm tra màu thiếu độ dày trước khi xuất
      try{ sketchup.check_thickness_callback(); }catch(e){ doExport(); }
    });
  });
}

// Ruby trả về danh sách màu thiếu độ dày + cờ sheet vô danh
var MANUAL_THICKNESS = {};   // màu → độ dày (mm) người dùng nhập
function n2gThicknessCheck(res){
  if(!res || res.error){ doExport(); return; }
  // Có sheet không nhận diện được màu → cảnh báo nesting lại, dừng
  if(res.has_unnamed){
    var _ov=document.getElementById('overlay'); if(_ov) _ov.style.display='none';
    document.getElementById('btn-export').disabled = false;
    showGConfirm(
      'Cảnh báo nesting',
      'Có tấm chưa nhận diện được màu vật liệu.<br><span style="color:var(--text2);font-size:12px">Vui lòng nesting lại bằng ABF để mỗi tấm có tên màu đầy đủ, rồi xuất lại.</span>',
      [{ label:'Đã hiểu', value:'ok', kind:'primary' }]
    );
    return;
  }
  // Có màu thiếu độ dày → hiện ô nhập cho từng màu
  if(res.missing_colors && res.missing_colors.length){
    var _ov2=document.getElementById('overlay'); if(_ov2) _ov2.style.display='none';
    openThicknessModal(res.missing_colors);
    return;
  }
  // Không thiếu gì → xuất luôn
  doExport();
}

function openThicknessModal(colors){
  MANUAL_THICKNESS = {};
  var rows = colors.map(function(c){
    return '<div class="thk-row">'+
      '<span class="thk-color">'+c+'</span>'+
      '<input type="number" class="thk-input" data-color="'+c.replace(/"/g,'&quot;')+'" '+
        'value="17" step="0.1" min="1" max="100"> mm'+
      '</div>';
  }).join('');
  document.getElementById('thk-rows').innerHTML = rows;
  document.getElementById('thickness-modal').classList.add('show');
}
function closeThicknessModal(){
  document.getElementById('btn-export').disabled = false;
  document.getElementById('thickness-modal').classList.remove('show');
}
function confirmThickness(){
  var inputs = document.querySelectorAll('#thk-rows .thk-input');
  var ok = true;
  inputs.forEach(function(inp){
    var v = parseFloat(inp.value);
    if(isNaN(v) || v <= 0){ ok = false; inp.style.borderColor = '#d9342b'; }
    else { MANUAL_THICKNESS[inp.getAttribute('data-color')] = v; }
  });
  if(!ok) return;
  document.getElementById('thickness-modal').classList.remove('show');
  doExport();
}

function n2gLicenseOk(){
  doExport();
}

function n2gLicenseFail(msg){
  var ov = document.getElementById('overlay');
  if(ov) ov.style.display='none';   // tắt overlay đã bật ở doExport
  document.getElementById('btn-export').disabled = false;
  setStatus('warn', '⚠ ' + (msg || 'Bản quyền không hợp lệ'));
}

// Lấy text option đang chọn trong dropdown (rỗng nếu là placeholder "— Chọn... —")
function n2gSelectedText(selectId){
  var el=document.getElementById(selectId);
  if(!el || el.selectedIndex<0) return '';
  var txt=(el.options[el.selectedIndex].text||'').trim();
  // bỏ qua option placeholder (bắt đầu bằng "—")
  if(!el.value || txt.charAt(0)==='—') return '';
  return txt;
}

var _n2gExportInFlight = false;

function doExport(){
  // UI.messagebox của SketchUp vẫn xử lý event khi đang mở. Chặn callback
  // lặp gửi thêm yêu cầu xuất và tạo nhiều hộp cảnh báo lồng nhau.
  if(_n2gExportInFlight) return;
  _n2gExportInFlight = true;
  setStatus('busy', 'Đang xuất G-code...');
  // Overlay đã hiện từ confirmAndExport. Đảm bảo vẫn hiện (phòng đường gọi khác).
  var _ov = document.getElementById('overlay');
  if(_ov) _ov.style.display='flex';
  var _ot = document.querySelector('#overlay .otxt');
  if(_ot && (!_ot.textContent || _ot.textContent.indexOf('XUẤT')<0)) _ot.textContent = 'ĐANG CHUẨN BỊ...';
  _doExportSend();
}

function n2gBuildPocketPathsForExport(){
  var out={};
  _n2gPocketExportWarnings=[];
  if(typeof SHEETS==='undefined' || typeof drawToolpathPocket!=='function') return out;
  SHEETS.forEach(function(sheet){
    (TOOLS||[]).filter(function(tool){return tool.type==='pocket';}).forEach(function(tool){
      var vecs=(sheet.display||[]).filter(function(v){
        var eff=(typeof editEffectiveLayer==='function') ? editEffectiveLayer(v,sheet.name) : v.layer;
        return eff===tool.layer;
      });
      if(!vecs.length) return;
      var cv=document.createElement('canvas'); cv.width=2; cv.height=2;
      var ctx=cv.getContext('2d');
      tpRenderedPaths=[];
      drawToolpathPocket(ctx,vecs,tool,function(x){return x;},function(y){return y;},1,1);
      var rendered=tpRenderedPaths.filter(function(p){return p.type==='pocket';});
      var computedEmpty=rendered.length===0 || rendered.every(function(p){
        return Array.isArray(p.runs) && p.runs.every(function(run){return Array.isArray(run) && run.length===0;});
      });
      if(computedEmpty){
        _n2gPocketExportWarnings.push({sheet:sheet.name,layer:tool.layer,diameter:+tool.diameter||0});
      }
      out[sheet.name+'::'+tool.layer]=rendered.map(function(p){
        return {
          bxMin:p.bxMin,bxMax:p.bxMax,byMin:p.byMin,byMax:p.byMax,
          runs:(p.runs||[]).map(function(run){return run.map(function(q){return {x:q.x,y:q.y};});})
        };
      });
    });
  });
  return out;
}

function n2gBuildProfilePathsForExport(){
  var out={};
  _n2gProfileExportWarnings=[];
  var engine=(typeof window!=='undefined' && window.N2G_PROFILE_OFFSET_ENGINE) || 'clipper';
  if(typeof SHEETS==='undefined' || typeof profileOffsetClipper!=='function') return out;
  SHEETS.forEach(function(sheet){
    (TOOLS||[]).filter(function(tool){
      var ln=(tool.layer||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      return tool.type==='profile' && !(tool.bit_type==='vbit' && tool.strategy==='cut_in') && ln!=='ABFMARKSQUARE';
    }).forEach(function(tool){
      var vecs=(sheet.display||[]).filter(function(v){
        var eff=(typeof editEffectiveLayer==='function') ? editEffectiveLayer(v,sheet.name) : v.layer;
        return eff===tool.layer && !v.is_drill_center && Math.hypot(v.x2-v.x1,v.y2-v.y1)>0.1;
      });
      if(!vecs.length) return;
      var loops=buildLoopsJS(vecs);
      var bbs=loops.map(function(loop){
        var xs=loop.flatMap(function(e){return[e.x1,e.x2];}),ys=loop.flatMap(function(e){return[e.y1,e.y2];});
        return{xMin:Math.min.apply(null,xs),xMax:Math.max.apply(null,xs),yMin:Math.min.apply(null,ys),yMax:Math.max.apply(null,ys)};
      });
      var islands=detectIslandJS(loops,bbs), records=[];
      loops.forEach(function(loop,li){
        // CuttingLines represents closed part contours. A lone open edge that
        // is shorter than the cutter is a stranded contour fragment, not a
        // machinable profile. Do not create a legacy record for it.
        var layerNorm=(tool.layer||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
        var isCuttingLayer=layerNorm.indexOf('CUTTINGLINES')>=0;
        if(isCuttingLayer && !loop._closed && loop.length===1){
          var lone=loop[0];
          var loneLen=Math.hypot(lone.x2-lone.x1,lone.y2-lone.y1);
          if(loneLen < (+tool.diameter||0)) return;
        }
        var strategy=islands[li] ? 'cut_in' : tool.strategy;
        var circ=detectCircleJS(loop);
        var tooSmallCircle=!!circ && strategy==='cut_in' && circ.r <= (+tool.diameter||0)/2 + 0.001;
        if(tooSmallCircle){
          records.push({id:profileLoopIdJS(loop),key:profileLoopKeyJS(loop),strategy:strategy,
            mode:'skip',runs:[],reason:'tool_too_large'});
          return;
        }
        var scopeOK=(typeof profileClipperAppliesJS==='function') ?
          profileClipperAppliesJS(!!islands[li],strategy) : !!islands[li];
        var useClipper=scopeOK && !!loop._closed && (engine!=='legacy'||strategy==='cut_out') &&
          (strategy==='cut_in'||strategy==='cut_out') && !circ;
        var runs=useClipper ? profileOffsetClipper(loop,tool.diameter/2,strategy) : [];
        var clipperOK=useClipper && Array.isArray(runs) && runs.length>0;
        var mode=clipperOK?'clipper':'legacy';
        if(useClipper && !clipperOK){
          if(strategy==='cut_in'){
            mode='skip';
            runs=[];
          }else{
            // Exact cut_out failed: skip instead of emitting an approximate
            // contour that can invade the vector or exceed the tool radius.
            mode='skip';
            runs=[];
            _n2gProfileExportWarnings.push({sheet:sheet.name,layer:tool.layer,diameter:+tool.diameter||0});
          }
        }
        records.push({id:profileLoopIdJS(loop),key:profileLoopKeyJS(loop),strategy:strategy,
          mode:mode,runs:(mode==='clipper'||mode==='js_offset')?runs:[]});
      });
      if(records.length) out[sheet.name+'::'+tool.layer]=records;
    });
  });
  return out;
}

var _n2gPocketExportWarnings=[];
var _n2gProfileExportWarnings=[];

async function _doExportSend(){
  flushAll();
  var pocketPaths=n2gBuildPocketPathsForExport();
  var profileEngine=(typeof window!=='undefined' && window.N2G_PROFILE_OFFSET_ENGINE) || 'clipper';
  var profilePaths=n2gBuildProfilePathsForExport();
  if(_n2gPocketExportWarnings.length || _n2gProfileExportWarnings.length){
    var ov=document.getElementById('overlay'); if(ov) ov.style.display='none';
    var rows=_n2gPocketExportWarnings.map(function(w){
      return '<div style="margin:4px 0">• Sheet <b>'+esc(w.sheet)+'</b>, layer <b>'+esc(w.layer)+
        '</b>, dao D'+w.diameter.toFixed(3)+' mm</div>';
    }).join('');
    rows+=_n2gProfileExportWarnings.map(function(w){
      return '<div style="margin:4px 0">• Sheet <b>'+esc(w.sheet)+'</b>, layer <b>'+esc(w.layer)+
        '</b>, dao D'+w.diameter.toFixed(3)+' mm — bỏ qua Profile không an toàn</div>';
    }).join('');
    var choice=await showGConfirm(
      'Chi tiết không phù hợp với dao',
      'Một số vùng không tạo được đường chạy an toàn với đường kính dao hiện tại.'+
      '<div style="max-height:260px;overflow:auto;margin:10px 0">'+rows+'</div>'+
      '<span style="color:var(--text2)">Các vùng trên sẽ bị bỏ qua trong G-code.</span>',
      [
        {label:'Xem lại',value:'review'},
        {label:'Vẫn tiếp tục xuất',value:'continue',kind:'primary'}
      ],
      'warn'
    );
    if(choice!=='continue'){
      n2gExportDone(false);
      return;
    }
    if(ov) ov.style.display='flex';
  }
  sketchup.save_layer_map_callback(JSON.stringify(TOOLS));
  sketchup.export_gcode_callback(JSON.stringify({
    tools: TOOLS,
    settings: STG,
    cut_order: CUSTOM_CUT_ORDER,
    layer_overrides: (typeof LAYER_OVERRIDES !== 'undefined') ? LAYER_OVERRIDES : {},
    entry_overrides: (typeof ENTRY_OVERRIDES !== 'undefined') ? ENTRY_OVERRIDES : {},
    pocket_paths: pocketPaths,
    profile_engine: profileEngine,
    profile_paths: profilePaths,
    manual_thickness: MANUAL_THICKNESS,
    save_history: (typeof N2G_SAVE_HISTORY !== 'undefined') ? N2G_SAVE_HISTORY : true,
    tool_group_name: n2gSelectedText('ec-tool-preset'),
    post:{
      name:        n2gSelectedText('ec-post-preset'),
      unit:        document.getElementById('pp-unit').value,
      safe_z:      +document.getElementById('pp-safez').value,
      clear_z:     +document.getElementById('pp-clearz').value,
      ext:         document.getElementById('pp-ext').value,
      comment:     document.getElementById('pp-comment').value,
      spindle_on:  document.getElementById('pp-spindle-on').value,
      spindle_off: document.getElementById('pp-spindle-off').value,
      cool_on:     document.getElementById('pp-cool-on').value,
      cool_off:    document.getElementById('pp-cool-off').value,
      toolchange:  (document.getElementById('pp-toolchange')||{value:''}).value || '',
      header:      document.getElementById('pp-header').value,
      footer:      document.getElementById('pp-footer').value,
    }
  }));
}

// Ruby báo: đã chọn folder, đang scan + sinh G-code → đổi chữ overlay
// (overlay đã hiện từ doExport). Chỉ cập nhật text sang giai đoạn xuất.
function n2gExportBusy(){
  var ov = document.getElementById('overlay');
  if(ov) ov.style.display='flex';   // đảm bảo vẫn hiện
  var ot = document.querySelector('#overlay .otxt');
  if(ot) ot.textContent = 'ĐANG XUẤT G-CODE...';
}

function n2gExportDone(ok, folder, sheetCount){
  _n2gExportInFlight = false;
  document.getElementById('btn-export').disabled = false;
  // Tắt overlay loading (nếu đang hiện)
  var ov = document.getElementById('overlay');
  if(ov) ov.style.display='none';
  if(ok){
    var postName = (document.getElementById('pp-save-name')||{value:'—'}).value || '—';
    setStatus('ok', 'Xuất xong · ' + (sheetCount||TOOLS.length) + ' tấm · Post: ' + postName);
    showExportDoneModal(folder, sheetCount);
  } else {
    setStatus('error', 'Xuất thất bại — xem Ruby Console');
  }
}

var _exportDoneFolder = null;
function showExportDoneModal(folder, sheetCount){
  _exportDoneFolder = folder || null;
  var m = document.getElementById('export-done-modal');
  if(!m) return;
  var info = document.getElementById('export-done-info');
  if(info) info.textContent = (sheetCount ? sheetCount + ' tấm đã được xuất.' : 'Xuất hoàn tất.');
  var pathEl = document.getElementById('export-done-path');
  if(pathEl) pathEl.textContent = folder || '';
  var btnOpen = document.getElementById('export-done-open');
  if(btnOpen) btnOpen.style.display = folder ? '' : 'none';
  m.classList.add('show');
  forceRepaint(m);
}
function closeExportDoneModal(){
  var m = document.getElementById('export-done-modal');
  if(m) m.classList.remove('show');
}
function openExportFolder(){
  if(_exportDoneFolder){
    try{ sketchup.open_folder_callback(_exportDoneFolder); }catch(e){}
  }
}

function setStatus(s,m){ document.getElementById('sdot').className=s; document.getElementById('stxt').textContent=m; }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

window.onload = function(){
  var pinput = document.getElementById('preset-name-input');
  if(pinput) pinput.addEventListener('keydown', function(e){
    if(e.key==='Enter') closePresetModal(true);
    if(e.key==='Escape') closePresetModal(false);
  });
  var einput = document.getElementById('input-modal-ex-field');
  if(einput) einput.addEventListener('keydown', function(e){
    if(e.key==='Enter') closeInputModalEx(true);
    if(e.key==='Escape') closeInputModalEx(false);
  });
  sketchup.dialog_ready(JSON.stringify({
    screen_w: window.screen.width,
    screen_h: window.screen.height
  }));
  var _resizeTimer = null;
  window.addEventListener('resize', function(){
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function(){
      try{
        sketchup.save_window_size_callback(JSON.stringify({
          width: window.outerWidth,
          height: window.outerHeight
        }));
      }catch(e){}
    }, 500);
  });
};

window.onerror = function(msg, src, line){
  document.getElementById('overlay').innerHTML =
    '<div style="color:red;padding:20px;font-size:12px;max-width:600px">' +
      '<b>JS Error:</b> ' + msg + '<br>Line: ' + line +
    '</div>';
  return true;
};
