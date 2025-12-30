extends "pixel_ops_base.gd"

func get_operations() -> Dictionary:
	return {
		"op_place_objects_tile": Callable(self, "op_place_objects_tile"),
		"op_place_objects_scene_instances": Callable(self, "op_place_objects_scene_instances"),
	}

func op_place_objects_tile(params: Dictionary) -> Dictionary:
	var scene_path := String(params.get("scene_path", params.get("scenePath", ""))).strip_edges()
	if scene_path.is_empty():
		return _err("scene_path is required")
	var res_scene := _to_res_path(scene_path)

	var loaded_scene := load(res_scene)
	if loaded_scene == null or not (loaded_scene is PackedScene):
		return _err("Failed to load world scene", { "scene_path": res_scene })
	var root := (loaded_scene as PackedScene).instantiate()
	if root == null:
		return _err("Failed to instantiate world scene", { "scene_path": res_scene })

	var terrain_name := String(params.get("terrain_layer_name", params.get("terrainLayerName", "Terrain"))).strip_edges()
	var props_name := String(params.get("props_layer_name", params.get("propsLayerName", "Props"))).strip_edges()
	var terrain := _find_layer_node(root, terrain_name)
	var props := _find_layer_node(root, props_name)
	if terrain == null or props == null:
		return _err("Missing terrain/props layer", { "terrain": terrain_name, "props": props_name, "suggestions": ["Run op_world_scene_ensure_layers first."] })

	var map_size := _map_size_from(params.get("map_size", params.get("mapSize", {})), Vector2i(0, 0))
	if map_size.x <= 0 or map_size.y <= 0:
		return _err("map_size is required for object placement", { "map_size": map_size })

	var seed := int(_num(params.get("seed", 0)))
	var rng := RandomNumberGenerator.new()
	rng.seed = seed

	var objects: Array = []
	if params.has("objects") and typeof(params.objects) == TYPE_ARRAY:
		objects = params.objects

	if objects.size() == 0:
		return _err("objects is required", { "suggestions": ["Provide objects[] with atlas coords and density."] })

	var source_id := int(_num(params.get("source_id", params.get("sourceId", 0))))
	var alternative := int(_num(params.get("alternative", 0)))

	var placed_total := 0
	var per_object: Array = []

	for raw_obj in objects:
		if typeof(raw_obj) != TYPE_DICTIONARY:
			continue
		var obj: Dictionary = raw_obj
		var obj_id := String(obj.get("id", obj.get("name", ""))).strip_edges()
		var density := float(_num(obj.get("density", 0.1), 0.1))
		if density < 0:
			density = 0
		if density > 1:
			density = 1

		var atlas := _vec2i_from(obj.get("atlas", obj.get("atlas_coords", obj.get("atlasCoords", {}))), Vector2i(0, 0))
		var on_atlas := _atlas_list_from(obj.get("on_atlas", obj.get("onAtlas", [])))
		var avoid_atlas := _atlas_list_from(obj.get("avoid_atlas", obj.get("avoidAtlas", [])))
		var prefer_near_atlas := _atlas_list_from(obj.get("prefer_near_atlas", obj.get("preferNearAtlas", obj.get("near_atlas", obj.get("nearAtlas", [])))))
		var prefer_distance := int(_num(obj.get("prefer_distance", obj.get("preferDistance", obj.get("near_distance", obj.get("nearDistance", 0)))), 0))
		var prefer_multiplier := float(_num(obj.get("prefer_multiplier", obj.get("preferMultiplier", 1.0)), 1.0))
		if prefer_multiplier < 1.0:
			prefer_multiplier = 1.0
		var min_distance := int(_num(obj.get("min_distance", obj.get("minDistance", 0)), 0))

		var placed: Array = []
		var placed_count := 0
		for y in range(map_size.y):
			for x in range(map_size.x):
				var p := density
				if prefer_near_atlas.size() > 0 and prefer_distance > 0 and prefer_multiplier > 1.0:
					var near := _is_near_atlas(terrain, Vector2i(x, y), prefer_near_atlas, prefer_distance, map_size)
					if near:
						p = min(1.0, density * prefer_multiplier)
					else:
						p = density / prefer_multiplier
				if rng.randf() > p:
					continue
				var at := _layer_get_cell_atlas(terrain, Vector2i(x, y))
				if avoid_atlas.size() > 0 and _atlas_in_list(at, avoid_atlas):
					continue
				if on_atlas.size() > 0 and not _atlas_in_list(at, on_atlas):
					continue

				if min_distance > 0:
					var ok := true
					for placed_pos in placed:
						if typeof(placed_pos) != TYPE_VECTOR2I:
							continue
						var pv: Vector2i = placed_pos
						if abs(pv.x - x) <= min_distance and abs(pv.y - y) <= min_distance:
							ok = false
							break
					if not ok:
						continue

				_layer_set_cell(props, Vector2i(x, y), source_id, atlas, alternative)
				placed.append(Vector2i(x, y))
				placed_count += 1

		placed_total += placed_count
		per_object.append({ "id": obj_id, "placed": placed_count, "density": density, "atlas": atlas })

	var packed := PackedScene.new()
	var pack_err := packed.pack(root)
	if pack_err != OK:
		return _err("Failed to pack world scene", { "error": pack_err })
	var save_err := ResourceSaver.save(packed, res_scene)
	if save_err != OK:
		return _err("Failed to save world scene", { "error": save_err, "scene_path": res_scene })

	return _ok("Objects placed as tiles", { "scene_path": res_scene, "placed": placed_total, "objects": per_object })

