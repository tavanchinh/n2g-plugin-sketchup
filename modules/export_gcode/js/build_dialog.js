#!/usr/bin/env node
/**
 * build_dialog.js — Đóng gói dialog.html + css + js thành 1 file HTML tự chứa,
 * obfuscate JS, rồi ghi ra dialog_assets.rb (chuỗi base64) để nạp qua set_html.
 *
 * Mục đích: không còn file .js nằm trần trong thư mục plugin; JS bị làm rối.
 * Lưu ý: đây là RÀO CẢN, không phải mã hóa tuyệt đối — JS vẫn chạy trong WebView
 * nên người quyết tâm mở DevTools vẫn đọc được. Giữ mã nguồn gốc để phát triển,
 * chỉ chạy script này khi ĐÓNG GÓI phát hành.
 *
 * Dùng:  node build_dialog.js
 * Cần:   npm install javascript-obfuscator terser   (chạy 1 lần)
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const { minify } = require('terser');
const JsObfuscator = require('javascript-obfuscator');

const DIR       = __dirname;
const HTML_IN   = path.join(DIR, 'dialog.html');
const CSS_FILE  = path.join(DIR, 'css', 'dialog.css');
const OUT_RB    = path.join(DIR, 'dialog_assets.rb');

// Cấu hình obfuscate — GIỮ tên global (renameGlobals:false) để onclick="fn()" còn chạy.
// KHÔNG bật controlFlowFlattening/deadCodeInjection để tránh làm chậm animation.
const OBF_OPTS = {
  compact: true,
  simplify: true,
  renameGlobals: false,          // BẮT BUỘC: giữ tên hàm global cho inline handler
  identifierNamesGenerator: 'hexadecimal',
  stringArray: true,
  stringArrayThreshold: 0.7,
  stringArrayEncoding: ['base64'],
  splitStrings: false,
  transformObjectKeys: false,    // giữ key object (nhiều nơi truy cập bằng chuỗi từ JSON)
  numbersToExpressions: false,
  controlFlowFlattening: false,  // giữ tốc độ cho canvas/animation
  deadCodeInjection: false,
  unicodeEscapeSequence: false
};

async function main(){
  let html = fs.readFileSync(HTML_IN, 'utf8');

  // 1) Inline CSS: thay <link ... href="css/dialog.css"> bằng <style>…</style>
  const css = fs.readFileSync(CSS_FILE, 'utf8');
  html = html.replace(
    /<link\s+rel=["']stylesheet["']\s+href=["']css\/dialog\.css["']\s*\/?>/i,
    `<style>\n${css}\n</style>`
  );

  // 2) Gộp JS theo ĐÚNG thứ tự thẻ <script src="js/..."> xuất hiện trong HTML
  const scriptRe = /<script\s+src=["']js\/([^"']+)["']\s*><\/script>\s*/gi;
  const files = [];
  let m;
  while((m = scriptRe.exec(html)) !== null) files.push(m[1]);
  if(files.length === 0){
    console.error('⚠ Không tìm thấy thẻ <script src="js/..."> nào trong dialog.html');
    process.exit(1);
  }
  console.log(`Gộp ${files.length} file JS theo thứ tự:`);
  files.forEach(f => console.log('   - ' + f));

  let bundle = '';
  for(const f of files){
    const p = path.join(DIR, 'js', f);
    bundle += `\n/* ${f} */\n` + fs.readFileSync(p, 'utf8') + '\n;';
  }

  // 3) Minify (terser) — toplevel:false để KHÔNG đổi tên global
  console.log('Minify (terser)…');
  const min = await minify(bundle, {
    compress: { drop_console: false },
    mangle:   { toplevel: false },   // giữ tên global
    format:   { comments: false }
  });
  if(min.error){ console.error('Terser error:', min.error); process.exit(1); }

  // 4) Obfuscate (javascript-obfuscator)
  console.log('Obfuscate…');
  const obf = JsObfuscator.obfuscate(min.code, OBF_OPTS).getObfuscatedCode();

  // 5) Chèn 1 script gộp; xóa các thẻ script rời. Escape </ để không vỡ thẻ HTML.
  const safe = obf.replace(/<\/(script)/gi, '<\\/$1');
  let first = true;
  html = html.replace(scriptRe, () => {
    if(first){ first = false; return `<script>\n${safe}\n</script>\n`; }
    return '';
  });

  // 6) Ghi dialog_assets.rb — HTML mã hóa base64 để tránh mọi vấn đề escaping Ruby
  const b64 = Buffer.from(html, 'utf8').toString('base64');
  // chia dòng ~120 ký tự cho gọn
  const lines = b64.match(/.{1,120}/g).join("\\\n");
  const rb =
`# frozen_string_literal: false
# ── dialog_assets.rb — TỰ SINH bởi build_dialog.js. KHÔNG sửa tay. ──
# Chứa toàn bộ dialog.html + css + js (đã gộp & obfuscate) dưới dạng base64.
# Nạp qua N2G::ExportGcode::DialogAssets.html → dùng với dlg.set_html(...).
require 'base64'
module N2G
  module ExportGcode
    module DialogAssets
      HTML_B64 = "\\
${lines}".freeze
      def self.html
        Base64.decode64(HTML_B64).force_encoding('UTF-8')
      end
    end
  end
end
`;
  fs.writeFileSync(OUT_RB, rb, 'utf8');
  const kb = (Buffer.byteLength(rb) / 1024).toFixed(0);
  console.log(`✓ Đã ghi dialog_assets.rb (${kb} KB)`);
  console.log('  → Copy dialog_assets.rb vào thư mục plugin cùng dialogs.rb.');
  console.log('  → Khi có dialog_assets.rb, dialogs.rb tự dùng nó (set_html);');
  console.log('    nếu xóa đi, tự quay lại đọc file dialog.html (chế độ dev).');
}

main().catch(e => { console.error(e); process.exit(1); });