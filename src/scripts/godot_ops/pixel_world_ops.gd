extends "pixel_ops_base.gd"

func get_operations() -> Dictionary:
	return {
		"op_world_scene_ensure_layers": Callable(self, "op_world_scene_ensure_layers"),
		"op_world_generate_tiles": Callable(self, "op_world_generate_tiles"),
		"op_export_preview": Callable(self, "op_export_preview"),
	}

func op_world_scene_ensure_layers(params: Dictionary) -> Dictionary:
	var scene_path := String(params.get("scene_path", params.get("scenePath", ""))).strip_edges()
	if scene_path.is_empty():
		return _err("scene_path is required")

	var res_scene := _to_res_path(scene_path)
	var tileset_path := String(params.get("tileset_path", params.get("tilesetPath", ""))).strip_edges()
	var res_tileset := _to_res_path(tileset_path) if not tileset_path.is_empty() else ""
	var tileset_res: Resource = null
	if not res_tileset.is_empty() and ResourceLoader.exists(res_tileset):
		tileset_res = load(res_tileset)

	var root: Node = null
	if ResourceLoader.exists(res_scene):
		var loaded := load(res_scene)
		if loaded is PackedScene:
			root = (loaded as PackedScene).instantiate()

	if root == null:
		var world := Node2D.new()
		world.name = "World"
		root = world

	var tile_layers := _ensure_child(root, "TileLayers", "Node2D")
	var entities := _ensure_child(root, "Entities", "Node2D")
	var interactive := _ensure_child(root, "Interactive", "Node2D")
	if tile_layers == null or entities == null or interactive == null:
		return _err("Failed to ensure world structure", { "scene_path": res_scene })

	tile_layers.owner = root
	entities.owner = root
	interactive.owner = root

	var organize_existing := bool(params.get("organize_existing", params.get("organizeExisting", true)))

	var layers: Array = []
	if params.has("layers") and typeof(params.layers) == TYPE_ARRAY:
		layers = params.layers
	else:
		layers = [
			{ "name": "Terrain", "type": "TileMapLayer", "zIndex": 0 },
			{ "name": "Deco", "type": "TileMapLayer", "zIndex": 1 },
			{ "name": "Props", "type": "TileMapLayer", "zIndex": 2 },
		]

	var ensured: Array = []
	for raw in layers:
		if typeof(raw) != TYPE_DICTIONARY:
			continue
		var d: Dictionary = raw
		var layer_name := String(d.get("name", "")).strip_edges()
		if layer_name.is_empty():
			continue

		var type_name := String(d.get("type", d.get("node_type", d.get("nodeType", "TileMapLayer")))).strip_edges()
		if type_name.is_empty():
			type_name = "TileMapLayer"

		var created := false
		var reused := false
		var reparented := false
		var reparented_from := ""
		var layer_node := tile_layers.get_node_or_null(layer_name)
		if layer_node == null:
			var existing_any := root.find_child(layer_name, true, false)
			if existing_any != null and existing_any is Node and (existing_any as Node).is_class(type_name):
				layer_node = existing_any as Node
				reused = true
				if organize_existing and (layer_node as Node).get_parent() != tile_layers:
					reparented_from = _node_path_str(root, layer_node as Node)
					var gt := Transform2D()
					var has_gt := false
					if layer_node is Node2D:
						gt = (layer_node as Node2D).global_transform
						has_gt = true
					var parent := (layer_node as Node).get_parent()
					if parent != null:
						parent.remove_child(layer_node as Node)
					tile_layers.add_child(layer_node as Node)
					if has_gt and layer_node is Node2D:
						(layer_node as Node2D).global_transform = gt
					reparented = true
			else:
				var inst = _instantiate_class(type_name)
				if inst == null or not (inst is Node):
					return _err("Failed to instantiate layer node", { "type": type_name, "layer": layer_name, "suggestions": ["TileMapLayer requires Godot 4.4+.", "Check the layer node type name."] })
				layer_node = inst as Node
				(layer_node as Node).name = layer_name
				tile_layers.add_child(layer_node as Node)
				created = true

		(layer_node as Node).owner = root

		var z := int(_num(d.get("z_index", d.get("zIndex", 0))))
		_set_if_has(layer_node, "z_index", z)

		var y_sort = d.get("y_sort_enabled", d.get("ySort", null))
		if y_sort != null:
			_set_if_has(layer_node, "y_sort_enabled", bool(y_sort))

		if tileset_res != null:
			_set_if_has(layer_node, "tile_set", tileset_res)

		ensured.append({
			"name": layer_name,
			"created": created,
			"reused": reused,
			"reparented": reparented,
			"reparented_from": reparented_from if reparented else null,
			"node_path": _node_path_str(root, layer_node as Node)
		})

	var packed := PackedScene.new()
	var pack_err := packed.pack(root)
	if pack_err != OK:
		return _err("Failed to pack world scene", { "error": pack_err })

	var dir_err := _ensure_dir_for_res_path(res_scene)
	if dir_err != OK:
		return _err("Failed to create save directory", { "error": dir_err, "dir": res_scene.get_base_dir() })

	var save_err := ResourceSaver.save(packed, res_scene)
	if save_err != OK:
		return _err("Failed to save world scene", { "error": save_err, "scene_path": res_scene })

	return _ok("World scene layers ensured", { "scene_path": res_scene, "layers": ensured, "tileset_path": res_tileset })

