#!/usr/bin/env -S godot --headless --script
extends SceneTree

const JSON_TYPE_KEY := "$type"

var debug_mode := false
var _logs: Array[String] = []

func _init():
	var args := OS.get_cmdline_args()
	debug_mode = "--debug-godot" in args

	var script_index := args.find("--script")
	if script_index == -1:
		_emit_and_quit(_err("Missing --script argument", { "args": args }), 1)

	var operation_index := script_index + 2
	var params_index := script_index + 3
	if args.size() <= params_index:
		_emit_and_quit(_err("Usage: godot --headless --script godot_operations.gd <operation> <json_params>", {}), 1)

	var operation := str(args[operation_index])
	var params_json := str(args[params_index])

	var json := JSON.new()
	var parse_err := json.parse(params_json)
	if parse_err != OK:
		_emit_and_quit(
			_err(
				"Failed to parse JSON params",
				{
					"error": json.get_error_message(),
					"line": json.get_error_line(),
					"params_json": params_json,
				}
			),
			1
		)

	var params = json.get_data()
	if typeof(params) != TYPE_DICTIONARY:
		_emit_and_quit(_err("Params must be a JSON object", { "params_json": params_json }), 1)

	var result: Dictionary = _dispatch(operation, params)
	var exit_code := 0 if bool(result.get("ok", false)) else 1
	_emit_and_quit(result, exit_code)

func _dispatch(operation: String, params: Dictionary) -> Dictionary:
	match operation:
		"batch":
			return batch(params)
		"get_godot_version":
			return get_godot_version(params)
		"create_scene":
			return create_scene(params)
		"add_node":
			return add_node(params)
		"load_sprite":
			return load_sprite(params)
		"export_mesh_library":
			return export_mesh_library(params)
		"save_scene":
			return save_scene(params)
		"get_uid":
			return get_uid(params)
		"resave_resources":
			return resave_resources(params)
		"set_node_properties":
			return set_node_properties(params)
		"connect_signal":
			return connect_signal(params)
		"attach_script":
			return attach_script(params)
		"create_script":
			return create_script(params)
		"read_text_file":
			return read_text_file(params)
		"write_text_file":
			return write_text_file(params)
		"create_resource":
			return create_resource(params)
		"validate_scene":
			return validate_scene(params)
		_:
			return _err("Unknown operation", { "operation": operation })

func _emit_and_quit(result: Dictionary, exit_code: int) -> void:
	if not result.has("logs"):
		result["logs"] = _logs
	print(JSON.stringify(result))
	quit(exit_code)

func _log_debug(message: String) -> void:
	if debug_mode:
		_logs.append("[DEBUG] " + message)

func _log_info(message: String) -> void:
	_logs.append("[INFO] " + message)

func _log_error(message: String) -> void:
	_logs.append("[ERROR] " + message)

func _ok(summary: String, details: Dictionary = {}) -> Dictionary:
	return { "ok": true, "summary": summary, "details": details }

func _err(summary: String, details: Dictionary = {}) -> Dictionary:
	return { "ok": false, "summary": summary, "details": details }

func _to_res_path(p: String) -> String:
	return p if p.begins_with("res://") else "res://" + p

func _num(v, fallback: float = 0.0) -> float:
	match typeof(v):
		TYPE_INT:
			return float(v)
		TYPE_FLOAT:
			return float(v)
		TYPE_STRING:
			var s := String(v).strip_edges()
			if s.is_valid_float():
				return float(s)
			if s.is_valid_int():
				return float(int(s))
	return fallback

func _intlike(v: float) -> bool:
	return abs(v - round(v)) <= 0.000001

