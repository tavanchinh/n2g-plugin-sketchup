require 'json'
require 'fileutils'

# ==============================================================================
# N2G / modules / export_gcode / main.rb
# Entry point — khai báo constants, load các module con theo thứ tự dependency
# ==============================================================================

module N2G
  module ExportGcode

    EXPORT_DIR   = File.dirname(__FILE__).freeze
    ROOT_DIR     = File.expand_path('../../', __FILE__).freeze
    SETTINGS_DIR = File.join(ROOT_DIR, 'settings').freeze

    # Support cả .rb (dev) và .rbe (production)
    _settings_main = File.join(SETTINGS_DIR, 'main')
    if    File.exist?(_settings_main + '.rbe') then Sketchup.load(_settings_main + '.rbe')
    elsif File.exist?(_settings_main + '.rb')  then require _settings_main
    end

  end
end

# Load theo thứ tự dependency:
# 1. GcodeEngine trước (Scanner dùng normalize_layer từ GcodeEngine)
# 2. Scanner
# 3. PostProcessor
# 4. Dialogs
[
  'gcode_engine',
  'scanner',
  'post_processor',
  'dialogs'
].each do |f|
  path = File.join(File.dirname(__FILE__), "#{f}.rb")
  if File.exist?(path)
    require path
  else
    Sketchup.load(path.sub(/\.rb$/, ''))
  end
end

# ── Entry point ──
#N2G::ExportGcode::Dialogs.open_export