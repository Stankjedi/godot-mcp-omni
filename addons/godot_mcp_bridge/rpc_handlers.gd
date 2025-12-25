extends RefCounted

const PLUGIN_VERSION := "0.2.0"
const JSON_TYPE_KEY := "$type"

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
			"open_scene",
			"save_scene",
			"get_current_scene",
			"list_open_scenes",
			"begin_action",
			"commit_action",
			"abort_action",
			"add_node",
			"remove_node",
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
		"add_node":
			return _add_node(params)
		"remove_node":
			return _remove_node(params)
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
		"selection.clear":
			return _selection_clear()
		"scene_tree.query":
			return _scene_tree_query(params)
		"filesystem.scan":
			return _filesystem_scan()
		"filesystem.reimport_files":
			return _filesystem_reimport_files(params)
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

func _variant_to_json(value):
	match typeof(value):
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING:
			return value
		TYPE_STRING_NAME:
			return String(value)
		TYPE_NODE_PATH:
			return String(value)
		TYPE_VECTOR2:
			var v2: Vector2 = value
			return { JSON_TYPE_KEY: "Vector2", "x": v2.x, "y": v2.y }
		TYPE_VECTOR3:
			var v3: Vector3 = value
			return { JSON_TYPE_KEY: "Vector3", "x": v3.x, "y": v3.y, "z": v3.z }
		TYPE_COLOR:
			var c: Color = value
			return { JSON_TYPE_KEY: "Color", "r": c.r, "g": c.g, "b": c.b, "a": c.a }
		TYPE_RECT2:
			var r: Rect2 = value
			return { JSON_TYPE_KEY: "Rect2", "x": r.position.x, "y": r.position.y, "w": r.size.x, "h": r.size.y }
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
				out[String(k)] = _variant_to_json(value[k])
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
			var s := String(v).strip_edges()
			if s.is_valid_float():
				return float(s)
			if s.is_valid_int():
				return float(int(s))
	return fallback

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
					"Vector3":
						return Vector3(_num(d.get("x")), _num(d.get("y")), _num(d.get("z")))
					"Color":
						return Color(_num(d.get("r")), _num(d.get("g")), _num(d.get("b")), _num(d.get("a"), 1.0))
					"Rect2":
						return Rect2(_num(d.get("x")), _num(d.get("y")), _num(d.get("w")), _num(d.get("h")))
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
				out_d[String(k)] = _json_to_variant(d[k])
			return out_d
		_:
			return value

func _dangerous_allowed() -> bool:
	return String(OS.get_environment("ALLOW_DANGEROUS_OPS")).strip_edges() == "true"

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
	return String(root.get_path_to(node))

func _unique_name_str(node: Node) -> String:
	if _is_unique_name_in_owner(node):
		return "%" + String(node.name)
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
		if typeof(v) == TYPE_STRING:
			var s = String(v)
			if s.is_valid_int():
				return int(s)
	return 0

func _resolve_target(target_type: String, target_id, params: Dictionary) -> Dictionary:
	var tt = target_type.strip_edges()
	if tt.is_empty():
		return _resp_err("target_type is required")

	if tt == "singleton":
		var id = String(target_id)
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
				return _resp_ok({ "resolved": true, "target_type": tt, "instance_id": node_instance_id })
		var node_id = String(target_id)
		var node = _find_node(node_id)
		if node == null:
			return _resp_err("Node not found", { "node_id": node_id })
		return _resp_ok({ "resolved": true, "target_type": tt, "node_id": node_id })

	if tt == "resource":
		var res_instance_id = _get_instance_id(params, ["instance_id", "instanceId"])
		if res_instance_id != 0:
			var inst2 = instance_from_id(res_instance_id)
			if inst2 != null and inst2 is Resource:
				return _resp_ok({ "resolved": true, "target_type": tt, "instance_id": res_instance_id })
		var res_id = String(target_id)
		if res_id.is_empty():
			return _resp_err("resource target_id is required")
		return _resp_ok({ "resolved": true, "target_type": tt, "target_id": res_id })

	return _resp_err("Unknown target_type", { "target_type": tt })

