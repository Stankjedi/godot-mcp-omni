extends RefCounted

const PLUGIN_VERSION := "0.2.0"
const JSON_TYPE_KEY := "$type"
const JSON_RESOURCE_KEY := "$resource"

var _plugin
var _ei
var _undo

var _action_open = false

func _init(plugin, undo) -> void:
	_plugin = plugin
	_ei = plugin.get_editor_interface()
	_undo = undo

func capabilities() -> Dictionary:
	return {
		"protocol": "tcp-jsonl-1",
		"plugin_version": PLUGIN_VERSION,
		"methods": [
			"ping",
			"health",
			"editor.play_main",
			"editor.stop",
			"editor.restart",
			"editor.save_all",
			"open_scene",
			"save_scene",
			"get_current_scene",
			"list_open_scenes",
			"begin_action",
			"commit_action",
			"abort_action",
			"undo_redo.undo",
			"undo_redo.redo",
			"add_node",
			"create_tilemap",
			"terrain.generate_mesh",
			"remove_node",
			"rename_node",
			"move_node",
			"create_simple_animation",
			"set_shader_param",
			"duplicate_node",
			"reparent_node",
			"instance_scene",
			"set_property",
			"get_property",
			"connect_signal",
			"disconnect_signal",
			"selection.select_node",
			"selection.clear",
			"scene_tree.query",
			"filesystem.scan",
			"filesystem.reimport_files",
				"viewport.capture",
				"viewport.set_screen",
				"viewport.focus_node",
				"panel.find",
				"panel.read",
				"script.edit",
				"script.add_breakpoint",
				"script.list_open",
				"project.user_data_dir",
				"log.read",
				"log.clear_output",
				"gdscript.eval_restricted",
				"list_signal_connections",
				"call",
				"set",
				"get",
			"inspect_class",
			"inspect_object",
		],
	}

func handle(method: String, params: Dictionary) -> Dictionary:
	match method:
		"ping":
			return _ping()
		"health":
			return _health()
		"editor.play_main":
			return _editor_play_main()
		"editor.stop":
			return _editor_stop()
		"editor.restart":
			return _editor_restart(params)
		"editor.save_all":
			return _editor_save_all()
		"open_scene":
			return _open_scene(params)
		"save_scene":
			return _save_scene(params)
		"get_current_scene":
			return _get_current_scene()
		"list_open_scenes":
			return _list_open_scenes()
		"begin_action":
			return _begin_action(params)
		"commit_action":
			return _commit_action(params)
		"abort_action":
			return _abort_action()
		"undo_redo.undo":
			return _undo_redo_undo()
		"undo_redo.redo":
			return _undo_redo_redo()
		"add_node":
			return _add_node(params)
		"create_tilemap":
			return _create_tilemap(params)
		"terrain.generate_mesh":
			return _terrain_generate_mesh(params)
		"remove_node":
			return _remove_node(params)
		"rename_node":
			return _rename_node(params)
		"move_node":
			return _move_node(params)
		"create_simple_animation":
			return _create_simple_animation(params)
		"set_shader_param":
			return _set_shader_param(params)
		"duplicate_node":
			return _duplicate_node(params)
		"reparent_node":
			return _reparent_node(params)
		"instance_scene":
			return _instance_scene(params)
		"set_property":
			return _set_property(params)
		"get_property":
			return _get_property(params)
		"connect_signal":
			return _connect_signal(params)
		"disconnect_signal":
				return _disconnect_signal(params)
		"selection.select_node":
				return _selection_select_node(params)
		"selection.get":
				return _selection_get()
		"selection.clear":
				return _selection_clear()
		"scene_tree.query":
				return _scene_tree_query(params)
		"filesystem.scan":
			return _filesystem_scan()
		"filesystem.reimport_files":
			return _filesystem_reimport_files(params)
		"viewport.capture":
			return _viewport_capture(params)
		"viewport.set_screen":
			return _viewport_set_screen(params)
		"viewport.focus_node":
			return _viewport_focus_node(params)
		"panel.find":
			return _panel_find(params)
		"panel.read":
			return _panel_read(params)
		"script.edit":
			return _script_edit(params)
		"script.add_breakpoint":
			return _script_add_breakpoint(params)
		"script.list_open":
			return _script_list_open(params)
		"project.user_data_dir":
			return _project_user_data_dir()
		"log.read":
			return _log_read(params)
		"log.clear_output":
			return _log_clear_output(params)
		"gdscript.eval_restricted":
			return _gdscript_eval_restricted(params)
		"list_signal_connections":
			return _list_signal_connections(params)
		"call":
			return _generic_call(params)
		"set":
			return _generic_set(params)
		"get":
			return _generic_get(params)
		"inspect_class":
			return _inspect_class(params)
		"inspect_object":
			return _inspect_object(params)
		_:
			return _resp_err("Unknown method", { "method": method })

func _resp_ok(result) -> Dictionary:
	return { "ok": true, "result": _variant_to_json(result) }

func _resp_err(message: String, details: Dictionary = {}) -> Dictionary:
	return { "ok": false, "error": { "message": message, "details": details } }

func _project_user_data_dir() -> Dictionary:
	return _resp_ok({
		"user_data_dir": OS.get_user_data_dir(),
		"user_dir": ProjectSettings.globalize_path("user://"),
	})

func _log_read(params: Dictionary) -> Dictionary:
	var log_path := "user://logs/godot.log"
	var max_bytes := int(params.get("max_bytes", params.get("maxBytes", 65536)))
	if max_bytes <= 0:
		max_bytes = 65536

	var f := FileAccess.open(log_path, FileAccess.READ)
	if f == null:
		return _resp_err("Log file not found", { "path": log_path })

	var length := int(f.get_length())
	var offset := int(params.get("offset", -max_bytes))
	if offset < 0:
		offset = max(0, length + offset)
	if offset > length:
		offset = length

	f.seek(offset)
	var remaining := length - offset
	var to_read := min(max_bytes, remaining)
	var bytes: PackedByteArray = f.get_buffer(to_read)
	var next_offset := int(f.get_position())
	f.close()

	var text := bytes.get_string_from_utf8()
	var lines: Array[String] = []
	for line in text.replace("\r\n", "\n").split("\n"):
		var s := String(line).strip_edges(false, true)
		if not s.is_empty():
			lines.append(s)

	return _resp_ok({
		"path": log_path,
		"offset": offset,
		"length": length,
		"next_offset": next_offset,
		"lines": lines,
	})


func _log_clear_output(params: Dictionary) -> Dictionary:
	# Best-effort "real clear" for Omni log reading:
	# - `log.read` reads from user://logs/godot.log, so truncating that file effectively clears
	#   the next reads, while still allowing the editor to keep appending new logs.
	# - If truncation fails (locked/unavailable), fall back to a separator print.
	var log_path := "user://logs/godot.log"
	var include_marker := bool(params.get("marker", false))

	var f := FileAccess.open(log_path, FileAccess.WRITE)
	if f != null:
		f.store_string("")
		f.close()
		if include_marker:
			print("--- OUTPUT CLEARED BY MCP (marker) ---")
		return _resp_ok({ "cleared": true, "truncated": true, "path": log_path })

	# Fallback: no direct API to clear the editor output panel / log file.
	print("\n\n\n--- OUTPUT CLEARED BY MCP ---\n\n\n")
	return _resp_ok({ "cleared": true, "truncated": false, "path": log_path })

func _gdscript_eval_restricted(params: Dictionary) -> Dictionary:
	var expression := str(params.get("expression", params.get("code", ""))).strip_edges()
	if expression.is_empty():
		return _resp_err("expression/code is required")
	if expression.find("\n") != -1 or expression.find("\r") != -1:
		return _resp_err("expression must be single-line")
	if expression.length() > 2000:
		return _resp_err("expression is too long", { "max": 2000, "length": expression.length() })

	# Block member access / method calls: allow '.' only in numeric literals (e.g., 1.23)
	var dot := expression.find(".")
	while dot != -1:
		var prev := expression.substr(dot - 1, 1) if dot > 0 else ""
		var next := expression.substr(dot + 1, 1) if dot + 1 < expression.length() else ""
		if not prev.is_valid_int() or not next.is_valid_int():
			return _resp_err("Restricted eval blocks member access ('.' is only allowed in numeric literals)", { "index": dot })
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
			return _resp_err("Restricted eval blocked unsafe token", { "token": token })

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
		return _resp_err("Expression parse error", { "error": e.get_error_text() })

	var value = e.execute(inputs, null, true)
	if e.has_execute_failed():
		return _resp_err("Expression execute error", { "error": e.get_error_text() })

	return _resp_ok({
		"evaluated": true,
		"expression": expression,
		"value": value,
	})

func _collect_signal_connections(source: Object, signal_name: StringName, results: Array) -> void:
	var list = source.get_signal_connection_list(signal_name)
	for c in list:
		if typeof(c) != TYPE_DICTIONARY:
			continue
		var d: Dictionary = c
		var target = d.get("target")
		var method = d.get("method")
		var flags_v = d.get("flags", 0)
		var flags := int(_num(flags_v, 0.0))
		var target_path := ""
		if target is Node:
			target_path = _node_path_str(target as Node)
		results.append({
			"signal": str(signal_name),
			"target_path": target_path,
			"method": str(method),
			"flags": flags,
		})

func _list_signal_connections(params: Dictionary) -> Dictionary:
	var source_path = str(params.get("source", params.get("source_path", params.get("node_path", params.get("nodePath", ""))))).strip_edges()
	var signal_name_raw = str(params.get("signal", "")).strip_edges()
	if source_path.is_empty():
		return _resp_err("source is required", { "required": ["source"] })

	var root = _scene_root()
	if root == null:
		return _resp_err("No edited scene")

	var source = _find_node(source_path)
	if source == null:
		return _resp_err("Source node not found", { "source": source_path })

	var results: Array = []
	if not signal_name_raw.is_empty():
		if not source.has_signal(signal_name_raw):
			return _resp_err("Source does not have signal", { "signal": signal_name_raw })
		_collect_signal_connections(source, StringName(signal_name_raw), results)
	else:
		for sig in source.get_signal_list():
			if typeof(sig) != TYPE_DICTIONARY:
				continue
			var d: Dictionary = sig
			var n = d.get("name", "")
			var name_s := str(n).strip_edges()
			if name_s.is_empty():
				continue
			_collect_signal_connections(source, StringName(name_s), results)

	return _resp_ok({ "count": results.size(), "connections": results })
