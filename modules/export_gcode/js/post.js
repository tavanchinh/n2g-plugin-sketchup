// ── Post Sidebar ──────────────────────────────────────────────────────────────
let _currentPostId = null;

function renderPostSidebar(posts, activeId){
  const list = document.getElementById('post-sidebar-list');
  if(!list) return;
  list.innerHTML='';
  Object.values(posts).forEach(p=>{
    const item=document.createElement('div');
    item.className='post-item'+(p.id===activeId?' active-post':'');
    item.dataset.id=p.id;
    item.innerHTML=`<span class="post-item-name" title="${p.name||p.id}">${p.name||p.id}</span>
      <span class="post-item-dup" onclick="event.stopPropagation();duplicatePost('${p.id}')" title="Nhân bản post này"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 11V4a1 1 0 0 1 1-1h7"/></svg></span>
      <span class="post-item-del" onclick="event.stopPropagation();deletePost('${p.id}')" title="Xóa">✕</span>`;
    item.onclick=()=>{ loadPreset(p.id); selectPostItem(p.id); };
    list.appendChild(item);
  });
}

function selectPostItem(id){
  _currentPostId=id;
  document.querySelectorAll('.post-item').forEach(i=>{
    i.classList.toggle('active-post', i.dataset.id===id);
  });
  document.getElementById('pp-parsed-preview').style.display='block';
  document.getElementById('pp-manual-section').style.display='none';
  // Điền tên post vào input
  const p=PRESETS[id];
  if(p) document.getElementById('pp-save-name').value=p.name||p.id;
}

function newPostTemplate(){
  _currentPostId=null;
  document.querySelectorAll('.post-item').forEach(i=>i.classList.remove('active-post'));
  document.getElementById('pp-save-name').value='';
  document.getElementById('pp-unit').value='G21';
  document.getElementById('pp-safez').value='40';
  document.getElementById('pp-clearz').value='40';
  document.getElementById('pp-ext').value='.nc';
  document.getElementById('pp-comment').value='off';
  document.getElementById('pp-spindle-on').value='M03';
  document.getElementById('pp-spindle-off').value='M05';
  document.getElementById('pp-cool-on').value='';
  document.getElementById('pp-cool-off').value='';
  document.getElementById('pp-toolchange').value='( === {layer_name} | {tool_name} D{diameter} Z{depth} === )\n{spindle_off}\nT{tool_number}\nG43 H{tool_number}\n{spindle_on} S{rpm}';
  document.getElementById('pp-header').value='( N2G - {sheet_name} )\n( {date} )\nG90\nG54';
  document.getElementById('pp-footer').value='{spindle_off}\nG0 Z{safe_z}\nM30';
  document.getElementById('pp-aspire-raw').value='';
  // Hiện import Aspire khi thêm mới
  document.getElementById('pp-aspire-section').style.display='block';
  document.getElementById('pp-parsed-preview').style.display='block';
  document.getElementById('pp-manual-section').style.display='none';
  document.getElementById('pp-save-name').focus();
}

// Modal xác nhận dùng chung (Promise). buttons: [{label,value,kind}]
// iconType (tùy chọn): 'trash' (mặc định), 'play', 'warn', 'info'
var _gconfirmResolve = null;
function showGConfirm(title, bodyHtml, buttons, iconType){
  return new Promise(function(resolve){
    _gconfirmResolve = resolve;
    document.getElementById('gconfirm-title').textContent = title;
    document.getElementById('gconfirm-body').innerHTML = bodyHtml;
    // Đổi icon theo ngữ cảnh (mặc định thùng rác cho hành động xóa)
    var iconEl = document.getElementById('gconfirm-icon');
    if(iconEl){
      var icons = {
        trash: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
        play:  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
        warn:  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        info:  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
      };
      iconEl.innerHTML = icons[iconType || 'trash'] || icons.trash;
      // màu icon + nền theo ngữ cảnh
      var col = { play:'#1a7ad4', info:'#1a7ad4', warn:'#e0a800', trash:'#d9342b' };
      var bg  = { play:'#e8f2fc', info:'#e8f2fc', warn:'#fdf4e0', trash:'#fdecec' };
      var t = iconType || 'trash';
      iconEl.style.color = col[t] || '#d9342b';
      iconEl.style.background = bg[t] || '#fdecec';
    }
    var ft = document.getElementById('gconfirm-footer');
    ft.innerHTML = '';
    buttons.forEach(function(b){
      var btn = document.createElement('button');
      btn.className = 'tbtn' + (b.kind==='primary'?' tbtn-primary':b.kind==='danger'?' tbtn-danger':'');
      btn.textContent = b.label;
      btn.onclick = function(){ _closeGConfirm(b.value); };
      ft.appendChild(btn);
    });
    document.getElementById('gconfirm-modal').classList.add('show');
    forceRepaint(document.getElementById('gconfirm-modal'));
  });
}
function _closeGConfirm(val){
  document.getElementById('gconfirm-modal').classList.remove('show');
  if(_gconfirmResolve){ _gconfirmResolve(val); _gconfirmResolve = null; }
}