func _json_to_variant(value):
	match typeof(value):
		TYPE_ARRAY:
			var out: Array = []
			for v in value:
				out.append(_json_to_variant(v))
			return out
		TYPE_DICTIONARY:
			var d: Dictionary = value
			if d.has(JSON_TYPE_KEY) and typeof(d.get(JSON_TYPE_KEY)) == TYPE_STRING:
				var t := String(d.get(JSON_TYPE_KEY)).strip_edges()
				match t:
					"Vector2":
						return Vector2(_num(d.get("x")), _num(d.get("y")))
					"Vector2i":
						return Vector2i(int(_num(d.get("x"))), int(_num(d.get("y"))))
					"Vector3":
						return Vector3(_num(d.get("x")), _num(d.get("y")), _num(d.get("z")))
					"Vector3i":
						return Vector3i(int(_num(d.get("x"))), int(_num(d.get("y"))), int(_num(d.get("z"))))
					"Vector4":
						return Vector4(_num(d.get("x")), _num(d.get("y")), _num(d.get("z")), _num(d.get("w")))
					"Color":
						return Color(_num(d.get("r")), _num(d.get("g")), _num(d.get("b")), _num(d.get("a"), 1.0))
					"Rect2":
						return Rect2(_num(d.get("x")), _num(d.get("y")), _num(d.get("w")), _num(d.get("h")))
					"Rect2i":
						return Rect2i(int(_num(d.get("x"))), int(_num(d.get("y"))), int(_num(d.get("w"))), int(_num(d.get("h"))))
					"Transform2D":
						var x_v = _json_to_variant(d.get("x", {}))
						var y_v = _json_to_variant(d.get("y", {}))
						var o_v = _json_to_variant(d.get("origin", {}))
						if typeof(x_v) == TYPE_VECTOR2 and typeof(y_v) == TYPE_VECTOR2 and typeof(o_v) == TYPE_VECTOR2:
							return Transform2D(x_v, y_v, o_v)
					"Transform3D":
						var basis_v = d.get("basis", {})
						var origin_v = _json_to_variant(d.get("origin", {}))
						if typeof(basis_v) == TYPE_DICTIONARY and typeof(origin_v) == TYPE_VECTOR3:
							var b: Dictionary = basis_v
							var bx_v = _json_to_variant(b.get("x", {}))
							var by_v = _json_to_variant(b.get("y", {}))
							var bz_v = _json_to_variant(b.get("z", {}))
							if typeof(bx_v) == TYPE_VECTOR3 and typeof(by_v) == TYPE_VECTOR3 and typeof(bz_v) == TYPE_VECTOR3:
								var basis := Basis(bx_v, by_v, bz_v)
								return Transform3D(basis, origin_v)

			var out_d: Dictionary = {}
			for k in d.keys():
				out_d[String(k)] = _json_to_variant(d[k])
			return out_d
		_:
			return value

func _prop_type(obj: Object, prop: String) -> int:
	if obj == null:
		return TYPE_NIL
	var plist = obj.get_property_list()
	for p in plist:
		if typeof(p) != TYPE_DICTIONARY:
			continue
		var d: Dictionary = p
		if String(d.get("name", "")) == prop:
			if d.has("type"):
				return int(d.get("type"))
	return TYPE_NIL

