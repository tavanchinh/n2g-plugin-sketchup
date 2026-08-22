# ==============================================================================
# N2G / modules / settings / tool.rb
#
# Khai báo nhóm dao (Tool Groups) theo từng máy CNC
#
# Mỗi group có:
#   id          - Symbol định danh duy nhất
#   name        - Tên hiển thị
#   description - Mô tả máy
#   machine     - Tên máy CNC
#   spindles    - Số đầu dao tối đa
#   tools       - Mảng dao trong nhóm
#
# Mỗi tool có:
#   tool_number - Số thứ tự trên máy (T1, T2, ...)
#   name        - Tên dao
#   diameter    - Đường kính (mm)
#   stepover    - % stepover (dùng cho pocket/profile)
#   max_depth   - Độ sâu tối đa mỗi LẦN HẠ DAO (mm, dương). Vượt quá thì chia nhiều lượt.
#   rpm         - Tốc độ spindle (vòng/phút)
#   feed        - Feedrate XY (mm/phút)
#   z_feed      - Feedrate xuống Z (mm/phút)
# ==============================================================================

unless defined?(N2G_TOOL_GROUPS)
N2G_TOOL_GROUPS = [

  # ============================================================
  # Máy 4 đầu dao
  # ============================================================
  {
    id:          :machine_4spindle,
    name:        "Máy 4 đầu",
    description: "CNC 4 spindle — bộ dao tiêu chuẩn",
    machine:     "CNC 4 Spindle",
    spindles:    4,
    tools: [
      {
        tool_number: 1,
        name:        "End Mill 6mm — Cắt đứt",
        diameter:    6.0,
        stepover:    90,
        max_depth:   17.5,
        rpm:         18000,
        feed:        2500,
        z_feed:      800
      },
      {
        tool_number: 2,
        name:        "Khoan cam 5mm",
        diameter:    5.0,
        stepover:    0,
        max_depth:   12.5,
        rpm:         18000,
        feed:        0,
        z_feed:      400
      },
      {
        tool_number: 3,
        name:        "Khoan bản lề 15mm",
        diameter:    15.0,
        stepover:    0,
        max_depth:   12.5,
        rpm:         18000,
        feed:        0,
        z_feed:      300
      },
      {
        tool_number: 4,
        name:        "End Mill 6mm — Pocket",
        diameter:    6.0,
        stepover:    90,
        max_depth:   7.0,
        rpm:         18000,
        feed:        2000,
        z_feed:      600
      }
    ]
  },

  # ============================================================
  # Máy 12 đầu dao
  # ============================================================
  {
    id:          :machine_12spindle,
    name:        "Máy 12 đầu",
    description: "CNC 12 spindle — bộ dao đầy đủ",
    machine:     "CNC 12 Spindle",
    spindles:    12,
    tools: [
      {
        tool_number: 1,
        name:        "End Mill 6mm — Cắt đứt",
        diameter:    6.0,
        stepover:    90,
        max_depth:   17.5,
        rpm:         18000,
        feed:        2500,
        z_feed:      800
      },
      {
        tool_number: 2,
        name:        "End Mill 8mm — Cắt đứt dày",
        diameter:    8.0,
        stepover:    90,
        max_depth:   25.0,
        rpm:         16000,
        feed:        2000,
        z_feed:      700
      },
      {
        tool_number: 3,
        name:        "Khoan cam 5mm",
        diameter:    5.0,
        stepover:    0,
        max_depth:   12.5,
        rpm:         18000,
        feed:        0,
        z_feed:      400
      },
      {
        tool_number: 4,
        name:        "Khoan cam 8mm",
        diameter:    8.0,
        stepover:    0,
        max_depth:   12.5,
        rpm:         18000,
        feed:        0,
        z_feed:      350
      },
      {
        tool_number: 5,
        name:        "Khoan bản lề 15mm",
        diameter:    15.0,
        stepover:    0,
        max_depth:   12.5,
        rpm:         18000,
        feed:        0,
        z_feed:      300
      },
      {
        tool_number: 6,
        name:        "Khoan bản lề 35mm",
        diameter:    35.0,
        stepover:    0,
        max_depth:   14.0,
        rpm:         12000,
        feed:        0,
        z_feed:      200
      },
      {
        tool_number: 7,
        name:        "End Mill 6mm — Pocket",
        diameter:    6.0,
        stepover:    90,
        max_depth:   7.0,
        rpm:         18000,
        feed:        2000,
        z_feed:      600
      },
      {
        tool_number: 8,
        name:        "End Mill 4mm — Rãnh nhỏ",
        diameter:    4.0,
        stepover:    85,
        max_depth:   5.0,
        rpm:         20000,
        feed:        1500,
        z_feed:      500
      },
      {
        tool_number: 9,
        name:        "V-Bit 90° — Khắc",
        diameter:    6.0,
        stepover:    40,
        max_depth:   3.0,
        rpm:         18000,
        feed:        1200,
        z_feed:      400
      },
      {
        tool_number: 10,
        name:        "Khoan mộng 10mm",
        diameter:    10.0,
        stepover:    0,
        max_depth:   30.0,
        rpm:         16000,
        feed:        0,
        z_feed:      300
      },
      {
        tool_number: 11,
        name:        "End Mill 12mm — Phay thô",
        diameter:    12.0,
        stepover:    75,
        max_depth:   20.0,
        rpm:         14000,
        feed:        3000,
        z_feed:      900
      },
      {
        tool_number: 12,
        name:        "End Mill 3mm — Tinh",
        diameter:    3.0,
        stepover:    50,
        max_depth:   3.0,
        rpm:         24000,
        feed:        1000,
        z_feed:      300
      }
    ]
  }

].freeze

# ------------------------------------------------------------------------------
# Helper: lấy group theo id
# ------------------------------------------------------------------------------
def n2g_find_tool_group(group_id)
  N2G_TOOL_GROUPS.find { |g| g[:id] == group_id.to_sym }
end

# Helper: flatten tất cả tools từ 1 group thành array đơn giản
# (format tương thích với tools.json)
def n2g_tools_from_group(group_id)
  group = n2g_find_tool_group(group_id)
  return [] unless group
  group[:tools].map { |t| stringify_tool(t) }
end

# Helper: convert symbol keys → string keys (cho JSON)
def stringify_tool(tool)
  {
    "tool_number" => tool[:tool_number],
    "name"        => tool[:name],
    "diameter"    => tool[:diameter],
    "stepover"    => tool[:stepover],
    "max_depth"   => tool[:max_depth],
    "rpm"         => tool[:rpm],
    "feed"        => tool[:feed],
    "z_feed"      => tool[:z_feed]
  }
end

# Dùng group đầu tiên làm default khi chưa có tools.json
N2G_DEFAULT_TOOLS = N2G_TOOL_GROUPS.first[:tools].map { |t| stringify_tool(t) }.freeze
end