async function deletePost(id){
  var p = PRESETS[id];
  var nm = (p && (p.name || p.title)) ? (p.name || p.title) : 'post này';
  var choice = await showGConfirm(
    'Xóa post máy',
    'Bạn có chắc muốn xóa <b>"'+nm+'"</b>?<br><span style="color:var(--text2);font-size:12px">Không thể hoàn tác.</span>',
    [
      { label:'Hủy', value:'cancel', kind:'ghost' },
      { label:'Xóa', value:'delete', kind:'danger' }
    ]
  );
  if(choice !== 'delete') return;
  delete PRESETS[id];
  if(_currentPostId===id){ _currentPostId=null; }
  renderPostSidebar(PRESETS, _currentPostId);
  try{ sketchup.delete_post_preset_callback(id); }catch(e){}
  setStatus('ok','Đã xóa post');
}

function deleteCurrentPost(){
  if(_currentPostId) deletePost(_currentPostId);
}

function duplicatePost(id){
  const src = PRESETS[id];
  if(!src) return;
  // Tên bản sao không trùng
  let base = (src.name || id) + ' (copy)';
  let name = base, n = 2;
  const existingNames = Object.values(PRESETS).map(p=>p.name||p.id);
  while(existingNames.includes(name)){ name = base+' '+n; n++; }
  // Sao chép sâu toàn bộ cấu hình post
  const copy = JSON.parse(JSON.stringify(src));
  const newId = 'post_'+Date.now();
  copy.id = newId;
  copy.name = name;
  PRESETS[newId] = copy;
  _currentPostId = newId;
  renderPostSidebar(PRESETS, newId);
  selectPostItem(newId);
  try{ sketchup.save_post_preset_callback(JSON.stringify(copy)); }catch(e){}
  setStatus('ok',`Đã nhân bản post: "${src.name||id}" → "${name}"`);
}

// ── Aspire Post Parser ────────────────────────────────────────────────────────
// ── Import post từ file .pp: kéo-thả + chọn file ──────────────────────────
// Nạp nội dung file vào #pp-aspire-raw rồi gọi parseAspirePost() (giữ nguyên logic cũ).
function ppLoadContent(text, fileName){
  var ta = document.getElementById('pp-aspire-raw');
  if(ta) ta.value = text || '';
  var fEl = document.getElementById('pp-drop-file');
  if(fEl) fEl.textContent = fileName ? ('✓ ' + fileName) : '';
  if((text||'').trim()){
    parseAspirePost();   // tự phân tích ngay sau khi nạp
  } else {
    setStatus('err','File rỗng hoặc không đọc được');
  }
}

function ppDragOver(e){ e.preventDefault(); e.stopPropagation();
  document.getElementById('pp-drop').classList.add('dragover'); }
function ppDragLeave(e){ e.preventDefault(); e.stopPropagation();
  document.getElementById('pp-drop').classList.remove('dragover'); }

function ppDrop(e){
  e.preventDefault(); e.stopPropagation();
  document.getElementById('pp-drop').classList.remove('dragover');
  var files = e.dataTransfer && e.dataTransfer.files;
  if(!files || !files.length){ setStatus('err','Không nhận được file'); return; }
  var f = files[0];
  var reader = new FileReader();
  reader.onload  = function(ev){ ppLoadContent(ev.target.result, f.name); };
  reader.onerror = function(){ setStatus('err','Lỗi đọc file'); };
  reader.readAsText(f);
}

