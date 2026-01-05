extends "ops_module_base.gd"

func get_operations() -> Dictionary:
	return {
		"create_scene": Callable(self, "create_scene"),
		"add_node": Callable(self, "add_node"),
		"create_node_bundle": Callable(self, "create_node_bundle"),
		"instance_scene": Callable(self, "instance_scene"),
		"create_tilemap": Callable(self, "create_tilemap"),
		"generate_terrain_mesh": Callable(self, "generate_terrain_mesh"),
		"eval_expression": Callable(self, "eval_expression"),
				"save_scene": Callable(self, "save_scene"),
				"validate_scene": Callable(self, "validate_scene"),
				"set_node_properties": Callable(self, "set_node_properties"),
				"rename_node": Callable(self, "rename_node"),
				"move_node": Callable(self, "move_node"),
			"create_simple_animation": Callable(self, "create_simple_animation"),
			"connect_signal": Callable(self, "connect_signal"),
			"attach_script": Callable(self, "attach_script"),
			"create_script": Callable(self, "create_script"),
		}

func _p(params: Dictionary, keys: Array, fallback = null):
	for k in keys:
		if params.has(k):
			return params[k]
	return fallback

func _p_str(params: Dictionary, keys: Array, fallback: String = "") -> String:
	var v = _p(params, keys, fallback)
	if v == null:
		return fallback
	return String(v)

func eval_expression(params: Dictionary) -> Dictionary:
	var expression := _p_str(params, ["expression", "code"], "").strip_edges()
	if expression.is_empty():
		return _err("expression/code is required")
	if expression.find("\n") != -1 or expression.find("\r") != -1:
		return _err("expression must be single-line")
	if expression.length() > 2000:
		return _err("expression is too long", { "max": 2000, "length": expression.length() })

	# Block member access / method calls: allow '.' only in numeric literals (e.g., 1.23)
	var dot := expression.find(".")
	while dot != -1:
		var prev := expression.substr(dot - 1, 1) if dot > 0 else ""
		var next := expression.substr(dot + 1, 1) if dot + 1 < expression.length() else ""
		if not prev.is_valid_int() or not next.is_valid_int():
			return _err("Restricted eval blocks member access ('.' is only allowed in numeric literals)", { "index": dot })
		dot = expression.find(".", dot + 1)

	var lowered := expression.to_lower()
	var banned := [
		"os",
		"fileaccess",
		"diraccess",
		"projectsettings",
		"editorinterface",
		"engine",
		"classdb",
		"resourcesaver",
		"resourceloader",
		"load(",
		"preload(",
		"@tool",
		"extends",
		"class ",
		"func ",
		"var ",
		"while ",
		"for ",
		"await ",
	]
	for token in banned:
		if lowered.find(String(token)) != -1:
			return _err("Restricted eval blocked unsafe token", { "token": token })

	var vars_v = params.get("vars", params.get("variables", {}))
	var input_names := PackedStringArray()
	var inputs: Array = []
	if typeof(vars_v) == TYPE_DICTIONARY:
		var vars: Dictionary = vars_v
		for k in vars.keys():
			input_names.append(str(k))
			inputs.append(_json_to_variant(vars[k]))

	var e := Expression.new()
	var parse_err := e.parse(expression, input_names)
	if parse_err != OK:
		return _err("Expression parse error", { "error": e.get_error_text() })

	var result = e.execute(inputs, null, true)
	if e.has_execute_failed():
		return _err("Expression execute error", { "error": e.get_error_text() })

	return _ok("Expression evaluated", { "expression": expression, "result": str(result) })

func create_scene(params: Dictionary) -> Dictionary:
	var scene_path_raw := _p_str(params, ["scenePath", "scene_path"], "")
	if scene_path_raw.is_empty():
		return _err("scenePath/scene_path is required")

	var scene_path := _to_res_path(scene_path_raw)
	var root_node_type := _p_str(params, ["rootNodeType", "root_node_type"], "Node2D")

	var root = _instantiate_class(root_node_type)
	if root == null or not (root is Node):
		return _err("Failed to instantiate root node", { "root_node_type": root_node_type })

	(root as Node).name = "root"

	var packed := PackedScene.new()
	var pack_err := packed.pack(root)
	if pack_err != OK:
		return _err("Failed to pack scene", { "error": pack_err })

	var dir_err := _ensure_dir_for_res_path(scene_path)
	if dir_err != OK:
		return _err("Failed to create scene directory", { "error": dir_err, "dir": scene_path.get_base_dir() })

	var save_err := ResourceSaver.save(packed, scene_path)
	if save_err != OK:
		return _err("Failed to save scene", { "error": save_err, "scene_path": scene_path })

	return _ok("Scene created", { "scene_path": scene_path, "absolute_path": ProjectSettings.globalize_path(scene_path) })

