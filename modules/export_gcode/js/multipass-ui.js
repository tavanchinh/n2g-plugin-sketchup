// ── multipass-ui.js ─────────────────────────────────────────────────────────
// Widget ĐỘC LẬP: vẽ hình chữ nhật (nhìn cạnh bên tấm ván) chia thành các lượt
// cắt bằng các đường gạch ngang KÉO ĐƯỢC. Mỗi đường = 1 mốc độ sâu Z.
//
// - Đáy CỐ ĐỊNH = tổng độ sâu (depth). Chỉ kéo được các đường GIỮA.
// - Trả về mảng độ sâu Z từng lượt, vd [6, 12, 17.5] (số dương = mm sâu).
// - Ràng buộc: giữ thứ tự, mỗi lượt >= MIN_STEP mm. Tối đa MAX_PASSES lượt.
//
// KHÔNG phụ thuộc TOOLS / engine / G-code. Chỉ là UI thuần.
// Cách dùng:
//   var mp = MultiPassUI.create(containerEl, {
//     totalDepth: 17.5,          // tổng độ sâu (mm, dương)
//     passes: [6, 12, 17.5],     // mảng mốc Z hiện có (tuỳ chọn; rỗng = 1 lượt)
//     onChange: function(arr){ ... }  // gọi mỗi khi thay đổi
//   });
//   mp.getPasses();   // lấy mảng hiện tại
//   mp.setTotalDepth(20);  // đổi tổng độ sâu (giữ tỉ lệ)
//   mp.destroy();
// ─────────────────────────────────────────────────────────────────────────────

