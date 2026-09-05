// ── Settings ─────────────────────────────────────────────────────────────────
// Biến toàn cục cho preview (tp-profile.js đọc) — lùi điểm xuống dao
var afvBackOn = false;
var afvBackMm = 10;

var STG = {
  antiflyout: true,
  entry_backoff: false,      // bật lùi điểm xuống dao
  entry_backoff_mm: 10,      // lùi bao nhiêu mm (10-30)
  avoid_curve: false,        // dời điểm xuống dao sang cạnh thẳng, tránh cung
  long_final_edge: true,
  double_cut: true,
  small_threshold: 300,
  double_cut_offset: 2.5,
  slowdown: false,
  arc_interp: false,
  arc_min_r: 60,
  custom_name: false,
  name_parts: ['index','color','thickness','side'],
  name_seps: ['_','_','_'],
  remove_accent: true,
  side_top: 'T',
  side_bot: 'B',
  folder_color: false,
  folder_thickness: false,
  font_size: 12,
  nesting_gap: 6.5,
  zzero: 'table',
  board_length: 2440,
  board_width: 1220,
  workarea: {}
};

function switchStgTab(name, el){
  document.querySelectorAll('.settings-nav-item').forEach(function(i){ i.classList.remove('active'); });
  document.querySelectorAll('.stg-tab').forEach(function(t){ t.classList.remove('active'); });
  el.classList.add('active');
  var tab = document.getElementById('stg-tab-'+name);
  if(tab) tab.classList.add('active');
  if(name==='workarea') renderWorkareaTab();
  if(name==='ignored') stgRenderIgnoredLayers();
  if(name==='antiflyout_vis') afvDraw();
  if(name==='activation') loadLicenseStatus();
  // Lưu khi chuyển tab
  if(STG_READY) stgUpdate();
}

// ── Kích hoạt bản quyền ──
function loadLicenseStatus(){
  var line=document.getElementById('lic-status-line');
  if(line) line.textContent='Đang kiểm tra…';
  var exp=document.getElementById('lic-expiry-line');
  if(exp) exp.textContent='';
  if(window.sketchup && sketchup.get_license_status_callback) sketchup.get_license_status_callback();
}

// Ngày hết hạn = hôm nay + số ngày còn lại
function n2gExpiryFromDays(daysLeft){
  if(daysLeft==null) return '';
  var d=new Date();
  d.setDate(d.getDate()+daysLeft);
  var dd=('0'+d.getDate()).slice(-2);
  var mm=('0'+(d.getMonth()+1)).slice(-2);
  return dd+'/'+mm+'/'+d.getFullYear();
}

function n2gShowLicenseStatus(st){
  var line=document.getElementById('lic-status-line');
  var exp=document.getElementById('lic-expiry-line');
  var btn=document.getElementById('lic-activate-btn');
  if(!line) return;
  var s=st.status||'';
  var expDate=n2gExpiryFromDays(st.days_left);
  var deact=document.getElementById('lic-deactivate-section');
  // lưu cờ cache có key hay không (để modal quyết định hiện ô nhập key)
  window._licHasKey = !!st.has_key;
  // mặc định ẩn phần gỡ, chỉ hiện khi active
  if(deact) deact.style.display = (s==='active') ? 'block' : 'none';
  if(s==='active'){
    line.innerHTML='<span style="color:#3ddc84">✓ Đã kích hoạt</span>';
    // Vĩnh viễn: dùng cờ lifetime từ server (chắc chắn hơn là đoán qua days_left)
    if(st.lifetime===true || st.days_left==null){
      exp.innerHTML = '<span style="color:#3ddc84">∞ Bản quyền vĩnh viễn</span>';
    } else {
      exp.textContent = 'Còn '+st.days_left+' ngày (hết hạn '+expDate+')';
    }
    if(btn) btn.innerHTML='🔑 Nhập mã khác / Gia hạn';
  } else if(s==='trial'){
    line.innerHTML='<span style="color:#e0a800">⏳ Đang dùng thử</span>';
    if(st.days_left!=null){
      exp.textContent = 'Còn '+st.days_left+' ngày dùng thử (hết hạn '+expDate+')';
    } else exp.textContent='';
    if(btn) btn.innerHTML='🔑 Nhập mã kích hoạt';
  } else if(s==='offline'){
    line.innerHTML='<span style="color:#e0a800">⚠ Chế độ ngoại tuyến</span>';
    exp.textContent = st.message||'';
    if(btn) btn.innerHTML='🔑 Nhập mã kích hoạt';
  } else {
    line.innerHTML='<span style="color:#e05555">✕ Chưa kích hoạt / Hết hạn</span>';
    exp.textContent = st.message||'';
    if(btn) btn.innerHTML='🔑 Nhập mã kích hoạt';
  }
}

// Mở modal xác nhận gỡ kích hoạt
function n2gOpenDeactModal(){
  var modal=document.getElementById('deact-modal');
  if(!modal) return;
  // reset
  var msg=document.getElementById('deact-modal-msg'); if(msg) msg.textContent='';
  var email=document.getElementById('deact-email-input'); if(email) email.value='';
  var keyInput=document.getElementById('deact-key-input'); if(keyInput) keyInput.value='';
  var btn=document.getElementById('deact-confirm-btn'); if(btn){ btn.disabled=false; btn.textContent='Gỡ kích hoạt'; }
  // hiện ô key nếu cache CHƯA có key
  var keyWrap=document.getElementById('deact-key-wrap');
  if(keyWrap) keyWrap.style.display = window._licHasKey ? 'none' : 'block';
  modal.classList.add('show');
  setTimeout(function(){ if(email) email.focus(); }, 50);
}

function n2gCloseDeactModal(){
  var modal=document.getElementById('deact-modal');
  if(modal) modal.classList.remove('show');
}

// Thực hiện gỡ (từ nút trong modal)
function n2gDoDeactivate(){
  var email=(document.getElementById('deact-email-input')||{}).value||'';
  var key=(document.getElementById('deact-key-input')||{}).value||'';
  var msg=document.getElementById('deact-modal-msg');
  if(!email.trim()){
    if(msg){ msg.style.color='#d9342b'; msg.textContent='Vui lòng nhập email xác nhận.'; }
    return;
  }
  if(!window._licHasKey && !key.trim()){
    if(msg){ msg.style.color='#d9342b'; msg.textContent='Vui lòng nhập mã kích hoạt.'; }
    return;
  }
  var btn=document.getElementById('deact-confirm-btn');
  if(btn){ btn.disabled=true; btn.textContent='Đang gỡ…'; }
  if(msg){ msg.style.color='var(--text2)'; msg.textContent='Đang liên hệ server…'; }
  var payload=JSON.stringify({email:email.trim(), key:key.trim()});
  if(window.sketchup && sketchup.deactivate_license_callback) sketchup.deactivate_license_callback(payload);
}

// Kết quả gỡ kích hoạt từ Ruby
function n2gDeactivateResult(res){
  var msg=document.getElementById('deact-modal-msg');
  var btn=document.getElementById('deact-confirm-btn');
  if(btn){ btn.disabled=false; btn.textContent='Gỡ kích hoạt'; }
  if(res && res.success){
    if(msg){ msg.style.color='#3ddc84'; msg.textContent='✓ '+(res.message||'Đã gỡ kích hoạt.'); }
    setTimeout(function(){
      n2gCloseDeactModal();
      loadLicenseStatus(); // cập nhật lại (giờ về chưa kích hoạt)
    }, 1400);
  } else {
    if(msg){ msg.style.color='#d9342b'; msg.textContent='✕ '+((res&&res.message)||'Gỡ kích hoạt thất bại.'); }
  }
}