func add_node(params: Dictionary) -> Dictionary:
	var scene_path_raw := _p_str(params, ["scenePath", "scene_path"], "")
	var node_type := _p_str(params, ["nodeType", "node_type"], "")
	var node_name := _p_str(params, ["nodeName", "node_name"], "")
	if scene_path_raw.is_empty() or node_type.is_empty() or node_name.is_empty():
		return _err("scenePath/scene_path, nodeType/node_type, nodeName/node_name are required")

	var scene_path := _to_res_path(scene_path_raw)
	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var parent_path := _p_str(params, ["parentNodePath", "parent_node_path"], "root")

	var parent := _find_node(scene_root, parent_path)
	if parent == null:
		return _err("Parent node not found", { "parent_node_path": parent_path })

	var ensure_unique := bool(_p(params, ["ensureUniqueName", "ensure_unique_name"], false))
	var new_node = _instantiate_class(node_type)
	if new_node == null or not (new_node is Node):
		return _err("Failed to instantiate node", { "node_type": node_type })

	if ensure_unique:
		node_name = _unique_child_name(parent, node_name)
	(new_node as Node).name = node_name

	var props_v = params.get("properties", params.get("props", {}))
	if typeof(props_v) == TYPE_DICTIONARY:
		var props: Dictionary = props_v
		for key in props.keys():
			var prop_name := String(key)
			var expected := _prop_type(new_node as Node, prop_name)
			(new_node as Node).set(prop_name, _json_to_variant_for_type(props[key], expected))

	parent.add_child(new_node)
	(new_node as Node).owner = scene_root

	var packed := PackedScene.new()
	var pack_err := packed.pack(scene_root)
	if pack_err != OK:
		return _err("Failed to pack scene", { "error": pack_err })

	var save_err := ResourceSaver.save(packed, scene_path)
	if save_err != OK:
		return _err("Failed to save scene", { "error": save_err, "scene_path": scene_path })

	var node_path := _node_path_str(scene_root, new_node as Node)
	return _ok("Node added", { "scene_path": scene_path, "node_name": node_name, "node_type": node_type, "node_path": node_path, "ensure_unique_name": ensure_unique })

func create_node_bundle(params: Dictionary) -> Dictionary:
	var scene_path_raw := _p_str(params, ["scenePath", "scene_path"], "")
	var node_type := _p_str(params, ["nodeType", "node_type"], "")
	var node_name := _p_str(params, ["nodeName", "node_name"], "")
	if scene_path_raw.is_empty() or node_type.is_empty() or node_name.is_empty():
		return _err("scenePath/scene_path, nodeType/node_type, nodeName/node_name are required")

	var scene_path := _to_res_path(scene_path_raw)
	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var parent_path := _p_str(params, ["parentNodePath", "parent_node_path"], "root")

	var parent := _find_node(scene_root, parent_path)
	if parent == null:
		return _err("Parent node not found", { "parent_node_path": parent_path })

	var ensure_unique := bool(_p(params, ["ensureUniqueName", "ensure_unique_name"], false))
	var root_node = _instantiate_class(node_type)
	if root_node == null or not (root_node is Node):
		return _err("Failed to instantiate node", { "node_type": node_type })

	if ensure_unique:
		node_name = _unique_child_name(parent, node_name)
	(root_node as Node).name = node_name

	var props_v = params.get("properties", params.get("props", {}))
	if typeof(props_v) == TYPE_DICTIONARY:
		var props: Dictionary = props_v
		for key in props.keys():
			var prop_name := String(key)
			var expected := _prop_type(root_node as Node, prop_name)
			(root_node as Node).set(prop_name, _json_to_variant_for_type(props[key], expected))

	parent.add_child(root_node)
	(root_node as Node).owner = scene_root

	var children_value = params.get("children", params.get("items", []))
	var children: Array = children_value if typeof(children_value) == TYPE_ARRAY else []
	var children_info: Array = []
	for c in children:
		if typeof(c) != TYPE_DICTIONARY:
			return _err("children must be objects", { "child": c })
		var d: Dictionary = c
		var child_type := String(d.get("node_type", d.get("nodeType", "")))
		var child_name := String(d.get("node_name", d.get("nodeName", "")))
		if child_type.is_empty() or child_name.is_empty():
			return _err("child node_type and node_name are required", { "child": d })
		var child_node = _instantiate_class(child_type)
		if child_node == null or not (child_node is Node):
			return _err("Failed to instantiate child node", { "child_type": child_type })
		var child_unique := bool(d.get("ensure_unique_name", d.get("ensureUniqueName", false)))
		if child_unique:
			child_name = _unique_child_name(root_node as Node, child_name)
		(child_node as Node).name = child_name
		var child_props_v = d.get("properties", d.get("props", {}))
		if typeof(child_props_v) == TYPE_DICTIONARY:
			var child_props: Dictionary = child_props_v
			for key2 in child_props.keys():
				var prop_name2 := String(key2)
				var expected2 := _prop_type(child_node as Node, prop_name2)
				(child_node as Node).set(prop_name2, _json_to_variant_for_type(child_props[key2], expected2))
		(root_node as Node).add_child(child_node)
		(child_node as Node).owner = scene_root
		children_info.append({
			"node_name": child_name,
			"node_type": child_type,
			"node_path": _node_path_str(scene_root, child_node as Node),
			"ensure_unique_name": child_unique,
			"role": d.get("role", ""),
		})

	var packed := PackedScene.new()
	var pack_err := packed.pack(scene_root)
	if pack_err != OK:
		return _err("Failed to pack scene", { "error": pack_err })

	var save_err := ResourceSaver.save(packed, scene_path)
	if save_err != OK:
		return _err("Failed to save scene", { "error": save_err, "scene_path": scene_path })

	return _ok(
		"Node bundle created",
		{
			"scene_path": scene_path,
			"node_name": node_name,
			"node_type": node_type,
			"node_path": _node_path_str(scene_root, root_node as Node),
			"ensure_unique_name": ensure_unique,
			"children": children_info,
		}
	)

