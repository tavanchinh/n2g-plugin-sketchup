require 'json'

# ==============================================================================
# N2G / modules / settings / main.rb
# ==============================================================================

# Support cả .rb (dev) và .rbe (production)
['tool', 'postprocessor'].each do |f|
  path = File.join(__dir__, f)
  if    File.exist?(path + '.rbe') then Sketchup.load(path + '.rbe')
  elsif File.exist?(path + '.rb')  then require path
  end
end

module N2G
  module Settings

    unless defined?(SETTINGS_DIR)
      SETTINGS_DIR       = File.dirname(__FILE__).freeze
      TOOLS_JSON         = File.join(SETTINGS_DIR, 'tools.json').freeze
      TOOL_GROUPS_JSON   = File.join(SETTINGS_DIR, 'tool_groups.json').freeze
      POSTS_JSON         = File.join(SETTINGS_DIR, 'posts.json').freeze
      TOOL_PRESETS_JSON  = File.join(SETTINGS_DIR, 'tool_presets.json').freeze
      LAYER_MAP_JSON     = File.join(SETTINGS_DIR, 'layer_map.json').freeze
      ACTIVE_GROUP_JSON  = File.join(SETTINGS_DIR, 'active_group.json').freeze
      ACTIVE_POST_JSON   = File.join(SETTINGS_DIR, 'active_post.json').freeze
      APP_SETTINGS_JSON  = File.join(SETTINGS_DIR, 'app_settings.json').freeze
    end

    # 17000 là dấu hiệu phục hồi dữ liệu RPM lỗi/thiếu, để phân biệt với mặc
    # định 18000 thường được người dùng sử dụng.
    def self.safe_rpm(value)
      rpm = Float(value)
      rpm.finite? && rpm.positive? ? rpm.to_i : 17_000
    rescue ArgumentError, TypeError
      17_000
    end

    def self.normalize_tool_rpms!(tools)
      Array(tools).each do |tool|
        next unless tool.is_a?(Hash)
        key = tool.key?("rpm") ? "rpm" : :rpm
        tool[key] = safe_rpm(tool[key])
      end
      tools
    end

    def self.normalize_group_rpms!(groups)
      Array(groups).each do |group|
        next unless group.is_a?(Hash)
        normalize_tool_rpms!(group["tools"] || group[:tools])
      end
      groups
    end

    def self.normalize_preset_rpms!(presets)
      Array(presets).each do |preset|
        next unless preset.is_a?(Hash)
        normalize_tool_rpms!(preset["tools"] || preset[:tools])
      end
      presets
    end

    # --------------------------------------------------------------------------
    # Tools — load/save tools.json (flat list, có thể từ group hoặc custom)
    # --------------------------------------------------------------------------

    def self.load_tools
      if File.exist?(TOOLS_JSON)
        normalize_tool_rpms!(JSON.parse(File.read(TOOLS_JSON)))
      else
        normalize_tool_rpms!(N2G_DEFAULT_TOOLS.map(&:dup))
      end
    rescue => e
      puts "N2G::Settings.load_tools error: #{e.message}"
      N2G_DEFAULT_TOOLS.map(&:dup)
    end

    def self.save_tools(tools_array)
      normalize_tool_rpms!(tools_array)
      File.write(TOOLS_JSON, JSON.pretty_generate(tools_array))
      true
    rescue => e
      puts "N2G::Settings.save_tools error: #{e.message}"
      false
    end

    # --------------------------------------------------------------------------
    # Tool Groups — load/save tool_groups.json, fallback về N2G_TOOL_GROUPS
    # --------------------------------------------------------------------------

    def self.load_tool_groups
      if File.exist?(TOOL_GROUPS_JSON)
        groups = JSON.parse(File.read(TOOL_GROUPS_JSON), symbolize_names: false)
        normalize_group_rpms!(groups)
        # Dọn id trùng (do nhập nhiều lần): nhóm nào trùng id thì cấp id mới.
        seen = {}
        changed = false
        groups.each_with_index do |g, i|
          id = g["id"].to_s
          if id.empty? || seen[id]
            g["id"] = "grp_fix_#{Time.now.to_i}_#{i}"
            changed = true
          end
          seen[g["id"].to_s] = true
        end
        save_tool_groups(groups) if changed
        groups
      else
        # Fallback: convert hardcode sang format JSON
        N2G_TOOL_GROUPS.map do |g|
          {
            "id"          => g[:id].to_s,
            "name"        => g[:name],
            "description" => g[:description] || "",
            "machine"     => g[:machine] || "",
            "spindles"    => g[:spindles] || 1,
            "tools"       => g[:tools].map { |t|
              {
                "tool_number" => t[:tool_number],
                "name"        => t[:name],
                "diameter"    => t[:diameter],
                "stepover"    => t[:stepover],
                "max_depth"   => t[:max_depth],
                "rpm"         => t[:rpm],
                "feed"        => t[:feed],
                "z_feed"      => t[:z_feed]
              }
            }
          }
        end
      end
    rescue => e
      puts "N2G::Settings.load_tool_groups error: #{e.message}"
      []
    end

    def self.save_tool_groups(groups_array)
      normalize_group_rpms!(groups_array)
      File.write(TOOL_GROUPS_JSON, JSON.pretty_generate(groups_array))
      true
    rescue => e
      puts "N2G::Settings.save_tool_groups error: #{e.message}"
      false
    end

    def self.tool_groups_for_js
      load_tool_groups
    end

    # Load group đang active (lần cuối chọn)
    def self.load_active_group_id
      return JSON.parse(File.read(ACTIVE_GROUP_JSON)) if File.exist?(ACTIVE_GROUP_JSON)
      N2G_TOOL_GROUPS.first[:id].to_s
    rescue
      N2G_TOOL_GROUPS.first[:id].to_s
    end

    def self.save_active_group_id(group_id)
      File.write(ACTIVE_GROUP_JSON, JSON.generate(group_id.to_s))
    rescue => e
      puts "N2G::Settings.save_active_group_id error: #{e.message}"
    end

    # Load/save post processor active lần cuối
    def self.load_active_post_id
      return JSON.parse(File.read(ACTIVE_POST_JSON)) if File.exist?(ACTIVE_POST_JSON)
      'generic'
    rescue
      'generic'
    end

    def self.save_active_post_id(post_id)
      File.write(ACTIVE_POST_JSON, JSON.generate(post_id.to_s))
    rescue => e
      puts "N2G::Settings.save_active_post_id error: #{e.message}"
    end

    # Load tools từ 1 group cụ thể (không ghi đè tools.json)
    def self.tools_from_group(group_id)
      group = N2G_TOOL_GROUPS.find { |g| g[:id].to_s == group_id.to_s }
      return [] unless group
      group[:tools].map do |t|
        {
          "tool_number" => t[:tool_number],
          "name"        => t[:name],
          "diameter"    => t[:diameter],
          "stepover"    => t[:stepover],
          "max_depth"   => t[:max_depth],
          "rpm"         => t[:rpm],
          "feed"        => t[:feed],
          "z_feed"      => t[:z_feed],
          "bit_type"    => t[:bit_type]    || "flat",
          "vbit_angle"  => t[:vbit_angle]  || 120,
          "spindle_on"  => t[:spindle_on]  || "",
          "spindle_off" => t[:spindle_off] || "",
          "tool_notes"  => t[:tool_notes]  || ""
        }
      end
    end

    # --------------------------------------------------------------------------
    # Layer Map (cấu hình layer → dao do user khai báo trong dialog)
    # Mỗi entry: { layer, name, diameter, type, strategy, depth, stepover, rpm, feed, z_feed }
    # --------------------------------------------------------------------------

    def self.load_layer_map
      return normalize_tool_rpms!(JSON.parse(File.read(LAYER_MAP_JSON))) if File.exist?(LAYER_MAP_JSON)
      []
    rescue => e
      puts "N2G::Settings.load_layer_map error: #{e.message}"
      []
    end

    def self.save_layer_map(map_array)
      normalize_tool_rpms!(map_array)
      File.write(LAYER_MAP_JSON, JSON.pretty_generate(map_array))
      true
    rescue => e
      puts "N2G::Settings.save_layer_map error: #{e.message}"
      false
    end

    # Build Hash { "layer_name" => config } từ layer_map đã lưu
    # Dùng bởi Scanner để nhận diện màu sắc & drill type khi scan model
    # Nếu chưa có layer_map → trả về empty hash, scanner vẫn chạy bằng heuristic
    def self.build_tool_library_from_map
      load_layer_map.each_with_object({}) do |entry, lib|
        key = normalize_layer(entry["layer"].to_s)
        lib[key] = {
          layer:    key,
          name:     entry["name"]     || "",
          color:    entry["color"]    || "#888888",
          diameter: entry["diameter"].to_f,
          depth:    entry["depth"].to_s.strip,
          type:     entry["type"].to_sym,
          strategy: entry["strategy"].to_sym,
          bit_type:   (entry["bit_type"] || "flat").to_s,
          vbit_angle: (entry["vbit_angle"] || 120).to_f,
          spindle_on:  (entry["spindle_on"]  || "").to_s.strip,
          spindle_off: (entry["spindle_off"] || "").to_s.strip,
          tool_notes:  (entry["tool_notes"]  || "").to_s.strip,
          stepover: entry["stepover"].to_f,
          rpm:      safe_rpm(entry["rpm"]).to_i,
          feed:     entry["feed"].to_i,
          z_feed:    entry["z_feed"].to_i,
          direction: entry["direction"] || 'cw'
        }
      end
    end

    def self.normalize_layer(name)
      name.to_s.upcase.gsub(/[^A-Z0-9]+/, '_').gsub(/^_+|_+$/, '')
    end

    # --------------------------------------------------------------------------
    # Post Processors
    # --------------------------------------------------------------------------

    def self.load_app_settings
      return JSON.parse(File.read(APP_SETTINGS_JSON)) if File.exist?(APP_SETTINGS_JSON)
      {}
    rescue => e
      puts "N2G load_app_settings error: #{e.message}"; {}
    end

    def self.save_app_settings(hash)
      File.write(APP_SETTINGS_JSON, JSON.pretty_generate(hash))
    rescue => e
      puts "N2G save_app_settings error: #{e.message}"
    end

    def self.load_posts
      if File.exist?(POSTS_JSON)
        posts = JSON.parse(File.read(POSTS_JSON))
        # Dọn id trùng (do nhập nhiều lần trước đây): post nào trùng id thì cấp id mới,
        # để giao diện hiển thị và xóa được từng post độc lập.
        seen = {}
        changed = false
        posts.each_with_index do |p, i|
          id = p["id"].to_s
          if id.empty? || seen[id]
            p["id"] = "post_fix_#{Time.now.to_i}_#{i}"
            changed = true
          end
          seen[p["id"].to_s] = true
        end
        save_posts(posts) if changed
        posts
      else
        defaults = N2G_DEFAULT_POSTS.map { |p| stringify_keys(p) }
        save_posts(defaults)
        defaults
      end
    rescue => e
      puts "N2G::Settings.load_posts error: #{e.message}"
      N2G_DEFAULT_POSTS.map { |p| stringify_keys(p) }
    end

    def self.save_posts(posts_array)
      File.write(POSTS_JSON, JSON.pretty_generate(posts_array))
      true
    rescue => e
      puts "N2G::Settings.save_posts error: #{e.message}"
      false
    end

    # --------------------------------------------------------------------------
    # Tool Presets (dao mẫu đã lưu từ export dialog)
    # --------------------------------------------------------------------------

    def self.load_tool_presets
      return normalize_preset_rpms!(JSON.parse(File.read(TOOL_PRESETS_JSON))) if File.exist?(TOOL_PRESETS_JSON)
      []
    rescue => e
      puts "N2G::Settings.load_tool_presets error: #{e.message}"
      []
    end

    def self.save_tool_presets(presets_array)
      normalize_preset_rpms!(presets_array)
      File.write(TOOL_PRESETS_JSON, JSON.pretty_generate(presets_array))
      true
    rescue => e
      puts "N2G::Settings.save_tool_presets error: #{e.message}"
      false
    end

    # --------------------------------------------------------------------------
    # Export / Import cấu hình (chuyển sang máy khác không phải khai báo lại)
    # parts: mảng tên phần cần xuất, vd ["font","naming","folder","posts","tools"]
    # --------------------------------------------------------------------------
    def self.export_config(parts)
      app = load_app_settings
      data = { "n2g_config_version" => 1, "exported_at" => Time.now.to_s, "parts" => {} }

      if parts.include?("font")
        data["parts"]["font"] = { "font_size" => app["font_size"] }
      end
      if parts.include?("naming")
        # Các khóa liên quan đặt tên file g-code
        data["parts"]["naming"] = app.select { |k, _|
          %w[filename_template file_naming naming_pattern gcode_filename name_template].include?(k)
        }
      end
      if parts.include?("folder")
        data["parts"]["folder"] = app.select { |k, _|
          %w[folder_structure subfolder_template output_structure folder_template].include?(k)
        }
      end
      if parts.include?("posts")
        data["parts"]["posts"] = load_posts
      end
      if parts.include?("tools")
        data["parts"]["tools"] = load_tool_groups
      end
      if parts.include?("presets")
        data["parts"]["presets"] = load_tool_presets
      end

      data
    end

    # mode: "overwrite" (đè) hoặc "merge" (gộp, trùng tên giữ cả hai)
    def self.import_config(data, mode = "overwrite")
      return { "ok" => false, "msg" => "File không hợp lệ" } unless data.is_a?(Hash) && data["parts"]
      parts   = data["parts"]
      applied = []

      # font + naming + folder → đều nằm trong app_settings
      app = load_app_settings
      if parts["font"]
        app.merge!(parts["font"]); applied << "Cỡ chữ"
      end
      if parts["naming"]
        app.merge!(parts["naming"]); applied << "Đặt tên file"
      end
      if parts["folder"]
        app.merge!(parts["folder"]); applied << "Cấu trúc thư mục"
      end
      save_app_settings(app) if parts["font"] || parts["naming"] || parts["folder"]

      if parts["posts"]
        incoming = parts["posts"]
        # Luôn cấp id mới cho post nhập vào để tránh trùng id (gây lỗi không xóa được).
        ts = Time.now.to_i
        incoming = incoming.each_with_index.map do |p, i|
          p = p.dup
          p["id"] = "post_imp_#{ts}_#{i}"
          p
        end
        if mode == "merge"
          existing = load_posts
          names = existing.map { |p| p["name"] }
          incoming.each do |p|
            nm = p["name"]
            p["name"] = "#{nm} (nhập)" if names.include?(nm)
            existing << p
          end
          save_posts(existing)
        else
          save_posts(incoming)
        end
        applied << "Post máy"
      end

      if parts["tools"]
        incoming = parts["tools"]
        # Luôn cấp id mới để tránh trùng id giữa các lần nhập.
        ts = Time.now.to_i
        incoming = incoming.each_with_index.map do |g, i|
          g = g.dup
          g["id"] = "grp_imp_#{ts}_#{i}"
          g
        end
        if mode == "merge"
          existing = load_tool_groups
          names = existing.map { |g| g["name"] }
          incoming.each do |g|
            g["name"] = "#{g['name']} (nhập)" if names.include?(g["name"])
            existing << g
          end
          save_tool_groups(existing)
        else
          save_tool_groups(incoming)
        end
        applied << "Thư viện dao"
      end

      if parts["presets"]
        incoming = parts["presets"]
        ts = Time.now.to_i
        incoming = incoming.each_with_index.map do |p, i|
          p = p.dup
          p["id"] = ts * 1000 + i
          p
        end
        if mode == "merge"
          existing = load_tool_presets
          names = existing.map { |p| p["name"] }
          incoming.each do |p|
            p["name"] = "#{p['name']} (nhập)" if names.include?(p["name"])
            existing << p
          end
          save_tool_presets(existing)
        else
          save_tool_presets(incoming)
        end
        applied << "Cấu hình dao"
      end

      { "ok" => true, "applied" => applied }
    rescue => e
      { "ok" => false, "msg" => e.message }
    end

    # --------------------------------------------------------------------------
    private

    def self.stringify_keys(hash)
      hash.each_with_object({}) { |(k, v), h| h[k.to_s] = v }
    end

  end # module Settings
end # module N2G