// Lưu khi đóng dialog
window.addEventListener('beforeunload', function(){
  if(STG_READY) stgUpdate();
});

function renderWorkareaTab(){
  var thicknesses = [];
  var seen = {};
  var sheets = (typeof SHEETS !== 'undefined' ? SHEETS : []);
  sheets.forEach(function(s){
    var nm = (s.name||'');
    // Độ dày theo ĐÚNG field (color-THICKNESSmm-side); tránh bắt "Xmm" đầu tiên vì mã
    // vật liệu có thể chứa chữ MM (vd "025MM-9mm-sheet-1" phải là 9mm, không phải 25mm).
    var m = nm.match(/^(.+?)-(\d+(?:\.\d+)?mm)-(.+)$/i);
    var thk = m ? m[2] : null;
    if(!thk){ var all = nm.match(/(\d+(?:\.\d+)?mm)/gi); thk = all ? all[all.length-1] : null; }
    if(thk && !seen[thk]){ seen[thk]=true; thicknesses.push(thk); }
  });
  thicknesses.sort();

  var list = document.getElementById('stg-thickness-list');
  if(!list) return;
  if(!thicknesses.length){
    list.innerHTML = '<div style="font-size:10px;color:var(--text3)">Chưa detect được độ dày — cần có nesting trong model</div>';
    return;
  }

  list.innerHTML = thicknesses.map(function(t){
    var wa = (STG.workarea && STG.workarea[t]) ? STG.workarea[t] : {};
    var nominalMM = parseFloat(t) || 18;
    return '<div style="display:flex;align-items:center;gap:10px;padding:7px 10px;border:1px solid var(--border);border-radius:5px;background:var(--surface2);margin-bottom:6px">' +
      '<span style="font-size:11px;font-weight:600;color:var(--accent);width:60px;flex-shrink:0">' + t + '</span>' +
      '<span style="font-size:11px;color:var(--text3)">Thực tế:</span>' +
      '<input class="fi" type="number" value="' + (wa.actual_thickness||nominalMM) + '" style="width:70px" step="0.1"' +
        ' onchange="stgSetWorkarea(\'' + t + '\',\'actual_thickness\',this.value)">' +
      '<span style="font-size:10px;color:var(--text3)">mm</span>' +
    '</div>';
  }).join('');
}

function stgSetWorkarea(thickness, key, val){
  if(!STG.workarea) STG.workarea = {};
  if(!STG.workarea[thickness]) STG.workarea[thickness] = {};
  STG.workarea[thickness][key] = isNaN(+val) ? val : +val;
  try{ sketchup.save_settings_callback(JSON.stringify(STG)); }catch(e){}
}

function stgApplyFontSize(size){
  size = parseInt(size)||12;
  STG.font_size = size;
  try{ sessionStorage.setItem('n2g_font_size', size); }catch(e){}
  var el = document.getElementById('n2g-font-override');
  if(!el){ el=document.createElement('style'); el.id='n2g-font-override'; document.head.appendChild(el); }

  // Giao diện dùng nhiều mức cỡ chữ (9→16px) để phân cấp: chú thích nhỏ hơn chữ
  // chính, tiêu đề lớn hơn. Nếu ép TẤT CẢ về một cỡ thì mất hết phân cấp — chú
  // thích to bằng nội dung. Ở đây DỊCH mọi mức theo cùng độ lệch d = size - 12,
  // nên chênh lệch giữa các mức được giữ nguyên.
  var d = size - 12;
  function sz(n){ var v = n + d; return v < 7 ? 7 : v; }   // sàn 7px cho dễ đọc

  // Rule tổng có specificity 0,2,1 nên rule từng mức phải cao hơn mới thắng được
  // (dù cả hai đều !important). Bọc thành body SEL:not()... để đạt 0,3,1.
  function tierRule(sel, n){
    return 'body ' + sel + ':not(.n2g-load):not(.n2g-load *){font-size:' + sz(n) + 'px !important}';
  }

  var css = 'body, body *:not(.n2g-load):not(.n2g-load *){font-size:' + size + 'px !important}';

  // 1) Các mức khai báo trong dialog.css — theo bảng selector trích sẵn
  var TIERS = {"9.0":["#tools-sidebar-presets-title",".afv-zone-label",".ch",".chip-label",".layer-warn",".logo",".missing-badge",".ps-title",".sim-speed-ticks",".stg-section-title","table.tt th"],"12.0":["#btn-export","#deact-modal .deact-footer .tbtn","#tp-modal #tp-save-ov","#tp-modal .tp-mode-btn","#tp-modal .tp-sheet-item","#tp-modal .tp-side-title","#tp-modal .tp-tab","#tp-modal .tp-title",".edit-sel-info",".edit-select",".gconfirm-footer .tbtn",".impexp-footer .tbtn",".impexp-mode-opt",".input-box-ex-body input",".nav-tab",".preset-box-body input",".settings-nav-item",".sim-layer-item",".stg-check-label",".stg-label",".warn-body"],"11.0":["#deact-modal .deact-label","#tp-modal .tp-order-item","#tp-modal .tp-sheet-item .ts-thk",".btn-mgmt",".ca",".chip-x",".edit-hint",".edit-lbl",".edit-ov-item",".edit-ov-title",".fi",".fl",".hist-actions .tbtn",".hist-meta",".impexp-hdr-sub",".impexp-mode-title",".layer-item",".lte-modal .lte-field span",".mp-label",".post-item",".pp-drop-file",".pp-drop-sub",".preset-box-hint",".preset-item",".sheet-name",".sim-speed label",".stg-input-row",".stg-input-row input",".stg-input-row select",".tbtn",".tf",".warn-layer-row"],"10.0":["#preview-sidebar-title","#stxt","#tp-modal .tp-legend","#tp-modal .tp-order-num",".afv-card-title",".chip",".edit-layer-item .el-count",".hint",".impexp-part-note",".impexp-section-label",".layer-eye",".lte-modal .lte-sect-title",".mp-hint",".mp-passtext",".mp-ztext",".otxt",".pbtn",".post-item-del",".preset-item-del",".rn",".sheet-dim",".sim-layer-item .sim-lcount",".spill",".stg-desc",".stg-preview"],"11.5":["#deact-modal .deact-msg",".edit-layer-item"],"13.5":[".hist-file"],"14.5":["#deact-modal .deact-title",".gconfirm-title"],"12.5":["#deact-modal .deact-desc","#deact-modal .deact-input",".gconfirm-body",".impexp-part-label"],"13.0":[".input-box-ex-hdr",".lte-modal .lte-field input",".lte-modal .lte-field select",".mp-count",".pp-drop-main",".preset-box-hdr",".thk-input",".thk-row",".warn-title"],"16.0":[".lte-modal .lte-close",".mp-btn",".warn-icon"],"15.0":[".impexp-hdr-title",".lte-modal .lte-title",".row-del-btn"],"10.5":[".impexp-mode-opt-desc",".impexp-selectbar button"]};
  for(var k in TIERS){
    if(!TIERS.hasOwnProperty(k)) continue;
    var n = parseFloat(k);
    if(n === 12) continue;                     // mức nền, đã có rule tổng
    for(var i=0;i<TIERS[k].length;i++) css += tierRule(TIERS[k][i], n);
  }

  // 2) Các chỗ đặt font-size thẳng trong style="" (HTML + JS sinh động).
  //    Bắt bằng attribute selector nên không phải sửa file.
  var INLINE = [9,10,10.5,11,11.5,12.5,13,13.5,14.5,15,16];
  for(var j=0;j<INLINE.length;j++){
    var v = INLINE[j];
    if(v === 12) continue;
    css += tierRule('[style*="font-size:' + v + 'px"]', v);
  }

  css += '.n2g-load{font-size:50px !important}';
  el.textContent = css;

  var lbl = document.getElementById('stg-fontsize-label');
  if(lbl) lbl.textContent = size + 'px';
}