func op_place_objects_scene_instances(params: Dictionary) -> Dictionary:
	var scene_path := String(params.get("scene_path", params.get("scenePath", ""))).strip_edges()
	if scene_path.is_empty():
		return _err("scene_path is required")
	var res_scene := _to_res_path(scene_path)

	var loaded_scene := load(res_scene)
	if loaded_scene == null or not (loaded_scene is PackedScene):
		return _err("Failed to load world scene", { "scene_path": res_scene })
	var root := (loaded_scene as PackedScene).instantiate()
	if root == null:
		return _err("Failed to instantiate world scene", { "scene_path": res_scene })

	var parent_path := String(params.get("parent_node_path", params.get("parentNodePath", "root/Interactive"))).strip_edges()
	var parent := _find_node(root, parent_path)
	if parent == null:
		parent = _ensure_child(root, "Interactive", "Node2D")
		if parent == null:
			return _err("Failed to ensure Interactive parent", { "scene_path": res_scene })
		parent.owner = root

	var terrain_name := String(params.get("terrain_layer_name", params.get("terrainLayerName", "Terrain"))).strip_edges()
	var terrain := _find_layer_node(root, terrain_name)
	if terrain == null:
		return _err("Terrain layer not found", { "terrain": terrain_name, "scene_path": res_scene })

	var map_size := _map_size_from(params.get("map_size", params.get("mapSize", {})), Vector2i(0, 0))
	if map_size.x <= 0 or map_size.y <= 0:
		return _err("map_size is required for scene placement", { "map_size": map_size })

	var seed := int(_num(params.get("seed", 0)))
	var rng := RandomNumberGenerator.new()
	rng.seed = seed

	var tile_size := _tile_size_from_any(params, ["tile_size", "tileSize"], Vector2i(16, 16))

	var objects: Array = []
	if params.has("objects") and typeof(params.objects) == TYPE_ARRAY:
		objects = params.objects
	if objects.size() == 0:
		return _err("objects is required", { "suggestions": ["Provide objects[] with scenePath and count/density."] })

	var avoid_atlas := _atlas_list_from(params.get("avoid_atlas", params.get("avoidAtlas", [])))

	var total_instances := 0
	var per_object: Array = []

	for raw_obj in objects:
		if typeof(raw_obj) != TYPE_DICTIONARY:
			continue
		var obj: Dictionary = raw_obj
		var obj_id := String(obj.get("id", obj.get("name", ""))).strip_edges()
		var obj_scene_path := String(obj.get("scene_path", obj.get("scenePath", ""))).strip_edges()
		if obj_scene_path.is_empty():
			continue
		var res_obj_scene := _to_res_path(obj_scene_path)
		if not ResourceLoader.exists(res_obj_scene):
			return _err("Object scene not found", { "object": obj_id, "scene_path": res_obj_scene })

		var density := float(_num(obj.get("density", -1.0), -1.0))
		var count := int(_num(obj.get("count", -1), -1))
		if count < 0 and density >= 0:
			count = int(floor(float(map_size.x * map_size.y) * clamp(density, 0.0, 1.0)))
		if count < 0:
			count = 1

		var on_atlas := _atlas_list_from(obj.get("on_atlas", obj.get("onAtlas", [])))
		var obj_avoid_atlas := _atlas_list_from(obj.get("avoid_atlas", obj.get("avoidAtlas", [])))
		var prefer_near_atlas := _atlas_list_from(obj.get("prefer_near_atlas", obj.get("preferNearAtlas", obj.get("near_atlas", obj.get("nearAtlas", [])))))
		var prefer_distance := int(_num(obj.get("prefer_distance", obj.get("preferDistance", obj.get("near_distance", obj.get("nearDistance", 0)))), 0))
		var prefer_multiplier := float(_num(obj.get("prefer_multiplier", obj.get("preferMultiplier", 1.0)), 1.0))
		if prefer_multiplier < 1.0:
			prefer_multiplier = 1.0

		var min_distance := int(_num(obj.get("min_distance", obj.get("minDistance", 0)), 0))
		var placed: Array = []
		var placed_count := 0
		for _i in range(count):
			# Retry a few times to find a valid spot.
			var found := false
			for _try in range(200):
				var x := rng.randi_range(0, max(0, map_size.x - 1))
				var y := rng.randi_range(0, max(0, map_size.y - 1))
				var at := _layer_get_cell_atlas(terrain, Vector2i(x, y))
				if avoid_atlas.size() > 0 and _atlas_in_list(at, avoid_atlas):
					continue
				if obj_avoid_atlas.size() > 0 and _atlas_in_list(at, obj_avoid_atlas):
					continue
				if on_atlas.size() > 0 and not _atlas_in_list(at, on_atlas):
					continue

				if prefer_near_atlas.size() > 0 and prefer_distance > 0 and prefer_multiplier > 1.0:
					var near := _is_near_atlas(terrain, Vector2i(x, y), prefer_near_atlas, prefer_distance, map_size)
					if not near and rng.randf() > (1.0 / prefer_multiplier):
						continue

				if min_distance > 0:
					var ok := true
					for p in placed:
						if typeof(p) != TYPE_VECTOR2I:
							continue
						var pv: Vector2i = p
						if abs(pv.x - x) <= min_distance and abs(pv.y - y) <= min_distance:
							ok = false
							break
					if not ok:
						continue

				var ps := load(res_obj_scene) as PackedScene
				if ps == null:
					return _err("Failed to load object scene", { "scene_path": res_obj_scene })
				var inst := ps.instantiate()
				if inst == null or not (inst is Node2D):
					return _err("Object scene root must be Node2D", { "scene_path": res_obj_scene })

				(inst as Node2D).position = Vector2(float(x * tile_size.x), float(y * tile_size.y))
				parent.add_child(inst as Node)
				(inst as Node).owner = root
				placed.append(Vector2i(x, y))
				placed_count += 1
				found = true
				break
			if not found:
				break

		total_instances += placed_count
		per_object.append({ "id": obj_id, "placed": placed_count, "requested": count, "scene_path": res_obj_scene })

	var packed := PackedScene.new()
	var pack_err := packed.pack(root)
	if pack_err != OK:
		return _err("Failed to pack world scene", { "error": pack_err })
	var save_err := ResourceSaver.save(packed, res_scene)
	if save_err != OK:
		return _err("Failed to save world scene", { "error": save_err, "scene_path": res_scene })

	return _ok("Objects placed as scene instances", { "scene_path": res_scene, "placed": total_instances, "objects": per_object })

