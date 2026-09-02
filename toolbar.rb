# encoding: utf-8
module N2G
  # 1. Hàm lấy đường dẫn gốc tuyệt đối
  def self.get_base_dir
    path = __FILE__.dup.force_encoding("UTF-8")
    path = path.sub(/^ienc:/, "")
    File.dirname(path)
  end

  # 2. Định nghĩa đường dẫn Icons
  def self.icon_path(name)
    File.join(self.get_base_dir, 'resource', 'icons', name)
  end

  # 3. Tạo Toolbar và các Command
  def self.create_commands
    @toolbar ||= UI::Toolbar.new("N2G")

    # --- Nút 1: Xuất G-code ---
    cmd1 = UI::Command.new("Nesting to G-code") {
      N2G::ExportGcode::Dialogs.open_export
    }
    cmd1.small_icon = self.icon_path('n2g.png')
    cmd1.large_icon = self.icon_path('n2g.png')
    cmd1.tooltip = "Nesting ABF sang G-code cho máy CNC"

    # Thêm vào Toolbar
    if @toolbar.count == 0
      @toolbar.add_item(cmd1)
    end

    @toolbar.restore
    @toolbar.show

    # --- Menu build chỉ ở chế độ phát triển (khi N2G::MODE_DEV tồn tại & true) ---
    # Khi phát hành: xoá MODE_DEV trong n2g.rb → khối này tự bỏ qua.
    self.create_dev_menu if defined?(N2G::MODE_DEV) && N2G::MODE_DEV
  end

  # Menu DEV: build bản phát hành ngay trong SketchUp
  def self.create_dev_menu
    # Nạp builder (chỉ có ở máy dev; bản release đã loại file này ra)
    begin
      rb_builder = File.join(self.get_base_dir, 'modules', 'export_gcode', 'release_builder.rb')
      require rb_builder if File.exist?(rb_builder)
    rescue => e
      puts "N2G: nạp release_builder lỗi: #{e.message}"
    end

    return if @dev_menu_added
    menu = UI.menu('Plugins').add_submenu('N2G (DEV)')

    # Build thường: gộp JS bằng Ruby (nén nhẹ, không obfuscate)
    menu.add_item('Build release (Ruby) → Chọn thư mục...') do
      if defined?(N2G::ExportGcode::ReleaseBuilder)
        N2G::ExportGcode::ReleaseBuilder.build!(regenerate_assets: true)
      else
        UI.messagebox('Không tìm thấy ReleaseBuilder (release_builder.rb).')
      end
    end

    # Build giữ bản obfuscate của Node (chạy `node build_dialog.js` TRƯỚC)
    menu.add_item('Build release (giữ bản obfuscate Node) → Chọn thư mục...') do
      if defined?(N2G::ExportGcode::ReleaseBuilder)
        N2G::ExportGcode::ReleaseBuilder.build!(regenerate_assets: false)
      else
        UI.messagebox('Không tìm thấy ReleaseBuilder (release_builder.rb).')
      end
    end

    @dev_menu_added = true
  end

  if !file_loaded?("N2G_toolbar_final_v2")
    self.create_commands
    file_loaded("N2G_toolbar_final_v2")
  end
end