function stgSaveAndReload(){
  STG.font_size = parseInt((document.getElementById('stg-fontsize')||{value:12}).value)||12;
  stgUpdate();
  try{ sketchup.save_and_reload_callback(JSON.stringify(STG)); }catch(e){}
}

function stgSetFont(size){
  document.getElementById('stg-fontsize').value = size;
  stgApplyFontSize(size);
  stgUpdate();
}

function stgLoad(){
  try{ sketchup.load_settings_callback(); }catch(e){ stgApplyToUI(); }
}

function n2gLoadSettings(s){
  STG_READY = false; // Tạm dừng save trong khi restore
  if(s) STG = Object.assign(STG, s);
  stgApplyFontSize(STG.font_size||12);
  // Khôi phục lùi điểm xuống dao (cho preview)
  afvBackOn = STG.entry_backoff === true;
  afvBackMm = +STG.entry_backoff_mm || 10;
  // Khôi phục threshold
  if(STG.thresh_bot) afvThreshBot = STG.thresh_bot;
  if(STG.thresh_top) afvThreshTop = STG.thresh_top;
  // Khôi phục dir (không dùng afvSetDir để tránh reset afvSel)
  if(STG.cut_dir){
    afvDir = STG.cut_dir;
    var btnCcw = document.getElementById('afv-btn-ccw');
    var btnCw  = document.getElementById('afv-btn-cw');
    if(btnCcw) btnCcw.className = 'tbtn'+(afvDir==='ccw'?' tbtn-p':'');
    if(btnCw)  btnCw.className  = 'tbtn'+(afvDir==='cw' ?' tbtn-p':'');
  }
  stgApplyToUI();
  // Restore afv_sel SAU CÙNG để không bị override
  if(STG.afv_sel) Object.assign(afvSel, STG.afv_sel);
  if(document.getElementById('afv-cv')){
    afvDrawSheet();
    afvBuildOverlay();
  }
  STG_READY = true; // UI đã load xong, cho phép save
}

function stgApplyToUI(){
  document.getElementById('stg-antiflyout').checked     = !!STG.antiflyout;
  // ── Lùi điểm xuống dao ──
  var acEl = document.getElementById('stg-avoid-curve');
  if(acEl) acEl.checked = STG.avoid_curve === true;
  var lfEl = document.getElementById('stg-long-final-edge');
  if(lfEl) lfEl.checked = STG.long_final_edge !== false;
  var ebEl = document.getElementById('stg-entry-backoff');
  if(ebEl){
    ebEl.checked = STG.entry_backoff === true;
    var ebMmEl = document.getElementById('stg-entry-backoff-mm');
    if(ebMmEl) ebMmEl.value = STG.entry_backoff_mm || 10;
    var ebSub = document.getElementById('stg-entry-backoff-sub');
    if(ebSub){
      ebSub.style.opacity       = ebEl.checked ? '1' : '0.4';
      ebSub.style.pointerEvents = ebEl.checked ? '' : 'none';
    }
  }
  document.getElementById('stg-double-cut').checked     = !!STG.double_cut;
  document.getElementById('stg-small-threshold').value  = STG.small_threshold||300;
  document.getElementById('stg-double-cut-offset').value= STG.double_cut_offset||2.5;
  document.getElementById('stg-slowdown').checked       = !!STG.slowdown;
  var _ai=document.getElementById('stg-arc-interp'); if(_ai) _ai.checked = !!STG.arc_interp;
  var _ar=document.getElementById('stg-arc-min-r'); if(_ar) _ar.value = STG.arc_min_r||60;
  document.getElementById('stg-custom-name').checked    = !!STG.custom_name;
  var ra = document.getElementById('stg-remove-accent');
  if(ra) ra.checked = STG.remove_accent!==false;
  var st = document.getElementById('stg-side-top');
  if(st) st.value = STG.side_top||'T';
  var sb = document.getElementById('stg-side-bot');
  if(sb) sb.value = STG.side_bot||'B';
  var fc = document.getElementById('stg-folder-color');
  if(fc) fc.checked = !!STG.folder_color;
  var ft = document.getElementById('stg-folder-thickness');
  if(ft) ft.checked = !!STG.folder_thickness;
  var fs = STG.font_size || 12;
  var slider = document.getElementById('stg-fontsize');
  if(slider) slider.value = fs;
  stgApplyFontSize(fs);
  var ng = document.getElementById('stg-nesting_gap');
  if(!ng) ng = document.getElementById('stg-nesting-gap');
  if(ng) ng.value = STG.nesting_gap||6.5;
  var sd = document.getElementById('stg-safe-d');
  if(sd) sd.textContent = STG.nesting_gap||6.5;
  var bl = document.getElementById('stg-board-length');
  if(bl) bl.value = STG.board_length||2440;
  var bw = document.getElementById('stg-board-width');
  if(bw) bw.value = STG.board_width||1220;
  var zz = document.querySelector('input[name="stg-zzero"][value="'+(STG.zzero||'table')+'"]');
  if(zz) zz.checked = true;
  // Hiện stg-name-config nếu custom_name đã được bật
  var nc = document.getElementById('stg-name-config');
  if(nc) nc.style.display = 'block';
  // ── Khôi phục CẤU TRÚC TÊN đã lưu (select thành phần + dấu phân cách) ──
  // Trước đây chỉ đọc từ DOM khi cần nên mở lại dialog là mất lựa chọn.
  var _np = STG.name_parts || ['index','color','thickness','side'];
  ['stg-name-part1','stg-name-part2','stg-name-part3','stg-name-part4'].forEach(function(id, i){
    var el = document.getElementById(id);
    if(el && _np[i]) el.value = _np[i];
  });
  var _ns = STG.name_seps || ['_','_','_'];
  ['stg-sep1','stg-sep2','stg-sep3'].forEach(function(id, i){
    var el = document.getElementById(id);
    if(el && _ns[i] != null) el.value = _ns[i];
  });
  // Cập nhật folder preview nếu đã bật
  stgUpdateFolderPreview();
  if(STG.custom_name) stgUpdateNamePreview();
}

var STG_READY = false; // Flag: chỉ save sau khi UI đã load xong

