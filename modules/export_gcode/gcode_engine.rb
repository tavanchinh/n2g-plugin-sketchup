# ==============================================================================
# N2G / modules / export_gcode / gcode_engine.rb
# Geometry helpers + G-code generation (loops, arcs, offset, drill, pocket, profile)
# ==============================================================================

module N2G
  module ExportGcode
    module GcodeEngine

      # Ngưỡng miter khi offset biên dạng. Nếu đỉnh miter dài hơn MITER_LIMIT lần
      # bán kính dao thì thay bằng cung tròn (xem offset_polygon_miter). 2.0 ↔ góc
      # chi tiết ~60°: nhọn hơn thì bo cung, tù hơn thì giữ đỉnh nhọn như cũ.
      MITER_LIMIT = 2.0

      # Chỉ nội suy G02/G03 khi hình học có đủ độ phân giải như Arc/Circle thật
      # của SketchUp. Tránh nhận nhầm đa giác ít cạnh do người dùng chủ đích vẽ.
      ARC_MIN_SEGMENTS         = 12
      FULL_CIRCLE_MIN_SEGMENTS = 24

      # ── Loop building ────────────────────────────────────────────────────────

      # ── Loop `inner` có THỰC SỰ nằm trong loop `outer` không ──────────────────
      # Trước đây chỉ so bbox lồng nhau. Hình LÕM (L/U/C) có bbox lớn hơn vùng vật
      # liệu thật, nên mọi chi tiết nằm trong phần KHUYẾT đều bị coi là island →
      # đường chạy dao sai (vét theo bbox, cắt lẹm ra ngoài).
      # Ở đây lọc nhanh bằng bbox (không lồng bbox thì chắc chắn không nằm trong),
      # rồi kiểm THẬT bằng point-in-polygon trên nhiều điểm mẫu: lấy các đỉnh và
      # trung điểm cạnh của inner, quá nửa nằm trong outer thì mới coi là lồng.
      # Dùng nhiều điểm để không bị lệch khi một điểm rơi đúng lên biên.
      def self.loop_inside_loop?(inner_edges, outer_edges)
        return false if inner_edges.nil? || outer_edges.nil?
        return false if inner_edges.size < 2 || outer_edges.size < 3

        ixs = inner_edges.flat_map { |e| [e[:x1], e[:x2]] }
        iys = inner_edges.flat_map { |e| [e[:y1], e[:y2]] }
        oxs = outer_edges.flat_map { |e| [e[:x1], e[:x2]] }
        oys = outer_edges.flat_map { |e| [e[:y1], e[:y2]] }
        # Lọc nhanh: bbox inner phải nằm gọn trong bbox outer
        return false unless ixs.min > oxs.min && ixs.max < oxs.max &&
                            iys.min > oys.min && iys.max < oys.max

        outer_verts = outer_edges.map { |e| { x: e[:x1], y: e[:y1] } }
        samples = []
        inner_edges.each do |e|
          samples << { x: e[:x1], y: e[:y1] }
          samples << { x: (e[:x1] + e[:x2]) / 2.0, y: (e[:y1] + e[:y2]) / 2.0 }
        end
        return false if samples.empty?
        inside = samples.count { |p| point_in_poly?(p[:x], p[:y], outer_verts) }
        inside * 2 > samples.size
      end

      def self.build_loops(raw_edges)
        # Dedupe edges trùng nhau trước (do component lồng nhau extract nhiều lần)
        seen_edges = {}
        unique_edges = raw_edges.select do |e|
          k1 = "#{e[:x1].round(2)},#{e[:y1].round(2)},#{e[:x2].round(2)},#{e[:y2].round(2)}"
          k2 = "#{e[:x2].round(2)},#{e[:y2].round(2)},#{e[:x1].round(2)},#{e[:y1].round(2)}"
          unless seen_edges[k1] || seen_edges[k2]
            seen_edges[k1] = true
            true
          end
        end

        loops     = []
        remaining = unique_edges.dup

        while remaining.any?
          loop_edges = [remaining.shift]
          closed     = false
          max_iter   = remaining.size + 1
          iter       = 0

          while !closed && remaining.any? && iter < max_iter
            iter   += 1
            tail_x  = loop_edges.last[:x2]
            tail_y  = loop_edges.last[:y2]
            head_x  = loop_edges.first[:x1]
            head_y  = loop_edges.first[:y1]

            ni = remaining.index do |e|
              (Math.sqrt((e[:x1] - tail_x)**2 + (e[:y1] - tail_y)**2) < 0.5) ||
              (Math.sqrt((e[:x2] - tail_x)**2 + (e[:y2] - tail_y)**2) < 0.5)
            end

            if ni
              e = remaining.delete_at(ni)
              d1 = Math.sqrt((e[:x1] - tail_x)**2 + (e[:y1] - tail_y)**2)
              d2 = Math.sqrt((e[:x2] - tail_x)**2 + (e[:y2] - tail_y)**2)
              # Chỉ flip khi x2 khớp tail TỐT HƠN x1
              if d2 < d1
                e = e.merge(x1: e[:x2], y1: e[:y2], x2: e[:x1], y2: e[:y1])
              end
              loop_edges << e
              closed = Math.sqrt((e[:x2] - head_x)**2 + (e[:y2] - head_y)**2) < 0.5
            else
              # Hết edge nối ĐUÔI → thử nối vào ĐẦU (prepend). Cần cho ĐƯỜNG HỞ khi edge
              # khởi đầu nằm GIỮA đường (vd zigzag liền mạch): chỉ nối 1 chiều thì phần
              # phía trước bị bỏ lại thành loop riêng → dao nhấc lên chạy rời rạc.
              hi = remaining.index do |e2|
                (Math.sqrt((e2[:x2] - head_x)**2 + (e2[:y2] - head_y)**2) < 0.5) ||
                (Math.sqrt((e2[:x1] - head_x)**2 + (e2[:y1] - head_y)**2) < 0.5)
              end
              break unless hi
              e2 = remaining.delete_at(hi)
              h1 = Math.sqrt((e2[:x2] - head_x)**2 + (e2[:y2] - head_y)**2)  # đuôi e2 chạm đầu
              h2 = Math.sqrt((e2[:x1] - head_x)**2 + (e2[:y1] - head_y)**2)  # đầu e2 chạm đầu → lật
              if h2 < h1
                e2 = e2.merge(x1: e2[:x2], y1: e2[:y2], x2: e2[:x1], y2: e2[:y1])
              end
              loop_edges.unshift(e2)
              closed = Math.sqrt((loop_edges.last[:x2] - e2[:x1])**2 +
                                 (loop_edges.last[:y2] - e2[:y1])**2) < 0.5
            end
          end

          # Dedupe loops: bỏ qua loop trùng (cùng bounding box + edge count)
          all_x    = loop_edges.flat_map { |e| [e[:x1], e[:x2]] }
          all_y    = loop_edges.flat_map { |e| [e[:y1], e[:y2]] }
          loop_key = "#{loop_edges.size},#{all_x.min.round(1)},#{all_y.min.round(1)},#{all_x.max.round(1)},#{all_y.max.round(1)}"

          unless loops.any? { |l|
            lx = l[:edges].flat_map { |e| [e[:x1], e[:x2]] }
            ly = l[:edges].flat_map { |e| [e[:y1], e[:y2]] }
            lk = "#{l[:edges].size},#{lx.min.round(1)},#{ly.min.round(1)},#{lx.max.round(1)},#{ly.max.round(1)}"
            lk == loop_key
          }
            loops << { edges: loop_edges, closed: closed }
          end
        end

        loops
      end

      # ── Arc Detection ────────────────────────────────────────────────────────

      # Tìm tâm circumscribed circle qua 3 điểm
      def self.circumcenter(x1, y1, x2, y2, x3, y3)
        ax = x2 - x1; ay = y2 - y1
        bx = x3 - x1; by = y3 - y1
        d  = 2.0 * (ax * by - ay * bx)
        return nil if d.abs < 1e-10
        ux = (by * (ax*ax + ay*ay) - ay * (bx*bx + by*by)) / d
        uy = (ax * (bx*bx + by*by) - bx * (ax*ax + ay*ay)) / d
        [x1 + ux, y1 + uy]
      end

      # Nhóm edges liên tiếp thành segments: :line, :arc, hoặc :full_circle
      # cw = true → G02 (clockwise), false → G03 (counter-clockwise)
      def self.classify_segments(edges, tolerance: 0.5)
        # ── Full circle detection ────────────────────────────────────────────
        if edges.size >= FULL_CIRCLE_MIN_SEGMENTS
          n   = edges.size
          p1x = edges[0][:x1];         p1y = edges[0][:y1]
          p2x = edges[n/3][:x1];       p2y = edges[n/3][:y1]
          p3x = edges[n*2/3][:x1];     p3y = edges[n*2/3][:y1]
          cc  = circumcenter(p1x, p1y, p2x, p2y, p3x, p3y)
          if cc
            cx, cy = cc
            r   = Math.sqrt((p1x-cx)**2 + (p1y-cy)**2)
            tol = [r * 0.015, 1.5].max
            all_on_circle = edges.all? do |e|
              (Math.sqrt((e[:x1]-cx)**2 + (e[:y1]-cy)**2) - r).abs <= tol &&
              (Math.sqrt((e[:x2]-cx)**2 + (e[:y2]-cy)**2) - r).abs <= tol
            end
            closed = (edges.last[:x2] - edges.first[:x1]).abs < 1.0 &&
                     (edges.last[:y2] - edges.first[:y1]).abs < 1.0
            # Kiểm tra bbox gần vuông — viên thuốc có ratio > 1.15 → không phải full circle
            all_x   = edges.flat_map { |e| [e[:x1], e[:x2]] }
            all_y   = edges.flat_map { |e| [e[:y1], e[:y2]] }
            bbox_w  = all_x.max - all_x.min
            bbox_h  = all_y.max - all_y.min
            ratio   = bbox_w > 0 && bbox_h > 0 ? [bbox_w, bbox_h].max.to_f / [bbox_w, bbox_h].min : 999
            # Kiểm tra tâm circumcenter có gần tâm bbox không
            bbox_cx = (all_x.min + all_x.max) / 2.0
            bbox_cy = (all_y.min + all_y.max) / 2.0
            center_ok = (cx - bbox_cx).abs < r * 0.1 && (cy - bbox_cy).abs < r * 0.1
            if all_on_circle && closed && ratio < 1.15 && center_ok
              return [{ type: :full_circle, edges: edges, cx: cx, cy: cy, r: r }]
            end
          end
        end

        # ── Arc / Line detection ─────────────────────────────────────────────
        segments = []
        i = 0
        while i < edges.size
          if i + 4 < edges.size
            p1x = edges[i][:x1];     p1y = edges[i][:y1]
            p2x = edges[i+2][:x1];   p2y = edges[i+2][:y1]
            p3x = edges[i+4][:x1];   p3y = edges[i+4][:y1]

            cc = circumcenter(p1x, p1y, p2x, p2y, p3x, p3y)
            if cc
              cx, cy = cc
              r = Math.sqrt((p1x-cx)**2 + (p1y-cy)**2)

              first_6_ok = (i..i+4).all? do |j|
                ex = edges[j][:x2]; ey = edges[j][:y2]
                mx = (edges[j][:x1] + edges[j][:x2]) / 2.0
                my = (edges[j][:y1] + edges[j][:y2]) / 2.0
                (Math.sqrt((ex-cx)**2 + (ey-cy)**2) - r).abs <= tolerance &&
                (Math.sqrt((mx-cx)**2 + (my-cy)**2) - r).abs <= tolerance
              end

              if first_6_ok
                arc_end = i + 4
                (i+5...edges.size).each do |j|
                  ex = edges[j][:x2]; ey = edges[j][:y2]
                  mx = (edges[j][:x1] + edges[j][:x2]) / 2.0
                  my = (edges[j][:y1] + edges[j][:y2]) / 2.0
                  break if (Math.sqrt((ex-cx)**2 + (ey-cy)**2) - r).abs > tolerance
                  break if (Math.sqrt((mx-cx)**2 + (my-cy)**2) - r).abs > tolerance
                  arc_end = j
                end

                vx1   = edges[i][:x1] - cx;         vy1 = edges[i][:y1] - cy
                vx2   = edges[arc_end][:x2] - cx;   vy2 = edges[arc_end][:y2] - cy
                cross = vx1 * vy2 - vy1 * vx2
                cw    = cross < 0

                arc_edges = edges[i..arc_end]
                arc_closed = (arc_edges.last[:x2] - arc_edges.first[:x1]).abs < 1.0 &&
                             (arc_edges.last[:y2] - arc_edges.first[:y1]).abs < 1.0
                min_segments = arc_closed ? FULL_CIRCLE_MIN_SEGMENTS : ARC_MIN_SEGMENTS
                if arc_edges.size >= min_segments
                  segments << { type: :arc, edges: arc_edges, cx: cx, cy: cy, r: r, cw: cw }
                  i = arc_end + 1
                  next
                end
              end
            end
          end

          segments << { type: :line, edges: [edges[i]] }
          i += 1
        end
        segments
      end

      # ── Offset Loop (port 1:1 từ JS offsetLoopJS) ────────────────────────────
      # Đảm bảo G-code xuất ra khớp hoàn toàn với canvas preview
      def self.offset_loop(loop_edges, d, direction: 'cw')
        return [] if loop_edges.size < 2

        # Tính winding — giống JS: area > 0 → CCW → wind_sign = -1
        area = 0.0
        loop_edges.each { |e| area += e[:x1] * e[:y2] - e[:x2] * e[:y1] }
        wind_sign = area > 0 ? -1 : 1
        sign      = d * wind_sign

        n   = loop_edges.size
        pts = []

        n.times do |i|
          e1 = loop_edges[i]
          e2 = loop_edges[(i + 1) % n]

          dx1  = e1[:x2] - e1[:x1]; dy1 = e1[:y2] - e1[:y1]
          len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1)
          next if len1 < 0.01

          dx2  = e2[:x2] - e2[:x1]; dy2 = e2[:y2] - e2[:y1]
          len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2)
          next if len2 < 0.01

          # Bỏ qua edge ngắn bị đảo chiều (dot product âm + len < 2mm)
          dot = (dx1*dx2 + dy1*dy2) / (len1 * len2)
          if len2 < 2.0 && dot < -0.5
            # Edge bị flip — dùng normal của e1 làm điểm offset
            nx1 = -dy1 / len1; ny1 = dx1 / len1
            pts << { x: e1[:x2] + nx1 * sign, y: e1[:y2] + ny1 * sign }
            next
          end

          nx1 = -dy1 / len1; ny1 = dx1 / len1
          nx2 = -dy2 / len2; ny2 = dx2 / len2

          ox1 = e1[:x2] + nx1 * sign; oy1 = e1[:y2] + ny1 * sign
          ox2 = e2[:x1] + nx2 * sign; oy2 = e2[:y1] + ny2 * sign

          denom = dx1 * dy2 - dy1 * dx2

          if denom.abs < 0.001
            pts << { x: (ox1 + ox2) / 2.0, y: (oy1 + oy2) / 2.0 }
          else
            t    = ((ox2 - ox1) * dy2 - (oy2 - oy1) * dx2) / denom
            ix   = ox1 + t * dx1
            iy   = oy1 + t * dy1
            dist = Math.sqrt((ix - e1[:x2])**2 + (iy - e1[:y2])**2)
            # Threshold linh hoạt: nếu điểm giao xa hơn 3× offset hoặc t ngoài [−2,2] → fallback
            if dist > d.abs * 3 || t < -2.0 || t > (len1 + d.abs) / [len1, 0.01].max
              pts << { x: (ox1 + ox2) / 2.0, y: (oy1 + oy2) / 2.0 }
            else
              pts << { x: ix, y: iy }
            end
          end
        end

        # KHÔNG push điểm extra cuối, KHÔNG lọc min_dist — giống JS
        pts
      end

      # Offset polygon kín bằng miter join chuẩn (port từ JS offsetPolygonMiter).
      # dist > 0 = offset VÀO TRONG. Dùng cho profile loop kín — không méo ở hình
      # nhiều góc lõm (mộng dương) như offset_loop cũ.
      # loop_edges: mảng edge {x1,y1,x2,y2}. Trả mảng [{x,y}] cùng số đỉnh.
      # round_sharp=true → góc nhọn được BO CUNG bán kính |dist| thay vì để đỉnh miter
      # vọt xa. CHỈ dùng khi offset RA NGOÀI (cut_out): cung nằm ngoài vật liệu nên vô
      # hại. KHÔNG dùng khi offset VÀO TRONG (pocket/cut_in) — ở đó đỉnh miter dài mới
      # đúng, bo cung sẽ đưa tâm dao tới quá gần đỉnh nhọn và cắt lẹm ra ngoài biên.
      def self.offset_polygon_miter(loop_edges, dist, round_sharp = false, bevel_concave = false)
        verts = loop_edges.map { |e| { x: e[:x1], y: e[:y1] } }
        n = verts.size
        return [] if n < 3

        area = 0.0
        (0...n).each do |i|
          a = verts[i]; b = verts[(i+1) % n]
          area += (a[:x]*b[:y] - b[:x]*a[:y])
        end
        inward_sign = area > 0 ? 1.0 : -1.0

        out = []
        (0...n).each do |i|
          prev = verts[(i-1+n) % n]
          cur  = verts[i]
          nxt  = verts[(i+1) % n]

          d1x = cur[:x]-prev[:x]; d1y = cur[:y]-prev[:y]
          d2x = nxt[:x]-cur[:x];  d2y = nxt[:y]-cur[:y]
          l1 = Math.hypot(d1x, d1y); l2 = Math.hypot(d2x, d2y)
          if l1 < 1e-6 || l2 < 1e-6
            out << { x: cur[:x], y: cur[:y] }; next
          end
          d1x /= l1; d1y /= l1; d2x /= l2; d2y /= l2

          n1x = -d1y; n1y = d1x
          n2x = -d2y; n2y = d2x

          mx = n1x + n2x; my = n1y + n2y
          ml = Math.hypot(mx, my)
          if ml < 1e-6
            mx = n1x; my = n1y; ml = 1.0
          end
          mx /= ml; my /= ml

          cos_half = mx*n1x + my*n1y
          cos_half = 1.0 if cos_half.abs < 1e-6
          miter_len = dist / cos_half
          turn = d1x * d2y - d1y * d2x
          concave = (area > 0 && turn < -1e-7) || (area < 0 && turn > 1e-7)
          if bevel_concave && concave
            bs = dist * inward_sign
            out << { x: cur[:x] + n1x * bs, y: cur[:y] + n1y * bs }
            out << { x: cur[:x] + n2x * bs, y: cur[:y] + n2y * bs }
            next
          end

          # ── GIỚI HẠN MITER (góc nhọn) ───────────────────────────────────────
          # miter_len = dist/cos_half → góc càng nhọn đỉnh miter càng vọt xa (dao D6
          # tại góc 10° vọt 34mm ≈ 11× bán kính) → đường dao chạy ra ngoài chi tiết
          # rất xa. Khi vượt ngưỡng, thay đỉnh nhọn bằng CUNG TRÒN bán kính |dist|
          # quanh đỉnh: đúng vật lý (dao tròn không tạo được mũi nhọn) và không vọt
          # xa. Góc tù (đa số) giữ miter y như cũ. KHỚP JS offsetPolygonMiter.
          if !round_sharp || miter_len.abs <= MITER_LIMIT * dist.abs
            out << {
              x: (cur[:x] + mx * miter_len * inward_sign).round(4),
              y: (cur[:y] + my * miter_len * inward_sign).round(4)
            }
          else
            s  = dist * inward_sign
            r  = s.abs
            a1 = Math.atan2(n1y * s, n1x * s)
            a2 = Math.atan2(n2y * s, n2x * s)
            da = a2 - a1
            da += 2 * Math::PI while da <= -Math::PI
            da -= 2 * Math::PI while da > Math::PI
            steps = [(da.abs / (Math::PI / 12.0)).ceil, 1].max
            (0..steps).each do |k|
              a = a1 + da * k / steps.to_f
              out << { x: (cur[:x] + Math.cos(a) * r).round(4),
                       y: (cur[:y] + Math.sin(a) * r).round(4) }
            end
          end
        end
        out
      end

      # ── Helpers ──────────────────────────────────────────────────────────────

      def self.shrink_rect(x_min, y_min, x_max, y_max, d)
        nx_min = x_min + d; ny_min = y_min + d
        nx_max = x_max - d; ny_max = y_max - d
        (nx_min >= nx_max || ny_min >= ny_max) ? nil : [nx_min, ny_min, nx_max, ny_max]
      end

      def self.min_dist_to_border(edges, sheet_w, sheet_h)
        all_x = edges.flat_map { |e| [e[:x1], e[:x2]] }
        all_y = edges.flat_map { |e| [e[:y1], e[:y2]] }
        [all_x.min, sheet_w - all_x.max, all_y.min, sheet_h - all_y.max].min
      end

      def self.group_edges_by_center(raw)
        grid = 20.0
        buckets = {}
        raw.each do |e|
          cx  = ((e[:x1] + e[:x2]) / 2.0 / grid).round
          cy  = ((e[:y1] + e[:y2]) / 2.0 / grid).round
          key = "#{cx},#{cy}"
          buckets[key] ||= []
          buckets[key] << e
        end
        buckets.values.map { |edges| { edges: edges, closed: true } }
      end

      # Tìm override điểm xuống dao thủ công cho 1 loop (khớp định danh với JS:
      # part_id + tâm + kích thước, làm tròn, dung sai 1mm).
      # Trả { x:, y: } = TỌA ĐỘ ĐỈNH người dùng chọn, hoặc nil.
      def self.find_entry_override(app_settings, edges, x_min, x_max, y_min, y_max)
        ovs_all = app_settings[:entry_overrides]
        return nil if ovs_all.nil? || ovs_all.empty?
        sname = app_settings[:sheet_name].to_s
        arr = ovs_all[sname] || ovs_all[sname.gsub(/^_+/, "")]
        return nil if arr.nil? || arr.empty?

        pid = edges.map { |e| e[:part_id] }.compact.first
        cx  = ((x_min + x_max) / 2.0).round
        cy  = ((y_min + y_max) / 2.0).round
        w   = (x_max - x_min).round
        h   = (y_max - y_min).round
        tol = 1

        found = arr.find do |o|
          o_pid = o["pid"]
          (o_pid || nil).to_s == (pid || nil).to_s &&
            (o["cx"].to_i - cx).abs <= tol && (o["cy"].to_i - cy).abs <= tol &&
            (o["w"].to_i - w).abs <= tol && (o["h"].to_i - h).abs <= tol
        end
        return nil unless found
        { x: found["px"].to_f, y: found["py"].to_f }
      end

      def self.normalize_layer(name)
        name.to_s.upcase.gsub(/[^A-Z0-9]+/, '_').gsub(/^_+|_+$/, '')
      end

      # Mirrors detectCircleJS for routing only. Circle Profile uses the
      # existing analytic/legacy branch and does not require Clipper XY runs.
      def self.profile_circle_like_js?(edges)
        return false unless edges.is_a?(Array) && edges.size >= 8
        closed = (edges.last[:x2].to_f - edges.first[:x1].to_f).abs < 1.0 &&
                 (edges.last[:y2].to_f - edges.first[:y1].to_f).abs < 1.0
        return false unless closed
        fit = fit_circle_gcode(edges.map { |e| { x:e[:x1].to_f, y:e[:y1].to_f } })
        return false unless fit && fit[:r].to_f > 0.0
        xs = edges.flat_map { |e| [e[:x1].to_f, e[:x2].to_f] }
        ys = edges.flat_map { |e| [e[:y1].to_f, e[:y2].to_f] }
        bw = xs.max - xs.min; bh = ys.max - ys.min
        ratio = [bw,bh].max / [[bw,bh].min,0.001].max
        bbox_cx = (xs.min+xs.max)/2.0; bbox_cy = (ys.min+ys.max)/2.0
        tol = [fit[:r].to_f*0.015,1.5].max
        fit[:max_error].to_f <= tol && ratio < 1.15 &&
          (fit[:cx].to_f-bbox_cx).abs < fit[:r].to_f*0.1 &&
          (fit[:cy].to_f-bbox_cy).abs < fit[:r].to_f*0.1
      rescue StandardError
        false
      end

      # ── Áp override đổi layer (từ tab Chỉnh sửa) lên sheets trước khi sinh G-code ──
      # overrides: { "tên sheet" => [ {kind, pid, cx, cy, w, h, fromLayer, toLayer}, ... ] }
      # tl: tool library (để biết layer đích là drill hay không) — key đã normalize.
      def self.apply_layer_overrides!(sheets, overrides, tl)
        return if overrides.nil? || overrides.empty?
        sheets.each do |sheet|
          sname = sheet[:name].to_s
          ovs = overrides[sname] || overrides[sname.gsub(/^_+/, "")]
          next if ovs.nil? || ovs.empty?

          # Áp lên cả :vectors (dùng cho G-code) và :display (hiển thị/lịch sử)
          [:vectors, :display].each do |field|
            arr = sheet[field]
            next unless arr.is_a?(Array)
            apply_overrides_to_edges!(arr, ovs, tl)
          end
        end
      end

      # Đổi layer các edge khớp override. Nếu layer đích là drill → chuyển hình thành điểm khoan tại tâm.
      def self.apply_overrides_to_edges!(edges, ovs, tl)
        # Gom edge theo (fromLayer + part_id) để tính tâm/bbox từng nhóm khớp override
        ovs.each do |o|
          to_layer   = o["toLayer"] || o["to_layer"]
          from_layer = o["fromLayer"] || o["from_layer"]
          next if to_layer.nil? || from_layer.nil?
          o_pid = o["pid"]
          o_cx  = o["cx"].to_f; o_cy = o["cy"].to_f
          o_w   = o["w"].to_f;  o_h  = o["h"].to_f
          o_kind = o["kind"] || "loop"

          # Tìm các edge khớp: cùng from_layer, cùng part_id, nằm trong vùng đối tượng.
          matched = edges.select do |e|
            next false if e[:layer] != from_layer
            epid = e[:part_id]
            next false if (o_pid || nil).to_s != (epid || nil).to_s
            ecx = (e[:x1] + e[:x2]) / 2.0
            ecy = (e[:y1] + e[:y2]) / 2.0
            tol = 1.0
            (ecx - o_cx).abs <= o_w/2 + tol && (ecy - o_cy).abs <= o_h/2 + tol
          end
          next if matched.empty?

          norm_to = normalize_layer(to_layer)
          to_cfg = tl[norm_to]
          to_has_drill = to_cfg && (to_cfg[:type] == :drill || to_cfg[:n2g_has_drill] == true)
          to_has_non_drill = to_cfg && (to_cfg[:type] != :drill || to_cfg[:n2g_has_non_drill] == true)
          to_is_drill = to_has_drill

          if to_is_drill && o_kind != "drill"
            # Hình (đường) → khoan tại TÂM: xóa các edge hình, thêm 1 điểm khoan tại tâm bbox.
            xs = matched.flat_map { |e| [e[:x1], e[:x2]] }
            ys = matched.flat_map { |e| [e[:y1], e[:y2]] }
            cx = (xs.min + xs.max) / 2.0
            cy = (ys.min + ys.max) / 2.0
            pid = matched.map { |e| e[:part_id] }.compact.first
            gid = matched.map { |e| e[:group_id] }.compact.first
            drill_cfg = (to_cfg && to_cfg[:n2g_drill_cfg]) || to_cfg
            dia = (drill_cfg && drill_cfg[:diameter]) || 5.0
            # xóa edge cũ
            matched.each { |e| edges.delete(e) } unless to_has_non_drill
            matched.each { |e| e[:layer] = to_layer } if to_has_non_drill
            # thêm điểm khoan (drill center): x1=x2=cx, y1=y2=cy
            edges << {
              x1: cx, y1: cy, x2: cx, y2: cy,
              color: (drill_cfg && drill_cfg[:color]) || "#e07b00",
              layer: to_layer, is_drill_center: true,
              diameter: dia, group_id: gid, part_id: pid
            }
          else
            # Đổi layer thường (profile/pocket/drill→drill): chỉ đổi :layer
            matched.each { |e| e[:layer] = to_layer }
          end
        end
      end

      def self.fmt_comment(text, style)
        case style
        when 'off'   then nil
        when '; ...' then "; #{text}"
        else              "( #{text} )"
        end
      end

      # G-code line compression: chỉ ghi axis khi thay đổi
      def self.gcode_line(cmd, x: nil, y: nil, z: nil, i: nil, j: nil, f: nil, state: {})
        parts = [cmd]
        if x && (state[:x].nil? || (x - state[:x]).abs > 0.0001)
          parts << "X#{format('%.3f', x)}"; state[:x] = x
        end
        if y && (state[:y].nil? || (y - state[:y]).abs > 0.0001)
          parts << "Y#{format('%.3f', y)}"; state[:y] = y
        end
        if z && (state[:z].nil? || (z - state[:z]).abs > 0.0001)
          parts << "Z#{format('%.3f', z)}"; state[:z] = z
        end
        parts << "I#{format('%.3f', i)}" if i
        parts << "J#{format('%.3f', j)}" if j
        if f && (state[:f].nil? || (f - state[:f]).abs > 0.0001)
          parts << "F#{f}"; state[:f] = f
        end
        parts.join(' ')
      end

      # ── Sort loops ───────────────────────────────────────────────────────────

      def self.sort_loops_by_proximity(loops, sheet_w, sheet_h, threshold: 10.0, island_set: {}, small_threshold: 300.0, thresh_top: 300.0, thresh_bot: 300.0)
        n = loops.size
        return (0...n).to_a if n == 0

        bboxes = loops.map do |lp|
          ex = lp[:edges].flat_map { |e| [e[:x1], e[:x2]] }
          ey = lp[:edges].flat_map { |e| [e[:y1], e[:y2]] }
          { xmin: ex.min, xmax: ex.max, ymin: ey.min, ymax: ey.max }
        end

        # ── Thông tin lồng nhau (nesting) — KHỚP JS tpNestInfo ──────────────────
        # contain[i] = số loop bao quanh i (chỉ bbox lồng, KHÔNG cần cùng chi tiết,
        #   vì chi tiết con trong island thường là group khác). depth = contain.
        # parent[i] = loop bao trực tiếp (bbox nhỏ nhất). root[i] = loop ngoài cùng.
        area = lambda { |b| (b[:xmax] - b[:xmin]) * (b[:ymax] - b[:ymin]) }
        contains = lambda do |j, i|
          next false if j == i
          a = bboxes[j]; b = bboxes[i]
          a[:xmin] <= b[:xmin] && a[:xmax] >= b[:xmax] &&
          a[:ymin] <= b[:ymin] && a[:ymax] >= b[:ymax] &&
          area.call(a) > area.call(b) + 0.01
        end

        contain = Array.new(n, 0)
        parent  = Array.new(n)
        (0...n).each do |i|
          enclosers = (0...n).select { |j| contains.call(j, i) }
          contain[i] = enclosers.size
          par = i; par_area = Float::INFINITY
          enclosers.each do |j|
            a = area.call(bboxes[j])
            if a < par_area then par_area = a; par = j end
          end
          parent[i] = par
        end
        root = Array.new(n)
        (0...n).each do |k|
          cur = k; guard = 0
          while contain[cur] > 0 && parent[cur] != cur && guard < 64
            cur = parent[cur]; guard += 1
          end
          root[k] = cur
        end

        # Phân vùng theo bbox — GIỐNG JS và entry point.
        zone_of = lambda do |bb|
          w = bb[:xmax] - bb[:xmin]; h = bb[:ymax] - bb[:ymin]
          horiz = w > h
          if horiz && bb[:ymax] <= thresh_bot            then :bottom
          elsif horiz && bb[:ymin] >= sheet_h - thresh_top then :top
          else :lr
          end
        end

        # Gom CỘT theo TÂM X: chi tiết có tâm X gần nhau (≤ col_tol) coi CÙNG cột,
        # dùng chung một X đại diện → khi cùng cột sẽ hòa ở 'pos' và phân giải theo Y.
        # Căn theo tâm. Khớp JS tp-dispatch.
        col_tol = 20.0
        col_of  = {}   # root_idx → column id
        col_x   = {}   # column id → X đại diện

        # Khóa sắp CỤM (theo root): nhỏ/lớn + zone + side + pos(cột) + Y giảm dần.
        cluster_key = lambda do |root_idx|
          pb  = bboxes[root_idx]
          pcx = (pb[:xmin] + pb[:xmax]) / 2.0
          pcy = (pb[:ymin] + pb[:ymax]) / 2.0
          pbw = pb[:xmax] - pb[:xmin]; pbh = pb[:ymax] - pb[:ymin]
          p_is_small = ([pbw, pbh].min < small_threshold) ? 0 : 1
          z = zone_of.call(pb)
          zone_rank = z == :bottom ? 0 : (z == :top ? 1 : 2)
          zone_pos  = z == :bottom ? pcy : (z == :top ? -pcy : 0.0)
          side = pcx > sheet_w / 2.0 ? 0 : 1
          # X đại diện của cột (gom theo tâm) thay tâm thật → cùng cột thì hòa ở pos.
          colx = col_x[col_of[root_idx]] || pcx
          pos  = side == 0 ? -colx : colx
          # Vùng TRÁI/PHẢI: cùng cột sắp theo Y GIẢM DẦN liên tục — trên xuống giữa,
          # rồi giữa xuống đáy (dao đi liền mạch, không nhảy vọt). Khớp JS.
          y_sort = z == :lr ? -pcy : 0.0
          [p_is_small, zone_rank, zone_pos, side, pos, 0, y_sort]
        end

        # Gom index theo root
        clusters = Hash.new { |h, k| h[k] = [] }
        (0...n).each { |i| clusters[root[i]] << i }
        roots_list = clusters.keys

        # Tính cột: sắp root theo tâm X, gom liên tiếp cách ≤ col_tol thành 1 cột.
        cx_of = lambda { |r| (bboxes[r][:xmin] + bboxes[r][:xmax]) / 2.0 }
        cid = 0; prev_x = nil
        roots_list.sort_by { |r| cx_of.call(r) }.each do |r|
          x = cx_of.call(r)
          if prev_x.nil? || (x - prev_x).abs > col_tol
            cid += 1; col_x[cid] = x
          end
          col_of[r] = cid; prev_x = x
        end

        # Thứ tự các cụm theo cluster_key (root đại diện)
        roots = roots_list.sort_by { |r| cluster_key.call(r) + [r] }

        # Trong mỗi cụm: depth GIẢM DẦN (sâu nhất trước), cùng depth giữ thứ tự index.
        ordered = []
        roots.each do |r|
          members = clusters[r].sort_by { |i| [-contain[i], i] }
          ordered.concat(members)
        end
        ordered.map { |i| loops[i] }
      end

      # ── Name / sheet helpers ─────────────────────────────────────────────────

      def self.parse_depth(raw)
        s = raw.to_s.strip
        s.match?(/^[Zz][+-]/) ? s.to_f : -s.to_f.abs
      end

      def self.remove_vi_accent(str)
        map = {
          'à'=>'a','á'=>'a','â'=>'a','ã'=>'a','ä'=>'a','å'=>'a',
          'è'=>'e','é'=>'e','ê'=>'e','ë'=>'e',
          'ì'=>'i','í'=>'i','î'=>'i','ï'=>'i',
          'ò'=>'o','ó'=>'o','ô'=>'o','õ'=>'o','ö'=>'o',
          'ù'=>'u','ú'=>'u','û'=>'u','ü'=>'u',
          'ý'=>'y','ÿ'=>'y',
          'À'=>'A','Á'=>'A','Â'=>'A','Ã'=>'A','Ä'=>'A','Å'=>'A',
          'È'=>'E','É'=>'E','Ê'=>'E','Ë'=>'E',
          'Ì'=>'I','Í'=>'I','Î'=>'I','Ï'=>'I',
          'Ò'=>'O','Ó'=>'O','Ô'=>'O','Õ'=>'O','Ö'=>'O',
          'Ù'=>'U','Ú'=>'U','Û'=>'U','Ü'=>'U','Ý'=>'Y',
          'đ'=>'d','Đ'=>'D','ă'=>'a','Ă'=>'A','ơ'=>'o','Ơ'=>'O',
          'ư'=>'u','Ư'=>'U','ả'=>'a','ẻ'=>'e','ẽ'=>'e','ẹ'=>'e',
          'ấ'=>'a','ầ'=>'a','ẩ'=>'a','ẫ'=>'a','ậ'=>'a',
          'ắ'=>'a','ặ'=>'a','ẵ'=>'a','ằ'=>'a','ẳ'=>'a',
          'ế'=>'e','ề'=>'e','ệ'=>'e','ể'=>'e','ễ'=>'e',
          'ố'=>'o','ồ'=>'o','ổ'=>'o','ỗ'=>'o','ộ'=>'o',
          'ớ'=>'o','ờ'=>'o','ở'=>'o','ỡ'=>'o','ợ'=>'o',
          'ứ'=>'u','ừ'=>'u','ử'=>'u','ữ'=>'u','ự'=>'u',
          'ỉ'=>'i','ị'=>'i','ọ'=>'o','ụ'=>'u','ủ'=>'u',
          'ỳ'=>'y','ỵ'=>'y','ỷ'=>'y','ỹ'=>'y',
          # Nguyên âm HOA có dấu phụ (mũ/móc/hỏi/ngã/nặng) — trước đây bị thiếu
          'Ả'=>'A','Ạ'=>'A','Ấ'=>'A','Ầ'=>'A','Ẩ'=>'A','Ẫ'=>'A','Ậ'=>'A',
          'Ắ'=>'A','Ằ'=>'A','Ẳ'=>'A','Ẵ'=>'A','Ặ'=>'A',
          'Ẻ'=>'E','Ẽ'=>'E','Ẹ'=>'E','Ế'=>'E','Ề'=>'E','Ể'=>'E','Ễ'=>'E','Ệ'=>'E',
          'Ỉ'=>'I','Ị'=>'I',
          'Ỏ'=>'O','Ọ'=>'O','Ố'=>'O','Ồ'=>'O','Ổ'=>'O','Ỗ'=>'O','Ộ'=>'O',
          'Ớ'=>'O','Ờ'=>'O','Ở'=>'O','Ỡ'=>'O','Ợ'=>'O',
          'Ủ'=>'U','Ụ'=>'U','Ứ'=>'U','Ừ'=>'U','Ử'=>'U','Ữ'=>'U','Ự'=>'U',
          'Ỳ'=>'Y','Ỵ'=>'Y','Ỷ'=>'Y','Ỹ'=>'Y'
        }
        str = str.to_s
        # Chống lỗi encoding trên .rbe: ép về UTF-8 hợp lệ trước khi xử lý.
        str = str.encode("UTF-8", invalid: :replace, undef: :replace, replace: "") unless str.encoding == Encoding::UTF_8 && str.valid_encoding?
        str = str.scrub("") unless str.valid_encoding?
        begin
          str.chars.map { |c| map[c] || c }.join
        rescue => _e
          # Nếu vẫn lỗi, bỏ mọi ký tự non-ASCII
          str.encode("ASCII", invalid: :replace, undef: :replace, replace: "")
        end
      end

      def self.parse_sheet_name(name)
        # Mẫu chính: "<màu> - <độ dày>mm - sheet-N" — cho phép KHOẢNG TRẮNG quanh
        # dấu gạch phân tách (vd "__AC024MM - 9mm-sheet-1"). \s* ở 2 bên số độ dày.
        m = name.match(/^(.+?)\s*-\s*(\d+(?:\.\d+)?)\s*mm\s*-\s*(sheet-.+)$/i)
        return { color: m[1].strip, thickness: "#{m[2]}mm", side: m[3].strip } if m

        # Mẫu cũ (gạch sát, không space): "<màu>-<độ dày>mm-<side>"
        m = name.match(/^(.+?)-(\d+(?:\.\d+)?mm)-(.+)$/i)
        return { color: m[1].strip, thickness: m[2], side: m[3] } if m

        # Chỉ có độ dày (không màu), có thể kèm tiền tố "_": "__17.5mm-sheet-1"
        m2 = name.match(/^_*(\d+(?:\.\d+)?mm)-(.+)$/i)
        return { color: '', thickness: m2[1], side: m2[2] } if m2

        m3 = name.match(/^(.+?)-(sheet-.+)$/i)
        if m3
          head = m3[1].strip
          # Nếu phần đầu thực ra là độ dày (tấm không đổ màu) → gán vào thickness, color rỗng
          if head.match?(/^_*\d+(?:\.\d+)?\s*mm$/i)
            thk = head.gsub(/^_+/, '').gsub(/\s+/, '')
            return { color: '', thickness: thk, side: m3[2] }
          end
          return { color: head, thickness: '', side: m3[2] }
        end

        # Dạng "<màu> - <số>mm" hoặc "<màu> <số>mm": gạch có thể kèm khoảng trắng,
        # không bắt buộc có phần -sheet-N. Tách màu + độ dày, side để trống.
        m4 = name.match(/^(.+?)\s*-\s*(\d+(?:\.\d+)?)\s*mm\s*(.*)$/i)
        return { color: m4[1].strip, thickness: "#{m4[2]}mm", side: m4[3].strip } if m4

        m5 = name.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*mm\s*(.*)$/i)
        return { color: m5[1].strip, thickness: "#{m5[2]}mm", side: m5[3].strip } if m5

        # Tên CHỈ có độ dày (tấm chưa đổ màu, không có phần sheet-N): vd "17mm", "17.5mm".
        # Nhận là thickness để không bị coi là "vô danh" (chặn xuất). color/side rỗng.
        m6 = name.match(/^_*(\d+(?:\.\d+)?)\s*mm\s*$/i)
        return { color: '', thickness: "#{m6[1]}mm", side: '' } if m6

        { color: '', thickness: '', side: name }
      end

      def self.format_sheet_name(name, idx, stg)
        p         = parse_sheet_name(name)
        color     = stg[:remove_accent] != false ? remove_vi_accent(p[:color]) : p[:color]
        color     = color.strip.gsub(/\s+/, '_')
        color     = color.gsub(/^_+/, '').gsub(/_+$/, '')  # bỏ dấu _ thừa ở đầu/cuối (tiền tố __ của ABF)
        thickness = p[:thickness]
        is_bottom = p[:side].downcase.include?('bottom')
        side      = is_bottom ? (stg[:side_bot] || 'B') : (stg[:side_top] || 'T')
        index     = (idx + 1).to_s.rjust(3, '0')

        map   = { "index"=>index, "color"=>color, "thickness"=>thickness, "side"=>side, "sheetname"=>name }
        parts = (stg[:name_parts] || ["index","color","thickness","side"])
                  .reject { |pt| pt == "none" || (pt == "color" && color.empty?) }
        seps  = stg[:name_seps] || ["_","_","_"]

        result = ''
        parts.each_with_index do |pt, i|
          val = map[pt].to_s
          next if val.empty?
          result += (result.empty? ? '' : seps[[i-1, seps.size-1].min].to_s) + val
        end
        result
      end

      def self.compute_sheet_indices(all_sheets)
        counter = 0; last_base = nil
        all_sheets.map do |sheet|
          base = parse_sheet_name(sheet[:name])[:side].gsub(/-?bottom$/i, '').strip
          counter += 1 if base != last_base
          last_base = base
          counter
        end
      end

      def self.detect_nesting_gap(all_sheets)
        all_sheets.each do |s|
          vecs = s[:vectors].select { |v| v[:layer] == "ABF_CUTTINGLINES" && !v[:is_drill_center] }
          next if vecs.empty?
          loops = build_loops(vecs)
          next if loops.size < 2
          bboxes = loops.map do |lp|
            xs = lp[:edges].flat_map { |e| [e[:x1], e[:x2]] }
            ys = lp[:edges].flat_map { |e| [e[:y1], e[:y2]] }
            { xmin: xs.min, xmax: xs.max, ymin: ys.min, ymax: ys.max }
          end
          gaps = []
          bboxes.combination(2).each do |a, b|
            gap_x = [b[:xmin]-a[:xmax], a[:xmin]-b[:xmax]].max
            gap_y = [b[:ymin]-a[:ymax], a[:ymin]-b[:ymax]].max
            gap   = [gap_x, gap_y].max
            gaps << gap.round(2) if gap > 0 && gap < 50
          end
          return gaps.min if gaps.any?
        end
        nil
      end

      # ── Write Drill ──────────────────────────────────────────────────────────

      def self.write_drill(f, lines, cfg, clear_z)
        state = {}
        # Gom các lỗ khoan duy nhất (khử trùng theo tọa độ)
        seen = {}
        holes = []
        lines.select { |l| l[:is_drill_center] }.each do |l|
          key = "#{l[:x1].round(1)},#{l[:y1].round(1)}"
          next if seen[key]
          seen[key] = true
          holes << { x: l[:x1], y: l[:y1] }
        end
        return if holes.empty?

        # ── TỐI ƯU THỨ TỰ KHOAN: nearest-neighbor ──
        # Không quan tâm lỗ thuộc chi tiết nào — luôn khoan lỗ GẦN NHẤT tiếp theo,
        # giảm quãng đường di chuyển dao. Bắt đầu từ lỗ gần gốc (0,0).
        ordered = optimize_drill_order(holes)

        z_feed = cfg[:z_feed] || 400
        z_levels = cfg[:z_levels]
        # z_levels hợp lệ khi là mảng >=1 mức (mức cuối = đáy). Không có → 1 lượt.
        has_peck = z_levels.is_a?(Array) && z_levels.size > 1
        final_z  = cfg[:depth].to_f

        ordered.each do |h|
          f.puts gcode_line('G0', x: h[:x], y: h[:y], state: state)
          if has_peck
            # PECK: khoan từng mức, mỗi mức nhấc lên safe-Z xả phôi rồi xuống lại.
            prev_z = 0.0
            z_levels.each_with_index do |zl, li|
              zl_f = zl.to_f
              # Xuống nhanh tới gần mức đã khoan trước (chừa 0.5mm), rồi cắt tiếp.
              if li > 0
                approach = [prev_z + 0.5, 0.0].min   # 0.5mm trên đáy lượt trước
                f.puts "G0 Z#{format('%.3f', approach)}"
              end
              f.puts gcode_line('G1', z: zl_f, f: z_feed, state: state)
              f.puts "G0 Z#{format('%.1f', clear_z)}"   # nhấc xả phôi
              state[:z] = clear_z
              prev_z = zl_f
            end
          else
            f.puts gcode_line('G1', z: final_z, f: z_feed, state: state)
            f.puts "G0 Z#{format('%.1f', clear_z)}"
            state[:z] = clear_z
          end
        end
      end

      # Sắp thứ tự lỗ khoan theo nearest-neighbor (tham lam): bắt đầu từ lỗ gần (0,0),
      # mỗi bước chọn lỗ chưa khoan gần vị trí hiện tại nhất.
      def self.optimize_drill_order(holes)
        return holes if holes.size <= 2
        remaining = holes.dup
        result = []
        # điểm bắt đầu: lỗ gần gốc tọa độ nhất
        cur = remaining.min_by { |h| h[:x]**2 + h[:y]**2 }
        remaining.delete(cur)
        result << cur
        until remaining.empty?
          nxt = remaining.min_by { |h| (h[:x] - cur[:x])**2 + (h[:y] - cur[:y])**2 }
          remaining.delete(nxt)
          result << nxt
          cur = nxt
        end
        result
      end

      # Sắp thứ tự các LOOP (pocket) theo nearest-neighbor dựa trên tâm bbox.
      # Gom pocket gần nhau chạy trước, không phân biệt chi tiết. Bắt đầu từ pocket
      # gần gốc (0,0). Island nằm trong cha nên tự nhiên đi cùng cụm.
      def self.order_loops_nearest(loops)
        return loops if loops.size <= 2
        centers = loops.map do |lp|
          xs = lp[:edges].flat_map { |e| [e[:x1], e[:x2]] }
          ys = lp[:edges].flat_map { |e| [e[:y1], e[:y2]] }
          { loop: lp, cx: (xs.min + xs.max) / 2.0, cy: (ys.min + ys.max) / 2.0 }
        end
        remaining = centers.dup
        result = []
        cur = remaining.min_by { |c| c[:cx]**2 + c[:cy]**2 }
        remaining.delete(cur)
        result << cur[:loop]
        until remaining.empty?
          nxt = remaining.min_by { |c| (c[:cx] - cur[:cx])**2 + (c[:cy] - cur[:cy])**2 }
          remaining.delete(nxt)
          result << nxt[:loop]
          cur = nxt
        end
        result
      end

      # ── Dogbone pocket detection & helpers ───────────────────────────────────
      # Phát hiện vector mộng âm dogbone (chữ nhật + tai lồi nhỏ ~HalfD ở góc/đầu cạnh).
      # Trả về hash mô tả thân nếu là dogbone, nil nếu không.
      # Nguyên lý (đã test trên tai tròn + tai vuông + chữ nhật trơn):
      #   - Thân = bbox trừ HalfD mỗi đầu theo trục dài.
      #   - Đo "coverage" 2 dải ngoài thân: tai chỉ phủ 1 phần (0.05..0.9) → dogbone;
      #     chữ nhật trơn phủ kín (~1.0) → không phải.
      def self.detect_dogbone(loop_pts, half_d)
        return nil if loop_pts.nil? || loop_pts.size < 4 || half_d <= 0
        # Khớp JS: dogbone thật có đỉnh lõm ở chỗ tai relief nối với thân.
        # Loại polygon hoàn toàn lồi như chữ nhật bo góc khỏi nhánh dogbone.
        return nil unless is_concave?(loop_pts)
        xs = loop_pts.map { |p| p[:x] }
        ys = loop_pts.map { |p| p[:y] }
        bw = xs.max - xs.min
        bh = ys.max - ys.min
        return nil if bw < half_d * 2 || bh < half_d * 2
        # Hình gần VUÔNG (tai 4 cạnh, đối xứng) → thử cả 2 trục, nhận cái hợp lệ.
        near_square = (bw - bh).abs / [bw, bh].max < 0.05
        if near_square
          try_dogbone_axis(loop_pts, half_d, true) || try_dogbone_axis(loop_pts, half_d, false)
        else
          try_dogbone_axis(loop_pts, half_d, bw >= bh)
        end
      end

      # Xoay 1 điểm quanh tâm theo góc (ca=cos, sa=sin).
      def self.rot_pt(p, cx, cy, ca, sa)
        dx = p[:x] - cx; dy = p[:y] - cy
        { x: cx + dx*ca - dy*sa, y: cy + dx*sa + dy*ca }
      end

      # Phát hiện dogbone NGHIÊNG: xoay hình về thẳng trục (theo cạnh dài nhất) rồi thử
      # detect_dogbone. Trả { rotated:, angle:, cx:, cy: } hoặc nil. Khớp JS.
      def self.detect_dogbone_rotated(loop_pts, half_d)
        return nil if loop_pts.nil? || loop_pts.size < 4
        max_len = 0.0; angle = 0.0
        n = loop_pts.size
        (0...n).each do |i|
          a = loop_pts[i]; b = loop_pts[(i+1) % n]
          d = Math.hypot(b[:x]-a[:x], b[:y]-a[:y])
          if d > max_len; max_len = d; angle = Math.atan2(b[:y]-a[:y], b[:x]-a[:x]); end
        end
        deg = (angle * 180.0 / Math::PI).abs % 90
        return nil if deg < 2 || deg > 88
        cx = loop_pts.sum { |p| p[:x] } / n
        cy = loop_pts.sum { |p| p[:y] } / n
        ca = Math.cos(-angle); sa = Math.sin(-angle)
        rot_pts = loop_pts.map { |p| rot_pt(p, cx, cy, ca, sa) }
        dog = detect_dogbone(rot_pts, half_d)
        return nil unless dog
        { rotated: dog, angle: angle, cx: cx, cy: cy }
      end

      # Thử detect dogbone theo MỘT trục cụ thể (long_is_x = true/false).
      def self.try_dogbone_axis(loop_pts, half_d, long_is_x)
        xs = loop_pts.map { |p| p[:x] }
        ys = loop_pts.map { |p| p[:y] }
        x0, x1, y0, y1 = xs.min, xs.max, ys.min, ys.max

        # Khớp JS: các đỉnh lõm nối tai relief phải nằm gần hai đầu trục dài.
        # Loại các polygon có khấc lớn nằm giữa chi tiết nhưng vô tình đạt coverage.
        signed_area = 0.0
        loop_pts.size.times do |i|
          j = (i + 1) % loop_pts.size
          signed_area += loop_pts[i][:x] * loop_pts[j][:y] - loop_pts[j][:x] * loop_pts[i][:y]
        end
        area_sign = signed_area >= 0 ? 1.0 : -1.0
        reflex_count = 0
        end_tol = [half_d * 3.0, 1.0].max
        loop_pts.size.times do |i|
          a = loop_pts[(i - 1) % loop_pts.size]
          b = loop_pts[i]
          c = loop_pts[(i + 1) % loop_pts.size]
          cross = (b[:x] - a[:x]) * (c[:y] - b[:y]) - (b[:y] - a[:y]) * (c[:x] - b[:x])
          next unless cross * area_sign < -1e-7
          reflex_count += 1
          lc = long_is_x ? b[:x] : b[:y]
          l0, l1 = long_is_x ? [x0, x1] : [y0, y1]
          return nil if [(lc - l0).abs, (l1 - lc).abs].min > end_tol
        end
        return nil if reflex_count < 2

        if long_is_x
          bx0, bx1 = x0 + half_d, x1 - half_d
          left_range  = [x0, bx0]; right_range = [bx1, x1]; short_range = [y0, y1]
        else
          by0, by1 = y0 + half_d, y1 - half_d
          left_range  = [y0, by0]; right_range = [by1, y1]; short_range = [x0, x1]
        end

        cov = lambda do |long_rng, short_rng|
          n_long = 8; n_short = 30; inside = 0; total = 0
          n_long.times do |i|
            lp = long_rng[0] + (long_rng[1] - long_rng[0]) * (i + 0.5) / n_long
            n_short.times do |j|
              sp = short_rng[0] + (short_rng[1] - short_rng[0]) * (j + 0.5) / n_short
              total += 1
              px, py = long_is_x ? [lp, sp] : [sp, lp]
              inside += 1 if point_in_poly?(px, py, loop_pts)
            end
          end
          total > 0 ? inside.to_f / total : 0.0
        end

        cov_left  = cov.call(left_range, short_range)
        cov_right = cov.call(right_range, short_range)
        cov_ok = cov_left < 0.9 && cov_right < 0.9 && cov_left > 0.05 && cov_right > 0.05
        return nil unless cov_ok

        # Loại chữ nhật BO GÓC (fillet): góc bo lõm vào → bao lồi (hull) nhỏ hơn bbox.
        # Dogbone: tai lồi RA lấp đầy góc → hull ≈ bbox (ratio ~1.0).
        hull = convex_hull(loop_pts)
        hull_area = poly_area(hull)
        bbox_area = (x1 - x0) * (y1 - y0)
        ratio = bbox_area > 0 ? hull_area / bbox_area : 0.0
        return nil unless ratio >= 0.98

        # Chốt chặn BO GÓC triệt để: 4 góc hộp bao lùi chéo vào một đoạn nhỏ phải nằm
        # TRONG hình. Góc VUÔNG (dogbone/chữ nhật thật) → điểm lùi nằm trong vật liệu.
        # Góc BO TRÒN → điểm lùi rơi vào vùng đã vát → NGOÀI. Bắt được cả bo bán kính
        # nhỏ-vừa mà ngưỡng hull/bbox ở trên bỏ sót (R15, R20…).
        _inset = [half_d * 0.4, 3.0].min
        _inset = 1.0 if _inset < 1.0
        _corner_solid = [
          [x0, y0, 1, 1], [x1, y0, -1, 1], [x1, y1, -1, -1], [x0, y1, 1, -1]
        ].all? { |cx, cy, sx, sy| point_in_poly?(cx + sx * _inset, cy + sy * _inset, loop_pts) }
        return nil unless _corner_solid

        if long_is_x
          { long_is_x: true,  bx0: x0 + half_d, bx1: x1 - half_d, by0: y0, by1: y1 }
        else
          { long_is_x: false, bx0: x0, bx1: x1, by0: y0 + half_d, by1: y1 - half_d }
        end
      end

      # Bao lồi (convex hull) — Andrew's monotone chain
      def self.convex_hull(pts)
        uniq = pts.map { |p| [p[:x].round(3), p[:y].round(3)] }.uniq.sort
        return uniq if uniq.size < 3
        cross = lambda { |o, a, b| (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]) }
        lower = []
        uniq.each do |p|
          lower.pop while lower.size >= 2 && cross.call(lower[-2], lower[-1], p) <= 0
          lower << p
        end
        upper = []
        uniq.reverse_each do |p|
          upper.pop while upper.size >= 2 && cross.call(upper[-2], upper[-1], p) <= 0
          upper << p
        end
        (lower[0...-1] + upper[0...-1]).map { |c| { x: c[0], y: c[1] } }
      end

      def self.poly_area(poly)
        a = 0.0
        n = poly.size
        n.times do |i|
          j = (i + 1) % n
          a += poly[i][:x] * poly[j][:y] - poly[j][:x] * poly[i][:y]
        end
        a.abs / 2.0
      end

      # ── Offset đa giác LÕM (concave) — cho pocket hình L/U ──
      # Diện tích CÓ DẤU: >0 = CCW, <0 = CW (dùng để xác định hướng normal + phát hiện lật).
      def self.poly_area_signed(pts)
        a = 0.0
        n = pts.size
        n.times do |i|
          j = (i + 1) % n
          a += pts[i][:x] * pts[j][:y] - pts[j][:x] * pts[i][:y]
        end
        a / 2.0
      end

      # Offset polygon vào trong khoảng d. Trả mảng điểm {x,y}, hoặc nil nếu suy biến.
      def self.offset_concave(pts, d)
        n = pts.size
        return nil if n < 3
        ccw = poly_area_signed(pts) > 0
        lines = []
        n.times do |i|
          p1 = pts[i]; p2 = pts[(i + 1) % n]
          dx = p2[:x] - p1[:x]; dy = p2[:y] - p1[:y]; len = Math.sqrt(dx * dx + dy * dy)
          next if len < 1e-9
          # normal vào trong: CCW→(-dy,dx), CW→(dy,-dx)
          nx = ccw ? -dy / len : dy / len
          ny = ccw ?  dx / len : -dx / len
          lines << { x: p1[:x] + nx * d, y: p1[:y] + ny * d, dx: dx, dy: dy }
        end
        m = lines.size
        return nil if m < 3
        intersect = lambda do |l1, l2|
          den = l1[:dx] * l2[:dy] - l1[:dy] * l2[:dx]
          return nil if den.abs < 1e-9
          t = ((l2[:x] - l1[:x]) * l2[:dy] - (l2[:y] - l1[:y]) * l2[:dx]) / den
          { x: l1[:x] + l1[:dx] * t, y: l1[:y] + l1[:dy] * t }
        end
        res = []
        m.times do |k|
          pt = intersect.call(lines[(k - 1 + m) % m], lines[k])
          return nil if pt.nil?
          res << pt
        end
        res
      end

      # Detect hình LÕM: có đỉnh phản (reflex) → tích có hướng đổi dấu giữa các đỉnh.
      def self.is_concave?(pts)
        n = pts.size
        return false if n < 4
        sign = 0
        n.times do |i|
          a = pts[i]; b = pts[(i + 1) % n]; c = pts[(i + 2) % n]
          cross = (b[:x] - a[:x]) * (c[:y] - b[:y]) - (b[:y] - a[:y]) * (c[:x] - b[:x])
          next if cross.abs < 1e-9
          s = cross > 0 ? 1 : -1
          if sign == 0
            sign = s
          elsif s != sign
            return true
          end
        end
        false
      end

      # Detect hình CÓ CẠNH CONG (cung tròn): đếm điểm rẽ nhẹ đều.
      # Ổn định hơn is_concave? (không nhạy sai số làm tròn của cung rời rạc).
      # Khớp hasCurvedEdgesJS ở tp-pocket.js. Hình bo tròn → offset biên thật.
      def self.has_curved_edges?(pts, min_curved = 6)
        n = pts.size
        return false if n < 8
        curved = 0
        n.times do |i|
          a = pts[(i - 1) % n]; b = pts[i]; c = pts[(i + 1) % n]
          v1x = b[:x] - a[:x]; v1y = b[:y] - a[:y]
          v2x = c[:x] - b[:x]; v2y = c[:y] - b[:y]
          l1 = Math.sqrt(v1x * v1x + v1y * v1y)
          l2 = Math.sqrt(v2x * v2x + v2y * v2y)
          next if l1 < 0.01 || l2 < 0.01
          dot = (v1x * v2x + v1y * v2y) / (l1 * l2)
          dot = 1.0 if dot > 1.0
          dot = -1.0 if dot < -1.0
          ang = Math.acos(dot) * 180.0 / Math::PI
          curved += 1 if ang > 1 && ang < 40
        end
        curved >= min_curved
      end

      # ── LÙI ĐIỂM XUỐNG DAO (chống bay ván) ────────────────────────────────
      # pts: vòng KÍN, thứ tự = CHIỀU CẮT, pts[0] = điểm xuống dao hiện tại (chưa lặp
      # điểm cuối). Lùi điểm bắt đầu `d` mm NGƯỢC chiều cắt dọc theo đường dao.
      # Trả về mảng ĐÃ ĐÓNG VÒNG: [S', ...các điểm..., S'].
      # Khớp backoffStartJS ở tp-profile.js.
      # ── Chọn điểm XUỐNG DAO nằm trên ĐOẠN THẲNG, tránh đoạn cong ─────────────
      # Xuống dao giữa cung làm mặt cắt bị gợn (nhịp dừng/đổi hướng lộ rõ trên đường
      # cong). Hàm tìm đoạn thẳng DÀI gần entry nhất rồi trả điểm nằm SÂU trong đoạn.
      # Nhận biết đoạn thẳng bằng ĐỘ DÀI: cung luôn bị chia thành nhiều khúc ngắn,
      # cạnh thẳng là một đoạn dài liền mạch.
      #   pts      : mảng {x,y} của biên dạng đã offset (chưa đóng vòng)
      #   entry    : góc bbox mong muốn {x,y}
      #   min_len  : độ dài tối thiểu để coi là cạnh thẳng
      #   back_d   : lùi vào trong đoạn bao nhiêu mm (0 = lấy trung điểm)
      # Trả { x:, y:, seg: idx } hoặc nil nếu không có đoạn thẳng nào (toàn cung).
      def self.straight_entry_point(pts, entry, min_len, back_d)
        n = pts.size
        return nil if n < 3 || entry.nil?

        segs = (0...n).map do |i|
          a = pts[i]; b = pts[(i + 1) % n]
          Math.sqrt((b[:x] - a[:x])**2 + (b[:y] - a[:y])**2)
        end

        # Đỉnh gần điểm xuống dao (entry) nhất. Nếu CẢ HAI cạnh kề đỉnh này đều đủ
        # dài (≥ min_len) thì đây là GÓC của hai đoạn thẳng — KHÔNG phải đoạn cong,
        # nên xuống dao ngay tại góc là hợp lệ, không cần dời. Chỉ dời khi đỉnh nằm
        # trên đoạn cong (cạnh kề ngắn — chuỗi đoạn nhỏ của cung).
        vi = (0...n).min_by { |i| (pts[i][:x] - entry[:x])**2 + (pts[i][:y] - entry[:y])**2 }
        len_in  = segs[(vi - 1 + n) % n]   # cạnh vào đỉnh vi
        len_out = segs[vi]                 # cạnh ra đỉnh vi
        return nil if len_in >= min_len && len_out >= min_len

        cand = (0...n).select { |i| segs[i] >= min_len }
        return nil if cand.empty?

        # Đoạn thẳng có TRUNG ĐIỂM gần entry nhất
        best = cand.min_by do |i|
          a = pts[i]; b = pts[(i + 1) % n]
          mx = (a[:x] + b[:x]) / 2.0
          my = (a[:y] + b[:y]) / 2.0
          (mx - entry[:x])**2 + (my - entry[:y])**2
        end

        a   = pts[best]
        b   = pts[(best + 1) % n]
        len = segs[best]

        # Lùi vào trong đoạn, tính từ đầu GẦN entry hơn. Đoạn không đủ dài để lùi
        # (lùi sẽ chạm cung ở đầu kia) → lấy TRUNG ĐIỂM: xa cả hai cung nhất.
        da = (a[:x] - entry[:x])**2 + (a[:y] - entry[:y])**2
        db = (b[:x] - entry[:x])**2 + (b[:y] - entry[:y])**2
        t =
          if back_d <= 0 || len <= back_d * 2.0
            0.5
          elsif da <= db
            back_d / len
          else
            1.0 - back_d / len
          end

        { x: a[:x] + (b[:x] - a[:x]) * t,
          y: a[:y] + (b[:y] - a[:y]) * t,
          seg: best }
      end

      # Change to :legacy to restore the previous entry-corner algorithm.
      ENTRY_POINT_ENGINE = :long_final_edge unless const_defined?(:ENTRY_POINT_ENGINE)

      # For a clear rectangle, choose the corner nearest to the requested entry
      # among corners whose incoming (last-cut) edge is longest. pts is already
      # normalized to the effective cutting direction.
      def self.prefer_long_final_entry(edges, pts, entry, enabled=true)
        return entry if !enabled || ENTRY_POINT_ENGINE == :legacy || entry.nil? || pts.size < 4 || edges.size < 4
        xs = edges.flat_map { |e| [e[:x1], e[:x2]] }
        ys = edges.flat_map { |e| [e[:y1], e[:y2]] }
        xmin, xmax = xs.min, xs.max
        ymin, ymax = ys.min, ys.max
        w = xmax - xmin
        h = ymax - ymin
        return entry if w < 0.01 || h < 0.01 || [w, h].max / [w, h].min < 1.15

        verts = edges.map { |e| { x:e[:x1], y:e[:y1] } }
        area2 = 0.0
        verts.each_with_index do |p, i|
          q = verts[(i + 1) % verts.size]
          area2 += p[:x] * q[:y] - q[:x] * p[:y]
        end
        return entry if area2.abs * 0.5 < w * h * 0.995

        corners = [{x:xmin,y:ymax}, {x:xmax,y:ymax},
                   {x:xmax,y:ymin}, {x:xmin,y:ymin}]
        choices = corners.map do |c|
          ci = (0...pts.size).min_by { |i| (pts[i][:x]-c[:x])**2 + (pts[i][:y]-c[:y])**2 }
          prev = pts[(ci - 1 + pts.size) % pts.size]
          incoming = Math.hypot(pts[ci][:x]-prev[:x], pts[ci][:y]-prev[:y])
          target = (c[:x]-entry[:x])**2 + (c[:y]-entry[:y])**2
          { pt:pts[ci], incoming:incoming, target:target }
        end
        max_incoming = choices.map { |v| v[:incoming] }.max
        best = choices.select { |v| (v[:incoming]-max_incoming).abs <= 0.01 }
                      .min_by { |v| v[:target] }
        best ? { x:best[:pt][:x], y:best[:pt][:y] } : entry
      end

      def self.backoff_start(pts, d)
        n = pts.size
        return pts + [pts[0]] if n < 3 || d <= 0

        peri = 0.0
        n.times do |i|
          a = pts[i]; b = pts[(i + 1) % n]
          peri += Math.sqrt((b[:x]-a[:x])**2 + (b[:y]-a[:y])**2)
        end
        return pts + [pts[0]] if peri <= 0.001
        d = [d, peri * 0.4].min   # kẹp an toàn: không lùi quá 40% chu vi

        # Đi NGƯỢC từ pts[0]: bắt đầu ở đoạn (pts[n-1] → pts[0])
        rem = d
        k   = n - 1
        sp  = nil
        n.times do
          a = pts[k]; b = pts[(k + 1) % n]
          seg = Math.sqrt((b[:x]-a[:x])**2 + (b[:y]-a[:y])**2)
          if seg > 1e-9 && seg >= rem
            # S' nằm trên đoạn a→b, cách b đúng `rem`
            t = (seg - rem) / seg
            sp = { x: a[:x] + (b[:x]-a[:x]) * t, y: a[:y] + (b[:y]-a[:y]) * t }
            break
          end
          rem -= seg
          k = (k - 1) % n
        end
        return pts + [pts[0]] unless sp

        # Thứ tự mới: S' → pts[k+1] → ... → pts[k] → S'
        seq = [sp]
        idx = (k + 1) % n
        n.times do
          seq << pts[idx]
          idx = (idx + 1) % n
        end
        seq << sp
        seq
      end

      # Đi TIẾP `r` mm dọc theo seq kể từ seq[0] → mảng điểm CẮT CHỒNG thêm.
      # Dùng để cắt lố 1 bán kính dao, tránh để lại gờ nối (witness mark).
      # Khớp overlapPointsJS ở tp-profile.js.
      def self.overlap_points(seq, r)
        return [] if r <= 0 || seq.size < 2
        out = []
        rem = r
        (0...(seq.size - 1)).each do |i|
          a = seq[i]; b = seq[i + 1]
          seg = Math.sqrt((b[:x]-a[:x])**2 + (b[:y]-a[:y])**2)
          next if seg < 1e-9
          if seg >= rem
            t = rem / seg
            out << { x: a[:x] + (b[:x]-a[:x]) * t, y: a[:y] + (b[:y]-a[:y]) * t }
            return out
          end
          out << b
          rem -= seg
        end
        out
      end

      # ── Contour-parallel pocket (port từ JS pocketContourRings) ────────────────
      # Diện tích có dấu của mảng điểm.
      def self.poly_signed_area(pts)
        a = 0.0; n = pts.size
        (0...n).each { |i| p = pts[i]; q = pts[(i+1) % n]; a += (p[:x]*q[:y] - q[:x]*p[:y]) }
        a / 2.0
      end

      # Khoảng cách điểm → đoạn thẳng.
      def self.dist_point_seg(px, py, ax, ay, bx, by)
        dx = bx-ax; dy = by-ay; l2 = dx*dx + dy*dy
        return Math.hypot(px-ax, py-ay) if l2 < 1e-12
        t = ((px-ax)*dx + (py-ay)*dy) / l2
        t = 0.0 if t < 0; t = 1.0 if t > 1
        cx = ax + t*dx; cy = ay + t*dy
        Math.hypot(px-cx, py-cy)
      end

      # Khoảng cách nhỏ nhất từ điểm tới biên polygon (mọi cạnh).
      def self.min_dist_to_poly(px, py, verts)
        n = verts.size; best = Float::INFINITY
        (0...n).each do |i|
          a = verts[i]; b = verts[(i+1) % n]
          d = dist_point_seg(px, py, a[:x], a[:y], b[:x], b[:y])
          best = d if d < best
        end
        best
      end

      def self.polygon_self_intersects?(pts)
        return false if pts.nil? || pts.size < 4
        orient = lambda { |a,b,c| (b[:x]-a[:x])*(c[:y]-a[:y]) - (b[:y]-a[:y])*(c[:x]-a[:x]) }
        on_seg = lambda do |a,b,p|
          p[:x] >= [a[:x],b[:x]].min-1e-7 && p[:x] <= [a[:x],b[:x]].max+1e-7 &&
            p[:y] >= [a[:y],b[:y]].min-1e-7 && p[:y] <= [a[:y],b[:y]].max+1e-7
        end
        hit = lambda do |a,b,c,d|
          o1=orient.call(a,b,c); o2=orient.call(a,b,d); o3=orient.call(c,d,a); o4=orient.call(c,d,b)
          proper=((o1>1e-7&&o2<-1e-7)||(o1<-1e-7&&o2>1e-7)) && ((o3>1e-7&&o4<-1e-7)||(o3<-1e-7&&o4>1e-7))
          proper || (o1.abs<=1e-7&&on_seg.call(a,b,c)) || (o2.abs<=1e-7&&on_seg.call(a,b,d)) ||
            (o3.abs<=1e-7&&on_seg.call(c,d,a)) || (o4.abs<=1e-7&&on_seg.call(c,d,b))
        end
        n=pts.size
        (0...n).each do |i|
          (i+1...n).each do |j|
            next if j==i+1 || (i==0 && j==n-1)
            return true if hit.call(pts[i],pts[(i+1)%n],pts[j],pts[(j+1)%n])
          end
        end
        false
      end

      # Tìm vòng offset lớn nhất còn hợp lệ trong (lo,hi] — cho dải hẹp. Hợp lệ =
      # winding đúng + area không phình + mọi điểm trong biên + cách biên >= min_clear.
      # Trả { ring:, off: } hoặc nil.
      def self.largest_valid_offset_ring(loop_edges, lo, hi, base_sign, prev_abs, base_verts, min_clear)
        best = nil; best_off = nil
        a = lo; b = hi
        10.times do
          mid = (a + b) / 2.0
          r = offset_polygon_miter(loop_edges, mid)
          ok = false
          if r && r.size >= 3
            sa = poly_signed_area(r); abs_a = sa.abs
            ok = (sa != 0) && ((sa > 0 ? 1 : -1) == base_sign) && (abs_a <= prev_abs + 1)
            if ok && base_verts
              r.each do |pt|
                unless point_in_poly?(pt[:x], pt[:y], base_verts)
                  ok = false; break
                end
                if min_clear && min_dist_to_poly(pt[:x], pt[:y], base_verts) < min_clear - 0.05
                  ok = false; break
                end
              end
            end
          end
          if ok; best = r; best_off = mid; a = mid; else; b = mid; end
        end
        best ? { ring: best, off: best_off } : nil
      end

      # Nhận diện CUNG để nội suy G02/G03 trên chuỗi điểm HỞ (đường cắt). Cung = chuỗi
      # điểm liên tiếp cùng tâm cong, bán kính >= min_r. Loại điểm biên chuyển tiếp
      # (thẳng→cong) có tâm giả bằng cách gom circumcenter ổn định. Trả [{s,e,cx,cy,r}].
      def self.fit_circle_gcode(points)
        return nil if points.nil? || points.size < 3
        sx=sy=sxx=syy=sxy=sz=sxz=syz=0.0
        points.each do |p|
          x=p[:x].to_f; y=p[:y].to_f; z=x*x+y*y
          sx+=x; sy+=y; sxx+=x*x; syy+=y*y; sxy+=x*y
          sz+=z; sxz+=x*z; syz+=y*z
        end
        n=points.size.to_f
        a=[[sxx,sxy,sx],[sxy,syy,sy],[sx,sy,n]]
        b=[-sxz,-syz,-sz]
        det = lambda do |m|
          m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) -
          m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) +
          m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0])
        end
        d=det.call(a); return nil if d.abs < 1e-9
        vals=3.times.map do |col|
          m=a.map(&:dup); 3.times { |row| m[row][col]=b[row] }
          det.call(m)/d
        end
        cx=-vals[0]/2.0; cy=-vals[1]/2.0
        r2=cx*cx+cy*cy-vals[2]; return nil if r2 <= 0.0
        r=Math.sqrt(r2)
        errors=points.map { |p| (Math.hypot(p[:x]-cx,p[:y]-cy)-r).abs }
        { cx:cx, cy:cy, r:r, max_error:errors.max, rms:Math.sqrt(errors.sum { |e| e*e }/errors.size) }
      end

      # Chia chuỗi theo dấu/độ lớn độ cong cục bộ, rồi fit đường tròn bằng TOÀN BỘ
      # điểm của mỗi nhóm. Hữu ích khi nhiều cung tiếp tuyến nối tiếp nhau.
      def self.detect_arcs_by_curvature(pts, min_r)
        n=pts.size; return [] if n < ARC_MIN_SEGMENTS + 1
        local=Array.new(n)
        (1...n-1).each do |i|
          a=pts[i-1]; b=pts[i]; c=pts[i+1]
          cross=(b[:x]-a[:x])*(c[:y]-b[:y])-(b[:y]-a[:y])*(c[:x]-b[:x])
          cc=arc_circumcenter(a,b,c)
          local[i]={ sign:(cross>0 ? 1 : -1), r:cc[:r], cx:cc[:x], cy:cc[:y] } if cc && cross.abs>1e-6 && cc[:r]>=min_r
        end
        out=[]; i=1
        while i<n-1
          unless local[i]; i+=1; next; end
          base=local[i]; j=i
          while j+1<n-1 && (q=local[j+1]) && q[:sign]==base[:sign] &&
                (q[:r]-base[:r]).abs <= [base[:r]*0.08,1.0].max &&
                Math.hypot(q[:cx]-base[:cx],q[:cy]-base[:cy]) <= [base[:r]*0.08,1.0].max
            j+=1
          end
          s=i-1; e=j+1
          tol=[0.10,base[:r]*0.0005].max
          # Khôi phục tối đa một segment biên nếu điểm thêm vẫn cùng đường tròn.
          if s>0
            f=fit_circle_gcode(pts[(s-1)..e]); s-=1 if f && f[:max_error]<=tol
          end
          if e<n-1
            f=fit_circle_gcode(pts[s..(e+1)]); e+=1 if f && f[:max_error]<=tol
          end
          fit=fit_circle_gcode(pts[s..e])
          if fit && fit[:r]>=min_r && fit[:max_error]<=tol && (e-s)>=ARC_MIN_SEGMENTS
            out << {s:s,e:e,cx:fit[:cx],cy:fit[:cy],r:fit[:r],fit_error:fit[:max_error]}
          end
          i=j+1
        end
        out
      end

      def self.detect_arcs_gcode(pts, min_r)
        n = pts.size
        return [] if n < 5
        cc = (0...n).map { |i| (i == 0 || i == n - 1) ? nil : arc_circumcenter(pts[i-1], pts[i], pts[i+1]) }
        candidates = []; i = 1
        while i < n - 1
          if cc[i].nil? || cc[i][:r] < min_r
            i += 1; next
          end
          c0 = cc[i]; j = i
          while j + 1 < n - 1 && cc[j+1] && cc[j+1][:r] >= min_r &&
                Math.hypot(cc[j+1][:x]-c0[:x], cc[j+1][:y]-c0[:y]) <= [c0[:r]*0.05, 1.0].max &&
                (cc[j+1][:r]-c0[:r]).abs <= [c0[:r]*0.05, 1.0].max
            j += 1
          end
          if (j - i) >= 1
            _s = i - 1; _e = j + 1
            # Loại cung GIẢ gần thẳng: điểm giữa phải võng khỏi dây >= 1mm.
            _mid = pts[(_s + _e) / 2]
            _dx = pts[_e][:x] - pts[_s][:x]; _dy = pts[_e][:y] - pts[_s][:y]
            _len = Math.hypot(_dx, _dy)
            _sag = _len > 1e-6 ? ((_mid[:x]-pts[_s][:x])*_dy - (_mid[:y]-pts[_s][:y])*_dx).abs / _len : 0.0
            # Loại cung GIẢ chứa đoạn thẳng dài (vd đỉnh phẳng nối 2 cung): các chord
            # của cung thật xấp xỉ đều nhau; nếu chord dài nhất > 3× ngắn nhất → không
            # phải một cung liền.
            _chords = (_s..._e-1).map { |k| Math.hypot(pts[k+1][:x]-pts[k][:x], pts[k+1][:y]-pts[k][:y]) }
            _even = _chords.min > 1e-6 && (_chords.max <= _chords.min * 3.0)
            if _sag >= 1.0 && _even
              candidates << { s: _s, e: _e, cx: c0[:x], cy: c0[:y], r: c0[:r] }
            end
          end
          i = j + 1
        end
        # Ưu tiên nhóm đã phân đoạn theo độ cong + fit toàn bộ điểm. Chỉ thay các
        # candidate cũ thực sự chồng lấn để không ảnh hưởng những cung khác.
        detect_arcs_by_curvature(pts, min_r).each do |fit|
          candidates.reject! { |a| a[:s] < fit[:e] && fit[:s] < a[:e] }
          candidates << fit
        end
        candidates.sort_by! { |a| a[:s] }
        closed = Math.hypot(pts[-1][:x]-pts[0][:x], pts[-1][:y]-pts[0][:y]) < 1.0
        wrap_pair = nil
        if closed && candidates.size >= 2
          first = candidates.first
          last  = candidates.last
          # Tại điểm bắt đầu Ramp, circumcenter của bộ ba sát ranh giới có thể sai
          # nên detector bỏ tối đa 1 segment ở mỗi phía. Cho phép ghép lại CHỈ khi
          # hai nhóm kề ranh giới cùng một đường tròn và điểm biên thật sự nằm trên
          # đường tròn trong đúng dung sai hình học đang dùng.
          near_boundary = first[:s] <= 1 && last[:e] >= n - 2
          same_circle = near_boundary &&
                        Math.hypot(first[:cx]-last[:cx], first[:cy]-last[:cy]) <= [first[:r]*0.05, 1.0].max &&
                        (first[:r]-last[:r]).abs <= [first[:r]*0.05, 1.0].max
          # Điểm đầu do backoff/Ramp chèn có thể nằm trên DÂY CUNG chứ không nằm
          # đúng trên đường tròn. Chỉ dùng nó để xác nhận cầu nối giữa hai nhóm;
          # tuyệt đối không mở rộng G02/G03 tới điểm này (sai bán kính → controller
          # có thể biến cung lỗi thành đường chéo).
          ba = pts[last[:e]]; bb = pts[first[:s]]; bp = pts[0]
          bdx = bb[:x] - ba[:x]; bdy = bb[:y] - ba[:y]
          bl2 = bdx*bdx + bdy*bdy
          bt = bl2 > 1e-9 ? (((bp[:x]-ba[:x])*bdx + (bp[:y]-ba[:y])*bdy) / bl2) : 0.0
          bt = [[bt, 0.0].max, 1.0].min
          bridge_error = Math.hypot(bp[:x]-(ba[:x]+bdx*bt), bp[:y]-(ba[:y]+bdy*bt))
          wrapped_segments = (first[:e]-first[:s]) + (last[:e]-last[:s]) + 1
          # Nếu hai nhóm gần như phủ toàn bộ vòng kín thì đây là đường tròn, không
          # phải hai cung hở: bắt buộc đủ 24 segment.
          wraps_full_circle = wrapped_segments >= (n - 2)
          wrap_min_segments = wraps_full_circle ? FULL_CIRCLE_MIN_SEGMENTS : ARC_MIN_SEGMENTS
          if same_circle && bridge_error <= 1.0 && wrapped_segments >= wrap_min_segments
            wrap_pair = [first, last]
            wrap_pair.each { |a| a[:wrap] = true }
          end
        end

        candidates.select do |a|
          segment_count = a[:e] - a[:s]
          full_circle = Math.hypot(pts[a[:e]][:x]-pts[a[:s]][:x],
                                   pts[a[:e]][:y]-pts[a[:s]][:y]) < 1.0
          segment_count >= (full_circle ? FULL_CIRCLE_MIN_SEGMENTS : ARC_MIN_SEGMENTS) ||
            (wrap_pair && (a.equal?(wrap_pair[0]) || a.equal?(wrap_pair[1])))
        end
      end

      # Chiều cung: 'G03' (CCW) nếu đi ngược kim đồng hồ quanh tâm, else 'G02' (CW).
      def self.arc_dir_gcode(pts, arc)
        a = pts[arc[:s]]; b = pts[arc[:s] + 1]
        rx = a[:x] - arc[:cx]; ry = a[:y] - arc[:cy]
        vx = b[:x] - a[:x];    vy = b[:y] - a[:y]
        (rx * vy - ry * vx) > 0 ? 'G03' : 'G02'
      end

      # Chiếu tâm nhận diện lên đường trung trực của dây nối hai đầu cung.
      # Giữ tâm gần nhất với kết quả fit ban đầu nhưng buộc R_start == R_end,
      # tránh controller loại cung xấp xỉ và chạy thành đường thẳng.
      def self.equalize_arc_center(start_pt, end_pt, cx, cy)
        dx = end_pt[:x] - start_pt[:x]; dy = end_pt[:y] - start_pt[:y]
        len = Math.hypot(dx, dy)
        return { x: cx, y: cy } if len < 1e-9
        mx = (start_pt[:x] + end_pt[:x]) / 2.0
        my = (start_pt[:y] + end_pt[:y]) / 2.0
        nx = -dy / len; ny = dx / len
        t = (cx - mx) * nx + (cy - my) * ny
        { x: mx + nx * t, y: my + ny * t }
      end

      # Xuất full circle thành 4 cung 90 độ, luôn có X/Y/I/J. Tương thích tốt hơn
      # một lệnh G02/G03 chỉ có I/J trên các controller không nhận full-circle đơn.
      def self.emit_full_circle_quadrants(f, cx, cy, start_x, start_y, feed, cw: true, state: nil)
        rx = start_x.to_f - cx.to_f; ry = start_y.to_f - cy.to_f
        return false if Math.hypot(rx, ry) < 1e-9
        cmd = cw ? 'G02' : 'G03'
        4.times do
          nrx, nry = cw ? [ry, -rx] : [-ry, rx]
          ex = cx.to_f + nrx; ey = cy.to_f + nry
          f.puts "#{cmd} X#{format('%.3f',ex)} Y#{format('%.3f',ey)} " \
                 "I#{format('%.3f',-rx)} J#{format('%.3f',-ry)} F#{feed}"
          rx = nrx; ry = nry
        end
        if state
          state[:x] = start_x.to_f; state[:y] = start_y.to_f; state[:f] = feed
        end
        true
      end


      # bất kỳ hướng nào. Trả mảng các vòng (mỗi vòng = mảng điểm {x,y} đã khép).
      # Tâm đường tròn qua 3 điểm dạng {x,y}. Trả {x,y,r} hoặc nil (thẳng hàng).
      def self.arc_circumcenter(a, b, c)
        ax=a[:x]; ay=a[:y]; bx=b[:x]; by=b[:y]; cx=c[:x]; cy=c[:y]
        d = 2.0*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by))
        return nil if d.abs < 1e-9
        ux=((ax*ax+ay*ay)*(by-cy)+(bx*bx+by*by)*(cy-ay)+(cx*cx+cy*cy)*(ay-by))/d
        uy=((ax*ax+ay*ay)*(cx-bx)+(bx*bx+by*by)*(ax-cx)+(cx*cx+cy*cy)*(bx-ax))/d
        { x: ux, y: uy, r: Math.hypot(ax-ux, ay-uy) }
      end

      # Nhận diện CUNG LỒI (bo góc, tâm nằm TRONG hình) trong đa giác verts. Cung lõm
      # (tâm ngoài) bỏ qua vì offset vào KHÔNG lật. Trả mảng { idx:[...], r: }.
      def self.detect_convex_arcs(verts)
        n = verts.size
        arcs = []
        return arcs if n < 6
        cc = (0...n).map { |i| arc_circumcenter(verts[(i-1)%n], verts[i], verts[(i+1)%n]) }
        used = Array.new(n, false)
        (0...n).each do |i|
          next if used[i] || cc[i].nil?
          c0 = cc[i]; grp = [i]; j = (i+1)%n; guard = 0
          while guard < n
            guard += 1
            break if cc[j].nil?
            if Math.hypot(cc[j][:x]-c0[:x], cc[j][:y]-c0[:y]) < [1.0, c0[:r]*0.1].max &&
               (cc[j][:r]-c0[:r]).abs < [0.5, c0[:r]*0.1].max
              grp << j; used[j] = true; j = (j+1)%n
            else
              break
            end
          end
          if grp.size >= 3 && point_in_poly?(c0[:x], c0[:y], verts)
            arcs << { idx: grp, r: c0[:r] }
          end
        end
        arcs
      end

      def self.line_int(a1, a2, b1, b2)
        d1x=a2[:x]-a1[:x]; d1y=a2[:y]-a1[:y]; d2x=b2[:x]-b1[:x]; d2y=b2[:y]-b1[:y]
        den = d1x*d2y - d1y*d2x
        return nil if den.abs < 1e-9
        t = ((b1[:x]-a1[:x])*d2y - (b1[:y]-a1[:y])*d2x)/den
        { x: a1[:x]+t*d1x, y: a1[:y]+t*d1y }
      end

      # Với offset 'off': cung r<=off (offset vượt bán kính → sẽ lật) thay bằng ĐỈNH
      # GÓC (giao 2 cạnh thẳng kề) → góc vuông thay vì cung lật. Bỏ điểm thẳng hàng.
      def self.collapse_arcs_for_offset(verts, arcs, off)
        n = verts.size
        remove = Array.new(n, false); replace = {}
        arcs.each do |arc|
          next if off < arc[:r] - 1e-6
          s = arc[:idx].first; e = arc[:idx].last
          corner = line_int(verts[(s-2)%n], verts[(s-1)%n], verts[(e+1)%n], verts[(e+2)%n])
          arc[:idx].each { |k| remove[k] = true }
          replace[s] = corner if corner
        end
        out = []
        (0...n).each do |i|
          out << replace[i] if replace[i]
          out << verts[i] unless remove[i]
        end
        if out.size >= 3
          cleaned = []; m = out.size
          (0...m).each do |c|
            pr = out[(c-1)%m]; cu = out[c]; nx = out[(c+1)%m]
            cr = (cu[:x]-pr[:x])*(nx[:y]-pr[:y]) - (cu[:y]-pr[:y])*(nx[:x]-pr[:x])
            cleaned << cu if cr.abs > 1e-6
          end
          return cleaned if cleaned.size >= 3
        end
        out
      end

      def self.verts_to_edges(v)
        n = v.size
        (0...n).map { |k| b = v[(k+1)%n]; { x1: v[k][:x], y1: v[k][:y], x2: b[:x], y2: b[:y] } }
      end

      # Mẫu 20 cạnh có 4 tai, mỗi tai chiếm 3 điểm giữa hai cạnh lõi.
      def self.collapse_pocket_ears(loop_edges)
        return nil unless loop_edges && loop_edges.size == 20
        horizontal = loop_edges.select do |e|
          (e[:y2] - e[:y1]).abs < 0.01 && (e[:x2] - e[:x1]).abs > 20
        end
        vertical = loop_edges.select do |e|
          (e[:x2] - e[:x1]).abs < 0.01 && (e[:y2] - e[:y1]).abs > 10
        end
        return nil if horizontal.size < 2 || vertical.size < 2
        min_x = vertical.map { |e| (e[:x1] + e[:x2]) / 2.0 }.min
        max_x = vertical.map { |e| (e[:x1] + e[:x2]) / 2.0 }.max
        min_y = horizontal.map { |e| (e[:y1] + e[:y2]) / 2.0 }.min
        max_y = horizontal.map { |e| (e[:y1] + e[:y2]) / 2.0 }.max
        area = loop_edges.sum { |e| e[:x1] * e[:y2] - e[:x2] * e[:y1] }
        verts = area < 0 ?
          [{ x: max_x, y: min_y }, { x: min_x, y: min_y },
           { x: min_x, y: max_y }, { x: max_x, y: max_y }] :
          [{ x: min_x, y: min_y }, { x: max_x, y: min_y },
           { x: max_x, y: max_y }, { x: min_x, y: max_y }]
        verts_to_edges(verts)
      end

      def self.pocket_contour_rings(loop_edges, half_d, stepover, max_rings = 500, collapse_ears = false)
        rings = []
        return rings if loop_edges.nil? || loop_edges.size < 3
        # Bỏ cạnh dài 0 (điểm trùng khép kín) — tránh min_dist trả 0 sai.
        work = loop_edges.select { |e| Math.hypot(e[:x2]-e[:x1], e[:y2]-e[:y1]) > 1e-6 }
        work = loop_edges if work.size < 3
        base_verts = work.map { |e| { x: e[:x1], y: e[:y1] } }
        if base_verts.size > 3
          f = base_verts.first; l = base_verts.last
          base_verts.pop if Math.hypot(l[:x]-f[:x], l[:y]-f[:y]) < 1e-6
        end
        base_area = poly_signed_area(base_verts)
        return rings if base_area.abs < 1e-6
        base_sign = base_area > 0 ? 1 : -1
        base_abs = base_area.abs

        # Nhận diện cung LỒI 1 lần; mỗi vòng offset vượt bán kính cung → collapse góc.
        arcs = detect_convex_arcs(base_verts)
        collapsed_work = collapse_ears ? collapse_pocket_ears(work) : nil

        off = half_d
        prev_abs = base_abs
        last_good_off = nil
        p = 0
        while p < max_rings
          source_work = collapsed_work && off > half_d + 1e-6 ? collapsed_work : work
          work_eff = source_work.equal?(work) && !arcs.empty? ?
                     verts_to_edges(collapse_arcs_for_offset(base_verts, arcs, off)) : source_work
          r = offset_polygon_miter(work_eff, off, true, false)
          break if r.nil? || r.size < 3
          sa = poly_signed_area(r); abs_a = sa.abs
          flipped = (sa == 0) || ((sa > 0 ? 1 : -1) != base_sign)
          grew = abs_a > prev_abs + 1e-6
          self_crossed = polygon_self_intersects?(r)
          has_outside = r.any? { |pt| !point_in_poly?(pt[:x], pt[:y], base_verts) }
          # Tâm dao phải cách biên ÍT NHẤT bán kính dao. Chỉ kiểm "nằm trong đa giác"
          # là chưa đủ: hình nhỏ hơn dao vẫn cho vòng nằm trong nhưng sát biên, dao sẽ
          # cắt lẹm ra ngoài (vd ô 4x4 với dao D6 → vòng cách biên 1mm, lẹm 2mm).
          too_close = r.any? { |pt| min_dist_to_poly(pt[:x], pt[:y], base_verts) < half_d - 0.05 }
          if flipped || grew || self_crossed || has_outside || too_close
            if !last_good_off.nil? && (off - last_good_off) > stepover*0.5 + 1e-6
              mid = largest_valid_offset_ring(work, last_good_off, off, base_sign, prev_abs, base_verts, half_d)
              # Khớp JS: sau khi vùng lõm tách topology, dù delta offset nhỏ
              # contour cuối vẫn có thể là đường tâm cần thiết để vét kín.
              if mid && mid[:ring] && (mid[:off] - last_good_off) >= 0.25
                ring = mid[:ring].dup
                ring << { x: mid[:ring][0][:x], y: mid[:ring][0][:y] }
                rings << ring
              end
            end
            break
          end
          # Dừng khi vòng suy biến về 0. KHÔNG dùng ngưỡng theo % diện tích gốc:
          # ngưỡng đó cắt sớm mấy vòng trong cùng nên tâm hốc bị sót vật liệu
          # (hốc vuông 50x50 dao D6 sót ~5.6mm ở giữa). too_close/has_outside ở trên
          # đã đủ chặn vòng vượt biên.
          break if abs_a < 1e-6
          ring = r.dup
          ring << { x: r[0][:x], y: r[0][:y] }
          rings << ring
          prev_abs = abs_a
          last_good_off = off
          off += stepover
          p += 1
        end
        rings
      end
      def self.all_inside?(off_pts, orig_pts)
        off_pts.all? { |p| point_in_poly?(p[:x], p[:y], orig_pts) }
      end

      # Nối các edge thành polygon khép kín đúng thứ tự (theo endpoint matching).
      # Cần cho point_in_poly hoạt động đúng — thứ tự edge thô không liền mạch.
      def self.order_loop_points(edges, tol = 0.05)
        return [] if edges.nil? || edges.empty?
        used = Array.new(edges.size, false)
        loop = [{ x: edges[0][:x1], y: edges[0][:y1] }, { x: edges[0][:x2], y: edges[0][:y2] }]
        used[0] = true
        (edges.size * 3).times do
          cx = loop.last[:x]; cy = loop.last[:y]
          found = false
          edges.each_with_index do |e, i|
            next if used[i]
            if (e[:x1] - cx).abs < tol && (e[:y1] - cy).abs < tol
              loop << { x: e[:x2], y: e[:y2] }; used[i] = true; found = true; break
            elsif (e[:x2] - cx).abs < tol && (e[:y2] - cy).abs < tol
              loop << { x: e[:x1], y: e[:y1] }; used[i] = true; found = true; break
            end
          end
          break unless found
        end
        # bỏ điểm trùng liên tiếp
        clean = [loop.first]
        loop[1..].each do |p|
          if (p[:x] - clean.last[:x]).abs > tol || (p[:y] - clean.last[:y]).abs > tol
            clean << p
          end
        end
        # Bỏ điểm CUỐI nếu trùng điểm ĐẦU (vòng khép kín bị lặp điểm đóng vòng).
        # Không bỏ thì đa giác có 2 điểm chồng nhau, và mọi phép duyệt theo bộ ba đỉnh
        # (is_concave?, has_curved_edges?...) sẽ tính ra tích có hướng = 0 tại ĐÚNG
        # đỉnh đầu tiên — đỉnh đó coi như biến mất. Chữ L có góc lõm nằm ngay đỉnh đầu
        # vì thế bị nhận nhầm là hình lồi và rơi xuống nhánh bbox (phay lẹm ra ngoài).
        if clean.size > 2 &&
           (clean.first[:x] - clean.last[:x]).abs <= tol &&
           (clean.first[:y] - clean.last[:y]).abs <= tol
          clean.pop
        end
        clean
      end

      def self.point_in_poly?(x, y, poly)
        n = poly.size; inside = false; j = n - 1
        n.times do |i|
          xi = poly[i][:x]; yi = poly[i][:y]
          xj = poly[j][:x]; yj = poly[j][:y]
          if ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)
            inside = !inside
          end
          j = i
        end
        inside
      end

      # Vét sạch vành khăn giữa biên NGOÀI và ISLAND (contour-parallel, tổng quát).
      # Port từ JS islandClearingRuns. island_edges, outer_edges: mảng {x1,y1,x2,y2}.
      # Offset ISLAND ra ngoài từng vòng theo BIÊN DẠNG THẬT, cắt lấy phần hợp lệ (tâm
      # dao trong biên ngoài VÀ cách biên ngoài >= half_d). Trả [{closed:bool, pts:[{x,y}]}].
      def self.island_clearing_runs(island_edges, outer_edges, half_d, stepover, max_rings = 500)
        runs = []
        return runs if island_edges.size < 3 || outer_edges.size < 3
        outer_verts = outer_edges.map { |e| { x: e[:x1], y: e[:y1] } }
        valid = lambda do |pt|
          return false unless point_in_poly?(pt[:x], pt[:y], outer_verts)
          return false if min_dist_to_poly(pt[:x], pt[:y], outer_verts) < half_d - 0.05
          true
        end
        d = half_d
        any_valid_ever = false
        last_valid_d = nil          # d của vòng hợp lệ gần nhất
        max_valid_d = nil           # d lớn nhất mà vòng còn hợp lệ (mép sát biên ngoài)
        p = 0
        while p < max_rings
          off = offset_loop(island_edges, d)
          break if off.nil? || off.size < 3
          flags = off.map { |pt| valid.call(pt) }
          n_valid = flags.count(true)
          if n_valid.zero?
            # Vòng ở d này vượt biên ngoài. Nếu vòng hợp lệ gần nhất vẫn còn cách biên
            # (còn hở dải chưa cắt), chèn 1 vòng KẸP ở khoảng cách tối đa còn hợp lệ —
            # thay vì bỏ hẳn. Tránh sót dải sát biên ngoài (dải 10mm dao D6 step 5.4:
            # vòng 2 ở d=8.4 vượt d_max=7 → phải kẹp về 7, nếu không chỉ ra 1 vòng).
            if any_valid_ever && !last_valid_d.nil?
              d_max = find_max_valid_d(island_edges, valid, last_valid_d, d)
              if d_max && (d_max - last_valid_d) >= stepover * 0.5
                off_c = offset_loop(island_edges, d_max)
                if off_c && off_c.size >= 3 && off_c.all? { |pt| valid.call(pt) }
                  ring = off_c.dup
                  ring << { x: off_c[0][:x], y: off_c[0][:y] }
                  runs << { closed: true, pts: ring }
                end
              end
              break
            end
            break if any_valid_ever
            d += stepover
            break if p > 5
            p += 1
            next
          end
          any_valid_ever = true
          last_valid_d = d
          if n_valid == off.size
            ring = off.dup
            ring << { x: off[0][:x], y: off[0][:y] }
            runs << { closed: true, pts: ring }
          else
            n = off.size
            start = flags.index(false) || 0
            seg = []
            (1..n).each do |k|
              idx = (start + k) % n
              if flags[idx]
                seg << { x: off[idx][:x], y: off[idx][:y] }
              else
                runs << { closed: false, pts: seg } if seg.size >= 2
                seg = []
              end
            end
            runs << { closed: false, pts: seg } if seg.size >= 2
          end
          d += stepover
          p += 1
        end
        runs
      end

      # Tìm khoảng cách offset LỚN NHẤT (trong khoảng lo..hi) mà offset_loop còn cho
      # vòng hoàn toàn hợp lệ (mọi điểm cách biên ngoài đủ bán kính dao). Nhị phân.
      # Dùng để "kẹp" vòng cuối vào sát biên ngoài thay vì bỏ khi nó vượt biên.
      def self.find_max_valid_d(island_edges, valid_lambda, lo, hi)
        return nil if hi <= lo
        best = nil
        20.times do
          mid = (lo + hi) / 2.0
          off = offset_loop(island_edges, mid)
          ok = off && off.size >= 3 && off.all? { |pt| valid_lambda.call(pt) }
          if ok
            best = mid; lo = mid
          else
            hi = mid
          end
          break if (hi - lo) < 0.05
        end
        best
      end

      # Sinh G-code cho pocket dogbone: 2 offset, offset ngoài đâm 4 góc tạo tai.
      # Đọc cfg[:direction]: 'in_out' = trong ra ngoài (offset 2 trước, offset 1 sau),
      # mặc định 'out_in' = ngoài vào trong (offset 1 trước).
      def self.write_pocket_dogbone(f, body, cfg, clear_z, state, feed, z_feed, rot_info = nil)
        half_d   = (cfg[:diameter].to_f / 2.0)
        stepover = cfg[:stepover] && cfg[:stepover].to_f > 0 ? cfg[:stepover].to_f : half_d * 0.9
        depth    = cfg[:depth].to_f
        bx0, bx1, by0, by1 = body[:bx0], body[:bx1], body[:by0], body[:by1]
        long_is_x = body[:long_is_x]
        in_out    = (cfg[:direction].to_s == 'in_out')

        # Dogbone NGHIÊNG: nếu có rot_info thì mọi (x,y) tính trong hệ THẲNG TRỤC phải
        # xoay NGƯỢC về gốc trước khi ghi G-code. gl = gcode_line có xoay ngược x,y.
        _rot = rot_info
        _ca = _rot ? Math.cos(_rot[:angle]) : 1.0
        _sa = _rot ? Math.sin(_rot[:angle]) : 0.0
        gl = lambda do |g, **kw|
          if _rot && kw[:x] && kw[:y]
            dx = kw[:x] - _rot[:cx]; dy = kw[:y] - _rot[:cy]
            kw = kw.merge(
              x: _rot[:cx] + dx*_ca - dy*_sa,
              y: _rot[:cy] + dx*_sa + dy*_ca
            )
          end
          gcode_line(g, **kw)
        end

        cmt = fmt_comment("DOGBONE POCKET#{in_out ? ' (in-out)' : ''}#{_rot ? ' (tilted)' : ''}", cfg[:comment_style] || 'off')
        f.puts cmt if cmt

        o1x0, o1y0, o1x1, o1y1 = bx0 + half_d, by0 + half_d, bx1 - half_d, by1 - half_d

        # Offset 1 (vòng ngoài) + đâm 4 góc. is_first = true thì vào dao + hạ Z ở đây.
        draw_offset1 = lambda do |is_first|
          corners = [
            { x: o1x0, y: o1y0 }, { x: o1x1, y: o1y0 },
            { x: o1x1, y: o1y1 }, { x: o1x0, y: o1y1 }
          ]
          if is_first
            f.puts gl.call('G0', x: corners[0][:x], y: corners[0][:y], state: state)
            f.puts gl.call('G1', z: depth, f: z_feed, state: state)
          else
            f.puts gl.call('G1', x: corners[0][:x], y: corners[0][:y], f: feed, state: state)
          end
          corners.each do |c|
            f.puts gl.call('G1', x: c[:x], y: c[:y], f: feed, state: state)
            if long_is_x
              dir = (c[:x] <= (o1x0 + o1x1) / 2.0) ? -1 : 1
              ex = c[:x] + dir * half_d
              f.puts gl.call('G1', x: ex, y: c[:y], f: (feed * 0.5).to_i, state: state)
              f.puts gl.call('G1', x: c[:x], y: c[:y], f: feed, state: state)
            else
              dir = (c[:y] <= (o1y0 + o1y1) / 2.0) ? -1 : 1
              ey = c[:y] + dir * half_d
              f.puts gl.call('G1', x: c[:x], y: ey, f: (feed * 0.5).to_i, state: state)
              f.puts gl.call('G1', x: c[:x], y: c[:y], f: feed, state: state)
            end
          end
          f.puts gl.call('G1', x: corners[0][:x], y: corners[0][:y], f: feed, state: state)
        end

        # DỌN NỀN: chạy pocket_contour_rings trên CHÍNH hình dogbone gốc (edges) với
        # bán kính dao THẬT — cùng hàm, cùng tham số như hình vuông không dogbone, nên
        # số vòng KHỚP. Không tự dựng chữ nhật trong + bỏ vòng đầu (cách đó đưa điểm
        # nằm ĐÚNG trên biên vào point-in-poly, bị coi là "ngoài" và loại nhầm).
        # Khấc dogbone lõm ở góc → dùng chữ nhật thân (body) sạch làm biên vét.
        body_edges = [
          { x1: bx0, y1: by0, x2: bx1, y2: by0 },
          { x1: bx1, y1: by0, x2: bx1, y2: by1 },
          { x1: bx1, y1: by1, x2: bx0, y2: by1 },
          { x1: bx0, y1: by1, x2: bx0, y2: by0 }
        ]
        clear_rings = pocket_contour_rings(body_edges, half_d, stepover, 300) || []
        # Vòng NGOÀI CÙNG (ở half_d từ biên) = chính đường offset 1 (đâm góc) → bỏ.
        clear_rings = clear_rings.drop(1)

        draw_clear = lambda do |is_first, rings_ordered|
          first_ring = true
          rings_ordered.each do |ring|
            next if ring.size < 2
            if is_first && first_ring
              f.puts gl.call('G0', x: ring.first[:x], y: ring.first[:y], state: state)
              f.puts gl.call('G1', z: depth, f: z_feed, state: state)
            else
              f.puts gl.call('G1', x: ring.first[:x], y: ring.first[:y], f: feed, state: state)
            end
            ring[1..].each do |pt|
              f.puts gl.call('G1', x: pt[:x], y: pt[:y], f: feed, state: state)
            end
            first_ring = false
          end
        end
        has_clear = clear_rings.any?

        if in_out
          # Trong ra ngoài: clear_rings theo thứ tự NGOÀI→TRONG, nên đảo lại để chạy từ
          # vòng TRONG cùng ra trước, rồi mới tới offset 1 (ngoài + đâm góc).
          # VD 3 offset: trong=3, giữa=2, ngoài=1 → thứ tự đúng 3 → 2 → 1.
          draw_clear.call(true, clear_rings.reverse)
          draw_offset1.call(!has_clear)
        else
          # Ngoài vào trong (mặc định): offset 1 (đâm góc) trước, rồi dọn nền NGOÀI→TRONG.
          draw_offset1.call(true)
          draw_clear.call(false, clear_rings)
        end

        f.puts "G0 Z#{format('%.1f', clear_z)}"
        state[:z] = clear_z
      end

      # ── Write Pocket ─────────────────────────────────────────────────────────

      def self.write_pocket(f, lines, cfg, clear_z, sheet_w=9999, sheet_h=9999)
        comment_style = cfg[:comment_style] || 'off'
        # Hướng quét pocket: 'in_out' = trong ra ngoài (đảo thứ tự vòng quét),
        # mặc định 'out_in' = ngoài vào trong. cw/ccw cũ coi như out_in (tương thích).
        pocket_in_out = (cfg[:direction].to_s == 'in_out')
        raw = lines.reject { |l| l[:is_drill_center] }
                   .select { |l| Math.sqrt((l[:x2]-l[:x1])**2 + (l[:y2]-l[:y1])**2) > 0.1 }

        all_loops = build_loops(raw)
        if lines.any? { |l| l[:layer].to_s.upcase.gsub(/[^A-Z0-9]/, '') == 'ABFPHAY14' }
          puts "N2G DEBUG ABF_PHAY_14: pocket loops=#{all_loops.size} raw_edges=#{raw.size}"
        end
        # ── TỐI ƯU THỨ TỰ POCKET: nearest-neighbor (gom pocket gần nhau, không phân
        # biệt chi tiết) — giống drill & simulator. Island nằm trong cha nên tự đi cùng cụm.
        all_loops = order_loops_nearest(all_loops)

        # Pre-compute island detection cho tất cả loops (containCount % 2 == 1 → island)
        # group_id của mỗi loop (từ edge đầu). Island chỉ xét trong CÙNG group_id (cùng chi tiết);
        # khác chi tiết → không phải island dù bbox lồng (vd chi tiết nhỏ trong phần khuyết).
        pocket_gids = all_loops.map do |lp|
          e0 = lp[:edges].first
          e0 && e0[:group_id] ? e0[:group_id] : nil
        end
        pocket_bbs = all_loops.map do |lp|
          xs = lp[:edges].flat_map { |e| [e[:x1], e[:x2]] }
          ys = lp[:edges].flat_map { |e| [e[:y1], e[:y2]] }
          { x_min: xs.min, x_max: xs.max, y_min: ys.min, y_max: ys.max }
        end
        pocket_contain_count = pocket_bbs.each_with_index.map do |inner, ii|
          pocket_bbs.each_with_index.count do |outer, oi|
            next false if ii == oi
            # Chỉ tính outer bao quanh inner nếu CÙNG group_id (cùng chi tiết)
            gi = pocket_gids[ii]; go = pocket_gids[oi]
            next false if !gi.nil? && !go.nil? && gi != go
            # Kiểm LỒNG THẬT bằng hình học, không chỉ so bbox: hình lõm (L/U/C) có
            # bbox rộng hơn vật liệu, chi tiết nằm trong phần khuyết sẽ bị nhận nhầm
            # là island rồi vét theo bbox → cắt lẹm ra ngoài.
            loop_inside_loop?(all_loops[ii][:edges], all_loops[oi][:edges])
          end
        end
        pocket_is_island = pocket_contain_count.map { |c| c % 2 == 1 }

        all_loops.each do |loop|
          edges    = loop[:edges]
          all_x    = edges.flat_map { |e| [e[:x1], e[:x2]] }
          all_y    = edges.flat_map { |e| [e[:y1], e[:y2]] }
          bx_min   = all_x.min; bx_max = all_x.max
          by_min   = all_y.min; by_max = all_y.max
          w        = bx_max - bx_min
          h        = by_max - by_min
          stepover = cfg[:diameter] * ([cfg[:stepover] || 90, 10].max / 100.0)
          half_d   = cfg[:diameter] / 2.0
          feed     = cfg[:feed]   || 2500
          z_feed   = cfg[:z_feed] || 800

          # ── ISLAND check ĐẦU TIÊN (khớp JS) ─────────────────────────────────
          # Island (đảo bên trong pocket) KHÔNG bao giờ tự phay: vùng bên trong nó
          # là phần chừa lại. Phải bỏ qua NGAY, trước dogbone/circle/pocket-thường —
          # nếu không, island bo góc dễ bị detect_dogbone/is_circle nhận nhầm rồi
          # phay đầy bên trong, hoặc rơi xuống nhánh pocket thường phay như 1 hốc.
          cur_idx = all_loops.index(loop)
          next if cur_idx && pocket_is_island[cur_idx]

          cmt = fmt_comment("POCKET #{format('%.1f',w)}x#{format('%.1f',h)}mm D#{cfg[:diameter]} step=#{format('%.2f',stepover)}mm", comment_style)
          f.puts cmt if cmt

          state = {}

          # ── Dogbone check: nếu là mộng âm dogbone → xử lý riêng, bỏ qua logic pocket thường
          loop_pts = order_loop_points(edges)
          dog_body = detect_dogbone(loop_pts, half_d)
          # Dogbone NGHIÊNG: nếu không nhận thẳng trục, thử xoay về thẳng trục.
          dog_rot  = dog_body ? nil : detect_dogbone_rotated(loop_pts, half_d)
          if edges.any? { |e| e[:layer].to_s.upcase.gsub(/[^A-Z0-9]/, '') == 'ABFPHAY14' }
            puts "N2G DEBUG ABF_PHAY_14: loop=#{cur_idx} points=#{loop_pts.size} " \
                 "closed=#{loop[:closed]} dogbone=#{!!dog_body} rotated_dogbone=#{!!dog_rot}"
          end
          if dog_body || dog_rot
            dcfg = cfg.dup
            dcfg[:stepover] = stepover
            if dog_rot
              write_pocket_dogbone(f, dog_rot[:rotated], dcfg, clear_z, state, feed, z_feed,
                                   { angle: dog_rot[:angle], cx: dog_rot[:cx], cy: dog_rot[:cy] })
            else
              write_pocket_dogbone(f, dog_body, dcfg, clear_z, state, feed, z_feed)
            end
            next
          end

          # Detect circle: bbox vuông + edges nhiều CHƯA đủ — phải kiểm tra
          # mọi điểm thật sự nằm trên đường tròn (loại dogbone/vuông có bbox vuông).
          is_circle = false
          if edges.size >= 12 && w > 0.1 && h > 0.1 && ((w - h).abs / [w, h].max) < 0.05
            cx_chk = (bx_min + bx_max) / 2.0
            cy_chk = (by_min + by_max) / 2.0
            r_chk  = [w, h].min / 2.0
            # điểm đầu mỗi edge cách tâm ~ r? (dung sai 0.5mm)
            max_dev = 0.0
            edges.each do |e|
              d = Math.sqrt((e[:x1] - cx_chk)**2 + (e[:y1] - cy_chk)**2)
              dev = (d - r_chk).abs
              max_dev = dev if dev > max_dev
            end
            # và không có cạnh thẳng dài (tròn thật: mọi cạnh ngắn)
            has_long_straight = edges.any? do |e|
              Math.sqrt((e[:x2] - e[:x1])**2 + (e[:y2] - e[:y1])**2) > 5.0
            end
            is_circle = (max_dev < 0.5) && !has_long_straight
          end

          if is_circle
            cx = (bx_min + bx_max) / 2.0
            cy = (by_min + by_max) / 2.0
            r  = [w, h].min / 2.0

            if r * 2 <= cfg[:diameter]
              if (r * 2 - cfg[:diameter]).abs < 0.1
                begin; c = fmt_comment("CIRCULAR POCKET D#{format('%.1f',r*2)}mm = dao → drill", comment_style); f.puts c if c; end
                f.puts gcode_line('G0', x: cx, y: cy, state: state)
                f.puts gcode_line('G1', z: cfg[:depth].to_f, f: z_feed, state: state)
                f.puts "G0 Z#{format('%.1f', clear_z)}"
              else
                begin; c = fmt_comment("WARNING: Circle D#{format('%.1f',r*2)}mm < dao D#{cfg[:diameter]}mm — bo qua!", comment_style); f.puts c if c; end
              end
              next
            end

            begin; c = fmt_comment("CIRCULAR POCKET D#{format('%.1f',r*2)}mm D#{cfg[:diameter]} step=#{format('%.2f',stepover)}mm", comment_style); f.puts c if c; end
            # Gom các bán kính vòng quét (ngoài→trong)
            radii = []
            cr = r - half_d
            while cr > 0.01
              radii << cr
              cr -= stepover
            end
            # Trong ra ngoài: đảo thứ tự (bắt đầu từ bán kính nhỏ nhất)
            radii = radii.reverse if pocket_in_out
            first = true
            radii.each do |rad|
              if first
                f.puts gcode_line('G0', x: cx + rad, y: cy, state: state)
                f.puts gcode_line('G1', z: cfg[:depth].to_f, f: z_feed, state: state)
                first = false
              else
                f.puts gcode_line('G1', x: cx + rad, y: cy, f: (feed * 0.4).to_i, state: state)
              end
              emit_full_circle_quadrants(f, cx, cy, cx + rad, cy, feed, cw: true, state: state)
            end
            f.puts gcode_line('G1', x: cx, y: cy, f: (feed * 0.4).to_i, state: state) if !pocket_in_out && r > stepover
            f.puts "G0 Z#{format('%.1f', clear_z)}"
            next
          end

          # Loop này có chứa ISLAND bên trong không? Nếu CÓ → KHÔNG đi nhánh concave/
          # has_arc (phay đầy toàn hình → đè island). Để xuống nhánh island xử lý.
          # Kiểm HÌNH HỌC thật, không dùng bbox: hình lõm có bbox rộng hơn vùng
          # vật liệu nên chi tiết nằm trong phần khuyết sẽ bị nhận nhầm là island.
          has_island_inside = all_loops.each_with_index.any? do |lp_j, j|
            pocket_is_island[j] && !lp_j[:edges].equal?(edges) &&
            loop_inside_loop?(lp_j[:edges], edges)
          end

          # ── Nhánh BIÊN DẠNG THẬT: hình LÕM (L/U) HOẶC hình CÓ CUNG TRÒN (bo tròn) ──
          # offset_concave offset đúng biên cho cả 2. has_curved_edges? (ổn định) bắt
          # hình bo tròn mà is_concave? hay bỏ sót do sai số cung rời rạc.
          concave_pts = order_loop_points(edges)
          if !has_island_inside && concave_pts.size >= 4 && (is_concave?(concave_pts) || has_curved_edges?(concave_pts))
            # Offset theo BIÊN DẠNG THẬT bằng pocket_contour_rings (miter — ổn định cho
            # hình NGHIÊNG, lõm, có cung + chèn vòng giữa cho dải hẹp). Khớp JS
            # pocketContourRings. Thay offset_concave cũ (giao 2 đường thẳng, không ổn
            # định khi hình nghiêng có cạnh gần song song → offset méo/dừng sớm).
            cc_loop = []
            n_cc = concave_pts.size
            (0...n_cc).each do |i|
              a = concave_pts[i]; b = concave_pts[(i+1) % n_cc]
              cc_loop << { x1: a[:x], y1: a[:y], x2: b[:x], y2: b[:y] }
            end
            cc_loop = []
            n_cc = concave_pts.size
            (0...n_cc).each do |i|
              a = concave_pts[i]; b = concave_pts[(i+1) % n_cc]
              cc_loop << { x1: a[:x], y1: a[:y], x2: b[:x], y2: b[:y] }
            end
            cc_rings = pocket_contour_rings(cc_loop, half_d, stepover, 200,
                                            edges.any? { |e| e[:layer].to_s.upcase.gsub(/[^A-Z0-9]/, '') == 'ABFPHAY14' })
            if edges.any? { |e| e[:layer].to_s.upcase.gsub(/[^A-Z0-9]/, '') == 'ABFPHAY14' }
              puts "N2G DEBUG ABF_PHAY_14: concave_or_curved rings=#{cc_rings.size} " \
                   "concave=#{is_concave?(concave_pts)} curved=#{has_curved_edges?(concave_pts)}"
            end
            cc_rings = cc_rings.reverse if pocket_in_out
            if cc_rings.any?
              state = {}
              cc_rings.each_with_index do |ring, ri|
                if ri == 0
                  f.puts gcode_line('G0', x: ring[0][:x], y: ring[0][:y], state: state)
                  f.puts gcode_line('G1', z: cfg[:depth].to_f, f: z_feed, state: state)
                else
                  f.puts gcode_line('G1', x: ring[0][:x], y: ring[0][:y], f: feed, state: state)
                end
                ring[1..].each { |p| f.puts gcode_line('G1', x: p[:x], y: p[:y], f: feed, state: state) }
              end
              f.puts "G0 Z#{format('%.1f', clear_z)}"
              next
            end
            # Không vẽ được vòng nào → rơi xuống nhánh thường
          end

          # Island đã được bỏ qua ở đầu vòng lặp. Ở đây chỉ tìm island NẰM TRONG
          # loop hiện tại (loop cha) để phay chừa island ra.
          # Lọc island NẰM TRONG loop hiện tại bằng hình học thật (xem chú thích
          # ở loop_inside_loop?), không dùng bbox.
          island_loops = all_loops.each_with_index.select do |lp_j, j|
            pocket_is_island[j] && !lp_j[:edges].equal?(edges) &&
            loop_inside_loop?(lp_j[:edges], edges)
          end.map(&:first)

          if island_loops.any?
            # Biên ngoài có phải CHỮ NHẬT THUẦN không? Bo góc/cong → bbox rect SAI (vượt
            # biên ngoài, không bo theo biên dạng) → dùng island_clearing_runs (vét tổng
            # quát theo biên dạng thật). Chữ nhật thuần → thuật toán cũ (bbox + corner).
            outer_is_rect = edges.all? do |e|
              dx = (e[:x2] - e[:x1]).abs; dy = (e[:y2] - e[:y1]).abs
              dx <= 0.1 || dy <= 0.1
            end

            unless outer_is_rect
              # ── Biên ngoài BO GÓC/CONG → vét tổng quát theo biên dạng thật ──
              max_r = ([w, h].min / (2.0*stepover)).ceil + 4
              # island_clearing_runs(island_edges, outer_edges, ...): island = island đầu,
              # outer = loop hiện tại (edges).
              clr_runs = island_clearing_runs(island_loops.first[:edges], edges, half_d, stepover, max_r)
              if clr_runs && clr_runs.any?
                clr_runs = clr_runs.reverse if pocket_in_out
                state = {}
                cmt_c = fmt_comment("ISLAND POCKET (contour) #{clr_runs.size} runs", comment_style)
                f.puts cmt_c if cmt_c
                clr_runs.each_with_index do |run, ri|
                  pts = run[:pts]
                  next if pts.size < 2
                  if ri == 0
                    # Hạ dao MỘT LẦN ở run đầu.
                    f.puts gcode_line('G0', x: pts[0][:x], y: pts[0][:y], state: state)
                    f.puts gcode_line('G1', z: cfg[:depth].to_f, f: z_feed, state: state)
                  else
                    # Các run sau: dao vẫn ở đáy, chạy NGANG sang điểm đầu (G1), không
                    # nhấc-hạ giữa chừng. Trước đây mỗi run tự hạ Z nhưng state[:z] chưa
                    # cập nhật sau khi nhấc nên gcode_line bỏ lệnh hạ → vòng chạy trên không.
                    f.puts gcode_line('G1', x: pts[0][:x], y: pts[0][:y], f: (feed*0.4).to_i, state: state)
                  end
                  pts[1..].each { |p| f.puts gcode_line('G1', x: p[:x], y: p[:y], f: feed, state: state) }
                end
                f.puts "G0 Z#{format('%.1f', clear_z)}"   # nhấc dao MỘT LẦN ở cuối
                state[:z] = clear_z
                next
              end
              # clr_runs rỗng → rơi xuống thuật toán bbox cũ (dự phòng)
            end

            i_x_min = island_loops.flat_map { |l| l[:edges].flat_map { |e| [e[:x1],e[:x2]] } }.min
            i_x_max = island_loops.flat_map { |l| l[:edges].flat_map { |e| [e[:x1],e[:x2]] } }.max
            i_y_min = island_loops.flat_map { |l| l[:edges].flat_map { |e| [e[:y1],e[:y2]] } }.min
            i_y_max = island_loops.flat_map { |l| l[:edges].flat_map { |e| [e[:y1],e[:y2]] } }.max
            max_off_l = i_x_min - bx_min - half_d
            max_off_r = bx_max - i_x_max - half_d
            max_off_b = i_y_min - by_min - half_d
            max_off_t = by_max - i_y_max - half_d
            contours = []
            current_offset = half_d
            max_p = ([w, h].min / (2.0*stepover)).ceil + 4
            _last_off = nil   # offset thực vòng trước (bỏ vòng clamp quá sát)
            max_p.times do
              off_l = [current_offset, max_off_l].min
              off_r = [current_offset, max_off_r].min
              off_b = [current_offset, max_off_b].min
              off_t = [current_offset, max_off_t].min
              # Offset "hiệu lực" (nhỏ nhất 4 phía đã clamp). Nếu vòng này bị CLAMP và
              # quá SÁT vòng trước (< nửa stepover) → bỏ, tránh vẽ thừa 1 vòng dính sát.
              eff_off = [off_l, off_r, off_b, off_t].min
              clamped = current_offset > eff_off + 0.001
              break if clamped && !_last_off.nil? && (eff_off - _last_off) < stepover * 0.5
              rx0 = bx_min + off_l; rx1 = bx_max - off_r
              ry0 = by_min + off_b; ry1 = by_max - off_t
              break if rx1 <= rx0 || ry1 <= ry0
              contours << [rx0, ry0, rx1, ry1]
              _last_off = eff_off
              break if current_offset >= max_off_l && current_offset >= max_off_r &&
                        current_offset >= max_off_b && current_offset >= max_off_t
              current_offset += stepover
            end
            next if contours.empty?
            # Trong ra ngoài: đảo thứ tự các vòng (bắt đầu sát island, mở rộng ra biên)
            contours = contours.reverse if pocket_in_out
            cmt_isl = fmt_comment("ISLAND POCKET #{contours.size} passes", comment_style)
            f.puts cmt_isl if cmt_isl
            f.puts gcode_line('G0', x: contours.first[0], y: contours.first[1], state: state)
            f.puts gcode_line('G1', z: cfg[:depth].to_f, f: z_feed, state: state)
            contours.each_with_index do |contour, idx|
              r_x0, r_y0, r_x1, r_y1 = contour
              f.puts gcode_line('G1', x: r_x0, y: r_y0, f: (feed*0.4).to_i, state: state) if idx > 0
              f.puts gcode_line('G1', x: r_x0, y: r_y1, f: feed, state: state)
              f.puts gcode_line('G1', x: r_x1, y: r_y1, f: feed, state: state)
              f.puts gcode_line('G1', x: r_x1, y: r_y0, f: feed, state: state)
              f.puts gcode_line('G1', x: r_x0, y: r_y0, f: feed, state: state)
            end
            f.puts "G0 Z#{format('%.1f', clear_z)}"
            state[:z] = clear_z

            # Corner cleanup: 4 góc với L-shape + arc theo biên dạng island
            isl_edges = island_loops.first[:edges]
            mid_x = (i_x_min + i_x_max) / 2.0
            mid_y = (i_y_min + i_y_max) / 2.0

            corner_defs = [
              { name: 'BL',
                get_xy:     lambda { |d| [i_x_min + d, i_y_min + d] },
                filter_g1:  lambda { |pt, _xl| pt[:y] <= mid_y },   # giao x=xLine, y<=midY
                filter_g2:  lambda { |pt, _yl| pt[:x] <= mid_x },   # giao y=yLine, x<=midX
                check_stop: lambda { |xl, yl, gl, gb| xl >= gb[:x] || yl >= gl[:y] },
                arc_dir: -1 },
              { name: 'BR',
                get_xy:     lambda { |d| [i_x_max - d, i_y_min + d] },
                filter_g1:  lambda { |pt, _xl| pt[:y] <= mid_y },
                filter_g2:  lambda { |pt, _yl| pt[:x] >= mid_x },
                check_stop: lambda { |xl, yl, gl, gb| xl <= gb[:x] || yl >= gl[:y] },
                arc_dir: 1 },
              { name: 'TL',
                get_xy:     lambda { |d| [i_x_min + d, i_y_max - d] },
                filter_g1:  lambda { |pt, _xl| pt[:y] >= mid_y },
                filter_g2:  lambda { |pt, _yl| pt[:x] <= mid_x },
                check_stop: lambda { |xl, yl, gl, gb| xl >= gb[:x] || yl <= gl[:y] },
                arc_dir: 1 },
              { name: 'TR',
                get_xy:     lambda { |d| [i_x_max - d, i_y_max - d] },
                filter_g1:  lambda { |pt, _xl| pt[:y] >= mid_y },
                filter_g2:  lambda { |pt, _yl| pt[:x] >= mid_x },
                check_stop: lambda { |xl, yl, gl, gb| xl <= gb[:x] || yl <= gl[:y] },
                arc_dir: -1 }
            ]

            corner_defs.each do |c|
              corner_passes = []   # gom các pass để đảo thứ tự theo direction
              20.times do |pass|
                d      = half_d + pass * stepover
                x_line, y_line = c[:get_xy].call(d)

                off_pts = offset_loop(isl_edges, d, direction: 'cw')
                break if off_pts.nil? || off_pts.size < 3
                n = off_pts.size

                g_left = nil; g_bottom = nil
                g_left_seg = -1; g_bottom_seg = -1

                n.times do |ii|
                  p1 = off_pts[ii]; p2 = off_pts[(ii + 1) % n]
                  # Giao x=x_line
                  if (p1[:x] - x_line) * (p2[:x] - x_line) <= 0 && (p2[:x] - p1[:x]).abs > 0.001
                    t  = (x_line - p1[:x]) / (p2[:x] - p1[:x])
                    yy = p1[:y] + t * (p2[:y] - p1[:y])
                    if c[:filter_g1].call({x: x_line, y: yy}, x_line)
                      g_left = {x: x_line, y: yy}; g_left_seg = ii
                    end
                  end
                  # Giao y=y_line
                  if (p1[:y] - y_line) * (p2[:y] - y_line) <= 0 && (p2[:y] - p1[:y]).abs > 0.001
                    t2  = (y_line - p1[:y]) / (p2[:y] - p1[:y])
                    xx2 = p1[:x] + t2 * (p2[:x] - p1[:x])
                    if c[:filter_g2].call({x: xx2, y: y_line}, y_line)
                      g_bottom = {x: xx2, y: y_line}; g_bottom_seg = ii
                    end
                  end
                end

                break if g_left.nil? || g_bottom.nil?
                break if c[:check_stop].call(x_line, y_line, g_left, g_bottom)

                # Thu thập arc segment. Chọn hướng đi cho CUNG NGẮN hơn giữa 2 giao
                # điểm (cung ở góc luôn ngắn). arc_dir cố định trước đây sai khi winding
                # của offset đổi theo kích thước/hình island → đi trọn vòng → offset loằng ngoằng.
                fwd_steps = (g_bottom_seg - g_left_seg + n) % n
                bwd_steps = (g_left_seg - g_bottom_seg + n) % n
                dir = fwd_steps <= bwd_steps ? 1 : -1
                arc_seg = [g_left]
                cur = g_left_seg
                max_iter = n
                while cur != g_bottom_seg && max_iter > 0
                  arc_seg << off_pts[cur]
                  cur = (cur + dir + n) % n
                  max_iter -= 1
                end
                arc_seg << off_pts[g_bottom_seg]
                arc_seg << g_bottom

                corner_passes << { x_line: x_line, y_line: y_line, g_left: g_left, arc_seg: arc_seg }
              end

              # Corner cleanup mặc định quét từ xa island vào sát island (= ngoài vào trong).
              # Trong ra ngoài (in_out) → đảo lại để bắt đầu sát island.
              corner_passes = corner_passes.reverse if pocket_in_out

              corner_passes.each do |cp|
                f.puts gcode_line('G0', x: cp[:x_line], y: cp[:y_line], state: state)
                f.puts gcode_line('G1', z: cfg[:depth].to_f, f: z_feed, state: state)
                f.puts gcode_line('G1', x: cp[:g_left][:x], y: cp[:g_left][:y], f: feed, state: state)
                cp[:arc_seg][1..].each { |pt| f.puts gcode_line('G1', x: pt[:x], y: pt[:y], f: feed, state: state) }
                f.puts gcode_line('G1', x: cp[:x_line], y: cp[:y_line], f: feed, state: state)
                f.puts "G0 Z#{format('%.1f', clear_z)}"
                state[:z] = clear_z
              end
            end
            next
          end

          # Detect D-shape hoặc shape phức tạp (không phải rect/circle/dogbone)
          # Port chính xác hasArcEdges() từ JS: circumcenter bước 2, r >= minArcR (tool.diameter),
          # bbox ratio > 1.15 để loại trừ dogbone/arc nhỏ
          min_arc_r = cfg[:diameter]
          has_arc = false
          if edges.size >= 8
            (0..(edges.size - 5)).step(2).each do |i|
              cc = circumcenter(edges[i][:x1], edges[i][:y1], edges[i+2][:x1], edges[i+2][:y1], edges[i+4][:x1], edges[i+4][:y1])
              next unless cc
              cx, cy = cc
              r = Math.sqrt((edges[i][:x1]-cx)**2 + (edges[i][:y1]-cy)**2)
              next if r < min_arc_r
              tol = [r * 0.05, 1.0].max
              ok2 = (Math.sqrt((edges[i+2][:x1]-cx)**2 + (edges[i+2][:y1]-cy)**2) - r).abs < tol
              ok4 = (Math.sqrt((edges[i+4][:x1]-cx)**2 + (edges[i+4][:y1]-cy)**2) - r).abs < tol
              next unless ok2 && ok4
              bw2 = w; bh2 = h
              ratio2 = [bw2, bh2].max / [[bw2, bh2].min, 0.01].max
              if ratio2 > 1.15
                has_arc = true
                break
              end
            end
          end
          is_complex = has_arc

          if is_complex
            # Hình có CUNG (bo tròn) → offset theo BIÊN DẠNG THẬT bằng pocket_contour_rings,
            # KHÔNG scale-toward-center theo bbox. Scale co về tâm bbox làm hình nghiêng/
            # lõm sai hẳn (tâm bbox có thể ngoài vật liệu, tỉ lệ scale méo biên cong).
            # JS đã dùng pocketContourRings cho nhánh này → Ruby khớp để G-code = mô phỏng.
            cmt2 = fmt_comment("COMPLEX POCKET (contour-parallel)", comment_style)
            f.puts cmt2 if cmt2

            cplx_loop = []
            cpts = order_loop_points(edges)
            cpts.each_with_index do |a, i|
              b = cpts[(i + 1) % cpts.size]
              cplx_loop << { x1: a[:x], y1: a[:y], x2: b[:x], y2: b[:y] }
            end
            rings = pocket_contour_rings(cplx_loop, half_d, stepover, 300)
            unless rings.empty?
              rings = rings.reverse if pocket_in_out
              first_pt = rings.first.first
              f.puts gcode_line('G0', x: first_pt[:x], y: first_pt[:y], state: state)
              f.puts gcode_line('G1', z: cfg[:depth].to_f, f: z_feed, state: state)
              rings.each_with_index do |ring, ri|
                ring.each_with_index do |pt, pi|
                  fr = (ri > 0 && pi == 0) ? (feed * 0.4).to_i : feed
                  f.puts gcode_line('G1', x: pt[:x], y: pt[:y], f: fr, state: state)
                end
              end
            end

            f.puts "G0 Z#{format('%.1f', clear_z)}"
            state[:z] = clear_z
            next
          end

          # Mọi shape còn lại (rect thẳng/nghiêng, hình lồi khác) → offset theo BIÊN
          # DẠNG THẬT bằng pocket_contour_rings, KHÔNG dùng bbox. shrink_rect cũ lấy
          # bbox trục X/Y: hình chữ nhật NGHIÊNG có bbox to hơn hình thật nên dao chạy
          # ra ngoài biên. Đây chính là chỗ G-code lệch mô phỏng (mô phỏng đã dùng
          # pocketContourRings). Giờ hai bên chạy CÙNG thuật toán.
          loop_pts_r = order_loop_points(edges)
          contour_loop = []
          loop_pts_r.each_with_index do |a, i|
            b = loop_pts_r[(i + 1) % loop_pts_r.size]
            contour_loop << { x1: a[:x], y1: a[:y], x2: b[:x], y2: b[:y] }
          end
          rings = pocket_contour_rings(contour_loop, half_d, stepover, 300)
          if edges.any? { |e| e[:layer].to_s.upcase.gsub(/[^A-Z0-9]/, '') == 'ABFPHAY14' }
            puts "N2G DEBUG ABF_PHAY_14: regular_contour rings=#{rings.size} " \
                 "points=#{loop_pts_r.size}"
          end
          next if rings.empty?
          rings = rings.reverse if pocket_in_out   # trong ra ngoài

          first_pt = rings.first.first
          f.puts gcode_line('G0', x: first_pt[:x], y: first_pt[:y], state: state)
          f.puts gcode_line('G1', z: cfg[:depth].to_f, f: z_feed, state: state)
          rings.each_with_index do |ring, ri|
            ring.each_with_index do |pt, pi|
              fr = (ri > 0 && pi == 0) ? (feed * 0.4).to_i : feed
              f.puts gcode_line('G1', x: pt[:x], y: pt[:y], f: fr, state: state)
            end
          end
          f.puts "G0 Z#{format('%.1f', clear_z)}"
        end
      end

      # Ghi pocket runs đã được JS clipping sinh trước, để G-code khớp preview.
      def self.write_pocket_runs(f, paths, cfg, clear_z)
        groups = (paths || []).map { |p| p['runs'] || p[:runs] || [] }
                             .reject(&:empty?)
        return if groups.empty?
        state = {}
        feed = cfg[:feed] || 2500
        z_feed = cfg[:z_feed] || 800
        depth = cfg[:depth].to_f
        started = false
        groups.each do |group_runs|
          runs = cfg[:direction].to_s == 'in_out' ? group_runs.reverse : group_runs
          parsed_runs = runs.map do |run|
            (run || []).map { |p| { x: (p['x'] || p[:x]).to_f, y: (p['y'] || p[:y]).to_f } }
          end
          next unless parsed_runs.any? { |pts| pts.size >= 2 }

          # A group is one Pocket region. Consecutive safe offsets remain at
          # cutting Z; an empty run is a JS-authored Safe-Z separator.
          if started
            f.puts "G0 Z#{format('%.1f', clear_z)}"
            state[:z] = clear_z
          end
          at_cut_z = false
          parsed_runs.each do |pts|
            if pts.size < 2
              if at_cut_z
                f.puts "G0 Z#{format('%.1f', clear_z)}"
                state[:z] = clear_z
                at_cut_z = false
              end
              next
            end
            # Final safety gate after applying the real in_out/out_in order.
            # Never emit a long cross-region connector as G1, even if JS data
            # did not contain a Safe-Z marker.
            if at_cut_z
              connector_len = Math.hypot(pts.first[:x] - state[:x].to_f,
                                         pts.first[:y] - state[:y].to_f)
              step_abs = cfg[:diameter].to_f * (cfg[:stepover].to_f.nonzero? || 90.0) / 100.0
              max_connector = [step_abs * 1.5, cfg[:diameter].to_f * 1.25, 1.0].max
              if connector_len > max_connector
                f.puts "G0 Z#{format('%.1f', clear_z)}"
                state[:z] = clear_z
                at_cut_z = false
              end
            end
            unless at_cut_z
              state[:z] = clear_z
              f.puts gcode_line('G0', x: pts[0][:x], y: pts[0][:y], state: state)
              f.puts gcode_line('G1', z: depth, f: z_feed, state: state)
              at_cut_z = true
            else
              f.puts gcode_line('G1', x: pts[0][:x], y: pts[0][:y], f: feed, state: state)
            end
            pts[1..].each { |p| f.puts gcode_line('G1', x: p[:x], y: p[:y], f: feed, state: state) }
          end
          started = true
        end
        f.puts "G0 Z#{format('%.1f', clear_z)}" if started
      end

      # ── Write Profile ────────────────────────────────────────────────────────

      # ── Emit các LƯỢT TRÊN cho nhiều lượt xuống dao ────────────────────────
      # z_levels: mảng mức Z (âm), phần tử cuối = đáy thật. Nếu <=1 phần tử → không
      # làm gì (để code gọi tự cắt 1 lượt như cũ). Trả về true nếu ĐÃ emit lượt trên
      # (khi đó code gọi chỉ cần hạ nốt xuống final_z và cắt lượt cuối).
      #
      # emit_ring: lambda nhận (z_level) — hạ dao xuống z_level rồi cắt hết 1 vòng.
      #   Dùng chung cho mọi dạng hình học (đường kín, tròn, hở).
      # Sau mỗi lượt trên, code gọi phải nhấc dao lên safe-Z và về lại điểm đầu
      # trước khi hạ xuống lượt kế tiếp.
      def self.emit_upper_passes(z_levels, &emit_ring)
        return false unless z_levels.is_a?(Array) && z_levels.size > 1
        z_levels[0...-1].each { |zl| emit_ring.call(zl.to_f) }
        true
      end

      # ── RAMP ENTRY (đoạn dốc xuống dao) ────────────────────────────────────
      # Thay vì hạ dao thẳng đứng xuống đáy, dao hạ Z DẦN dọc L mm đầu của đường
      # cắt (dốc 1 chiều). Đường ngắn hơn L → giảm L cho vừa chu vi (ramp thoải).
      # Sau ramp, chạy hết vòng ở đáy rồi lặp lại đúng đoạn ramp ở đáy để cắt xuyên
      # phần đầu (lúc ramp cắt nông dần nên chưa đứt). Chỉ dùng cho lượt xuống dao
      # ĐẦU TIÊN, cuttinglines, loop kín. Trả về mảng dòng G-code (không gồm G0 tới
      # điểm đầu và không gồm nhấc dao — caller lo).
      # off_pts: mảng {x,y} loop kín (điểm cuối KHÔNG lặp điểm đầu).
      # z_top: Z mặt ván (nơi dao chạm phôi). z_bottom: Z đáy cắt. Ramp đi chéo từ
      # z_top xuống z_bottom dọc L mm đầu.
      def self.ramp_entry_lines(off_pts, z_bottom, z_top, ramp_len, z_feed, feed, arc_min_r: nil)
        n = off_pts.size
        return nil if n < 2
        seg = []; total = 0.0
        n.times do |i|
          a = off_pts[i]; b = off_pts[(i + 1) % n]
          d = Math.hypot(b[:x] - a[:x], b[:y] - a[:y]); seg << d; total += d
        end
        return nil if total < 1e-6
        l_eff = [ramp_len.to_f, total].min
        l_eff = total if l_eff <= 0.0
        target = total + l_eff

        # Dựng "walk": đi vòng tới khi quãng ≥ target
        walk = [{ x: off_pts[0][:x], y: off_pts[0][:y], cum: 0.0 }]
        cum = 0.0; i = 0
        while cum < target - 1e-6
          b = off_pts[(i + 1) % n]; cum += seg[i % n]
          walk << { x: b[:x], y: b[:y], cum: cum }
          i += 1
        end
        # Chèn mốc L và mốc TARGET (nếu rơi giữa cạnh)
        [l_eff, target].each do |mark|
          next if walk.any? { |w| (w[:cum] - mark).abs < 1e-6 }
          (0...walk.size - 1).each do |k|
            a = walk[k]; b = walk[k + 1]
            next unless a[:cum] < mark - 1e-6 && b[:cum] > mark + 1e-6
            t = (mark - a[:cum]) / (b[:cum] - a[:cum])
            walk.insert(k + 1, { x: a[:x] + (b[:x] - a[:x]) * t,
                                 y: a[:y] + (b[:y] - a[:y]) * t, cum: mark })
            break
          end
        end
        walk = walk.select { |w| w[:cum] <= target + 1e-6 }

        # Dao đang ở trên cao (clear_z) tại off_pts[0]. Hạ nhanh tới MẶT VÁN (z_top),
        # rồi G1 chéo xuống z_bottom dọc L mm đầu.
        out = ["G0 Z#{format('%.3f', z_top)}"]
        ramp_end = walk.index { |w| (w[:cum] - l_eff).abs < 1e-6 } || 0

        # Đoạn đang hạ Z giữ nguyên G1 tuyến tính; không phát cung 3D để bảo đảm
        # tương thích controller. Từ mốc đạt đáy trở đi mới nội suy G02/G03.
        walk[1..ramp_end].to_a.each do |w|
          z = z_top + (z_bottom - z_top) * (w[:cum] / l_eff)
          out << "G1 X#{format('%.3f', w[:x])} Y#{format('%.3f', w[:y])} Z#{format('%.3f', z)} F#{feed}"
        end

        bottom = walk[ramp_end..] || []
        arc_at = {}
        if arc_min_r && bottom.size >= 2
          detect_arcs_gcode(bottom, arc_min_r.to_f).each { |a| arc_at[a[:s]] = a }
        end
        bi = 1
        while bi < bottom.size
          arc = arc_at[bi - 1]
          if arc
            start = bottom[arc[:s]]; finish = bottom[arc[:e]]
            dir = arc_dir_gcode(bottom, arc)
            center = equalize_arc_center(start, finish, arc[:cx], arc[:cy])
            out << "#{dir} X#{format('%.3f',finish[:x])} Y#{format('%.3f',finish[:y])} " \
                   "I#{format('%.3f',center[:x]-start[:x])} J#{format('%.3f',center[:y]-start[:y])} F#{feed}"
            bi = arc[:e] + 1
          else
            w = bottom[bi]
            out << "G1 X#{format('%.3f', w[:x])} Y#{format('%.3f', w[:y])} F#{feed}"
            bi += 1
          end
        end
        out
      end

      # Ramp cho path HO: ha Z tren L mm dau, lui theo vet ramp ve diem dau,
      # roi cat toan bo path tai Z day. Khong noi ao diem cuoi ve diem dau.
      def self.ramp_open_entry_lines(pts, z_bottom, z_top, ramp_len, z_feed, feed)
        return nil unless pts.is_a?(Array) && pts.size >= 2
        seg = []; total = 0.0
        (0...pts.size - 1).each do |i|
          d = Math.hypot(pts[i + 1][:x] - pts[i][:x], pts[i + 1][:y] - pts[i][:y])
          seg << d; total += d
        end
        return nil if total < 1e-6
        l_eff = [[ramp_len.to_f, total].min, 1e-6].max
        walk = [{ x:pts[0][:x], y:pts[0][:y], cum:0.0 }]
        cum = 0.0
        (0...seg.size).each do |i|
          a = pts[i]; b = pts[i + 1]; d = seg[i]
          if d > 1e-9 && cum < l_eff - 1e-6 && cum + d > l_eff + 1e-6
            t = (l_eff - cum) / d
            walk << { x:a[:x] + (b[:x]-a[:x])*t,
                      y:a[:y] + (b[:y]-a[:y])*t, cum:l_eff }
          end
          cum += d
          walk << { x:b[:x], y:b[:y], cum:cum }
        end
        out = ["G0 Z#{format('%.3f', z_top)}"]
        ramp_end = walk.index { |w| w[:cum] >= l_eff - 1e-6 } || (walk.size - 1)

        # 1) Ha doc tu diem dau toi moc L.
        walk[1..ramp_end].to_a.each do |w|
          z = z_top + (z_bottom-z_top)*([w[:cum],l_eff].min/l_eff)
          out << "G1 X#{format('%.3f',w[:x])} Y#{format('%.3f',w[:y])} " \
                 "Z#{format('%.3f',z)} F#{feed}"
        end

        # 2) Da dat Z day: lui dung theo vet ramp ve diem dau.
        walk[0...ramp_end].reverse_each do |w|
          out << "G1 X#{format('%.3f',w[:x])} Y#{format('%.3f',w[:y])} F#{feed}"
        end

        # 3) Cat lai toan bo path ho tai Z day de khong sot doan dau.
        pts[1..].to_a.each do |p|
          out << "G1 X#{format('%.3f',p[:x])} Y#{format('%.3f',p[:y])} F#{feed}"
        end
        out
      end

      def self.profile_loop_key(edges)
        return '' if edges.nil? || edges.empty?
        xs = edges.flat_map { |e| [e[:x1], e[:x2]] }
        ys = edges.flat_map { |e| [e[:y1], e[:y2]] }
        perimeter = edges.sum { |e| Math.hypot(e[:x2]-e[:x1], e[:y2]-e[:y1]) }
        gid = edges.first[:group_id].nil? ? '' : edges.first[:group_id].to_s
        [gid, edges.size, format('%.3f',xs.min), format('%.3f',xs.max),
         format('%.3f',ys.min), format('%.3f',ys.max), format('%.3f',perimeter)].join('|')
      end

      def self.profile_loop_id(edges)
        return '' if edges.nil? || edges.empty?
        xs = edges.flat_map { |e| [e[:x1], e[:x2]] }
        ys = edges.flat_map { |e| [e[:y1], e[:y2]] }
        gid = edges.first[:group_id].nil? ? '' : edges.first[:group_id].to_s
        [gid, format('%.3f',xs.min), format('%.3f',xs.max),
         format('%.3f',ys.min), format('%.3f',ys.max)].join('|')
      end

      def self.profile_record_geometry(rec)
        id = (rec['id'] || rec[:id]).to_s
        parts = id.split('|')
        if parts.size == 5
          return [parts[0], parts[1].to_f, parts[2].to_f, parts[3].to_f, parts[4].to_f]
        end
        key = (rec['key'] || rec[:key]).to_s.split('|')
        return nil unless key.size == 7
        [key[0], key[2].to_f, key[3].to_f, key[4].to_f, key[5].to_f]
      end

      def self.profile_loop_geometry(edges)
        return nil if edges.nil? || edges.empty?
        xs = edges.flat_map { |e| [e[:x1], e[:x2]] }
        ys = edges.flat_map { |e| [e[:y1], e[:y2]] }
        gid = edges.first[:group_id].nil? ? '' : edges.first[:group_id].to_s
        [gid, xs.min.to_f, xs.max.to_f, ys.min.to_f, ys.max.to_f]
      end

      def self.write_profile(f, lines, cfg, clear_z, sheet_w=9999, sheet_h=9999, app_settings={})
        comment_style = cfg[:comment_style] || app_settings[:comment_style] || 'off'
        raw = lines.reject { |l| l[:is_drill_center] }
                   .select { |l| Math.sqrt((l[:x2]-l[:x1])**2 + (l[:y2]-l[:y1])**2) > 0.1 }

        raw_loops = build_loops(raw)

        # Detect islands: containedBy % 2 == 1 → island thực
        # containedBy=0 → outer, =1 → island, =2 → tấm con trong island (cut_out)
        bboxes = raw_loops.map do |lp|
          ex = lp[:edges].flat_map { |e| [e[:x1], e[:x2]] }
          ey = lp[:edges].flat_map { |e| [e[:y1], e[:y2]] }
          [ex.min, ex.max, ey.min, ey.max]
        end
        # group_id mỗi loop (từ edge đầu). Island CHỈ xét trong CÙNG group_id (cùng chi
        # tiết). Khác chi tiết → KHÔNG phải island dù bbox lồng (vd chi tiết nhỏ nằm
        # trong phần KHUYẾT của chi tiết chữ L). Khớp JS detectIslandJS + write_pocket.
        gids = raw_loops.map { |lp| e0 = lp[:edges].first; e0 && e0[:group_id] ? e0[:group_id] : nil }
        contain_count = bboxes.each_with_index.map do |_inner, ii|
          bboxes.each_with_index.count do |_outer, jj|
            next false if ii == jj
            next false if gids[ii] && gids[jj] && gids[ii] != gids[jj]
            # Lồng THẬT (point-in-polygon), không chỉ lồng bbox — chi tiết nằm
            # trong phần khuyết của hình lõm không phải island.
            loop_inside_loop?(raw_loops[ii][:edges], raw_loops[jj][:edges])
          end
        end
        island_set = {}
        contain_count.each_with_index { |c, i| island_set[i] = true if c % 2 == 1 }

        # Thứ tự chạy:
        #  - cut_out (cuttinglines cắt RỜI): giữ quy tắc VÙNG (nhỏ trước, theo zone/side)
        #    vì thứ tự ảnh hưởng an toàn — tránh tấm rời sớm gây rung/văng phôi.
        #  - cut_in / cut_on (rãnh, khắc, cắt trong — KHÔNG làm rời chi tiết): sắp theo
        #    LÂN CẬN GẦN NHẤT để dao không chạy từ đầu này sang đầu kia rồi vòng lại.
        _strat = cfg[:strategy]
        sorted_loops = if _strat == :cut_in || _strat == :cut_on
          order_loops_nearest(raw_loops)
        else
          sort_loops_by_proximity(
            raw_loops, sheet_w, sheet_h,
            island_set: island_set,
            small_threshold: (app_settings[:small_threshold] || 300.0),
            thresh_top: (app_settings[:thresh_top] || 300.0),
            thresh_bot: (app_settings[:thresh_bot] || 300.0)
          )
        end

        # Apply custom cut order từ JS — KHỚP CHÍNH XÁC tpComputeFinalOrder (JS):
        #   thứ tự cuối = [các loop ĐƯỢC GHIM theo đúng thứ tự ghim] + [phần còn lại auto].
        # KHÔNG tự kéo island lên trước (để G-code cắt ĐÚNG thứ tự số hiển thị trên
        # giao diện "thứ tự cắt" — người dùng thấy sao, máy chạy vậy).
        sheet_name    = app_settings[:sheet_name].to_s
        custom_order  = (app_settings[:cut_order] || {})[sheet_name]
        if custom_order && custom_order.any?
          pinned_idxs = custom_order.map(&:to_i).select { |i| raw_loops[i] }
          pinned_loops = pinned_idxs.map { |i| raw_loops[i] }
          # phần chưa ghim: giữ nguyên thứ tự auto (sorted_loops) nhưng loại các loop đã ghim
          rest = sorted_loops.reject { |lp| pinned_loops.include?(lp) }
          sorted_loops = pinned_loops + rest
        end

        # Rebuild island_set sau khi sort
        sorted_bboxes = sorted_loops.map do |lp|
          ex = lp[:edges].flat_map { |e| [e[:x1], e[:x2]] }
          ey = lp[:edges].flat_map { |e| [e[:y1], e[:y2]] }
          [ex.min, ex.max, ey.min, ey.max]
        end
        # group_id sau sort (giữ điều kiện cùng chi tiết — như trên).
        sorted_gids = sorted_loops.map { |lp| e0 = lp[:edges].first; e0 && e0[:group_id] ? e0[:group_id] : nil }
        sorted_contain_count = sorted_bboxes.each_with_index.map do |_inner, ii|
          sorted_bboxes.each_with_index.count do |_outer, jj|
            next false if ii == jj
            next false if sorted_gids[ii] && sorted_gids[jj] && sorted_gids[ii] != sorted_gids[jj]
            loop_inside_loop?(sorted_loops[ii][:edges], sorted_loops[jj][:edges])
          end
        end
        sorted_island_set = {}
        sorted_contain_count.each_with_index { |c, i| sorted_island_set[i] = true if c % 2 == 1 }

        # JS/Clipper là nguồn offset XY cho profile kín. Mở rộng một loop nguồn
        # thành nhiều loop pre-offset nếu Clipper tách hình; toàn bộ phần phát G-code
        # phía dưới (entry, ramp, multipass, Safe Z, arc...) vẫn được giữ nguyên.
        if app_settings[:profile_engine].to_s == 'clipper'
          profile_layer = (app_settings[:layer_name] || cfg[:layer]).to_s
          profile_key = "#{sheet_name}::#{profile_layer}"
          all_profile_paths = app_settings[:profile_paths] || {}
          records = all_profile_paths[profile_key] || all_profile_paths[profile_key.to_s] || []
          used_records = {}
          expanded_loops = []
          sorted_loops.each_with_index do |lp, si|
            is_isl = sorted_island_set[si] || false
            expected_strategy = (is_isl && cfg[:strategy] != :cut_in) ? 'cut_in' : cfg[:strategy].to_s
            key = profile_loop_key(lp[:edges])
            stable_id = profile_loop_id(lp[:edges])
            rec_i = records.each_index.find do |ri|
              next false if used_records[ri]
              rec = records[ri]
              rec_id = (rec['id'] || rec[:id]).to_s
              id_match = !rec_id.empty? ? (rec_id == stable_id) : ((rec['key'] || rec[:key]).to_s == key)
              id_match && (rec_id.empty? ?
                (rec['strategy'] || rec[:strategy]).to_s == expected_strategy : true)
            end
            # JS toFixed va Ruby format co the lam tron khac nhau 0.001 mm tai
            # diem nua. Neu ID chuoi khong khop, ghep theo cung group_id + bbox
            # trong dung sai 0.01 mm; van dung nguyen run XY cua JS.
            if rec_i.nil?
              target_geom = profile_loop_geometry(lp[:edges])
              candidates = records.each_index.map do |ri|
                next nil if used_records[ri]
                geom = profile_record_geometry(records[ri])
                next nil unless geom && target_geom && geom[0] == target_geom[0]
                delta = (1..4).map { |gi| (geom[gi]-target_geom[gi]).abs }.max
                delta <= 0.01 ? [ri,delta] : nil
              end.compact
              rec_i = candidates.min_by { |pair| pair[1] }&.first
            end
            # Fallback legacy khong dung hinh hoc offset tu JS. Ruby tu tinh lai
            # island/strategy, nen co the ghep theo khoa hinh hoc khi hai ben khac
            # nhau tai dung sai point-in-polygon. Record clipper van bat buoc khop strategy.
            if rec_i.nil?
              rec_i = records.each_index.find do |ri|
                next false if used_records[ri]
                rec = records[ri]
                rec_id = (rec['id'] || rec[:id]).to_s
                id_match = !rec_id.empty? ? (rec_id == stable_id) : ((rec['key'] || rec[:key]).to_s == key)
                id_match &&
                  (rec['mode'] || rec[:mode]).to_s == 'legacy'
              end
            end
            rec = rec_i.nil? ? nil : records[rec_i]
            runs = rec && (rec['runs'] || rec[:runs])
            mode = rec && (rec['mode'] || rec[:mode]).to_s
            if rec.nil?
              legacy_without_js = expected_strategy == 'cut_on' || !lp[:closed] ||
                                  profile_circle_like_js?(lp[:edges])
              if legacy_without_js
                expanded_loops << lp.merge(_n2g_island:is_isl)
                next
              end
              # JS có thể loại một loop rác cực nhỏ trước khi tạo record (ví dụ
              # bbox 0.117 x 0.350 mm với dao D6), trong khi Ruby build_loops vẫn
              # giữ lại. Không được fallback offset hoặc phát G-code cho loop mà
              # dao không thể chứa; bỏ qua an toàn khi người dùng tiếp tục xuất.
              # Loop đủ kích thước nhưng mất record vẫn là lỗi cứng như trước.
              if profile_layer.upcase.gsub(/[^A-Z0-9]/, '').include?('CUTTINGLINES') && lp[:closed]
                geom = profile_loop_geometry(lp[:edges])
                if geom
                  loop_w = (geom[2] - geom[1]).abs
                  loop_h = (geom[4] - geom[3]).abs
                  tool_d = cfg[:diameter].to_f.abs
                  next if tool_d > 0.0 && [loop_w, loop_h].min < tool_d - 0.001
                end
              end
              raise "Không ghép được Profile JS cho sheet '#{sheet_name}', layer '#{profile_layer}', loop '#{stable_id}'."
            elsif mode == 'skip'
              # Preview JS xac dinh tam dao khong con vung hop le (island qua nho).
              # Danh dau da dung record nhung khong dua loop vao danh sach xuat.
              used_records[rec_i] = true
              next
            elsif (mode == 'clipper' || mode == 'js_offset') && (!runs.is_a?(Array) || runs.empty?)
              raise "JS không tạo được offset Profile hợp lệ cho sheet '#{sheet_name}', layer '#{profile_layer}', loop '#{stable_id}'."
            elsif mode == 'clipper' || mode == 'js_offset'
              used_records[rec_i] = true
              rec_strategy = (rec['strategy'] || rec[:strategy]).to_s
              rec_island = rec_strategy == 'cut_in' && cfg[:strategy].to_s != 'cut_in'
              runs.each do |run|
                pts = (run || []).map do |p|
                  x = p['x'] || p[:x]; y = p['y'] || p[:y]
                  { x: x.to_f, y: y.to_f }
                end
                next if pts.size < 3
                pts.pop if pts.size > 3 && Math.hypot(pts[-1][:x]-pts[0][:x], pts[-1][:y]-pts[0][:y]) < 0.001
                meta = lp[:edges].first || {}
                pre_edges = pts.each_with_index.map do |a, pi|
                  b = pts[(pi + 1) % pts.size]
                  { x1:a[:x], y1:a[:y], x2:b[:x], y2:b[:y],
                    group_id:meta[:group_id], part_id:meta[:part_id], layer:meta[:layer] }
                end
                expanded_loops << { edges:pre_edges, closed:true, _n2g_preoffset:true,
                                    _n2g_source_edges:lp[:edges], _n2g_island:rec_island }
              end
            else # mode legacy: circle, cut_on hoặc đường hở
              used_records[rec_i] = true
              rec_strategy = (rec['strategy'] || rec[:strategy]).to_s
              rec_island = rec_strategy == 'cut_in' && cfg[:strategy].to_s != 'cut_in'
              expanded_loops << lp.merge(_n2g_island:rec_island)
            end
          end
          sorted_loops = expanded_loops
        end

        sorted_loops.each_with_index do |loop, loop_idx|
          is_island     = loop.key?(:_n2g_island) ? loop[:_n2g_island] : (sorted_island_set[loop_idx] || false)
          effective_cfg = (is_island && cfg[:strategy] != :cut_in) ? cfg.merge(strategy: :cut_in) : cfg
          edges         = loop[:edges]
          source_edges  = loop[:_n2g_source_edges] || edges
          feed          = effective_cfg[:feed]   || 2500
          z_feed        = effective_cfg[:z_feed] || 800

          all_x_lp = source_edges.flat_map { |e| [e[:x1], e[:x2]] }
          all_y_lp = source_edges.flat_map { |e| [e[:y1], e[:y2]] }
          bw_lp    = all_x_lp.max - all_x_lp.min
          bh_lp    = all_y_lp.max - all_y_lp.min
          cx_lp    = (all_x_lp.min + all_x_lp.max) / 2.0

          is_cutting_layer = cfg[:layer].to_s.downcase.include?('cuttinglines') ||
                             cfg[:layer].to_s.downcase.include?('cutting_lines')
          threshold     = (app_settings[:small_threshold] || 300.0).to_f
          antiflyout_on = app_settings[:antiflyout] != false
          is_small      = antiflyout_on && is_cutting_layer && [bw_lp, bh_lp].min < threshold && !is_island

          # Ramp entry: đoạn dốc xuống dao. Setting theo DAO (cfg), chỉ cuttinglines.
          ramp_on  = cfg[:ramp_on] == true
          ramp_len = (cfg[:ramp_len] || 20.0).to_f

          start_from_right = cx_lp < sheet_w / 2.0
          offset = case effective_cfg[:strategy]
                   when :cut_out then  effective_cfg[:diameter] / 2.0
                   when :cut_in  then -effective_cfg[:diameter] / 2.0
                   else 0.0
                   end

          # Nhận diện đường tròn kín ngay trên hình học NGUỒN, trước khi Ramp,
          # backoff hoặc offset chèn/chia điểm. Đường tròn nguồn dưới 24 segment
          # tuyệt đối không được lọt qua nhánh :arc hở sau đó.
          _source_closed = source_edges.any? &&
                           Math.hypot(source_edges.last[:x2]-source_edges.first[:x1],
                                      source_edges.last[:y2]-source_edges.first[:y1]) < 1.0
          _source_circle_fit = _source_closed ? fit_circle_gcode(
            source_edges.map { |e| { x:e[:x1], y:e[:y1] } }
          ) : nil
          _source_circle_tol = _source_circle_fit ? [0.10, _source_circle_fit[:r]*0.0005].max : 0.0
          _source_is_circle = _source_circle_fit &&
                              _source_circle_fit[:max_error] <= _source_circle_tol &&
                              (bw_lp-bh_lp).abs <= [bw_lp,bh_lp].max*0.02
          _source_low_seg_circle = _source_is_circle && source_edges.size < FULL_CIRCLE_MIN_SEGMENTS

          segments = if _source_low_seg_circle
                       edges.map { |e| { type: :line, edges:[e] } }
                     else
                       classify_segments(edges)
                     end
          arc_count  = segments.count { |s| s[:type] == :arc }
          line_count = segments.count { |s| s[:type] == :line }
          label = is_island ? "ISLAND cut_in" : is_small ? "SMALL anti-flyout" : "LARGE"
          begin
            c = fmt_comment("PROFILE #{edges.size}e - #{label} | #{arc_count} arcs + #{line_count} lines, offset=#{format('%.2f',offset)}mm", comment_style)
            f.puts c if c
          end

          # Rotate edges cho tấm nhỏ (anti-flyout)
          if is_small && edges.size >= 2
            long_horizontal = bw_lp >= bh_lp
            last_edge_i = if long_horizontal
              cy_loop    = (all_y_lp.min + all_y_lp.max) / 2.0
              candidates = (0...edges.size).select { |i| (edges[i][:y2] - edges[i][:y1]).abs < 1.0 }
              candidates.min_by { |i| ((edges[i][:y1] + edges[i][:y2]) / 2.0 - cy_loop).abs }
            else
              candidates = (0...edges.size).select { |i| (edges[i][:x2] - edges[i][:x1]).abs < 1.0 }
              if start_from_right
                candidates.min_by { |i| (edges[i][:x1] + edges[i][:x2]) / 2.0 }
              else
                candidates.max_by { |i| (edges[i][:x1] + edges[i][:x2]) / 2.0 }
              end
            end

            if last_edge_i
              start_i = if !long_horizontal
                opposite_x   = start_from_right ? all_x_lp.max : all_x_lp.min
                start_cands  = (0...edges.size).select { |i|
                  (edges[i][:x2]-edges[i][:x1]).abs < 1.0 &&
                  ((edges[i][:x1]+edges[i][:x2])/2.0 - opposite_x).abs < 2.0
                }
                start_cands.first || (last_edge_i + 1) % edges.size
              else
                (last_edge_i + 1) % edges.size
              end
              edges    = edges[start_i..-1] + edges[0...start_i]
              segments = classify_segments(edges)
            end
          end

          if offset.abs < 0.001
            # ── cut_on: đi thẳng theo edges ──────────────────────────────────
            start = edges.first
            state = {}
            if ramp_on
              ramp_pts = [{ x:start[:x1], y:start[:y1] }]
              edges.each { |e| ramp_pts << { x:e[:x2], y:e[:y2] } }
              closed_on = loop[:closed] == true
              if closed_on && ramp_pts.size > 2 &&
                 Math.hypot(ramp_pts[-1][:x]-ramp_pts[0][:x], ramp_pts[-1][:y]-ramp_pts[0][:y]) < 0.001
                ramp_pts.pop
              end
              levels = effective_cfg[:z_levels]
              levels = [effective_cfg[:depth].to_f] unless levels.is_a?(Array) && !levels.empty?
              prev_z = (effective_cfg[:z_top] || 0.0).to_f
              levels.each do |zl|
                f.puts "G0 X#{format('%.3f',ramp_pts[0][:x])} Y#{format('%.3f',ramp_pts[0][:y])}"
                rl = closed_on ?
                     ramp_entry_lines(ramp_pts, zl.to_f, prev_z, ramp_len, z_feed, feed) :
                     ramp_open_entry_lines(ramp_pts, zl.to_f, prev_z, ramp_len, z_feed, feed)
                rl.to_a.each { |line| f.puts line }
                f.puts "G0 Z#{format('%.1f',clear_z)}"
                prev_z = zl.to_f
              end
              next
            end
            f.puts "G0 X#{format('%.3f', start[:x1])} Y#{format('%.3f', start[:y1])}"

            # ── NHIỀU LƯỢT XUỐNG DAO (như cut_out/cut_in) ─────────────────────
            # Các lượt TRÊN (trừ cuối) chạy hết đường ở Z nông, KHÔNG nhấc dao,
            # KHÔNG double_cut (double_cut chỉ ở lượt cuối khi tấm sắp đứt).
            # Trợ giúp chạy 1 vòng theo segments tại 1 mức Z cho trước.
            _run_cut_on = lambda do |st|
              segments.each do |seg|
                if seg[:type] == :full_circle
                  sx = seg[:edges].first[:x1]; sy = seg[:edges].first[:y1]
                  emit_full_circle_quadrants(f, seg[:cx], seg[:cy], sx, sy, feed, cw: true, state: st)
                elsif seg[:type] == :line
                  e = seg[:edges].first
                  fp = st[:f] == feed ? "" : " F#{feed}"
                  f.puts "G1 X#{format('%.3f', e[:x2])} Y#{format('%.3f', e[:y2])}#{fp}"
                  st[:f] = feed
                else
                  ae = seg[:edges]
                  ex = ae.last[:x2]; ey = ae.last[:y2]
                  sx = ae.first[:x1]; sy = ae.first[:y1]
                  iv = seg[:cx] - sx; jv = seg[:cy] - sy
                  gc = seg[:cw] ? "G02" : "G03"
                  fp = st[:f] == feed ? "" : " F#{feed}"
                  f.puts "#{gc} X#{format('%.3f',ex)} Y#{format('%.3f',ey)} I#{format('%.3f',iv)} J#{format('%.3f',jv)}#{fp}"
                  st[:f] = feed
                end
              end
            end
            _zl_on = effective_cfg[:z_levels]
            emit_upper_passes(_zl_on) do |zl|
              st_up = { f: z_feed }
              f.puts "G1 Z#{format('%.3f',zl)} F#{z_feed}"
              _run_cut_on.call(st_up)
              # Nhấc lên safe-Z rồi về điểm đầu trước lượt kế tiếp.
              f.puts "G0 Z#{format('%.1f',clear_z)}"
              f.puts "G0 X#{format('%.3f', start[:x1])} Y#{format('%.3f', start[:y1])}"
            end

            f.puts "G1 Z#{format('%.3f', cfg[:depth].to_f)} F#{z_feed}"
            state[:f] = z_feed

            segments.each_with_index do |seg, si|
              is_last_seg = is_small && (si == segments.size - 1)
              if seg[:type] == :full_circle
                sx    = seg[:edges].first[:x1]; sy = seg[:edges].first[:y1]
                emit_full_circle_quadrants(f, seg[:cx], seg[:cy], sx, sy, feed, cw: true, state: state)
              elsif seg[:type] == :line
                e          = seg[:edges].first
                double_cut = app_settings[:double_cut] != false
                if is_last_seg && double_cut
                  partial_z = [effective_cfg[:depth].to_f + 2.5, -0.5].min
                  f.puts "G1 Z#{format('%.3f', partial_z)} F#{z_feed}"
                  f_part = state[:f] == feed ? "" : " F#{feed}"
                  f.puts "G1 X#{format('%.3f', e[:x2])} Y#{format('%.3f', e[:y2])}#{f_part}"
                  state[:f] = feed
                  f.puts "G0 Z#{format('%.1f', clear_z)}"
                  f.puts "G0 X#{format('%.3f', e[:x1])} Y#{format('%.3f', e[:y1])}"
                  f.puts "G1 Z#{format('%.3f', cfg[:depth].to_f)} F#{z_feed}"
                  state[:f] = z_feed
                  f_part2 = state[:f] == feed ? "" : " F#{feed}"
                  f.puts "G1 X#{format('%.3f', e[:x2])} Y#{format('%.3f', e[:y2])}#{f_part2}"
                  state[:f] = feed
                else
                  f_part = state[:f] == feed ? "" : " F#{feed}"
                  f.puts "G1 X#{format('%.3f', e[:x2])} Y#{format('%.3f', e[:y2])}#{f_part}"
                  state[:f] = feed
                end
              else
                arc_edges = seg[:edges]
                ex    = arc_edges.last[:x2];  ey    = arc_edges.last[:y2]
                sx    = arc_edges.first[:x1]; sy    = arc_edges.first[:y1]
                i_val = seg[:cx] - sx;         j_val = seg[:cy] - sy
                gcmd  = seg[:cw] ? "G02" : "G03"
                f_part = state[:f] == feed ? "" : " F#{feed}"
                f.puts "#{gcmd} X#{format('%.3f',ex)} Y#{format('%.3f',ey)} I#{format('%.3f',i_val)} J#{format('%.3f',j_val)}#{f_part}"
                state[:f] = feed
              end
            end
            f.puts "G0 Z#{format('%.1f', clear_z)}"
            state[:f] = nil

          else
            # ── cut_in / cut_out: dùng offset_loop ───────────────────────────
            is_open = !loop[:closed]

            if is_open
              # Offset 1 bên theo TÂM bbox (KHÔNG phụ thuộc chiều vẽ): cut_out = ra
              # XA tâm (mặt ngoài), cut_in = về GẦN tâm (mặt trong). Áp cho C/L/U và
              # mọi hướng. Mở rộng thuật toán ABF_MARK_SQUARE (vốn chỉ xét xa-tâm cho
              # cạnh xiên) sang áp cho MỌI cạnh đứng/ngang/xiên như nhau.
              _xs = edges.flat_map { |e| [e[:x1], e[:x2]] }
              _ys = edges.flat_map { |e| [e[:y1], e[:y2]] }
              ocx = (_xs.min + _xs.max) / 2.0
              ocy = (_ys.min + _ys.max) / 2.0
              half_d   = offset.abs
              want_out = (effective_cfg[:strategy] == :cut_out)
              # Vector dời của 1 cạnh: pháp tuyến hướng RA XA tâm, rồi nhân dấu theo
              # cut_out (ra xa, +) / cut_in (vào gần, -).
              shift = lambda do |x1, y1, x2, y2|
                dx = x2 - x1; dy = y2 - y1; len = Math.hypot(dx, dy)
                next [0.0, 0.0] if len < 1e-6
                nx = -dy / len; ny = dx / len
                mx = (x1 + x2) / 2.0; my = (y1 + y2) / 2.0
                if nx * (mx - ocx) + ny * (my - ocy) < 0   # pháp tuyến đang hướng về tâm → đảo ra xa
                  nx = -nx; ny = -ny
                end
                s = want_out ? half_d : -half_d
                [nx * s, ny * s]
              end

              off_pts = []
              n = edges.size
              e0 = edges[0]
              s0 = shift.call(e0[:x1], e0[:y1], e0[:x2], e0[:y2])
              off_pts << { x: e0[:x1] + s0[0], y: e0[:y1] + s0[1] } unless s0 == [0.0, 0.0]

              (0...n - 1).each do |i|
                e1 = edges[i]; e2 = edges[i + 1]
                dx1 = e1[:x2] - e1[:x1]; dy1 = e1[:y2] - e1[:y1]; len1 = Math.sqrt(dx1**2 + dy1**2)
                dx2 = e2[:x2] - e2[:x1]; dy2 = e2[:y2] - e2[:y1]; len2 = Math.sqrt(dx2**2 + dy2**2)
                next if len1 < 0.01 || len2 < 0.01
                s1 = shift.call(e1[:x1], e1[:y1], e1[:x2], e1[:y2])
                s2 = shift.call(e2[:x1], e2[:y1], e2[:x2], e2[:y2])
                ox1 = e1[:x2] + s1[0]; oy1 = e1[:y2] + s1[1]
                ox2 = e2[:x1] + s2[0]; oy2 = e2[:y1] + s2[1]
                denom = dx1 * dy2 - dy1 * dx2
                if denom.abs < 0.001
                  off_pts << { x: (ox1 + ox2) / 2.0, y: (oy1 + oy2) / 2.0 }
                else
                  t    = ((ox2 - ox1) * dy2 - (oy2 - oy1) * dx2) / denom
                  ix   = ox1 + t * dx1; iy = oy1 + t * dy1
                  dist = Math.sqrt((ix - e1[:x2])**2 + (iy - e1[:y2])**2)
                  off_pts << (dist > half_d * 3 ? { x: (ox1 + ox2) / 2.0, y: (oy1 + oy2) / 2.0 } : { x: ix, y: iy })
                end
              end

              eL = edges[n - 1]
              sL = shift.call(eL[:x1], eL[:y1], eL[:x2], eL[:y2])
              off_pts << { x: eL[:x2] + sL[0], y: eL[:y2] + sL[1] } unless sL == [0.0, 0.0]

              next if off_pts.size < 2
              f.puts "G0 X#{format('%.3f',off_pts[0][:x])} Y#{format('%.3f',off_pts[0][:y])}"
              _zl_op = effective_cfg[:z_levels]
              if ramp_on
                levels = _zl_op.is_a?(Array) && !_zl_op.empty? ? _zl_op : [effective_cfg[:depth].to_f]
                prev_z = (effective_cfg[:z_top] || 0.0).to_f
                levels.each do |zl|
                  f.puts "G0 X#{format('%.3f',off_pts[0][:x])} Y#{format('%.3f',off_pts[0][:y])}"
                  ramp_open_entry_lines(off_pts, zl.to_f, prev_z, ramp_len, z_feed, feed).to_a.each { |l| f.puts l }
                  f.puts "G0 Z#{format('%.1f',clear_z)}"
                  prev_z = zl.to_f
                end
              else
                # Nhiều lượt: nhấc lên safe-Z và về đầu path sau mỗi lượt trên.
                emit_upper_passes(_zl_op) do |zl|
                  f.puts "G1 Z#{format('%.3f',zl)} F#{z_feed}"
                  off_pts[1..].each { |pt| f.puts "G1 X#{format('%.3f',pt[:x])} Y#{format('%.3f',pt[:y])} F#{feed}" }
                  f.puts "G0 Z#{format('%.1f',clear_z)}"
                  f.puts "G0 X#{format('%.3f',off_pts[0][:x])} Y#{format('%.3f',off_pts[0][:y])}"
                end
                f.puts "G1 Z#{format('%.3f',effective_cfg[:depth].to_f)} F#{z_feed}"
                off_pts[1..].each { |pt| f.puts "G1 X#{format('%.3f',pt[:x])} Y#{format('%.3f',pt[:y])} F#{feed}" }
              end
              f.puts "G0 Z#{format('%.1f',clear_z)}" unless ramp_on
              next
            end

            # Full circle với offset
            if !loop[:_n2g_preoffset] && segments.size == 1 && segments[0][:type] == :full_circle
              seg     = segments[0]
              raw_r_new = seg[:r] + offset
              # cut_in tron nho hon dao: khong ep R=1mm va khong tao toolpath gia.
              next if effective_cfg[:strategy] == :cut_in && raw_r_new <= 0.001
              r_new   = [raw_r_new, 1.0].max
              start_x = (seg[:cx] + r_new).round(3)
              start_y = seg[:cy].round(3)
              f.puts "G0 X#{format('%.3f',start_x)} Y#{format('%.3f',start_y)}"
              if ramp_on
                circle_pts = 72.times.map do |i|
                  a = -i * 2.0 * Math::PI / 72.0
                  { x:seg[:cx] + r_new*Math.cos(a), y:seg[:cy] + r_new*Math.sin(a) }
                end
                levels = effective_cfg[:z_levels]
                levels = [effective_cfg[:depth].to_f] unless levels.is_a?(Array) && !levels.empty?
                prev_z = (effective_cfg[:z_top] || 0.0).to_f
                levels.each do |zl|
                  f.puts "G0 X#{format('%.3f',start_x)} Y#{format('%.3f',start_y)}"
                  ramp_entry_lines(circle_pts, zl.to_f, prev_z, ramp_len, z_feed, feed).to_a.each { |l| f.puts l }
                  f.puts "G0 Z#{format('%.1f',clear_z)}"
                  prev_z = zl.to_f
                end
                next
              end
              # Nhiều lượt: mỗi lượt trên hạ Z nông rồi cắt trọn 1 vòng tròn.
              _zl_c = effective_cfg[:z_levels]
              emit_upper_passes(_zl_c) do |zl|
                f.puts "G1 Z#{format('%.3f',zl)} F#{z_feed}"
                emit_full_circle_quadrants(f, seg[:cx], seg[:cy], start_x, start_y, feed, cw: true)
                f.puts "G0 Z#{format('%.1f',clear_z)}"
                f.puts "G0 X#{format('%.3f',start_x)} Y#{format('%.3f',start_y)}"
              end
              f.puts "G1 Z#{format('%.3f',effective_cfg[:depth].to_f)} F#{z_feed}"
              emit_full_circle_quadrants(f, seg[:cx], seg[:cy], start_x, start_y, feed, cw: true)
              f.puts "G0 Z#{format('%.1f',clear_z)}"
              next
            end

            # Closed path với offset — CCW entry point
            # Dedupe edges trùng nhau trước khi offset
            deduped = []
            seen_e = {}
            edges.each do |e|
              k1 = "#{e[:x1].round(2)},#{e[:y1].round(2)},#{e[:x2].round(2)},#{e[:y2].round(2)}"
              k2 = "#{e[:x2].round(2)},#{e[:y2].round(2)},#{e[:x1].round(2)},#{e[:y1].round(2)}"
              unless seen_e[k1] || seen_e[k2]
                seen_e[k1] = true
                deduped << e
              end
            end
            # Lọc bỏ edge ngắn bị đảo chiều (< 2mm và dot < -0.5 với edge trước)
            clean_edges = []
            skip_next = false
            deduped.each_with_index do |e, i|
              if skip_next
                skip_next = false
                next
              end
              prev_e = clean_edges.last || deduped[(i-1+deduped.size)%deduped.size]
              dx1 = prev_e[:x2]-prev_e[:x1]; dy1 = prev_e[:y2]-prev_e[:y1]
              len1 = Math.sqrt(dx1**2+dy1**2)
              dx2 = e[:x2]-e[:x1]; dy2 = e[:y2]-e[:y1]
              len2 = Math.sqrt(dx2**2+dy2**2)
              if len1 > 0.01 && len2 < 2.0 && len2 > 0.01
                dot = (dx1*dx2 + dy1*dy2) / (len1*len2)
                next if dot < -0.5  # bỏ edge ngắn đảo chiều
              end
              clean_edges << e
            end
            # Loop kín: dùng miter join (khớp preview JS, không méo ở mộng dương).
            # cut_out: offset=+d/2, ra ngoài cần dist âm (bbox lớn hơn) → -offset. Khớp JS.
            # Bo cung góc nhọn CHỈ khi cắt NGOÀI: cung nằm ngoài vật liệu nên an toàn,
            # tránh đỉnh miter vọt xa. Cắt TRONG (cut_in/island) giữ miter — bo cung sẽ
            # đưa dao tới quá gần đỉnh nhọn và cắt lẹm ra ngoài biên dạng.
            off_pts = if loop[:_n2g_preoffset]
              clean_edges.map { |e| { x:e[:x1], y:e[:y1] } }
            else
              offset_polygon_miter(clean_edges, -offset, effective_cfg[:strategy] == :cut_out)
            end
            next if off_pts.size < 3

            # ── CHUẨN HÓA CHIỀU CHẠY theo thiết lập cut_dir ────────────────────
            # Winding của loop gốc KHÔNG đồng nhất: cách vẽ trong SketchUp khác nhau,
            # và nesting hay LẬT GƯƠNG (mirror) chi tiết để xếp tối ưu — phép lật đảo
            # winding → cùng một chi tiết lại chạy ngược chiều nhau. Ép về đúng chiều:
            #   cut_out → theo cut_dir
            #   cut_in / island → NGƯỢC cut_dir. Vì dao bù sang phía đối diện khi cắt
            #     trong, phải đảo chiều thì mới CÙNG kiểu phay thuận (climb) như cắt
            #     ngoài → cạnh lỗ mịn hơn. KHỚP JS simApplyCutDir.
            # Hướng hiệu lực: nếu DAO chọn cw/ccw thì ưu tiên dao; else theo cài đặt
            # chung (Chống bay ván). cfg[:direction] cho profile là 'auto'/cw/ccw.
            # Hướng cắt: nếu DAO đã chọn cw/ccw thì dùng của dao; nếu chưa chỉnh
            # (nil) thì theo cài đặt chung (Chống bay ván).
            _eff_dir = ['cw', 'ccw'].include?(cfg[:direction].to_s) ?
                       cfg[:direction].to_s : (app_settings[:cut_dir] || 'ccw').to_s
            _cd = _eff_dir
            _sa = 0.0
            off_pts.each_with_index do |p, _i|
              q = off_pts[(_i + 1) % off_pts.size]
              _sa += p[:x] * q[:y] - q[:x] * p[:y]
            end
            _want_ccw = (_cd == 'ccw')
            _want_ccw = !_want_ccw if effective_cfg[:strategy] == :cut_in
            off_pts = off_pts.reverse if (_sa > 0) != _want_ccw

            # Xác định vùng loop trong sheet → chọn entry corner
            lp_cx = (all_x_lp.min + all_x_lp.max) / 2.0
            lp_cy = (all_y_lp.min + all_y_lp.max) / 2.0
            lp_x_min = all_x_lp.min; lp_x_max = all_x_lp.max
            lp_y_min = all_y_lp.min; lp_y_max = all_y_lp.max
            thresh_bot = (app_settings[:thresh_bot] || 300.0).to_f
            thresh_top = (app_settings[:thresh_top] || 300.0).to_f
            cut_dir    = _eff_dir

            # QUY TẮC vùng TRÊN/DƯỚI — phải thỏa CẢ HAI (khớp JS getStartPointJS):
            #   1. Tấm nằm NGANG (rộng > cao)
            #   2. Tấm lọt 100% trong dải ngưỡng (dùng bbox, KHÔNG dùng tâm)
            lp_w = lp_x_max - lp_x_min
            lp_h = lp_y_max - lp_y_min
            is_horiz = lp_w > lp_h

            zone = if is_horiz && lp_y_max <= thresh_bot
              :bottom
            elsif is_horiz && lp_y_min >= sheet_h - thresh_top
              :top
            elsif lp_cx < sheet_w / 2.0
              :left
            else
              :right
            end

            # Entry corner theo SETTING người dùng (afv_sel[zone]), khớp với JS preview.
            # idx góc (canvas y-down): 0=trên-trái 1=trên-phải 2=dưới-phải 3=dưới-trái
            # → CNC (y-up): 0→(Xmin,Ymax) 1→(Xmax,Ymax) 2→(Xmax,Ymin) 3→(Xmin,Ymin)
            # ƯU TIÊN 1: override thủ công — TỌA ĐỘ ĐỈNH (tab Xem đường dao).
            ov_pt = find_entry_override(app_settings, source_edges,
                                        lp_x_min, lp_x_max, lp_y_min, lp_y_max)
            afv_sel = app_settings[:afv_sel] || {}
            sel     = afv_sel[zone.to_s] || afv_sel[zone]
            entry_corner = if ov_pt
              ov_pt
            elsif sel
              case sel.to_i
              when 0 then { x: all_x_lp.min, y: all_y_lp.max }
              when 1 then { x: all_x_lp.max, y: all_y_lp.max }
              when 2 then { x: all_x_lp.max, y: all_y_lp.min }
              else        { x: all_x_lp.min, y: all_y_lp.min }
              end
            elsif cut_dir == 'ccw'
              case zone
              when :left   then { x: all_x_lp.max, y: all_y_lp.max }
              when :right  then { x: all_x_lp.min, y: all_y_lp.min }
              when :top    then { x: all_x_lp.max, y: all_y_lp.min }
              when :bottom then { x: all_x_lp.min, y: all_y_lp.max }
              end
            else
              case zone
              when :left   then { x: all_x_lp.min, y: all_y_lp.min }
              when :right  then { x: all_x_lp.max, y: all_y_lp.max }
              when :top    then { x: all_x_lp.min, y: all_y_lp.max }
              when :bottom then { x: all_x_lp.max, y: all_y_lp.min }
              end
            end

            # ── ĐIỂM XUỐNG DAO: ưu tiên nằm trên ĐOẠN THẲNG, tránh đoạn cong ──
            # Bật/tắt bằng cài đặt "Tránh đoạn cong". CHỈ áp cho cuttinglines.
            # Xuống dao giữa cung làm mặt cắt bị gợn. Không có đoạn thẳng nào (chi
            # tiết toàn cung) → quay về cách cũ: snap vào điểm gần entry_corner nhất.
            # Preserve a manual override. Otherwise, for a clear rectangle,
            # prefer a corner whose final cut edge is the long edge.
            entry_corner = prefer_long_final_entry(
              source_edges, off_pts, entry_corner, app_settings[:long_final_edge] != false
            ) unless ov_pt

            _avoid_cv   = (app_settings[:avoid_curve] == true)
            _is_cutting = cfg[:layer].to_s.upcase.gsub(/[^A-Z]/, '').include?('CUTTING')
            _d_back_se = (app_settings[:entry_backoff] == true) ?
                         (app_settings[:entry_backoff_mm] || 10).to_f : 0.0
            _min_seg   = [effective_cfg[:diameter].to_f * 3.0, 15.0].max
            _sp = (_avoid_cv && _is_cutting) ?
                  straight_entry_point(off_pts, entry_corner, _min_seg, _d_back_se) : nil

            if _sp
              _n0 = off_pts.size
              _rot = [{ x: _sp[:x], y: _sp[:y] }]
              ((_sp[:seg] + 1)...(_sp[:seg] + 1 + _n0)).each { |k| _rot << off_pts[k % _n0] }
              off_pts = _rot
              entry_on_straight = true
            else
              start_i = (0...off_pts.size).min_by { |i|
                pt = off_pts[i]
                (pt[:x]-entry_corner[:x])**2 + (pt[:y]-entry_corner[:y])**2
              }
              off_pts = off_pts[start_i..] + off_pts[0...start_i]
              entry_on_straight = false
            end

            # ── RAMP ENTRY (đoạn dốc xuống dao) ─────────────────────────────
            # Thay lượt xuống dao đầu bằng đoạn dốc. Chỉ cuttinglines, khi bật, và
            # KHÔNG multipass (cắt xuyên 1 lượt — phổ biến nhất). Ramp thay LUÔN
            # backoff + anti-flyout của lượt này (dao đã vào từ từ nên không cần
            # anti-flyout chống giật). off_pts hiện là vòng kín đã xoay về điểm
            # xuống dao ở đoạn thẳng — đúng thứ ramp cần.
            _zl_ramp = effective_cfg[:z_levels]
            # Lùi điểm xuống dao cho RAMP: nếu bật "lùi điểm xuống dao" (entry_backoff)
            # mà điểm CHƯA được lùi qua straight-entry (avoid_curve tắt) thì lùi ngược
            # chiều cắt d_back mm ở đây — để ramp bắt đầu từ điểm đã lùi, khớp mô phỏng
            # (JS áp backoff cho offPts TRƯỚC khi vẽ ramp).
            _bk_on = is_cutting_layer && app_settings[:entry_backoff] == true &&
                     (app_settings[:entry_backoff_mm] || 0).to_f > 0
            _ramp_pts = (_bk_on && !entry_on_straight) ?
                        backoff_start(off_pts, (app_settings[:entry_backoff_mm] || 10).to_f) : off_pts
            if ramp_on && _ramp_pts.size >= 2
              levels = _zl_ramp.is_a?(Array) && !_zl_ramp.empty? ? _zl_ramp : [effective_cfg[:depth].to_f]
              prev_z = (effective_cfg[:z_top] || 0.0).to_f
              levels.each do |zl|
                f.puts "G0 X#{format('%.3f',_ramp_pts[0][:x])} Y#{format('%.3f',_ramp_pts[0][:y])}"
                rl = ramp_entry_lines(
                  _ramp_pts, zl.to_f, prev_z, ramp_len, z_feed, feed,
                  arc_min_r: ((is_cutting_layer && !_source_low_seg_circle &&
                               app_settings.fetch(:arc_interp, false) == true) ?
                              (app_settings[:arc_min_r] || 60.0).to_f : nil)
                )
                rl.to_a.each { |line| f.puts line }
                f.puts "G0 Z#{format('%.1f',clear_z)}"
                prev_z = zl.to_f
              end
              next
            end

            # ── LÙI ĐIỂM XUỐNG DAO + CẮT CHỒNG (chỉ cuttinglines, khi bật) ──
            # Lùi d mm ngược chiều cắt → hạ dao sớm hơn; cắt hết vòng rồi cắt lố
            # thêm 1 bán kính dao để đứt hẳn, không để lại gờ nối (witness mark).
            backoff_on = is_cutting_layer &&
                         app_settings[:entry_backoff] == true &&
                         (app_settings[:entry_backoff_mm] || 0).to_f > 0
            if backoff_on
              d_back  = (app_settings[:entry_backoff_mm] || 10).to_f
              # Điểm vào đã được đặt LÙI SẴN trong đoạn thẳng ở trên → không lùi lần
              # nữa (sẽ lùi 2 lần và có thể trôi ngược vào cung). Chỉ đóng vòng.
              off_pts = entry_on_straight ? (off_pts + [off_pts[0]])
                                          : backoff_start(off_pts, d_back)
              closed_n = off_pts.size                    # số điểm của vòng kín
              tool_r  = effective_cfg[:diameter].to_f / 2.0
              off_pts = off_pts + overlap_points(off_pts, tool_r)
            else
              off_pts  = off_pts + [off_pts[0]]          # đóng vòng như cũ
              closed_n = off_pts.size
            end
            start_pt = off_pts[0]

            # ── NHIỀU LƯỢT XUỐNG DAO ─────────────────────────────────────────
            # z_levels: mảng mức Z (âm), phần tử CUỐI = đáy thật. 1 phần tử = như cũ.
            # Các lượt TRÊN (trừ cuối): chỉ chạy vòng đơn giản ở Z nông, KHÔNG
            # double_cut/slowdown/backoff (những cái đó chỉ ở lượt cuối khi tấm sắp đứt).
            z_levels = effective_cfg[:z_levels]
            z_levels = [effective_cfg[:depth].to_f] unless z_levels.is_a?(Array) && z_levels.size >= 1
            final_z  = effective_cfg[:depth].to_f

            f.puts "G0 X#{format('%.3f',start_pt[:x])} Y#{format('%.3f',start_pt[:y])}"

            # Các lượt TRÊN: sau mỗi vòng nhấc lên safe-Z và về lại điểm đầu.
            if z_levels.size > 1
              state_mp = { x: start_pt[:x], y: start_pt[:y], z: nil, f: nil }
              z_levels[0...-1].each do |zl|
                # Dao đang ở safe-Z tại điểm đầu; hạ xuống mức của lượt này.
                f.puts gcode_line('G1', z: zl.to_f, f: z_feed, state: state_mp)
                # Chạy hết vòng (bỏ điểm cắt chồng của backoff — lượt trên không cần)
                upper_last = closed_n - 1   # index điểm cuối vòng kín trong off_pts
                (1..upper_last).each do |pi|
                  pt = off_pts[pi]
                  f.puts gcode_line('G1', x: pt[:x], y: pt[:y], f: feed, state: state_mp)
                end
                # Luôn nhấc dao và xác lập lại điểm đầu trước lượt kế tiếp.
                f.puts "G0 Z#{format('%.1f',clear_z)}"
                state_mp[:z] = clear_z
                f.puts "G0 X#{format('%.3f',start_pt[:x])} Y#{format('%.3f',start_pt[:y])}"
                state_mp[:x] = start_pt[:x]
                state_mp[:y] = start_pt[:y]
              end
              # Sau các lượt trên, dao ở start_pt tại safe-Z.
            end

            # ── LƯỢT CUỐI (đáy thật) — GIỮ NGUYÊN toàn bộ logic cũ ──────────────
            f.puts "G1 Z#{format('%.3f',final_z)} F#{z_feed}"
            cur_x = start_pt[:x]; cur_y = start_pt[:y]
            state = { x: start_pt[:x], y: start_pt[:y], z: final_z, f: nil }

            # Khoảng cách từ mỗi điểm tới CUỐI đường (off_pts[-1]) — để trải giảm tốc
            # 100mm cuối qua NHIỀU cạnh, không chỉ cạnh cuối. Khớp ý: giảm ngay từ ĐẦU
            # đoạn 100mm cuối, kể cả khi cạnh cuối ngắn hơn 100mm.
            _seq = off_pts
            _ns  = _seq.size
            _d2e = Array.new(_ns, 0.0)
            (_ns - 2).downto(0) do |i|
              _d2e[i] = _d2e[i + 1] + Math.sqrt((_seq[i+1][:x]-_seq[i][:x])**2 + (_seq[i+1][:y]-_seq[i][:y])**2)
            end
            _slow_glob = is_small && app_settings[:slowdown] == true
            _slow_dist = 100.0
            _feed_slow = (feed * 0.5).to_i

            # Nội suy CUNG G02/G03: chỉ cuttinglines, khi bật. Cung R >= arc_min_r được
            # thay bằng 1 lệnh G02/G03 (I J) thay vì nhiều G01 → bề mặt mượt. Cung không
            # chạm cạnh cuối/điểm chồng (để không đụng double_cut/slowdown-tách).
            # Mặc định TẮT; chỉ nội suy khi người dùng chủ động bật trong cài đặt.
            _arc_on    = is_cutting_layer && !_source_low_seg_circle &&
                         app_settings.fetch(:arc_interp, false) == true
            _arc_min_r = (app_settings[:arc_min_r] || 60.0).to_f
            _arc_at    = {}
            if _arc_on
              detect_arcs_gcode(off_pts, _arc_min_r).each do |a|
                arc_limit = closed_n - 2
                if a[:e] <= arc_limit
                  _arc_at[a[:s]] = a
                elsif a[:wrap] && a[:s] < arc_limit
                  # Giữ cạnh cuối tách riêng cho double_cut/slowdown, chỉ nội suy
                  # phần cung vòng nằm trước cạnh đó.
                  _arc_at[a[:s]] = a.merge(e: arc_limit)
                end
              end
            end

            pi = 1
            while pi < off_pts.size
              pt = off_pts[pi]
              is_last = is_small && (pi - 1 == closed_n - 2)
              dbl_on  = is_last && app_settings[:double_cut] != false

              # ── CUNG: đầu cung tại off_pts[pi-1] → emit G02/G03 rồi nhảy tới cuối cung ──
              _arc = _arc_at[pi - 1]
              if _arc && !dbl_on
                ex = off_pts[_arc[:e]][:x]; ey = off_pts[_arc[:e]][:y]
                _center = equalize_arc_center(
                  { x: cur_x, y: cur_y }, { x: ex, y: ey }, _arc[:cx], _arc[:cy]
                )
                i_off = _center[:x] - cur_x; j_off = _center[:y] - cur_y
                _fe = (_slow_glob && _d2e[_arc[:e]] < _slow_dist) ? _feed_slow : feed
                _dir = arc_dir_gcode(off_pts, _arc)
                f.puts "#{_dir} X#{format('%.3f',ex)} Y#{format('%.3f',ey)} I#{format('%.3f',i_off)} J#{format('%.3f',j_off)} F#{_fe}"
                state[:x] = ex; state[:y] = ey; state[:f] = _fe
                cur_x = ex; cur_y = ey
                pi = _arc[:e] + 1
                next
              end

              d_start = _d2e[pi - 1]  # đầu cạnh → cuối đường
              d_pt    = _d2e[pi]      # cuối cạnh → cuối đường

              # emit 1 cạnh với giảm tốc trải theo 100mm cuối. Nếu cạnh vắt qua mốc
              # 100mm thì tách: phần trước mốc feed thường, phần sau feed chậm.
              emit_slow_edge = lambda do |sx, sy|
                if _slow_glob && d_start > _slow_dist && d_pt < _slow_dist
                  ratio = (d_start - _slow_dist) / (d_start - d_pt)
                  mid_x = sx + (pt[:x]-sx) * ratio
                  mid_y = sy + (pt[:y]-sy) * ratio
                  f.puts gcode_line('G1', x: mid_x, y: mid_y, f: feed,       state: state)
                  f.puts gcode_line('G1', x: pt[:x], y: pt[:y], f: _feed_slow, state: state)
                else
                  _fe = (_slow_glob && d_start <= _slow_dist) ? _feed_slow : feed
                  f.puts gcode_line('G1', x: pt[:x], y: pt[:y], f: _fe, state: state)
                end
              end

              if dbl_on
                # Cắt cạnh cuối 2 lần: lần 1 nông (chưa đứt), lần 2 đúng depth.
                dc_offset = (app_settings[:dc_offset] || 2.5).to_f
                partial_z = effective_cfg[:depth].to_f + dc_offset
                last_sx = cur_x; last_sy = cur_y
                f.puts gcode_line('G1', z: partial_z, f: z_feed, state: state)
                emit_slow_edge.call(last_sx, last_sy)
                f.puts "G0 Z#{format('%.1f',clear_z)}"
                state[:z] = clear_z
                f.puts gcode_line('G0', x: last_sx, y: last_sy, state: state)
                f.puts gcode_line('G1', z: effective_cfg[:depth].to_f, f: z_feed, state: state)
                emit_slow_edge.call(last_sx, last_sy)
              else
                emit_slow_edge.call(cur_x, cur_y)
              end
              cur_x = pt[:x]; cur_y = pt[:y]
              pi += 1
            end
            f.puts "G0 Z#{format('%.1f',clear_z)}"
          end
        end
      end

      # ── V-Bit profile cut_in (vát góc / chamfer) ──────────────────────────────
      # Hàm RIÊNG cho dao V-Bit, KHÔNG đụng tới write_profile/pocket/drill.
      # Cơ chế (khớp G-code mẫu đã xác nhận):
      #   - Dao xuống tại GÓC loop gốc ở Z = mặt ván (stock_top)
      #   - Chạy chéo (G1) đến điểm OFFSET L tương ứng ở Z = đáy (stock_top - depth)
      #   - Chạy dọc các cạnh ở Z đáy (offset L vào trong, song song loop gốc)
      #   - Tại mỗi góc: ramp lên về góc gốc (Z mặt ván) rồi lại chéo xuống offset kế
      #   L = depth / tan(90 - angle/2);  offset theo mỗi trục (miter join)
      def self.write_vbit_profile(f, lines, cfg, clear_z, sheet_w=9999, sheet_h=9999, app_settings={})
        comment_style = cfg[:comment_style] || app_settings[:comment_style] || 'off'
        raw = lines.reject { |l| l[:is_drill_center] }
                   .select { |l| Math.sqrt((l[:x2]-l[:x1])**2 + (l[:y2]-l[:y1])**2) > 0.1 }
        raw_loops = build_loops(raw)

        angle      = (cfg[:vbit_angle] || 120).to_f
        cut_depth  = (cfg[:vbit_depth] || cfg[:depth].to_f.abs).to_f   # độ sâu cắt thực (dương)
        z_bottom   = cfg[:depth].to_f                                  # Z đáy tuyệt đối (đã tính zzero)
        z_top      = (z_bottom + cut_depth).round(3)                   # Z mặt ván
        feed       = cfg[:feed]   || 2500
        z_feed     = cfg[:z_feed] || 800

        # L = depth / tan(90 - angle/2)
        l_off = cut_depth / Math.tan((90.0 - angle/2.0) * Math::PI / 180.0)

        # Sort loops cho thứ tự cắt hợp lý (tái dùng helper sẵn có)
        sorted_loops = sort_loops_by_proximity(
          raw_loops, sheet_w, sheet_h,
          small_threshold: (app_settings[:small_threshold] || 300.0),
          thresh_top: (app_settings[:thresh_top] || 300.0),
          thresh_bot: (app_settings[:thresh_bot] || 300.0)
        )

        c0 = fmt_comment("V-BIT cut_in #{format('%.0f',angle)}deg depth=#{format('%.2f',cut_depth)} L=#{format('%.3f',l_off)}", comment_style)
        f.puts c0 if c0

        sorted_loops.each do |loop|
          edges = loop[:edges]
          next if edges.size < 2

          # Đỉnh loop gốc (điểm đầu mỗi edge)
          verts = edges.map { |e| { x: e[:x1], y: e[:y1] } }
          # Điểm offset L tương ứng từng đỉnh (miter join — song song loop gốc)
          off = vbit_offset_miter(verts, l_off)
          next if off.nil? || off.size != verts.size

          n = verts.size
          state = {}

          cm = fmt_comment("V-BIT loop #{n} corners", comment_style)
          f.puts cm if cm

          # 1) Lên vị trí góc đầu (Z an toàn), hạ về mặt ván
          f.puts gcode_line('G0', x: verts[0][:x], y: verts[0][:y], z: clear_z, state: state)
          f.puts gcode_line('G1', z: z_top, f: z_feed, state: state)

          # 2) Chạy quanh loop: tại mỗi góc đi chéo xuống offset (Z đáy),
          #    dọc cạnh ở đáy, rồi ramp lên góc gốc kế tiếp ở mặt ván.
          (0...n).each do |i|
            nxt = (i + 1) % n
            # Chéo xuống điểm offset của góc hiện tại (Z đáy)
            f.puts gcode_line('G1', x: off[i][:x], y: off[i][:y], z: z_bottom, f: feed, state: state)
            # Dọc theo cạnh ở đáy đến điểm offset của góc kế (Z giữ nguyên)
            f.puts gcode_line('G1', x: off[nxt][:x], y: off[nxt][:y], f: feed, state: state)
            # Ramp lên góc gốc kế tiếp ở mặt ván
            f.puts gcode_line('G1', x: verts[nxt][:x], y: verts[nxt][:y], z: z_top, f: feed, state: state)
          end

          # 3) Nâng dao
          f.puts "G0 Z#{format('%.1f', clear_z)}"
          state[:z] = clear_z
        end
      end

      # Offset đa giác kín vào trong khoảng dist (miter join). Port từ JS offsetPolygonMiter.
      # verts: mảng [{x,y}] theo thứ tự chu vi. Trả [{x,y}] cùng kích thước.
      def self.vbit_offset_miter(verts, dist)
        n = verts.size
        return nil if n < 3

        area = 0.0
        (0...n).each do |i|
          a = verts[i]; b = verts[(i+1) % n]
          area += (a[:x]*b[:y] - b[:x]*a[:y])
        end
        inward_sign = area > 0 ? 1.0 : -1.0

        out = []
        (0...n).each do |i|
          prev = verts[(i-1+n) % n]
          cur  = verts[i]
          nxt  = verts[(i+1) % n]

          d1x = cur[:x]-prev[:x]; d1y = cur[:y]-prev[:y]
          d2x = nxt[:x]-cur[:x];  d2y = nxt[:y]-cur[:y]
          l1 = Math.hypot(d1x, d1y); l2 = Math.hypot(d2x, d2y)
          if l1 < 1e-6 || l2 < 1e-6
            out << { x: cur[:x], y: cur[:y] }; next
          end
          d1x /= l1; d1y /= l1; d2x /= l2; d2y /= l2

          n1x = -d1y; n1y = d1x
          n2x = -d2y; n2y = d2x

          mx = n1x + n2x; my = n1y + n2y
          ml = Math.hypot(mx, my)
          if ml < 1e-6
            mx = n1x; my = n1y; ml = 1.0
          end
          mx /= ml; my /= ml

          cos_half = mx*n1x + my*n1y
          cos_half = 1.0 if cos_half.abs < 1e-6
          miter_len = dist / cos_half

          out << {
            x: (cur[:x] + mx * miter_len * inward_sign).round(4),
            y: (cur[:y] + my * miter_len * inward_sign).round(4)
          }
        end
        out
      end

      # ── ABF_MARKSQUARE: vạch dấu chữ L hở, offset từng cạnh ra ngoài viền ─────
      # Kịch bản riêng, KHÔNG đụng write_profile. Quy ước "ra ngoài":
      #   - Cạnh dọc (đứng)  → đẩy +X (sang phải)
      #   - Cạnh ngang (nằm) → đẩy -Y (xuống dưới)
      #   - Cạnh xiên        → normal hướng ra xa tâm bbox
      #   - Điểm xuất phát ở Ymax
      def self.write_mark_square(f, lines, cfg, clear_z)
        comment_style = cfg[:comment_style] || 'off'
        raw = lines.reject { |l| l[:is_drill_center] }
                   .select { |l| Math.sqrt((l[:x2]-l[:x1])**2 + (l[:y2]-l[:y1])**2) > 0.1 }
        raw_loops = build_loops(raw)
        half_d = (cfg[:diameter] || 6).to_f / 2.0
        feed   = cfg[:feed]   || 2500
        z_feed = cfg[:z_feed] || 800
        depth  = cfg[:depth].to_f

        c0 = fmt_comment("MARKSQUARE offset=#{format('%.2f',half_d)}mm (canh doc +X, canh ngang -Y)", comment_style)
        f.puts c0 if c0

        raw_loops.each do |loop|
          edges = loop[:edges]
          next if edges.size < 1

          # Xuất phát từ Ymax: nếu đầu path Y nhỏ hơn cuối thì đảo chiều
          start_y = edges.first[:y1]
          end_y   = edges.last[:y2]
          work = edges.map { |e| { x1:e[:x1], y1:e[:y1], x2:e[:x2], y2:e[:y2] } }
          if end_y > start_y
            work = work.reverse.map { |e| { x1:e[:x2], y1:e[:y2], x2:e[:x1], y2:e[:y1] } }
          end

          pts = mark_offset_outward(work, half_d)
          next if pts.nil? || pts.size < 2

          state = {}
          f.puts gcode_line('G0', x: pts[0][:x], y: pts[0][:y], z: clear_z, state: state)
          z_levels = cfg[:z_levels]
          z_levels = [depth] unless z_levels.is_a?(Array) && !z_levels.empty?

          if cfg[:ramp_on] == true
            prev_z = (cfg[:z_top] || 0.0).to_f
            ramp_len = (cfg[:ramp_len] || 20.0).to_f
            z_levels.each do |zl|
              f.puts "G0 X#{format('%.3f',pts[0][:x])} Y#{format('%.3f',pts[0][:y])}"
              ramp_open_entry_lines(pts, zl.to_f, prev_z, ramp_len, z_feed, feed).to_a.each { |line| f.puts line }
              f.puts "G0 Z#{format('%.1f', clear_z)}"
              state[:z] = clear_z
              prev_z = zl.to_f
            end
            next
          end

          # Các lượt trên: chạy hết path, nâng Safe Z rồi quay lại điểm đầu.
          z_levels[0...-1].each do |zl|
            f.puts gcode_line('G1', z: zl.to_f, f: z_feed, state: state)
            pts[1..].each { |p| f.puts gcode_line('G1', x: p[:x], y: p[:y], f: feed, state: state) }
            f.puts "G0 Z#{format('%.1f', clear_z)}"
            state[:z] = clear_z
            f.puts gcode_line('G0', x: pts[0][:x], y: pts[0][:y], state: state)
          end

          # Lượt cuối luôn dùng đúng depth thực tế đã tính theo zzero.
          f.puts gcode_line('G1', z: depth, f: z_feed, state: state)
          pts[1..].each { |p| f.puts gcode_line('G1', x: p[:x], y: p[:y], f: feed, state: state) }
          f.puts "G0 Z#{format('%.1f', clear_z)}"
          state[:z] = clear_z
        end
      end

      # Offset path hở ra ngoài theo từng cạnh. Trả mảng [{x,y}].
      def self.mark_offset_outward(edges, half_d)
        return nil if edges.nil? || edges.empty?
        xs = edges.flat_map { |e| [e[:x1], e[:x2]] }
        ys = edges.flat_map { |e| [e[:y1], e[:y2]] }
        cx = (xs.min + xs.max) / 2.0
        cy = (ys.min + ys.max) / 2.0

        shifted = edges.map do |e|
          dx = e[:x2]-e[:x1]; dy = e[:y2]-e[:y1]
          len = Math.hypot(dx, dy)
          if len < 1e-6
            next { x1:e[:x1], y1:e[:y1], x2:e[:x2], y2:e[:y2] }
          end
          sx = 0.0; sy = 0.0
          if dx.abs < 1e-3        # cạnh đứng → +X
            sx = half_d; sy = 0.0
          elsif dy.abs < 1e-3     # cạnh ngang → -Y
            sx = 0.0; sy = -half_d
          else                    # cạnh xiên → normal ra xa tâm
            nx = -dy/len; ny = dx/len
            midx = (e[:x1]+e[:x2])/2.0; midy = (e[:y1]+e[:y2])/2.0
            if (midx+nx-cx)*(midx-cx)+(midy+ny-cy)*(midy-cy) < 0
              nx = -nx; ny = -ny
            end
            sx = nx*half_d; sy = ny*half_d
          end
          { x1:e[:x1]+sx, y1:e[:y1]+sy, x2:e[:x2]+sx, y2:e[:y2]+sy }
        end

        pts = []
        pts << { x: shifted.first[:x1], y: shifted.first[:y1] }
        (0...shifted.size-1).each do |i|
          a = shifted[i]; b = shifted[i+1]
          inter = line_intersect(a[:x1],a[:y1],a[:x2],a[:y2], b[:x1],b[:y1],b[:x2],b[:y2])
          if inter
            pts << inter
          else
            pts << { x:a[:x2], y:a[:y2] }
            pts << { x:b[:x1], y:b[:y1] }
          end
        end
        pts << { x: shifted.last[:x2], y: shifted.last[:y2] }
        pts
      end

      def self.line_intersect(x1,y1,x2,y2, x3,y3,x4,y4)
        d = (x1-x2)*(y3-y4) - (y1-y2)*(x3-x4)
        return nil if d.abs < 1e-9
        t = ((x1-x3)*(y3-y4) - (y1-y3)*(x3-x4)) / d
        { x: (x1 + t*(x2-x1)).round(4), y: (y1 + t*(y2-y1)).round(4) }
      end

    end # module GcodeEngine
  end # module ExportGcode
end # module N2G
