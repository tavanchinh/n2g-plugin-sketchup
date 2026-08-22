// ── Polyfill cho SketchUp 2021 (WebView/CEF cũ, thiếu vài hàm ES2019+) ────────
// Đặt ĐẦU file đầu tiên được load để mọi code sau đều dùng được.
// Thiếu flatMap → nhiều chỗ tính bbox (loop.flatMap) sẽ lỗi "is not a function".
if(!Array.prototype.flatMap){
  Array.prototype.flatMap = function(cb, thisArg){
    var out = [];
    for(var i=0;i<this.length;i++){
      var r = cb.call(thisArg, this[i], i, this);
      if(Array.isArray(r)){ for(var j=0;j<r.length;j++) out.push(r[j]); }
      else out.push(r);
    }
    return out;
  };
}
if(!Array.prototype.flat){
  Array.prototype.flat = function(depth){
    var d = depth===undefined ? 1 : depth;
    return d < 1 ? this.slice() : this.reduce(function(acc, v){
      return acc.concat(Array.isArray(v) ? v.flat(d-1) : v);
    }, []);
  };
}
if(!String.prototype.replaceAll){
  String.prototype.replaceAll = function(find, rep){
    if(find instanceof RegExp) return this.replace(find, rep);
    return this.split(find).join(rep);
  };
}
if(!Array.prototype.at){
  Array.prototype.at = function(n){ n=Math.trunc(n)||0; if(n<0)n+=this.length; return this[n]; };
}

let SHEETS=[],TOOLS=[],PRESETS={};
let N2G_SAVE_HISTORY=true;  // bật/tắt lưu lịch sử gia công
let hiddenLayers=new Set();
let ALL_LAYERS=[],ALL_TOOLS_LIST=[],ALL_TOOL_GROUPS=[];

function n2gSetAllLayers(layers){
  ALL_LAYERS = (layers||[]).map(function(l){ return normalizeLayer(l); });
  _checkUnconfiguredLayers();
}

function n2gAddSheet(sheet, isLast){
  SHEETS.push(sheet);
  // Cập nhật số đếm trên overlay khi đang nhận sheet (phản hồi trực quan)
  var ot = document.querySelector('#overlay .otxt');
  if(ot) ot.textContent = 'ĐANG TẢI ' + SHEETS.length + ' TẤM...';
  if(isLast){
    // Tất cả sheets đã nhận đủ → render
    if(typeof _n2gClearScanTimeout === 'function') _n2gClearScanTimeout();
    renderSheets();
    document.getElementById('overlay').style.display='none';
  }
}

// Ruby báo: bắt đầu scan (dialog đã hiện, đang quét model)
var _n2gScanTimeout = null;
function n2gScanStart(){
  var ov = document.getElementById('overlay');
  if(ov) ov.style.display='flex';
  var ot = document.querySelector('#overlay .otxt');
  if(ot) ot.textContent = 'ĐANG QUÉT MODEL...';

  // ── Chốt an toàn: nếu scan treo/không có callback về sau 25s → tự ẩn overlay ──
  // Tránh kẹt mãi ở màn loading. Người dùng vẫn dùng được các tab (dao/post).
  if(_n2gScanTimeout) clearTimeout(_n2gScanTimeout);
  _n2gScanTimeout = setTimeout(function(){
    var o = document.getElementById('overlay');
    if(o && o.style.display !== 'none'){
      o.style.display = 'none';
      if(typeof setStatus === 'function')
        setStatus('warn','⚠ Quét model quá lâu — thử bấm "Tải lại". Bạn vẫn có thể cấu hình dao và post processor.');
      // Nếu chưa có sheet nào hiện, coi như trạng thái rỗng để hiện banner
      var banner = document.getElementById('no-nesting-banner');
      if(banner && banner.style.display === 'none'){
        var hasSheet = document.querySelector('#sheet-list .sheet-item, #sheet-select option[value]:not([value=""])');
        if(!hasSheet) banner.style.display='flex';
      }
    }
  }, 25000);
}

// Gỡ chốt an toàn khi scan đã xong (dù rỗng hay có sheet)
function _n2gClearScanTimeout(){
  if(_n2gScanTimeout){ clearTimeout(_n2gScanTimeout); _n2gScanTimeout = null; }
}

// Ruby báo: scan xong. noNesting=true → không có tấm nào.
function n2gScanDone(noNesting){
  _n2gClearScanTimeout();
  if(noNesting){
    // Không có nesting → ẩn overlay, hiện banner hướng dẫn
    document.getElementById('overlay').style.display='none';
    var btn = document.getElementById('btn-export');
    if(btn) btn.disabled = true;
    var banner = document.getElementById('no-nesting-banner');
    if(banner) banner.style.display='flex';
    if(typeof setStatus==='function')
      setStatus('warn','⚠ Chưa nesting — Mở file SketchUp đã nesting để xuất G-code. Bạn vẫn có thể cấu hình dao và post processor.');
  }
  // Có nesting → overlay đã tự ẩn ở n2gAddSheet(isLast). Không làm gì thêm.
}
let TOOL_PRESETS=[],selectedToolRow=-1;
let ACTIVE_PRESET_ID=null;


// Polyfill roundRect cho browser cũ
if(!CanvasRenderingContext2D.prototype.roundRect){
  CanvasRenderingContext2D.prototype.roundRect=function(x,y,w,h,r){
    this.beginPath();this.moveTo(x+r,y);this.lineTo(x+w-r,y);
    this.arcTo(x+w,y,x+w,y+r,r);this.lineTo(x+w,y+h-r);
    this.arcTo(x+w,y+h,x+w-r,y+h,r);this.lineTo(x+r,y+h);
    this.arcTo(x,y+h,x,y+h-r,r);this.lineTo(x,y+r);
    this.arcTo(x,y,x+r,y,r);this.closePath();
  };
}

// ── Resizable sidebar ─────────────────────────────────────────
(function(){
  var resizer = null;
  var sidebar = null;
  var startX  = 0;
  var startW  = 0;

  document.addEventListener('DOMContentLoaded', function(){
    resizer = document.getElementById('tools-sidebar-resizer');
    sidebar = document.getElementById('tools-sidebar');
    if(!resizer || !sidebar) return;

    resizer.addEventListener('mousedown', function(e){
      startX = e.clientX;
      startW = sidebar.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMove(e){
        var w = startW + (e.clientX - startX);
        w = Math.max(120, Math.min(400, w));
        sidebar.style.width = w + 'px';
      }
      function onUp(){
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
})();

// Không còn dùng overlay nền mờ (gây lỗi repaint trên CEF cũ của SketchUp).
// Giữ hàm rỗng để các lời gọi cũ không lỗi.
function forceRepaint(el){ /* no-op: modal không còn overlay nền */ }

// Ngưỡng miter khi offset biên dạng (khớp Ruby GcodeEngine::MITER_LIMIT).
// Đỉnh miter dài hơn ngưỡng × bán kính dao → bo cung thay vì để đỉnh nhọn vọt xa.
// 2.0 ↔ góc chi tiết ~60°.
var MITER_LIMIT_JS = 2.0;