func _json_to_variant_for_type(value, expected_type: int):
	if expected_type == TYPE_INT:
		if typeof(value) == TYPE_INT:
			return int(value)
		if typeof(value) == TYPE_FLOAT:
			var f := float(value)
			if _intlike(f):
				return int(round(f))
		if typeof(value) == TYPE_STRING:
			var s := String(value).strip_edges()
			if s.is_valid_int():
				return int(s)
		return value

	if expected_type == TYPE_FLOAT:
		return _num(value)

	if expected_type == TYPE_VECTOR2:
		if typeof(value) == TYPE_ARRAY and (value as Array).size() >= 2:
			var a: Array = value
			return Vector2(_num(a[0]), _num(a[1]))
		if typeof(value) == TYPE_DICTIONARY:
			var d: Dictionary = value
			if d.has("x") and d.has("y"):
				return Vector2(_num(d.get("x")), _num(d.get("y")))
		return _json_to_variant(value)

	if expected_type == TYPE_VECTOR2I:
		if typeof(value) == TYPE_ARRAY and (value as Array).size() >= 2:
			var a2: Array = value
			return Vector2i(int(_num(a2[0])), int(_num(a2[1])))
		if typeof(value) == TYPE_DICTIONARY:
			var d2: Dictionary = value
			if d2.has("x") and d2.has("y"):
				return Vector2i(int(_num(d2.get("x"))), int(_num(d2.get("y"))))
		return _json_to_variant(value)

	if expected_type == TYPE_VECTOR3:
		if typeof(value) == TYPE_ARRAY and (value as Array).size() >= 3:
			var a3: Array = value
			return Vector3(_num(a3[0]), _num(a3[1]), _num(a3[2]))
		if typeof(value) == TYPE_DICTIONARY:
			var d3: Dictionary = value
			if d3.has("x") and d3.has("y") and d3.has("z"):
				return Vector3(_num(d3.get("x")), _num(d3.get("y")), _num(d3.get("z")))
		return _json_to_variant(value)

	if expected_type == TYPE_VECTOR3I:
		if typeof(value) == TYPE_ARRAY and (value as Array).size() >= 3:
			var a3i: Array = value
			return Vector3i(int(_num(a3i[0])), int(_num(a3i[1])), int(_num(a3i[2])))
		if typeof(value) == TYPE_DICTIONARY:
			var d3i: Dictionary = value
			if d3i.has("x") and d3i.has("y") and d3i.has("z"):
				return Vector3i(int(_num(d3i.get("x"))), int(_num(d3i.get("y"))), int(_num(d3i.get("z"))))
		return _json_to_variant(value)

	if expected_type == TYPE_VECTOR4:
		if typeof(value) == TYPE_ARRAY and (value as Array).size() >= 4:
			var a4: Array = value
			return Vector4(_num(a4[0]), _num(a4[1]), _num(a4[2]), _num(a4[3]))
		if typeof(value) == TYPE_DICTIONARY:
			var d4: Dictionary = value
			if d4.has("x") and d4.has("y") and d4.has("z") and d4.has("w"):
				return Vector4(_num(d4.get("x")), _num(d4.get("y")), _num(d4.get("z")), _num(d4.get("w")))
		return _json_to_variant(value)

	if expected_type == TYPE_COLOR:
		if typeof(value) == TYPE_ARRAY:
			var ac: Array = value
			if ac.size() >= 3:
				return Color(_num(ac[0]), _num(ac[1]), _num(ac[2]), _num(ac[3], 1.0))
		if typeof(value) == TYPE_DICTIONARY:
			var dc: Dictionary = value
			if dc.has("r") and dc.has("g") and dc.has("b"):
				return Color(_num(dc.get("r")), _num(dc.get("g")), _num(dc.get("b")), _num(dc.get("a"), 1.0))
		return _json_to_variant(value)

	if expected_type == TYPE_RECT2:
		if typeof(value) == TYPE_ARRAY:
			var ar: Array = value
			if ar.size() >= 4:
				return Rect2(_num(ar[0]), _num(ar[1]), _num(ar[2]), _num(ar[3]))
		if typeof(value) == TYPE_DICTIONARY:
			var dr: Dictionary = value
			if dr.has("x") and dr.has("y") and dr.has("w") and dr.has("h"):
				return Rect2(_num(dr.get("x")), _num(dr.get("y")), _num(dr.get("w")), _num(dr.get("h")))
		return _json_to_variant(value)

	if expected_type == TYPE_RECT2I:
		if typeof(value) == TYPE_ARRAY:
			var ari: Array = value
			if ari.size() >= 4:
				return Rect2i(int(_num(ari[0])), int(_num(ari[1])), int(_num(ari[2])), int(_num(ari[3])))
		if typeof(value) == TYPE_DICTIONARY:
			var dri: Dictionary = value
			if dri.has("x") and dri.has("y") and dri.has("w") and dri.has("h"):
				return Rect2i(int(_num(dri.get("x"))), int(_num(dri.get("y"))), int(_num(dri.get("w"))), int(_num(dri.get("h"))))
		return _json_to_variant(value)

	return _json_to_variant(value)

func _uid_text_from_value(value: Variant) -> String:
	if typeof(value) == TYPE_STRING:
		return String(value)
	if typeof(value) == TYPE_INT:
		return ResourceUID.id_to_text(int(value))
	return ""

