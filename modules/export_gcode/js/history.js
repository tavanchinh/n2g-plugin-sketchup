// ── history.js — Tab Lịch sử gia công: danh sách, xem, khôi phục ──

function n2gRefreshHistory(){
  var list=document.getElementById('history-list');
  if(list) list.innerHTML='<div style="text-align:center;padding:30px;color:var(--text3);font-size:12px">Đang tải…</div>';
  if(window.sketchup && sketchup.get_history_list_callback) sketchup.get_history_list_callback();
}

// Nhận danh sách từ Ruby
function n2gShowHistoryList(payload){
  var list=document.getElementById('history-list');
  var empty=document.getElementById('history-empty');
  var info=document.getElementById('history-storage-info');
  if(!list) return;
  var items=(payload && payload.list) || [];
  var st=(payload && payload.info) || {count:0,total_mb:0};
  if(info) info.textContent = items.length+' bản ghi · '+(st.total_mb||0)+' MB';

  if(!items.length){
    list.innerHTML='';
    if(empty) empty.style.display='flex';
    return;
  }
  if(empty) empty.style.display='none';

  var html='';
  items.forEach(function(m){
    html+='<div class="hist-card">'
      +'<div class="hist-main">'
        +'<div class="hist-file">'+n2gEsc(m.file_name||'Không rõ')+'</div>'
        +'<div class="hist-meta">'
          +'<span>🕐 '+n2gEsc(m.time||'')+'</span>'
          +'<span>▦ '+(m.sheet_count||0)+' tấm</span>'
          +'<span>▪ '+(m.part_count||0)+' chi tiết</span>'
        +'</div>'
        +'<div class="hist-meta hist-meta-tools">'
          +(m.tool_group?'<span>🔧 '+n2gEsc(m.tool_group)+'</span>':'')
          +(m.post?'<span>⚙ '+n2gEsc(m.post)+'</span>':'')
        +'</div>'
      +'</div>'
      +'<div class="hist-actions">'
        +'<button class="tbtn tbtn-p" onclick="n2gExportFromHistory(\''+m.id+'\')" title="Xuất lại G-code từ bản ghi này">▶ Xuất lại</button>'
        +'<button class="tbtn" onclick="n2gRestoreHistory(\''+m.id+'\')" title="Xem lại preview">👁 Xem</button>'
        +(m.output_dir?'<button class="tbtn" onclick="n2gOpenHistFolder(\''+n2gEsc(m.output_dir)+'\')" title="Mở thư mục">📁</button>':'')
        +'<button class="tbtn" onclick="n2gDeleteHistory(\''+m.id+'\',\''+n2gEsc(m.file_name||'')+'\')" title="Xóa">🗑</button>'
      +'</div>'
    +'</div>';
  });
  list.innerHTML=html;
}

function n2gEsc(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function n2gOpenHistFolder(dir){
  if(window.sketchup && sketchup.open_history_folder_callback) sketchup.open_history_folder_callback(dir);
}

function n2gDeleteHistory(id, name){
  showGConfirm(
    'Xóa bản ghi lịch sử',
    'Xóa bản ghi này?<br><br><b>'+n2gEsc(name)+'</b><br><br>Hành động không thể hoàn tác.',
    [{label:'Huỷ', value:false}, {label:'Xóa', value:true, kind:'danger'}]
  ).then(function(ok){
    if(!ok) return;
    if(window.sketchup && sketchup.delete_history_callback) sketchup.delete_history_callback(id);
  });
}

// Xuất lại G-code từ bản ghi lịch sử (dùng dao/post/hình học đã lưu)
function n2gExportFromHistory(id){
  showGConfirm(
    'Xuất lại G-code',
    'Xuất lại G-code từ bản ghi này?<br><br>Sẽ dùng bộ dao, post và hình học <b>đã lưu</b> tại thời điểm xuất trước — không phụ thuộc file đang mở hay cấu hình hiện tại.',
    [{label:'Huỷ', value:false}, {label:'Xuất lại', value:true, kind:'primary'}],
    'play'
  ).then(function(ok){
    if(!ok) return;
    if(typeof setStatus==='function') setStatus('busy','Đang xuất lại từ lịch sử…');
    if(window.sketchup && sketchup.export_from_history_callback) sketchup.export_from_history_callback(id);
  });
}

// Khôi phục — nạp lại hình học + cut_order từ bản ghi lên preview
function n2gRestoreHistory(id){
  if(window.sketchup && sketchup.restore_history_callback) sketchup.restore_history_callback(id);
}

// Nhận dữ liệu khôi phục từ Ruby → nạp vào preview
function n2gApplyRestore(payload){
  if(!payload || !payload.sheets){
    alert('Không có dữ liệu để khôi phục.');
    return;
  }
  // Nạp lại SHEETS từ lịch sử
  SHEETS.length = 0;
  payload.sheets.forEach(function(s){ SHEETS.push(s); });

  // Áp thứ tự cắt đã lưu
  if(payload.cut_order && typeof CUSTOM_CUT_ORDER !== 'undefined'){
    // xóa cũ, nạp mới
    Object.keys(CUSTOM_CUT_ORDER).forEach(function(k){ delete CUSTOM_CUT_ORDER[k]; });
    Object.keys(payload.cut_order).forEach(function(k){ CUSTOM_CUT_ORDER[k]=payload.cut_order[k]; });
  }

  // Chuyển sang tab Preview và render
  switchTab('preview');
  if(typeof renderSheets==='function') renderSheets();

  // Ẩn banner "chưa có nesting" nếu có
  var banner=document.getElementById('no-nesting-banner');
  if(banner) banner.style.display='none';

  // Thông báo
  if(typeof setStatus==='function'){
    setStatus('ok','✓ Đã khôi phục "'+n2gEsc(payload.file_name||'')+'" — '+SHEETS.length+' sheet. Bạn có thể xem lại và xuất lại.');
  }
}

function n2gRestoreResult(ok, msg){
  if(!ok) alert(msg||'Khôi phục thất bại.');
}