function stgUpdate(){
  var af = document.getElementById('stg-antiflyout').checked;
  var sub = document.getElementById('stg-antiflyout-sub');
  sub.querySelectorAll('.stg-check,.stg-input-row,.stg-desc').forEach(function(el){
    el.style.opacity = af ? '1' : '0.4';
    el.style.pointerEvents = af ? '' : 'none';
  });
  var cn = document.getElementById('stg-custom-name').checked;
  document.getElementById('stg-name-config').style.display = 'block';
  if(cn) stgUpdateNamePreview();
  STG.antiflyout       = af;
  // ── Lùi điểm xuống dao ──
  var ebEl = document.getElementById('stg-entry-backoff');
  if(ebEl){
    var ebOn  = ebEl.checked;
    var ebMm  = +((document.getElementById('stg-entry-backoff-mm')||{}).value) || 10;
    if(ebMm < 10) ebMm = 10;
    if(ebMm > 30) ebMm = 30;
    STG.entry_backoff    = ebOn;
    STG.entry_backoff_mm = ebMm;
    var acEl2 = document.getElementById('stg-avoid-curve');
    if(acEl2) STG.avoid_curve = acEl2.checked;
    var lfEl2 = document.getElementById('stg-long-final-edge');
    if(lfEl2) STG.long_final_edge = lfEl2.checked;
    afvBackOn = ebOn;            // preview dùng ngay
    afvBackMm = ebMm;
    var ebSub = document.getElementById('stg-entry-backoff-sub');
    if(ebSub){
      ebSub.style.opacity       = ebOn ? '1' : '0.4';
      ebSub.style.pointerEvents = ebOn ? '' : 'none';
    }
  }
  STG.double_cut       = document.getElementById('stg-double-cut').checked;
  STG.small_threshold  = +document.getElementById('stg-small-threshold').value||300;
  STG.double_cut_offset= +document.getElementById('stg-double-cut-offset').value||2.5;
  STG.slowdown         = document.getElementById('stg-slowdown').checked;
  var _ai2=document.getElementById('stg-arc-interp'); STG.arc_interp = _ai2 ? _ai2.checked : false;
  var _ar2=document.getElementById('stg-arc-min-r'); STG.arc_min_r = _ar2 ? (+_ar2.value||60) : 60;
  STG.custom_name      = cn;
  // ── CẤU TRÚC TÊN: lưu thành phần + dấu phân cách để giữ khi mở lại dialog ──
  // Chỉ ghi khi đọc được element, tránh xóa mất cấu trúc đã lưu.
  var _npEls = ['stg-name-part1','stg-name-part2','stg-name-part3','stg-name-part4']
    .map(function(id){ return document.getElementById(id); });
  if(_npEls.some(function(el){ return !!el; })){
    STG.name_parts = _npEls.filter(function(el){ return !!el; }).map(function(el){ return el.value; });
    STG.name_seps  = ['stg-sep1','stg-sep2','stg-sep3']
      .map(function(id){ var el=document.getElementById(id); return el ? el.value : '_'; });
  }
  STG.remove_accent    = !!(document.getElementById('stg-remove-accent')||{}).checked;
  STG.side_top         = (document.getElementById('stg-side-top')||{value:'T'}).value||'T';
  STG.side_bot         = (document.getElementById('stg-side-bot')||{value:'B'}).value||'B';
  STG.folder_color     = !!(document.getElementById('stg-folder-color')||{}).checked;
  STG.folder_thickness = !!(document.getElementById('stg-folder-thickness')||{}).checked;
  STG.font_size        = parseInt((document.getElementById('stg-fontsize')||{value:12}).value)||12;
  STG.nesting_gap      = parseFloat((document.getElementById('stg-nesting-gap')||{value:6.5}).value)||6.5;
  STG.board_length     = +(document.getElementById('stg-board-length')||{value:2440}).value||2440;
  STG.board_width      = +(document.getElementById('stg-board-width')||{value:1220}).value||1220;
  var zzEl = document.querySelector('input[name="stg-zzero"]:checked');
  STG.zzero            = zzEl ? zzEl.value : 'table';
  STG.thresh_bot       = afvThreshBot || 300;
  STG.thresh_top       = afvThreshTop || 300;
  STG.cut_dir          = afvDir || 'ccw';
  STG.afv_sel          = {left:afvSel.left, right:afvSel.right, top:afvSel.top, bottom:afvSel.bottom};
  var sdEl = document.getElementById('stg-safe-d');
  if(sdEl) sdEl.textContent = STG.nesting_gap;
  stgUpdateFolderPreview();
  checkToolDiameterWarnings();
  // Chỉ save khi UI đã sẵn sàng (tránh ghi đè với giá trị default)
  if(STG_READY) try{ sketchup.save_settings_callback(JSON.stringify(STG)); }catch(e){}
}

function stgUpdateFolderPreview(){
  var fc = !!(document.getElementById('stg-folder-color')||{}).checked;
  var ft = !!(document.getElementById('stg-folder-thickness')||{}).checked;
  var color = 'mau_van_vai';
  var thick = '17.5mm';
  var thick2 = '7mm';
  var dirParts = [];
  if(fc) dirParts.push(color);
  if(ft) dirParts.push(thick);
  var dir = dirParts.join('_') || null;
  var tree = '📁 output/\n';
  if(dir){
    tree += '  📁 ' + dir + '/\n';
    tree += '    📄 001_' + color + '_' + thick + '_T.nc\n';
    tree += '    📄 002_' + color + '_' + thick + '_B.nc\n';
    var dir2 = [fc?color:'', ft?thick2:''].filter(Boolean).join('_');
    tree += '  📁 ' + dir2 + '/\n';
    tree += '    📄 001_' + color + '_' + thick2 + '_T.nc';
  } else {
    tree += '  📄 001_' + color + '_' + thick + '_T.nc\n  📄 002_' + color + '_' + thick + '_B.nc';
  }
  var el = document.getElementById('stg-folder-preview');
  if(el) el.textContent = tree;
}

function normalizeLayer(name){
  return (name||'').toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'');
}

function removeViAccent(s){
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\u00d0|\u0111/g,'d').replace(/\u00c6/g,'ae').replace(/\u0110/g,'D');
}

function stgUpdateNamePreview(){
  var partIds = ['stg-name-part1','stg-name-part2','stg-name-part3','stg-name-part4'];
  var rawParts = partIds.map(function(id){ var el=document.getElementById(id); return el?el.value:null; });
  var parts = rawParts.filter(function(v){ return v&&v!=='none'; });
  var sepIds = ['stg-sep1','stg-sep2','stg-sep3'];
  var rawSeps = sepIds.map(function(id){ var el=document.getElementById(id); return el?el.value:null; });
  var seps = rawSeps.map(function(v){ return v==null ? '_' : v; });

  // ── LƯU lựa chọn vào STG + ghi xuống Ruby ──
  // Các select/input gọi thẳng hàm này (onchange/oninput) chứ không qua stgUpdate,
  // nên phải tự lưu ở đây; nếu không, mở lại dialog là mất cấu trúc đã chọn.
  // Chỉ ghi khi thực sự đọc được element (tránh ghi đè bằng mảng rỗng khi UI chưa dựng).
  if(rawParts.some(function(v){ return v!=null; })){
    STG.name_parts = rawParts.filter(function(v){ return v!=null; });
    STG.name_seps  = seps;
    if(typeof STG_READY!=='undefined' && STG_READY){
      try{ sketchup.save_settings_callback(JSON.stringify(STG)); }catch(e){}
    }
  }

  var ra  = !!(document.getElementById('stg-remove-accent')||{}).checked;
  var sTop= (document.getElementById('stg-side-top')||{value:'T'}).value||'T';
  var sBot= (document.getElementById('stg-side-bot')||{value:'B'}).value||'B';
  var fmt = function(s){ return ra ? removeViAccent(s) : s; };
  var s1 = {index:'001', color:fmt('màu vân vải'), thickness:'17.5mm', side:sTop, sheetname:fmt('màu vân vải-17.5mm-sheet-1')};
  var s2 = {index:'001', color:fmt('màu vân vải'), thickness:'17.5mm', side:sBot, sheetname:fmt('màu vân vải-17.5mm-sheet-1-bottom')};
  var build = function(map){ var r=''; parts.forEach(function(p,i){ r+=(i>0?seps[i-1]:'')+map[p]; }); return r; };
  var p1 = document.getElementById('stg-name-preview');
  var p2 = document.getElementById('stg-name-preview-bot');
  if(p1) p1.textContent = build(s1)+'.nc';
  if(p2) p2.textContent = build(s2)+'.nc';
}