func _ensure_dir_for_res_path(res_path: String) -> int:
	var dir_path := _to_res_path(res_path).get_base_dir()
	if dir_path == "res://" or dir_path == "res:":
		return OK

	var dir := DirAccess.open("res://")
	if dir == null:
		return DirAccess.get_open_error()

	var rel := dir_path.substr(6) # strip "res://"
	return dir.make_dir_recursive(rel)

func _get_script_by_name(name_of_class: String) -> Script:
	if name_of_class.is_empty():
		return null

	# If it's already a resource path, load directly.
	if ResourceLoader.exists(name_of_class, "Script"):
		var s := load(name_of_class) as Script
		return s

	# Otherwise search global class registry.
	var global_classes := ProjectSettings.get_global_class_list()
	for global_class in global_classes:
		if typeof(global_class) != TYPE_DICTIONARY:
			continue
		if String(global_class.get("class", "")) != name_of_class:
			continue
		var found_path := String(global_class.get("path", ""))
		if found_path.is_empty():
			continue
		var s := load(found_path) as Script
		return s

	return null

func _instantiate_class(name_of_class: String) -> Variant:
	if name_of_class.is_empty():
		return null

	if ClassDB.class_exists(name_of_class) and ClassDB.can_instantiate(name_of_class):
		return ClassDB.instantiate(name_of_class)

	var script := _get_script_by_name(name_of_class)
	if script is GDScript:
		return (script as GDScript).new()

	return null

func _find_node(scene_root: Node, node_path: String) -> Node:
	var p := node_path.strip_edges()
	if p.is_empty() or p == "root" or p == "/root":
		return scene_root

	if p.begins_with("root/"):
		p = p.substr(5)
	elif p.begins_with("/root/"):
		p = p.substr(6)

	return scene_root.get_node_or_null(p)

# -----------------------------------------------------------------------------
# Operations (headless)

func batch(params: Dictionary) -> Dictionary:
	if not params.has("steps") or typeof(params.steps) != TYPE_ARRAY:
		return _err("steps is required", { "received_type": typeof(params.get("steps")) })

	var stop_on_error := bool(params.get("stop_on_error", true))
	var steps: Array = params.steps
	var results: Array = []
	var failed_index := -1

	for i in range(steps.size()):
		var raw_step = steps[i]
		if typeof(raw_step) != TYPE_DICTIONARY:
			return _err("Each step must be an object", { "index": i })

		var step: Dictionary = raw_step
		var op := String(step.get("operation", "")).strip_edges()
		if op.is_empty():
			return _err("operation is required", { "index": i })

		var step_params: Dictionary = {}
		if step.has("params"):
			if typeof(step.params) == TYPE_DICTIONARY:
				step_params = step.params
			elif typeof(step.params) == TYPE_STRING:
				var json := JSON.new()
				var parse_err := json.parse(String(step.params))
				if parse_err != OK or typeof(json.get_data()) != TYPE_DICTIONARY:
					return _err("Failed to parse step params", { "index": i, "operation": op })
				step_params = json.get_data()
			else:
				return _err("params must be an object or JSON string", { "index": i, "operation": op })

		var res: Dictionary = _dispatch(op, step_params)
		results.append(res)

		if not bool(res.get("ok", false)):
			failed_index = i
			if stop_on_error:
				break

	if failed_index == -1:
		return _ok("Batch completed", { "results": results })

	return _err(
		"Batch failed at step " + str(failed_index),
		{ "results": results, "failed_index": failed_index }
	)

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
	var new_node = _instantiate_class(node_type)
	if new_node == null or not (new_node is Node):
		return _err("Failed to instantiate node", { "node_type": node_type })

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

	return _ok("Node added", { "scene_path": scene_path, "node_name": node_name, "node_type": node_type })

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

func get_godot_version(params: Dictionary) -> Dictionary:
	var info := Engine.get_version_info()
	var ver := ""
	if typeof(info) == TYPE_DICTIONARY and info.has("string"):
		ver = String(info.get("string"))
	if ver.is_empty():
		ver = "%d.%d" % [int(info.get("major", 0)), int(info.get("minor", 0))]
	return _ok("Godot version", { "version": ver, "version_info": info })