func _variant_to_json(value):
	match typeof(value):
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING:
			return value
		TYPE_STRING_NAME:
			return str(value)
		TYPE_NODE_PATH:
			return str(value)
		TYPE_VECTOR2:
			var v2: Vector2 = value
			return { JSON_TYPE_KEY: "Vector2", "x": v2.x, "y": v2.y }
		TYPE_VECTOR2I:
			var v2i: Vector2i = value
			return { JSON_TYPE_KEY: "Vector2i", "x": v2i.x, "y": v2i.y }
		TYPE_VECTOR3:
			var v3: Vector3 = value
			return { JSON_TYPE_KEY: "Vector3", "x": v3.x, "y": v3.y, "z": v3.z }
		TYPE_VECTOR3I:
			var v3i: Vector3i = value
			return { JSON_TYPE_KEY: "Vector3i", "x": v3i.x, "y": v3i.y, "z": v3i.z }
		TYPE_VECTOR4:
			var v4: Vector4 = value
			return { JSON_TYPE_KEY: "Vector4", "x": v4.x, "y": v4.y, "z": v4.z, "w": v4.w }
		TYPE_COLOR:
			var c: Color = value
			return { JSON_TYPE_KEY: "Color", "r": c.r, "g": c.g, "b": c.b, "a": c.a }
		TYPE_RECT2:
			var r: Rect2 = value
			return { JSON_TYPE_KEY: "Rect2", "x": r.position.x, "y": r.position.y, "w": r.size.x, "h": r.size.y }
		TYPE_RECT2I:
			var ri: Rect2i = value
			return { JSON_TYPE_KEY: "Rect2i", "x": ri.position.x, "y": ri.position.y, "w": ri.size.x, "h": ri.size.y }
		TYPE_TRANSFORM2D:
			var t2: Transform2D = value
			return {
				JSON_TYPE_KEY: "Transform2D",
				"x": _variant_to_json(t2.x),
				"y": _variant_to_json(t2.y),
				"origin": _variant_to_json(t2.origin),
			}
		TYPE_TRANSFORM3D:
			var t3: Transform3D = value
			return {
				JSON_TYPE_KEY: "Transform3D",
				"basis": {
					"x": _variant_to_json(t3.basis.x),
					"y": _variant_to_json(t3.basis.y),
					"z": _variant_to_json(t3.basis.z),
				},
				"origin": _variant_to_json(t3.origin),
			}
		TYPE_ARRAY:
			var out: Array = []
			for v in value:
				out.append(_variant_to_json(v))
			return out
		TYPE_DICTIONARY:
			var out: Dictionary = {}
			for k in value.keys():
				out[str(k)] = _variant_to_json(value[k])
			return out
		_:
			return var_to_str(value)

func _num(v, fallback: float = 0.0) -> float:
	match typeof(v):
		TYPE_INT:
			return float(v)
		TYPE_FLOAT:
			return float(v)
		TYPE_STRING:
			var s := str(v).strip_edges()
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
			var prop_name := str(key)
			var expected := _prop_type(res as Resource, prop_name)
			(res as Resource).set(prop_name, _json_to_variant_for_type(props[key], expected))

	if created and not path_override.is_empty():
		var save_path := _to_res_path(path_override)
		if save_path != "" and not ResourceLoader.exists(save_path):
			var save_err := ResourceSaver.save(res, save_path)
			if save_err == OK:
				res = load(save_path)

	return res

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
				var t := str(d.get(JSON_TYPE_KEY)).strip_edges()
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
						# Fallback matrix form: a,b,c,d,tx,ty
						if d.has("a"):
							return Transform2D(
								Vector2(_num(d.get("a")), _num(d.get("b"))),
								Vector2(_num(d.get("c")), _num(d.get("d"))),
								Vector2(_num(d.get("tx")), _num(d.get("ty")))
							)
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
				# Unknown typed object: fall through to generic conversion.

			var out_d: Dictionary = {}
			for k in d.keys():
				out_d[str(k)] = _json_to_variant(d[k])
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
		if str(d.get("name", "")) == prop:
			if d.has("type"):
				return int(d.get("type"))
	return TYPE_NIL

func _intlike(v: float) -> bool:
	return abs(v - round(v)) <= 0.000001

func _json_to_variant_for_type(value, expected_type: int):
	if expected_type == TYPE_INT:
		if typeof(value) == TYPE_INT:
			return int(value)
		if typeof(value) == TYPE_FLOAT:
			var f := float(value)
			if _intlike(f):
				return int(round(f))
		if typeof(value) == TYPE_STRING:
			var s := str(value).strip_edges()
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
			return NodePath(str(value))
		return _json_to_variant(value)

	if expected_type == TYPE_STRING_NAME:
		if typeof(value) == TYPE_STRING_NAME:
			return value
		if typeof(value) == TYPE_STRING:
			return StringName(str(value))
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
		if str(d.get("name", "")) == prop:
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

func _dangerous_allowed() -> bool:
	return str(OS.get_environment("ALLOW_DANGEROUS_OPS")).strip_edges() == "true"

func _project_root_abs() -> String:
	var p = ProjectSettings.globalize_path("res://")
	return p.replace("\\", "/")

func _normalize_abs_path(p: String) -> String:
	var n = p.replace("\\", "/")
	if OS.get_name() == "Windows":
		n = n.to_lower()
	return n

func _to_res_path(p: String) -> String:
	var s = p.strip_edges()
	if s.is_empty():
		return ""
	if s.begins_with("res://"):
		return s
	if s.begins_with("user://"):
		return ""

	# Absolute path inside project -> convert to res:// relative path.
	var root_abs = _normalize_abs_path(_project_root_abs()).rstrip("/")
	var abs = _normalize_abs_path(s)
	if abs.begins_with(root_abs + "/"):
		var rel = abs.substr(root_abs.length() + 1)
		return "res://" + rel

	# Relative -> treat as res://
	if not s.begins_with("/"):
		return "res://" + s
	return ""

func _scene_root() -> Node:
	return _ei.get_edited_scene_root()

func _is_unique_name_in_owner(node: Node) -> bool:
	if node.has_method("is_unique_name_in_owner"):
		return bool(node.call("is_unique_name_in_owner"))
	return bool(node.get("unique_name_in_owner"))

func _find_node_by_unique_name(root: Node, unique: String) -> Node:
	var name = unique.strip_edges()
	if name.begins_with("%"):
		name = name.substr(1)
	if name.is_empty():
		return null

	# Fast path (Godot supports %Name in NodePath).
	var direct = root.get_node_or_null("%" + name)
	if direct != null:
		return direct

	# Fallback scan.
	var stack: Array = [root]
	while stack.size() > 0:
		var n = stack.pop_back()
		if n is Node:
			if (n as Node).name == name and _is_unique_name_in_owner(n as Node):
				return n as Node
			for c in (n as Node).get_children():
				if c is Node:
					stack.append(c)
	return null

func _find_node(node_id: String) -> Node:
	var root = _scene_root()
	if root == null:
		return null

	var p = node_id.strip_edges()
	if p.is_empty() or p == "root" or p == "/root":
		return root
	if p.begins_with("root/"):
		p = p.substr(5)
	elif p.begins_with("/root/"):
		p = p.substr(6)

	if p.begins_with("%"):
		return _find_node_by_unique_name(root, p)
	return root.get_node_or_null(p)

func _node_path_str(node: Node) -> String:
	var root = _scene_root()
	if root == null:
		return ""
	if node == root:
		return "root"
	return str(root.get_path_to(node))

func _unique_name_str(node: Node) -> String:
	if _is_unique_name_in_owner(node):
		return "%" + str(node.name)
	return ""

func _join_node_path(parent_path: String, name: String) -> String:
	if parent_path.strip_edges().is_empty() or parent_path == "root":
		return name
	return parent_path + "/" + name

func _node_info(node: Node) -> Dictionary:
	return {
		"node_path": _node_path_str(node),
		"name": node.name,
		"class": node.get_class(),
		"instance_id": node.get_instance_id(),
		"instance_id_str": str(node.get_instance_id()),
		"unique_name_in_owner": _is_unique_name_in_owner(node),
		"unique_name": _unique_name_str(node),
	}

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

func _get_instance_id(params: Dictionary, keys: Array) -> int:
	for k in keys:
		if not params.has(k):
			continue
		var v = params.get(k)
		if typeof(v) == TYPE_INT:
			return int(v)
		if typeof(v) == TYPE_FLOAT:
			var f := float(v)
			if f == floor(f):
				return int(f)
		if typeof(v) == TYPE_STRING:
			var s = str(v)
			if s.is_valid_int():
				return int(s)
	return 0

func _resolve_target(target_type: String, target_id, params: Dictionary) -> Dictionary:
	var tt = target_type.strip_edges()
	if tt.is_empty():
		return _resp_err("target_type is required")

	if tt == "singleton":
		var id = str(target_id)
		if id == "EditorInterface":
			return _resp_ok({ "resolved": true, "target_type": tt, "target_id": id })
		if id == "EditorFileSystem":
			return _resp_ok({ "resolved": true, "target_type": tt, "target_id": id })
		if Engine.has_singleton(id):
			return _resp_ok({ "resolved": true, "target_type": tt, "target_id": id })
		return _resp_err("Singleton not found", { "target_id": id })

	if tt == "node":
		var node_instance_id = _get_instance_id(params, ["instance_id", "instanceId"])
		if node_instance_id != 0:
			var inst = instance_from_id(node_instance_id)
			if inst != null and inst is Node:
				return _resp_ok({ "resolved": true, "target_type": tt, "instance_id": node_instance_id, "instance_id_str": str(node_instance_id) })
		var node_id = str(target_id)
		var node = _find_node(node_id)
		if node == null:
			return _resp_err("Node not found", { "node_id": node_id })
		return _resp_ok({ "resolved": true, "target_type": tt, "node_id": node_id })

	if tt == "resource":
		var res_instance_id = _get_instance_id(params, ["instance_id", "instanceId"])
		if res_instance_id != 0:
			var inst2 = instance_from_id(res_instance_id)
			if inst2 != null and inst2 is Resource:
				return _resp_ok({ "resolved": true, "target_type": tt, "instance_id": res_instance_id, "instance_id_str": str(res_instance_id) })
		var res_id = str(target_id)
		if res_id.is_empty():
			return _resp_err("resource target_id is required")
		return _resp_ok({ "resolved": true, "target_type": tt, "target_id": res_id })

	return _resp_err("Unknown target_type", { "target_type": tt })

func _get_target_object(target_type: String, target_id, params: Dictionary) -> Object:
	var tt = target_type.strip_edges()
	if tt == "singleton":
		var id = str(target_id)
		if id == "EditorInterface":
			return _ei
		if id == "EditorFileSystem":
			return _ei.get_resource_filesystem()
		if Engine.has_singleton(id):
			return Engine.get_singleton(id)
		return null

	if tt == "node":
		var node_instance_id = _get_instance_id(params, ["instance_id", "instanceId"])
		if node_instance_id != 0:
			var inst = instance_from_id(node_instance_id)
			if inst != null and inst is Node:
				return inst as Node
		return _find_node(str(target_id))

	if tt == "resource":
		var res_instance_id = _get_instance_id(params, ["instance_id", "instanceId"])
		if res_instance_id != 0:
			var inst2 = instance_from_id(res_instance_id)
			if inst2 != null and inst2 is Resource:
				return inst2 as Resource
		return load(str(target_id))

	return null

func _ping() -> Dictionary:
	return _resp_ok({ "pong": true, "plugin_version": PLUGIN_VERSION })

func _health() -> Dictionary:
	var root = _scene_root()
	var open_scenes = _ei.get_open_scenes()
	return _resp_ok({
		"plugin_version": PLUGIN_VERSION,
		"godot_version": Engine.get_version_info(),
		"project_root": _project_root_abs(),
		"current_scene": root.scene_file_path if root != null else "",
		"open_scenes": open_scenes,
		"action_open": _action_open,
		"allow_dangerous_ops": _dangerous_allowed(),
	})

func _method_arg_count(obj: Object, method_name: String) -> int:
	if obj == null:
		return -1
	var methods = obj.get_method_list()
	for m in methods:
		if typeof(m) != TYPE_DICTIONARY:
			continue
		var d: Dictionary = m
		if str(d.get("name", "")) != method_name:
			continue
		var args_v = d.get("args", [])
		if typeof(args_v) == TYPE_ARRAY:
			return (args_v as Array).size()
		return 0
	return -1