// Bấm vùng thả → ưu tiên hộp thoại NATIVE của SketchUp (chắc chắn hoạt động
// trong HtmlDialog). Nếu không có (chạy ngoài SketchUp) → dùng input file trình duyệt.
function ppPickFile(){
  if(typeof sketchup !== 'undefined' && sketchup.pick_pp_file){
    sketchup.pick_pp_file();
  } else {
    var inp = document.getElementById('pp-file-input');
    if(inp) inp.click();
  }
}
// Fallback: chọn qua input file trình duyệt
function ppFileInputChange(e){
  var f = e.target.files && e.target.files[0];
  if(!f) return;
  var reader = new FileReader();
  reader.onload  = function(ev){ ppLoadContent(ev.target.result, f.name); };
  reader.onerror = function(){ setStatus('err','Lỗi đọc file'); };
  reader.readAsText(f);
  e.target.value = '';  // cho phép chọn lại cùng file
}
// Ruby gọi lại sau khi đọc file native: truyền nội dung + tên file
function ppFileLoaded(text, fileName){ ppLoadContent(text, fileName); }

function parseAspirePost(){
  const raw = document.getElementById('pp-aspire-raw').value.trim();
  if(!raw){ setStatus('err','Chưa paste nội dung post'); return; }

  // Helper: lấy value của key = "..."
  const getVal = (key) => {
    const m = raw.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'mi'));
    return m ? m[1] : null;
  };

  // Helper: lấy block "begin BLOCKNAME ... begin NEXTBLOCK" hoặc end of file
  const getBlock = (name) => {
    const m = raw.match(new RegExp(`begin\\s+${name}[^\\n]*\\n([\\s\\S]*?)(?=\\n\\s*begin\\s+|$)`, 'i'));
    if(!m) return null;
    // Lấy các dòng trong dấu ""
    const lines = [];
    const lineRe = /"([^"]*)"/g;
    let lm;
    while((lm=lineRe.exec(m[1]))!==null) lines.push(lm[1]);
    return lines.join('\n');
  };

  // Parse fields
  const ext      = getVal('FILE_EXTENSION') || 'nc';
  const units    = (getVal('UNITS')||'').toUpperCase()==='INCH' ? 'G20' : 'G21';
  const postName = getVal('POST_NAME') || '';

  // Parse blocks — HEADER và TOOLCHANGE độc lập nhau
  const headerRaw     = getBlock('HEADER')     || '';
  const toolchangeRaw = getBlock('TOOLCHANGE')  || getBlock('NEW_SEGMENT') || '';
  const footerRaw     = getBlock('FOOTER')      || '';

  // Map Aspire [VAR] → N2G {var}
  const mapVars = (s) => s
    .replace(/\[SAFEZ\]/gi, '{safe_z}')
    .replace(/G00?\s+\[ZH\]/gi, 'G0 Z{safe_z}')
    .replace(/\[ZH\]/gi,    'G0 Z{safe_z}')
    .replace(/\[XH\]\[YH\]/gi, 'G0 X0 Y0')
    .replace(/\[XH\]/gi,    'X0')
    .replace(/\[YH\]/gi,    'Y0')
    // G43 H[T] phải replace trước [T] để tránh double
    .replace(/G43\s*H\[T\]/gi, 'G43 H{tool_number}')
    .replace(/T\[T\]M6/gi,  'T{tool_number}\nM6')
    .replace(/T\[T\]/gi,    'T{tool_number}')
    .replace(/\[T\]/gi,     '{tool_number}')
    .replace(/G43\s*H\d+/gi,'G43 H{tool_number}')
    // M03/M3 + [S] → spindle on + rpm
    .replace(/M0?3\s*\[S\]/gi,  '{spindle_on} S{rpm}')
    .replace(/\[S\]\s*M0?3/gi,  '{spindle_on} S{rpm}')
    .replace(/\[S\]/gi,     'S{rpm}')
    .replace(/M03\b/g,      '{spindle_on}')
    .replace(/M3\b/g,       '{spindle_on}')
    .replace(/M05\b/g,      '{spindle_off}')
    .replace(/M5\b/g,       '{spindle_off}')
    .replace(/M30\b/g,      'M30')
    .replace(/\[N\]/gi,     '')
    .replace(/\[F\]/gi,     '')
    .replace(/\[X\]\s*\[Y\]\s*\[Z\]/gi, '')
    .replace(/\[X\]/gi,     '')
    .replace(/\[Y\]/gi,     '')
    .replace(/\[Z\]/gi,     '')
    // Hardcoded Z trong footer → {safe_z}
    .replace(/\bG0\s+Z\d+(?:\.\d+)?\b/gi, 'G0 Z{safe_z}')
    .replace(/^\s*\n/gm,  '')
    .split('\n').map(l => l.trim()).join('\n')
    .trim();

  const header     = mapVars(headerRaw);
  const toolchange = toolchangeRaw
    ? mapVars(toolchangeRaw)
    : 'T{tool_number}\nG43 H{tool_number}\n{spindle_on} S{rpm}';
  const footer     = mapVars(footerRaw);

  // Detect spindle on/off từ header/footer
  const spOnMatch  = raw.match(/M0?3/i);
  const spOffMatch = raw.match(/M0?5/i);
  const spOn  = spOnMatch  ? spOnMatch[0].toUpperCase()  : 'M03';
  const spOff = spOffMatch ? spOffMatch[0].toUpperCase() : 'M05';

  // Điền vào form
  document.getElementById('pp-unit').value        = units;
  document.getElementById('pp-ext').value         = ext.startsWith('.')?ext:'.'+ext;
  document.getElementById('pp-spindle-on').value  = spOn;
  document.getElementById('pp-spindle-off').value = spOff;
  document.getElementById('pp-cool-on').value     = '';
  document.getElementById('pp-cool-off').value    = '';
  document.getElementById('pp-header').value      = header;
  document.getElementById('pp-toolchange').value  = toolchange;
  document.getElementById('pp-footer').value      = footer;

  // Gợi ý tên
  if(postName && !document.getElementById('pp-save-name').value)
    document.getElementById('pp-save-name').value = postName.replace(/\s*\(.*\)/, '').trim();

  document.getElementById('pp-parsed-preview').style.display='block';
  document.getElementById('pp-manual-section').style.display='none';

  setStatus('ok','Đã phân tích post — kiểm tra và chỉnh sửa nếu cần');
}

