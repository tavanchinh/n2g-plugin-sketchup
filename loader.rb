module N2G
  PATH_ROOT = File.dirname(__FILE__)
  LOAD_ORDER = %w[
    modules/settings/main
    modules/licenses/main
    modules/updater/main
    modules/history/main
    modules/export_gcode/main
  ]

  # Chuẩn hoá đường dẫn để so sánh: expand_path + đổi \ thành / + chữ thường.
  # Trên Windows, __dir__ và Dir.glob trả về khác nhau về hoa/thường (C: vs c:)
  # và dấu gạch (\ vs /) → so chuỗi thô bị lệch → file bị nạp 2 lần (warning
  # "already initialized constant"). Chuẩn hoá giúp so khớp đúng.
  def self.norm(p)
    File.expand_path(p).tr('\\', '/').downcase
  end

  def self.load_file(path)
    if    File.exist?(path + '.rbe') then Sketchup.load(path + '.rbe')
    elsif File.exist?(path + '.rb')  then load(path + '.rb')
    end
  end

  def self.load_all
    loaded = []  # danh sách base đã nạp (đã chuẩn hoá)

    # Load theo thứ tự cố định
    LOAD_ORDER.each do |rel|
      base = File.join(__dir__, rel)
      begin
        load_file(base)
      rescue => e
        puts "N2G loader: retry #{File.basename(base)} — #{e.message}"
        begin
          load_file(base)  # retry 1 lần
        rescue => e2
          puts "N2G loader: FAIL #{File.basename(base)} — #{e2.message}"
        end
      end
      loaded << norm(base)
    end

    # Load các file còn lại (chưa nằm trong LOAD_ORDER)
    skip_names = %w[mock_server server_api_example]
    Dir.glob(File.join(__dir__, 'modules', '**', '*.{rb,rbe}')).each do |file|
      base_raw = file.sub(/\.(rb|rbe)$/, '')
      base = norm(base_raw)
      next if loaded.include?(base)                       # đã nạp → bỏ
      next if skip_names.include?(File.basename(base_raw))
      next if file.end_with?('.rb') && File.exist?(base_raw + '.rbe')  # ưu tiên .rbe
      begin
        file.end_with?('.rbe') ? Sketchup.load(file) : load(file)
      rescue => e
        puts "N2G loader: #{File.basename(file)} — #{e.message}"
      end
      loaded << base
    end

    # Toolbar cuối cùng — đảm bảo mọi module đã load
    tb = File.join(PATH_ROOT, File.exist?(File.join(PATH_ROOT, 'toolbar.rbe')) ? 'toolbar.rbe' : 'toolbar.rb')
    Sketchup.load(tb)

    # Kiểm tra update ngầm sau khi load xong (mỗi 24h, không block UI)
    N2G::Updater.check_async rescue nil
  end

  self.load_all
end