var MultiPassUI = (function(){
  'use strict';

  var MAX_PASSES = 5;
  var MIN_STEP   = 0.5;   // mm — mỗi lượt tối thiểu, tránh lượt 0mm
  var BOX_H      = 150;   // px — chiều cao vùng vẽ
  var PAD_TOP    = 10;    // px đệm trên/dưới trong SVG

  function clamp(v, lo, hi){ return Math.min(hi, Math.max(lo, v)); }
  function round1(v){ return Math.round(v*10)/10; }

  function create(container, opts){
    opts = opts || {};
    // mode: 'mm' (độ sâu số cố định) | 'pct' (depth chứa Z → chia theo %).
    // Ở chế độ pct, total = 100 và các mốc là phần trăm; nhãn hiện '%'.
    var mode = (opts.mode === 'pct') ? 'pct' : 'mm';
    var unit = (mode === 'pct') ? '%' : 'mm';
    var total = (mode === 'pct') ? 100 : Math.max(MIN_STEP, +opts.totalDepth || 10);

    var state = {
      mode:    mode,
      unit:    unit,
      total:   total,
      passes:  null,        // mảng mốc (dương, tăng dần, phần tử cuối = total)
      onChange: typeof opts.onChange==='function' ? opts.onChange : function(){},
      dragIdx: -1,          // đường đang kéo (chỉ đường giữa)
      el: {}
    };

    // Khởi tạo passes
    var init = (opts.passes && opts.passes.length) ? opts.passes.slice() : [state.total];
    state.passes = sanitize(init, state.total);

    render(container, state);
    return {
      getPasses: function(){ return state.passes.slice(); },
      getMode: function(){ return state.mode; },
      setTotalDepth: function(d){
        if(state.mode === 'pct') return;   // chế độ % không phụ thuộc độ sâu số
        var old = state.total;
        var nd  = Math.max(MIN_STEP, +d || old);
        if(Math.abs(nd-old) < 1e-6) return;
        // Giữ TỈ LỆ các mốc giữa theo tổng mới
        var ratio = nd / old;
        state.total = nd;
        state.passes = state.passes.map(function(z, i){
          return (i===state.passes.length-1) ? nd : round1(z*ratio);
        });
        state.passes = sanitize(state.passes, nd);
        redraw(state);
        state.onChange(state.passes.slice());
      },
      destroy: function(){ if(container) container.innerHTML=''; }
    };
  }

  // Chuẩn hoá mảng: tăng dần, cách nhau >= MIN_STEP, phần tử cuối = total, tối đa MAX_PASSES lượt.
  function sanitize(arr, total){
    var a = (arr||[]).map(function(v){ return round1(clamp(+v||0, 0, total)); });
    // đảm bảo phần tử cuối = total
    if(!a.length) a = [total];
    a[a.length-1] = total;
    // cắt bớt nếu quá số lượt
    if(a.length > MAX_PASSES){ a = a.slice(0, MAX_PASSES); a[a.length-1] = total; }
    // ép tăng dần + khoảng cách tối thiểu
    for(var i=0;i<a.length;i++){
      var lo = (i===0) ? MIN_STEP : a[i-1] + MIN_STEP;
      var hi = (i===a.length-1) ? total : total - (a.length-1-i)*MIN_STEP;
      a[i] = round1(clamp(a[i], lo, Math.max(lo, hi)));
    }
    a[a.length-1] = total;
    return a;
  }

  function render(container, state){
    container.innerHTML =
      '<div class="mp-wrap">'+
        '<div class="mp-head">'+
          '<span class="mp-label">Số lượt xuống dao</span>'+
          '<div class="mp-btns">'+
            '<button type="button" class="mp-btn" data-act="minus" title="Bớt 1 lượt">−</button>'+
            '<span class="mp-count">1</span>'+
            '<button type="button" class="mp-btn" data-act="plus" title="Thêm 1 lượt">+</button>'+
          '</div>'+
        '</div>'+
        '<div class="mp-stage"><svg class="mp-svg" xmlns="http://www.w3.org/2000/svg"></svg></div>'+
        '<div class="mp-hint">Kéo các đường ngang để chỉnh độ sâu mỗi lượt. Đáy cố định = độ sâu cắt.</div>'+
      '</div>';

    state.el.wrap  = container.querySelector('.mp-wrap');
    state.el.svg   = container.querySelector('.mp-svg');
    state.el.count = container.querySelector('.mp-count');

    // Nút +/−
    container.querySelectorAll('.mp-btn').forEach(function(b){
      b.addEventListener('click', function(e){
        e.preventDefault(); e.stopPropagation();
        if(b.dataset.act==='plus')  addPass(state);
        else                        removePass(state);
      });
    });

    redraw(state);
  }

  function addPass(state){
    if(state.passes.length >= MAX_PASSES) return;
    // Chèn 1 mốc mới: chia đôi lượt DÀY nhất
    var maxGap = -1, gapIdx = 0, prev = 0;
    for(var i=0;i<state.passes.length;i++){
      var gap = state.passes[i] - prev;
      if(gap > maxGap){ maxGap = gap; gapIdx = i; }
      prev = state.passes[i];
    }
    var top = (gapIdx===0) ? 0 : state.passes[gapIdx-1];
    var mid = round1((top + state.passes[gapIdx]) / 2);
    state.passes.splice(gapIdx, 0, mid);
    state.passes = sanitize(state.passes, state.total);
    redraw(state);
    state.onChange(state.passes.slice());
  }

  function removePass(state){
    if(state.passes.length <= 1) return;
    // Bỏ mốc GIỮA cuối cùng (không bỏ đáy)
    state.passes.splice(state.passes.length-2, 1);
    state.passes = sanitize(state.passes, state.total);
    redraw(state);
    state.onChange(state.passes.slice());
  }

  function redraw(state){
    var svg = state.el.svg;
    if(!svg) return;
    // Đo chiều rộng đáng tin: SVG → stage → wrap → container. Lúc modal vừa chèn,
    // clientWidth có thể = 0 nên đi ngược lên tới phần tử đã có layout.
    var W = svg.clientWidth
         || (state.el.wrap && state.el.wrap.clientWidth)
         || (svg.parentNode && svg.parentNode.clientWidth)
         || 0;
    if(W < 40){                       // vẫn chưa layout xong → hoãn 1 khung hình
      requestAnimationFrame(function(){ redraw(state); });
      return;
    }
    var H = BOX_H;
    svg.setAttribute('viewBox', '0 0 '+W+' '+H);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);

    state.el.count.textContent = state.passes.length;

    var total = state.total;
    // Chừa lề PHẢI rộng hơn (40px) cho nhãn Z bên phải như "10.2", "100" không bị che.
    var x0 = 34, x1 = W - 40;            // vùng hộp (trái cho nhãn Z gốc, phải cho nhãn mốc)
    var yTop = PAD_TOP, yBot = H - PAD_TOP;
    var zToY = function(z){ return yTop + (z/total)*(yBot-yTop); };

    var ns = 'http://www.w3.org/2000/svg';
    var parts = [];

    // Nền hộp (tấm ván nhìn cạnh)
    parts.push('<rect x="'+x0+'" y="'+yTop+'" width="'+(x1-x0)+'" height="'+(yBot-yTop)+'" rx="4" '+
               'fill="var(--surface,#f4f4f2)" stroke="var(--border,#ccc)" stroke-width="1.2"/>');

    // Nhãn Z=0 và Z=đáy
    parts.push('<text x="'+(x0-6)+'" y="'+(yTop+3)+'" text-anchor="end" class="mp-ztext">0</text>');
    parts.push('<text x="'+(x0-6)+'" y="'+(yBot+3)+'" text-anchor="end" class="mp-ztext">'+round1(total)+'</text>');

    // Tô sọc xen kẽ cho các lượt + nhãn độ dày lượt
    var prevY = yTop, prevZ = 0;
    for(var i=0;i<state.passes.length;i++){
      var z = state.passes[i];
      var y = zToY(z);
      if(i % 2 === 1){
        parts.push('<rect x="'+x0+'" y="'+prevY+'" width="'+(x1-x0)+'" height="'+(y-prevY)+'" '+
                   'fill="var(--accent,#4f8a14)" opacity="0.08"/>');
      }
      // nhãn độ dày lượt (giữa dải)
      var midY = (prevY + y)/2;
      var thick = round1(z - prevZ);
      parts.push('<text x="'+((x0+x1)/2)+'" y="'+(midY+3)+'" text-anchor="middle" class="mp-passtext">'+
                 (i+1)+': '+thick+state.unit+'</text>');
      prevY = y; prevZ = z;
    }

    // Các đường ngang: đáy (cố định) + các đường giữa (kéo được)
    for(var j=0;j<state.passes.length;j++){
      var zz = state.passes[j];
      var yy = zToY(zz);
      var isBottom = (j === state.passes.length-1);
      if(isBottom){
        parts.push('<line x1="'+x0+'" y1="'+yy+'" x2="'+x1+'" y2="'+yy+'" '+
                   'stroke="var(--text2,#666)" stroke-width="2"/>');
      }else{
        // đường kéo được: line + handle tròn
        parts.push('<line x1="'+x0+'" y1="'+yy+'" x2="'+x1+'" y2="'+yy+'" '+
                   'stroke="var(--accent,#4f8a14)" stroke-width="2" stroke-dasharray="5 3" class="mp-line"/>');
        parts.push('<circle cx="'+((x0+x1)/2)+'" cy="'+yy+'" r="7" class="mp-handle" data-idx="'+j+'"/>');
        parts.push('<text x="'+(x1+2)+'" y="'+(yy+3)+'" text-anchor="start" class="mp-ztext">'+round1(zz)+'</text>');
      }
    }

    svg.innerHTML = parts.join('');

    // Gắn kéo cho các handle
    svg.querySelectorAll('.mp-handle').forEach(function(h){
      h.addEventListener('mousedown', function(e){ startDrag(e, state, +h.dataset.idx); });
      h.addEventListener('touchstart', function(e){ startDrag(e, state, +h.dataset.idx); }, {passive:false});
    });
  }

  function startDrag(e, state, idx){
    e.preventDefault(); e.stopPropagation();
    state.dragIdx = idx;
    var svg = state.el.svg;

    var move = function(ev){
      if(state.dragIdx < 0) return;
      var pt = clientY(ev);
      var rect = svg.getBoundingClientRect();
      var H = BOX_H, yTop = PAD_TOP, yBot = H - PAD_TOP;
      var yRel = clamp(pt - rect.top, yTop, yBot);
      var z = ((yRel - yTop)/(yBot - yTop)) * state.total;

      // ràng buộc: giữa đường trên và dưới, cách MIN_STEP
      var i = state.dragIdx;
      var lo = (i===0) ? MIN_STEP : state.passes[i-1] + MIN_STEP;
      var hi = state.passes[i+1] - MIN_STEP;   // luôn có đường dưới (đáy)
      z = clamp(z, lo, Math.max(lo, hi));
      state.passes[i] = round1(z);
      redraw(state);
    };
    var up = function(){
      if(state.dragIdx < 0) return;
      state.dragIdx = -1;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
      state.passes = sanitize(state.passes, state.total);
      redraw(state);
      state.onChange(state.passes.slice());
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, {passive:false});
    document.addEventListener('touchend', up);
  }

  function clientY(ev){
    if(ev.touches && ev.touches.length) return ev.touches[0].clientY;
    if(ev.changedTouches && ev.changedTouches.length) return ev.changedTouches[0].clientY;
    return ev.clientY;
  }

  return { create: create, MAX_PASSES: MAX_PASSES, MIN_STEP: MIN_STEP };
})();