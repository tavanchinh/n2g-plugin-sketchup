require 'json'
require 'digest'
require 'net/http'
require 'openssl'
require 'fileutils'
require 'time'

module N2G
  module Licenses

    # ── Cấu hình ────────────────────────────────────────────────────────────────
    unless defined?(DEV_MODE)
      DEV_MODE       = false
      API_BASE       = DEV_MODE \
                       ? "http://localhost:19842/api/check" \
                       : 'https://n2g.vn/api/check'
      STORE_URL      = 'https://n2g.vn'
      # Đọc phiên bản thật từ version.json (cập nhật theo updater) thay vì hardcode.
      PLUGIN_VER = begin
        vf = File.join(File.dirname(File.dirname(File.dirname(File.expand_path(__FILE__)))), 'version.json')
        File.exist?(vf) ? (JSON.parse(File.read(vf))['version_name'] || '1.0.0') : '1.0.0'
      rescue
        '1.0.0'
      end.freeze
      APP_DATA_DIR   = File.join(ENV['LOCALAPPDATA'] || File.expand_path('~'), 'N2G')
      CACHE_FILE     = File.join(APP_DATA_DIR, 'license_cache.json').freeze
      TRIAL_DAYS     = 30   # khớp với server (api/check.php trả trial_days: 30)
      OFFLINE_GRACE  = 14
      CHECK_INTERVAL = 24  # giờ
    end

    FileUtils.mkdir_p(APP_DATA_DIR) rescue nil

    # ── Machine ID ──────────────────────────────────────────────────────────────
    def self.machine_id
      @machine_id ||= begin
        parts = [
          Socket.gethostname,
          ENV['USERNAME'] || ENV['USER'] || 'user',
          ENV['COMPUTERNAME'] || ENV['HOSTNAME'] || 'host'
        ]
        Digest::SHA256.hexdigest(parts.join('-'))[0..23]
      rescue
        Digest::SHA256.hexdigest('fallback-machine')[0..23]
      end
    end

    # ── Cache ────────────────────────────────────────────────────────────────────
    def self.read_cache
      return nil unless File.exist?(CACHE_FILE)
      data = JSON.parse(File.read(CACHE_FILE))
      stored_sum = data.delete('_checksum')
      expected   = Digest::SHA256.hexdigest(data.to_json + machine_id)
      return nil unless stored_sum == expected
      data
    rescue
      nil
    end

    def self.write_cache(data)
      payload = data.dup
      payload['_checksum'] = Digest::SHA256.hexdigest(data.to_json + machine_id)
      File.write(CACHE_FILE, JSON.pretty_generate(payload))
    rescue => e
      puts "N2G License: cache write error — #{e.message}"
    end

    # ── Tạo trial lần đầu ───────────────────────────────────────────────────────
    def self.init_trial(days = TRIAL_DAYS)
      expires = (Time.now + days * 86400).strftime('%Y-%m-%dT%H:%M:%S')
      trial = {
        'status'       => 'trial',
        'expires'      => expires,
        'trial_start'  => Time.now.strftime('%Y-%m-%dT%H:%M:%S'),
        '_fetched_at'  => Time.now.to_i,
        '_is_local'    => true
      }
      write_cache(trial)
      puts "N2G License: trial started (#{days} days)"
      trial
    end

    # ── API Call ─────────────────────────────────────────────────────────────────
    def self.call_api(key_code: nil)
      uri = URI(API_BASE)
      payload = {
        machine_id:     machine_id,
        plugin_version: PLUGIN_VER,
        key_code:       key_code
      }.compact

      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl      = uri.scheme == 'https'
      http.verify_mode  = OpenSSL::SSL::VERIFY_NONE  # SketchUp Ruby SSL issue
      http.open_timeout = 8
      http.read_timeout = 10

      req = Net::HTTP::Post.new(uri.path.empty? ? '/' : uri.path,
                                'Content-Type' => 'application/json')
      req.body = payload.to_json
      res  = http.request(req)
      data = JSON.parse(res.body)
      data['_fetched_at'] = Time.now.to_i
      data
    rescue => e
      puts "N2G License: API error — #{e.message}"
      nil
    end

    # ── Check License ────────────────────────────────────────────────────────────
    def self.check(key_code: nil)
      cache = read_cache
      just_inited = false

      # Đã gỡ kích hoạt trên máy này: giữ trạng thái chưa kích hoạt, KHÔNG tự động
      # gọi server active lại. Chỉ khi người dùng NHẬP KEY mới mới kích hoạt lại.
      if cache && cache['status'] == 'deactivated' && key_code.nil?
        return {
          status:    'expired',
          days_left: nil,
          message:   'Máy này đã gỡ kích hoạt. Nhập mã để kích hoạt lại.',
          ok:        false
        }
      end

      # Lần đầu tiên cài → tạo trial
      if cache.nil?
        # Gọi API để lấy trial_days từ server
        server_data = call_api
        days = server_data&.dig('trial_days') || TRIAL_DAYS
        cache = init_trial(days)
        just_inited = true
        # Nếu server đã trả về active/blocked thì dùng luôn
        if server_data && !['trial', nil].include?(server_data['status'])
          server_data.delete('_is_local')
          write_cache(server_data)
          return build_status(server_data)
        end
      end

      # Cần gọi API khi: activate key, hoặc đã quá CHECK_INTERVAL giờ
      # Bỏ qua nếu vừa init_trial (đã gọi API rồi)
      last_check = cache['_fetched_at'].to_i
      need_online = !just_inited && (
        key_code ||
        cache['_is_local'] ||
        (Time.now.to_i - last_check) > CHECK_INTERVAL * 3600
      )

      if need_online
        result = call_api(key_code: key_code)
        if result
          result.delete('_is_local')
          # Khi NHẬP KEY (activate): chỉ ghi đè cache nếu key HỢP LỆ.
          # Key sai KHÔNG được phép xóa bản quyền đang hợp lệ trong cache.
          if key_code
            new_status = build_status(result)
            old_status = cache ? build_status(cache) : { ok: false }
            if new_status[:ok]
              # key hợp lệ → cập nhật cache, LƯU LẠI key_code để gỡ kích hoạt sau này
              result['key_code'] = key_code
              write_cache(result)
              cache = result
            elsif old_status[:ok]
              # key sai NHƯNG cache cũ vẫn hợp lệ → GIỮ cache cũ, chỉ báo lỗi
              return build_status(cache).merge(
                activation_failed: true,
                message: (result['message'] || 'Mã kích hoạt không hợp lệ')
              )
            else
              # Cache cũ cũng không hợp lệ → BÁO LỖI THẬT từ server, KHÔNG ghi đè
              # cache bằng kết quả lỗi (tránh làm hỏng trial đang chạy).
              # Ví dụ: "Key này đã được kích hoạt trên máy khác."
              return build_status(cache).merge(
                activation_failed: true,
                message: (result['message'] || 'Mã kích hoạt không hợp lệ'),
                ok: false
              )
            end
          else
            # Kiểm tra định kỳ (không nhập key) → cập nhật bình thường.
            # GIỮ key_code đã lưu từ lần kích hoạt trước (server không trả về key_code).
            result['key_code'] = cache['key_code'] if cache && cache['key_code']
            write_cache(result)
            cache = result
          end
        end
      end

      build_status(cache)
    end

    # ── Build status từ cache ────────────────────────────────────────────────────
    def self.build_status(cache)
      status    = cache['status'] || 'unknown'
      expires   = cache['expires']
      days_left = nil
      # Key VĨNH VIỄN: server trả lifetime=true và expires=null (không hết hạn).
      lifetime  = cache['lifetime'] == true || (status == 'active' && expires.nil?)

      if expires
        exp_time  = Time.parse(expires) rescue nil
        days_left = exp_time ? ((exp_time - Time.now) / 86400).ceil : nil
      end

      # Trial hết hạn → chuyển sang expired
      if status == 'trial' && days_left && days_left <= 0
        status    = 'expired'
        days_left = 0
      end

      # Offline grace: server không trả lời nhưng cache còn trong grace period
      if status == 'unknown'
        fetched      = cache['_fetched_at'].to_i
        offline_days = fetched > 0 ? (Time.now.to_i - fetched) / 86400 : OFFLINE_GRACE + 1
        if offline_days <= OFFLINE_GRACE
          return {
            status:    'offline',
            days_left: nil,
            message:   "Không kết nối server. Offline mode (còn #{OFFLINE_GRACE - offline_days} ngày).",
            ok:        true
          }
        else
          return {
            status:    'blocked',
            days_left: nil,
            message:   'Không xác minh được bản quyền. Kiểm tra kết nối mạng.',
            ok:        false
          }
        end
      end

      ok = ['active', 'trial', 'offline'].include?(status) &&
           (days_left.nil? || days_left > 0)

      msg = case status
      when 'trial'
        days_left && days_left > 0 \
          ? "Dùng thử — còn #{days_left} ngày" \
          : "Hết thời gian dùng thử"
      when 'active'
        if lifetime
          "Đã kích hoạt — bản quyền vĩnh viễn"
        elsif days_left
          "Đã kích hoạt — còn #{days_left} ngày"
        else
          "Đã kích hoạt"
        end
      when 'expired'
        cache['message'] || "Bản quyền đã hết hạn. Vui lòng gia hạn tại #{STORE_URL}"
      when 'blocked'
        cache['message'] || "Tài khoản bị khóa. Liên hệ hỗ trợ."
      when 'error'
        # Server báo lỗi (vd: key không tồn tại, key đã kích hoạt trên máy khác).
        # PHẢI dùng message của server — trước đây rơi vào 'else' và bị nuốt mất.
        cache['message'] || "Mã kích hoạt không hợp lệ."
      else
        # Bất kỳ status lạ nào khác: vẫn ưu tiên message từ server nếu có.
        cache['message'] || "Trạng thái không xác định."
      end

      { status: status, days_left: days_left, message: msg, ok: ok,
        expires: expires, lifetime: lifetime }
    end

    # ── Activate ─────────────────────────────────────────────────────────────────
    def self.activate(key_code)
      check(key_code: key_code)
    end

    # Lấy key_code đã lưu trong cache (nếu có) — để điền sẵn form gỡ kích hoạt.
    def self.cached_key
      c = read_cache
      c ? c['key_code'].to_s : ''
    end

    # ── Gỡ kích hoạt: báo server giải phóng máy + xóa cache local ────────────────
    def self.deactivate(key_code, email)
      key_code = key_code.to_s.strip
      email    = email.to_s.strip
      return { success: false, message: 'Thiếu mã kích hoạt' } if key_code.empty?
      return { success: false, message: 'Vui lòng nhập email xác nhận' } if email.empty?

      uri = URI(API_BASE.sub('/check', '/deactivate'))
      begin
        http = Net::HTTP.new(uri.host, uri.port)
        http.use_ssl      = uri.scheme == 'https'
        http.verify_mode  = OpenSSL::SSL::VERIFY_NONE
        http.open_timeout = 8
        http.read_timeout = 10
        req = Net::HTTP::Post.new(uri.path.empty? ? '/' : uri.path)
        req.set_form_data('key' => key_code, 'email' => email)
        res  = http.request(req)
        data = JSON.parse(res.body) rescue {}
      rescue => e
        return { success: false, message: "Lỗi kết nối server: #{e.message}" }
      end

      if data['success']
        write_cache({ 'status' => 'deactivated', '_fetched_at' => Time.now.to_i })
        { success: true, message: data['message'] || 'Gỡ kích hoạt thành công.' }
      else
        { success: false, message: data['message'] || 'Gỡ kích hoạt thất bại.' }
      end
    end

    # Xóa cache local (dùng khi gỡ kích hoạt)
    def self.clear_cache
      File.delete(CACHE_FILE) if File.exist?(CACHE_FILE)
    rescue => e
      puts "clear_cache error: #{e.message}"
    end

    # ── Gate: gọi trước khi chạy plugin ─────────────────────────────────────────
    def self.gate
      status = check
      unless status[:ok]
        show_activation_dialog(status)
        return false
      end
      # Cảnh báo trial sắp hết (3 ngày cuối)
      if status[:status] == 'trial' && status[:days_left] && status[:days_left] <= 3
        show_activation_dialog(status)
        return false if !status[:ok]
      end
      true
    end

    # ── Dialog kích hoạt ─────────────────────────────────────────────────────────
    def self.show_activation_dialog(status)
      dlg = UI::HtmlDialog.new(
        dialog_title: 'N2G — Kích hoạt bản quyền',
        width: 440, height: 440,
        resizable: false,
        style: UI::HtmlDialog::STYLE_DIALOG
      )
      begin
        dlg.set_position(
          ((UI.screen_size[0] rescue 1920) - 440) / 2,
          ((UI.screen_size[1] rescue 1080) - 440) / 2
        )
      rescue; end

      dlg.set_html(activation_html(status))

      dlg.add_action_callback('activate_callback') do |_, key|
        result = activate(key.to_s.strip)
        # Kích hoạt CHỈ coi là thành công khi license hợp lệ VÀ lần nhập key này
        # không bị đánh dấu thất bại. activation_failed=true nghĩa là: license cũ
        # vẫn hợp lệ (ok=true) nhưng KEY VỪA NHẬP sai/không dùng được → phải báo lỗi.
        if result[:ok] && !result[:activation_failed]
          dlg.execute_script("showSuccess(#{result.to_json})")
          sleep 1.5
          dlg.close
        else
          dlg.execute_script("showError(#{result[:message].to_json})")
        end
      end

      dlg.add_action_callback('open_store') { UI.openURL(STORE_URL) }
      dlg.show_modal
    end

    # ── HTML dialog ──────────────────────────────────────────────────────────────
    def self.activation_html(status)
      is_expired = ['expired', 'blocked'].include?(status[:status])
      is_trial   = status[:status] == 'trial'
      msg_color  = is_expired ? '#c03030' : '#a06000'
      msg_bg     = is_expired ? '#fdf0f0' : '#fdf8f0'
      <<~HTML
        <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8">
        <style>
          *{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,sans-serif}
          body{background:#f5f5f3;display:flex;align-items:center;justify-content:center;height:100vh}
          .wrap{width:380px;padding:32px}
          .logo{font-size:28px;font-weight:800;color:#4f8a14;letter-spacing:-1px}
          .sub{font-size:12px;color:#999;margin-top:2px;margin-bottom:20px}
          .status-box{padding:10px 14px;border-radius:6px;font-size:12px;
            color:#{msg_color};background:#{msg_bg};border:1px solid #{msg_color}40;margin-bottom:18px}
          .label{font-size:11px;color:#666;margin-bottom:6px;font-weight:500;text-transform:uppercase;letter-spacing:.5px}
          input{width:100%;padding:11px 14px;border:1.5px solid #ddd;border-radius:7px;
            font-size:15px;letter-spacing:3px;outline:none;transition:border .2s;background:#fff;color:#222;
            font-family:monospace}
          input:focus{border-color:#4f8a14}
          .err{color:#c03030;font-size:11px;margin-top:6px;min-height:16px;line-height:1.5}
          .btn-p{width:100%;padding:12px;background:#4f8a14;color:#fff;border:none;
            border-radius:7px;font-size:14px;font-weight:700;cursor:pointer;margin-top:14px;transition:background .15s}
          .btn-p:hover{background:#3d6e0f} .btn-p:disabled{background:#ccc;cursor:default}
          .btn-s{width:100%;background:#fff;border:1.5px solid #e0e0e0;color:#555;
            padding:10px;border-radius:7px;font-size:12px;cursor:pointer;margin-top:8px;transition:all .15s}
          .btn-s:hover{border-color:#bbb;color:#333}
          .ok{color:#4f8a14;font-size:12px;text-align:center;padding:10px;display:none;font-weight:600}
          hr{border:none;border-top:1px solid #eee;margin:16px 0 12px}
          .machine{font-size:10px;color:#bbb;text-align:center}
          .machine span{user-select:all;cursor:text;font-family:monospace}
        </style></head><body>
        <div class="wrap">
          <div class="logo">N2G</div>
          <div class="sub">Plugin xuất G-code cho SketchUp</div>
          <div class="status-box">#{status[:message]}</div>
          <div class="label">Nhập key kích hoạt</div>
          <input type="text" id="key" placeholder="N2G1-XXXX-XXXX-XXXX" maxlength="19"
            oninput="fmt(this)" onkeydown="if(event.key==='Enter')doActivate()" autocomplete="off" spellcheck="false">
          <div class="err" id="err"></div>
          <button class="btn-p" id="btn" onclick="doActivate()">Kích hoạt</button>
          <button class="btn-s" onclick="sketchup.open_store()">Mua bản quyền tại #{STORE_URL} →</button>
          <div class="ok" id="ok">✓ Kích hoạt thành công! Đang khởi động lại...</div>
          <hr>
          <div class="machine">Machine ID: <span>#{machine_id}</span></div>
        </div>
        <script>
        function fmt(el){
          let v=el.value.replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,16);
          let parts=v.match(/.{1,4}/g)||[];
          el.value=parts.join('-');
        }
        function doActivate(){
          const k=document.getElementById('key').value.trim();
          if(k.replace(/-/g,'').length<8){showError('Vui lòng nhập key hợp lệ');return;}
          const btn=document.getElementById('btn');
          btn.textContent='Đang kiểm tra...'; btn.disabled=true;
          document.getElementById('err').textContent='';
          sketchup.activate_callback(k);
        }
        function showSuccess(r){
          document.getElementById('ok').style.display='block';
          document.getElementById('err').textContent='';
        }
        function showError(msg){
          document.getElementById('err').textContent=msg;
          const btn=document.getElementById('btn');
          btn.textContent='Kích hoạt'; btn.disabled=false;
        }
        window.onload=()=>document.getElementById('key').focus();
        </script></body></html>
      HTML
    end

  end
end