func _get_target_object(target_type: String, target_id, params: Dictionary) -> Object:
	var tt = target_type.strip_edges()
	if tt == "singleton":
		var id = String(target_id)
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
		return _find_node(String(target_id))

	if tt == "resource":
		var res_instance_id = _get_instance_id(params, ["instance_id", "instanceId"])
		if res_instance_id != 0:
			var inst2 = instance_from_id(res_instance_id)
			if inst2 != null and inst2 is Resource:
				return inst2 as Resource
		return load(String(target_id))

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

func _open_scene(params: Dictionary) -> Dictionary:
	var p = String(params.get("path", ""))
	if p.is_empty():
		return _resp_err("path is required")

	var res_path = _to_res_path(p)
	if res_path.is_empty():
		return _resp_err("Invalid path (must be res:// or inside project root)", { "path": p })

	_ei.open_scene_from_path(res_path)
	return _resp_ok({ "requested_path": res_path })

func _save_scene(params: Dictionary) -> Dictionary:
	if params.has("path"):
		var p = String(params.get("path", ""))
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
	return _resp_ok({ "path": root.scene_file_path, "name": root.name, "class": root.get_class(), "instance_id": root.get_instance_id() })

func _list_open_scenes() -> Dictionary:
	var scenes = _ei.get_open_scenes()
	var out: Array = []
	for s in scenes:
		out.append(String(s))
	return _resp_ok({ "scenes": out })

func _begin_action(params: Dictionary) -> Dictionary:
	if _action_open:
		return _resp_err("An undo action is already open. Call commit_action first.")
	var name = String(params.get("name", params.get("action_name", "godot_mcp:batch")))
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
	if root != null:
		_undo.create_action(name, 0, root)
	else:
		_undo.create_action(name)

func _maybe_commit(auto_commit: bool) -> void:
	if auto_commit:
		_undo.commit_action()

func _add_node(params: Dictionary) -> Dictionary:
	var parent_path = String(params.get("parent_path", params.get("parentPath", "root")))
	var node_type = String(params.get("type", params.get("node_type", params.get("nodeType", ""))))
	var node_name = String(params.get("name", params.get("node_name", params.get("nodeName", ""))))
	var props_v = params.get("props", params.get("properties", {}))
	var props: Dictionary = props_v if typeof(props_v) == TYPE_DICTIONARY else {}

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

	(node as Node).name = node_name
	for k in props.keys():
		(node as Node).set(String(k), _json_to_variant(props[k]))

	var auto_commit = _ensure_action("godot_mcp:add_node")
	_undo.force_fixed_history()
	_undo.add_do_reference(node)
	_undo.add_do_method(parent, "add_child", node)
	_undo.force_fixed_history()
	_undo.add_do_property(node, "owner", root)
	_undo.add_undo_method(parent, "remove_child", node)
	_maybe_commit(auto_commit)

	var requested_path := _join_node_path(parent_path, node_name)
	var unique_name := ""
	if _is_unique_name_in_owner(node as Node):
		unique_name = "%" + String((node as Node).name)
	return _resp_ok({
		"added": true,
		"type": node_type,
		"name": node_name,
		"node_path": requested_path,
		"instance_id": (node as Node).get_instance_id(),
		"unique_name": unique_name,
	})

func _remove_node(params: Dictionary) -> Dictionary:
	var node_path = String(params.get("node_path", params.get("nodePath", "")))
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
		"unique_name": _unique_name_str(node),
	})

func _duplicate_node(params: Dictionary) -> Dictionary:
	var node_path = String(params.get("node_path", params.get("nodePath", "")))
	var new_name = String(params.get("new_name", params.get("newName", "")))
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
		desired = String(node.name) + "_copy"
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
			"unique_name": _unique_name_str(dup as Node),
		},
	})