function n2gFormatSheetName(sheetName, idx){
  if(!STG.custom_name) return sheetName;
  var m = sheetName.match(/^(.+?)-(\d+(?:\.\d+)?mm)-(.+)$/i);
  var color     = m ? m[1] : sheetName;
  var thickness = m ? m[2] : '';
  var side      = m ? m[3] : '';
  var index     = String(idx+1);
  while(index.length<3) index='0'+index;
  // Ưu tiên đọc cấu trúc ĐÃ LƯU trong STG; chỉ fallback sang DOM nếu chưa có.
  var partIds = ['stg-name-part1','stg-name-part2','stg-name-part3','stg-name-part4'];
  var parts = (STG.name_parts && STG.name_parts.length)
    ? STG.name_parts.slice()
    : partIds.map(function(id){ var el=document.getElementById(id); return el?el.value:''; });
  parts = parts.filter(function(v){ return v&&v!=='none'; });
  var sepIds = ['stg-sep1','stg-sep2','stg-sep3'];
  var seps = (STG.name_seps && STG.name_seps.length)
    ? STG.name_seps.slice()
    : sepIds.map(function(id){ var el=document.getElementById(id); return el?el.value:'_'; });
  var map = {index:index, color:color, thickness:thickness, side:side, sheetname:sheetName};
  var result = '';
  parts.forEach(function(p,i){ result += (i>0?seps[i-1]:'')+map[p]; });
  return result;
}

function n2gSetDetectedGap(gap){
  if(!gap) return;
  var el = document.getElementById('stg-nesting-gap');
  if(el && !STG.nesting_gap) el.value = gap;
  var sd = document.getElementById('stg-safe-d');
  if(sd) sd.textContent = gap;
  var badge = document.getElementById('stg-gap-badge');
  if(badge) badge.textContent = '✓ Tự detect: ' + gap + 'mm';
}

function n2gReloadToolGroups(groups, toolsList){
  ALL_TOOL_GROUPS = groups || [];
  ALL_TOOL_GROUPS.forEach(function(group){
    (group.tools||[]).forEach(function(tool){ tool.rpm=n2gSafeRpm(tool.rpm); });
  });
  ALL_TOOLS_LIST  = toolsList || [];
  renderToolTable();
}

function checkUpdateManual(){
  var btn = document.getElementById('btn-check-update');
  var status = document.getElementById('update-status');
  btn.disabled = true;
  btn.textContent = '⏳ Đang kiểm tra...';
  status.textContent = '';
  try{ sketchup.check_update_callback(); }catch(e){}
}

function n2gSetVersion(v){
  var el = document.getElementById('current-version');
  if(el) el.textContent = v;
}

function n2gUpdateStatus(msg, ok){
  var status = document.getElementById('update-status');
  var btn    = document.getElementById('btn-check-update');
  if(status){ status.textContent = msg; status.style.color = ok ? 'var(--accent)' : 'var(--text3)'; }
  if(btn){ btn.disabled = false; btn.textContent = '🔄 Kiểm tra bản cập nhật'; }
}

function n2gLoadToolPresets(p, activeId){
  TOOL_PRESETS = p || [];
  if(!TOOL_PRESETS.length){ renderToolPresets(); return; }
  var target = activeId ? TOOL_PRESETS.find(function(t){ return String(t.id)===String(activeId); }) : null;
  var preset = target || TOOL_PRESETS[0];
  if(preset){
    ACTIVE_PRESET_ID = preset.id;
    loadToolPreset(preset.id, null, true);   // isInit=true: không ghi đè active đã lưu
  }
  renderToolPresets();
}

function flushAndRender(){ flushAll(); renderToolTable(); checkToolDiameterWarnings(); }

function updateToolName(idx, name, selectEl){
  TOOLS[idx].name = name;
  var found = null;

  // Nếu biết option đang chọn → đọc nhóm (optgroup) để lấy ĐÚNG dao trong ĐÚNG nhóm
  var groupName = null;
  if(selectEl && selectEl.selectedOptions && selectEl.selectedOptions.length){
    var opt = selectEl.selectedOptions[0];
    if(opt.parentElement && opt.parentElement.tagName === 'OPTGROUP'){
      groupName = opt.parentElement.label;
    }
  }
  if(groupName){
    var grp = ALL_TOOL_GROUPS.find(function(g){ return g.name === groupName; });
    if(grp) found = grp.tools.find(function(t){ return t.name === name; });
  }

  // Fallback: nếu không xác định được nhóm, gom mọi dao trùng tên, ưu tiên bản có dữ liệu
  if(!found){
    var candidates = [];
    for(var gi=0; gi<ALL_TOOL_GROUPS.length; gi++){
      candidates = candidates.concat(ALL_TOOL_GROUPS[gi].tools.filter(function(t){ return t.name===name; }));
    }
    if(!candidates.length && ALL_TOOLS_LIST.length){
      candidates = ALL_TOOLS_LIST.filter(function(t){ return t.name===name; });
    }
    found = candidates.find(function(t){
      return (t.tool_notes && t.tool_notes.trim()) ||
             (t.spindle_on && t.spindle_on.trim()) ||
             (t.spindle_off && t.spindle_off.trim());
    }) || candidates[0] || null;
  }

  if(found){
    if(found.diameter   !== undefined) TOOLS[idx].diameter    = found.diameter;
    if(found.tool_number!== undefined) TOOLS[idx].tool_number = found.tool_number;
    TOOLS[idx].rpm = n2gSafeRpm(found.rpm);
    if(found.feed       !== undefined && found.feed>0)   TOOLS[idx].feed   = found.feed;
    if(found.z_feed     !== undefined && found.z_feed>0) TOOLS[idx].z_feed = found.z_feed;
    if(found.stepover   !== undefined) TOOLS[idx].stepover    = found.stepover;
    // max_depth = độ sâu tối đa mỗi lần hạ dao (dương). KHÔNG gán vào depth nữa.
    if(found.max_depth  !== undefined) TOOLS[idx].max_depth    = Math.abs(found.max_depth);
    TOOLS[idx].bit_type   = found.bit_type   !== undefined ? found.bit_type   : 'flat';
    TOOLS[idx].vbit_angle = found.vbit_angle !== undefined ? found.vbit_angle : 120;
    TOOLS[idx].spindle_on  = found.spindle_on  !== undefined ? found.spindle_on  : '';
    TOOLS[idx].spindle_off = found.spindle_off !== undefined ? found.spindle_off : '';
    TOOLS[idx].tool_notes  = found.tool_notes  !== undefined ? found.tool_notes  : '';
    renderToolTable();
  }
}

function stgRenderIgnoredLayers(){
  var list = document.getElementById('stg-ignored-list');
  if(!list) return;
  var ignored = [];
  IGNORED_LAYERS.forEach(function(l){ ignored.push(l); });
  if(ignored.length === 0){
    list.innerHTML = '<div style="font-size:11px;color:var(--text3)">Chưa có layer nào bị bỏ qua</div>';
    return;
  }
  list.innerHTML = ignored.map(function(l){
    return '<div style="display:flex;align-items:center;gap:8px;padding:5px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:5px">' +
      '<span style="flex:1;font-size:11px;font-family:var(--mono)">' + l + '</span>' +
      '<button class="tbtn" onclick="stgRemoveIgnored(\'' + l + '\')" style="font-size:10px;padding:2px 8px;color:#e05050">✕</button>' +
    '</div>';
  }).join('');
}

function stgRemoveIgnored(layer){
  IGNORED_LAYERS.delete(layer);
  try{ sketchup.save_ignored_layers_callback(JSON.stringify(Array.from(IGNORED_LAYERS))); }catch(e){}
  stgRenderIgnoredLayers();
  _checkUnconfiguredLayers();
}

function stgClearAllIgnored(){
  IGNORED_LAYERS.clear();
  try{ sketchup.save_ignored_layers_callback(JSON.stringify(Array.from(IGNORED_LAYERS))); }catch(e){}
  stgRenderIgnoredLayers();
  _checkUnconfiguredLayers();
}

