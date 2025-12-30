extends "ops_module_base.gd"

func get_operations() -> Dictionary:
	return {
		"create_scene": Callable(self, "create_scene"),
		"add_node": Callable(self, "add_node"),
		"create_node_bundle": Callable(self, "create_node_bundle"),
		"instance_scene": Callable(self, "instance_scene"),
		"create_tilemap": Callable(self, "create_tilemap"),
		"save_scene": Callable(self, "save_scene"),
		"validate_scene": Callable(self, "validate_scene"),
		"set_node_properties": Callable(self, "set_node_properties"),
		"connect_signal": Callable(self, "connect_signal"),
		"attach_script": Callable(self, "attach_script"),
		"create_script": Callable(self, "create_script"),
	}

func create_scene(params: Dictionary) -> Dictionary:
	if not params.has("scene_path"):
		return _err("scene_path is required")

	var scene_path := _to_res_path(String(params.scene_path))
	var root_node_type := "Node2D"
	if params.has("root_node_type"):
		root_node_type = String(params.root_node_type)

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
	for k in ["scene_path", "node_type", "node_name"]:
		if not params.has(k):
			return _err(k + " is required")

	var scene_path := _to_res_path(String(params.scene_path))
	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var parent_path := "root"
	if params.has("parent_node_path"):
		parent_path = String(params.parent_node_path)

	var parent := _find_node(scene_root, parent_path)
	if parent == null:
		return _err("Parent node not found", { "parent_node_path": parent_path })

	var node_type := String(params.node_type)
	var node_name := String(params.node_name)
	var ensure_unique := bool(params.get("ensure_unique_name", params.get("ensureUniqueName", false)))
	var new_node = _instantiate_class(node_type)
	if new_node == null or not (new_node is Node):
		return _err("Failed to instantiate node", { "node_type": node_type })

	if ensure_unique:
		node_name = _unique_child_name(parent, node_name)
	(new_node as Node).name = node_name

	if params.has("properties") and typeof(params.properties) == TYPE_DICTIONARY:
		var props: Dictionary = params.properties
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
	for k in ["scene_path", "node_type", "node_name"]:
		if not params.has(k):
			return _err(k + " is required")

	var scene_path := _to_res_path(String(params.scene_path))
	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var parent_path := "root"
	if params.has("parent_node_path"):
		parent_path = String(params.parent_node_path)

	var parent := _find_node(scene_root, parent_path)
	if parent == null:
		return _err("Parent node not found", { "parent_node_path": parent_path })

	var node_type := String(params.node_type)
	var node_name := String(params.node_name)
	var ensure_unique := bool(params.get("ensure_unique_name", params.get("ensureUniqueName", false)))
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
	if not params.has("scene_path"):
		return _err("scene_path is required")

	var source_scene_path_raw := ""
	if params.has("source_scene_path"):
		source_scene_path_raw = String(params.source_scene_path)
	elif params.has("instance_scene_path"):
		source_scene_path_raw = String(params.instance_scene_path)
	else:
		return _err("source_scene_path is required")

	var scene_path := _to_res_path(String(params.scene_path))
	var source_scene_path := _to_res_path(source_scene_path_raw)

	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var parent_path := "root"
	if params.has("parent_node_path"):
		parent_path = String(params.parent_node_path)

	var parent := _find_node(scene_root, parent_path)
	if parent == null:
		return _err("Parent node not found", { "parent_node_path": parent_path })

	var source_res := load(source_scene_path)
	if source_res == null or not (source_res is PackedScene):
		return _err("Failed to load source scene", { "source_scene_path": source_scene_path })

	var inst := (source_res as PackedScene).instantiate()
	if inst == null or not (inst is Node):
		return _err("Failed to instantiate source scene", { "source_scene_path": source_scene_path })

	var ensure_unique := bool(params.get("ensure_unique_name", params.get("ensureUniqueName", false)))
	if params.has("name"):
		var desired := String(params.name)
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
	for k in ["scene_path", "node_name"]:
		if not params.has(k):
			return _err(k + " is required")

	var scene_path := _to_res_path(String(params.scene_path))
	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var parent_path := "root"
	if params.has("parent_node_path"):
		parent_path = String(params.parent_node_path)

	var parent := _find_node(scene_root, parent_path)
	if parent == null:
		return _err("Parent node not found", { "parent_node_path": parent_path })

	var node_type := "TileMap"
	if params.has("node_type"):
		node_type = String(params.node_type)

	var node_name := String(params.node_name)
	var tilemap_node = _instantiate_class(node_type)
	if tilemap_node == null or not (tilemap_node is Node):
		return _err("Failed to instantiate TileMap", { "node_type": node_type })

	var ensure_unique := bool(params.get("ensure_unique_name", params.get("ensureUniqueName", false)))
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