func instance_scene(params: Dictionary) -> Dictionary:
	var target_scene_path_raw := _p_str(params, ["scenePath", "scene_path"], "")
	if target_scene_path_raw.is_empty():
		return _err("scenePath/scene_path is required")

	var source_scene_path_raw := _p_str(
		params,
		["sourceScenePath", "source_scene_path", "instanceScenePath", "instance_scene_path"],
		""
	)
	if source_scene_path_raw.is_empty():
		return _err("sourceScenePath/source_scene_path is required")

	var scene_path := _to_res_path(target_scene_path_raw)
	var source_scene_path := _to_res_path(source_scene_path_raw)

	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var parent_path := _p_str(params, ["parentNodePath", "parent_node_path"], "root")

	var parent := _find_node(scene_root, parent_path)
	if parent == null:
		return _err("Parent node not found", { "parent_node_path": parent_path })

	var source_res := load(source_scene_path)
	if source_res == null or not (source_res is PackedScene):
		return _err("Failed to load source scene", { "source_scene_path": source_scene_path })

	var inst := (source_res as PackedScene).instantiate()
	if inst == null or not (inst is Node):
		return _err("Failed to instantiate source scene", { "source_scene_path": source_scene_path })

	var ensure_unique := bool(_p(params, ["ensureUniqueName", "ensure_unique_name"], false))
	if params.has("name"):
		var desired := String(params.get("name"))
		if ensure_unique:
			desired = _unique_child_name(parent, desired)
		(inst as Node).name = desired
	elif ensure_unique:
		(inst as Node).name = _unique_child_name(parent, (inst as Node).name)

	if params.has("props") and typeof(params.props) == TYPE_DICTIONARY:
		var props: Dictionary = params.props
		for key in props.keys():
			var prop_name := String(key)
			var expected := _prop_type(inst as Node, prop_name)
			(inst as Node).set(prop_name, _json_to_variant_for_type(props[key], expected))

	parent.add_child(inst)
	(inst as Node).owner = scene_root

	var packed := PackedScene.new()
	var pack_err := packed.pack(scene_root)
	if pack_err != OK:
		return _err("Failed to pack scene", { "error": pack_err })

	var save_err := ResourceSaver.save(packed, scene_path)
	if save_err != OK:
		return _err("Failed to save scene", { "error": save_err, "scene_path": scene_path })

	var inst_name := (inst as Node).name
	var node_path := _node_path_str(scene_root, inst as Node)
	return _ok("Scene instanced", { "scene_path": scene_path, "source_scene_path": source_scene_path, "node_name": inst_name, "node_path": node_path, "ensure_unique_name": ensure_unique })