// ── Antiflyout Visualization ──────────────────────────────────────────────────
var afvDir = 'ccw';
var afvSel = {left:1, right:3, top:2, bottom:0};
var AFV_ENTRY_CCW = {left:1, right:3, top:2, bottom:0};
var AFV_ENTRY_CW  = {left:3, right:1, top:0, bottom:2};
var AFV_ZONES = ['left','right','top','bottom'];
var AFV_LABELS = {left:'TRÁI', right:'PHẢI', top:'TRÊN', bottom:'DƯỚI'};
// Card rect size: vert=70x90, horiz=90x50
var AFV_RECTS = {left:{w:70,h:90}, right:{w:70,h:90}, top:{w:90,h:50}, bottom:{w:90,h:50}};
var AFV_DOT_DEFS = [{cls:'tl',idx:0},{cls:'tr',idx:1},{cls:'bl',idx:3},{cls:'br',idx:2}];
var AFV_ZONE_COLORS = {left:'#60a5fa', right:'#f472b6', top:'#4ade80', bottom:'#fb923c'};

function afvSetDir(dir){
  afvDir = dir;
  document.getElementById('afv-btn-ccw').className = 'tbtn'+(dir==='ccw'?' tbtn-p':'');
  document.getElementById('afv-btn-cw').className  = 'tbtn'+(dir==='cw' ?' tbtn-p':'');
  var map = dir==='ccw' ? AFV_ENTRY_CCW : AFV_ENTRY_CW;
  AFV_ZONES.forEach(function(z){ afvSel[z]=map[z]; });
  afvDrawSheet();
  afvBuildOverlay();
  stgUpdate();
  try{ renderToolTable(); }catch(e){}   // cập nhật cột hướng của dao profile theo global mới
  try{ sketchup.save_settings_callback(JSON.stringify(STG)); }catch(e){}
}

function afvBuildCard(zone){
  var card = document.getElementById('afv-card-'+zone);
  if(!card) return;
  card.innerHTML = '';
  var r = AFV_RECTS[zone];
  var wrap = document.createElement('div');
  wrap.className = 'afv-rect-sel';
  wrap.style.width = r.w+'px'; wrap.style.height = r.h+'px';

  // bg border
  var bg = document.createElement('div'); bg.className='afv-rect-bg';
  wrap.appendChild(bg);

  // title ở giữa hình
  var titleEl = document.createElement('div');
  titleEl.className = 'afv-card-title';
  titleEl.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:1';
  titleEl.textContent = AFV_LABELS[zone];
  wrap.appendChild(titleEl);

  AFV_DOT_DEFS.forEach(function(dd){
    var lbl = document.createElement('label');
    lbl.className = 'afv-dot '+dd.cls;
    var inp = document.createElement('input');
    inp.type='radio'; inp.name='afvz-'+zone; inp.value=dd.idx;
    inp.checked = (afvSel[zone]===dd.idx);
    inp.addEventListener('change', function(){
      var z = this.name.replace('afvz-', '');
      afvSel[z] = +this.value;
      afvDrawSheet();
      stgUpdate();
    });
    var ring = document.createElement('div'); ring.className='afv-dot-ring';
    lbl.appendChild(inp); lbl.appendChild(ring);
    wrap.appendChild(lbl);
  });
  card.appendChild(wrap);
}

function afvInitCanvas(){
  var cv   = document.getElementById('afv-cv');
  var wrap = document.getElementById('afv-sheet-wrap');
  if(!cv||!wrap) return;
  var sw=1220, sh=2440;
  try{ if(typeof SHEETS!=='undefined'&&SHEETS.length>0){ sw=Math.round(SHEETS[0].width)||sw; sh=Math.round(SHEETS[0].height)||sh; } }catch(e){}
  var lbl=document.getElementById('afv-sheet-lbl');
  if(lbl) lbl.textContent=sw+'×'+sh+'mm';
  // Đọc kích thước thực từ wrap sau khi layout xong
  var rect=wrap.getBoundingClientRect();
  var ch=Math.max(Math.round(rect.height)||300, 100);
  var cw=Math.round(ch*(sw/sh));
  cv.width=cw; cv.height=ch;
  afvDrawSheet();
}

// Threshold TRÊN/DƯỚI (mm, tính từ cạnh tương ứng)
var afvThreshBot = 300; // Y=0   → Y=300  = DƯỚI
var afvThreshTop = 300; // Y=2440→ Y=2140 = TRÊN
var afvDragState = null;

function afvMmToCanvas(mm, axis, cv, sheetW, sheetH){
  if(axis==='x') return mm/sheetW * cv.width;
  return (1 - mm/sheetH) * cv.height;
}
function afvCanvasToMm(px, axis, cv, sheetW, sheetH){
  if(axis==='x') return px/cv.width*sheetW;
  return (1 - px/cv.height)*sheetH;
}

// Lưu tọa độ tấm demo để overlay dùng
var afvDemoRects = {};