func load_sprite(params: Dictionary) -> Dictionary:
	for k in ["scene_path", "node_path", "texture_path"]:
		if not params.has(k):
			return _err(k + " is required")

	var scene_path := _to_res_path(String(params.scene_path))
	var texture_path := _to_res_path(String(params.texture_path))

	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var node := _find_node(scene_root, String(params.node_path))
	if node == null:
		return _err("Node not found", { "node_path": params.node_path })

	var texture: Texture2D = null
	var loader_path := "imported_load"
	var svg_loader_available := false
	var loaded := load(texture_path)
	if loaded != null and loaded is Texture2D:
		texture = loaded
	else:
		var image := Image.new()
		var err := OK
		var lower_path := texture_path.to_lower()
		if lower_path.ends_with(".svg"):
			var f := FileAccess.open(texture_path, FileAccess.READ)
			if f == null:
				return _err("Failed to open texture file", { "texture_path": texture_path, "error": FileAccess.get_open_error() })
			var svg_text := f.get_as_text()
			f.close()
			svg_loader_available = image.has_method("load_svg_from_string") or image.has_method("load_svg_from_buffer")
			if image.has_method("load_svg_from_string"):
				loader_path = "svg_from_string"
				err = image.load_svg_from_string(svg_text)
			elif image.has_method("load_svg_from_buffer"):
				loader_path = "svg_from_buffer"
				err = image.load_svg_from_buffer(svg_text.to_utf8_buffer())
			else:
				loader_path = "svg_unavailable"
				err = ERR_UNAVAILABLE
		else:
			loader_path = "image_load"
			err = image.load(texture_path)
		if err == OK:
			texture = ImageTexture.create_from_image(image)
		else:
			if lower_path.ends_with(".svg"):
				return _err(
					"Failed to load texture",
					{
						"texture_path": texture_path,
						"error": err,
						"loader_path": loader_path,
						"svg_loader_available": svg_loader_available,
						"suggestions": [
							"Prefer PNG textures for headless flows.",
							"If you must use SVG, run an import step first or open the project once in the editor to trigger imports.",
						],
					}
				)
			return _err("Failed to load texture", { "texture_path": texture_path, "error": err, "loader_path": loader_path })
	if texture == null:
		return _err("Failed to load texture", { "texture_path": texture_path, "loader_path": loader_path })

	if node is Sprite2D or node is Sprite3D or node is TextureRect:
		node.texture = texture
	else:
		return _err("Node is not sprite-compatible", { "node_class": node.get_class() })

	var packed := PackedScene.new()
	var pack_err := packed.pack(scene_root)
	if pack_err != OK:
		return _err("Failed to pack scene", { "error": pack_err })

	var save_err := ResourceSaver.save(packed, scene_path)
	if save_err != OK:
		return _err("Failed to save scene", { "error": save_err, "scene_path": scene_path })

	return _ok("Sprite loaded", { "scene_path": scene_path, "node_path": params.node_path, "texture_path": texture_path })

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

func read_text_file(params: Dictionary) -> Dictionary:
	if not params.has("path"):
		return _err("path is required")

	var file_path := _to_res_path(String(params.path))
	var f := FileAccess.open(file_path, FileAccess.READ)
	if f == null:
		return _err("Failed to open file for reading", { "error": FileAccess.get_open_error(), "path": file_path })
	var content := f.get_as_text()
	f.close()

	return _ok("File read", { "path": file_path, "content": content })

func write_text_file(params: Dictionary) -> Dictionary:
	for k in ["path", "content"]:
		if not params.has(k):
			return _err(k + " is required")

	var file_path := _to_res_path(String(params.path))
	var content := String(params.content)

	var dir_err := _ensure_dir_for_res_path(file_path)
	if dir_err != OK:
		return _err("Failed to create directory", { "error": dir_err, "dir": file_path.get_base_dir() })

	var f := FileAccess.open(file_path, FileAccess.WRITE)
	if f == null:
		return _err("Failed to open file for writing", { "error": FileAccess.get_open_error(), "path": file_path })
	f.store_string(content)
	f.close()

	return _ok("File written", { "path": file_path, "bytes": content.to_utf8_buffer().size() })

