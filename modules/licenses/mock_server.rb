begin
  require 'webrick'
rescue LoadError
  # webrick không có trong Ruby 3.0+ (SketchUp 2024+) — bỏ qua mock server
  return
end
require 'json'
require 'digest'

module N2G
  module Licenses
    module MockServer

      PORT = 19842

      MOCK_MODE = :trial_ok

      MOCK_VALID_KEY = 'N2G1-TEST-DEMO-2025'

      def self.mock_response(machine_id, key_code)
        now = Time.now

        if key_code == MOCK_VALID_KEY
          return {
            status:           'active',
            expires:          (now + 365*86400).strftime('%Y-%m-%d %H:%M:%S'),
            message:          'Kích hoạt thành công!',
            update_available: nil
          }
        end

        case MOCK_MODE
        when :trial_ok
          {
            status:           'trial',
            expires:          (now + 7*86400).strftime('%Y-%m-%d %H:%M:%S'),
            message:          'Đang dùng thử — còn 7 ngày',
            update_available: nil
          }
        when :trial_expiring
          {
            status:           'trial',
            expires:          (now + 2*86400).strftime('%Y-%m-%d %H:%M:%S'),
            message:          'Đang dùng thử — còn 2 ngày',
            update_available: '1.1.0'
          }
        when :trial_expired
          {
            status:           'expired',
            expires:          (now - 86400).strftime('%Y-%m-%d %H:%M:%S'),
            message:          'Bản dùng thử đã hết hạn',
            update_available: nil
          }
        when :active
          {
            status:           'active',
            expires:          (now + 180*86400).strftime('%Y-%m-%d %H:%M:%S'),
            message:          'Đã kích hoạt — còn 180 ngày',
            update_available: nil
          }
        when :blocked
          {
            status:           'blocked',
            expires:          nil,
            message:          'Tài khoản bị khóa. Liên hệ hỗ trợ.',
            update_available: nil
          }
        end
      end

      def self.start
        return if @server

        null_log = Gem.win_platform? ? 'NUL' : '/dev/null'
        @server = WEBrick::HTTPServer.new(
          Port:         PORT,
          Logger:       WEBrick::Log.new(null_log),
          AccessLog:    []
        )

        @server.mount_proc('/api/check') do |req, res|
          res['Content-Type'] = 'application/json'
          begin
            body       = JSON.parse(req.body || '{}')
            machine_id = body['machine_id'] || ''
            key_code   = (body['key_code'] || '').upcase.strip
            data = mock_response(machine_id, key_code)
            res.body = data.to_json
            res.status = 200
          rescue => e
            res.body   = {status: 'blocked', message: e.message}.to_json
            res.status = 500
          end
        end

        @thread = Thread.new { @server.start }
        puts "N2G MockServer started on http://localhost:#{PORT} (mode: #{MOCK_MODE})"
      end

      def self.stop
        @server&.shutdown
        @thread&.kill
        @server = nil
        @thread = nil
        puts "N2G MockServer stopped"
      end

      def self.running?
        !@server.nil?
      end

      def self.set_mode(mode)
        const_set(:MOCK_MODE, mode)
        puts "N2G MockServer mode: #{mode}"
      end

    end
  end
end