function afvDrawSheet(){
  var cv = document.getElementById('afv-cv');
  if(!cv) return;
  var ctx = cv.getContext('2d');
  var W=cv.width, H=cv.height;
  ctx.clearRect(0,0,W,H);

  var sheetW=1220, sheetH=2440;
  try{ if(typeof SHEETS!=='undefined'&&SHEETS.length>0){ sheetW=Math.round(SHEETS[0].width)||sheetW; sheetH=Math.round(SHEETS[0].height)||sheetH; } }catch(e){}

  var yBotPx = afvMmToCanvas(afvThreshBot, 'y', cv, sheetW, sheetH);
  var yTopPx = afvMmToCanvas(sheetH - afvThreshTop, 'y', cv, sheetW, sheetH);
  var xMidPx = W/2;

  // Sheet bg
  ctx.fillStyle='#161b2e'; ctx.fillRect(0,0,W,H);

  // 4 vùng màu
  ctx.fillStyle='#fb923c28'; ctx.fillRect(0, yBotPx, W, H-yBotPx);
  ctx.fillStyle='#4ade8028'; ctx.fillRect(0, 0, W, yTopPx);
  ctx.fillStyle='#60a5fa28'; ctx.fillRect(0, yTopPx, xMidPx, yBotPx-yTopPx);
  ctx.fillStyle='#f472b628'; ctx.fillRect(xMidPx, yTopPx, W-xMidPx, yBotPx-yTopPx);

  ctx.strokeStyle='#2a3555'; ctx.lineWidth=1; ctx.strokeRect(0,0,W,H);

  // Grid
  var xStep = afvNiceStep(sheetW, W, 40);
  var yStep = afvNiceStep(sheetH, H, 40);
  ctx.strokeStyle='rgba(42,53,85,0.4)'; ctx.lineWidth=0.4;
  for(var gx=xStep;gx<sheetW;gx+=xStep){
    var gxpx=gx/sheetW*W;
    ctx.beginPath(); ctx.moveTo(gxpx,0); ctx.lineTo(gxpx,H); ctx.stroke();
  }
  for(var gy=yStep;gy<sheetH;gy+=yStep){
    var gypx=(1-gy/sheetH)*H;
    ctx.beginPath(); ctx.moveTo(0,gypx); ctx.lineTo(W,gypx); ctx.stroke();
  }

  // Đường chia TRÁI/PHẢI
  ctx.strokeStyle='rgba(167,139,250,0.3)'; ctx.lineWidth=1; ctx.setLineDash([4,3]);
  ctx.beginPath(); ctx.moveTo(xMidPx,yTopPx); ctx.lineTo(xMidPx,yBotPx); ctx.stroke();
  ctx.setLineDash([]);

  // Vùng labels
  ctx.font='bold 9px sans-serif'; ctx.textAlign='center';
  ctx.fillStyle='#fb923ccc'; ctx.fillText('DƯỚI', W/2, (yBotPx+H)/2+4);
  ctx.fillStyle='#4ade80cc'; ctx.fillText('TRÊN', W/2, yTopPx/2+4);
  ctx.fillStyle='#60a5facc'; ctx.fillText('TRÁI', W/4, (yTopPx+yBotPx)/2+4);
  ctx.fillStyle='#f472b6cc'; ctx.fillText('PHẢI', W*3/4, (yTopPx+yBotPx)/2+4);

  // Đường threshold
  afvDrawThreshLine(ctx, yBotPx, W, '#fb923c', afvThreshBot+'mm');
  afvDrawThreshLine(ctx, yTopPx, W, '#4ade80', afvThreshTop+'mm');

  // 4 tấm demo — tính tọa độ pixel chính xác rồi lưu vào afvDemoRects
  var m=8, midY=(yTopPx+yBotPx)/2;
  var zDef = {
    left:  {x:m,           y:midY-H*0.12, w:W*0.22, h:H*0.24},
    right: {x:W-m-W*0.22,  y:midY-H*0.12, w:W*0.22, h:H*0.24},
    top:   {x:W/2-W*0.22,  y:m,           w:W*0.44, h:H*0.10},
    bottom:{x:W/2-W*0.22,  y:H-m-H*0.10,  w:W*0.44, h:H*0.10},
  };

  var edgeSeq=[[0,1],[1,2],[2,3],[3,0]];
  AFV_ZONES.forEach(function(z){
    var d=zDef[z];
    d.x=Math.round(d.x); d.y=Math.round(d.y); d.w=Math.round(d.w); d.h=Math.round(d.h);
    // Lưu lại để overlay dùng
    afvDemoRects[z] = {x:d.x, y:d.y, w:d.w, h:d.h};

    var c=AFV_ZONE_COLORS[z];
    ctx.fillStyle=c+'20'; ctx.fillRect(d.x,d.y,d.w,d.h);
    ctx.strokeStyle=c+'cc'; ctx.lineWidth=1; ctx.strokeRect(d.x,d.y,d.w,d.h);
    var pts=[{x:d.x,y:d.y},{x:d.x+d.w,y:d.y},{x:d.x+d.w,y:d.y+d.h},{x:d.x,y:d.y+d.h}];
    var ei=afvSel[z];
    var prevPt=afvDir==='ccw'?pts[(ei+1)%4]:pts[(ei+3)%4];
    ctx.strokeStyle='#fbbf24'; ctx.lineWidth=1.5; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(prevPt.x,prevPt.y); ctx.lineTo(pts[ei].x,pts[ei].y); ctx.stroke();
    var ae2=edgeSeq[(ei+2)%4];
    var arrowA=afvDir==='ccw'?pts[ae2[1]]:pts[ae2[0]];
    var arrowB=afvDir==='ccw'?pts[ae2[0]]:pts[ae2[1]];
    var adx=arrowB.x-arrowA.x,ady=arrowB.y-arrowA.y,al=Math.sqrt(adx*adx+ady*ady);
    if(al>3){
      var amx=arrowA.x+adx*0.5,amy=arrowA.y+ady*0.5;
      adx/=al; ady/=al; var nx=-ady,ny=adx;
      ctx.fillStyle='#4ade80';
      ctx.beginPath(); ctx.moveTo(amx+nx*3,amy+ny*3); ctx.lineTo(amx-nx*3,amy-ny*3); ctx.lineTo(amx+adx*6,amy+ady*6); ctx.closePath(); ctx.fill();
    }
    var sp=pts[ei];
    ctx.fillStyle='rgba(248,113,113,0.25)'; ctx.beginPath(); ctx.arc(sp.x,sp.y,5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#f87171'; ctx.beginPath(); ctx.arc(sp.x,sp.y,2,0,Math.PI*2); ctx.fill();
  });
  ctx.textAlign='left';
}

function afvDrawThreshLine(ctx, ypx, W, color, label){
  // Đường nét đứt
  ctx.strokeStyle=color+'dd'; ctx.lineWidth=1.5; ctx.setLineDash([6,3]);
  ctx.beginPath(); ctx.moveTo(0,ypx); ctx.lineTo(W,ypx); ctx.stroke();
  ctx.setLineDash([]);
  // Handle kéo (hình thoi giữa đường)
  ctx.fillStyle=color;
  ctx.beginPath();
  ctx.moveTo(W/2, ypx-6); ctx.lineTo(W/2+6, ypx);
  ctx.lineTo(W/2, ypx+6); ctx.lineTo(W/2-6, ypx);
  ctx.closePath(); ctx.fill();
  // Label nền mờ
  var lw=ctx.measureText(label).width+16;
  ctx.fillStyle='rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.roundRect(W/2+10, ypx-10, lw, 20, 4); ctx.fill();
  // Label text
  ctx.fillStyle=color; ctx.font='bold 11px monospace'; ctx.textAlign='left';
  ctx.fillText(label, W/2+18, ypx+4);
  ctx.textAlign='left';
}

function afvNiceStep(rangemm, px, minPx){
  var steps=[50,100,200,250,500,1000];
  for(var i=0;i<steps.length;i++){
    if(rangemm/steps[i]*px >= minPx) continue;
    return steps[i];
  }
  return steps[steps.length-1];
}

function afvSetupDrag(){
  var cv = document.getElementById('afv-cv');
  if(!cv||cv._afvDragReady) return;
  cv._afvDragReady=true;

  function getSheetDims(){
    var sw=1220,sh=2440;
    try{ if(typeof SHEETS!=='undefined'&&SHEETS.length>0){ sw=Math.round(SHEETS[0].width)||sw; sh=Math.round(SHEETS[0].height)||sh; } }catch(e){}
    return {sw:sw,sh:sh};
  }

  function getYPx(e){
    var rect=cv.getBoundingClientRect();
    var clientY=e.touches?e.touches[0].clientY:e.clientY;
    return (clientY-rect.top)*(cv.height/rect.height);
  }

  function hitTest(ypx){
    var d=getSheetDims();
    var yBotPx=afvMmToCanvas(afvThreshBot,'y',cv,d.sw,d.sh);
    var yTopPx=afvMmToCanvas(d.sh-afvThreshTop,'y',cv,d.sw,d.sh);
    if(Math.abs(ypx-yBotPx)<10) return 'bottom';
    if(Math.abs(ypx-yTopPx)<10) return 'top';
    return null;
  }

  cv.addEventListener('mousedown',function(e){
    var hit=hitTest(getYPx(e));
    if(hit){ afvDragState=hit; e.preventDefault(); }
  });
  cv.addEventListener('mousemove',function(e){
    var ypx=getYPx(e);
    cv.style.cursor=hitTest(ypx)?'row-resize':'default';
    if(!afvDragState) return;
    var d=getSheetDims();
    var mm=Math.round(afvCanvasToMm(ypx,'y',cv,d.sw,d.sh));
    if(afvDragState==='bottom'){
      // DƯỚI: kéo đường từ đáy lên, mm tính từ Y=0
      afvThreshBot=Math.max(50, Math.min(d.sh/2-50, mm));
    } else {
      // TRÊN: kéo đường từ đỉnh xuống, mm tính từ Y=sheetH
      afvThreshTop=Math.max(50, Math.min(d.sh/2-50, d.sh-mm));
    }
    afvDrawSheet();
    afvBuildOverlay();
  });
  cv.addEventListener('mouseup',   function(){ 
    if(afvDragState){
      afvDragState=null;
      stgUpdate();
      try{ sketchup.save_settings_callback(JSON.stringify(STG)); }catch(e){}
    }
  });
  cv.addEventListener('mouseleave', function(){ 
    if(afvDragState){
      afvDragState=null;
      stgUpdate();
      try{ sketchup.save_settings_callback(JSON.stringify(STG)); }catch(e){}
    }
  });
}

function afvBuildOverlay(){
  var cv   = document.getElementById('afv-cv');
  var wrap = document.getElementById('afv-sheet-wrap');
  if(!cv||!wrap) return;

  // Xóa dots cũ
  wrap.querySelectorAll('.afv-odot-abs').forEach(function(el){ el.parentNode.removeChild(el); });

  var scaleX = cv.offsetWidth  / cv.width;
  var scaleY = cv.offsetHeight / cv.height;

  var dotDefs=[{idx:0},{idx:1},{idx:2},{idx:3}];

  AFV_ZONES.forEach(function(z){
    var r = afvDemoRects[z];
    if(!r) return;
    var corners=[
      {x:r.x,     y:r.y},
      {x:r.x+r.w, y:r.y},
      {x:r.x+r.w, y:r.y+r.h},
      {x:r.x,     y:r.y+r.h},
    ];
    dotDefs.forEach(function(dd){
      var corner = corners[dd.idx];
      var px = corner.x * scaleX;
      var py = corner.y * scaleY;
      var isChecked = (afvSel[z]===dd.idx);
      var idx = dd.idx;
      var zone = z;

      var dot = document.createElement('div');
      dot.className = 'afv-odot-abs';
      dot.setAttribute('data-zone', zone);
      dot.setAttribute('data-idx', idx);
      dot.style.cssText = 'position:absolute;width:18px;height:18px;cursor:pointer;' +
        'z-index:20;left:'+(px-9)+'px;top:'+(py-9)+'px;display:flex;align-items:center;justify-content:center;';

      var ring = document.createElement('div');
      ring.className = 'afv-dot-ring' + (isChecked ? ' afv-dot-checked' : '');
      ring.style.cssText = 'width:16px;height:16px;border-radius:50%;pointer-events:none;';
      dot.appendChild(ring);

      dot.onclick = function(){
        afvSel[zone] = idx;
        afvDrawSheet();
        stgUpdate();
        wrap.querySelectorAll('.afv-odot-abs').forEach(function(el){
          var z2=el.getAttribute('data-zone');
          var i2=+el.getAttribute('data-idx');
          var chk=(afvSel[z2]===i2);
          var r2=el.querySelector('.afv-dot-ring');
          if(r2) r2.className='afv-dot-ring'+(chk?' afv-dot-checked':'');
        });
      };

      wrap.appendChild(dot);
    });
  });
}

function afvDraw(){
  afvInitCanvas();
  afvBuildOverlay();
  afvSetupDrag();
}

// ─────────────────────────────────────────────────────────────
// Nhập / Xuất cấu hình
// ─────────────────────────────────────────────────────────────
// Danh sách các phần có thể nhập/xuất (key khớp backend Ruby)
var IMPEXP_PARTS = [
  { key:'font',    label:'Cỡ chữ giao diện',
    icon:'<path d="M4 7V5h16v2M9 19h6M12 5v14"/>' },
  { key:'naming',  label:'Đặt tên file g-code',
    icon:'<path d="M14 3v5h5M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M8 13h8M8 17h5"/>' },
  { key:'folder',  label:'Cấu trúc thư mục',
    icon:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' },
  { key:'posts',   label:'Post máy',
    icon:'<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM3 10h2M3 14h2M19 10h2M19 14h2M10 3v2M14 3v2M10 19v2M14 19v2"/>' },
  { key:'tools',   label:'Quản lý dao (thư viện dao cụ)',
    icon:'<path d="M14.7 6.3a4 4 0 0 0-5.4 5.3L3 18l3 3 6.4-6.3a4 4 0 0 0 5.3-5.4l-2.7 2.7-2.3-2.3z"/>' },
  { key:'presets', label:'Cấu hình dao (mẫu gán layer)',
    icon:'<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>' }
];
var _impexpMode = 'export';        // 'export' | 'import'
var _importAvailableParts = null;  // các phần có trong file khi nhập

function _renderImpExpParts(availableKeys){
  var html = IMPEXP_PARTS.map(function(p){
    var disabled = availableKeys && availableKeys.indexOf(p.key) < 0;
    return '<label class="impexp-part-row'+(disabled?' disabled':'')+'">'+
      '<input type="checkbox" class="impexp-part" value="'+p.key+'" '+(disabled?'disabled':'checked')+'>'+
      '<svg class="impexp-part-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+p.icon+'</svg>'+
      '<span class="impexp-part-label">'+p.label+'</span>'+
      (disabled?'<span class="impexp-part-note">không có trong file</span>':'')+
      '</label>';
  }).join('');
  document.getElementById('impexp-parts').innerHTML = html;
}

function impExpSelectAll(val){
  document.querySelectorAll('.impexp-part:not(:disabled)').forEach(function(c){ c.checked = val; });
}

function openExportModal(){
  _impexpMode = 'export';
  document.getElementById('impexp-title').textContent = 'Xuất dữ liệu';
  document.getElementById('impexp-sub').textContent = 'Chọn các phần muốn xuất ra file';
  document.getElementById('impexp-mode').style.display = 'none';
  document.getElementById('impexp-ok').textContent = 'Xuất';
  document.getElementById('impexp-icon').innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
  _renderImpExpParts(null);
  document.getElementById('impexp-modal').classList.add('show');
  forceRepaint(document.getElementById('impexp-modal'));
}

function openImportModal(){
  sketchup.pick_import_file_callback();
}

function n2gImportFilePicked(parts, filename){
  if(!parts){
    if(filename) setStatus('error', 'Lỗi đọc file: '+filename);
    return;
  }
  _impexpMode = 'import';
  _importAvailableParts = parts;
  document.getElementById('impexp-title').textContent = 'Nhập dữ liệu';
  document.getElementById('impexp-sub').textContent = 'Từ file: '+filename;
  document.getElementById('impexp-mode').style.display = 'block';
  document.getElementById('impexp-ok').textContent = 'Nhập';
  document.getElementById('impexp-icon').innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  _renderImpExpParts(parts);
  document.getElementById('impexp-modal').classList.add('show');
  forceRepaint(document.getElementById('impexp-modal'));
}

function closeImpExpModal(){
  document.getElementById('impexp-modal').classList.remove('show');
}

function impExpConfirm(){
  var checked = Array.prototype.slice.call(document.querySelectorAll('.impexp-part:checked'))
    .map(function(c){ return c.value; });
  if(checked.length === 0){ setStatus('error', 'Chưa chọn phần nào'); return; }

  if(_impexpMode === 'export'){
    sketchup.export_config_callback(JSON.stringify(checked));
  } else {
    var mode = document.querySelector('input[name="impexp-mode-radio"]:checked').value;
    sketchup.import_config_callback(JSON.stringify({ parts: checked, mode: mode }));
  }
  closeImpExpModal();
}

// Kết quả từ Ruby
function n2gExportResult(ok, msg){
  setStatus(ok ? 'ok' : 'error', ok ? ('Đã xuất: '+msg) : ('Lỗi xuất: '+msg));
}
function n2gImportResult(res){
  if(res && res.ok){
    var parts = (res.applied || []).join(', ');
    setStatus('ok', 'Đã nhập: '+parts+'. Đang tải lại...');
    // Tải lại toàn bộ dialog để mọi dữ liệu (post, dao, preset, cài đặt) cập nhật ngay,
    // không phải đóng/mở lại thủ công. Delay nhẹ để người dùng kịp thấy thông báo.
    setTimeout(function(){
      try{ location.reload(); }catch(e){
        // Fallback nếu reload bị chặn
        try{ sketchup.reload_tool_groups_callback(); }catch(e2){}
        try{ sketchup.load_settings_callback(); }catch(e3){}
      }
    }, 800);
  } else {
    setStatus('error', 'Lỗi nhập: '+((res&&res.msg)||'không rõ'));
  }
}