func op_world_generate_tiles(params: Dictionary) -> Dictionary:
	var scene_path := String(params.get("scene_path", params.get("scenePath", ""))).strip_edges()
	if scene_path.is_empty():
		return _err("scene_path is required")
	var res_scene := _to_res_path(scene_path)

	var layer_name := String(params.get("layer_name", params.get("layerName", "Terrain"))).strip_edges()
	if layer_name.is_empty():
		layer_name = "Terrain"

	var map_size := _map_size_from(params.get("map_size", params.get("mapSize", {})), Vector2i(64, 64))
	if map_size.x <= 0 or map_size.y <= 0:
		return _err("Invalid map_size", { "map_size": map_size })

	var seed := int(_num(params.get("seed", 0)))
	var rng := RandomNumberGenerator.new()
	rng.seed = seed

	var tileset_path := String(params.get("tileset_path", params.get("tilesetPath", ""))).strip_edges()
	var res_tileset := _to_res_path(tileset_path) if not tileset_path.is_empty() else ""
	var tileset_res: Resource = null
	if not res_tileset.is_empty() and ResourceLoader.exists(res_tileset):
		tileset_res = load(res_tileset)

	var loaded_scene := load(res_scene)
	if loaded_scene == null or not (loaded_scene is PackedScene):
		return _err("Failed to load world scene", { "scene_path": res_scene })
	var root := (loaded_scene as PackedScene).instantiate()
	if root == null:
		return _err("Failed to instantiate world scene", { "scene_path": res_scene })

	var layer := _find_layer_node(root, layer_name)
	if layer == null:
		return _err("Layer not found", { "layer_name": layer_name, "scene_path": res_scene, "suggestions": ["Run op_world_scene_ensure_layers first."] })

	if tileset_res != null:
		_set_if_has(layer, "tile_set", tileset_res)

	_layer_clear(layer)

	var mapping: Dictionary = {}
	if params.has("tile_mapping") and typeof(params.tile_mapping) == TYPE_DICTIONARY:
		mapping = params.tile_mapping
	elif params.has("tileMapping") and typeof(params.tileMapping) == TYPE_DICTIONARY:
		mapping = params.tileMapping

	var atlas_grass := _atlas_from_mapping(mapping, "grass", Vector2i(0, 0))
	var atlas_forest := _atlas_from_mapping(mapping, "forest", Vector2i(1, 0))
	var atlas_water := _atlas_from_mapping(mapping, "water", Vector2i(2, 0))
	var atlas_path := _atlas_from_mapping(mapping, "path", Vector2i(3, 0))
	var atlas_cliff := _atlas_from_mapping(mapping, "cliff", Vector2i(4, 0))

	var source_id := int(_num(params.get("source_id", params.get("sourceId", 0))))
	var alternative := int(_num(params.get("alternative", 0)))

	var rules: Dictionary = {}
	if params.has("placement_rules") and typeof(params.placement_rules) == TYPE_DICTIONARY:
		rules = params.placement_rules
	elif params.has("placementRules") and typeof(params.placementRules) == TYPE_DICTIONARY:
		rules = params.placementRules

	var path_rules: Dictionary = {}
	if rules.has("paths") and typeof(rules.paths) == TYPE_DICTIONARY:
		path_rules = rules.paths
	var paths_enabled := bool(path_rules.get("enabled", false))
	var path_width := int(_num(path_rules.get("width", 2)))
	if path_width < 1:
		path_width = 1

	var grass_w := 0.6
	var forest_w := 0.3
	var river_w := 0.1
	if params.has("biomes") and typeof(params.biomes) == TYPE_ARRAY:
		for raw_biome in params.biomes:
			if typeof(raw_biome) != TYPE_DICTIONARY:
				continue
			var b: Dictionary = raw_biome
			var name := String(b.get("name", "")).strip_edges().to_lower()
			var weight := float(_num(b.get("weight", 0.0)))
			if name == "grassland" or name == "grass":
				grass_w = weight
			elif name == "forest":
				forest_w = weight
			elif name == "river" or name == "water":
				river_w = weight

	var river_carve := true
	if rules.has("riverCarve") or rules.has("river_carve"):
		river_carve = bool(rules.get("riverCarve", rules.get("river_carve", true)))
	else:
		river_carve = river_w > 0.0

	var river_width := 2
	if rules.has("riverWidth") or rules.has("river_width"):
		river_width = int(_num(rules.get("riverWidth", rules.get("river_width", 2)), 2))
	else:
		river_width = max(1, int(round(clamp(river_w, 0.0, 0.5) * 20.0)))
	if river_width < 1:
		river_width = 1

	# Noise-driven biome generation (forest vs grass), with optional smoothing.
	var noise_freq := float(_num(rules.get("noiseFrequency", rules.get("noise_frequency", 0.03)), 0.03))
	var noise_octaves := int(_num(rules.get("noiseOctaves", rules.get("noise_octaves", 3)), 3))
	if noise_octaves < 1:
		noise_octaves = 1

	var noise := FastNoiseLite.new()
	noise.seed = seed
	noise.frequency = noise_freq
	noise.fractal_octaves = noise_octaves
	noise.fractal_lacunarity = float(_num(rules.get("noiseLacunarity", rules.get("noise_lacunarity", 2.0)), 2.0))
	noise.fractal_gain = float(_num(rules.get("noiseGain", rules.get("noise_gain", 0.5)), 0.5))

	var sample_step := int(_num(rules.get("sampleStep", rules.get("sample_step", 4)), 4))
	if sample_step < 1:
		sample_step = 4

	var samples: Array = []
	for sy in range(0, map_size.y, sample_step):
		for sx in range(0, map_size.x, sample_step):
			samples.append(noise.get_noise_2d(float(sx), float(sy)))
	if samples.size() == 0:
		samples.append(0.0)
	samples.sort()

	var non_river_total: float = float(max(0.0001, grass_w + forest_w))
	var forest_fraction: float = float(clamp(float(forest_w) / float(non_river_total), 0.0, 1.0))
	var threshold_index: int = int(clamp(round((1.0 - forest_fraction) * float(samples.size() - 1)), 0, samples.size() - 1))
	var forest_threshold: float = float(samples[threshold_index])

	var kinds := PackedByteArray()
	kinds.resize(map_size.x * map_size.y)

	for y in range(map_size.y):
		for x in range(map_size.x):
			var n := noise.get_noise_2d(float(x), float(y))
			var idx := y * map_size.x + x
			kinds[idx] = 1 if n > forest_threshold else 0

	# River carving (meandering) overwrites biomes.
	if river_carve:
		var river_noise := FastNoiseLite.new()
		river_noise.seed = seed + 101
		river_noise.frequency = float(_num(rules.get("riverFrequency", rules.get("river_frequency", 0.05)), 0.05))
		var river_meander := float(_num(rules.get("riverMeander", rules.get("river_meander", 1.0)), 1.0))

		var river_x := rng.randi_range(0, max(0, map_size.x - 1))
		for y in range(map_size.y):
			var n := river_noise.get_noise_2d(float(river_x), float(y))
			var dx := int(round(n * river_meander))
			dx = clamp(dx, -1, 1)
			if rng.randf() < 0.15:
				dx = rng.randi_range(-1, 1)
			river_x = clamp(river_x + dx, 0, max(0, map_size.x - 1))

			var w := river_width
			if rng.randf() < 0.25:
				w += rng.randi_range(-1, 1)
			w = clamp(w, 1, max(1, map_size.x))
			var half := int(floor(float(w) * 0.5))
			for xx in range(river_x - half, river_x - half + w):
				if xx < 0 or xx >= map_size.x:
					continue
				kinds[y * map_size.x + xx] = 2

	var smooth_iters := int(_num(rules.get("smoothIterations", rules.get("smooth_iterations", 1)), 1))
	smooth_iters = clamp(smooth_iters, 0, 6)
	for _i in range(smooth_iters):
		var next := PackedByteArray()
		next.resize(kinds.size())
		for y in range(map_size.y):
			for x in range(map_size.x):
				var idx := y * map_size.x + x
				var k := int(kinds[idx])
				if k == 2 or k == 3:
					next[idx] = k
					continue
				var forest_n := 0
				for dy in range(-1, 2):
					for dx in range(-1, 2):
						if dx == 0 and dy == 0:
							continue
						var nx := x + dx
						var ny := y + dy
						if nx < 0 or ny < 0 or nx >= map_size.x or ny >= map_size.y:
							continue
						var nk := int(kinds[ny * map_size.x + nx])
						if nk == 1:
							forest_n += 1
				if forest_n >= 5:
					next[idx] = 1
				elif forest_n <= 3:
					next[idx] = 0
				else:
					next[idx] = k
		kinds = next

	# Paths (roads) generated after river so they can avoid water.
	if paths_enabled:
		var path_noise := FastNoiseLite.new()
		path_noise.seed = seed + 202
		path_noise.frequency = float(_num(path_rules.get("frequency", path_rules.get("noise_frequency", 0.05)), 0.05))
		var meander := float(_num(path_rules.get("meander", 8.0), 8.0))
		var search_radius := int(_num(path_rules.get("searchRadius", path_rules.get("search_radius", 8)), 8))
		if search_radius < 0:
			search_radius = 0

		var mid_y := int(round(float(map_size.y) * 0.5))
		for x in range(map_size.x):
			var offset := int(round(path_noise.get_noise_2d(float(x), 0.0) * meander))
			var base_y: int = int(clamp(mid_y + offset, 0, max(0, map_size.y - 1)))
			var yy := base_y

			if int(kinds[yy * map_size.x + x]) == 2:
				var found := false
				for d in range(1, search_radius + 1):
					var y1: int = base_y + d
					var y2: int = base_y - d
					if y1 >= 0 and y1 < map_size.y and int(kinds[y1 * map_size.x + x]) != 2:
						yy = y1
						found = true
						break
					if y2 >= 0 and y2 < map_size.y and int(kinds[y2 * map_size.x + x]) != 2:
						yy = y2
						found = true
						break
				if not found:
					continue

			var halfp := int(floor(float(path_width) * 0.5))
			for dy in range(path_width):
				var y: int = yy + dy - halfp
				if y < 0 or y >= map_size.y:
					continue
				var idx: int = y * map_size.x + x
				if int(kinds[idx]) == 2:
					continue
				kinds[idx] = 3

	# Optional: mark border as cliffs for containment.
	var border_cliffs := bool(rules.get("borderCliffs", rules.get("border_cliffs", false)))
	if border_cliffs:
		for x in range(map_size.x):
			var i1 := 0 * map_size.x + x
			var i2 := (map_size.y - 1) * map_size.x + x
			if int(kinds[i1]) != 2 and int(kinds[i1]) != 3:
				kinds[i1] = 4
			if int(kinds[i2]) != 2 and int(kinds[i2]) != 3:
				kinds[i2] = 4
		for y in range(map_size.y):
			var j1 := y * map_size.x + 0
			var j2 := y * map_size.x + (map_size.x - 1)
			if int(kinds[j1]) != 2 and int(kinds[j1]) != 3:
				kinds[j1] = 4
			if int(kinds[j2]) != 2 and int(kinds[j2]) != 3:
				kinds[j2] = 4

	var count_grass := 0
	var count_forest := 0
	var count_water := 0
	var count_path := 0
	var count_cliff := 0

	for y in range(map_size.y):
		for x in range(map_size.x):
			var idx := y * map_size.x + x
			var k := int(kinds[idx])
			var at := atlas_grass
			if k == 1:
				at = atlas_forest
				count_forest += 1
			elif k == 2:
				at = atlas_water
				count_water += 1
			elif k == 3:
				at = atlas_path
				count_path += 1
			elif k == 4:
				at = atlas_cliff
				count_cliff += 1
			else:
				at = atlas_grass
				count_grass += 1
			_layer_set_cell(layer, Vector2i(x, y), source_id, at, alternative)

	var packed := PackedScene.new()
	var pack_err := packed.pack(root)
	if pack_err != OK:
		return _err("Failed to pack world scene", { "error": pack_err })
	var save_err := ResourceSaver.save(packed, res_scene)
	if save_err != OK:
		return _err("Failed to save world scene", { "error": save_err, "scene_path": res_scene })

	return _ok("World tiles generated", {
		"scene_path": res_scene,
		"layer_name": layer_name,
		"map_size": map_size,
		"seed": seed,
		"counts": {
			"grass": count_grass,
			"forest": count_forest,
			"water": count_water,
			"path": count_path,
			"cliff": count_cliff,
		}
	})