func _editor_play_main() -> Dictionary:
	if _ei == null:
		return _resp_err("EditorInterface not available")

	if _ei.has_method("play_main_scene"):
		_ei.call("play_main_scene")
		return _resp_ok({ "requested": true, "mode": "main" })

	return _resp_err("play_main_scene is not supported by this Godot version")

func _editor_stop() -> Dictionary:
	if _ei == null:
		return _resp_err("EditorInterface not available")

	for m in ["stop_playing_scene", "stop_playing_current_scene", "stop_playing"]:
		if _ei.has_method(m):
			_ei.call(m)
			return _resp_ok({ "requested": true, "method": m })

	return _resp_err("Stop play is not supported by this Godot version")

func _editor_save_all() -> Dictionary:
	if _ei == null:
		return _resp_err("EditorInterface not available")

	for m in ["save_all_scenes", "save_all"]:
		if _ei.has_method(m):
			_ei.call(m)
			return _resp_ok({ "saved": true, "method": m })

	var err = _ei.save_scene()
	if err != OK:
		return _resp_err("save_scene failed", { "error": err })
	return _resp_ok({ "saved": true, "fallback": true, "method": "save_scene" })

func _editor_restart(params: Dictionary) -> Dictionary:
	if _ei == null:
		return _resp_err("EditorInterface not available")

	if _ei.has_method("restart_editor"):
		var save_all_v = params.get("save_all", params.get("saveAll", true))
		var save_all := bool(save_all_v)
		var argc = _method_arg_count(_ei, "restart_editor")
		if argc <= 0:
			_ei.call("restart_editor")
		else:
			_ei.call("restart_editor", save_all)
		return _resp_ok({ "requested": true, "method": "restart_editor", "save_all": save_all })

	# Fallback: restart play session.
	var stop_resp = _editor_stop()
	if not bool(stop_resp.get("ok", false)):
		return _resp_err("Restart fallback failed (stop)", { "stop": stop_resp })

	var play_resp = _editor_play_main()
	if not bool(play_resp.get("ok", false)):
		return _resp_err("Restart fallback failed (play)", { "play": play_resp })

	return _resp_ok({ "requested": true, "fallback": true, "mode": "restart_play" })

func _undo_redo_undo() -> Dictionary:
	if _action_open:
		return _resp_err("Cannot undo while an action is open. Call commit_action or abort_action first.", { "action_open": true })
	if _undo == null:
		return _resp_err("UndoRedo not available")

	# Godot 4.x: EditorUndoRedoManager exposes histories via get_object_history_id + get_history_undo_redo.
	if not _undo.has_method("get_object_history_id") or not _undo.has_method("get_history_undo_redo"):
		return _resp_err(
			"UndoRedo history APIs are not available on this undo object",
			{ "undo_type": _undo.get_class() }
		)

	var root = _scene_root()
	if root == null:
		return _resp_err("No edited scene")

	var hid_v = _undo.call("get_object_history_id", root)
	var hid := int(_num(hid_v, 0.0))
	var history_ur = _undo.call("get_history_undo_redo", hid)
	if history_ur == null:
		return _resp_err("UndoRedo history not found", { "history_id": hid })
	if not history_ur.has_method("undo"):
		return _resp_err("UndoRedo history does not support undo()", { "history_id": hid })

	history_ur.call("undo")
	return _resp_ok({ "undone": true, "history_id": hid })

func _undo_redo_redo() -> Dictionary:
	if _action_open:
		return _resp_err("Cannot redo while an action is open. Call commit_action or abort_action first.", { "action_open": true })
	if _undo == null:
		return _resp_err("UndoRedo not available")

	if not _undo.has_method("get_object_history_id") or not _undo.has_method("get_history_undo_redo"):
		return _resp_err(
			"UndoRedo history APIs are not available on this undo object",
			{ "undo_type": _undo.get_class() }
		)

	var root = _scene_root()
	if root == null:
		return _resp_err("No edited scene")

	var hid_v = _undo.call("get_object_history_id", root)
	var hid := int(_num(hid_v, 0.0))
	var history_ur = _undo.call("get_history_undo_redo", hid)
	if history_ur == null:
		return _resp_err("UndoRedo history not found", { "history_id": hid })
	if not history_ur.has_method("redo"):
		return _resp_err("UndoRedo history does not support redo()", { "history_id": hid })

	history_ur.call("redo")
	return _resp_ok({ "redone": true, "history_id": hid })

func _normalize_screen_name(name: String) -> String:
	var trimmed := name.strip_edges()
	var lowered := trimmed.to_lower()
	if lowered == "2d":
		return "2D"
	if lowered == "3d":
		return "3D"
	if lowered == "script" or lowered == "code":
		return "Script"
	return trimmed

func _viewport_set_screen(params: Dictionary) -> Dictionary:
	if _ei == null:
		return _resp_err("EditorInterface not available")

	var screen_name = str(params.get("screen_name", params.get("screenName", "")))
	if screen_name.strip_edges().is_empty():
		return _resp_err("screen_name is required")

	var normalized := _normalize_screen_name(screen_name)

	for m in ["set_main_screen_editor", "set_main_screen"]:
		if _ei.has_method(m):
			_ei.call(m, normalized)
			return _resp_ok({ "requested": true, "screen": normalized, "method": m })

	return _resp_err("Screen switching is not supported by this Godot version", { "screen": normalized })

func _viewport_focus_node(params: Dictionary) -> Dictionary:
	if _ei == null:
		return _resp_err("EditorInterface not available")

	var node_path = str(params.get("node_path", params.get("nodePath", ""))).strip_edges()
	if node_path.is_empty():
		return _resp_err("node_path is required")

	var root = _scene_root()
	if root == null:
		return _resp_err("No edited scene")

	var node = _find_node(node_path)
	if node == null:
		return _resp_err("Node not found", { "node_path": node_path })

	var selection = _ei.get_selection()
	if selection != null:
		selection.clear()
		selection.add_node(node)

	# Best-effort: frame 3D node in the editor viewport when supported.
	if node is Node3D and _ei.has_method("edit_node"):
		_ei.call("edit_node", node)

	return _resp_ok({ "focused": true, "node": _node_info(node) })

func _viewport_capture(params: Dictionary) -> Dictionary:
	if _ei == null:
		return _resp_err("EditorInterface not available")

	var max_size_v = params.get("max_size", params.get("maxSize", 0))
	var max_size := int(_num(max_size_v, 0.0))

	var base: Control = _ei.get_base_control()
	if base == null:
		return _resp_err("Editor base control not available")

	var vp := base.get_viewport()
	if vp == null:
		return _resp_err("Viewport not available")

	var tex = vp.get_texture()
	if tex == null:
		return _resp_err("Viewport texture not available")

	var img: Image = tex.get_image()
	if img == null:
		return _resp_err("Failed to capture viewport image")

	if max_size > 0:
		var w := img.get_width()
		var h := img.get_height()
		var m := max(w, h)
		if m > 0 and m > max_size:
			var scale := float(max_size) / float(m)
			var nw := int(round(float(w) * scale))
			var nh := int(round(float(h) * scale))
			img.resize(max(1, nw), max(1, nh), Image.INTERPOLATE_LANCZOS)

	var png: PackedByteArray = img.save_png_to_buffer()
	var b64 := Marshalls.raw_to_base64(png)

	return _resp_ok({
		"content_type": "image/png",
		"base64": b64,
		"width": img.get_width(),
		"height": img.get_height(),
		"bytes": png.size(),
	})

func _ui_path_str(base: Node, node: Node) -> String:
	if base == null or node == null:
		return ""
	var p: NodePath = base.get_path_to(node)
	return str(p)

func _node_text_preview(node: Node, max_chars: int = 120) -> String:
	if node == null:
		return ""
	var text := ""
	if node is Label:
		text = (node as Label).text
	elif node is Button:
		text = (node as Button).text
	elif node is LineEdit:
		text = (node as LineEdit).text
	elif node is RichTextLabel:
		var rtl := node as RichTextLabel
		text = rtl.get_parsed_text() if rtl.has_method("get_parsed_text") else rtl.text
	elif node is OptionButton:
		var ob := node as OptionButton
		var idx := ob.get_selected_id()
		if idx >= 0:
			text = ob.get_item_text(idx)

	text = str(text).strip_edges()
	if text.length() > max_chars:
		return text.substr(0, max_chars) + "…"
	return text

func _panel_find(params: Dictionary) -> Dictionary:
	if _ei == null:
		return _resp_err("EditorInterface not available")

	var base: Control = _ei.get_base_control()
	if base == null:
		return _resp_err("Editor base control not available")

	var root_path := str(params.get("root_path", params.get("rootPath", ""))).strip_edges()
	var root: Node = base
	if not root_path.is_empty():
		root = base.get_node_or_null(root_path)
		if root == null:
			return _resp_err("rootPath not found", { "rootPath": root_path })

	var name_contains := str(params.get("name_contains", params.get("nameContains", ""))).strip_edges().to_lower()
	var class_filter := str(params.get("class_name", params.get("className", ""))).strip_edges()
	var text_contains := str(params.get("text_contains", params.get("textContains", ""))).strip_edges().to_lower()
	var visible_only := bool(params.get("visible_only", params.get("visibleOnly", true)))

	var max_results := int(_num(params.get("max_results", params.get("maxResults", 50)), 50.0))
	max_results = clamp(max_results, 1, 200)
	var max_nodes := int(_num(params.get("max_nodes", params.get("maxNodes", 4000)), 4000.0))
	max_nodes = clamp(max_nodes, 50, 20000)

	var include_text_preview := bool(params.get("include_text_preview", params.get("includeTextPreview", false)))

	var results: Array = []
	var stack: Array = [root]
	var scanned := 0
	var truncated := false

	while stack.size() > 0:
		var n = stack.pop_back()
		if n == null or not (n is Node):
			continue
		scanned += 1
		if scanned > max_nodes:
			truncated = true
			break

		if visible_only and n is Control and not (n as Control).is_visible_in_tree():
			# Skip invisible subtrees for performance (optimized default).
			continue

		var is_match := true
		if not name_contains.is_empty():
			is_match = str(n.name).to_lower().find(name_contains) != -1
		if is_match and not class_filter.is_empty():
			is_match = n.is_class(class_filter)
		if is_match and not text_contains.is_empty():
			var preview := _node_text_preview(n, 200)
			is_match = preview.to_lower().find(text_contains) != -1

		if is_match:
			var info: Dictionary = {
				"path": _ui_path_str(base, n),
				"name": str(n.name),
				"class": n.get_class(),
			}
			if n is Control:
				info["visible"] = (n as Control).is_visible_in_tree()
			if include_text_preview:
				var preview2 := _node_text_preview(n, 200)
				if not preview2.is_empty():
					info["text_preview"] = preview2
			results.append(info)
			if results.size() >= max_results:
				truncated = true
				break

		for child in n.get_children():
			if child is Node:
				stack.append(child)

	return _resp_ok({
		"root_path": root_path if not root_path.is_empty() else ".",
		"scanned": scanned,
		"count": results.size(),
		"truncated": truncated,
		"matches": results,
	})