func create_tilemap(params: Dictionary) -> Dictionary:
	var scene_path_raw := _p_str(params, ["scenePath", "scene_path"], "")
	var node_name := _p_str(params, ["nodeName", "node_name"], "")
	if scene_path_raw.is_empty() or node_name.is_empty():
		return _err("scenePath/scene_path and nodeName/node_name are required")

	var scene_path := _to_res_path(scene_path_raw)
	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var parent_path := _p_str(params, ["parentNodePath", "parent_node_path"], "root")

	var parent := _find_node(scene_root, parent_path)
	if parent == null:
		return _err("Parent node not found", { "parent_node_path": parent_path })

	var node_type := _p_str(params, ["nodeType", "node_type"], "TileMap")
	var tilemap_node = _instantiate_class(node_type)
	if tilemap_node == null or not (tilemap_node is Node):
		return _err("Failed to instantiate TileMap", { "node_type": node_type })

	var ensure_unique := bool(_p(params, ["ensureUniqueName", "ensure_unique_name"], false))
	if ensure_unique:
		node_name = _unique_child_name(parent, node_name)
	(tilemap_node as Node).name = node_name

	if params.has("props") and typeof(params.props) == TYPE_DICTIONARY:
		var props: Dictionary = params.props
		for key in props.keys():
			var prop_name := String(key)
			var expected := _prop_type(tilemap_node as Node, prop_name)
			(tilemap_node as Node).set(prop_name, _json_to_variant_for_type(props[key], expected))

	var cells: Array = []
	if params.has("cells") and typeof(params.cells) == TYPE_ARRAY:
		cells = params.cells

	var tile_set_texture_path := String(params.get("tile_set_texture_path", params.get("tileSetTexturePath", "")))
	var tile_set_path := String(params.get("tile_set_path", params.get("tileSetPath", "")))
	var tile_size := _vec2i_from(params.get("tile_size", params.get("tileSize", {})), Vector2i(32, 32))

	var created_source_id := -1
	var tile_set_current = (tilemap_node as Node).get("tile_set")
	if tile_set_current == null and not tile_set_texture_path.is_empty():
		var tileset_resp := _create_tileset_from_texture(tile_set_texture_path, tile_size, cells)
		if not bool(tileset_resp.get("ok", false)):
			return _err("Failed to build TileSet from texture", { "texture_path": tile_set_texture_path, "details": tileset_resp })
		var tileset_res = tileset_resp.get("tileset")
		created_source_id = int(tileset_resp.get("source_id", -1))
		(tilemap_node as Node).set("tile_set", tileset_res)
		if not tile_set_path.is_empty():
			var save_path := _to_res_path(tile_set_path)
			if save_path != "" and not ResourceLoader.exists(save_path):
				ResourceSaver.save(tileset_res, save_path)

	var cell_count := 0
	if cells.size() > 0:
		if not (tilemap_node is TileMap):
			return _err("Node is not TileMap", { "node_type": node_type })
		var layer := int(_num(params.get("layer", 0)))
		for c in cells:
			if typeof(c) != TYPE_DICTIONARY:
				continue
			var d: Dictionary = c
			var x := int(_num(d.get("x", d.get("col", 0))))
			var y := int(_num(d.get("y", d.get("row", 0))))
			var source_id := int(_num(d.get("source_id", d.get("sourceId", d.get("id", d.get("tile", -1))))))
			if source_id < 0 and created_source_id >= 0:
				source_id = created_source_id
			var atlas_x := int(_num(d.get("atlas_x", d.get("atlasX", -1))))
			var atlas_y := int(_num(d.get("atlas_y", d.get("atlasY", -1))))
			var alternative := int(_num(d.get("alternative", d.get("alt", d.get("alternative_id", 0)))))
			(tilemap_node as TileMap).set_cell(
				layer,
				Vector2i(x, y),
				source_id,
				Vector2i(atlas_x, atlas_y),
				alternative
			)
			cell_count += 1

	parent.add_child(tilemap_node)
	(tilemap_node as Node).owner = scene_root

	var packed := PackedScene.new()
	var pack_err := packed.pack(scene_root)
	if pack_err != OK:
		return _err("Failed to pack scene", { "error": pack_err })

	var save_err := ResourceSaver.save(packed, scene_path)
	if save_err != OK:
		return _err("Failed to save scene", { "error": save_err, "scene_path": scene_path })

	var node_path := _node_path_str(scene_root, tilemap_node as Node)
	return _ok("TileMap created", { "scene_path": scene_path, "node_name": node_name, "node_path": node_path, "cells": cell_count, "ensure_unique_name": ensure_unique })

