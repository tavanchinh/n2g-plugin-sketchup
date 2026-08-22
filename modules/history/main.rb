# encoding: utf-8
require 'json'
require 'fileutils'

# zlib có thể KHÔNG có sẵn trên một số bản SketchUp (đặc biệt .rbe/2023).
# Nếu thiếu, vẫn lưu lịch sử được (không nén) để module không chết.
begin
  require 'zlib'
  N2G_HISTORY_HAS_ZLIB = true
rescue LoadError, StandardError => e
  N2G_HISTORY_HAS_ZLIB = false
  puts "N2G History: zlib không khả dụng, lưu không nén — #{e.message}"
end unless defined?(N2G_HISTORY_HAS_ZLIB)

# ==============================================================================
# N2G / modules / history / main.rb
# ==============================================================================
# Module độc lập ghi lịch sử gia công. KHÔNG phụ thuộc code cũ — export_gcode
# chỉ cần gọi N2G::History.save_record(data) khi xuất G-code.
#
# Lưu trữ:
#   - APP_DATA/N2G/history/index.json         (metadata nhẹ cho danh sách)
#   - APP_DATA/N2G/history/rec_<id>.json.gz   (dữ liệu đầy đủ, nén gzip)
# ==============================================================================

module N2G
  module History

    # Thư mục lưu — dùng APP_DATA để không mất khi cập nhật plugin
    APP_DATA_DIR = if RUBY_PLATFORM =~ /mswin|mingw/
                     File.join(ENV['LOCALAPPDATA'] || ENV['APPDATA'] || Dir.home, 'N2G')
                   else
                     File.join(Dir.home, '.n2g')
                   end
    HISTORY_DIR  = File.join(APP_DATA_DIR, 'history').freeze
    INDEX_FILE   = File.join(HISTORY_DIR, 'index.json').freeze
    MAX_RECORDS  = 50

    # --------------------------------------------------------------------------
    # Tiện ích thư mục
    # --------------------------------------------------------------------------
    def self.ensure_dir
      FileUtils.mkdir_p(HISTORY_DIR) unless File.directory?(HISTORY_DIR)
    end

    def self.record_path(id)
      File.join(HISTORY_DIR, "rec_#{id}.json.gz")
    end

    # --------------------------------------------------------------------------
    # Đọc/ghi index (danh sách metadata nhẹ)
    # --------------------------------------------------------------------------
    def self.read_index
      return [] unless File.exist?(INDEX_FILE)
      JSON.parse(File.read(INDEX_FILE))
    rescue => e
      puts "History.read_index error: #{e.message}"
      []
    end

    def self.write_index(list)
      ensure_dir
      File.write(INDEX_FILE, JSON.pretty_generate(list))
    rescue => e
      puts "History.write_index error: #{e.message}"
    end

    # --------------------------------------------------------------------------
    # Ghi 1 bản ghi lịch sử.
    # data: hash gồm { file_name, sheets, cut_order, tool_group, post,
    #                  sheet_count, part_count, output_dir, ... }
    # Trả về id của bản ghi, hoặc nil nếu lỗi.
    # --------------------------------------------------------------------------
    def self.save_record(data)
      ensure_dir
      id = Time.now.strftime('%Y%m%d_%H%M%S')

      # Metadata nhẹ cho index
      meta = {
        'id'          => id,
        'time'        => Time.now.strftime('%d/%m/%Y %H:%M:%S'),
        'time_iso'    => Time.now.to_s,
        'file_name'   => data['file_name'] || data[:file_name] || 'Không rõ',
        'sheet_count' => data['sheet_count'] || data[:sheet_count] || 0,
        'part_count'  => data['part_count'] || data[:part_count] || 0,
        'tool_group'  => data['tool_group_name'] || data[:tool_group_name] || '',
        'post'        => data['post_name'] || data[:post_name] || '',
        'output_dir'  => data['output_dir'] || data[:output_dir] || ''
      }

      # Dữ liệu đầy đủ (nén gzip)
      full = meta.dup
      full['sheets']     = data['sheets']     || data[:sheets]     || []
      full['cut_order']  = data['cut_order']  || data[:cut_order]  || {}
      full['tool_group'] = data['tool_group'] || data[:tool_group] || {}
      full['post']       = data['post']       || data[:post]       || {}
      full['app_settings'] = data['app_settings'] || data[:app_settings] || {}

      begin
        json = full.to_json
        if N2G_HISTORY_HAS_ZLIB
          gz = Zlib::Deflate.deflate(json, Zlib::BEST_COMPRESSION)
          File.binwrite(record_path(id), gz)
        else
          # Không có zlib → lưu JSON thường (file .json.gz nhưng nội dung không nén)
          File.binwrite(record_path(id), json)
        end
      rescue => e
        puts "History.save_record write error: #{e.message}"
        return nil
      end

      # Cập nhật index (mới nhất lên đầu)
      list = read_index
      list.unshift(meta)

      # Giới hạn MAX_RECORDS — xóa file cũ dư
      if list.size > MAX_RECORDS
        removed = list[MAX_RECORDS..-1] || []
        removed.each do |m|
          f = record_path(m['id'])
          File.delete(f) if File.exist?(f)
        end
        list = list[0...MAX_RECORDS]
      end

      write_index(list)
      id
    rescue => e
      puts "History.save_record error: #{e.message}"
      nil
    end

    # --------------------------------------------------------------------------
    # Đọc đầy đủ 1 bản ghi (giải nén). Trả về hash hoặc nil.
    # --------------------------------------------------------------------------
    def self.load_record(id)
      path = record_path(id)
      return nil unless File.exist?(path)
      raw = File.binread(path)
      json = nil
      # Thử giải nén nếu có zlib; nếu không phải dữ liệu nén (lưu thường) thì đọc trực tiếp
      if N2G_HISTORY_HAS_ZLIB
        begin
          json = Zlib::Inflate.inflate(raw)
        rescue
          json = raw   # file lưu không nén (từ máy thiếu zlib)
        end
      else
        # Không có zlib: giả định file lưu thường. Nếu là file nén cũ thì đành chịu.
        json = raw
      end
      JSON.parse(json)
    rescue => e
      puts "History.load_record error: #{e.message}"
      nil
    end

    # --------------------------------------------------------------------------
    # Xóa 1 bản ghi
    # --------------------------------------------------------------------------
    def self.delete_record(id)
      f = record_path(id)
      File.delete(f) if File.exist?(f)
      list = read_index.reject { |m| m['id'] == id }
      write_index(list)
      true
    rescue => e
      puts "History.delete_record error: #{e.message}"
      false
    end

    # --------------------------------------------------------------------------
    # Xóa toàn bộ lịch sử
    # --------------------------------------------------------------------------
    def self.clear_all
      read_index.each do |m|
        f = record_path(m['id'])
        File.delete(f) if File.exist?(f)
      end
      File.delete(INDEX_FILE) if File.exist?(INDEX_FILE)
      true
    rescue => e
      puts "History.clear_all error: #{e.message}"
      false
    end

    # --------------------------------------------------------------------------
    # Thống kê dung lượng (để hiển thị / theo dõi)
    # --------------------------------------------------------------------------
    def self.storage_info
      ensure_dir
      files = Dir.glob(File.join(HISTORY_DIR, 'rec_*.json.gz'))
      total = files.sum { |f| File.size(f) }
      { count: files.size, total_bytes: total, total_mb: (total / 1048576.0).round(2) }
    rescue => e
      puts "History.storage_info error: #{e.message}"
      { count: 0, total_bytes: 0, total_mb: 0 }
    end

  end
end