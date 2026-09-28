require 'minitest/autorun'
require 'stringio'
require_relative '../modules/export_gcode/gcode_engine'

class GeometryRegressionTest < Minitest::Test
  G = N2G::ExportGcode::GcodeEngine

  def polygon_edges(points, group_id = 1)
    points.each_with_index.map do |p, i|
      q = points[(i + 1) % points.length]
      { x1: p[0], y1: p[1], x2: q[0], y2: q[1], group_id: group_id }
    end
  end

  def regular_polygon(n, radius = 50.0, rotation = 0.0)
    points = n.times.map do |i|
      a = rotation + 2.0 * Math::PI * i / n
      [radius * Math.cos(a), radius * Math.sin(a)]
    end
    polygon_edges(points)
  end

  def split_rectangle(width, height, splits = 2)
    corners = [[0.0, 0.0], [width, 0.0], [width, height], [0.0, height]]
    points = []
    corners.each_with_index do |a, i|
      b = corners[(i + 1) % corners.length]
      splits.times do |j|
        t = j.to_f / splits
        points << [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      end
    end
    polygon_edges(points)
  end

  def test_real_circles_with_different_segment_counts_and_rotation
    [8, 12, 24, 48].each do |n|
      assert G.profile_circle_like_js?(regular_polygon(n, 50.0, Math::PI / (n * 2))),
             "#{n}-segment circle should be recognized"
    end
  end

  def test_split_square_is_not_a_circle
    refute G.profile_circle_like_js?(split_rectangle(100.0, 100.0, 2))
    refute G.profile_circle_like_js?(split_rectangle(100.0, 100.0, 6))
  end

  def test_split_rectangle_is_not_a_circle
    refute G.profile_circle_like_js?(split_rectangle(100.0, 80.0, 4))
  end

  def test_island_containment_for_round_and_rectangular_geometry
    outer = polygon_edges([[-100.0, -100.0], [100.0, -100.0], [100.0, 100.0], [-100.0, 100.0]])
    assert G.loop_inside_loop?(regular_polygon(24, 30.0), outer)
    assert G.loop_inside_loop?(polygon_edges([[-20.0, -10.0], [20.0, -10.0], [20.0, 10.0], [-20.0, 10.0]]), outer)
    refute G.loop_inside_loop?(regular_polygon(24, 30.0).map { |e| e.transform_values { |v| v.is_a?(Numeric) ? v + 300.0 : v } }, outer)
  end

  def test_loop_builder_keeps_exact_chain_together
    edges = split_rectangle(100.0, 60.0, 8)
    loops = G.build_loops(edges.shuffle, true)
    assert_equal 1, loops.length
    assert loops.first[:closed]
    assert_equal edges.length, loops.first[:edges].length
  end

  def test_unchanged_feedrate_is_not_repeated
    state = {}
    first = G.gcode_line('G1', x: 1.0, y: 2.0, f: 12_000, state: state)
    second = G.gcode_line('G1', x: 2.0, y: 3.0, f: 12_000, state: state)
    assert_includes first, 'F12000'
    refute_includes second, 'F12000'
  end

  def profile_cfg(strategy, extra = {})
    { strategy: strategy, diameter: 6.0, depth: -6.0, feed: 12_000,
      z_feed: 2_000, layer: 'ABF_CUTTINGLINES', comment_style: '( ... )' }.merge(extra)
  end

  def write_profile(edges, cfg, record = nil, settings = {})
    io = StringIO.new
    app = { sheet_name:'test-sheet', layer_name:cfg[:layer], antiflyout:false,
            profile_engine:(record ? 'clipper' : 'legacy'), profile_paths:{} }.merge(settings)
    if record
      app[:profile_paths]["test-sheet::#{cfg[:layer]}"] = record.is_a?(Array) ? record : [record]
    end
    G.write_profile(io, edges, cfg, 40.0, 2_000.0, 2_000.0, app)
    io.string
  end

  def manifest_record(source, run, strategy, mode = 'clipper', closed = true)
    { id:G.profile_loop_id(source), key:G.profile_loop_key(source), strategy:strategy.to_s,
      mode:mode, closed:closed, source_edges:source,
      runs:[run.map { |x, y| { x:x, y:y } }] }
  end

  def xy_moves(gcode)
    x = y = nil
    gcode.lines.filter_map do |line|
      next unless line.match?(/\AG0?[0123]\b/)
      x = line[/\bX(-?\d+(?:\.\d+)?)/, 1]
      y = line[/\bY(-?\d+(?:\.\d+)?)/, 1]
      @modal_x = x.to_f if x
      @modal_y = y.to_f if y
      !@modal_x.nil? && !@modal_y.nil? ? [@modal_x, @modal_y] : nil
    end
  ensure
    @modal_x = @modal_y = nil
  end

  def test_cut_on_semicircle_uses_arc_interpolation
    pts = (0..16).map do |i|
      a = Math::PI * i / 16.0
      [50.0 + 30.0*Math.cos(a), 50.0 + 30.0*Math.sin(a)]
    end
    edges = pts.each_cons(2).map { |a,b| {x1:a[0],y1:a[1],x2:b[0],y2:b[1],group_id:10} }
    gcode = write_profile(edges, profile_cfg(:cut_on, layer:'CUT_ON'))
    assert_match(/G0?2|G0?3/, gcode)
    assert gcode.lines.none? { |l| l.include?('NaN') || l.include?('Infinity') }
  end

  def test_closed_cut_out_and_curved_cut_in_preserve_js_xy
    source = polygon_edges([[0.0,0.0],[80.0,0.0],[50.0,35.0],[80.0,80.0],[0.0,80.0]], 20)
    out_run = [[-3.0,-3.0],[86.0,-3.0],[54.0,35.0],[86.0,86.0],[-3.0,86.0]]
    out_code = write_profile(source, profile_cfg(:cut_out),
      manifest_record(source,out_run,:cut_out))
    out_run.each { |p| assert_includes xy_moves(out_code), p }

    curved = regular_polygon(24, 40.0).map { |e| e.merge(group_id:21) }
    in_run = regular_polygon(24, 37.0).map { |e| [e[:x1],e[:y1]] }
    in_code = write_profile(curved, profile_cfg(:cut_in),
      manifest_record(curved,in_run,:cut_in,'js_offset'))
    in_run.each { |p| assert_includes xy_moves(in_code), p.map { |v| v.round(3) } }
  end

  def test_open_l_u_c_paths_preserve_every_js_segment
    paths = [
      [[0,40],[0,0],[40,0]],
      [[0,40],[0,0],[40,0],[40,40]],
      [[40,40],[0,40],[0,0],[40,0]]
    ]
    paths.each_with_index do |run, i|
      source = run.each_cons(2).map { |a,b| {x1:a[0],y1:a[1],x2:b[0],y2:b[1],group_id:30+i} }
      record = manifest_record(source,run,:cut_out,'js_open_offset',false)
      code = write_profile(source,profile_cfg(:cut_out),record)
      run[1..].each { |p| assert_includes xy_moves(code), p.map(&:to_f) }
    end
  end

  def test_cuttinglines_island_uses_outer_and_inner_js_runs
    outer = polygon_edges([[0.0,0.0],[120.0,0.0],[120.0,100.0],[0.0,100.0]],35)
    inner = polygon_edges([[40.0,30.0],[80.0,30.0],[80.0,70.0],[40.0,70.0]],35)
    outer_run = [[-3.0,-3.0],[123.0,-3.0],[123.0,103.0],[-3.0,103.0]]
    inner_run = [[43.0,33.0],[77.0,33.0],[77.0,67.0],[43.0,67.0]]
    records = [
      manifest_record(outer,outer_run,:cut_out),
      manifest_record(inner,inner_run,:cut_in)
    ]
    code = write_profile(outer+inner,profile_cfg(:cut_out),records)
    positions = xy_moves(code)
    (outer_run+inner_run).each { |p| assert_includes positions,p }
  end

  def test_ramp_and_multiple_z_levels_are_emitted
    edges = polygon_edges([[0.0,0.0],[100.0,0.0],[100.0,60.0],[0.0,60.0]],40)
    code = write_profile(edges,profile_cfg(:cut_on,ramp_on:true,ramp_len:20.0,
      z_top:0.0,z_levels:[-2.0,-4.0,-6.0]))
    [-2.0,-4.0,-6.0].each { |z| assert_match(/Z#{format('%.3f',z)}/,code) }
  end

  def test_antiflyout_classifies_small_and_large_parts
    small = polygon_edges([[0.0,0.0],[250.0,0.0],[250.0,200.0],[0.0,200.0]],50)
    large = polygon_edges([[0.0,0.0],[500.0,0.0],[500.0,400.0],[0.0,400.0]],51)
    settings = {antiflyout:true,small_threshold:300.0,double_cut:true}
    small_code = write_profile(small,profile_cfg(:cut_on),nil,settings)
    large_code = write_profile(large,profile_cfg(:cut_on),nil,settings)
    assert_includes small_code,'SMALL anti-flyout'
    assert_includes small_code,'Z-3.500'
    assert_includes large_code,'LARGE'
    refute_includes large_code,'Z-3.500'
  end

  def test_round_and_rectangular_pocket_islands_are_not_cut_as_pockets
    cfg = {diameter:6.0,depth:-3.0,stepover:50,feed:4_000,z_feed:800,
           direction:'out_in',comment_style:'( ... )'}
    [
      regular_polygon(32,50.0).map { |e| e.merge(group_id:60) } +
        regular_polygon(24,15.0).map { |e| e.merge(group_id:60) },
      polygon_edges([[-60.0,-40.0],[60.0,-40.0],[60.0,40.0],[-60.0,40.0]],61) +
        polygon_edges([[-15.0,-10.0],[15.0,-10.0],[15.0,10.0],[-15.0,10.0]],61)
    ].each do |edges|
      io = StringIO.new
      G.write_pocket(io,edges,cfg,40.0,2_000.0,2_000.0)
      assert_equal 1,io.string.scan(/\( POCKET /).length
      refute_empty xy_moves(io.string)
    end
  end
end
