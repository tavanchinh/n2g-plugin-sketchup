# ==============================================================================
# N2G / modules / export_gcode / dialogs.rb
# UI: HtmlDialog cho export G-code và quản lý dao cụ
# Phụ thuộc: Scanner, GcodeEngine, PostProcessor
# ==============================================================================

module N2G
  module ExportGcode
    module Dialogs

      unless defined?(DIALOG_PREFS_JSON)
        DIALOG_PREFS_JSON = File.join(N2G::Settings::SETTINGS_DIR, 'dialog_prefs.json').freeze
        # ── Override lưu TRONG FILE SKETCHUP (attribute dictionary của model) ──
        OVERRIDE_DICT = 'N2G_Overrides'.freeze
      end

      # Đọc override từ model → { "layer_overrides" => {...}, "entry_overrides" => {...} }
      def self.load_overrides_from_model(model)
        return {} if model.nil?
        dict = model.attribute_dictionary(OVERRIDE_DICT, false)
        return {} if dict.nil?
        out = {}
        ['layer_overrides', 'entry_overrides', 'cut_order'].each do |k|
          raw = dict[k]
          next if raw.nil? || raw.to_s.empty?
          begin
            out[k] = JSON.parse(raw.to_s)
          rescue => e
            puts "N2G: parse override '#{k}' failed: #{e.message}"
          end
        end
        out
      end

      # Ghi override vào model (tạo dictionary nếu chưa có)
      def self.save_overrides_to_model(model, data)
        return false if model.nil?
        model.set_attribute(OVERRIDE_DICT, 'layer_overrides', (data['layer_overrides'] || {}).to_json)
        model.set_attribute(OVERRIDE_DICT, 'entry_overrides', (data['entry_overrides'] || {}).to_json)
        model.set_attribute(OVERRIDE_DICT, 'cut_order',       (data['cut_order']       || {}).to_json)
        true
      rescue => e
        puts "N2G: save_overrides_to_model error: #{e.message}"
        false
      end

      def self.load_dialog_prefs
        return {} unless File.exist?(DIALOG_PREFS_JSON)
        JSON.parse(File.read(DIALOG_PREFS_JSON))
      rescue
        {}
      end

      def self.save_dialog_prefs(key, prefs)
        all      = load_dialog_prefs
        all[key] = prefs
        File.write(DIALOG_PREFS_JSON, JSON.pretty_generate(all))
      rescue => e
        puts "N2G save_dialog_prefs error: #{e.message}"
      end

      @@export_dlg   = nil
      @@settings_dlg = nil
      @@import_pending = nil

      # ── Settings Dialog ────────────────────────────────────────────────────

      def self.open_settings
        if @@settings_dlg && @@settings_dlg.visible?
          @@settings_dlg.bring_to_front
          return
        end

        html_path = File.join(SETTINGS_DIR, 'dialog.html')
        unless File.exist?(html_path)
          UI.messagebox("Không tìm thấy: #{html_path}")
          return
        end

        prefs = load_dialog_prefs['settings'] || {}
        dlg = UI::HtmlDialog.new(
          dialog_title: "N2G — Quản lý dao cụ",
          width:    prefs['width']  || 860,
          height:   prefs['height'] || 580,
          left:     prefs['left']   || 100,
          top:      prefs['top']    || 100,
          resizable: true
        )
        @@settings_dlg = dlg

        dlg.set_on_closed do
          # get_content_size trả nil khi cửa sổ đã đóng hẳn (tùy thời điểm hệ điều hành
          # hủy cửa sổ) → nil[0] gây NoMethodError. Chỉ lưu khi lấy được kích thước.
          begin
            sz = dlg.get_content_size
            if sz.is_a?(Array) && sz[0].to_i > 0 && sz[1].to_i > 0
              save_dialog_prefs('settings', {
                'width'  => sz[0],
                'height' => sz[1]
              })
            end
          rescue StandardError
            # Không lấy được kích thước lúc đóng → giữ nguyên kích thước đã lưu trước đó.
          end
          @@settings_dlg = nil
        end

        dlg.add_action_callback("tool_dialog_ready") do |_, screen_json|
          begin
            sc = JSON.parse(screen_json || '{}')
            sw = (sc['screen_w'] || 1920).to_i
            sh = (sc['screen_h'] || 1080).to_i
            saved = load_dialog_prefs['settings']
            if saved&.key?('width')
              w = saved['width'].to_i
              h = saved['height'].to_i
            else
              w = (sw * 0.9).to_i
              h = (sh * 0.9).to_i
            end
            dlg.set_size(w, h)
            dlg.set_position([((sw - w) / 2).to_i, 0].max, [((sh - h) / 2).to_i, 0].max)
          rescue => e
            puts "settings dialog resize error: #{e.message}"
          end
          tools        = N2G::Settings.load_tools
          groups_js    = N2G::Settings.tool_groups_for_js
          active_group = N2G::Settings.load_active_group_id
          tools_js = tools.map do |t|
            {
              "tool_number" => t["tool_number"] || t[:tool_number] || 1,
              "name"        => t["name"]        || t[:name]        || "",
              "diameter"    => t["diameter"]    || t[:diameter]    || 6,
              "bit_type"    => t["bit_type"]    || t[:bit_type]    || "flat",
              "vbit_angle"  => t["vbit_angle"]  || t[:vbit_angle]  || 120,
              "spindle_on"  => t["spindle_on"]  || t[:spindle_on]  || "",
              "spindle_off" => t["spindle_off"] || t[:spindle_off] || "",
              "tool_notes"  => t["tool_notes"]  || t[:tool_notes]  || "",
              "stepover"    => t["stepover"]    || t[:stepover]    || 90,
              "max_depth"   => (t["max_depth"] || t[:max_depth] || 20).to_f.abs,
              "rpm"         => t["rpm"]         || t[:rpm]         || 18000,
              "feed"        => t["feed"]        || t[:feed]        || 2000,
              "z_feed"      => t["z_feed"]      || t[:z_feed]      || 600
            }
          end
          dlg.execute_script("n2gToolsInit(#{tools_js.to_json}, #{groups_js.to_json}, #{active_group.to_json})")
        end

        dlg.add_action_callback("switch_group_callback") do |_, group_id|
          N2G::Settings.save_active_group_id(group_id)
        end

        # Chọn file .pp bằng hộp thoại native của SketchUp, đọc nội dung, trả về JS.
        # Chạy chắc chắn trong HtmlDialog (không phụ thuộc kéo-thả của trình duyệt).
        dlg.add_action_callback("pick_pp_file") do |_, _unused|
          begin
            path = UI.openpanel("Chọn file post (.pp)", "", "Post Files|*.pp;*.txt||")
            if path && File.exist?(path)
              content  = File.read(path, encoding: 'UTF-8') rescue File.read(path)
              fname    = File.basename(path)
              dlg.execute_script("ppFileLoaded(#{content.to_json}, #{fname.to_json})")
            end
          rescue => e
            dlg.execute_script("setStatus('err', #{("Lỗi đọc file: " + e.message).to_json})")
          end
        end

        dlg.add_action_callback("save_tools_callback") do |_, json|
          begin
            tools = JSON.parse(json)
            ok    = N2G::Settings.save_tools(tools)
            msg   = ok ? "Đã lưu #{tools.size} dao vào tools.json" : "Lỗi lưu file"
            dlg.execute_script("n2gSaveResult(#{ok}, #{msg.to_json})")
          rescue => e
            dlg.execute_script("n2gSaveResult(false, #{e.message.to_json})")
          end
        end

        dlg.add_action_callback("save_tool_groups_callback") do |_, json|
          begin
            groups = JSON.parse(json)
            ok     = N2G::Settings.save_tool_groups(groups)
            msg    = ok ? "Đã lưu nhóm dao" : "Lỗi lưu file"
            dlg.execute_script("n2gSaveResult(#{ok}, #{msg.to_json})")
          rescue => e
            dlg.execute_script("n2gSaveResult(false, #{e.message.to_json})")
          end
        end

        dlg.add_action_callback("reset_tools_callback") do
          N2G::Settings.save_tools(N2G_DEFAULT_TOOLS)
          dlg.execute_script("n2gToolsInit(#{N2G_DEFAULT_TOOLS.to_json}, #{N2G::Settings.tool_groups_for_js.to_json}, #{N2G::Settings.load_active_group_id.to_json})")
          dlg.execute_script("n2gSaveResult(true, 'Đã reset về mặc định')")
        end

        dlg.set_file(html_path)
        dlg.show
      end

      # ── Export Dialog ──────────────────────────────────────────────────────

      def self.close_export
        @@export_dlg&.close rescue nil
        @@export_dlg = nil
        ObjectSpace.each_object(UI::HtmlDialog) do |d|
          d.close rescue nil if (d.dialog_title rescue '') == "N2G — Xuất G-code"
        end
      end

      def self.open_export
        close_export if @@export_dlg

        if @@export_dlg && @@export_dlg.visible?
          @@export_dlg.bring_to_front
          return
        end

        model        = Sketchup.active_model
        tool_library = N2G::Settings.build_tool_library_from_map
        # KHÔNG scan ở đây — scan 107 sheet mất 3-5s sẽ chặn dialog mở.
        # Dời scan vào dialog_ready (sau khi dialog đã hiện + vẽ loading).
        # no_nesting biết được sau khi scan; tạm để nil, JS xử lý loading.

        # dialog.html chỉ CẦN khi KHÔNG có bản đóng gói (DialogAssets).
        # Bản release đã loại dialog.html và dùng set_html từ DialogAssets.
        html_path = File.join(EXPORT_DIR, 'dialog.html')
        has_assets = defined?(N2G::ExportGcode::DialogAssets)
        if !has_assets && !File.exist?(html_path)
          UI.messagebox("Không tìm thấy: #{html_path}")
          return
        end

        prefs = load_dialog_prefs['export'] || {}
        dlg = UI::HtmlDialog.new(
          dialog_title: "N2G — Xuất G-code",
          width:    prefs['width']  || 1300,
          height:   prefs['height'] || 920,
          left:     prefs['left']   || 50,
          top:      prefs['top']    || 50,
          resizable: true
        )
        @@export_dlg = dlg

        dlg.set_on_closed { @@export_dlg = nil }

        dlg.add_action_callback("save_window_size_callback") do |_, json|
          begin
            s = JSON.parse(json)
            save_dialog_prefs('export', { 'width' => s['width'], 'height' => s['height'] })
          rescue => e
            puts "save_window_size error: #{e.message}"
          end
        end

        dlg.add_action_callback("dialog_ready") do |_, screen_json|
          begin
            local_ver = N2G::Updater.local_version_name rescue '—'
            dlg.execute_script("n2gSetVersion('#{local_ver}')")
          rescue; end

          begin
            sc = JSON.parse(screen_json || '{}')
            sw = (sc['screen_w'] || 1920).to_i
            sh = (sc['screen_h'] || 1080).to_i
            saved = load_dialog_prefs['export']
            if saved&.key?('width')
              # Đã có kích thước user lưu → dùng lại, nhưng vẫn căn giữa để không khuất góc
              w = saved['width'].to_i
              h = saved['height'].to_i
            else
              # Lần đầu → 90% màn hình
              w = (sw * 0.9).to_i
              h = (sh * 0.9).to_i
            end
            dlg.set_size(w, h)
            dlg.set_position([((sw - w) / 2).to_i, 0].max, [((sh - h) / 2).to_i, 0].max)
          rescue => e
            puts "screen resize error: #{e.message}"
          end

          groups_js      = N2G::Settings.tool_groups_for_js
          all_tools_list = groups_js.flat_map { |g| g["tools"] || [] }
                             .map { |t| { "name" => t["name"] || "", "diameter" => t["diameter"] || 6 } }
                             .uniq { |t| t["name"] }

          saved_layer_map = N2G::Settings.load_layer_map
          tools_js = if saved_layer_map.any?
            saved_layer_map
          else
            tool_library.map do |layer, cfg|
              { layer: layer, name: cfg[:name], color: cfg[:color] || "#888888",
                diameter: cfg[:diameter], depth: cfg[:depth], type: cfg[:type].to_s,
                strategy: cfg[:strategy].to_s, stepover: cfg[:stepover],
                rpm: cfg[:rpm], feed: cfg[:feed], z_feed: cfg[:z_feed] }
            end
          end

          posts_js    = N2G::Settings.load_posts
          presets_js  = N2G::Settings.load_tool_presets
          active_post = N2G::Settings.load_active_post_id

          # ── BƯỚC 1: Init dialog NGAY (chưa có sheet) → JS vẽ loading ──
          # no_nesting=false tạm thời để JS hiện loading thay vì "không có nesting".
          dlg.execute_script(
            "n2gInit([], #{tools_js.to_json}, " \
            "#{posts_js.to_json}, #{active_post.to_json}, " \
            "[], #{all_tools_list.to_json}, #{groups_js.to_json}, false)"
          )
          # Báo JS đang scan (để hiện loading + số sheet nếu muốn)
          dlg.execute_script("if(typeof n2gScanStart==='function') n2gScanStart()")

          # Nạp phần nhẹ (không phụ thuộc scan) ngay
          active_preset_id = N2G::Settings.load_app_settings['active_tool_preset']
          dlg.execute_script("n2gLoadToolPresets(#{presets_js.to_json}, #{active_preset_id.to_json})")
          app_stg = N2G::Settings.load_app_settings
          dlg.execute_script("n2gLoadSettings(#{app_stg.to_json})")

          # ── BƯỚC 2: Hoãn 1 nhịp cho JS kịp render loading, RỒI mới scan ──
          # UI.start_timer(0.05) trả control về UI để dialog vẽ loading trước.
          UI.start_timer(0.05, false) do
            begin
              all_sheets = Scanner.scan_model(Sketchup.active_model, tool_library) || []
              no_nesting = all_sheets.empty?

              all_layers = all_sheets.flat_map { |s| s[:vectors].map { |v| v[:layer] } }
                                     .uniq.sort.reject { |l| l.nil? || l.empty? }

              # Đổ từng sheet (tránh buffer overflow máy yếu)
              all_sheets.each_with_index do |sheet, i|
                dlg.execute_script("n2gAddSheet(#{sheet.to_json}, #{i == all_sheets.size - 1})")
              end
              dlg.execute_script("n2gSetAllLayers(#{all_layers.to_json})")

              # Không có nesting → báo JS chuyển từ loading sang trạng thái rỗng
              dlg.execute_script("if(typeof n2gScanDone==='function') n2gScanDone(#{no_nesting.to_json})")

              # Override đã lưu trong file SketchUp
              begin
                ovs = load_overrides_from_model(Sketchup.active_model)
                dlg.execute_script("n2gLoadOverrides(#{ovs.to_json})")
              rescue => e
                puts "N2G: load_overrides error: #{e.message}"
              end

              # Nesting gap
              unless no_nesting
                begin
                  detected_gap = GcodeEngine.detect_nesting_gap(all_sheets)
                  dlg.execute_script("n2gSetDetectedGap(#{detected_gap.to_json})") if detected_gap
                rescue => e
                  puts "detect_nesting_gap error: #{e.message}"
                end
              end
            rescue => e
              puts "N2G scan (deferred) error: #{e.message}"
              dlg.execute_script("if(typeof n2gScanDone==='function') n2gScanDone(true)")
            end
          end
        end

        dlg.add_action_callback("save_settings_callback") do |_, json|
          begin
            incoming = JSON.parse(json)
            # Merge vào settings hiện có thay vì ghi đè toàn bộ.
            # Giữ nguyên active_tool_preset (do save_active_preset_callback quản lý riêng)
            # để không bị xóa/ghi đè khi lưu các settings khác.
            cur = N2G::Settings.load_app_settings
            incoming.delete('active_tool_preset')
            N2G::Settings.save_app_settings(cur.merge(incoming))
          rescue => e; puts "save_settings_callback error: #{e.message}"; end
        end

        dlg.add_action_callback("check_license_callback") do |_, _json|
          begin
            status = defined?(N2G::Licenses) ? N2G::Licenses.check : { ok: true, status: 'active' }
            if status[:ok]
              if status[:status] == 'trial' && status[:days_left].to_i <= 3
                dlg.execute_script("setStatus('warn','⚠ Còn #{status[:days_left]} ngày dùng thử — Mua bản quyền tại your-store.com')")
                sleep 0.5
              end
              dlg.execute_script("n2gLicenseOk()")
            else
              msg = status[:message] || 'Bản quyền không hợp lệ'
              dlg.execute_script("n2gLicenseFail(#{msg.to_json})")
              N2G::Licenses.show_activation_dialog(status) if defined?(N2G::Licenses)
            end
          rescue => e
            puts "check_license_callback error: #{e.message}"
            dlg.execute_script("n2gLicenseOk()")
          end
        end

        # Mở dialog nhập mã kích hoạt (chủ động từ tab Kích hoạt)
        dlg.add_action_callback("open_activation_callback") do |_, _json|
          begin
            if defined?(N2G::Licenses)
              status = N2G::Licenses.check
              # show_modal CHẶN cho tới khi dialog kích hoạt đóng lại.
              N2G::Licenses.show_activation_dialog(status)
              # Dialog kích hoạt vừa đóng → làm mới trạng thái trên dialog này,
              # để dòng "Còn N ngày" / "Bản quyền vĩnh viễn" cập nhật NGAY,
              # không phải đóng/mở lại dialog mới thấy.
              dlg.execute_script("if(typeof loadLicenseStatus==='function') loadLicenseStatus();")
            end
          rescue => e
            puts "open_activation_callback error: #{e.message}"
          end
        end

        # Lấy trạng thái license để hiển thị trong tab Kích hoạt
        # ── Xuất lại G-code TỪ LỊCH SỬ (hướng A) ──
        # Dùng hình học + bộ dao + post ĐÃ LƯU, độc lập model đang mở.
        dlg.add_action_callback("export_from_history_callback") do |_, id|
          begin
            rec = defined?(N2G::History) ? N2G::History.load_record(id.to_s) : nil
            if rec.nil?
              dlg.execute_script("n2gExportDone(false)")
              UI.messagebox("Không đọc được bản ghi lịch sử.")
              next
            end

            # 1) Sheets: chuyển key string → symbol (JSON lưu dạng string)
            sym = lambda do |o|
              case o
              when Array then o.map { |x| sym.call(x) }
              when Hash  then o.each_with_object({}) { |(k, v), h| h[k.to_sym] = sym.call(v) }
              else o
              end
            end
            hist_sheets = sym.call(rec["sheets"] || [])

            # 2) Tool library: key ngoài (layer normalized) giữ string, giá trị cfg cần symbol.
            #    tl lưu dạng { "ABF_D16" => { "type"=>..., ... } } → chuyển cfg sang symbol,
            #    và ép lại type/strategy về Symbol (generate cần :profile, :drill...).
            raw_tl = (rec["tool_group"] && rec["tool_group"]["tools"]) || {}
            tl = {}
            raw_tl.each do |layer_key, cfg|
              c = {}
              (cfg || {}).each { |k, v| c[k.to_sym] = v }
              c[:type]     = c[:type].to_sym     if c[:type]
              c[:strategy] = c[:strategy].to_sym if c[:strategy]
              tl[layer_key.to_s] = c
            end

            # 3) Post + app_settings: generate đọc post bằng string key (post["unit"]),
            #    app_settings bằng symbol. Chuyển app_settings sang symbol.
            hist_post = rec["post"] || {}
            hist_app  = sym.call(rec["app_settings"] || {})
            # JSON turns Symbol values into String values. Restore these two
            # fields so history re-export selects the same writer as fresh export.
            if hist_app[:tool_jobs].is_a?(Array)
              hist_app[:tool_jobs].each do |job|
                job[:type] = job[:type].to_sym if job[:type]
                job[:strategy] = job[:strategy].to_sym if job[:strategy]
              end
            end
            # cut_order từ lịch sử (string key theo tên sheet) — app_settings cần :cut_order
            hist_app[:cut_order] = rec["cut_order"] || {}

            out_folder = PostProcessor.generate(hist_sheets, tl, hist_post, hist_app)
            if out_folder
              dlg.execute_script("n2gExportDone(true, #{out_folder.to_json}, #{hist_sheets.size})")
            else
              dlg.execute_script("n2gExportDone(false)")
            end
          rescue => e
            UI.messagebox("Lỗi xuất lại từ lịch sử:\n#{e.message}\n#{e.backtrace.first(3).join("\n")}")
            dlg.execute_script("n2gExportDone(false)")
          end
        end

        # Khôi phục 1 bản ghi lịch sử → nạp lại hình học + cut_order lên preview
        dlg.add_action_callback("restore_history_callback") do |_, id|
          begin
            rec = defined?(N2G::History) ? N2G::History.load_record(id.to_s) : nil
            if rec.nil?
              dlg.execute_script("n2gRestoreResult(false, 'Không đọc được bản ghi.')")
              next
            end
            payload = {
              sheets:     rec['sheets']    || [],
              cut_order:  rec['cut_order'] || {},
              file_name:  rec['file_name'] || '',
              tool_group: rec['tool_group'] || {},
              post:       rec['post'] || {}
            }
            dlg.execute_script("n2gApplyRestore(#{payload.to_json})")
          rescue => e
            puts "restore_history_callback error: #{e.message}"
            dlg.execute_script("n2gRestoreResult(false, #{("Lỗi: "+e.message).to_json})")
          end
        end

        # ── Lịch sử gia công ──
        dlg.add_action_callback("get_history_list_callback") do |_, _json|
          begin
            list = defined?(N2G::History) ? N2G::History.read_index : []
            info = defined?(N2G::History) ? N2G::History.storage_info : {count:0,total_mb:0}
            payload = { list: list, info: info }
            dlg.execute_script("n2gShowHistoryList(#{payload.to_json})")
          rescue => e
            puts "get_history_list_callback error: #{e.message}"
            dlg.execute_script("n2gShowHistoryList(#{({list:[],info:{count:0,total_mb:0}}).to_json})")
          end
        end

        # Xóa 1 bản ghi lịch sử
        dlg.add_action_callback("delete_history_callback") do |_, id|
          begin
            N2G::History.delete_record(id.to_s) if defined?(N2G::History)
            list = defined?(N2G::History) ? N2G::History.read_index : []
            info = defined?(N2G::History) ? N2G::History.storage_info : {count:0,total_mb:0}
            dlg.execute_script("n2gShowHistoryList(#{({list:list, info:info}).to_json})")
          rescue => e
            puts "delete_history_callback error: #{e.message}"
          end
        end

        # Mở thư mục xuất của 1 bản ghi
        dlg.add_action_callback("open_history_folder_callback") do |_, folder|
          begin
            f = folder.to_s
            UI.openURL(f) if !f.empty? && File.directory?(f)
          rescue => e
            puts "open_history_folder_callback error: #{e.message}"
          end
        end

        dlg.add_action_callback("get_license_status_callback") do |_, _json|
          begin
            status = defined?(N2G::Licenses) ? N2G::Licenses.check : { ok: true, status: 'active', message: 'Đã kích hoạt', days_left: nil }
            payload = {
              ok:        status[:ok] ? true : false,
              status:    status[:status].to_s,
              message:   status[:message].to_s,
              days_left: status[:days_left],
              expires:   status[:expires].to_s,
              lifetime:  status[:lifetime] ? true : false,   # key vĩnh viễn (không hết hạn)
              has_key:   (defined?(N2G::Licenses) && !N2G::Licenses.cached_key.empty?)
            }
            dlg.execute_script("n2gShowLicenseStatus(#{payload.to_json})")
          rescue => e
            puts "get_license_status_callback error: #{e.message}"
            dlg.execute_script("n2gShowLicenseStatus(#{({ok:true,status:'active',message:'Đã kích hoạt',days_left:nil}).to_json})")
          end
        end

        # Gỡ kích hoạt: nhận {email, key} từ JS. Key ưu tiên từ cache, nếu cache
        # không có thì dùng key người dùng nhập tay.
        dlg.add_action_callback("deactivate_license_callback") do |_, json|
          begin
            data  = JSON.parse(json.to_s) rescue {}
            email = data['email'].to_s
            key   = defined?(N2G::Licenses) ? N2G::Licenses.cached_key : ''
            key   = data['key'].to_s if key.nil? || key.empty?
            if defined?(N2G::Licenses)
              result = N2G::Licenses.deactivate(key, email)
              dlg.execute_script("n2gDeactivateResult(#{result.to_json})")
            end
          rescue => e
            puts "deactivate_license_callback error: #{e.message}"
            dlg.execute_script("n2gDeactivateResult(#{({success:false,message:'Lỗi: '+e.message}).to_json})")
          end
        end

        dlg.add_action_callback("save_and_reload_callback") do |_, json|
          begin
            hash = JSON.parse(json)
            N2G::Settings.save_app_settings(hash)
            dlg.close
            Dialogs.open_export
          rescue => e
            puts "save_and_reload_callback error: #{e.message}"
          end
        end

        dlg.add_action_callback("reload_dialog_callback") do |_|
          dlg.close; Dialogs.open_export
        end

        dlg.add_action_callback("load_settings_callback") do |_|
          begin; dlg.execute_script("n2gLoadSettings(#{N2G::Settings.load_app_settings.to_json})")
          rescue => e; puts "load_settings_callback error: #{e.message}"; end
        end

        # Xuất cấu hình ra file JSON (parts_json = mảng tên phần được chọn)
        dlg.add_action_callback("export_config_callback") do |_, parts_json|
          begin
            parts = JSON.parse(parts_json)
            data  = N2G::Settings.export_config(parts)
            default_name = "n2g_config_#{Time.now.strftime('%Y%m%d')}.json"
            path = UI.savepanel("Lưu cấu hình N2G", "", default_name)
            if path
              path += ".json" unless path.downcase.end_with?(".json")
              File.write(path, JSON.pretty_generate(data))
              dlg.execute_script("n2gExportResult(true, #{File.basename(path).to_json})")
            else
              dlg.execute_script("n2gExportResult(false, #{'Đã hủy'.to_json})")
            end
          rescue => e
            dlg.execute_script("n2gExportResult(false, #{e.message.to_json})")
          end
        end

        # Mở file để xem có những phần nào (trước khi nhập)
        dlg.add_action_callback("pick_import_file_callback") do |_|
          begin
            path = UI.openpanel("Chọn file cấu hình N2G", "", "JSON|*.json||")
            if path
              data = JSON.parse(File.read(path))
              parts = (data["parts"] || {}).keys
              @@import_pending = data
              dlg.execute_script("n2gImportFilePicked(#{parts.to_json}, #{File.basename(path).to_json})")
            else
              dlg.execute_script("n2gImportFilePicked(null, null)")
            end
          rescue => e
            dlg.execute_script("n2gImportFilePicked(null, #{e.message.to_json})")
          end
        end

        # Thực hiện nhập với các phần đã chọn + chế độ (overwrite/merge)
        dlg.add_action_callback("import_config_callback") do |_, opts_json|
          begin
            opts  = JSON.parse(opts_json)
            data  = @@import_pending
            raise "Chưa chọn file" unless data
            # Lọc chỉ giữ các phần user tích chọn
            sel   = opts["parts"] || []
            data2 = data.dup
            data2["parts"] = (data["parts"] || {}).select { |k, _| sel.include?(k) }
            res   = N2G::Settings.import_config(data2, opts["mode"] || "overwrite")
            dlg.execute_script("n2gImportResult(#{res.to_json})")
          rescue => e
            dlg.execute_script("n2gImportResult(#{ {"ok"=>false, "msg"=>e.message}.to_json })")
          end
        end

        dlg.add_action_callback("save_active_post_callback") do |_, post_id|
          N2G::Settings.save_active_post_id(post_id)
        end

        dlg.add_action_callback("open_url_callback") do |_, url|
          UI.openURL(url.to_s) rescue nil
        end

        dlg.add_action_callback("open_settings_callback") { open_settings }

        dlg.add_action_callback("reload_tool_groups_callback") do
          fresh_groups = N2G::Settings.tool_groups_for_js
          fresh_tools  = fresh_groups.flat_map { |g| g["tools"] }
                           .map { |t| { "name" => t["name"] || "", "diameter" => t["diameter"] || 6 } }
                           .uniq { |t| t["name"] }
          dlg.execute_script("n2gReloadToolGroups(#{fresh_groups.to_json}, #{fresh_tools.to_json})")
        end

        dlg.add_action_callback("save_tool_presets_callback") do |_, json|
          begin; N2G::Settings.save_tool_presets(JSON.parse(json))
          rescue => e; puts "N2G save_tool_presets error: #{e.message}"; end
        end

        dlg.add_action_callback("check_update_callback") do |_|
          # Chạy qua UI.start_timer (main thread) thay vì Thread.new.
          # SketchUp 2024 trên Windows: Net::HTTP trong Thread.new thường chết lặng lẽ,
          # gây "không thể kết nối server" dù mạng tốt. Timer chạy ở main thread an toàn.
          dlg.execute_script("n2gUpdateStatus('Đang kiểm tra...', true)")
          UI.start_timer(0.1, false) do
            begin
              remote = N2G::Updater.fetch_version_info
              if remote.nil?
                dlg.execute_script("n2gUpdateStatus('Không thể kết nối server', false)")
              elsif remote['version_code'].to_i > N2G::Updater.local_version_code
                ver = remote['version_name']
                dlg.execute_script("n2gUpdateStatus('Có bản mới: #{ver} — Đang cập nhật...', true)")
                cache = N2G::Updater.read_cache
                N2G::Updater.write_cache(cache.merge('last_check' => 0))
                N2G::Updater.download_and_install(remote)
                dlg.execute_script("n2gUpdateStatus('Cập nhật xong! Khởi động lại SketchUp để áp dụng.', true)")
              else
                ver = remote['version_name']
                dlg.execute_script("n2gUpdateStatus('Bạn đang dùng phiên bản mới nhất (#{ver})', true)")
              end
            rescue => e
              msg = e.message.gsub("'", "\\'")
              dlg.execute_script("n2gUpdateStatus('Lỗi: #{msg}', false)")
            end
          end
        end

        dlg.add_action_callback("save_active_preset_callback") do |_, id|
          begin
            # Load từ file rồi chỉ update active_tool_preset để không mất settings khác
            stg = N2G::Settings.load_app_settings
            stg['active_tool_preset'] = id.to_s
            N2G::Settings.save_app_settings(stg)
          rescue => e; puts "save_active_preset error: #{e.message}"; end
        end

        dlg.add_action_callback("save_post_preset_callback") do |_, json|
          begin
            cfg   = JSON.parse(json)
            posts = N2G::Settings.load_posts
            idx   = posts.index { |p| p["id"] == cfg["id"] }
            idx ? posts[idx] = cfg : posts << cfg
            N2G::Settings.save_posts(posts)
          rescue => e; puts "save_post_preset error: #{e.message}"; end
        end

        dlg.add_action_callback("delete_post_preset_callback") do |_, id|
          begin
            posts = N2G::Settings.load_posts
            posts.reject! { |p| p["id"].to_s == id.to_s }
            N2G::Settings.save_posts(posts)
          rescue => e; puts "delete_post_preset error: #{e.message}"; end
        end

        dlg.add_action_callback("save_layer_map_callback") do |_, json|
          begin; N2G::Settings.save_layer_map(JSON.parse(json))
          rescue => e; puts "N2G save_layer_map error: #{e.message}"; end
        end

        dlg.add_action_callback("save_ignored_layers_callback") do |_, json|
          begin
            ignored = JSON.parse(json)
            File.write(File.join(ROOT_DIR, "ignored_layers.json"), JSON.generate(ignored))
          rescue => e; puts "N2G save_ignored_layers error: #{e.message}"; end
        end

        dlg.add_action_callback("load_ignored_layers_callback") do |_|
          begin
            path    = File.join(ROOT_DIR, "ignored_layers.json")
            ignored = File.exist?(path) ? JSON.parse(File.read(path)) : []
            dlg.execute_script("n2gSetIgnoredLayers(#{JSON.generate(ignored)})")
          rescue => e
            dlg.execute_script("n2gSetIgnoredLayers([])")
          end
        end

        # Lưu override (đổi layer + điểm xuống dao) vào FILE SKETCHUP
        dlg.add_action_callback("save_overrides_callback") do |_, json|
          begin
            data = JSON.parse(json)
            ok   = save_overrides_to_model(Sketchup.active_model, data)
            n_l  = (data['layer_overrides'] || {}).values.flatten.size
            n_e  = (data['entry_overrides'] || {}).values.flatten.size
            if ok
              n_c   = (data['cut_order'] || {}).values.flatten.size
              parts = []
              parts << "#{n_l} thay đổi layer" if n_l > 0
              parts << "#{n_e} điểm xuống dao" if n_e > 0
              parts << "thứ tự cắt (#{n_c} chi tiết)" if n_c > 0
              msg = if parts.empty?
                "Không có thay đổi nào để lưu."
              else
                "Đã lưu #{parts.join(' và ')} vào file SketchUp.<br>Nhớ lưu file (Ctrl+S) để giữ lâu dài."
              end
            else
              msg = "Lỗi lưu"
            end
            dlg.execute_script("n2gOverridesSaved(#{ok}, #{msg.to_json})")
          rescue => e
            dlg.execute_script("n2gOverridesSaved(false, #{e.message.to_json})")
          end
        end

        dlg.add_action_callback("export_gcode_callback") do |_, config_json|
          if @export_gcode_busy
            puts "N2G: bỏ qua yêu cầu xuất trùng khi một phiên xuất đang chạy"
            next
          end
          @export_gcode_busy = true
          begin
            if defined?(N2G::Licenses)
              status = N2G::Licenses.check
              unless status[:ok]
                dlg.execute_script("n2gLicenseFail(#{status[:message].to_json})")
                N2G::Licenses.show_activation_dialog(status)
                # Dialog kích hoạt vừa đóng → làm mới dòng trạng thái license.
                dlg.execute_script("if(typeof loadLicenseStatus==='function') loadLicenseStatus();")
                @export_gcode_busy = false
                next
              end
            end

            config = JSON.parse(config_json)

            # Catalog dao cụ (để bổ sung field thiếu cho dữ liệu cũ chưa có spindle/tool_notes)
            tool_catalog = {}
            begin
              N2G::Settings.load_tool_groups.each do |g|
                (g["tools"] || []).each do |ct|
                  next unless ct["name"]
                  # Ưu tiên bản có tool_notes/spindle khai báo
                  has_data = !ct["tool_notes"].to_s.strip.empty? ||
                             !ct["spindle_on"].to_s.strip.empty? ||
                             !ct["spindle_off"].to_s.strip.empty?
                  if !tool_catalog[ct["name"]] || has_data
                    tool_catalog[ct["name"]] = ct
                  end
                end
              end
            rescue => e
              puts "N2G: load catalog for migration failed: #{e.message}"
            end

            tl = {}
            tool_jobs = []
            config["tools"].each do |t|
              key   = GcodeEngine.normalize_layer(t["layer"])
              # Nếu dao thiếu field mới → tra catalog theo tên để bổ sung (tương thích dữ liệu cũ)
              cat = tool_catalog[t["name"]] || {}
              son = t["spindle_on"];  son = cat["spindle_on"]  if son.to_s.strip.empty?
              sof = t["spindle_off"]; sof = cat["spindle_off"] if sof.to_s.strip.empty?
              tnt = t["tool_notes"];  tnt = cat["tool_notes"]  if tnt.to_s.strip.empty?
              btp = t["bit_type"];    btp = cat["bit_type"]    if btp.to_s.strip.empty?
              vba = t["vbit_angle"];  vba = cat["vbit_angle"]  if vba.nil?
              cfg_job = {
                layer:       key,
                name:        t["name"],
                color:       t["color"] || "#888888",
                diameter:    t["diameter"].to_f,
                depth:       t["depth"].to_s.strip,
                type:        t["type"].to_sym,
                strategy:    t["strategy"].to_sym,
                bit_type:    (btp || "flat").to_s,
                vbit_angle:  (vba || 120).to_f,
                spindle_on:  son.to_s.strip,
                spindle_off: sof.to_s.strip,
                tool_notes:  tnt.to_s.strip,
                stepover:    t["stepover"].to_f,
                rpm:         N2G::Settings.safe_rpm(t["rpm"]).to_i,
                feed:        t["feed"].to_i,
                z_feed:      t["z_feed"].to_i,
                tool_number: t["tool_number"].to_i,
                direction:   t["direction"],
                # ── Nhiều lượt xuống dao ──
                max_depth:        (t["max_depth"] || 20).to_f.abs,
                num_passes:       (t["num_passes"] || 1).to_i,       # B: số lần xuống dao
                finish_thickness: (t["finish_thickness"] || 0).to_f, # A: độ dày lớp cắt cuối
                z_passes:         t["z_passes"],        # (cũ) mảng thủ công hoặc nil
                z_passes_mode:    t["z_passes_mode"],   # (cũ) 'mm' hoặc nil
                # ── Đoạn dốc xuống dao (ramp) — theo dao ──
                ramp_on:          t["ramp_on"] == true,
                ramp_len:         (t["ramp_len"] || 20).to_f.abs
              }
              tool_jobs << cfg_job
              tl[key] = cfg_job
            end

            # Scanner van can lookup mot cfg/layer, nhung khi cung layer co ca
            # Profile va Drill phai giu edge nguon DONG THOI tao drill center.
            # Cac co noi bo nay khong thay doi JSON JS-Ruby.
            scan_tl = {}
            tool_jobs.group_by { |cfg| cfg[:layer] }.each do |layer_key, jobs|
              drill_job = jobs.find { |cfg| cfg[:type] == :drill }
              non_drill_job = jobs.find { |cfg| cfg[:type] != :drill }
              scan_cfg = (non_drill_job || drill_job).dup
              scan_cfg[:n2g_has_drill] = !drill_job.nil?
              scan_cfg[:n2g_has_non_drill] = !non_drill_job.nil?
              scan_cfg[:n2g_drill_cfg] = drill_job
              scan_tl[layer_key] = scan_cfg
            end

            stg = config["settings"] || {}
            app_settings = {
              antiflyout:       stg["antiflyout"] != false,
              # Lùi điểm xuống dao (chỉ cuttinglines) + cắt chồng 1 bán kính dao
              entry_backoff:    stg["entry_backoff"] == true,
              entry_backoff_mm: (stg["entry_backoff_mm"] || 10).to_f,
              long_final_edge:  stg["long_final_edge"] != false,
              avoid_curve:      stg["avoid_curve"] == true,
              double_cut:       stg["double_cut"] != false,
              dc_offset:        (stg["double_cut_offset"] || 2.5).to_f,
              slowdown:         stg["slowdown"] == true,
              arc_interp:       stg["arc_interp"] == true,
              arc_min_r:        (stg["arc_min_r"] || 60).to_f,
              small_threshold:  (stg["small_threshold"] || 300).to_f,
              custom_name:      stg["custom_name"] == true,
              name_parts:       stg["name_parts"]  || ["index","color","thickness","side"],
              name_seps:        stg["name_seps"]   || ["_","_","_"],
              remove_accent:    stg["remove_accent"] != false,
              side_top:         stg["side_top"] || "T",
              side_bot:         stg["side_bot"] || "B",
              folder_color:     stg["folder_color"]     == true,
              folder_thickness: stg["folder_thickness"] == true,
              zzero:            stg["zzero"]    || "top",
              workarea:         stg["workarea"] || {},
              comment_style:    config["post"]["comment"] || "( ... )",
              thresh_bot:       (stg["thresh_bot"] || 300).to_f,
              thresh_top:       (stg["thresh_top"] || 300).to_f,
              cut_dir:          stg["cut_dir"] || "ccw",
              afv_sel:          stg["afv_sel"] || {},
              cut_order:        config["cut_order"] || {},
              pocket_paths:     config["pocket_paths"] || {},
              profile_engine:   config["profile_engine"] || "legacy",
              profile_paths:    config["profile_paths"] || {},
              tool_jobs:        tool_jobs,
              # Override điểm xuống dao thủ công (tab Xem đường dao)
              entry_overrides:  config["entry_overrides"] || {},
              # Map màu→độ dày người dùng nhập tay (khi nesting thiếu độ dày)
              manual_thickness: config["manual_thickness"] || {},
            }

            # ── Chọn thư mục TRƯỚC khi scan (để hộp thoại mở NGAY, không chờ 3-5s) ──
            out_dir = UI.select_directory(title: "Chọn thư mục lưu G-code")
            unless out_dir
              dlg.execute_script("n2gExportDone(false)")  # user huỷ chọn folder
              @export_gcode_busy = false
              next
            end

            # Đã chọn folder → hiện loading trong lúc scan + sinh G-code
            dlg.execute_script("if(typeof n2gExportBusy==='function') n2gExportBusy()")

            # Nhả luồng 1 nhịp cho dialog VẼ overlay trước, rồi mới scan (scan chiếm
            # luồng Ruby; nếu chạy ngay, overlay không kịp hiện). Giống lúc mở dialog.
            UI.start_timer(0.05, false) do
             begin
              fresh_sheets = Scanner.scan_model(Sketchup.active_model, scan_tl)
              # Nếu không có sheet thì báo lỗi thay vì crash
              if fresh_sheets.nil? || fresh_sheets.empty?
                dlg.execute_script("n2gExportDone(false)")
                UI.messagebox("Không tìm thấy sheet nào để xuất G-code.\nĐảm bảo đang mở file đã nesting bằng ABF.")
                next
              end

              # ── Áp OVERRIDE đổi layer (từ tab Chỉnh sửa) — chỉ ảnh hưởng G-code ──
              begin
                overrides = config["layer_overrides"] || {}
                GcodeEngine.apply_layer_overrides!(fresh_sheets, overrides, scan_tl) if overrides && !overrides.empty?
              rescue => e
                puts "N2G: apply_layer_overrides error: #{e.message}"
              end

              out_folder = PostProcessor.generate(fresh_sheets, tl, config["post"], app_settings, out_dir)
            if out_folder
              # ── Lưu lịch sử gia công (nếu bật) — bọc rescue để KHÔNG ảnh hưởng xuất ──
              begin
                save_history = config["save_history"] != false  # mặc định bật
                if save_history && defined?(N2G::History)
                  model_title = Sketchup.active_model.title
                  model_title = "Không rõ" if model_title.nil? || model_title.empty?
                  # Đếm SỐ CHI TIẾT (tấm) — mỗi chi tiết có group_id riêng.
                  # Đếm số group_id distinct trong cạnh cuttinglines, KHÔNG đếm số cạnh.
                  part_gids = {}
                  fresh_sheets.each do |sh|
                    disp = sh[:display] || sh["display"] || []
                    disp.each do |v|
                      is_dc = v[:is_drill_center] || v["is_drill_center"]
                      lay   = (v[:layer] || v["layer"]).to_s.downcase
                      next if is_dc || !lay.include?("cutting")
                      gid = v[:group_id] || v["group_id"]
                      part_gids[gid] = true if gid
                    end
                  end
                  part_count = part_gids.size

                  # Tên bộ dao + post: ưu tiên tên JS gửi (từ dropdown modal xác nhận
                  # xuất — nơi người dùng thật sự chọn dao/post), fallback tra active id.
                  tg_name = (config["tool_group_name"] || "").to_s.strip
                  if tg_name.empty?
                    active_gid = N2G::Settings.load_active_group_id rescue nil
                    begin
                      grp = (N2G::Settings.load_tool_groups || []).find { |g| g["id"].to_s == active_gid.to_s }
                      tg_name = grp ? (grp["name"] || "").to_s : ""
                    rescue; end
                  end
                  active_gid = N2G::Settings.load_active_group_id rescue nil

                  post_name = (config["post"] && config["post"]["name"]).to_s.strip
                  if post_name.empty?
                    begin
                      active_pid = N2G::Settings.load_active_post_id rescue nil
                      pst = (N2G::Settings.load_posts || []).find { |p| p["id"].to_s == active_pid.to_s }
                      post_name = pst ? (pst["name"] || "").to_s : ""
                    rescue; end
                  end

                  N2G::History.save_record(
                    "file_name"       => model_title,
                    "sheet_count"     => fresh_sheets.size,
                    "part_count"      => part_count,
                    "tool_group_name" => tg_name,
                    "post_name"       => post_name,
                    "output_dir"      => out_folder.to_s,
                    "sheets"          => fresh_sheets,
                    "cut_order"       => config["cut_order"] || {},
                    "layer_overrides" => config["layer_overrides"] || {},
                    "entry_overrides" => config["entry_overrides"] || {},
                    "tool_group"      => { "id" => active_gid, "name" => tg_name, "tools" => tl },
                    "post"            => config["post"] || {},
                    "app_settings"    => app_settings
                  )
                end
              rescue => he
                puts "History save skipped: #{he.message}"
              end
              dlg.execute_script("n2gExportDone(true, #{out_folder.to_json}, #{fresh_sheets.size})")
              else
                # generate trả nil (hiếm — folder đã chọn trước)
                dlg.execute_script("n2gExportDone(false)")
              end
             rescue => te
               UI.messagebox("Lỗi xuất:\n#{te.message}\n#{te.backtrace.first(3).join("\n")}")
               dlg.execute_script("n2gExportDone(false)")
             ensure
               @export_gcode_busy = false
             end
            end  # UI.start_timer
          rescue => e
            @export_gcode_busy = false
            UI.messagebox("Lỗi xuất:\n#{e.message}\n#{e.backtrace.first(3).join("\n")}")
            dlg.execute_script("n2gExportDone(false)")
          end
        end

        dlg.add_action_callback("check_thickness_callback") do |_|
          begin
            sheets = Scanner.scan_model(Sketchup.active_model, {}) || []
            colors_missing = {}   # màu → true (thiếu độ dày)
            has_unnamed    = false
            sheets.each do |sh|
              # bỏ qua mặt bottom trùng để không nhân đôi màu
              p = GcodeEngine.parse_sheet_name(sh[:name].to_s)
              color = p[:color].to_s.strip.gsub(/^_+/, '').gsub(/_+$/, '')
              thick = p[:thickness].to_s.strip
              if color.empty? && thick.empty?
                # Không có cả màu lẫn độ dày → tấm vô danh thật sự, cần nesting lại
                has_unnamed = true
              elsif thick.empty? && !color.empty?
                # Có màu nhưng thiếu độ dày → cần người dùng nhập độ dày cho màu này
                colors_missing[color] = true
              end
              # Có độ dày nhưng không màu (tấm không đổ màu) → HỢP LỆ, không cảnh báo
            end
            result = {
              "missing_colors" => colors_missing.keys,
              "has_unnamed"    => has_unnamed
            }
            dlg.execute_script("n2gThicknessCheck(#{result.to_json})")
          rescue => e
            puts "check_thickness error: #{e.message}"
            dlg.execute_script("n2gThicknessCheck(#{ {"error"=>e.message}.to_json })")
          end
        end

        dlg.add_action_callback("open_folder_callback") do |_, folder_path|
          begin
            if folder_path && File.directory?(folder_path)
              win_path = folder_path.gsub('/', '\\')
              system("explorer.exe \"#{win_path}\"")
            end
          rescue => e
            puts "open_folder error: #{e.message}"
          end
        end

        # Development phải nạp dialog.html + các file JS rời để thay đổi
        # mã có hiệu lực ngay, không bị dialog_assets.rb cũ che khuất.
        # Production không có MODE_DEV nên vẫn dùng bản đóng gói như cũ.
        loaded_assets = false
        use_dev_sources = defined?(N2G::MODE_DEV) && N2G::MODE_DEV && File.exist?(html_path)
        if !use_dev_sources && defined?(N2G::ExportGcode::DialogAssets)
          begin
            dlg.set_html(N2G::ExportGcode::DialogAssets.html)
            loaded_assets = true
          rescue => e
            puts "N2G: dùng dialog_assets lỗi, quay lại dialog.html: #{e.message}"
          end
        end
        dlg.set_file(html_path) unless loaded_assets
        dlg.show
      end

    end # module Dialogs
  end # module ExportGcode
end # module N2G