func generate_terrain_mesh(params: Dictionary) -> Dictionary:
	var scene_path_raw := _p_str(params, ["scenePath", "scene_path"], "")
	if scene_path_raw.is_empty():
		return _err("scenePath/scene_path is required")

	var scene_path := _to_res_path(scene_path_raw)
	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var parent_path := _p_str(params, ["parentNodePath", "parent_node_path"], "root")
	var parent := _find_node(scene_root, parent_path)
	if parent == null:
		return _err("Parent node not found", { "parent_node_path": parent_path })

	var desired_name := _p_str(params, ["nodeName", "name", "node_name"], "Terrain")
	var ensure_unique := bool(_p(params, ["ensureUniqueName", "ensure_unique_name"], false))
	var node_name := _unique_child_name(parent, desired_name) if ensure_unique else desired_name

	var size = max(1, int(_num(_p(params, ["size"], 32))))
	var height_scale := _num(_p(params, ["heightScale", "height_scale"], 5.0), 5.0)
	var seed_value := int(_num(_p(params, ["seed"], 0)))
	if seed_value == 0:
		seed_value = int(randi())
	var frequency = max(0.000001, _num(_p(params, ["frequency"], 0.02), 0.02))
	var octaves = max(1, int(_num(_p(params, ["octaves", "fractal_octaves"], 4), 4.0)))
	var center := bool(_p(params, ["center"], true))

	var noise := FastNoiseLite.new()
	noise.seed = seed_value
	noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	noise.frequency = frequency
	noise.fractal_octaves = octaves

	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)

	for z in range(size):
		for x in range(size):
			var h1 := noise.get_noise_2d(x, z) * height_scale
			var h2 := noise.get_noise_2d(x + 1, z) * height_scale
			var h3 := noise.get_noise_2d(x, z + 1) * height_scale
			var h4 := noise.get_noise_2d(x + 1, z + 1) * height_scale

			var v1 := Vector3(x, h1, z)
			var v2 := Vector3(x + 1, h2, z)
			var v3 := Vector3(x, h3, z + 1)
			var v4 := Vector3(x + 1, h4, z + 1)

			st.set_uv(Vector2(x, z))
			st.add_vertex(v1)
			st.set_uv(Vector2(x + 1, z))
			st.add_vertex(v2)
			st.set_uv(Vector2(x, z + 1))
			st.add_vertex(v3)

			st.set_uv(Vector2(x + 1, z))
			st.add_vertex(v2)
			st.set_uv(Vector2(x + 1, z + 1))
			st.add_vertex(v4)
			st.set_uv(Vector2(x, z + 1))
			st.add_vertex(v3)

	st.index()
	st.generate_normals()
	var mesh := st.commit()
	if mesh == null:
		return _err("Failed to create terrain mesh")

	var body := StaticBody3D.new()
	body.name = node_name
	body.set_meta("_edit_group_", true)

	var mesh_inst := MeshInstance3D.new()
	mesh_inst.name = "Mesh"
	mesh_inst.mesh = mesh
	body.add_child(mesh_inst)
	mesh_inst.owner = scene_root

	var shape := CollisionShape3D.new()
	shape.name = "Collision"
	shape.shape = mesh.create_trimesh_shape()
	body.add_child(shape)
	shape.owner = scene_root

	if center:
		body.position = Vector3(-float(size) / 2.0, 0.0, -float(size) / 2.0)

	parent.add_child(body)
	body.owner = scene_root

	var packed := PackedScene.new()
	var pack_err := packed.pack(scene_root)
	if pack_err != OK:
		return _err("Failed to pack scene", { "error": pack_err })

	var save_err := ResourceSaver.save(packed, scene_path)
	if save_err != OK:
		return _err("Failed to save scene", { "error": save_err, "scene_path": scene_path })

	var node_path := _node_path_str(scene_root, body)
	return _ok(
		"Terrain generated",
		{
			"scene_path": scene_path,
			"node_name": node_name,
			"node_path": node_path,
			"parent_node_path": parent_path,
			"size": size,
			"height_scale": height_scale,
			"seed": seed_value,
			"frequency": frequency,
			"octaves": octaves,
			"ensure_unique_name": ensure_unique,
			"center": center,
		}
	)


func save_scene(params: Dictionary) -> Dictionary:
	var scene_path_raw := _p_str(params, ["scenePath", "scene_path"], "")
	if scene_path_raw.is_empty():
		return _err("scenePath/scene_path is required")

	var scene_path := _to_res_path(scene_path_raw)
	var save_path := scene_path
	var new_path_raw := _p_str(params, ["newPath", "new_path"], "")
	if not new_path_raw.is_empty():
		save_path = _to_res_path(new_path_raw)

	var scene_res := load(scene_path)
	if scene_res == null:
		return _err("Failed to load scene", { "scene_path": scene_path })

	var dir_err := _ensure_dir_for_res_path(save_path)
	if dir_err != OK:
		return _err("Failed to create save directory", { "error": dir_err, "dir": save_path.get_base_dir() })

	var save_err := ResourceSaver.save(scene_res, save_path)
	if save_err != OK:
		return _err("Failed to save scene", { "error": save_err, "save_path": save_path })

	return _ok("Scene saved", { "scene_path": scene_path, "save_path": save_path, "absolute_path": ProjectSettings.globalize_path(save_path) })