func create_resource(params: Dictionary) -> Dictionary:
	for k in ["resource_path", "type"]:
		if not params.has(k):
			return _err(k + " is required")

	var resource_path := _to_res_path(String(params.resource_path))
	var type_name := String(params.type)

	var res = _instantiate_class(type_name)
	if res == null or not (res is Resource):
		return _err("Failed to instantiate Resource", { "type": type_name })

	if params.has("props") and typeof(params.props) == TYPE_DICTIONARY:
		var props: Dictionary = params.props
		for key in props.keys():
			var prop_name := String(key)
			var expected := _prop_type(res as Resource, prop_name)
			(res as Resource).set(prop_name, _json_to_variant_for_type(props[key], expected))

	var dir_err := _ensure_dir_for_res_path(resource_path)
	if dir_err != OK:
		return _err("Failed to create resource directory", { "error": dir_err, "dir": resource_path.get_base_dir() })

	var save_err := ResourceSaver.save(res, resource_path)
	if save_err != OK:
		return _err("Failed to save resource", { "error": save_err, "resource_path": resource_path })

	return _ok("Resource created", { "resource_path": resource_path, "type": type_name, "absolute_path": ProjectSettings.globalize_path(resource_path) })

func export_mesh_library(params: Dictionary) -> Dictionary:
	for k in ["scene_path", "output_path"]:
		if not params.has(k):
			return _err(k + " is required")

	var scene_path := _to_res_path(String(params.scene_path))
	var output_path := _to_res_path(String(params.output_path))

	var scene_res := load(scene_path)
	if scene_res == null or not (scene_res is PackedScene):
		return _err("Failed to load scene", { "scene_path": scene_path })

	var scene_root := (scene_res as PackedScene).instantiate()
	if scene_root == null:
		return _err("Failed to instantiate scene", { "scene_path": scene_path })

	var mesh_item_names: Array = []
	if params.has("mesh_item_names") and typeof(params.mesh_item_names) == TYPE_ARRAY:
		mesh_item_names = params.mesh_item_names
	var use_specific := mesh_item_names.size() > 0

	var mesh_library := MeshLibrary.new()
	var item_id := 0

	for child in scene_root.get_children():
		if use_specific and not mesh_item_names.has(child.name):
			continue

		var mesh_instance: MeshInstance3D = null
		if child is MeshInstance3D:
			mesh_instance = child
		else:
			for descendant in child.get_children():
				if descendant is MeshInstance3D:
					mesh_instance = descendant
					break

		if mesh_instance == null or mesh_instance.mesh == null:
			continue

		mesh_library.create_item(item_id)
		mesh_library.set_item_name(item_id, child.name)
		mesh_library.set_item_mesh(item_id, mesh_instance.mesh)

		var shapes: Array = []
		for collision_child in child.get_children():
			if collision_child is CollisionShape3D and collision_child.shape:
				shapes.append(collision_child.shape)
		if shapes.size() > 0:
			mesh_library.set_item_shapes(item_id, shapes)

		item_id += 1

	if item_id == 0:
		return _err("No valid meshes found in scene", { "scene_path": scene_path })

	var dir_err := _ensure_dir_for_res_path(output_path)
	if dir_err != OK:
		return _err("Failed to create output directory", { "error": dir_err, "dir": output_path.get_base_dir() })

	var save_err := ResourceSaver.save(mesh_library, output_path)
	if save_err != OK:
		return _err("Failed to save MeshLibrary", { "error": save_err, "output_path": output_path })

	return _ok("MeshLibrary exported", { "output_path": output_path, "items": item_id, "absolute_path": ProjectSettings.globalize_path(output_path) })

