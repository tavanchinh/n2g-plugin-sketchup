# ==============================================================================
# N2G / modules / export_gcode / post_processor.rb
# Render post-processor template + ghi file G-code ra disk
# Phụ thuộc: GcodeEngine (write_drill, write_pocket, write_profile, helpers)
# ==============================================================================

module N2G
  module ExportGcode
    module PostProcessor

      # Tách chuỗi nhiều lệnh (ngăn bởi dấu phẩy hoặc "/n") thành nhiều dòng.
      # Ví dụ: "M35,M70,M24" hoặc "M35/nM70/nM24" → "M35\nM70\nM24"
      # Người dùng low-tech: gõ liền, dùng , hoặc /n để xuống dòng.
      # ── Tính các MỨC Z cho nhiều lượt xuống dao ────────────────────────────
      # Trả về mảng Z (âm, tăng dần độ sâu, phần tử CUỐI = z_bottom = độ sâu thật).
      # z_bottom: Z đáy tuyệt đối (đã giải z + zzero). D_abs: tổng độ sâu cắt (dương).
      #
      # Ưu tiên:
      #   1) z_passes THỦ CÔNG (chỉ khi depth SỐ, mode 'mm') → dùng đúng mảng đó.
      #   2) TỰ ĐỘNG theo max_depth: n = ceil(D/max_depth), chia đều.
      #   3) Còn lại → 1 lượt (mảng 1 phần tử = z_bottom) → hành vi CŨ y hệt.
      #
      # z_top_ref: Z tại MẶT VÁN (nơi bắt đầu ăn dao). Mỗi lượt = z_top_ref lùi dần
      # tới z_bottom. Với zzero='table', mặt ván = z_bottom + D_abs; ngược lại = 0.
      def self.compute_z_levels(cfg, z_bottom, d_abs, z_top_ref, allow_multipass)
        # Áp cho dao Cắt (profile) và Khoan (peck). Khác → 1 lượt.
        return [z_bottom] unless allow_multipass
        return [z_bottom] if d_abs.nil? || d_abs <= 0.0001

        # ── LOGIC MỚI: A (finish_thickness) + B (num_passes) ──────────────────────
        # C = d_abs (độ sâu cắt). Mốc độ sâu DƯƠNG tăng dần = pass_depths(C,A,B), rồi
        # chuyển sang mức Z (z_top_ref - depth). Lượt cuối ép = z_bottom (đáy thật).
        b = cfg[:num_passes].to_i
        if b >= 2
          a = cfg[:finish_thickness].to_f.abs
          depths = pass_depths(d_abs, a, b)   # mảng B mốc dương tăng dần, cuối = d_abs
          levels = depths.map { |v| (z_top_ref - v).round(3) }
          levels[-1] = z_bottom
          return levels
        end
        # B<=1 → 1 lượt (cắt/khoan 1 phát)
        return [z_bottom] if b == 1

        # ── LOGIC CŨ (giữ tương thích khi chưa có num_passes) ────────────────────
        # 1) Thủ công (mm) — chỉ khi depth là số (không chứa Z)
        raw_depth = cfg[:depth_raw].to_s
        depth_is_z = raw_depth.match?(/[Zz]/)
        zp   = cfg[:z_passes]
        zpm  = cfg[:z_passes_mode].to_s
        if !depth_is_z && zp.is_a?(Array) && zp.size > 1 && zpm == 'mm'
          levels = zp.map { |v| (z_top_ref - v.to_f.abs).round(3) }
          levels[-1] = z_bottom
          return levels
        end

        # 2) Tự động theo max_depth
        max_d = cfg[:max_depth].to_f.abs
        if max_d > 0 && d_abs > max_d + 0.0001
          n = (d_abs / max_d).ceil
          n = 1 if n < 1
          step = d_abs / n.to_f
          levels = (1..n).map { |i| (z_top_ref - step * i).round(3) }
          levels[-1] = z_bottom
          return levels
        end

        # 3) Một lượt (như cũ)
        [z_bottom]
      end

      # Tính mốc độ sâu các lần xuống dao (port từ computePassDepthsJS).
      # C: độ sâu cắt. A: độ dày lớp cắt cuối. B: số lần xuống dao.
      # B=1→[C]. A<=0 hoặc A>=C→chia đều C thành B bước. Else→(C-A)*k/(B-1) cho
      # k=1..B-1 rồi cuối=C. Trả mảng B mốc DƯƠNG tăng dần, cuối = C.
      def self.pass_depths(c, a, b)
        c = c.to_f.abs
        a = a.to_f.abs
        b = [1, b.to_i].max
        a = c if a > c
        return [c.round(3)] if b <= 1
        out = []
        if a <= 0 || (c - a) < 0.001
          (1..b).each { |k| out << (c * k / b.to_f).round(3) }
        else
          (1...b).each { |k| out << ((c - a) * k / (b - 1).to_f).round(3) }
          out << c.round(3)
        end
        out
      end

      def self.expand_multi_cmd(str)
        return str.to_s if str.nil?
        s = str.to_s
        # Chuẩn hóa các kiểu ngăn cách về newline: "/n", "\n" literal, dấu phẩy, chấm phẩy
        s = s.gsub(/\/n/i, "\n").gsub(/\\n/, "\n").gsub(/[,;]/, "\n")
        s.split("\n").map(&:strip).reject(&:empty?).join("\n")
      end

      def self.render(template, vars)
        result = template.dup
        vars.each { |key, val| result.gsub!("{#{key}}", val.to_s) }
        # Xóa dòng chỉ chứa khoảng trắng (do biến rỗng như {clamp} = '')
        result.split("\n").reject { |l| l.strip.empty? }.join("\n")
      end

      # Lọc ký tự KHÔNG hợp lệ cho tên thư mục/file trên Windows (và các HĐH khác):
      #   \ / : * ? " < > |  và ký tự điều khiển (0x00-0x1f) → thay bằng '_'.
      # Windows cũng không cho tên kết thúc bằng '.' hoặc khoảng trắng.
      def self.sanitize_path_component(str)
        s = str.to_s
        s = s.gsub(/[\x00-\x1f\\\/:*?"<>|]/, '_')   # ký tự cấm + điều khiển
        s = s.gsub(/[.\s]+\z/, '')                   # bỏ '.' / space ở cuối
        s = s.gsub(/\A\s+/, '')                      # bỏ space ở đầu
        s = s.gsub(/_+/, '_').gsub(/\A_+|_+\z/, '')  # gọn dấu '_'
        s
      end

      # Pocket XY được sinh duy nhất ở JS/Clipper để G-code khớp đúng preview.
      # Kiểm tra toàn bộ dữ liệu trước khi tạo thư mục/file, tránh xuất file dở dang
      # hoặc âm thầm quay về thuật toán Pocket Ruby khác.
      def self.tool_jobs_for_layer(tool_library, app_settings, layer)
        jobs = app_settings[:tool_jobs]
        jobs = tool_library.values unless jobs.is_a?(Array) && !jobs.empty?
        norm = GcodeEngine.normalize_layer(layer)
        jobs.select { |cfg| GcodeEngine.normalize_layer(cfg[:layer]) == norm }
      end

      def self.validate_pocket_paths!(all_sheets, tool_library, app_settings)
        pocket_paths = app_settings[:pocket_paths]
        all_sheets.each do |sheet|
          sheet[:vectors].group_by { |v| v[:layer] }.each_key do |layer|
            cfg = tool_jobs_for_layer(tool_library, app_settings, layer)
                    .find { |job| job[:type].to_s == 'pocket' }
            next unless cfg

            key = "#{sheet[:name]}::#{layer}"
            paths = pocket_paths.is_a?(Hash) ? (pocket_paths[key] || pocket_paths[key.to_s]) : nil
            runs = paths.is_a?(Array) ? paths.flat_map { |p| p.is_a?(Hash) ? (p['runs'] || p[:runs] || []) : [] } : []
            valid_run = lambda do |run|
              run.is_a?(Array) && run.size >= 2 && run.all? do |point|
                next false unless point.is_a?(Hash)
                x = point.key?('x') ? point['x'] : point[:x]
                y = point.key?('y') ? point['y'] : point[:y]
                begin
                  !x.nil? && !y.nil? && Float(x).finite? && Float(y).finite?
                rescue ArgumentError, TypeError
                  false
                end
              end
            end
            # Empty run is an intentional Safe-Z separator inserted by JS.
            valid = runs.any? { |run| valid_run.call(run) } &&
                    runs.all? { |run| (run.is_a?(Array) && run.empty?) || valid_run.call(run) }
            next if valid

            # Khóa tồn tại + mảng rỗng: JS/Clipper đã xử lý nhưng offset
            # không còn đường tâm dao, thường do vùng nhỏ/hẹp hơn dao.
            # Dữ liệu thiếu hoặc sai định dạng vẫn là lỗi bắt buộc dừng.
            key_found = pocket_paths.is_a?(Hash) &&
                        (pocket_paths.key?(key) || pocket_paths.key?(key.to_s))
            computed_empty = paths.is_a?(Array) && paths.all? do |path|
              next false unless path.is_a?(Hash)
              path_runs = path['runs'] || path[:runs]
              path_runs.is_a?(Array) && path_runs.all? { |run| run.is_a?(Array) && run.empty? }
            end
            if key_found && computed_empty
              next
            end

            raise "Không có đường chạy Pocket hợp lệ từ JS/Clipper cho sheet '#{sheet[:name]}', layer '#{layer}'. Hãy mở lại giao diện và kiểm tra preview trước khi xuất."
          end
        end

        true
      end

      def self.validate_profile_paths!(all_sheets, tool_library, app_settings)
        return unless app_settings[:profile_engine].to_s == 'clipper'
        profile_paths = app_settings[:profile_paths]
        all_sheets.each do |sheet|
          sheet[:vectors].group_by { |v| v[:layer] }.each_key do |layer|
            cfg = tool_jobs_for_layer(tool_library, app_settings, layer)
                    .find { |job| job[:type].to_s == 'profile' }
            next unless cfg
            layer_norm = layer.to_s.upcase.gsub(/[^A-Z0-9]/, '')
            next if layer_norm == 'ABFMARKSQUARE'
            next if cfg[:bit_type].to_s == 'vbit' && cfg[:strategy].to_s == 'cut_in'
            key = "#{sheet[:name]}::#{layer}"
            records = profile_paths.is_a?(Hash) ? (profile_paths[key] || profile_paths[key.to_s]) : nil
            unless records.is_a?(Array) && !records.empty?
              # Circle, open path and cut_on use existing Profile branches and
              # never consume a JS/Clipper offset. Require serialized JS data
              # only for closed non-circle cut_in/cut_out loops.
              strategy = cfg[:strategy].to_s
              layer_edges = sheet[:vectors].select { |v| v[:layer].to_s == layer.to_s }
              needs_js = (strategy == 'cut_in' || strategy == 'cut_out') &&
                         GcodeEngine.build_loops(layer_edges).any? { |lp|
                           lp[:closed] && !GcodeEngine.profile_circle_like_js?(lp[:edges])
                         }
              next unless needs_js
              raise "Không có dữ liệu Profile từ JS/Clipper cho sheet '#{sheet[:name]}', layer '#{layer}'."
            end
            bad = records.any? do |rec|
              mode = (rec['mode'] || rec[:mode]).to_s
              runs = rec['runs'] || rec[:runs]
              (mode == 'clipper' || mode == 'js_offset') &&
                (!runs.is_a?(Array) || runs.empty?)
            end
            raise "JS không tạo được offset Profile hợp lệ cho sheet '#{sheet[:name]}', layer '#{layer}'." if bad
          end
        end
      end

      def self.generate(all_sheets, tool_library, post, app_settings={}, preselected_folder=nil)
        return nil unless validate_pocket_paths!(all_sheets, tool_library, app_settings)
        validate_profile_paths!(all_sheets, tool_library, app_settings)

        # Nếu folder đã được chọn TRƯỚC (từ dialogs.rb, để hộp thoại mở ngay không
        # phải chờ scan) → dùng luôn. Nếu chưa → hỏi ở đây (tương thích lối gọi cũ).
        folder = preselected_folder || UI.select_directory(title: "Chọn thư mục lưu G-code")
        return unless folder

        # Tạo thư mục gốc mới: tên file SketchUp (bỏ dấu tiếng Việt) + _giờ_phút_giây.
        model = Sketchup.active_model
        raw_title = model.title.to_s.strip
        raw_title = "N2G" if raw_title.empty?   # file chưa đặt tên
        # Bọc an toàn: trên bản .rbe, remove_vi_accent có thể lỗi encoding.
        # Nếu lỗi, fallback bỏ mọi ký tự non-ASCII để vẫn tạo được thư mục.
        begin
          clean_title = GcodeEngine.remove_vi_accent(raw_title).to_s.strip
        rescue => _e
          clean_title = raw_title.encode("ASCII", invalid: :replace, undef: :replace, replace: "").strip rescue ""
        end
        clean_title = clean_title.gsub(/[\\\/:*?"<>|]/, '_').gsub(/\s+/, '_')  # bỏ ký tự cấm + khoảng trắng
        clean_title = clean_title.gsub(/_+/, '_').gsub(/^_+|_+$/, '')
        clean_title = "N2G" if clean_title.empty?
        time_str = Time.now.strftime("%H_%M_%S")
        root_name = "#{clean_title}_#{time_str}"
        folder = File.join(folder, root_name)
        FileUtils.mkdir_p(folder)

        clear_z       = post["clear_z"].to_f
        safe_z        = post["safe_z"].to_f
        ext           = post["ext"] || ".nc"
        comment_style = post["comment"] || "off"
        date_str      = Time.now.strftime("%Y-%m-%d %H:%M")

        sheet_indices = GcodeEngine.compute_sheet_indices(all_sheets)

        # Pre-compute: tìm các sheet có bản "bottom" đi kèm
        # "X-bottom" và "X" là 1 cặp 2 mặt
        all_names = all_sheets.map { |s| s[:name].downcase }
        has_bottom_pair = lambda do |name|
          base = name.downcase.sub(/-bottom$/i, '')
          name.downcase.end_with?('-bottom') ?
            all_names.include?(base) :           # đây là bottom → check có base không
            all_names.include?(name.downcase + '-bottom')  # đây là top → check có bottom không
        end

        # Nesting (ABF) đôi khi chỉ gắn tên vật liệu đầy đủ vào sheet đầu của mỗi loại,
        # các sheet sau cùng vật liệu có thể thiếu. Cho kế thừa NHƯNG chỉ theo CÙNG MÀU
        # để không gán nhầm độ dày giữa các vật liệu khác nhau (vd TRẮNG không mượn
        # độ dày 17.5mm của PLYWOOD). Lưu độ dày gần nhất theo từng màu.
        thickness_by_color = {}
        all_sheets.each do |s|
          pp = GcodeEngine.parse_sheet_name(s[:name])
          c = pp[:color].to_s.strip
          t = pp[:thickness].to_s.strip
          thickness_by_color[c] = t if !c.empty? && !t.empty? && thickness_by_color[c].to_s.empty?
        end

        all_sheets.each_with_index do |sheet, sheet_idx|
          sheet_num = sheet_indices[sheet_idx]
          parsed    = GcodeEngine.parse_sheet_name(sheet[:name])
          raw_color = parsed[:color]
          thickness = parsed[:thickness]

          # Kế thừa độ dày theo CÙNG MÀU nếu sheet này thiếu
          if thickness.to_s.strip.empty? && !raw_color.to_s.strip.empty?
            thickness = thickness_by_color[raw_color.to_s.strip].to_s
          end

          color_dir = app_settings[:remove_accent] != false ?
            GcodeEngine.remove_vi_accent(raw_color).strip.gsub(/\s+/, '_') :
            raw_color.strip.gsub(/\s+/, '_')
          color_dir = color_dir.gsub(/^_+/, '').gsub(/_+$/, '')  # bỏ dấu _ thừa (tiền tố __ của ABF)
          color_dir = sanitize_path_component(color_dir)         # lọc ký tự cấm (*, ?, :, …)

          # Tạo thư mục con nếu cần
          sub_folder = folder
          if app_settings[:folder_color] || app_settings[:folder_thickness]
            dir_parts = []
            dir_parts << color_dir if app_settings[:folder_color] && !color_dir.empty?
            dir_parts << sanitize_path_component(thickness) if app_settings[:folder_thickness] && !thickness.empty?
            unless dir_parts.empty?
              sub_folder = File.join(folder, dir_parts.join('_'))
              FileUtils.mkdir_p(sub_folder)
            end
          end

          file_name = app_settings[:custom_name] ?
            GcodeEngine.format_sheet_name(sheet[:name], sheet_num - 1, app_settings) :
            sheet[:name]
          file_name = sanitize_path_component(file_name)   # lọc ký tự cấm trong tên file
          file_name = "sheet_#{sheet_num}" if file_name.to_s.strip.empty?  # fallback nếu rỗng
          file_path = File.join(sub_folder, "#{file_name}#{ext}")

          # Detect clamp/unclamp dựa theo ABF sheet naming:
          # - "X-bottom" tồn tại cùng "X" → 2 mặt
          #   "X-bottom" (cắt trước): clamp=có, unclamp=không
          #   "X"        (cắt sau) : clamp=không, unclamp=có
          # - Chỉ có "X" (không có "X-bottom") → 1 mặt: clamp=có, unclamp=có
          clamp_cmd   = post["cool_on"].to_s.strip
          unclamp_cmd = post["cool_off"].to_s.strip
          is_bottom   = sheet[:name].downcase.end_with?('-bottom')
          is_paired   = has_bottom_pair.call(sheet[:name])

          if is_paired
            if is_bottom
              # Cắt trước (bottom): gắp phôi, không đẩy
              clamp_val   = clamp_cmd
              unclamp_val = ''
            else
              # Cắt sau (top): không gắp, đẩy phôi
              clamp_val   = ''
              unclamp_val = unclamp_cmd
            end
          else
            # 1 mặt: có đủ clamp và unclamp
            clamp_val   = clamp_cmd
            unclamp_val = unclamp_cmd
          end

          File.open(file_path, "w") do |f|
            all_tool_jobs = app_settings[:tool_jobs]
            all_tool_jobs = tool_library.values unless all_tool_jobs.is_a?(Array) && !all_tool_jobs.empty?
            grouped_lines = sheet[:vectors].group_by { |v| GcodeEngine.normalize_layer(v[:layer]) }
            work_items = all_tool_jobs.map do |job|
              layer_key = GcodeEngine.normalize_layer(job[:layer])
              lines = grouped_lines[layer_key]
              lines && !lines.empty? ? [layer_key, job, lines] : nil
            end.compact
            last_tool_number = nil
            last_spindle_off = nil

            first_cfg = work_items.empty? ? {} : work_items.first[1]

            # Biến của dao đầu tiên cho header (tool_notes, tool_call, spindle riêng)
            first_tnum  = (first_cfg[:tool_number] || 1)
            first_tcall = (first_cfg[:tool_call].to_s.strip.empty? ? (first_tnum.to_i * 100) : first_cfg[:tool_call])
            first_son   = expand_multi_cmd(first_cfg[:spindle_on].to_s.strip.empty?  ? (post["spindle_on"]  || "M03") : first_cfg[:spindle_on])
            first_notes = expand_multi_cmd(first_cfg[:tool_notes].to_s)

            f.puts render(post["header"] || '',
              "sheet_name"  => sheet[:name].to_s,
              "date"        => date_str,
              "width"       => sheet[:width].round(2),
              "height"      => sheet[:height].round(2),
              "unit"        => post["unit"] || "G21",
              "safe_z"      => safe_z,
              "tool_number" => first_tnum.to_s,
              "tool_call"   => first_tcall.to_s,
              "tool_notes"  => first_notes,
              "tool_name"   => (first_cfg[:name] || '').to_s,
              "diameter"    => (first_cfg[:diameter] || 6).to_s,
              "rpm"         => (first_cfg[:rpm] || 18000).to_s,
              "spindle_on"  => first_son,
              "spindle_off" => post["spindle_off"] || "M05",
              "depth"       => (first_cfg[:depth].to_s.to_f.round(3)).to_s,
              "clamp"       => clamp_val
            )

            work_items.each_with_index do |(layer, cfg, lines), tool_idx|

              # Tính depth thực tế
              zzero       = app_settings[:zzero] || 'top'
              workarea    = app_settings[:workarea] || {}
              # Độ dày lấy từ ĐÚNG field thickness của tên sheet (qua parse_sheet_name),
              # KHÔNG bắt "Xmm" đầu tiên trong tên — tránh nhầm khi mã vật liệu có chữ MM
              # (vd "025MM-9mm-sheet-1": phải là 9mm, không phải 25mm).
              _parsed     = GcodeEngine.parse_sheet_name(sheet[:name].to_s)
              _thk_field  = _parsed[:thickness].to_s.strip
              nominal_key = _thk_field.empty? ? nil : _thk_field
              wa          = (nominal_key && (workarea[nominal_key] || workarea[nominal_key.to_s])) || {}
              # Độ dày: ưu tiên workarea → tên sheet → người dùng nhập tay theo màu → 17mm
              manual_thk  = app_settings[:manual_thickness] || {}
              sheet_color = _parsed[:color].to_s.strip.gsub(/^_+/, '').gsub(/_+$/, '')
              manual_val  = manual_thk[sheet_color] || manual_thk[sheet_color.to_s]
              actual_thk  = (wa["actual_thickness"] || wa[:actual_thickness] ||
                             (nominal_key ? nominal_key.to_f :
                              (manual_val ? manual_val.to_f : 17.0))).to_f

              raw_depth  = cfg[:depth].to_s.strip
              base_depth = if raw_depth.match?(/^[Zz][+-]/)
                # "Z-1", "Z+0.1" → độ dày ván ± offset
                -(actual_thk + raw_depth[1..].to_f)
              elsif raw_depth.match?(/^[Zz]$/)
                # "Z" đơn thuần → đúng bằng độ dày ván (trước đây "Z".to_f=0 → sai, d_abs=0)
                -actual_thk
              else
                -raw_depth.to_f.abs
              end

              effective_cfg = cfg.dup
              effective_cfg[:comment_style] = app_settings[:comment_style] || 'off'
              dc_offset = (app_settings[:double_cut_offset] || 2.5).to_f
              partial_base = base_depth + dc_offset  # vd: -17.1 + 3 = -14.1
              effective_cfg[:depth] = (zzero == 'table') ?
                (actual_thk + base_depth).round(3) : base_depth.round(3)
              effective_cfg[:partial_z] = (zzero == 'table') ?
                (actual_thk + partial_base).round(3) : partial_base.round(3)
              # Độ sâu cắt thực của V-Bit (luôn dương) = |base_depth|, dùng để tính Z mặt ván
              effective_cfg[:vbit_depth] = base_depth.abs.round(3)

              # ── NHIỀU LƯỢT XUỐNG DAO (chỉ dao Cắt) ────────────────────────
              # z_bottom = effective_cfg[:depth] (đáy tuyệt đối). D_abs = |base_depth|.
              # z_top_ref = Z mặt ván (nơi bắt đầu ăn): table → đáy + D; ngược lại → 0.
              z_bottom_val = effective_cfg[:depth].to_f
              d_abs_val    = base_depth.abs.round(3)
              z_top_ref    = (zzero == 'table') ? (z_bottom_val + d_abs_val).round(3) : 0.0
              effective_cfg[:z_top] = z_top_ref   # Z mặt ván — dùng cho ramp entry
              # Multipass (A,B) áp cho: profile (cut_out/cut_in/cut_on) VÀ drill (peck).
              # Pocket: TẠM để 1 lượt (write_pocket chưa lặp z_levels — làm bước riêng).
              # Loại trừ: V-Bit cut_in. ABF_MARKSQUARE dùng hàm riêng nhưng đã hỗ trợ multipass.
              _t = effective_cfg[:type]
              _layer_norm = effective_cfg[:layer].to_s.upcase.gsub(/[^A-Z0-9]/, '')
              _is_vbit_cutin = (effective_cfg[:bit_type].to_s == 'vbit' && effective_cfg[:strategy] == :cut_in)
              is_profile   = (_t != :drill && _t != :pocket && !_is_vbit_cutin)
              allow_multipass = is_profile || (_t == :drill)
              effective_cfg[:depth_raw] = cfg[:depth]  # chuỗi gốc để biết có chứa Z không
              effective_cfg[:z_levels]  = compute_z_levels(
                effective_cfg, z_bottom_val, d_abs_val, z_top_ref, allow_multipass
              )

              tool_number = effective_cfg[:tool_number] || (tool_idx + 1)
              cool_on     = post["cool_on"].to_s.strip
              # tool_call = số gọi dao cho máy đặc biệt (vd dao 23 → T2300). Mặc định = tool_number×100.
              tool_call_number = (effective_cfg[:tool_call].to_s.strip.empty? ? (tool_number.to_i * 100) : effective_cfg[:tool_call])
              tool_change = post["toolchange"].to_s.strip
                              .gsub("{tool}", tool_number.to_s)
                              .gsub("{tool_number}", tool_number.to_s)
                              .gsub("{tool_call}", tool_call_number.to_s)
                              .gsub("{tool_notes}", expand_multi_cmd(effective_cfg[:tool_notes].to_s))

              # Lệnh spindle: ưu tiên của từng dao (phương án A), fallback mặc định post
              # Cho phép nhiều lệnh ngăn bởi dấu phẩy hoặc "/n" → tách thành nhiều dòng G-code
              tool_spindle_on  = expand_multi_cmd(effective_cfg[:spindle_on].to_s.strip.empty?  ? (post["spindle_on"]  || "M03") : effective_cfg[:spindle_on])
              # Lệnh tắt mô tơ của CHÍNH dao này (lưu cho vòng sau + footer)
              this_spindle_off = expand_multi_cmd(effective_cfg[:spindle_off].to_s.strip.empty? ? (post["spindle_off"] || "M05") : effective_cfg[:spindle_off])
              # {spindle_off} ở ĐẦU tool-change = tắt mô tơ của DAO TRƯỚC (đang chạy).
              # Dao đầu tiên (last_spindle_off=nil) → để trống, không tắt gì.
              prev_spindle_off = last_spindle_off.to_s
              # Lệnh/ghi chú riêng của dao → tách nhiều dòng (giống spindle)
              tool_notes_expanded = expand_multi_cmd(effective_cfg[:tool_notes].to_s)

              if tool_number != last_tool_number && tool_idx > 0
                f.puts render(post["toolchange"] || post["toolcall"] || '',
                  "layer_name"  => layer,
                  "tool_name"   => effective_cfg[:name],
                  "tool_number" => tool_number,
                  "tool_call"   => tool_call_number,
                  "tool_notes"  => tool_notes_expanded,
                  "diameter"    => effective_cfg[:diameter],
                  "depth"       => effective_cfg[:depth],
                  "rpm"         => effective_cfg[:rpm] || 18000,
                  "spindle_on"  => tool_spindle_on,
                  "spindle_off" => prev_spindle_off,
                  "coolant_on"  => cool_on,
                  "safe_z"      => safe_z,
                  "tool_change" => tool_change)
              else
                layer_comment = render(post["toolchange"] || post["toolcall"] || '',
                  "layer_name"  => layer,
                  "tool_name"   => effective_cfg[:name],
                  "tool_number" => tool_number,
                  "tool_call"   => tool_call_number,
                  "tool_notes"  => tool_notes_expanded,
                  "diameter"    => effective_cfg[:diameter],
                  "depth"       => effective_cfg[:depth],
                  "rpm"         => effective_cfg[:rpm] || 18000,
                  "spindle_on"  => tool_spindle_on,
                  "spindle_off" => prev_spindle_off,
                  "coolant_on"  => cool_on,
                  "safe_z"      => safe_z,
                  "tool_change" => tool_change)
                layer_comment.each_line { |line| f.puts line if line.strip.start_with?("(") }
              end
              last_tool_number = tool_number
              # Lưu lệnh tắt spindle của dao này → dùng cho {spindle_off} của dao KẾ + footer
              last_spindle_off = this_spindle_off

              if layer.to_s.upcase.gsub(/[^A-Z0-9]/, '') == 'ABFPHAY14'
                puts "N2G DEBUG ABF_PHAY_14: type=#{effective_cfg[:type].inspect} " \
                     "strategy=#{effective_cfg[:strategy].inspect} " \
                     "bit_type=#{effective_cfg[:bit_type].inspect} " \
                     "diameter=#{effective_cfg[:diameter].inspect} " \
                     "vectors=#{lines.size}"
              end

              case effective_cfg[:type]
              when :drill  then GcodeEngine.write_drill(f, lines, effective_cfg, clear_z)
              when :pocket
                pocket_key = "#{sheet[:name]}::#{layer}"
                pocket_paths = app_settings[:pocket_paths]
                precomputed = pocket_paths[pocket_key] || pocket_paths[pocket_key.to_s]
                GcodeEngine.write_pocket_runs(f, precomputed, effective_cfg, clear_z)
              else
                layer_norm = effective_cfg[:layer].to_s.upcase.gsub(/[^A-Z0-9]/, '')
                if layer_norm == 'ABFMARKSQUARE'
                  # Layer vạch dấu chữ L: kịch bản riêng (offset từng cạnh ra ngoài viền)
                  GcodeEngine.write_mark_square(f, lines, effective_cfg, clear_z)
                elsif effective_cfg[:bit_type].to_s == 'vbit' && effective_cfg[:strategy] == :cut_in
                  # V-Bit cut_in dùng hàm riêng (vát góc)
                  GcodeEngine.write_vbit_profile(f, lines, effective_cfg, clear_z, sheet[:width], sheet[:height], app_settings.merge(sheet_name: sheet[:name]))
                else
                  GcodeEngine.write_profile(f, lines, effective_cfg, clear_z, sheet[:width], sheet[:height],
                                            app_settings.merge(sheet_name: sheet[:name], layer_name: layer))
                end
              end

            end

            f.puts render(post["footer"],
              "spindle_off" => (defined?(last_spindle_off) && last_spindle_off ? last_spindle_off : (post["spindle_off"] || "M05")),
              "coolant_off" => unclamp_cmd,
              "safe_z"      => safe_z,
              "unclamp"     => unclamp_val)
          end
        end

        # Trả về thư mục gốc để dialog hiển thị thông báo kèm nút "Mở thư mục"
        folder
      end

    end # module PostProcessor
  end # module ExportGcode
end # module N2G