func validate_scene(params: Dictionary) -> Dictionary:
	var scene_path_raw := _p_str(params, ["scenePath", "scene_path"], "")
	if scene_path_raw.is_empty():
		return _err("scenePath/scene_path is required")

	var scene_path := _to_res_path(scene_path_raw)
	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load PackedScene", { "scene_path": scene_path })

	var inst := (scene_res as PackedScene).instantiate()
	if inst == null:
		return _err("Failed to instantiate PackedScene", { "scene_path": scene_path })

	return _ok("Scene validated", { "scene_path": scene_path })


func set_node_properties(params: Dictionary) -> Dictionary:
	var scene_path_raw := _p_str(params, ["scenePath", "scene_path"], "")
	var node_path_raw := _p_str(params, ["nodePath", "node_path"], "")
	var props_v = params.get("props", params.get("properties", null))
	if scene_path_raw.is_empty() or node_path_raw.is_empty() or props_v == null:
		return _err("scenePath/scene_path, nodePath/node_path, props are required")
	if typeof(props_v) != TYPE_DICTIONARY:
		return _err("props must be an object/dictionary")

	var scene_path := _to_res_path(scene_path_raw)
	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var node := _find_node(scene_root, node_path_raw)
	if node == null:
		return _err("Node not found", { "node_path": node_path_raw })

	var props: Dictionary = props_v
	var keys: Array[String] = []
	for key in props.keys():
		keys.append(String(key))
		var prop_name := String(key)
		var expected := _prop_type(node, prop_name)
		node.set(prop_name, _json_to_variant_for_type(props[key], expected))

	var packed := PackedScene.new()
	var pack_err := packed.pack(scene_root)
	if pack_err != OK:
		return _err("Failed to pack scene", { "error": pack_err })

	var save_err := ResourceSaver.save(packed, scene_path)
	if save_err != OK:
		return _err("Failed to save scene", { "error": save_err, "scene_path": scene_path })

	return _ok("Node properties set", { "scene_path": scene_path, "node_path": node_path_raw, "properties": keys })

func rename_node(params: Dictionary) -> Dictionary:
	var scene_path_raw := _p_str(params, ["scenePath", "scene_path"], "")
	var node_path_raw := _p_str(params, ["nodePath", "node_path", "path"], "")
	var new_name_raw := _p_str(params, ["newName", "new_name"], "")
	if scene_path_raw.is_empty() or node_path_raw.is_empty() or new_name_raw.is_empty():
		return _err("scenePath/scene_path, nodePath/node_path, newName/new_name are required")

	var scene_path := _to_res_path(scene_path_raw)
	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var node := _find_node(scene_root, node_path_raw)
	if node == null:
		return _err("Node not found", { "node_path": node_path_raw })

	var ensure_unique := bool(_p(params, ["ensureUniqueName", "ensure_unique_name"], false))
	var desired := new_name_raw.strip_edges()
	if desired.is_empty():
		return _err("newName/new_name is required")

	var final_name := desired
	var parent := node.get_parent()
	if ensure_unique and parent != null:
		var existing = parent.get_node_or_null(desired)
		if existing != null and existing != node:
			var i := 2
			while true:
				var candidate := "%s_%d" % [desired, i]
				var e2 = parent.get_node_or_null(candidate)
				if e2 == null or e2 == node:
					final_name = candidate
					break
				i += 1

	(node as Node).name = final_name

	var packed := PackedScene.new()
	var pack_err := packed.pack(scene_root)
	if pack_err != OK:
		return _err("Failed to pack scene", { "error": pack_err })

	var save_err := ResourceSaver.save(packed, scene_path)
	if save_err != OK:
		return _err("Failed to save scene", { "error": save_err, "scene_path": scene_path })

	var resolved_path := _node_path_str(scene_root, node)
	return _ok(
		"Node renamed",
		{
			"scene_path": scene_path,
			"node_path": resolved_path,
			"old_node_path": node_path_raw,
			"name": final_name,
			"ensure_unique_name": ensure_unique,
		}
	)

