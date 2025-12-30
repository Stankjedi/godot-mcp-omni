#!/usr/bin/env -S godot --headless --script
extends SceneTree

const JSON_TYPE_KEY := "$type"
const JSON_RESOURCE_KEY := "$resource"

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


var _op_modules: Array = []
var _op_registry: Dictionary = {}
var _op_registry_loaded := false

func _ensure_op_registry() -> void:
	if _op_registry_loaded:
		return
	_op_registry_loaded = true
	_op_registry.clear()
	_op_modules.clear()

	var base_dir := String(get_script().resource_path).get_base_dir()
	var module_paths := [
		base_dir + "/godot_ops/batch_ops.gd",
		base_dir + "/godot_ops/doctor_ops.gd",
		base_dir + "/godot_ops/scene_ops.gd",
		base_dir + "/godot_ops/file_ops.gd",
		base_dir + "/godot_ops/resource_ops.gd",
		base_dir + "/godot_ops/pixel_tileset_ops.gd",
		base_dir + "/godot_ops/pixel_world_ops.gd",
		base_dir + "/godot_ops/pixel_object_ops.gd",
		base_dir + "/godot_ops/pixel_sprite_ops.gd",
	]

	for p in module_paths:
		var script := load(p)
		if script == null:
			_log_error("Failed to load ops module: " + p)
			continue
		var inst = (script as GDScript).new(self)
		if inst == null:
			_log_error("Failed to instantiate ops module: " + p)
			continue
		_op_modules.append(inst)
		if not inst.has_method("get_operations"):
			_log_error("Ops module missing get_operations(): " + p)
			continue
		var ops: Dictionary = inst.get_operations()
		for k in ops.keys():
			var key := String(k)
			if _op_registry.has(key):
				_log_error("Duplicate operation registered: " + key)
				continue
			_op_registry[key] = ops[k]

func _dispatch(operation: String, params: Dictionary) -> Dictionary:
	_ensure_op_registry()
	var fn = _op_registry.get(operation)
	if fn == null:
		return _err("Unknown operation", { "operation": operation })
	var result = (fn as Callable).call(params)
	if typeof(result) == TYPE_DICTIONARY:
		return result
	return _err("Operation returned non-dictionary", { "operation": operation, "result_type": typeof(result) })

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

func _looks_like_res_path(value: String) -> bool:
	if value.begins_with("res://"):
		return true
	if value.find("/") != -1:
		return true
	if value.ends_with(".tres") or value.ends_with(".res") or value.ends_with(".tscn"):
		return true
	return false

func _resource_from_json(d: Dictionary) -> Resource:
	if not d.has(JSON_RESOURCE_KEY):
		return null

	var resource_id := String(d.get(JSON_RESOURCE_KEY, "")).strip_edges()
	if resource_id.is_empty():
		return null

	var res: Resource = null
	var created := false
	var path_override := ""
	if d.has("path"):
		path_override = String(d.get("path", "")).strip_edges()
	elif d.has("resource_path"):
		path_override = String(d.get("resource_path", "")).strip_edges()

	if not path_override.is_empty():
		var res_path := _to_res_path(path_override)
		if ResourceLoader.exists(res_path):
			res = load(res_path)
	elif _looks_like_res_path(resource_id):
		var res_path_id := _to_res_path(resource_id)
		if ResourceLoader.exists(res_path_id):
			res = load(res_path_id)

	if res == null and ClassDB.class_exists(resource_id) and ClassDB.can_instantiate(resource_id):
		var inst = ClassDB.instantiate(resource_id)
		if inst is Resource:
			res = inst
			created = true

	if res == null:
		return null

	if d.has("props") and typeof(d.props) == TYPE_DICTIONARY:
		var props: Dictionary = d.props
		for key in props.keys():
			var prop_name := String(key)
			var expected := _prop_type(res as Resource, prop_name)
			(res as Resource).set(prop_name, _json_to_variant_for_type(props[key], expected))

	if created and not path_override.is_empty():
		var save_path := _to_res_path(path_override)
		if save_path != "" and not ResourceLoader.exists(save_path):
			var save_err := ResourceSaver.save(res, save_path)
			if save_err == OK:
				res = load(save_path)

	return res

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
			if d.has(JSON_RESOURCE_KEY) and typeof(d.get(JSON_RESOURCE_KEY)) == TYPE_STRING:
				var res = _resource_from_json(d)
				if res != null:
					return res
				return null
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

	if expected_type == TYPE_NODE_PATH:
		if typeof(value) == TYPE_NODE_PATH:
			return value
		if typeof(value) == TYPE_STRING_NAME or typeof(value) == TYPE_STRING:
			return NodePath(String(value))
		return _json_to_variant(value)

	if expected_type == TYPE_STRING_NAME:
		if typeof(value) == TYPE_STRING_NAME:
			return value
		if typeof(value) == TYPE_STRING:
			return StringName(String(value))
		return _json_to_variant(value)

	return _json_to_variant(value)

func _set_if_has(obj: Object, prop: String, value) -> bool:
	if obj == null:
		return false
	var plist = obj.get_property_list()
	for p in plist:
		if typeof(p) != TYPE_DICTIONARY:
			continue
		var d: Dictionary = p
		if String(d.get("name", "")) == prop:
			obj.set(prop, value)
			return true
	return false

func _vec2i_from(value, fallback: Vector2i) -> Vector2i:
	var v = _json_to_variant(value)
	if typeof(v) == TYPE_VECTOR2I:
		return v
	if typeof(v) == TYPE_VECTOR2:
		return Vector2i(int((v as Vector2).x), int((v as Vector2).y))
	if typeof(v) == TYPE_ARRAY:
		var a: Array = v
		if a.size() >= 2:
			return Vector2i(int(_num(a[0])), int(_num(a[1])))
	if typeof(v) == TYPE_DICTIONARY:
		var d: Dictionary = v
		if d.has("x") and d.has("y"):
			return Vector2i(int(_num(d.get("x"))), int(_num(d.get("y"))))
	return fallback

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

func _node_path_str(scene_root: Node, node: Node) -> String:
	if scene_root == null or node == null:
		return ""
	if node == scene_root:
		return "root"
	return "root/" + str(scene_root.get_path_to(node))

func _unique_child_name(parent: Node, desired: String) -> String:
	var base := desired.strip_edges()
	if base.is_empty():
		base = "Node"
	if parent.get_node_or_null(base) == null:
		return base
	var i := 2
	while true:
		var candidate := "%s_%d" % [base, i]
		if parent.get_node_or_null(candidate) == null:
			return candidate
		i += 1
	return base

# -----------------------------------------------------------------------------
# Operations (headless)