func get_uid(params: Dictionary) -> Dictionary:
	if not params.has("file_path"):
		return _err("file_path is required")

	var file_path := _to_res_path(String(params.file_path))
	if not FileAccess.file_exists(file_path):
		return _err("File does not exist", { "file_path": file_path })

	var uid_path := file_path + ".uid"
	if not FileAccess.file_exists(uid_path):
		if ClassDB.class_exists("ResourceUID"):
			var uid_text := _uid_text_from_value(ResourceUID.path_to_uid(file_path))
			if uid_text.is_empty():
				uid_text = _uid_text_from_value(ResourceUID.create_id_for_path(file_path))
			if uid_text.is_empty():
				uid_text = _uid_text_from_value(ResourceUID.create_id())
			if not uid_text.is_empty():
				var fgen := FileAccess.open(uid_path, FileAccess.WRITE)
				if fgen != null:
					fgen.store_string(uid_text)
					fgen.close()
				return _ok("UID read", { "file_path": file_path, "uid": uid_text, "generated": true })
		return _err("UID file does not exist", { "file_path": file_path, "uid_path": uid_path })

	var f := FileAccess.open(uid_path, FileAccess.READ)
	if f == null:
		return _err("Failed to open UID file", { "error": FileAccess.get_open_error(), "uid_path": uid_path })

	var uid_content := f.get_as_text().strip_edges()
	f.close()

	return _ok("UID read", { "file_path": file_path, "uid": uid_content })

func _find_files(base_path: String, extension: String) -> Array[String]:
	var files: Array[String] = []
	var dir := DirAccess.open(base_path)
	if dir == null:
		return files

	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if dir.current_is_dir():
			if not name.begins_with("."):
				files.append_array(_find_files(base_path + name + "/", extension))
		else:
			if name.ends_with(extension):
				files.append(base_path + name)
		name = dir.get_next()
	dir.list_dir_end()

	return files

func resave_resources(params: Dictionary) -> Dictionary:
	var base := "res://"
	if params.has("project_path"):
		var p := String(params.project_path)
		if p.begins_with("res://"):
			base = p
	if not base.ends_with("/"):
		base += "/"

	var scenes := _find_files(base, ".tscn")
	var resources: Array[String] = []
	resources.append_array(_find_files(base, ".tres"))
	resources.append_array(_find_files(base, ".res"))
	resources.append_array(_find_files(base, ".gd"))
	resources.append_array(_find_files(base, ".gdshader"))

	var scenes_saved := 0
	var scenes_errors := 0
	for s in scenes:
		var r := load(s)
		if r == null:
			scenes_errors += 1
			continue
		var err := ResourceSaver.save(r, s)
		if err == OK:
			scenes_saved += 1
		else:
			scenes_errors += 1

	var uid_missing := 0
	var uid_generated := 0
	var uid_errors := 0

	for rp in resources:
		var uid_path := rp + ".uid"
		if FileAccess.file_exists(uid_path):
			continue
		uid_missing += 1
		var r := load(rp)
		if r == null:
			uid_errors += 1
			continue
		var err := ResourceSaver.save(r, rp)
		if err == OK and FileAccess.file_exists(uid_path):
			uid_generated += 1
		elif err == OK:
			var created := false
			if ClassDB.class_exists("ResourceUID"):
				var uid_text := _uid_text_from_value(ResourceUID.path_to_uid(rp))
				if uid_text.is_empty():
					uid_text = _uid_text_from_value(ResourceUID.create_id_for_path(rp))
				if uid_text.is_empty():
					uid_text = _uid_text_from_value(ResourceUID.create_id())
				if not uid_text.is_empty():
					var f := FileAccess.open(uid_path, FileAccess.WRITE)
					if f != null:
						f.store_string(uid_text)
						f.close()
						created = true
			if created:
				uid_generated += 1
			else:
				uid_errors += 1
		else:
			uid_errors += 1

	var ok := (scenes_errors == 0 and uid_errors == 0)
	return {
		"ok": ok,
		"summary": "Resave complete",
		"details": {
			"base": base,
			"scenes_found": scenes.size(),
			"scenes_saved": scenes_saved,
			"scenes_errors": scenes_errors,
			"uid_missing": uid_missing,
			"uid_generated": uid_generated,
			"uid_errors": uid_errors,
		},
	}