func move_node(params: Dictionary) -> Dictionary:
	var scene_path_raw := _p_str(params, ["scenePath", "scene_path"], "")
	var node_path_raw := _p_str(params, ["nodePath", "node_path", "path"], "")
	if scene_path_raw.is_empty() or node_path_raw.is_empty():
		return _err("scenePath/scene_path and nodePath/node_path are required")

	var index_v = _p(params, ["index", "newIndex", "new_index"], null)
	if index_v == null:
		return _err("index is required")

	var scene_path := _to_res_path(scene_path_raw)
	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var node := _find_node(scene_root, node_path_raw)
	if node == null:
		return _err("Node not found", { "node_path": node_path_raw })

	var parent := node.get_parent()
	if parent == null:
		return _err("Cannot move scene root")

	var index := int(_num(index_v, -1.0))
	if index < 0:
		return _err("index must be a non-negative integer")

	var max_index := parent.get_child_count() - 1
	index = clamp(index, 0, max_index)
	parent.move_child(node, index)

	var packed := PackedScene.new()
	var pack_err := packed.pack(scene_root)
	if pack_err != OK:
		return _err("Failed to pack scene", { "error": pack_err })

	var save_err := ResourceSaver.save(packed, scene_path)
	if save_err != OK:
		return _err("Failed to save scene", { "error": save_err, "scene_path": scene_path })

	var resolved_path := _node_path_str(scene_root, node)
	return _ok(
		"Node moved",
		{
			"scene_path": scene_path,
			"node_path": resolved_path,
			"index": index,
		}
	)

func create_simple_animation(params: Dictionary) -> Dictionary:
	var scene_path_raw := _p_str(params, ["scenePath", "scene_path"], "")
	var player_path_raw := _p_str(params, ["playerPath", "player_path"], "")
	var animation_name := _p_str(params, ["animation", "animationName", "animation_name"], "")
	var node_path_raw := _p_str(params, ["nodePath", "node_path"], "")
	var property := _p_str(params, ["property"], "")
	var start_value = _p(params, ["startValue", "start_value"], null)
	var end_value = _p(params, ["endValue", "end_value"], null)
	var duration := _num(_p(params, ["duration"], 1.0), 1.0)
	var replace_existing := bool(_p(params, ["replaceExisting", "replace_existing"], true))

	if (
		scene_path_raw.is_empty()
		or player_path_raw.is_empty()
		or animation_name.is_empty()
		or node_path_raw.is_empty()
		or property.is_empty()
		or end_value == null
	):
		return _err("scenePath/scene_path, playerPath/player_path, animation, nodePath/node_path, property, endValue/end_value are required")
	if duration <= 0.0:
		return _err("duration must be > 0", { "duration": duration })

	var scene_path := _to_res_path(scene_path_raw)
	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var player_node := _find_node(scene_root, player_path_raw)
	if player_node == null or not (player_node is AnimationPlayer):
		return _err("playerPath is not an AnimationPlayer", { "player_path": player_path_raw })

	var target_node := _find_node(scene_root, node_path_raw)
	if target_node == null:
		return _err("Target node not found", { "node_path": node_path_raw })

	var expected := _prop_type(target_node, property)
	if expected == TYPE_NIL:
		return _err("Property not found", { "property": property, "node_path": node_path_raw })

	var current = target_node.get(property)
	if current == null and start_value == null:
		return _err("Property is null; provide startValue/start_value", { "property": property })

	var from_val = current if start_value == null else _json_to_variant_for_type(start_value, expected)
	var to_val = _json_to_variant_for_type(end_value, expected)

	var anim := Animation.new()
	anim.length = duration

	var rel_path: NodePath = (player_node as Node).get_path_to(target_node)
	var track := anim.add_track(Animation.TYPE_VALUE)
	anim.track_set_path(track, NodePath(str(rel_path) + ":" + property))
	anim.track_insert_key(track, 0.0, from_val)
	anim.track_insert_key(track, duration, to_val)

	var player := player_node as AnimationPlayer
	var lib = player.get_animation_library("")
	if lib == null:
		lib = AnimationLibrary.new()
		player.add_animation_library("", lib)

	if lib.has_animation(animation_name):
		if not replace_existing:
			return _err("Animation already exists", { "animation": animation_name })
		lib.remove_animation(animation_name)

	lib.add_animation(animation_name, anim)

	var packed := PackedScene.new()
	var pack_err := packed.pack(scene_root)
	if pack_err != OK:
		return _err("Failed to pack scene", { "error": pack_err })

	var save_err := ResourceSaver.save(packed, scene_path)
	if save_err != OK:
		return _err("Failed to save scene", { "error": save_err, "scene_path": scene_path })

	return _ok(
		"Animation created",
		{
			"scene_path": scene_path,
			"player_path": player_path_raw,
			"animation": animation_name,
			"node_path": node_path_raw,
			"property": property,
			"duration": duration,
			"replace_existing": replace_existing,
		}
	)