// Chuyển Aspire block variables sang N2G variables
function aspireBlockToN2G(block){
  if(!block) return '';
  return block
    .replace(/\[SAFE_Z\]/gi, '{safe_z}')
    .replace(/\[CLEAR_Z\]/gi, '{safe_z}')
    .replace(/\[PartName\]/gi, '{sheet_name}')
    .replace(/\[DATE\]/gi, '{date}')
    .replace(/\[UNITS\]/gi, '{unit}')
    .replace(/\[SPINDLE_SPEED\]/gi, '{rpm}')
    .replace(/\[SPINDLE_ON\]/gi, '{spindle_on}')
    .replace(/\[SPINDLE_OFF\]/gi, '{spindle_off}')
    .replace(/\[COOLANT_ON\]/gi, '{coolant_on}')
    .replace(/\[COOLANT_OFF\]/gi, '{coolant_off}')
    .replace(/\[T\]/gi, '{tool_number}')
    .replace(/\[TOOL_NUMBER\]/gi, '{tool_number}')
    .replace(/\[TOOL_NAME\]/gi, '{tool_name}')
    .replace(/\[TOOL_DIA\]/gi, '{diameter}')
    .replace(/\[TOOL_FLUTES\]/gi, '')
    .replace(/\[HOME_X\]/gi, 'G0 X0')
    .replace(/\[HOME_Y\]/gi, 'G0 Y0')
    .replace(/\[G_ABSOLUTE\]/gi, 'G90')
    .replace(/\[G_INCREMENTAL\]/gi, 'G91')
    .replace(/^[ \t]+/gm,'')
    .trim();
}

function collectPostConfig(){
  var g = function(id){ var el=document.getElementById(id); return el?el.value:''; };
  return {
    unit:        g('pp-unit')        || 'G21',
    safe_z:      +g('pp-safez')      || 40,
    clear_z:     +g('pp-clearz')     || 40,
    ext:         g('pp-ext')         || '.nc',
    comment:     g('pp-comment')     || 'off',
    spindle_on:  g('pp-spindle-on')  || 'M03',
    spindle_off: g('pp-spindle-off') || 'M05',
    cool_on:     g('pp-cool-on'),
    cool_off:    g('pp-cool-off'),
    header:      g('pp-header'),
    toolchange:  g('pp-toolchange'),
    footer:      g('pp-footer')
  };
}

function saveAspirePost(){
  const name = document.getElementById('pp-save-name').value.trim();
  if(!name){ setStatus('err','Nhập tên post trước'); return; }
  const cfg = collectPostConfig();
  cfg.name = name;
  const id = _currentPostId || ('post_'+Date.now());
  cfg.id = id;
  PRESETS[id] = cfg;
  _currentPostId = id;
  renderPostSidebar(PRESETS, id);
  selectPostItem(id);
  try{ sketchup.save_post_preset_callback(JSON.stringify(cfg)); }catch(e){}
  setStatus('ok',`Đã lưu post "${name}"`);
}