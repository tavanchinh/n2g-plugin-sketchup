# ==============================================================================
# N2G / modules / settings / postprocessor.rb
#
# Định nghĩa Post Processor mặc định — dùng khi chưa có posts.json
# ==============================================================================

unless defined?(N2G_DEFAULT_POSTS)
N2G_DEFAULT_POSTS = [
  {
    id:          "thuan_an",
    name:        "Thuận An — Aspire",
    unit:        "G21",
    safe_z:      45,
    clear_z:     5,
    ext:         ".nc",
    comment:     "paren",
    spindle_on:  "M03",
    spindle_off: "M05",
    cool_on:     "",
    cool_off:    "",
    toolchange:  "",
    header:      "( N2G - {sheet_name} )\n( {date} )\nG90\nG54",
    toolcall:    "( === {layer_name} | {tool_name} D{diameter} Z{depth} === )\nT{tool_number}\nG43 H{tool_number}\nM03 S{rpm}",
    footer:      "M05\nG0 Z45.0\nG0 X600.000 Y2460.000\nM30"
  },
  {
    id:          "generic",
    name:        "Generic G-code",
    unit:        "G21",
    safe_z:      25,
    clear_z:     5,
    ext:         ".nc",
    comment:     "paren",
    spindle_on:  "M03",
    spindle_off: "M05",
    cool_on:     "",
    cool_off:    "",
    toolchange:  "",
    header:      "( N2G - {sheet_name} )\n( {date} )\nG90 {unit} G17\nG0 Z{safe_z}",
    toolcall:    "( === {layer_name} | {tool_name} D{diameter} Z{depth} === )\n{spindle_on} S{rpm}",
    footer:      "{spindle_off}\nG0 Z{safe_z}\nG0 X0 Y0\nM30"
  }
].freeze
end