func _reparent_node(params: Dictionary) -> Dictionary:
	var node_path = String(params.get("node_path", params.get("nodePath", "")))
	var new_parent_path = String(params.get("new_parent_path", params.get("newParentPath", "")))
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
	elif typeof(index_v) == TYPE_STRING and String(index_v).is_valid_int():
		index = int(String(index_v))

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
	var planned_path := _join_node_path(new_parent_resolved, String(node.name))
	var actual_path := _node_path_str(node)
	return _resp_ok({
		"reparented": true,
		"node": {
			"node_path": actual_path if not actual_path.is_empty() else planned_path,
			"instance_id": node.get_instance_id(),
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
	var scene_path = String(params.get("scene_path", params.get("scenePath", "")))
	var parent_path = String(params.get("parent_path", params.get("parentPath", "root")))
	var node_name = String(params.get("name", params.get("node_name", params.get("nodeName", ""))))
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

	var desired := node_name.strip_edges()
	if desired.is_empty():
		desired = res_path.get_file().get_basename()
	var final_name := _unique_child_name(parent, desired)
	(inst as Node).name = final_name

	for k in props.keys():
		(inst as Node).set(String(k), _json_to_variant(props[k]))

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
			"name": final_name,
			"class": (inst as Node).get_class(),
			"unique_name": _unique_name_str(inst as Node),
		},
	})

func _set_property(params: Dictionary) -> Dictionary:
	var node_path = String(params.get("node_path", params.get("nodePath", "")))
	var prop = String(params.get("property", ""))
	if node_path.is_empty() or prop.is_empty():
		return _resp_err("node_path and property are required")

	var node = _find_node(node_path)
	if node == null:
		return _resp_err("Node not found", { "node_path": node_path })

	var old_value = node.get(prop)
	var new_value = _json_to_variant(params.get("value", null))

	var auto_commit = _ensure_action("godot_mcp:set_property")
	_undo.add_do_method(node, "set", prop, new_value)
	_undo.add_undo_method(node, "set", prop, old_value)
	_maybe_commit(auto_commit)

	return _resp_ok({
		"set": true,
		"node_path": node_path,
		"instance_id": node.get_instance_id(),
		"unique_name": _unique_name_str(node),
		"property": prop,
	})

func _get_property(params: Dictionary) -> Dictionary:
	var node_path = String(params.get("node_path", params.get("nodePath", "")))
	var prop = String(params.get("property", ""))
	if node_path.is_empty() or prop.is_empty():
		return _resp_err("node_path and property are required")

	var node = _find_node(node_path)
	if node == null:
		return _resp_err("Node not found", { "node_path": node_path })

	return _resp_ok({
		"node_path": node_path,
		"instance_id": node.get_instance_id(),
		"unique_name": _unique_name_str(node),
		"value": _variant_to_json(node.get(prop)),
	})

func _connect_signal(params: Dictionary) -> Dictionary:
	var from_path = String(params.get("from_node_path", params.get("fromNodePath", "")))
	var to_path = String(params.get("to_node_path", params.get("toNodePath", "")))
	var signal_name_s = String(params.get("signal", ""))
	var method_s = String(params.get("method", ""))
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
	var from_path = String(params.get("from_node_path", params.get("fromNodePath", "")))
	var to_path = String(params.get("to_node_path", params.get("toNodePath", "")))
	var signal_name_s = String(params.get("signal", ""))
	var method_s = String(params.get("method", ""))
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
		var rp = _to_res_path(String(f))
		if rp.is_empty():
			return _resp_err("Invalid path (must be res:// or inside project root)", { "path": String(f) })
		res_files.append(rp)

	fs.reimport_files(res_files)
	return _resp_ok({ "requested": true, "count": res_files.size(), "files": res_files })

func _blocked_target(target_type: String, target_id: String) -> bool:
	if target_type != "singleton":
		return false
	var id = target_id.to_lower()
	return id == "os" or id == "projectsettings" or id == "fileaccess"

