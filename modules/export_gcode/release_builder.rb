# ── release_builder.rb — Build bản phát hành NGAY TRONG SketchUp (Ruby thuần) ──
#
# Chỉ dùng ở máy phát triển (khi N2G::MODE_DEV tồn tại & true).
# Việc build:
#   1) Gộp css/dialog.css + js/*.js (đúng thứ tự trong dialog.html) vào dialog.html
#      → nén nhẹ (bỏ comment/khoảng trắng thừa) → mã hoá base64 → ghi dialog_assets.rb
#   2) Copy các file .rb cần thiết sang thư mục RELEASE, BỎ js/ css/ dialog.html
#      build_dialog.js, release_builder.rb, node_modules...
#
# Lưu ý: Ruby thuần KHÔNG obfuscate JS (chỉ nén nhẹ). Muốn obfuscate mạnh thì
# chạy build_dialog.js bằng Node. Với mục tiêu "gộp vào .rbe, không để .js nằm
# trần" thì bản Ruby này đã đủ.

require 'base64'
require 'fileutils'

module N2G
  module ExportGcode
    module ReleaseBuilder

      unless defined?(SRC_DIR)
        SRC_DIR     = File.dirname(__FILE__).freeze              # .../modules/export_gcode
        PLUGIN_ROOT = File.expand_path('../..', SRC_DIR).freeze  # .../n2g  (gốc plugin)
        # Không copy sang release (chỉ dùng khi phát triển)
        # Loại theo TÊN FILE — áp dụng ở mọi thư mục.
        EXCLUDE_NAMES = %w[
          build_dialog.js release_builder.rb
          package.json package-lock.json
        ].freeze

        # Loại theo ĐƯỜNG DẪN (tính từ gốc plugin) — chỉ đúng file đó.
        # QUAN TRỌNG: chỉ loại dialog.html của export_gcode (đã gộp vào
        # dialog_assets.rb). KHÔNG được loại modules/settings/dialog.html —
        # file đó nạp bằng set_file, không nằm trong assets, thiếu là LỖI.
        EXCLUDE_PATHS = %w[
          modules/export_gcode/dialog.html
        ].freeze

        # Loại theo THƯ MỤC. js/ css/ chỉ loại trong export_gcode (đã gộp vào assets).
        # website/ là MÃ SERVER — TUYỆT ĐỐI không đóng gói vào plugin của khách:
        # chứa config.php (mật khẩu DB, khóa PayOS, mật khẩu SMTP), api, admin...
        EXCLUDE_DIR_PATHS = %w[
          modules/export_gcode/js
          modules/export_gcode/css
          website
        ].freeze
        EXCLUDE_DIRS = %w[node_modules .git].freeze   # loại ở mọi nơi

        # Loại theo MẪU TÊN — file rác/backup của quá trình phát triển.
        # CỰC KỲ QUAN TRỌNG: các file .bak chứa MÃ NGUỒN THUẦN (main.rb.bak_gcode_v9...).
        # Nếu lọt vào release, khách mở ra đọc được hết → vô hiệu hoá .rbe + obfuscate JS.
        EXCLUDE_PATTERNS = [
          /\.bak/i,        # main.rb.bak_gcode_v1, dialog.html.bak_...
          /\.old\z/i,
          /\.orig\z/i,
          /\.tmp\z/i,
          /~\z/,           # file~ (editor backup)
          /\.md\z/i,       # tài liệu nội bộ (HUONG_DAN_*.md)
          /\.sql\z/i,      # schema.sql, database.sql — chỉ dùng ở server
          /\.php\z/i,      # file PHP server lạc trong modules (server_api_example.php)
          /mock_server/i   # server giả để test — không cho khách
        ].freeze
      end

      # Đọc version_name từ version.json trong plugin
      def self.plugin_version
        vf = File.join(PLUGIN_ROOT, 'version.json')
        return '0.0.0' unless File.exist?(vf)
        require 'json'
        (JSON.parse(File.read(vf))['version_name'] || '0.0.0').to_s.strip
      rescue
        '0.0.0'
      end

      # Thư mục release theo version: <thư mục người dùng chọn>/<version>
      def self.release_dir(base_dir)
        File.join(base_dir, plugin_version)
      end

      # Hỏi thư mục gốc cho mỗi lần build để không phụ thuộc một ổ đĩa cố định.
      def self.select_release_base
        UI.select_directory(
          title: 'Chọn thư mục lưu bản release N2G',
          directory: PLUGIN_ROOT
        )
      end

      # ── Điểm vào chính ──
      # regenerate_assets:
      #   true  → luôn gộp lại dialog_assets.rb bằng Ruby (nén nhẹ, không obfuscate)
      #   false → GIỮ dialog_assets.rb sẵn có (vd bản obfuscate do Node tạo), chỉ copy
      def self.build!(regenerate_assets: true)
        t0 = Time.now
        release_base = select_release_base
        return unless release_base && !release_base.to_s.empty?

        ver = plugin_version
        dest = release_dir(release_base)

        if regenerate_assets
          html = bundle_html
          write_assets_rb(html)
          asset_note = "dialog_assets.rb: gộp lại bằng Ruby (nén nhẹ)"
        else
          unless File.exist?(assets_rb_path)
            UI.messagebox("Chọn giữ assets sẵn có nhưng chưa thấy dialog_assets.rb.\n" \
                          "Chạy 'node build_dialog.js' trước, hoặc build với gộp lại.")
            return
          end
          asset_note = "dialog_assets.rb: GIỮ bản sẵn có (không gộp lại)"
        end

        n = copy_release(dest, ver)
        dt = (Time.now - t0).round(2)
        UI.messagebox("BUILD XONG (#{dt}s) — phiên bản #{ver}\n\n" \
          "• #{asset_note} — #{(File.size(assets_rb_path)/1024.0).round(0)} KB\n" \
          "• Copy #{n} file sang: #{dest}\n\n" \
          "Đã bỏ: js/, css/, dialog.html, build_dialog.js, release_builder.rb, node_modules.\n" \
          "n2g.rb đã tự bỏ MODE_DEV và đặt version = #{ver}.\n" \
          "Giờ gửi lên trang ký SketchUp.")
      rescue => e
        UI.messagebox("Build lỗi: #{e.message}\n#{e.backtrace.first}")
      end

      # ── Gộp dialog.html + css + js thành 1 HTML tự chứa ──
      def self.bundle_html
        html = File.read(File.join(SRC_DIR, 'dialog.html'), encoding: 'UTF-8')

        # CSS inline
        css_path = File.join(SRC_DIR, 'css', 'dialog.css')
        css = File.exist?(css_path) ? File.read(css_path, encoding: 'UTF-8') : ''
        css = minify_css(css)
        html = html.sub(
          %r{<link\s+rel=["']stylesheet["']\s+href=["']css/dialog\.css["']\s*/?>}i,
          "<style>\n#{css}\n</style>"
        )

        # JS: lấy đúng thứ tự thẻ <script src="js/...">
        files = html.scan(%r{<script\s+src=["']js/([^"']+)["']\s*></script>}i).flatten
        raise "Không thấy thẻ <script src=\"js/...\"> trong dialog.html" if files.empty?

        bundle = +''
        files.each do |f|
          p = File.join(SRC_DIR, 'js', f)
          next unless File.exist?(p)
          bundle << "\n/* #{f} */\n" << File.read(p, encoding: 'UTF-8') << "\n;"
        end
        bundle = minify_js(bundle)
        # tránh </script> làm vỡ thẻ
        bundle = bundle.gsub(%r{</(script)}i, '<\\/\1')

        # Chèn 1 script gộp thay thẻ đầu tiên, xoá các thẻ còn lại
        first = true
        html = html.gsub(%r{<script\s+src=["']js/[^"']+["']\s*></script>\s*}i) do
          if first then first = false; "<script>\n#{bundle}\n</script>\n" else '' end
        end
        html
      end

      # ── Nén nhẹ (KHÔNG obfuscate) ──
      # An toàn: chỉ bỏ comment block, comment dòng "an toàn", và khoảng trắng đầu/cuối dòng.
      # KHÔNG gộp dòng để tránh làm hỏng ASI (automatic semicolon insertion).
      def self.minify_js(src)
        out = src.dup
        out = out.gsub(%r{/\*.*?\*/}m, '')          # /* ... */
        # bỏ comment dòng // nhưng chừa http:// và chuỗi — cách bảo thủ:
        out = out.gsub(%r{^\s*//.*$}, '')           # dòng chỉ có comment
        out = out.gsub(/[ \t]+$/, '')               # khoảng trắng cuối dòng
        out = out.gsub(/\n{3,}/, "\n\n")            # gộp dòng trống thừa
        out.strip
      end

      def self.minify_css(src)
        src.gsub(%r{/\*.*?\*/}m, '')                # bỏ comment
           .gsub(/\s*\n\s*/, "\n")
           .gsub(/[ \t]{2,}/, ' ')
           .strip
      end

      # ── Ghi dialog_assets.rb (base64) ──
      def self.assets_rb_path
        File.join(SRC_DIR, 'dialog_assets.rb')
      end

      def self.write_assets_rb(html)
        b64 = Base64.strict_encode64(html)
        lines = b64.scan(/.{1,120}/).join("\\\n")
        rb = <<~RUBY
          # frozen_string_literal: false
          # ── dialog_assets.rb — TỰ SINH bởi release_builder.rb. KHÔNG sửa tay. ──
          # Chứa dialog.html + css + js (đã gộp) dạng base64. Dùng với dlg.set_html.
          require 'base64'
          module N2G
            module ExportGcode
              module DialogAssets
                HTML_B64 = "\\
          #{lines}".freeze
                def self.html
                  Base64.decode64(HTML_B64).force_encoding('UTF-8')
                end
              end
            end
          end
        RUBY
        File.write(assets_rb_path, rb)
      end

      # ── Copy plugin sang RELEASE/<version>, loại file dev ──
      def self.copy_release(dest_base, ver)
        FileUtils.mkdir_p(dest_base)
        # Thư mục plugin con (cùng tên 'n2g')
        dest_plugin = File.join(dest_base, File.basename(PLUGIN_ROOT))
        FileUtils.rm_rf(dest_plugin)
        FileUtils.mkdir_p(dest_plugin)

        count = 0
        Dir.glob(File.join(PLUGIN_ROOT, '**', '*'), File::FNM_DOTMATCH).each do |path|
          rel = path.sub(PLUGIN_ROOT + '/', '')
          next if rel == '.' || rel.empty?
          parts = rel.split('/')
          next if (parts & EXCLUDE_DIRS).any?                       # node_modules, .git — mọi nơi
          next if EXCLUDE_DIR_PATHS.any? { |d| rel == d || rel.start_with?(d + '/') }  # js/ css/ của export_gcode
          if File.directory?(path)
            FileUtils.mkdir_p(File.join(dest_plugin, rel))
            next
          end
          next if EXCLUDE_NAMES.include?(File.basename(path))   # bỏ file dev (theo tên)
          next if EXCLUDE_PATHS.include?(rel)                   # bỏ đúng file đó (theo đường dẫn)
          next if EXCLUDE_PATTERNS.any? { |re| File.basename(path) =~ re }  # bỏ file rác/backup
          next if File.extname(path).downcase == '.rbe'         # bỏ file ĐÃ mã hoá
                                                                # (trang ký chỉ nhận .rb thuần)
          FileUtils.mkdir_p(File.join(dest_plugin, File.dirname(rel)))
          FileUtils.cp(path, File.join(dest_plugin, rel))
          count += 1
        end

        # Sinh n2g.rb SẠCH (không MODE_DEV, version từ json) ở gốc release
        write_outer_rb(File.join(dest_base, "#{File.basename(PLUGIN_ROOT)}.rb"), ver)
        count += 1
        count
      end

      # Ghi file n2g.rb ngoài — bỏ MODE_DEV, đặt version = ver
      def self.write_outer_rb(path, ver)
        rb = <<~RUBY
          require 'sketchup.rb'
          require 'extensions.rb'

          module N2G
            unless file_loaded?(__FILE__)
              loader_path = File.join('n2g', 'loader.rbe')

              ext = SketchupExtension.new('N2G', loader_path)

              ext.description = 'Công cụ chuyển đổi Nesting ABF sang G-code cho máy CNC.'
              ext.version     = '#{ver}'
              ext.creator     = 'Tạ Văn Chinh'

              Sketchup.register_extension(ext, true)

              file_loaded(__FILE__)
            end
          end
        RUBY
        File.write(path, rb)
      end

    end
  end
end