func _collect_tree_text(tree: Tree, max_items: int) -> Array[String]:
	var out: Array[String] = []
	if tree == null:
		return out
	var root := tree.get_root()
	if root == null:
		return out

	var cols := max(1, int(tree.get_columns()))
	var stack: Array = [ [root, 0] ]
	while stack.size() > 0 and out.size() < max_items:
		var entry = stack.pop_back()
		if typeof(entry) != TYPE_ARRAY or entry.size() < 2:
			continue
		var item: TreeItem = entry[0]
		var depth: int = int(entry[1])
		if item == null:
			continue

		var parts: Array[String] = []
		for c in range(cols):
			var t := str(item.get_text(c)).strip_edges()
			if not t.is_empty():
				parts.append(t)
		var line := " | ".join(parts)
		if not line.is_empty():
			out.append("%s%s" % ["  ".repeat(min(depth, 8)), line])

		# Push children (reverse order to preserve visual order).
		var children: Array = []
		var child := item.get_first_child()
		while child != null:
			children.append(child)
			child = child.get_next()
		for i in range(children.size() - 1, -1, -1):
			stack.append([children[i], depth + 1])

	return out

func _panel_read(params: Dictionary) -> Dictionary:
	if _ei == null:
		return _resp_err("EditorInterface not available")

	var base: Control = _ei.get_base_control()
	if base == null:
		return _resp_err("Editor base control not available")

	var panel_path := str(params.get("panel_path", params.get("panelPath", params.get("rootPath", "")))).strip_edges()
	if panel_path.is_empty():
		return _resp_err("panelPath is required", { "required": ["panelPath"] })

	var root: Node = base.get_node_or_null(panel_path)
	if root == null:
		return _resp_err("panelPath not found", { "panelPath": panel_path })

	var visible_only := bool(params.get("visible_only", params.get("visibleOnly", true)))
	var include_paths := bool(params.get("include_paths", params.get("includePaths", false)))
	var include_text_edits := bool(params.get("include_text_edits", params.get("includeTextEdits", false)))
	var include_tree_items := bool(params.get("include_tree_items", params.get("includeTreeItems", true)))
	var include_item_lists := bool(params.get("include_item_lists", params.get("includeItemLists", true)))

	var max_nodes := int(_num(params.get("max_nodes", params.get("maxNodes", 400)), 400.0))
	max_nodes = clamp(max_nodes, 50, 5000)
	var max_chars := int(_num(params.get("max_chars", params.get("maxChars", 20000)), 20000.0))
	max_chars = clamp(max_chars, 500, 200000)
	var max_items := int(_num(params.get("max_items", params.get("maxItems", 120)), 120.0))
	max_items = clamp(max_items, 10, 2000)

	var return_entries := bool(params.get("return_entries", params.get("returnEntries", false)))

	var scanned := 0
	var chars := 0
	var truncated := false
	var entries: Array = []
	var lines: Array[String] = []
	var stack: Array = [root]

	while stack.size() > 0:
		var n = stack.pop_back()
		if n == null or not (n is Node):
			continue
		scanned += 1
		if scanned > max_nodes:
			truncated = true
			break

		if visible_only and n is Control and not (n as Control).is_visible_in_tree():
			continue

		var text := ""
		var kind := ""

		if n is TabContainer:
			var tc := n as TabContainer
			var tab_count := int(tc.get_tab_count())
			var current := int(tc.get_current_tab())
			var current_title := tc.get_tab_title(current) if current >= 0 and current < tab_count else ""
			var titles: Array[String] = []
			for i in range(min(tab_count, max_items)):
				titles.append(str(tc.get_tab_title(i)))
			kind = "tab_container"
			text = "current=%s tabs=%s" % [current_title, ", ".join(titles)]
		elif n is Tree and include_tree_items:
			var tree := n as Tree
			var items := _collect_tree_text(tree, max_items)
			if items.size() > 0:
				kind = "tree"
				text = "Tree:\n" + "\n".join(items)
		elif n is ItemList and include_item_lists:
			var il := n as ItemList
			var count := int(il.get_item_count())
			var items2: Array[String] = []
			for i in range(min(count, max_items)):
				items2.append(str(il.get_item_text(i)))
			if items2.size() > 0:
				kind = "item_list"
				text = "ItemList:\n" + "\n".join(items2)
		elif n is TextEdit or n is CodeEdit:
			if include_text_edits:
				kind = "text_edit"
				text = str(n.text)
		else:
			text = _node_text_preview(n, 2000)
			if not text.is_empty():
				kind = "text"

		text = str(text).strip_edges()
		if not text.is_empty():
			var path_str := _ui_path_str(base, n)
			var line := text
			if include_paths and not path_str.is_empty():
				line = "%s [%s]: %s" % [path_str, n.get_class(), text]

			var add_len := line.length() + 1
			if chars + add_len > max_chars:
				var remaining := max_chars - chars
				if remaining > 0:
					lines.append(line.substr(0, remaining) + "…")
				truncated = true
				break

			lines.append(line)
			chars += add_len

			if return_entries:
				entries.append({
					"path": path_str,
					"name": str(n.name),
					"class": n.get_class(),
					"kind": kind,
					"text": text,
				})

		for child in n.get_children():
			if child is Node:
				stack.append(child)

	var result: Dictionary = {
		"panelPath": panel_path,
		"root_class": root.get_class(),
		"scanned": scanned,
		"chars": chars,
		"truncated": truncated,
		"text": "\n".join(lines),
	}
	if return_entries:
		result["entries"] = entries
		result["entries_count"] = entries.size()

	return _resp_ok(result)

func _script_editor_node() -> Node:
	if _ei == null:
		return null

	if _ei.has_method("get_script_editor"):
		var se = _ei.call("get_script_editor")
		if se != null and se is Node:
			return se as Node

	var base: Control = _ei.get_base_control()
	if base == null:
		return null

	var candidates := base.find_children("*", "ScriptEditor", true, false)
	if candidates.size() > 0 and candidates[0] is Node:
		return candidates[0] as Node
	return null

func _find_code_edit() -> CodeEdit:
	var se := _script_editor_node()
	if se == null:
		return null

	var edits := se.find_children("*", "CodeEdit", true, false)
	for e in edits:
		if e is CodeEdit and (e as CodeEdit).is_visible_in_tree():
			return e as CodeEdit
	for e in edits:
		if e is CodeEdit:
			return e as CodeEdit
	return null

func _script_list_open(_params: Dictionary) -> Dictionary:
	var se := _script_editor_node()
	if se == null:
		return _resp_err("Script editor not available")
	if not se.has_method("get_open_scripts"):
		return _resp_err("get_open_scripts is not supported by this script editor", { "type": se.get_class() })

	var open_v = se.call("get_open_scripts")
	var open_scripts: Array = open_v if typeof(open_v) == TYPE_ARRAY else []
	var out: Array = []
	for s in open_scripts:
		if s == null:
			continue
		if s is Script:
			var script: Script = s as Script
			out.append({ "path": script.resource_path, "class": script.get_class() })
		elif s is Resource:
			var r: Resource = s as Resource
			out.append({ "path": r.resource_path, "class": r.get_class() })
		else:
			out.append({ "value": var_to_str(s) })

	return _resp_ok({ "count": out.size(), "scripts": out })

func _script_edit(params: Dictionary) -> Dictionary:
	if _ei == null:
		return _resp_err("EditorInterface not available")

	var script_path = str(params.get("script_path", params.get("scriptPath", "")))
	if script_path.strip_edges().is_empty():
		return _resp_err("script_path is required")

	var res_path := _to_res_path(script_path)
	var script_res = load(res_path)
	if script_res == null or not (script_res is Script):
		return _resp_err("Failed to load script", { "script_path": res_path })

	# Best-effort: switch to Script screen for visibility.
	_viewport_set_screen({ "screen_name": "Script" })

	if _ei.has_method("edit_resource"):
		_ei.call("edit_resource", script_res)
	elif _ei.has_method("edit_script"):
		_ei.call("edit_script", script_res)
	else:
		return _resp_err("No suitable editor API to open scripts (edit_resource/edit_script missing)")

	var line_number_v = params.get("line_number", params.get("lineNumber", 0))
	var line_number := int(_num(line_number_v, 0.0))
	if line_number > 0:
		var code_edit := _find_code_edit()
		if code_edit != null:
			var line0 := max(0, line_number - 1)
			if code_edit.has_method("set_caret_line"):
				code_edit.call("set_caret_line", line0)
			if code_edit.has_method("set_caret_column"):
				code_edit.call("set_caret_column", 0)
			code_edit.grab_focus()

	return _resp_ok({ "opened": true, "script_path": res_path, "line_number": line_number })

func _script_add_breakpoint(params: Dictionary) -> Dictionary:
	var script_path = str(params.get("script_path", params.get("scriptPath", "")))
	var line_number_v = params.get("line_number", params.get("lineNumber", 0))
	var line_number := int(_num(line_number_v, 0.0))
	if script_path.strip_edges().is_empty() or line_number <= 0:
		return _resp_err("script_path and line_number (>0) are required")

	var open_resp = _script_edit({ "script_path": script_path, "line_number": line_number })
	if not bool(open_resp.get("ok", false)):
		return open_resp

	var code_edit := _find_code_edit()
	if code_edit == null:
		return _resp_err("CodeEdit not available (script editor not ready)")

	var line0 := max(0, line_number - 1)
	if code_edit.has_method("set_line_as_breakpoint"):
		code_edit.call("set_line_as_breakpoint", line0, true)
	elif code_edit.has_method("set_breakpoint"):
		code_edit.call("set_breakpoint", line0, true)
	else:
		return _resp_err("Breakpoint API not available on CodeEdit", { "code_edit_type": code_edit.get_class() })

	var is_set := false
	if code_edit.has_method("is_line_breakpointed"):
		is_set = bool(code_edit.call("is_line_breakpointed", line0))

	return _resp_ok({
		"breakpoint": true,
		"script_path": _to_res_path(script_path),
		"line_number": line_number,
		"confirmed": is_set,
	})

func _open_scene(params: Dictionary) -> Dictionary:
	var p = str(params.get("path", ""))
	if p.is_empty():
		return _resp_err("path is required")

	var res_path = _to_res_path(p)
	if res_path.is_empty():
		return _resp_err("Invalid path (must be res:// or inside project root)", { "path": p })

	_ei.open_scene_from_path(res_path)
	return _resp_ok({ "requested_path": res_path })

func _save_scene(params: Dictionary) -> Dictionary:
	if params.has("path"):
		var p = str(params.get("path", ""))
		if p.is_empty():
			return _resp_err("path must be a non-empty string")
		var res_path = _to_res_path(p)
		if res_path.is_empty():
			return _resp_err("Invalid path (must be res:// or inside project root)", { "path": p })
		_ei.save_scene_as(res_path)
		return _resp_ok({ "saved_as": res_path })

	var err = _ei.save_scene()
	if err != OK:
		return _resp_err("save_scene failed", { "error": err })
	return _resp_ok({ "saved": true })

func _get_current_scene() -> Dictionary:
	var root = _scene_root()
	if root == null:
		return _resp_err("No edited scene")
	return _resp_ok({
		"path": root.scene_file_path,
		"name": root.name,
		"class": root.get_class(),
		"instance_id": root.get_instance_id(),
		"instance_id_str": str(root.get_instance_id()),
		"unique_name_in_owner": _is_unique_name_in_owner(root),
		"unique_name": _unique_name_str(root),
	})