func _generic_call(params: Dictionary) -> Dictionary:
	var target_type = String(params.get("target_type", params.get("targetType", "")))
	var target_id = params.get("target_id", params.get("targetId", ""))
	var method = String(params.get("method", ""))
	var args_v = params.get("args", [])
	var args: Array = args_v if typeof(args_v) == TYPE_ARRAY else []

	if target_type.is_empty() or method.is_empty():
		return _resp_err("target_type and method are required")

	if _blocked_target(target_type, String(target_id)) and not _dangerous_allowed():
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
	var target_type = String(params.get("target_type", params.get("targetType", "")))
	var target_id = params.get("target_id", params.get("targetId", ""))
	var prop = String(params.get("property", ""))
	if target_type.is_empty() or prop.is_empty():
		return _resp_err("target_type and property are required")

	if _blocked_target(target_type, String(target_id)) and not _dangerous_allowed():
		return _resp_err("Dangerous RPC blocked. Set ALLOW_DANGEROUS_OPS=true to allow OS/FileAccess/ProjectSettings access.", { "target_type": target_type, "target_id": target_id, "property": prop })

	var target = _get_target_object(target_type, target_id, params)
	if target == null:
		return _resp_err("Target not found", { "target_type": target_type, "target_id": target_id })

	target.set(prop, _json_to_variant(params.get("value", null)))
	return _resp_ok({ "set": true })

func _generic_get(params: Dictionary) -> Dictionary:
	var target_type = String(params.get("target_type", params.get("targetType", "")))
	var target_id = params.get("target_id", params.get("targetId", ""))
	var prop = String(params.get("property", ""))
	if target_type.is_empty() or prop.is_empty():
		return _resp_err("target_type and property are required")

	if _blocked_target(target_type, String(target_id)) and not _dangerous_allowed():
		return _resp_err("Dangerous RPC blocked. Set ALLOW_DANGEROUS_OPS=true to allow OS/FileAccess/ProjectSettings access.", { "target_type": target_type, "target_id": target_id, "property": prop })

	var target = _get_target_object(target_type, target_id, params)
	if target == null:
		return _resp_err("Target not found", { "target_type": target_type, "target_id": target_id })

	return _resp_ok({ "value": _variant_to_json(target.get(prop)) })

func _inspect_class(params: Dictionary) -> Dictionary:
	var class_name_value = String(params.get("class_name", params.get("className", "")))
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
	var node_id = String(params.get("node_path", params.get("nodePath", params.get("node_id", params.get("nodeId", "")))))
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
			var key := String(p)
			if key.strip_edges().is_empty():
				continue
			property_values[key] = _variant_to_json(node.get(key))

	return _resp_ok({
		"node_id": node_id,
		"instance_id": node.get_instance_id(),
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
	var node_id = String(params.get("node_path", params.get("nodePath", params.get("node_id", params.get("nodeId", "")))))
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

func _scene_tree_query(params: Dictionary) -> Dictionary:
	var root = _scene_root()
	if root == null:
		return _resp_err("No edited scene")

	var include_root_v = params.get("include_root", params.get("includeRoot", false))
	var include_root := bool(include_root_v)
	var name_exact = String(params.get("name", ""))
	var name_contains = String(params.get("name_contains", params.get("nameContains", "")))
	var class_name_value = String(params.get("class_name", params.get("className", "")))
	var group = String(params.get("group", ""))
	var limit_v = params.get("limit", params.get("max_results", params.get("maxResults", 50)))
	var limit := 50
	if typeof(limit_v) == TYPE_INT:
		limit = max(1, int(limit_v))
	elif typeof(limit_v) == TYPE_STRING and String(limit_v).is_valid_int():
		limit = max(1, int(String(limit_v)))

	var matches: Array = []
	var stack: Array = [root]
	while stack.size() > 0:
		var n = stack.pop_back()
		if not (n is Node):
			continue
		var node: Node = n as Node

		var should_check := include_root or node != root
		if should_check:
			if not name_exact.strip_edges().is_empty() and String(node.name) != name_exact:
				pass
			elif not name_contains.strip_edges().is_empty() and String(node.name).find(name_contains) == -1:
				pass
			elif not class_name_value.strip_edges().is_empty() and not node.is_class(class_name_value):
				pass
			elif not group.strip_edges().is_empty() and not node.is_in_group(group):
				pass
			else:
				matches.append(_node_info(node))
				if matches.size() >= limit:
					break

		for c in node.get_children():
			if c is Node:
				stack.append(c)

	return _resp_ok({ "count": matches.size(), "nodes": matches })