func connect_signal(params: Dictionary) -> Dictionary:
	var scene_path_raw := _p_str(params, ["scenePath", "scene_path"], "")
	var from_node_path := _p_str(params, ["fromNodePath", "from_node_path"], "")
	var to_node_path := _p_str(params, ["toNodePath", "to_node_path"], "")
	var signal_value := _p_str(params, ["signal"], "")
	var method_value := _p_str(params, ["method"], "")
	if scene_path_raw.is_empty() or from_node_path.is_empty() or to_node_path.is_empty() or signal_value.is_empty() or method_value.is_empty():
		return _err("scenePath/scene_path, fromNodePath/from_node_path, signal, toNodePath/to_node_path, method are required")

	var scene_path := _to_res_path(scene_path_raw)
	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var from_node := _find_node(scene_root, from_node_path)
	var to_node := _find_node(scene_root, to_node_path)
	if from_node == null:
		return _err("from_node not found", { "from_node_path": from_node_path })
	if to_node == null:
		return _err("to_node not found", { "to_node_path": to_node_path })

	var signal_name := StringName(signal_value)
	var method_name := StringName(method_value)
	var callable := Callable(to_node, method_name)

	if from_node.is_connected(signal_name, callable):
		return _ok("Signal already connected", { "scene_path": scene_path })

	var err := from_node.connect(signal_name, callable, Object.CONNECT_PERSIST)
	if err != OK:
		return _err("Failed to connect signal", { "error": err, "signal": signal_value })

	var packed := PackedScene.new()
	var pack_err := packed.pack(scene_root)
	if pack_err != OK:
		return _err("Failed to pack scene", { "error": pack_err })

	var save_err := ResourceSaver.save(packed, scene_path)
	if save_err != OK:
		return _err("Failed to save scene", { "error": save_err, "scene_path": scene_path })

	return _ok("Signal connected", { "scene_path": scene_path, "signal": signal_value })

func attach_script(params: Dictionary) -> Dictionary:
	var scene_path_raw := _p_str(params, ["scenePath", "scene_path"], "")
	var node_path_raw := _p_str(params, ["nodePath", "node_path"], "")
	var script_path_raw := _p_str(params, ["scriptPath", "script_path"], "")
	if scene_path_raw.is_empty() or node_path_raw.is_empty() or script_path_raw.is_empty():
		return _err("scenePath/scene_path, nodePath/node_path, scriptPath/script_path are required")

	var scene_path := _to_res_path(scene_path_raw)
	var script_path := _to_res_path(script_path_raw)

	var script_res := load(script_path)
	if script_res == null or not (script_res is Script):
		return _err("Failed to load script", { "script_path": script_path })

	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var node := _find_node(scene_root, node_path_raw)
	if node == null:
		return _err("Node not found", { "node_path": node_path_raw })

	node.set_script(script_res)

	var packed := PackedScene.new()
	var pack_err := packed.pack(scene_root)
	if pack_err != OK:
		return _err("Failed to pack scene", { "error": pack_err })

	var save_err := ResourceSaver.save(packed, scene_path)
	if save_err != OK:
		return _err("Failed to save scene", { "error": save_err, "scene_path": scene_path })

	return _ok("Script attached", { "scene_path": scene_path, "node_path": node_path_raw, "script_path": script_path })

func create_script(params: Dictionary) -> Dictionary:
	var script_path_raw := _p_str(params, ["scriptPath", "script_path"], "")
	if script_path_raw.is_empty():
		return _err("scriptPath/script_path is required")

	var script_path := _to_res_path(script_path_raw)
	var template := String(params.get("template", "minimal"))
	var extends_name := String(params.get("extends", "Node"))
	var global_class_name := String(params.get("class_name", ""))

	var lines: Array[String] = []
	if template == "tool":
		lines.append("@tool")
	lines.append("extends " + extends_name)
	lines.append("")
	if not global_class_name.is_empty():
		lines.append("class_name " + global_class_name)
		lines.append("")
	lines.append("func _ready() -> void:")
	lines.append("\tpass")
	lines.append("")

	var dir_err := _ensure_dir_for_res_path(script_path)
	if dir_err != OK:
		return _err("Failed to create script directory", { "error": dir_err, "dir": script_path.get_base_dir() })

	var f := FileAccess.open(script_path, FileAccess.WRITE)
	if f == null:
		return _err("Failed to open script for writing", { "error": FileAccess.get_open_error(), "script_path": script_path })
	f.store_string("\n".join(lines))
	f.close()

	return _ok("Script created", { "script_path": script_path, "absolute_path": ProjectSettings.globalize_path(script_path) })