func _list_open_scenes() -> Dictionary:
	var scenes = _ei.get_open_scenes()
	var out: Array = []
	for s in scenes:
		out.append(str(s))
	return _resp_ok({ "scenes": out })

func _begin_action(params: Dictionary) -> Dictionary:
	if _action_open:
		return _resp_err("An undo action is already open. Call commit_action first.")
	var name = str(params.get("name", params.get("action_name", "godot_mcp:batch")))
	if name.strip_edges().is_empty():
		return _resp_err("name is required")
	_create_action(name)
	_action_open = true
	return _resp_ok({ "begun": true, "name": name })

func _commit_action(params: Dictionary) -> Dictionary:
	if not _action_open:
		return _resp_err("No open undo action. Call begin_action first.")
	var execute_v = params.get("execute", null)
	var execute := true
	if execute_v != null:
		execute = bool(execute_v)
	_undo.commit_action(execute)
	_action_open = false
	return _resp_ok({ "committed": true, "executed": execute })

func _abort_action() -> Dictionary:
	if not _action_open:
		return _resp_err("No open undo action. Call begin_action first.")
	# Best-effort rollback: commit without executing "do" operations.
	_undo.commit_action(false)
	_action_open = false
	return _resp_ok({ "aborted": true })

func _ensure_action(name: String) -> bool:
	if _action_open:
		return false
	_create_action(name)
	return true

func _create_action(name: String) -> void:
	var root = _scene_root()
	if root != null and _undo.get_class() == "EditorUndoRedoManager":
		# Godot 4: use scene root as context to automatically pick the correct history.
		_undo.create_action(name, UndoRedo.MERGE_DISABLE, root)
	else:
		# Godot 3 or no scene root: global history.
		_undo.create_action(name)

func _maybe_commit(auto_commit: bool) -> void:
	if auto_commit:
		_undo.commit_action()

func _add_node(params: Dictionary) -> Dictionary:
	var parent_path = str(params.get("parent_path", params.get("parentPath", "root")))
	var node_type = str(params.get("type", params.get("node_type", params.get("nodeType", ""))))
	var node_name = str(params.get("name", params.get("node_name", params.get("nodeName", ""))))
	var props_v = params.get("props", params.get("properties", {}))
	var props: Dictionary = props_v if typeof(props_v) == TYPE_DICTIONARY else {}
	var ensure_unique = bool(params.get("ensure_unique_name", params.get("ensureUniqueName", false)))

	var root = _scene_root()
	if root == null:
		return _resp_err("No edited scene")

	var parent = _find_node(parent_path)
	if parent == null:
		return _resp_err("Parent node not found", { "parent_path": parent_path })

	if node_type.is_empty():
		return _resp_err("type/node_type is required")
	if node_name.is_empty():
		return _resp_err("name/node_name is required")

	if not ClassDB.class_exists(node_type) or not ClassDB.can_instantiate(node_type):
		return _resp_err("Cannot instantiate type", { "type": node_type })

	var node = ClassDB.instantiate(node_type)
	if node == null or not (node is Node):
		return _resp_err("Instantiated object is not a Node", { "type": node_type })

	if ensure_unique:
		node_name = _unique_child_name(parent, node_name)
	(node as Node).name = node_name
	for k in props.keys():
		var prop_name := str(k)
		var expected := _prop_type(node as Node, prop_name)
		(node as Node).set(prop_name, _json_to_variant_for_type(props[k], expected))

	var auto_commit = _ensure_action("godot_mcp:add_node")
	_undo.force_fixed_history()
	_undo.add_do_reference(node)
	_undo.add_do_method(parent, "add_child", node)
	_undo.force_fixed_history()
	_undo.add_do_property(node, "owner", root)
	_undo.add_undo_method(parent, "remove_child", node)
	_maybe_commit(auto_commit)

	var actual_path := _node_path_str(node as Node)
	var unique_name := _unique_name_str(node as Node)
	return _resp_ok({
		"added": true,
		"type": node_type,
		"name": node_name,
		"node_path": actual_path,
		"instance_id": (node as Node).get_instance_id(),
		"instance_id_str": str((node as Node).get_instance_id()),
		"unique_name_in_owner": _is_unique_name_in_owner(node as Node),
		"unique_name": unique_name,
		"ensure_unique_name": ensure_unique,
	})

func _create_tileset_from_texture(texture_path: String, tile_size: Vector2i, cells: Array) -> Dictionary:
	var res_path := _to_res_path(texture_path)
	if res_path.is_empty():
		return { "ok": false, "message": "Invalid texture path", "texture_path": texture_path }
	var texture = load(res_path)
	if texture == null or not (texture is Texture2D):
		var abs_path := ProjectSettings.globalize_path(res_path)
		var image := Image.new()
		var err := image.load(abs_path)
		if err == OK:
			if ClassDB.class_has_method("ImageTexture", "create_from_image"):
				texture = ImageTexture.create_from_image(image)
			else:
				var image_tex := ImageTexture.new()
				image_tex.create_from_image(image)
				texture = image_tex
		if texture == null or not (texture is Texture2D):
			return { "ok": false, "message": "Failed to load texture", "texture_path": res_path }

	var tileset := TileSet.new()
	var source := TileSetAtlasSource.new()
	source.texture = texture
	if not _set_if_has(source, "texture_region_size", tile_size):
		_set_if_has(source, "tile_size", tile_size)
	var source_id := tileset.add_source(source)

	var created: Dictionary = {}
	for c in cells:
		if typeof(c) != TYPE_DICTIONARY:
			continue
		var d: Dictionary = c
		var ax := int(_num(d.get("atlas_x", d.get("atlasX", -1))))
		var ay := int(_num(d.get("atlas_y", d.get("atlasY", -1))))
		if ax < 0 or ay < 0:
			continue
		var key := str(ax) + ":" + str(ay)
		if created.has(key):
			continue
		if source.has_method("create_tile"):
			source.call("create_tile", Vector2i(ax, ay))
		created[key] = true

	return { "ok": true, "tileset": tileset, "source_id": source_id, "texture_path": res_path }

func _create_tilemap(params: Dictionary) -> Dictionary:
	var parent_path = str(params.get("parent_path", params.get("parentPath", "root")))
	var node_type = str(params.get("node_type", params.get("nodeType", "TileMap")))
	var node_name = str(params.get("node_name", params.get("nodeName", "")))
	var props_v = params.get("props", params.get("properties", {}))
	var props: Dictionary = props_v if typeof(props_v) == TYPE_DICTIONARY else {}
	var ensure_unique = bool(params.get("ensure_unique_name", params.get("ensureUniqueName", false)))

	if node_name.is_empty():
		return _resp_err("node_name is required")

	var root = _scene_root()
	if root == null:
		return _resp_err("No edited scene")

	var parent = _find_node(parent_path)
	if parent == null:
		return _resp_err("Parent node not found", { "parent_path": parent_path })

	if not ClassDB.class_exists(node_type) or not ClassDB.can_instantiate(node_type):
		return _resp_err("Cannot instantiate type", { "type": node_type })

	var node = ClassDB.instantiate(node_type)
	if node == null or not (node is Node):
		return _resp_err("Instantiated object is not a Node", { "type": node_type })

	if ensure_unique:
		node_name = _unique_child_name(parent, node_name)
	(node as Node).name = node_name

	for k in props.keys():
		var prop_name := str(k)
		var expected := _prop_type(node as Node, prop_name)
		(node as Node).set(prop_name, _json_to_variant_for_type(props[k], expected))

	var cells: Array = []
	if params.has("cells") and typeof(params.cells) == TYPE_ARRAY:
		cells = params.cells

	var tile_set_texture_path := str(params.get("tile_set_texture_path", params.get("tileSetTexturePath", "")))
	var tile_set_path := str(params.get("tile_set_path", params.get("tileSetPath", "")))
	var tile_size := _vec2i_from(params.get("tile_size", params.get("tileSize", {})), Vector2i(32, 32))

	var created_source_id := -1
	var tile_set_current = (node as Node).get("tile_set")
	if tile_set_current == null and not tile_set_texture_path.is_empty():
		var tileset_resp := _create_tileset_from_texture(tile_set_texture_path, tile_size, cells)
		if not bool(tileset_resp.get("ok", false)):
			return _resp_err(
				"Failed to build TileSet from texture",
				{ "texture_path": tile_set_texture_path, "details": tileset_resp }
			)
		var tileset_res = tileset_resp.get("tileset")
		created_source_id = int(tileset_resp.get("source_id", -1))
		(node as Node).set("tile_set", tileset_res)
		if not tile_set_path.is_empty():
			var save_path := _to_res_path(tile_set_path)
			if save_path != "" and not ResourceLoader.exists(save_path):
				ResourceSaver.save(tileset_res, save_path)

	if cells.size() > 0:
		if not (node is TileMap):
			return _resp_err("Node is not TileMap", { "node_type": node_type })
		var layer := int(_num(params.get("layer", 0)))
		for c in cells:
			if typeof(c) != TYPE_DICTIONARY:
				continue
			var d2: Dictionary = c
			var x := int(_num(d2.get("x", d2.get("col", 0))))
			var y := int(_num(d2.get("y", d2.get("row", 0))))
			var source_id := int(_num(d2.get("source_id", d2.get("sourceId", d2.get("id", d2.get("tile", -1))))))
			if source_id < 0 and created_source_id >= 0:
				source_id = created_source_id
			var atlas_x := int(_num(d2.get("atlas_x", d2.get("atlasX", -1))))
			var atlas_y := int(_num(d2.get("atlas_y", d2.get("atlasY", -1))))
			var alternative := int(_num(d2.get("alternative", d2.get("alt", d2.get("alternative_id", 0)))))
			(node as TileMap).set_cell(
				layer,
				Vector2i(x, y),
				source_id,
				Vector2i(atlas_x, atlas_y),
				alternative
			)

	var auto_commit = _ensure_action("godot_mcp:create_tilemap")
	_undo.force_fixed_history()
	_undo.add_do_reference(node)
	_undo.add_do_method(parent, "add_child", node)
	_undo.force_fixed_history()
	_undo.add_do_property(node, "owner", root)
	_undo.add_undo_method(parent, "remove_child", node)
	_maybe_commit(auto_commit)

	var actual_path := _node_path_str(node as Node)
	return _resp_ok({
		"created": true,
		"type": node_type,
		"name": node_name,
		"node_path": actual_path,
		"cells": cells.size(),
		"ensure_unique_name": ensure_unique,
	})

