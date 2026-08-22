require 'json'
require 'net/http'
require 'openssl'
require 'fileutils'
require 'digest'

module N2G
  module Updater

    PLUGIN_DIR   = File.expand_path('../../..', __FILE__)
    APP_DATA_DIR = File.join(ENV['LOCALAPPDATA'] || File.expand_path('~'), 'N2G')
    VERSION_FILE = File.join(PLUGIN_DIR, 'version.json')   # version local trong plugin
    # Cache riêng cho từng phiên bản SketchUp — tránh bị chia sẻ nhầm giữa SU2022/2023/2024
    _su_ver      = defined?(Sketchup) ? Sketchup.version.to_i : 0
    CACHE_FILE   = File.join(APP_DATA_DIR, "update_cache_su#{_su_ver}.json")
    VERSION_URL  = 'https://n2g.vn/api/version.json'
    CHECK_INTERVAL = 24 * 3600

    # Đảm bảo thư mục tồn tại
    FileUtils.mkdir_p(APP_DATA_DIR) rescue nil

    # Files thuộc về user config — không được update
    USER_CONFIG_FILES = %w[
      modules/settings/layer_map.json
      modules/settings/tool_presets.json
      modules/settings/tools.json
      modules/settings/tool_groups.json
      modules/settings/posts.json
      modules/settings/app_settings.json
      modules/settings/active_post.json
      modules/settings/active_group.json
      modules/settings/dialog_prefs.json
      modules/ignored_layers.json
    ].freeze
    def self.local_version_code
      return 0 unless File.exist?(VERSION_FILE)
      JSON.parse(File.read(VERSION_FILE))['version_code'].to_i
    rescue
      0
    end

    def self.local_version_name
      return '0.0.0' unless File.exist?(VERSION_FILE)
      JSON.parse(File.read(VERSION_FILE))['version_name'] || '0.0.0'
    rescue
      '0.0.0'
    end

    # ── Cache ────────────────────────────────────────────────────────────────
    def self.read_cache
      return {} unless File.exist?(CACHE_FILE)
      JSON.parse(File.read(CACHE_FILE))
    rescue
      {}
    end

    def self.write_cache(data)
      File.write(CACHE_FILE, JSON.pretty_generate(data))
    rescue => e
      puts "N2G Updater: cache error — #{e.message}"
    end

    # ── HTTP GET helper ──────────────────────────────────────────────────────
    def self.http_get(url_str, persistent_http: nil)
      uri  = URI(url_str)
      http = persistent_http || begin
        h = Net::HTTP.new(uri.host, uri.port)
        h.use_ssl      = uri.scheme == 'https'
        h.verify_mode  = OpenSSL::SSL::VERIFY_NONE
        h.open_timeout = 5
        h.read_timeout = 10
        h
      end
      res = http.get(uri.request_uri)
      return nil unless res.code == '200'
      res.body
    rescue => e
      puts "N2G Updater: http_get error — #{e.message}"
      nil
    end

    def self.fetch_version_info
      body = http_get(VERSION_URL)
      return nil unless body
      JSON.parse(body)
    rescue => e
      puts "N2G Updater: fetch_version_info error — #{e.message}"
      nil
    end

    # ── Check update (chạy ngầm) ─────────────────────────────────────────────
    def self.check_async
      # Dùng UI.start_timer (main thread) thay Thread.new — SketchUp 2024/Windows
      # thường làm Net::HTTP trong Thread.new chết lặng lẽ. Timer delay 5s không block UI.
      UI.start_timer(5, false) do
        begin
          check
        rescue => e
          puts "N2G Updater: async error — #{e.message}"
        end
      end
    end

    def self.check
      cache = read_cache
      last_check = cache['last_check'].to_i

      if Time.now.to_i - last_check < CHECK_INTERVAL
        puts "N2G Updater: skip (#{((Time.now.to_i - last_check)/3600).round}h ago)"
        return
      end

      puts "N2G Updater: checking..."
      body = http_get(VERSION_URL)
      unless body
        puts "N2G Updater: server unreachable"
        return
      end

      remote = JSON.parse(body)
      write_cache(cache.merge(
        'last_check'     => Time.now.to_i,
        'latest_version' => remote['version_name']
      ))

      local_code  = local_version_code
      remote_code = remote['version_code'].to_i
      puts "N2G Updater: local=#{local_version_name}(#{local_code}) remote=#{remote['version_name']}(#{remote_code})"

      if remote_code > local_code
        puts "N2G Updater: new version #{remote['version_name']} — installing..."
        download_and_install(remote)
      else
        puts "N2G Updater: up to date"
      end
    end

    # ── Download và install từng file ────────────────────────────────────────
    def self.download_and_install(remote)
      manifest_url = remote['manifest_url']
      unless manifest_url
        puts "N2G Updater: no manifest_url in version info"
        return
      end

      # Tải manifest
      puts "N2G Updater: fetching manifest..."
      body = http_get(manifest_url)
      unless body
        puts "N2G Updater: failed to fetch manifest"
        return
      end

      manifest = JSON.parse(body)
      files    = manifest['files'] || []
      total    = files.size
      failed   = []

      puts "N2G Updater: #{total} files to update"

      # Dùng 1 persistent connection cho tất cả files (cùng host)
      base_uri = URI(manifest_url)
      http = Net::HTTP.new(base_uri.host, base_uri.port)
      http.use_ssl      = base_uri.scheme == 'https'
      http.verify_mode  = OpenSSL::SSL::VERIFY_NONE
      http.open_timeout = 5
      http.read_timeout = 10
      http.start

      files.each_with_index do |file_info, idx|
        path     = file_info['path']
        url      = file_info['url']
        expected = file_info['md5']

        # Bỏ qua file user đã tùy chỉnh
        if USER_CONFIG_FILES.include?(path)
          puts "N2G Updater: [#{idx+1}/#{total}] skip (user config) #{path}"
          next
        end

        # Kiểm tra MD5 local — nếu giống thì bỏ qua (file chưa thay đổi)
        if expected && !expected.empty?
          local_path = File.join(PLUGIN_DIR, path)
          if File.exist?(local_path)
            local_md5 = Digest::MD5.file(local_path).hexdigest
            if local_md5 == expected
              puts "N2G Updater: [#{idx+1}/#{total}] skip (unchanged) #{path}"
              next
            end
          end
        end

        puts "N2G Updater: [#{idx+1}/#{total}] #{path}"

        content = http_get(url, persistent_http: http)
        unless content
          puts "N2G Updater: FAIL download #{path}"
          failed << path
          next
        end

        # Verify MD5 (bỏ qua nếu md5 rỗng)
        if expected && !expected.empty?
          actual = Digest::MD5.hexdigest(content)
          unless actual == expected
            puts "N2G Updater: FAIL md5 #{path} (expected #{expected}, got #{actual})"
            failed << path
            next
          end
        end

        # Ghi file
        dest = File.join(PLUGIN_DIR, path)
        FileUtils.mkdir_p(File.dirname(dest))
        File.binwrite(dest, content)
        puts "N2G Updater: OK #{path}"
      end

      http.finish rescue nil

      if failed.any?
        puts "N2G Updater: done with #{failed.size} errors — #{failed.join(', ')}"
      else
        puts "N2G Updater: updated to #{remote['version_name']} — restart SketchUp to apply"
      end
    end

  end
end