func save_scene(params: Dictionary) -> Dictionary:
	if not params.has("scene_path"):
		return _err("scene_path is required")

	var scene_path := _to_res_path(String(params.scene_path))
	var save_path := scene_path
	if params.has("new_path"):
		save_path = _to_res_path(String(params.new_path))

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
	if not params.has("scene_path"):
		return _err("scene_path is required")

	var scene_path := _to_res_path(String(params.scene_path))
	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load PackedScene", { "scene_path": scene_path })

	var inst := (scene_res as PackedScene).instantiate()
	if inst == null:
		return _err("Failed to instantiate PackedScene", { "scene_path": scene_path })

	return _ok("Scene validated", { "scene_path": scene_path })


func set_node_properties(params: Dictionary) -> Dictionary:
	for k in ["scene_path", "node_path", "props"]:
		if not params.has(k):
			return _err(k + " is required")

	if typeof(params.props) != TYPE_DICTIONARY:
		return _err("props must be an object/dictionary")

	var scene_path := _to_res_path(String(params.scene_path))
	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var node := _find_node(scene_root, String(params.node_path))
	if node == null:
		return _err("Node not found", { "node_path": params.node_path })

	var props: Dictionary = params.props
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

	return _ok("Node properties set", { "scene_path": scene_path, "node_path": params.node_path, "properties": keys })

func connect_signal(params: Dictionary) -> Dictionary:
	for k in ["scene_path", "from_node_path", "signal", "to_node_path", "method"]:
		if not params.has(k):
			return _err(k + " is required")

	var scene_path := _to_res_path(String(params.scene_path))
	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var from_node := _find_node(scene_root, String(params.from_node_path))
	var to_node := _find_node(scene_root, String(params.to_node_path))
	if from_node == null:
		return _err("from_node not found", { "from_node_path": params.from_node_path })
	if to_node == null:
		return _err("to_node not found", { "to_node_path": params.to_node_path })

	var signal_name := StringName(String(params.signal))
	var method_name := StringName(String(params.method))
	var callable := Callable(to_node, method_name)

	if from_node.is_connected(signal_name, callable):
		return _ok("Signal already connected", { "scene_path": scene_path })

	var err := from_node.connect(signal_name, callable, Object.CONNECT_PERSIST)
	if err != OK:
		return _err("Failed to connect signal", { "error": err, "signal": String(params.signal) })

	var packed := PackedScene.new()
	var pack_err := packed.pack(scene_root)
	if pack_err != OK:
		return _err("Failed to pack scene", { "error": pack_err })

	var save_err := ResourceSaver.save(packed, scene_path)
	if save_err != OK:
		return _err("Failed to save scene", { "error": save_err, "scene_path": scene_path })

	return _ok("Signal connected", { "scene_path": scene_path, "signal": String(params.signal) })

func attach_script(params: Dictionary) -> Dictionary:
	for k in ["scene_path", "node_path", "script_path"]:
		if not params.has(k):
			return _err(k + " is required")

	var scene_path := _to_res_path(String(params.scene_path))
	var script_path := _to_res_path(String(params.script_path))

	var script_res := load(script_path)
	if script_res == null or not (script_res is Script):
		return _err("Failed to load script", { "script_path": script_path })

	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var node := _find_node(scene_root, String(params.node_path))
	if node == null:
		return _err("Node not found", { "node_path": params.node_path })

	node.set_script(script_res)

	var packed := PackedScene.new()
	var pack_err := packed.pack(scene_root)
	if pack_err != OK:
		return _err("Failed to pack scene", { "error": pack_err })

	var save_err := ResourceSaver.save(packed, scene_path)
	if save_err != OK:
		return _err("Failed to save scene", { "error": save_err, "scene_path": scene_path })

	return _ok("Script attached", { "scene_path": scene_path, "node_path": params.node_path, "script_path": script_path })

func create_script(params: Dictionary) -> Dictionary:
	if not params.has("script_path"):
		return _err("script_path is required")

	var script_path := _to_res_path(String(params.script_path))
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