func _terrain_generate_mesh(params: Dictionary) -> Dictionary:
	var parent_path = str(params.get("parent_path", params.get("parentPath", params.get("parentNodePath", "root"))))
	var desired_name = str(params.get("name", params.get("nodeName", params.get("node_name", "Terrain"))))
	var ensure_unique = bool(params.get("ensure_unique_name", params.get("ensureUniqueName", false)))

	var size := max(1, int(_num(params.get("size", 32), 32.0)))
	var height_scale := float(_num(params.get("height_scale", params.get("heightScale", 5.0)), 5.0))
	var seed := int(_num(params.get("seed", 0), 0.0))
	if seed == 0:
		seed = int(randi())
	var frequency := float(_num(params.get("frequency", 0.02), 0.02))
	if frequency <= 0.0:
		frequency = 0.000001
	var octaves := max(1, int(_num(params.get("octaves", params.get("fractal_octaves", 4)), 4.0)))
	var center := bool(params.get("center", true))

	var root = _scene_root()
	if root == null:
		return _resp_err("No edited scene")

	var parent = _find_node(parent_path)
	if parent == null:
		return _resp_err("Parent node not found", { "parent_path": parent_path })

	var node_name = desired_name
	if ensure_unique:
		node_name = _unique_child_name(parent, desired_name)

	var noise := FastNoiseLite.new()
	noise.seed = seed
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
		return _resp_err("Failed to create terrain mesh")

	var body := StaticBody3D.new()
	body.name = node_name
	body.set_meta("_edit_group_", true)

	var mesh_inst := MeshInstance3D.new()
	mesh_inst.name = "Mesh"
	mesh_inst.mesh = mesh
	body.add_child(mesh_inst)

	var shape := CollisionShape3D.new()
	shape.name = "Collision"
	shape.shape = mesh.create_trimesh_shape()
	body.add_child(shape)

	var auto_commit = _ensure_action("godot_mcp:terrain.generate_mesh")
	_undo.force_fixed_history()
	_undo.add_do_reference(body)
	_undo.add_do_method(parent, "add_child", body)
	_undo.force_fixed_history()
	_undo.add_do_property(body, "owner", root)
	_undo.add_do_property(mesh_inst, "owner", root)
	_undo.add_do_property(shape, "owner", root)
	if center:
		_undo.add_do_property(body, "position", Vector3(-float(size) / 2.0, 0.0, -float(size) / 2.0))
	_undo.add_undo_method(parent, "remove_child", body)
	_maybe_commit(auto_commit)

	var actual_path := _node_path_str(body)
	return _resp_ok({
		"generated": true,
		"node_path": actual_path,
		"name": node_name,
		"parent_path": parent_path,
		"size": size,
		"height_scale": height_scale,
		"seed": seed,
		"frequency": frequency,
		"octaves": octaves,
		"ensure_unique_name": ensure_unique,
		"center": center,
	})

func _rename_node(params: Dictionary) -> Dictionary:
	var node_path = str(params.get("node_path", params.get("nodePath", params.get("path", ""))))
	var new_name = str(params.get("new_name", params.get("newName", ""))).strip_edges()
	var ensure_unique = bool(params.get("ensure_unique_name", params.get("ensureUniqueName", false)))
	if node_path.is_empty() or new_name.is_empty():
		return _resp_err("node_path and new_name are required")

	var root = _scene_root()
	if root == null:
		return _resp_err("No edited scene")

	var node = _find_node(node_path)
	if node == null:
		return _resp_err("Node not found", { "node_path": node_path })

	var parent := node.get_parent()
	if ensure_unique and parent != null:
		var existing = parent.get_node_or_null(new_name)
		if existing != null and existing != node:
			new_name = _unique_child_name(parent, new_name)

	var old_name := str(node.name)
	if old_name == new_name:
		return _resp_ok({
			"renamed": true,
			"unchanged": true,
			"node_path": _node_path_str(node),
			"name": new_name,
			"ensure_unique_name": ensure_unique,
		})

	var planned_path := "root"
	if node != root and parent != null:
		planned_path = _join_node_path(_node_path_str(parent), new_name)

	var auto_commit = _ensure_action("godot_mcp:rename_node")
	_undo.add_do_property(node, "name", new_name)
	_undo.add_undo_property(node, "name", old_name)
	_maybe_commit(auto_commit)

	var actual_path := _node_path_str(node)
	return _resp_ok({
		"renamed": true,
		"node_path": actual_path if auto_commit else planned_path,
		"old_name": old_name,
		"name": new_name,
		"ensure_unique_name": ensure_unique,
	})

func _move_node(params: Dictionary) -> Dictionary:
	var node_path = str(params.get("node_path", params.get("nodePath", params.get("path", ""))))
	var index_v = params.get("index", params.get("new_index", params.get("newIndex", null)))
	if node_path.is_empty() or index_v == null:
		return _resp_err("node_path and index are required")

	var root = _scene_root()
	if root == null:
		return _resp_err("No edited scene")

	var node = _find_node(node_path)
	if node == null:
		return _resp_err("Node not found", { "node_path": node_path })
	if node == root:
		return _resp_err("Cannot move scene root")

	var parent = node.get_parent()
	if parent == null:
		return _resp_err("Node has no parent", { "node_path": node_path })

	var old_index := node.get_index()
	var index := -1
	if typeof(index_v) == TYPE_INT:
		index = int(index_v)
	elif typeof(index_v) == TYPE_FLOAT:
		var f := float(index_v)
		if f == floor(f):
			index = int(f)
	elif typeof(index_v) == TYPE_STRING and str(index_v).is_valid_int():
		index = int(str(index_v))
	if index < 0:
		return _resp_err("index must be a non-negative integer")

	var max_index := parent.get_child_count() - 1
	index = clamp(index, 0, max_index)

	var auto_commit = _ensure_action("godot_mcp:move_node")
	_undo.add_do_method(parent, "move_child", node, index)
	_undo.add_undo_method(parent, "move_child", node, old_index)
	_maybe_commit(auto_commit)

	return _resp_ok({
		"moved": true,
		"node_path": node_path,
		"parent_path": _node_path_str(parent),
		"old_index": old_index,
		"index": index,
	})

func _create_simple_animation(params: Dictionary) -> Dictionary:
	var player_path = str(params.get("player_path", params.get("playerPath", "")))
	var animation_name = str(params.get("animation_name", params.get("animationName", params.get("animation", "")))).strip_edges()
	var node_path = str(params.get("node_path", params.get("nodePath", "")))
	var property = str(params.get("property", "")).strip_edges()
	var start_value = params.get("start_value", params.get("startValue", null))
	var end_value = params.get("end_value", params.get("endValue", null))
	var duration := float(_num(params.get("duration", 1.0), 1.0))
	var replace_existing := bool(params.get("replace_existing", params.get("replaceExisting", true)))

	if player_path.is_empty() or animation_name.is_empty() or node_path.is_empty() or property.is_empty():
		return _resp_err("player_path, animation_name, node_path and property are required")
	if end_value == null:
		return _resp_err("end_value is required")
	if duration <= 0.0:
		return _resp_err("duration must be > 0", { "duration": duration })

	var root = _scene_root()
	if root == null:
		return _resp_err("No edited scene")

	var player_node = _find_node(player_path)
	if player_node == null or not (player_node is AnimationPlayer):
		return _resp_err("player_path is not an AnimationPlayer", { "player_path": player_path })

	var target_node = _find_node(node_path)
	if target_node == null:
		return _resp_err("Target node not found", { "node_path": node_path })

	var expected := _prop_type(target_node, property)
	if expected == TYPE_NIL:
		return _resp_err("Property not found", { "property": property, "node_path": node_path })

	var current = target_node.get(property)
	if current == null and start_value == null:
		return _resp_err("Property is null; provide start_value", { "property": property })

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
	var created_lib := false
	if lib == null:
		lib = AnimationLibrary.new()
		created_lib = true

	var replaced := false
	var old_anim = null
	if not created_lib and lib.has_animation(animation_name):
		replaced = true
		if not replace_existing:
			return _resp_err("Animation already exists", { "animation": animation_name })
		old_anim = lib.get_animation(animation_name)

	var auto_commit = _ensure_action("godot_mcp:create_simple_animation")
	_undo.force_fixed_history()
	_undo.add_do_reference(anim)

	if created_lib:
		_undo.add_do_reference(lib)
		_undo.add_do_method(player, "add_animation_library", "", lib)
		_undo.add_undo_method(player, "remove_animation_library", "")

	if replaced:
		_undo.add_undo_reference(old_anim)
		_undo.add_do_method(lib, "remove_animation", animation_name)
		_undo.add_do_method(lib, "add_animation", animation_name, anim)
		_undo.add_undo_method(lib, "remove_animation", animation_name)
		_undo.add_undo_method(lib, "add_animation", animation_name, old_anim)
	else:
		_undo.add_do_method(lib, "add_animation", animation_name, anim)
		_undo.add_undo_method(lib, "remove_animation", animation_name)

	_maybe_commit(auto_commit)

	return _resp_ok({
		"created": true,
		"player_path": player_path,
		"animation": animation_name,
		"node_path": node_path,
		"property": property,
		"duration": duration,
		"replace_existing": replace_existing,
		"library_created": created_lib,
		"replaced": replaced,
	})

func _set_shader_param(params: Dictionary) -> Dictionary:
	var node_path = str(params.get("node_path", params.get("nodePath", params.get("path", ""))))
	var param_name = str(params.get("param", params.get("parameter", ""))).strip_edges()
	var value = params.get("value", null)
	var material_property = str(params.get("material_property", params.get("materialProperty", ""))).strip_edges()
	var surface_index := int(_num(params.get("surface_index", params.get("surfaceIndex", 0)), 0.0))

	if node_path.is_empty() or param_name.is_empty():
		return _resp_err("node_path and param are required")

	var root = _scene_root()
	if root == null:
		return _resp_err("No edited scene")

	var node = _find_node(node_path)
	if node == null:
		return _resp_err("Node not found", { "node_path": node_path })

	var mat = null

	# Try explicit material property first (if provided).
	if not material_property.is_empty():
		mat = node.get(material_property)

	# Fallback order: material_override -> material -> surface override.
	if mat == null:
		if "material_override" in node and node.material_override:
			mat = node.material_override
			material_property = "material_override"
		elif "material" in node and node.material:
			mat = node.material
			material_property = "material"
		elif node.has_method("get_surface_override_material"):
			mat = node.call("get_surface_override_material", surface_index)
			material_property = "surface_override_material"

	if mat == null:
		return _resp_err("No material found on node", { "node_path": node_path, "surface_index": surface_index })

	if not (mat is ShaderMaterial):
		return _resp_err("Material is not a ShaderMaterial", { "material_class": mat.get_class(), "node_path": node_path })

	(mat as ShaderMaterial).set_shader_parameter(param_name, _json_to_variant(value))
	return _resp_ok({
		"set": true,
		"node_path": node_path,
		"param": param_name,
		"material_property": material_property,
		"surface_index": surface_index,
	})

func _remove_node(params: Dictionary) -> Dictionary:
	var node_path = str(params.get("node_path", params.get("nodePath", "")))
	if node_path.is_empty():
		return _resp_err("node_path is required")

	var root = _scene_root()
	if root == null:
		return _resp_err("No edited scene")

	var node = _find_node(node_path)
	if node == null:
		return _resp_err("Node not found", { "node_path": node_path })
	if node == root:
		return _resp_err("Cannot remove scene root")

	var parent = node.get_parent()
	var idx = node.get_index()

	var auto_commit = _ensure_action("godot_mcp:remove_node")
	_undo.add_undo_reference(node)
	_undo.add_do_method(parent, "remove_child", node)
	_undo.add_undo_method(parent, "add_child", node)
	_undo.add_undo_method(parent, "move_child", node, idx)
	_undo.add_undo_property(node, "owner", root)
	_maybe_commit(auto_commit)

	return _resp_ok({
		"removed": true,
		"node_path": node_path,
		"instance_id": node.get_instance_id(),
		"instance_id_str": str(node.get_instance_id()),
		"unique_name_in_owner": _is_unique_name_in_owner(node),
		"unique_name": _unique_name_str(node),
	})

