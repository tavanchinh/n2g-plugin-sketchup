# ==============================================================================
# N2G / modules / export_gcode / scanner.rb
# Scan SketchUp model → trả về danh sách sheets với vectors
# Phụ thuộc: GcodeEngine (normalize_layer)
# ==============================================================================

module N2G
  module ExportGcode
    module Scanner

      def self.build_nesting_map(entities, trans, map, inside_nesting=false)
        entities.each do |ent|
          next unless ent.is_a?(Sketchup::Group) || ent.is_a?(Sketchup::ComponentInstance)
          name      = (ent.name || "").downcase
          next if name.include?("_abf_label")
          new_trans = trans * ent.transformation
          if name.include?("sheet") && inside_nesting
            map[ent] = new_trans
          elsif name.include?("abf_nesting")
            build_nesting_map(ent.definition.entities, new_trans, map, true)
          elsif inside_nesting
            build_nesting_map(ent.definition.entities, new_trans, map, true)
          end
        end
      end

      # Nhận diện group là drill circle bằng heuristic chặt:
      # - Edges >= 12 (vòng tròn ABF thường có 24 đoạn)
      # - Đường kính hợp lý 2–150mm
      # - x_range ≈ y_range (tỉ lệ gần 1:1, sai số < 15%)
      # - Tất cả điểm cách tâm đều nhau (variance < 15% bán kính)
      def self.is_drill_group?(inner_entities)
        edges = inner_entities.select { |x| x.is_a?(Sketchup::Edge) }
        return false if edges.size < 12

        # Hình tròn nằm trên layer đường cắt (cuttingLines) là CHI TIẾT cần cắt rời,
        # KHÔNG phải lỗ khoan — dù hình tròn. Loại trừ để không nhận nhầm.
        layers = edges.map { |e| GcodeEngine.normalize_layer(e.layer.name) }.uniq
        return false if layers.any? { |l| l.include?("CUTTINGLINES") }

        all_x = edges.flat_map { |e| [e.start.position.x.to_mm, e.end.position.x.to_mm] }
        all_y = edges.flat_map { |e| [e.start.position.y.to_mm, e.end.position.y.to_mm] }

        x_range = all_x.max - all_x.min
        y_range = all_y.max - all_y.min

        diameter_est = (x_range + y_range) / 2.0
        return false if diameter_est < 2.0 || diameter_est > 150.0
        return false if x_range < 0.1 || y_range < 0.1
        return false if ([x_range, y_range].min / [x_range, y_range].max) < 0.85

        cx         = (all_x.max + all_x.min) / 2.0
        cy         = (all_y.max + all_y.min) / 2.0
        r_expected = diameter_est / 2.0
        distances  = edges.flat_map { |e|
          [Math.sqrt((e.start.position.x.to_mm - cx)**2 + (e.start.position.y.to_mm - cy)**2),
           Math.sqrt((e.end.position.x.to_mm   - cx)**2 + (e.end.position.y.to_mm   - cy)**2)]
        }
        distances.map { |d| (d - r_expected).abs }.max < r_expected * 0.15
      end

      # Tách 1 mảng Sketchup::Edge thành các CỤM LIÊN THÔNG: 2 edge chung 1 đỉnh (cùng
      # vị trí, dung sai nhỏ) → cùng cụm. Mỗi cụm = 1 đường tròn/lỗ riêng. Dùng để 1
      # group chứa nhiều lỗ → tách đúng số lỗ (thay vì gộp 1 tâm bbox chung).
      def self.split_edge_clusters(edges)
        return [] if edges.nil? || edges.empty?
        tol = 0.001  # inch (~0.025mm) — đỉnh trùng
        key = lambda { |pos| [(pos.x/tol).round, (pos.y/tol).round, (pos.z/tol).round] }
        # union-find theo đỉnh
        parent = {}
        find = lambda do |a|
          a = parent[a] while parent[a] != a
          a
        end
        # gán mỗi edge 1 id, nối 2 edge nếu chung đỉnh
        vert_to_edges = Hash.new { |h, k| h[k] = [] }
        edges.each_with_index do |e, i|
          parent[i] ||= i
          [key.call(e.start.position), key.call(e.end.position)].each do |vk|
            vert_to_edges[vk] << i
          end
        end
        vert_to_edges.each_value do |eids|
          next if eids.size < 2
          base = eids.first
          eids[1..].each do |o|
            ra = find.call(base); rb = find.call(o)
            parent[rb] = ra if ra != rb
          end
        end
        clusters = Hash.new { |h, k| h[k] = [] }
        edges.each_with_index { |e, i| clusters[find.call(i)] << e }
        clusters.values
      end

      def self.extract_data(parent, trans, sheet_inv, tools, clean_arr, disp_arr, group_id=nil, depth=0, stray_drills=nil, part_id=nil)
        entities = parent.is_a?(Sketchup::Model) ? parent.entities : parent.definition.entities


        entities.each do |ent|
          if ent.is_a?(Sketchup::Group) || ent.is_a?(Sketchup::ComponentInstance)
            name   = (ent.name || "").downcase
            is_lab = name.include?("_abf_label") ||
                     GcodeEngine.normalize_layer(ent.layer.name) == "ABF_LABEL"
            inner  = ent.definition.entities

            # Detect drill: config trước, fallback heuristic
            inner_edges      = inner.select { |x| x.is_a?(Sketchup::Edge) }
            first_edge_layer = inner_edges.first&.layer&.name
            # QUAN TRỌNG: tra tools bằng tên đã normalize (map dùng key normalize).
            # Tên layer thô có thể chứa '-' hoặc '.' (vd ABF-D16) trong khi map lưu ABF_D16.
            norm_layer       = first_edge_layer ? GcodeEngine.normalize_layer(first_edge_layer) : nil
            cfg_from_tools   = norm_layer ? tools[norm_layer] : nil

            # Group có thể chứa NHIỀU đường tròn khác layer (vd lỗ bậc: D8 ngoài + D5 trong).
            # Khi đó KHÔNG được coi cả group là 1 lỗ (sẽ nuốt mất layer còn lại).
            # Chỉ nhận là lỗ đơn khi MỌI edge cùng một layer.
            inner_layers     = inner_edges.map { |e| GcodeEngine.normalize_layer(e.layer.name) }.uniq
            single_layer     = (inner_layers.size == 1)

            has_drill_cfg = cfg_from_tools &&
              (cfg_from_tools[:type] == :drill || cfg_from_tools[:n2g_has_drill] == true)
            has_non_drill_cfg = cfg_from_tools &&
              (cfg_from_tools[:type] != :drill || cfg_from_tools[:n2g_has_non_drill] == true)
            is_drill_by_cfg  = has_drill_cfg && single_layer
            # Chỉ nhận drill theo HÌNH DẠNG khi layer KHÔNG có config với type khác.
            # Nếu layer được cấu hình pocket/profile (vd lỗ D16 hạ nền) thì dù tròn
            # cũng KHÔNG phải drill — để nó thành loop pocket/profile.
            is_drill_by_shape = !is_drill_by_cfg && !has_non_drill_cfg && single_layer && is_drill_group?(inner)

            if (is_drill_by_cfg || is_drill_by_shape) && !is_lab
              l_name        = GcodeEngine.normalize_layer(first_edge_layer || ent.layer.name)
              cfg           = tools[l_name]
              drill_cfg     = (cfg && cfg[:n2g_drill_cfg]) || cfg
              ent_full_trans = trans * ent.transformation

              # So layer đã NORMALIZE (tên thô có thể là 'ABF-D5' còn l_name là 'ABF_D5')
              drill_edges = inner_edges.select { |x| GcodeEngine.normalize_layer(x.layer.name) == l_name }
              drill_edges = inner_edges if drill_edges.empty?

              # 1 GROUP có thể chứa NHIỀU lỗ (nhiều đường tròn rời). Tách drill_edges
              # thành các CỤM LIÊN THÔNG (edge nối nhau qua đỉnh chung = 1 đường tròn =
              # 1 lỗ), mỗi cụm → 1 drill_center riêng. Trước đây lấy 1 tâm bbox chung →
              # gộp nhiều lỗ thành 1 (sai vị trí + mất lỗ).
              clusters = split_edge_clusters(drill_edges)
              clusters = [drill_edges] if clusters.empty?

              clusters.each do |cl_edges|
                local_center = if clusters.size == 1
                  # 1 lỗ đơn trong group → dùng bounds.center (giữ ĐÚNG cả z, đúng cho lỗ
                  # nằm ở mọi mặt phẳng). KHÔNG tự tạo Point3d z=0 (làm sai lỗ ở mặt đứng).
                  ent.definition.bounds.center
                elsif cl_edges.size >= 3
                  # NHIỀU lỗ/group → phải tính tâm RIÊNG mỗi cụm (bounds.center là tâm
                  # chung cả group, sai). Tính từ bbox cụm; giữ z từ điểm edge thật.
                  lx = cl_edges.flat_map { |e| [e.start.position.x, e.end.position.x] }
                  ly = cl_edges.flat_map { |e| [e.start.position.y, e.end.position.y] }
                  lz = cl_edges.flat_map { |e| [e.start.position.z, e.end.position.z] }
                  Geom::Point3d.new((lx.min+lx.max)/2.0, (ly.min+ly.max)/2.0, (lz.min+lz.max)/2.0)
                else
                  ent.definition.bounds.center
                end

                world_pt = local_center.transform(ent_full_trans)
                local_pt = world_pt.transform(sheet_inv)
                cx       = local_pt.x.to_mm
                cy       = local_pt.y.to_mm
                duplicate = clean_arr.any? { |v|
                  v[:is_drill_center] && v[:layer] == l_name &&
                  (v[:x1] - cx).abs < 0.5 && (v[:y1] - cy).abs < 0.5
                }

                unless duplicate
                  # Đường kính lỗ: ƯU TIÊN từ config dao (cfg[:diameter]) vì layer đã định
                  # nghĩa đường kính (vd D15 → 15mm). Đo hình học chỉ DỰ PHÒNG khi không có
                  # config. Đo bằng CHIỀU LỚN HƠN (max dx,dy) — lỗ nghiêng 1 chiều=0 thì
                  # trung bình cho D/2 sai (D15→7.5).
                  diam = if drill_cfg && drill_cfg[:diameter] && drill_cfg[:diameter] > 0
                    drill_cfg[:diameter]
                  elsif cl_edges.any?
                    xs = cl_edges.flat_map { |e| [e.start.position.x.to_mm, e.end.position.x.to_mm] }
                    ys = cl_edges.flat_map { |e| [e.start.position.y.to_mm, e.end.position.y.to_mm] }
                    dx = xs.max - xs.min
                    dy = ys.max - ys.min
                    [[dx, dy].max, 1.0].max.round(2)
                  else
                    6.0
                  end

                  vec = {
                    x1: cx, y1: cy, x2: cx, y2: cy,
                    color: (drill_cfg ? drill_cfg[:color] : "#888888"),
                    layer: l_name, is_drill_center: true, diameter: diam
                  }
                  clean_arr << vec
                  disp_arr  << vec
                end
              end
              # Pure Drill giu hanh vi cu: thay contour bang center. Mixed
              # Profile+Drill tiep tuc recurse de giu edge cho Profile.
              next unless has_non_drill_cfg
            end

            # Gán group_id tại group chi tiết (cấp ngay dưới sheet = depth 0).
            # Mọi edge bên trong chi tiết này (kể cả island) sẽ chung group_id.
            # Đây là ranh giới phân biệt island: chỉ xét island trong cùng group_id.
            child_gid = depth == 0 ? ent.entityID : group_id
            # Tách ID chi tiết từ tên group (dạng "__324. Hồi-" → "324").
            # Chỉ lấy tại depth 0 (group chi tiết); cấp con giữ ID của cha.
            child_pid = if depth == 0
              m = (ent.name || "").to_s.match(/^_*(\d+)/)
              m ? m[1] : nil
            else
              part_id
            end
            sub = []
            extract_data(ent, trans * ent.transformation, sheet_inv,
                         tools, is_lab ? [] : clean_arr, sub, child_gid, depth + 1, stray_drills, child_pid)
            disp_arr.concat(sub)

          elsif ent.is_a?(Sketchup::Edge)
            if GcodeEngine.normalize_layer(ent.layer.name) == "ABF_LABEL"
              lp1 = ent.start.position.transform(trans).transform(sheet_inv)
              lp2 = ent.end.position.transform(trans).transform(sheet_inv)
              disp_arr << { x1: lp1.x.to_mm, y1: lp1.y.to_mm,
                            x2: lp2.x.to_mm, y2: lp2.y.to_mm,
                            color: "#aaaaaa", layer: "ABF_LABEL", is_drill_center: false }
              next
            end

            l_name = GcodeEngine.normalize_layer(ent.layer.name)
            cfg    = tools[l_name]
            has_drill_cfg = cfg && (cfg[:type] == :drill || cfg[:n2g_has_drill] == true)
            has_non_drill_cfg = cfg && (cfg[:type] != :drill || cfg[:n2g_has_non_drill] == true)
            drill_cfg = (cfg && cfg[:n2g_drill_cfg]) || cfg
            if has_drill_cfg
              # Edge thuộc layer khoan nhưng nằm lẫn trong group khác (không phải
              # group khoan tròn riêng). Thu thập lại để gom thành cụm → điểm khoan.
              if stray_drills
                sp = ent.start.position.transform(trans).transform(sheet_inv)
                ep = ent.end.position.transform(trans).transform(sheet_inv)
                stray_drills << {
                  layer: l_name,
                  x1: sp.x.to_mm, y1: sp.y.to_mm,
                  x2: ep.x.to_mm, y2: ep.y.to_mm,
                  color: (drill_cfg ? drill_cfg[:color] : "#888888"),
                  diameter: (drill_cfg ? drill_cfg[:diameter] : 5.0)
                }
              end
              next unless has_non_drill_cfg
            end

            lp1   = ent.start.position.transform(trans).transform(sheet_inv)
            lp2   = ent.end.position.transform(trans).transform(sheet_inv)
            vec   = {
              x1: lp1.x.to_mm, y1: lp1.y.to_mm,
              x2: lp2.x.to_mm, y2: lp2.y.to_mm,
              color: (cfg ? cfg[:color] : "#444444"),
              layer: l_name, is_drill_center: false,
              group_id: group_id, part_id: part_id
            }
            disp_arr  << vec
            clean_arr << vec
          end
        end
      end

      # Gom các edge khoan bị bỏ sót (nằm lẫn trong group khác) thành các VÒNG KÍN.
      # Mỗi vòng tròn khép kín = 1 lỗ → 1 điểm khoan tại tâm. Gom theo chuỗi nối tiếp
      # (điểm cuối edge này = điểm đầu edge kia) nên 2 lỗ sát nhau vẫn tách đúng,
      # không phụ thuộc khoảng cách giữa các lỗ.
      def self.add_stray_drill_centers(stray, clean_arr, disp_arr)
        return if stray.nil? || stray.empty?

        tol = 0.05  # mm — dung sai nối điểm (đầu-cuối trùng nhau)
        by_layer = stray.group_by { |e| e[:layer] }
        by_layer.each do |l_name, edges|
          remaining = edges.dup
          while !remaining.empty?
            # Bắt đầu một vòng từ edge đầu tiên còn lại
            chain = [remaining.shift]
            grew = true
            while grew
              grew = false
              # Điểm cuối hiện tại của chuỗi
              tail = chain.last
              tx, ty = tail[:x2], tail[:y2]
              # Tìm edge nối tiếp (điểm đầu hoặc cuối trùng điểm cuối chuỗi)
              idx = remaining.index do |e|
                (e[:x1] - tx).abs < tol && (e[:y1] - ty).abs < tol ||
                (e[:x2] - tx).abs < tol && (e[:y2] - ty).abs < tol
              end
              if idx
                e = remaining.delete_at(idx)
                # Đảo chiều nếu cần để x1,y1 nối với điểm cuối chuỗi
                if (e[:x2] - tx).abs < tol && (e[:y2] - ty).abs < tol
                  e = e.merge(x1: e[:x2], y1: e[:y2], x2: e[:x1], y2: e[:y1])
                end
                chain << e
                grew = true
              end
            end

            # Tâm vòng = trung bình bbox của chuỗi
            xs = chain.flat_map { |e| [e[:x1], e[:x2]] }
            ys = chain.flat_map { |e| [e[:y1], e[:y2]] }
            cx = (xs.min + xs.max) / 2.0
            cy = (ys.min + ys.max) / 2.0
            diam = chain.first[:diameter] || 5.0

            dup = clean_arr.any? { |v|
              v[:is_drill_center] && v[:layer] == l_name &&
              (v[:x1] - cx).abs < 0.5 && (v[:y1] - cy).abs < 0.5
            }
            next if dup

            vec = {
              x1: cx, y1: cy, x2: cx, y2: cy,
              color: chain.first[:color] || "#888888",
              layer: l_name, is_drill_center: true, diameter: diam
            }
            clean_arr << vec
            disp_arr  << vec
          end
        end
      end

      # Nếu 1 loop kín có phần nhỏ là LAYER0 lẫn với layer khác
      # → assign tất cả edge LAYER0 trong loop đó sang layer của loop
      def self.merge_layer0_edges(vecs)
        layer0_vecs = vecs.select { |v| !v[:is_drill_center] && v[:layer] == 'LAYER0' }
        return vecs if layer0_vecs.empty?

        tol = 1.0  # mm
        max_iter = layer0_vecs.size + 1

        max_iter.times do
          changed = false
          vecs.each do |lv|
            next if lv[:is_drill_center] || lv[:layer] != 'LAYER0'

            neighbor = vecs.find do |ov|
              next false if ov[:is_drill_center] || ov[:layer] == 'LAYER0'
              (Math.sqrt((ov[:x2]-lv[:x1])**2 + (ov[:y2]-lv[:y1])**2) < tol) ||
              (Math.sqrt((ov[:x1]-lv[:x2])**2 + (ov[:y1]-lv[:y2])**2) < tol) ||
              (Math.sqrt((ov[:x2]-lv[:x2])**2 + (ov[:y2]-lv[:y2])**2) < tol) ||
              (Math.sqrt((ov[:x1]-lv[:x1])**2 + (ov[:y1]-lv[:y1])**2) < tol)
            end

            if neighbor
              lv[:layer] = neighbor[:layer]
              lv[:color] = neighbor[:color]
              changed = true
            end
          end
          break unless changed
        end

        # Log cảnh báo nếu còn sót
        remaining = vecs.count { |v| !v[:is_drill_center] && v[:layer] == 'LAYER0' }
        puts "N2G Scanner: #{remaining} LAYER0 edges không merge được (isolated)" if remaining > 0

        vecs
      end

      # ── TRA NGƯỢC màu + độ dày từ mô hình 3D cho tấm nesting THIẾU TÊN ──
      # ABF đặt tên tấm dạng "<màu> - <độ dày>mm - sheet-N". Một số tấm bị thiếu.
      # Tên material có phải "tên thật" do người dùng đặt không?
      # SketchUp khi đổ màu KHÔNG đặt tên thường trả tên dạng mã màu:
      #   "255,168,55"  hoặc  "255 168 55"  hoặc  "[255, 168, 55]"  hoặc  "#FFA837"
      # Những dạng này coi như CHƯA đặt tên vật liệu → trả false (chỉ lấy độ dày).
      def self.real_material_name?(name)
        s = name.to_s.strip
        return false if s.empty?
        # mã RGB: 3 số cách nhau bởi dấu phẩy/space (có thể trong ngoặc [])
        return false if s =~ /\A\[?\s*\d{1,3}\s*[,\s]\s*\d{1,3}\s*[,\s]\s*\d{1,3}\s*\]?\z/
        # mã hex màu: #RGB hoặc #RRGGBB
        return false if s =~ /\A#?[0-9a-fA-F]{6}\z/ || s =~ /\A#[0-9a-fA-F]{3}\z/
        true
      end

      # Cách tra: lấy part_id của 1 chi tiết trong tấm → tìm group 3D cùng số
      # (group cấp cao ngoài nesting, tên dạng "__105. [40]Thanh chia ngang")
      # → lấy material + độ dày (chiều nhỏ nhất của bounds GỐC).
      #
      # Bản đồ: part_id → { material:, thickness: }
      # Tìm material đệ quy: face trực tiếp trong definition, rồi vào group/component
      # con (nhiều mô hình có material nằm trên face SÂU bên trong, không ở cấp 1).
      # Chỉ nhận material có TÊN THẬT (bỏ qua mã màu RGB/hex chưa đặt tên).
      def self.find_material_deep(defn, depth=0)
        return nil if depth > 4
        ents = defn.entities
        # 1) face có material tên thật ở cấp này
        ents.grep(Sketchup::Face).each do |x|
          if x.material && real_material_name?(x.material.name)
            return x.material.name.to_s
          end
        end
        # 2) instance con: material trên instance, hoặc đệ quy vào trong
        ents.each do |x|
          if x.is_a?(Sketchup::Group) || x.is_a?(Sketchup::ComponentInstance)
            if x.material && real_material_name?(x.material.name)
              return x.material.name.to_s
            end
            sub = find_material_deep(x.definition, depth + 1)
            return sub if sub && !sub.empty?
          end
        end
        nil
      end

      def self.build_part_info_map(model)
        map = {}
        model.entities.each do |e|
          next unless e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
          nm = (e.respond_to?(:name) ? e.name.to_s : '')
          next if nm.empty?
          next if nm =~ /ABF[_\s-]*Nesting/i         # bỏ qua chính nhóm nesting
          m = nm.match(/^_*(\d+)/)                   # số đầu tên = part_id
          next unless m
          pid = m[1]
          next if map.key?(pid)

          # Độ dày = chiều NHỎ NHẤT trong hệ trục LOCAL của definition,
          # sau khi nhân scale tương ứng của instance. Không dùng trực tiếp
          # e.bounds vì AABB theo trục world bị phình khi chi tiết xoay.
          b = (e.bounds rescue nil)
          next if b.nil?
          db = (e.definition.bounds rescue nil)
          definition_dims = db ? [db.width.to_mm, db.height.to_mm, db.depth.to_mm] : []
          tr = (e.transformation rescue nil)
          axis_scales = if tr
            [(tr.xaxis.length rescue nil),
             (tr.yaxis.length rescue nil),
             (tr.zaxis.length rescue nil)].compact
          else
            []
          end

          world_dims = [b.width.to_mm, b.height.to_mm, b.depth.to_mm]
          # Do tren he truc LOCAL cua definition de phep xoay instance khong lam
          # phinh day. Nhan scale tung truc de van dung voi instance scale khong deu.
          local_scaled_dims = if definition_dims.size == 3 && axis_scales.size == 3
            definition_dims.each_with_index.map { |v, i| v * axis_scales[i] }
          else
            []
          end
          valid_local_dims = local_scaled_dims.select { |v| v.finite? && v > 0.001 }
          thickness_source = valid_local_dims.empty? ? world_dims : valid_local_dims
          thick = thickness_source.min.round(1)
          next if thick <= 0

          # Material: của group (nếu tên thật); nếu không thì tìm ĐỆ QUY vào face/con.
          # Chi tiết CHƯA đổ màu (hoặc chỉ có mã màu RGB chưa đặt tên) → coi như rỗng,
          # vẫn CHẤP NHẬN để lấy độ dày; tên tấm sẽ chỉ hiện "<độ dày>".
          mat = (e.material && real_material_name?(e.material.name)) ? e.material.name.to_s : nil
          if mat.nil? || mat.empty?
            mat = find_material_deep(e.definition)
          end
          mat = '' if mat.nil?      # không tên màu → rỗng, KHÔNG loại bỏ

          map[pid] = {
            material: mat,
            thickness: thick,
            debug_source_name: nm,
            debug_world_dims: world_dims.map { |v| v.round(3) },
            debug_definition_dims: definition_dims.map { |v| v.round(3) },
            debug_local_scaled_dims: local_scaled_dims.map { |v| v.round(3) },
            debug_axis_scales: axis_scales.map { |v| v.round(6) }
          }
        end
        map
      rescue => e
        puts "N2G build_part_info_map error: #{e.message}"
        {}
      end

      def self.fmt_thickness(t)
        (t % 1 == 0) ? "#{t.to_i}mm" : "#{t}mm"
      end

      # Tấm thiếu MÀU và/hoặc ĐỘ DÀY → tra 3D qua part_id rồi GHI LẠI tên tấm theo
      # chuẩn ABF, để mọi bước sau (thư mục, tên file, kế thừa độ dày) hoạt động bình thường.
      # Giữ nguyên phần đã có: chỉ điền vào chỗ thiếu.
      def self.resolve_missing_sheet_names!(model, sheets)
        need = sheets.select do |sh|
          p   = GcodeEngine.parse_sheet_name(sh[:name].to_s)
          col = p[:color].to_s.strip.gsub(/^_+|_+$/, '')
          thk = p[:thickness].to_s.strip
          col.empty? || thk.empty?          # thiếu màu HOẶC thiếu độ dày
        end
        return if need.empty?

        map = build_part_info_map(model)
        return if map.empty?

        need.each do |sh|
          old  = sh[:name].to_s
          p    = GcodeEngine.parse_sheet_name(old)
          col  = p[:color].to_s.strip.gsub(/^_+|_+$/, '')
          thk  = p[:thickness].to_s.strip

          # Chỉ cần vài part_id đầu tiên trong tấm là đủ tra ra
          pids = []
          (sh[:display] || []).each do |v|
            pid = v[:part_id]
            next if pid.nil? || pid.to_s.empty?
            pids << pid.to_s
            break if pids.size >= 5
          end
          chosen = pids.map { |pid| [pid, map[pid]] }.find { |_pid, val| !val.nil? }
          chosen_pid = chosen && chosen[0]
          info = chosen && chosen[1]
          puts "[N2G THICKNESS DEBUG] sheet=#{old.inspect}"
          puts "[N2G THICKNESS DEBUG] candidate_part_ids=#{pids.inspect}"
          if info
            puts "[N2G THICKNESS DEBUG] selected_part_id=#{chosen_pid.inspect} source_group=#{info[:debug_source_name].inspect}"
            puts "[N2G THICKNESS DEBUG] world_bounds_mm=#{info[:debug_world_dims].inspect} definition_bounds_mm=#{info[:debug_definition_dims].inspect} axis_scales=#{info[:debug_axis_scales].inspect}"
            puts "[N2G THICKNESS DEBUG] local_scaled_dims_mm=#{info[:debug_local_scaled_dims].inspect}"
            puts "[N2G THICKNESS DEBUG] selected_thickness_mm=#{info[:thickness].inspect} material=#{info[:material].inspect}"
          else
            puts "[N2G THICKNESS DEBUG] no_matching_3d_part"
          end
          next if info.nil?

          # Điền vào chỗ THIẾU, giữ nguyên chỗ đã có
          new_col = col.empty?  ? info[:material].to_s          : col
          new_thk = thk.empty?  ? fmt_thickness(info[:thickness]) : thk
          next if new_thk.to_s.strip.empty?

          # side: ưu tiên phần "sheet-N[-bottom/top]" từ tên gốc (thông tin MẶT gia
          # công — BẮT BUỘC giữ cho tấm 2 mặt). Nếu parse ra side thì dùng; nếu không,
          # thử trích trực tiếp "sheet-..." từ tên gốc.
          side = p[:side].to_s.strip
          side = (old[/sheet[\s_-]*\S+/i] || '') if side.empty?

          # Phần side có mang thông tin sheet/mặt không? (sheet-N, bottom, top)
          side_has_sheet = side =~ /sheet[\s_-]*\d+/i || side =~ /bottom|top/i

          # Ghép tên:
          #   - Có màu:            "màu - độ dày - side"
          #   - Chưa màu + có side sheet/mặt: "độ dày-side"  (GIỮ -bottom/-top để chạy 2 mặt)
          #     Dùng format KHÔNG space quanh '-' (vd "17mm-sheet-1-bottom") để
          #     parse_sheet_name nhận ra độ dày (mẫu ^_*(\d+mm)-(.+)$ cần gạch sát).
          #   - Chưa màu + side chỉ là tên chi tiết: CHỈ "độ dày"
          if !new_col.empty?
            sh[:name] = "#{new_col} - #{new_thk} - #{side}"
          elsif side_has_sheet
            sh[:name] = "#{new_thk}-#{side}"
          else
            sh[:name] = new_thk
          end
        end
      rescue => e
        puts "N2G resolve_missing_sheet_names error: #{e.message}"
      end

      def self.scan_model(model, tool_library)
        map = {}
        build_nesting_map(model.entities, Geom::Transformation.new, map, false)

        # Không có tấm nào → trả nil. KHÔNG hiện UI.messagebox ở đây:
        # - Việc báo "chưa nesting" đã được xử lý ở tầng JS (banner hướng dẫn).
        # - Messagebox là modal, nếu scan_model bị gọi lại (mở lại dialog, timer)
        #   sẽ bật liên tục gây cảm giác "vòng lặp vô hạn".
        # Caller tự xử lý nil (thường: `Scanner.scan_model(...) || []`).
        return nil if map.empty?

        # Sắp sheet theo số trong tên (sheet-1, sheet-2, ...) tăng dần — khớp thứ tự ABF.
        # Cùng số sheet: mặt BOTTOM đứng TRƯỚC mặt TOP (bottom=0, top=1).
        # Tên không có số → đẩy xuống cuối (Infinity).
        sorted = map.to_a.sort_by do |sheet, _trans|
          nm  = (sheet.name || "").to_s
          m   = nm.match(/sheet[\s_-]*(\d+)/i)
          num = m ? m[1].to_i : Float::INFINITY
          # bottom trước top
          side_rank = nm.downcase.include?('bottom') ? 0 : 1
          [num, side_rank, nm]
        end

        result = sorted.map do |sheet, world_trans|
          clean, disp = [], []
          stray = []
          origin    = world_trans.origin
          sheet_inv = Geom::Transformation.translation(
            Geom::Vector3d.new(origin.x, origin.y, origin.z).reverse
          )
          extract_data(sheet, world_trans, sheet_inv, tool_library, clean, disp, nil, 0, stray)
          # Gom các edge khoan lẫn trong group khác (vd ABF_KH lẫn trong group ABF_BL)
          # thành cụm theo vị trí → mỗi cụm tạo 1 điểm khoan tại tâm.
          add_stray_drill_centers(stray, clean, disp)
          merge_layer0_edges(clean)
          merge_layer0_edges(disp)
          {
            name:    sheet.name.gsub(/^_+/, ""),
            vectors: clean,
            display: disp,
            width:   sheet.bounds.width.to_mm,
            height:  sheet.bounds.height.to_mm
          }
        end

        # Tấm thiếu màu/độ dày → tra ngược từ mô hình 3D qua part_id
        resolve_missing_sheet_names!(model, result)
        result
      end

    end # module Scanner
  end # module ExportGcode
end # module N2G