func op_export_preview(params: Dictionary) -> Dictionary:
	var scene_path := String(params.get("scene_path", params.get("scenePath", ""))).strip_edges()
	if scene_path.is_empty():
		return _err("scene_path is required")

	var output_png_path := String(params.get("output_png_path", params.get("outputPngPath", params.get("output_path", params.get("outputPath", ""))))).strip_edges()
	if output_png_path.is_empty():
		return _err("output_png_path is required")

	var layer_name := String(params.get("layer_name", params.get("layerName", "Terrain"))).strip_edges()
	if layer_name.is_empty():
		layer_name = "Terrain"

	var res_scene := _to_res_path(scene_path)
	var res_out := _to_res_path(output_png_path)

	var loaded_scene := load(res_scene)
	if loaded_scene == null or not (loaded_scene is PackedScene):
		return _err("Failed to load world scene", { "scene_path": res_scene })
	var root := (loaded_scene as PackedScene).instantiate()
	if root == null:
		return _err("Failed to instantiate world scene", { "scene_path": res_scene })

	var layer := _find_layer_node(root, layer_name)
	if layer == null:
		return _err("Layer not found", { "layer_name": layer_name, "scene_path": res_scene })

	var map_size := _map_size_from(params.get("map_size", params.get("mapSize", {})), Vector2i(0, 0))
	if map_size.x <= 0 or map_size.y <= 0:
		if layer.has_method("get_used_rect"):
			var used: Variant = layer.call("get_used_rect")
			if typeof(used) == TYPE_RECT2I:
				map_size = (used as Rect2i).size
		if map_size.x <= 0 or map_size.y <= 0:
			map_size = Vector2i(256, 256)

	var mapping: Dictionary = {}
	if params.has("tile_mapping") and typeof(params.tile_mapping) == TYPE_DICTIONARY:
		mapping = params.tile_mapping
	elif params.has("tileMapping") and typeof(params.tileMapping) == TYPE_DICTIONARY:
		mapping = params.tileMapping

	var atlas_grass := _atlas_from_mapping(mapping, "grass", Vector2i(0, 0))
	var atlas_forest := _atlas_from_mapping(mapping, "forest", Vector2i(1, 0))
	var atlas_water := _atlas_from_mapping(mapping, "water", Vector2i(2, 0))
	var atlas_path := _atlas_from_mapping(mapping, "path", Vector2i(3, 0))
	var atlas_cliff := _atlas_from_mapping(mapping, "cliff", Vector2i(4, 0))

	var img := Image.create(map_size.x, map_size.y, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	for y in range(map_size.y):
		for x in range(map_size.x):
			var at := _layer_get_cell_atlas(layer, Vector2i(x, y))
			var c := Color(0, 0, 0, 0)
			if at == Vector2i(-1, -1):
				c = Color(0, 0, 0, 0)
			elif at == atlas_water:
				c = Color(0.15, 0.45, 0.85, 1)
			elif at == atlas_forest:
				c = Color(0.10, 0.40, 0.15, 1)
			elif at == atlas_grass:
				c = Color(0.20, 0.70, 0.25, 1)
			elif at == atlas_path:
				c = Color(0.60, 0.40, 0.20, 1)
			elif at == atlas_cliff:
				c = Color(0.55, 0.55, 0.55, 1)
			else:
				var h := int(at.x * 73856093) ^ int(at.y * 19349663)
				var r := float(h & 0xff) / 255.0
				var g := float((h >> 8) & 0xff) / 255.0
				var b := float((h >> 16) & 0xff) / 255.0
				c = Color(r, g, b, 1)
			img.set_pixel(x, y, c)

	var dir_err := _ensure_dir_for_res_path(res_out)
	if dir_err != OK:
		return _err("Failed to create output directory", { "error": dir_err, "dir": res_out.get_base_dir() })

	var save_err := img.save_png(res_out)
	if save_err != OK:
		return _err("Failed to save preview PNG", { "error": save_err, "output_png_path": res_out })

	return _ok("Preview exported", { "scene_path": res_scene, "layer_name": layer_name, "output_png_path": res_out, "map_size": map_size })