func _duplicate_node(params: Dictionary) -> Dictionary:
	var node_path = str(params.get("node_path", params.get("nodePath", "")))
	var new_name = str(params.get("new_name", params.get("newName", "")))
	if node_path.is_empty():
		return _resp_err("node_path is required")

	var root = _scene_root()
	if root == null:
		return _resp_err("No edited scene")

	var node = _find_node(node_path)
	if node == null:
		return _resp_err("Node not found", { "node_path": node_path })
	if node == root:
		return _resp_err("Cannot duplicate scene root")

	var parent = node.get_parent()
	if parent == null:
		return _resp_err("Node has no parent", { "node_path": node_path })

	var dup = node.duplicate()
	if dup == null or not (dup is Node):
		return _resp_err("duplicate failed", { "node_path": node_path })

	var desired := new_name.strip_edges()
	if desired.is_empty():
		desired = str(node.name) + "_copy"
	var final_name := _unique_child_name(parent, desired)
	(dup as Node).name = final_name

	var auto_commit = _ensure_action("godot_mcp:duplicate_node")
	_undo.force_fixed_history()
	_undo.add_do_reference(dup)
	_undo.add_do_method(parent, "add_child", dup)
	_undo.force_fixed_history()
	_undo.add_do_property(dup, "owner", root)
	_undo.add_undo_method(parent, "remove_child", dup)
	_maybe_commit(auto_commit)

	var parent_path := _node_path_str(parent)
	var planned_path := _join_node_path(parent_path, final_name)
	var actual_path := _node_path_str(dup as Node)
	return _resp_ok({
		"duplicated": true,
		"original": _node_info(node),
		"duplicate": {
			"name": final_name,
			"node_path": actual_path if not actual_path.is_empty() else planned_path,
			"instance_id": (dup as Node).get_instance_id(),
			"instance_id_str": str((dup as Node).get_instance_id()),
			"unique_name_in_owner": _is_unique_name_in_owner(dup as Node),
			"unique_name": _unique_name_str(dup as Node),
		},
	})

func _reparent_node(params: Dictionary) -> Dictionary:
	var node_path = str(params.get("node_path", params.get("nodePath", "")))
	var new_parent_path = str(params.get("new_parent_path", params.get("newParentPath", "")))
	var index_v = params.get("index", params.get("new_index", params.get("newIndex", null)))
	if node_path.is_empty() or new_parent_path.is_empty():
		return _resp_err("node_path and new_parent_path are required")

	var root = _scene_root()
	if root == null:
		return _resp_err("No edited scene")

	var node = _find_node(node_path)
	if node == null:
		return _resp_err("Node not found", { "node_path": node_path })
	if node == root:
		return _resp_err("Cannot reparent scene root")

	var old_parent = node.get_parent()
	if old_parent == null:
		return _resp_err("Node has no parent", { "node_path": node_path })

	var new_parent = _find_node(new_parent_path)
	if new_parent == null:
		return _resp_err("New parent not found", { "new_parent_path": new_parent_path })

	var old_index = node.get_index()
	var old_owner = node.owner

	var index := -1
	if typeof(index_v) == TYPE_INT:
		index = int(index_v)
	elif typeof(index_v) == TYPE_FLOAT:
		var f := float(index_v)
		if f == floor(f):
			index = int(f)
	elif typeof(index_v) == TYPE_STRING and str(index_v).is_valid_int():
		index = int(str(index_v))

	var auto_commit = _ensure_action("godot_mcp:reparent_node")
	_undo.add_do_method(old_parent, "remove_child", node)
	_undo.add_do_method(new_parent, "add_child", node)
	if index >= 0:
		_undo.add_do_method(new_parent, "move_child", node, index)
	_undo.add_do_property(node, "owner", root)

	_undo.add_undo_method(new_parent, "remove_child", node)
	_undo.add_undo_method(old_parent, "add_child", node)
	_undo.add_undo_method(old_parent, "move_child", node, old_index)
	_undo.add_undo_property(node, "owner", old_owner)
	_maybe_commit(auto_commit)

	var new_parent_resolved := _node_path_str(new_parent)
	var planned_path := _join_node_path(new_parent_resolved, str(node.name))
	var actual_path := _node_path_str(node)
	return _resp_ok({
		"reparented": true,
		"node": {
			"node_path": actual_path if not actual_path.is_empty() else planned_path,
			"instance_id": node.get_instance_id(),
			"instance_id_str": str(node.get_instance_id()),
			"unique_name_in_owner": _is_unique_name_in_owner(node),
			"name": node.name,
			"class": node.get_class(),
			"unique_name": _unique_name_str(node),
		},
		"old_parent_path": _node_path_str(old_parent),
		"new_parent_path": new_parent_resolved,
		"old_index": old_index,
		"new_index": index,
	})

func _instance_scene(params: Dictionary) -> Dictionary:
	var scene_path = str(params.get("scene_path", params.get("scenePath", "")))
	var parent_path = str(params.get("parent_path", params.get("parentPath", "root")))
	var node_name = str(params.get("name", params.get("node_name", params.get("nodeName", ""))))
	var props_v = params.get("props", params.get("properties", {}))
	var props: Dictionary = props_v if typeof(props_v) == TYPE_DICTIONARY else {}
	if scene_path.strip_edges().is_empty():
		return _resp_err("scene_path is required")

	var root = _scene_root()
	if root == null:
		return _resp_err("No edited scene")

	var res_path := _to_res_path(scene_path)
	if res_path.is_empty():
		return _resp_err("Invalid scene_path (must be res:// or inside project root)", { "scene_path": scene_path })

	var packed = load(res_path)
	if packed == null or not (packed is PackedScene):
		return _resp_err("Not a PackedScene", { "scene_path": res_path })

	var inst = (packed as PackedScene).instantiate()
	if inst == null or not (inst is Node):
		return _resp_err("Failed to instantiate PackedScene", { "scene_path": res_path })

	var parent = _find_node(parent_path)
	if parent == null:
		return _resp_err("Parent node not found", { "parent_path": parent_path })

	var ensure_unique := bool(params.get("ensure_unique_name", params.get("ensureUniqueName", true)))
	var desired := node_name.strip_edges()
	if desired.is_empty():
		desired = res_path.get_file().get_basename()
	var final_name := desired
	if ensure_unique:
		final_name = _unique_child_name(parent, desired)
	(inst as Node).name = final_name

	for k in props.keys():
		var prop_name := str(k)
		var expected := _prop_type(inst as Node, prop_name)
		(inst as Node).set(prop_name, _json_to_variant_for_type(props[k], expected))

	var auto_commit = _ensure_action("godot_mcp:instance_scene")
	_undo.force_fixed_history()
	_undo.add_do_reference(inst)
	_undo.add_do_method(parent, "add_child", inst)
	_undo.force_fixed_history()
	_undo.add_do_property(inst, "owner", root)
	_undo.add_undo_method(parent, "remove_child", inst)
	_maybe_commit(auto_commit)

	var parent_resolved := _node_path_str(parent)
	var planned_path := _join_node_path(parent_resolved, final_name)
	var actual_path := _node_path_str(inst as Node)
	return _resp_ok({
		"instanced": true,
		"scene_path": res_path,
		"node": {
			"node_path": actual_path if not actual_path.is_empty() else planned_path,
			"instance_id": (inst as Node).get_instance_id(),
			"instance_id_str": str((inst as Node).get_instance_id()),
			"unique_name_in_owner": _is_unique_name_in_owner(inst as Node),
			"name": final_name,
			"class": (inst as Node).get_class(),
			"unique_name": _unique_name_str(inst as Node),
			"ensure_unique_name": ensure_unique,
		},
	})

func _set_property(params: Dictionary) -> Dictionary:
	var node_path = str(params.get("node_path", params.get("nodePath", "")))
	var prop = str(params.get("property", ""))
	if node_path.is_empty() or prop.is_empty():
		return _resp_err("node_path and property are required")

	var node = _find_node(node_path)
	if node == null:
		return _resp_err("Node not found", { "node_path": node_path })

	var old_value = node.get(prop)
	var expected := _prop_type(node, prop)
	var new_value = _json_to_variant_for_type(params.get("value", null), expected)

	var auto_commit = _ensure_action("godot_mcp:set_property")
	_undo.add_do_method(node, "set", prop, new_value)
	_undo.add_undo_method(node, "set", prop, old_value)
	_maybe_commit(auto_commit)

	return _resp_ok({
		"set": true,
		"node_path": node_path,
		"instance_id": node.get_instance_id(),
		"instance_id_str": str(node.get_instance_id()),
		"unique_name_in_owner": _is_unique_name_in_owner(node),
		"unique_name": _unique_name_str(node),
		"property": prop,
	})

func _get_property(params: Dictionary) -> Dictionary:
	var node_path = str(params.get("node_path", params.get("nodePath", "")))
	var prop = str(params.get("property", ""))
	if node_path.is_empty() or prop.is_empty():
		return _resp_err("node_path and property are required")

	var node = _find_node(node_path)
	if node == null:
		return _resp_err("Node not found", { "node_path": node_path })

	return _resp_ok({
		"node_path": node_path,
		"instance_id": node.get_instance_id(),
		"instance_id_str": str(node.get_instance_id()),
		"unique_name_in_owner": _is_unique_name_in_owner(node),
		"unique_name": _unique_name_str(node),
		"value": _variant_to_json(node.get(prop)),
	})

func _connect_signal(params: Dictionary) -> Dictionary:
	var from_path = str(params.get("from_node_path", params.get("fromNodePath", "")))
	var to_path = str(params.get("to_node_path", params.get("toNodePath", "")))
	var signal_name_s = str(params.get("signal", ""))
	var method_s = str(params.get("method", ""))
	if from_path.is_empty() or to_path.is_empty() or signal_name_s.is_empty() or method_s.is_empty():
		return _resp_err("from_node_path, signal, to_node_path, method are required")

	var from_node = _find_node(from_path)
	var to_node = _find_node(to_path)
	if from_node == null:
		return _resp_err("from_node not found", { "from_node_path": from_path })
	if to_node == null:
		return _resp_err("to_node not found", { "to_node_path": to_path })

	var signal_name = StringName(signal_name_s)
	var method_name = StringName(method_s)
	var callable = Callable(to_node, method_name)

	if from_node.is_connected(signal_name, callable):
		return _resp_ok({ "connected": false, "already_connected": true })

	var auto_commit = _ensure_action("godot_mcp:connect_signal")
	_undo.add_do_method(from_node, "connect", signal_name, callable, Object.CONNECT_PERSIST)
	_undo.add_undo_method(from_node, "disconnect", signal_name, callable)
	_maybe_commit(auto_commit)

	return _resp_ok({
		"connected": true,
		"signal": signal_name_s,
		"from_node_path": from_path,
		"to_node_path": to_path,
	})

func _disconnect_signal(params: Dictionary) -> Dictionary:
	var from_path = str(params.get("from_node_path", params.get("fromNodePath", "")))
	var to_path = str(params.get("to_node_path", params.get("toNodePath", "")))
	var signal_name_s = str(params.get("signal", ""))
	var method_s = str(params.get("method", ""))
	if from_path.is_empty() or to_path.is_empty() or signal_name_s.is_empty() or method_s.is_empty():
		return _resp_err("from_node_path, signal, to_node_path, method are required")

	var from_node = _find_node(from_path)
	var to_node = _find_node(to_path)
	if from_node == null:
		return _resp_err("from_node not found", { "from_node_path": from_path })
	if to_node == null:
		return _resp_err("to_node not found", { "to_node_path": to_path })

	var signal_name = StringName(signal_name_s)
	var method_name = StringName(method_s)
	var callable = Callable(to_node, method_name)

	if not from_node.is_connected(signal_name, callable):
		return _resp_ok({ "disconnected": false, "already_disconnected": true, "signal": signal_name_s })

	var auto_commit = _ensure_action("godot_mcp:disconnect_signal")
	_undo.add_do_method(from_node, "disconnect", signal_name, callable)
	_undo.add_undo_method(from_node, "connect", signal_name, callable, Object.CONNECT_PERSIST)
	_maybe_commit(auto_commit)

	return _resp_ok({ "disconnected": true, "signal": signal_name_s })

func _filesystem_scan() -> Dictionary:
	var fs = _ei.get_resource_filesystem()
	if fs == null:
		return _resp_err("EditorFileSystem not available")
	fs.scan()
	return _resp_ok({ "requested": true })

func _filesystem_reimport_files(params: Dictionary) -> Dictionary:
	var fs = _ei.get_resource_filesystem()
	if fs == null:
		return _resp_err("EditorFileSystem not available")

	var files_v = params.get("files", params.get("paths", []))
	var files: Array = files_v if typeof(files_v) == TYPE_ARRAY else []
	if files.is_empty():
		return _resp_err("files is required (array of res:// paths)")

	var res_files = PackedStringArray()
	for f in files:
		if typeof(f) != TYPE_STRING:
			continue
		var rp = _to_res_path(str(f))
		if rp.is_empty():
			return _resp_err("Invalid path (must be res:// or inside project root)", { "path": str(f) })
		res_files.append(rp)

	fs.reimport_files(res_files)
	return _resp_ok({ "requested": true, "count": res_files.size(), "files": res_files })

func _blocked_target(target_type: String, target_id: String) -> bool:
	if target_type != "singleton":
		return false
	var id = target_id.to_lower()
	return id == "os" or id == "projectsettings" or id == "fileaccess"

func _generic_call(params: Dictionary) -> Dictionary:
	var target_type = str(params.get("target_type", params.get("targetType", "")))
	var target_id = params.get("target_id", params.get("targetId", ""))
	var method = str(params.get("method", ""))
	var args_v = params.get("args", [])
	var args: Array = args_v if typeof(args_v) == TYPE_ARRAY else []

	if target_type.is_empty() or method.is_empty():
		return _resp_err("target_type and method are required")

	if _blocked_target(target_type, str(target_id)) and not _dangerous_allowed():
		return _resp_err("Dangerous RPC blocked. Set ALLOW_DANGEROUS_OPS=true to allow OS/FileAccess/ProjectSettings access.", { "target_type": target_type, "target_id": target_id, "method": method })

	var target = _get_target_object(target_type, target_id, params)
	if target == null:
		return _resp_err("Target not found", { "target_type": target_type, "target_id": target_id })
	if not target.has_method(method):
		return _resp_err("Target has no method", { "method": method })

	var normalized_args: Array = []
	for a in args:
		normalized_args.append(_json_to_variant(a))
	var result = target.callv(method, normalized_args)
	return _resp_ok({ "result": _variant_to_json(result) })

func _generic_set(params: Dictionary) -> Dictionary:
	var target_type = str(params.get("target_type", params.get("targetType", "")))
	var target_id = params.get("target_id", params.get("targetId", ""))
	var prop = str(params.get("property", ""))
	if target_type.is_empty() or prop.is_empty():
		return _resp_err("target_type and property are required")

	if _blocked_target(target_type, str(target_id)) and not _dangerous_allowed():
		return _resp_err("Dangerous RPC blocked. Set ALLOW_DANGEROUS_OPS=true to allow OS/FileAccess/ProjectSettings access.", { "target_type": target_type, "target_id": target_id, "property": prop })

	var target = _get_target_object(target_type, target_id, params)
	if target == null:
		return _resp_err("Target not found", { "target_type": target_type, "target_id": target_id })

	var expected := _prop_type(target, prop)
	target.set(prop, _json_to_variant_for_type(params.get("value", null), expected))
	return _resp_ok({ "set": true })

func _generic_get(params: Dictionary) -> Dictionary:
	var target_type = str(params.get("target_type", params.get("targetType", "")))
	var target_id = params.get("target_id", params.get("targetId", ""))
	var prop = str(params.get("property", ""))
	if target_type.is_empty() or prop.is_empty():
		return _resp_err("target_type and property are required")

	if _blocked_target(target_type, str(target_id)) and not _dangerous_allowed():
		return _resp_err("Dangerous RPC blocked. Set ALLOW_DANGEROUS_OPS=true to allow OS/FileAccess/ProjectSettings access.", { "target_type": target_type, "target_id": target_id, "property": prop })

	var target = _get_target_object(target_type, target_id, params)
	if target == null:
		return _resp_err("Target not found", { "target_type": target_type, "target_id": target_id })

	return _resp_ok({ "value": _variant_to_json(target.get(prop)) })

func _inspect_class(params: Dictionary) -> Dictionary:
	var class_name_value = str(params.get("class_name", params.get("className", "")))
	if class_name_value.is_empty():
		return _resp_err("class_name is required")

	if not ClassDB.class_exists(class_name_value):
		return _resp_err(
			"Class not found in ClassDB. Script-defined global classes (class_name) are not always available via ClassDB.",
			{ "class_name": class_name_value, "suggestions": ["Use inspect_object on an instance instead."] }
		)

	return _resp_ok({
		"class_name": class_name_value,
		"methods": ClassDB.class_get_method_list(class_name_value),
		"properties": ClassDB.class_get_property_list(class_name_value),
		"signals": ClassDB.class_get_signal_list(class_name_value),
	})

func _inspect_object(params: Dictionary) -> Dictionary:
	var node_id = str(params.get("node_path", params.get("nodePath", params.get("node_id", params.get("nodeId", "")))))
	var instance_id = _get_instance_id(params, ["instance_id", "instanceId"])
	var props_v = params.get("property_names", params.get("propertyNames", params.get("properties", [])))
	var prop_names: Array = props_v if typeof(props_v) == TYPE_ARRAY else []
	if node_id.is_empty() and instance_id == 0:
		return _resp_err("node_path (or instance_id) is required")

	var node: Node = null
	if instance_id != 0:
		var inst = instance_from_id(instance_id)
		if inst != null and inst is Node:
			node = inst as Node
	if node == null and not node_id.is_empty():
		node = _find_node(node_id)
	if node == null:
		return _resp_err("Node not found", { "node_id": node_id, "instance_id": instance_id })

	var property_values: Dictionary = {}
	if prop_names.size() > 0:
		for p in prop_names:
			if typeof(p) != TYPE_STRING:
				continue
			var key := str(p)
			if key.strip_edges().is_empty():
				continue
			property_values[key] = _variant_to_json(node.get(key))

	return _resp_ok({
		"node_id": node_id,
		"instance_id": node.get_instance_id(),
		"instance_id_str": str(node.get_instance_id()),
		"unique_name_in_owner": _is_unique_name_in_owner(node),
		"class": node.get_class(),
		"name": node.name,
		"node_path": _node_path_str(node),
		"unique_name": _unique_name_str(node),
		"properties": node.get_property_list(),
		"methods": node.get_method_list(),
		"signals": node.get_signal_list(),
		"property_values": property_values,
	})

func _selection_select_node(params: Dictionary) -> Dictionary:
	var node_id = str(params.get("node_path", params.get("nodePath", params.get("node_id", params.get("nodeId", "")))))
	var instance_id = _get_instance_id(params, ["instance_id", "instanceId"])
	var additive_v = params.get("additive", false)
	var additive := bool(additive_v)

	if node_id.is_empty() and instance_id == 0:
		return _resp_err("node_path (or instance_id) is required")

	var node: Node = null
	if instance_id != 0:
		var inst = instance_from_id(instance_id)
		if inst != null and inst is Node:
			node = inst as Node
	if node == null and not node_id.is_empty():
		node = _find_node(node_id)
	if node == null:
		return _resp_err("Node not found", { "node_id": node_id, "instance_id": instance_id })

	var sel = _ei.get_selection()
	if sel == null:
		return _resp_err("EditorSelection not available")

	if not additive and sel.has_method("clear"):
		sel.clear()
	if sel.has_method("add_node"):
		sel.add_node(node)
	if _ei.has_method("edit_node"):
		_ei.edit_node(node)

	var selected_nodes: Array = []
	if sel.has_method("get_selected_nodes"):
		selected_nodes = sel.get_selected_nodes()
	var out: Array = []
	for n in selected_nodes:
		if n is Node:
			out.append(_node_info(n as Node))

	return _resp_ok({
		"selected": true,
		"additive": additive,
		"node": _node_info(node),
		"selection": out,
	})

func _selection_clear() -> Dictionary:
	var sel = _ei.get_selection()
	if sel == null:
		return _resp_err("EditorSelection not available")
	if sel.has_method("clear"):
		sel.clear()
	return _resp_ok({ "cleared": true })

func _selection_get() -> Dictionary:
	var sel = _ei.get_selection()
	if sel == null:
		return _resp_err("EditorSelection not available")

	var selected_nodes: Array = []
	if sel.has_method("get_selected_nodes"):
		selected_nodes = sel.get_selected_nodes()
	var out: Array = []
	for n in selected_nodes:
		if n is Node:
			out.append(_node_info(n as Node))

	return _resp_ok({
		"count": out.size(),
		"selection": out,
	})

func _scene_tree_query(params: Dictionary) -> Dictionary:
	var root = _scene_root()
	if root == null:
		return _resp_err("No edited scene")

	var include_root_v = params.get("include_root", params.get("includeRoot", false))
	var include_root := bool(include_root_v)
	var name_exact = str(params.get("name", ""))
	var name_contains = str(params.get("name_contains", params.get("nameContains", "")))
	var class_name_value = str(params.get("class_name", params.get("className", "")))
	var group = str(params.get("group", ""))
	var limit_v = params.get("limit", params.get("max_results", params.get("maxResults", 50)))
	var limit := 50
	if typeof(limit_v) == TYPE_INT:
		limit = max(1, int(limit_v))
	elif typeof(limit_v) == TYPE_FLOAT:
		var f := float(limit_v)
		if f == floor(f):
			limit = max(1, int(f))
	elif typeof(limit_v) == TYPE_STRING and str(limit_v).is_valid_int():
		limit = max(1, int(str(limit_v)))

	var matches: Array = []
	var stack: Array = [root]
	while stack.size() > 0:
		var n = stack.pop_back()
		if not (n is Node):
			continue
		var node: Node = n as Node

		var should_check := include_root or node != root
		if should_check:
			if not name_exact.strip_edges().is_empty() and str(node.name) != name_exact:
				pass
			elif not name_contains.strip_edges().is_empty() and str(node.name).find(name_contains) == -1:
				pass
			elif not class_name_value.strip_edges().is_empty() and not node.is_class(class_name_value):
				pass
			elif not group.strip_edges().is_empty():
				var g := group.strip_edges()
				var in_group := node.is_in_group(g)
				if not in_group:
					var groups = node.get_groups()
					if typeof(groups) == TYPE_ARRAY:
						for gg in groups:
							if str(gg) == g:
								in_group = true
								break
				if not in_group:
					pass
			else:
				matches.append(_node_info(node))
				if matches.size() >= limit:
					break

		for c in node.get_children():
			if c is Node:
				stack.append(c)

	return _resp_ok({ "count": matches.size(), "nodes": matches })
