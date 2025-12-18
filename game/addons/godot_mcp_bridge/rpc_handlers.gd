@tool
extends RefCounted
class_name GodotMcpRpcHandlers

const PLUGIN_VERSION := "0.2.0"

var _plugin: EditorPlugin
var _ei: EditorInterface
var _undo: EditorUndoRedoManager

var _action_open := false

func _init(plugin: EditorPlugin, undo: EditorUndoRedoManager) -> void:
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
			"add_node",
			"remove_node",
			"set_property",
			"get_property",
			"connect_signal",
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
			return _commit_action()
		"add_node":
			return _add_node(params)
		"remove_node":
			return _remove_node(params)
		"set_property":
			return _set_property(params)
		"get_property":
			return _get_property(params)
		"connect_signal":
			return _connect_signal(params)
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

func _resp_ok(result: Variant) -> Dictionary:
	return { "ok": true, "result": _variant_to_json(result) }

func _resp_err(message: String, details: Dictionary = {}) -> Dictionary:
	return { "ok": false, "error": { "message": message, "details": details } }

func _variant_to_json(value: Variant) -> Variant:
	match typeof(value):
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING:
			return value
		TYPE_STRING_NAME:
			return String(value)
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

func _dangerous_allowed() -> bool:
	return String(OS.get_environment("ALLOW_DANGEROUS_OPS")).strip_edges() == "true"

func _project_root_abs() -> String:
	var p := ProjectSettings.globalize_path("res://")
	return p.replace("\\", "/")

func _normalize_abs_path(p: String) -> String:
	var n := p.replace("\\", "/")
	if OS.get_name() == "Windows":
		n = n.to_lower()
	return n

func _to_res_path(p: String) -> String:
	var s := p.strip_edges()
	if s.is_empty():
		return ""
	if s.begins_with("res://"):
		return s
	if s.begins_with("user://"):
		return ""

	# Absolute path inside project -> convert to res:// relative path.
	var root_abs := _normalize_abs_path(_project_root_abs()).rstrip("/")
	var abs := _normalize_abs_path(s)
	if abs.begins_with(root_abs + "/"):
		var rel := abs.substr(root_abs.length() + 1)
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
	var name := unique.strip_edges()
	if name.begins_with("%"):
		name = name.substr(1)
	if name.is_empty():
		return null

	# Fast path (Godot supports %Name in NodePath).
	var direct := root.get_node_or_null("%" + name)
	if direct != null:
		return direct

	# Fallback scan.
	var stack: Array = [root]
	while stack.size() > 0:
		var n := stack.pop_back()
		if n is Node:
			if (n as Node).name == name and _is_unique_name_in_owner(n as Node):
				return n as Node
			for c in (n as Node).get_children():
				if c is Node:
					stack.append(c)
	return null

func _find_node(node_id: String) -> Node:
	var root := _scene_root()
	if root == null:
		return null

	var p := node_id.strip_edges()
	if p.is_empty() or p == "root" or p == "/root":
		return root
	if p.begins_with("root/"):
		p = p.substr(5)
	elif p.begins_with("/root/"):
		p = p.substr(6)

	if p.begins_with("%"):
		return _find_node_by_unique_name(root, p)
	return root.get_node_or_null(p)

func _get_instance_id(params: Dictionary, keys: Array[String]) -> int:
	for k in keys:
		if not params.has(k):
			continue
		var v := params.get(k)
		if typeof(v) == TYPE_INT:
			return int(v)
		if typeof(v) == TYPE_STRING:
			var s := String(v)
			if s.is_valid_int():
				return int(s)
	return 0

func _resolve_target(target_type: String, target_id: Variant, params: Dictionary) -> Dictionary:
	var tt := target_type.strip_edges()
	if tt.is_empty():
		return _resp_err("target_type is required")

	if tt == "singleton":
		var id := String(target_id)
		if id == "EditorInterface":
			return _resp_ok({ "resolved": true, "target_type": tt, "target_id": id })
		if id == "EditorFileSystem":
			return _resp_ok({ "resolved": true, "target_type": tt, "target_id": id })
		if Engine.has_singleton(id):
			return _resp_ok({ "resolved": true, "target_type": tt, "target_id": id })
		return _resp_err("Singleton not found", { "target_id": id })

	if tt == "node":
		var node_instance_id := _get_instance_id(params, ["instance_id", "instanceId"])
		if node_instance_id != 0:
			var inst := instance_from_id(node_instance_id)
			if inst != null and inst is Node:
				return _resp_ok({ "resolved": true, "target_type": tt, "instance_id": node_instance_id })
		var node_id := String(target_id)
		var node := _find_node(node_id)
		if node == null:
			return _resp_err("Node not found", { "node_id": node_id })
		return _resp_ok({ "resolved": true, "target_type": tt, "node_id": node_id })

	if tt == "resource":
		var res_instance_id := _get_instance_id(params, ["instance_id", "instanceId"])
		if res_instance_id != 0:
			var inst2 := instance_from_id(res_instance_id)
			if inst2 != null and inst2 is Resource:
				return _resp_ok({ "resolved": true, "target_type": tt, "instance_id": res_instance_id })
		var res_id := String(target_id)
		if res_id.is_empty():
			return _resp_err("resource target_id is required")
		return _resp_ok({ "resolved": true, "target_type": tt, "target_id": res_id })

	return _resp_err("Unknown target_type", { "target_type": tt })

func _get_target_object(target_type: String, target_id: Variant, params: Dictionary) -> Object:
	var tt := target_type.strip_edges()
	if tt == "singleton":
		var id := String(target_id)
		if id == "EditorInterface":
			return _ei
		if id == "EditorFileSystem":
			return _ei.get_resource_filesystem()
		if Engine.has_singleton(id):
			return Engine.get_singleton(id)
		return null

	if tt == "node":
		var node_instance_id := _get_instance_id(params, ["instance_id", "instanceId"])
		if node_instance_id != 0:
			var inst := instance_from_id(node_instance_id)
			if inst != null and inst is Node:
				return inst as Node
		return _find_node(String(target_id))

	if tt == "resource":
		var res_instance_id := _get_instance_id(params, ["instance_id", "instanceId"])
		if res_instance_id != 0:
			var inst2 := instance_from_id(res_instance_id)
			if inst2 != null and inst2 is Resource:
				return inst2 as Resource
		return load(String(target_id))

	return null

func _ping() -> Dictionary:
	return _resp_ok({ "pong": true, "plugin_version": PLUGIN_VERSION })

func _health() -> Dictionary:
	var root := _scene_root()
	var open_scenes := _ei.get_open_scenes()
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
	var p := String(params.get("path", ""))
	if p.is_empty():
		return _resp_err("path is required")

	var res_path := _to_res_path(p)
	if res_path.is_empty():
		return _resp_err("Invalid path (must be res:// or inside project root)", { "path": p })

	_ei.open_scene_from_path(res_path)
	return _resp_ok({ "requested_path": res_path })

func _save_scene(params: Dictionary) -> Dictionary:
	if params.has("path"):
		var p := String(params.get("path", ""))
		if p.is_empty():
			return _resp_err("path must be a non-empty string")
		var res_path := _to_res_path(p)
		if res_path.is_empty():
			return _resp_err("Invalid path (must be res:// or inside project root)", { "path": p })
		_ei.save_scene_as(res_path)
		return _resp_ok({ "saved_as": res_path })

	var err := _ei.save_scene()
	if err != OK:
		return _resp_err("save_scene failed", { "error": err })
	return _resp_ok({ "saved": true })

func _get_current_scene() -> Dictionary:
	var root := _scene_root()
	if root == null:
		return _resp_err("No edited scene")
	return _resp_ok({ "path": root.scene_file_path, "name": root.name, "class": root.get_class(), "instance_id": root.get_instance_id() })

func _list_open_scenes() -> Dictionary:
	var scenes := _ei.get_open_scenes()
	var out: Array[String] = []
	for s in scenes:
		out.append(String(s))
	return _resp_ok({ "scenes": out })

func _begin_action(params: Dictionary) -> Dictionary:
	if _action_open:
		return _resp_err("An undo action is already open. Call commit_action first.")
	var name := String(params.get("name", params.get("action_name", "godot_mcp:batch")))
	if name.strip_edges().is_empty():
		return _resp_err("name is required")
	_undo.create_action(name)
	_action_open = true
	return _resp_ok({ "begun": true, "name": name })

func _commit_action() -> Dictionary:
	if not _action_open:
		return _resp_err("No open undo action. Call begin_action first.")
	_undo.commit_action()
	_action_open = false
	return _resp_ok({ "committed": true })

func _ensure_action(name: String) -> bool:
	if _action_open:
		return false
	_undo.create_action(name)
	return true

func _maybe_commit(auto_commit: bool) -> void:
	if auto_commit:
		_undo.commit_action()

func _add_node(params: Dictionary) -> Dictionary:
	var parent_path := String(params.get("parent_path", params.get("parentPath", "root")))
	var node_type := String(params.get("type", params.get("node_type", params.get("nodeType", ""))))
	var node_name := String(params.get("name", params.get("node_name", params.get("nodeName", ""))))
	var props_v := params.get("props", params.get("properties", {}))
	var props: Dictionary = props_v if typeof(props_v) == TYPE_DICTIONARY else {}

	var root := _scene_root()
	if root == null:
		return _resp_err("No edited scene")

	var parent := _find_node(parent_path)
	if parent == null:
		return _resp_err("Parent node not found", { "parent_path": parent_path })

	if node_type.is_empty():
		return _resp_err("type/node_type is required")
	if node_name.is_empty():
		return _resp_err("name/node_name is required")

	if not ClassDB.class_exists(node_type) or not ClassDB.can_instantiate(node_type):
		return _resp_err("Cannot instantiate type", { "type": node_type })

	var node := ClassDB.instantiate(node_type)
	if node == null or not (node is Node):
		return _resp_err("Instantiated object is not a Node", { "type": node_type })

	(node as Node).name = node_name
	for k in props.keys():
		(node as Node).set(String(k), props[k])

	var auto_commit := _ensure_action("godot_mcp:add_node")
	_undo.add_do_reference(node)
	_undo.add_do_method(parent, &"add_child", node)
	_undo.add_do_property(node, &"owner", root)
	_undo.add_undo_method(parent, &"remove_child", node)
	_maybe_commit(auto_commit)

	return _resp_ok({ "added": true, "type": node_type, "name": node_name, "instance_id": (node as Node).get_instance_id() })

func _remove_node(params: Dictionary) -> Dictionary:
	var node_path := String(params.get("node_path", params.get("nodePath", "")))
	if node_path.is_empty():
		return _resp_err("node_path is required")

	var root := _scene_root()
	if root == null:
		return _resp_err("No edited scene")

	var node := _find_node(node_path)
	if node == null:
		return _resp_err("Node not found", { "node_path": node_path })
	if node == root:
		return _resp_err("Cannot remove scene root")

	var parent := node.get_parent()
	var idx := node.get_index()

	var auto_commit := _ensure_action("godot_mcp:remove_node")
	_undo.add_undo_reference(node)
	_undo.add_do_method(parent, &"remove_child", node)
	_undo.add_undo_method(parent, &"add_child", node)
	_undo.add_undo_method(parent, &"move_child", node, idx)
	_undo.add_undo_property(node, &"owner", root)
	_maybe_commit(auto_commit)

	return _resp_ok({ "removed": true, "node_path": node_path })

func _set_property(params: Dictionary) -> Dictionary:
	var node_path := String(params.get("node_path", params.get("nodePath", "")))
	var prop := String(params.get("property", ""))
	if node_path.is_empty() or prop.is_empty():
		return _resp_err("node_path and property are required")

	var node := _find_node(node_path)
	if node == null:
		return _resp_err("Node not found", { "node_path": node_path })

	var old_value := node.get(prop)
	var new_value := params.get("value", null)

	var auto_commit := _ensure_action("godot_mcp:set_property")
	_undo.add_do_method(node, &"set", prop, new_value)
	_undo.add_undo_method(node, &"set", prop, old_value)
	_maybe_commit(auto_commit)

	return _resp_ok({ "set": true, "node_path": node_path, "property": prop })

func _get_property(params: Dictionary) -> Dictionary:
	var node_path := String(params.get("node_path", params.get("nodePath", "")))
	var prop := String(params.get("property", ""))
	if node_path.is_empty() or prop.is_empty():
		return _resp_err("node_path and property are required")

	var node := _find_node(node_path)
	if node == null:
		return _resp_err("Node not found", { "node_path": node_path })

	return _resp_ok({ "value": _variant_to_json(node.get(prop)) })

func _connect_signal(params: Dictionary) -> Dictionary:
	var from_path := String(params.get("from_node_path", params.get("fromNodePath", "")))
	var to_path := String(params.get("to_node_path", params.get("toNodePath", "")))
	var signal_name_s := String(params.get("signal", ""))
	var method_s := String(params.get("method", ""))
	if from_path.is_empty() or to_path.is_empty() or signal_name_s.is_empty() or method_s.is_empty():
		return _resp_err("from_node_path, signal, to_node_path, method are required")

	var from_node := _find_node(from_path)
	var to_node := _find_node(to_path)
	if from_node == null:
		return _resp_err("from_node not found", { "from_node_path": from_path })
	if to_node == null:
		return _resp_err("to_node not found", { "to_node_path": to_path })

	var signal_name := StringName(signal_name_s)
	var method_name := StringName(method_s)
	var callable := Callable(to_node, method_name)

	if from_node.is_connected(signal_name, callable):
		return _resp_ok({ "connected": false, "already_connected": true })

	var auto_commit := _ensure_action("godot_mcp:connect_signal")
	_undo.add_do_method(from_node, &"connect", signal_name, callable, Object.CONNECT_PERSIST)
	_undo.add_undo_method(from_node, &"disconnect", signal_name, callable)
	_maybe_commit(auto_commit)

	return _resp_ok({ "connected": true, "signal": signal_name_s })

func _filesystem_scan() -> Dictionary:
	var fs := _ei.get_resource_filesystem()
	if fs == null:
		return _resp_err("EditorFileSystem not available")
	fs.scan()
	return _resp_ok({ "requested": true })

func _filesystem_reimport_files(params: Dictionary) -> Dictionary:
	var fs := _ei.get_resource_filesystem()
	if fs == null:
		return _resp_err("EditorFileSystem not available")

	var files_v := params.get("files", params.get("paths", []))
	var files: Array = files_v if typeof(files_v) == TYPE_ARRAY else []
	if files.is_empty():
		return _resp_err("files is required (array of res:// paths)")

	var res_files: PackedStringArray = PackedStringArray()
	for f in files:
		if typeof(f) != TYPE_STRING:
			continue
		var rp := _to_res_path(String(f))
		if rp.is_empty():
			return _resp_err("Invalid path (must be res:// or inside project root)", { "path": String(f) })
		res_files.append(rp)

	fs.reimport_files(res_files)
	return _resp_ok({ "requested": true, "count": res_files.size(), "files": res_files })

func _blocked_target(target_type: String, target_id: String) -> bool:
	if target_type != "singleton":
		return false
	var id := target_id.to_lower()
	return id == "os" or id == "projectsettings" or id == "fileaccess"

func _generic_call(params: Dictionary) -> Dictionary:
	var target_type := String(params.get("target_type", params.get("targetType", "")))
	var target_id := params.get("target_id", params.get("targetId", ""))
	var method := String(params.get("method", ""))
	var args_v := params.get("args", [])
	var args: Array = args_v if typeof(args_v) == TYPE_ARRAY else []

	if target_type.is_empty() or method.is_empty():
		return _resp_err("target_type and method are required")

	if _blocked_target(target_type, String(target_id)) and not _dangerous_allowed():
		return _resp_err("Dangerous RPC blocked. Set ALLOW_DANGEROUS_OPS=true to allow OS/FileAccess/ProjectSettings access.", { "target_type": target_type, "target_id": target_id, "method": method })

	var target := _get_target_object(target_type, target_id, params)
	if target == null:
		return _resp_err("Target not found", { "target_type": target_type, "target_id": target_id })
	if not target.has_method(method):
		return _resp_err("Target has no method", { "method": method })

	var result := target.callv(method, args)
	return _resp_ok({ "result": _variant_to_json(result) })

func _generic_set(params: Dictionary) -> Dictionary:
	var target_type := String(params.get("target_type", params.get("targetType", "")))
	var target_id := params.get("target_id", params.get("targetId", ""))
	var prop := String(params.get("property", ""))
	if target_type.is_empty() or prop.is_empty():
		return _resp_err("target_type and property are required")

	if _blocked_target(target_type, String(target_id)) and not _dangerous_allowed():
		return _resp_err("Dangerous RPC blocked. Set ALLOW_DANGEROUS_OPS=true to allow OS/FileAccess/ProjectSettings access.", { "target_type": target_type, "target_id": target_id, "property": prop })

	var target := _get_target_object(target_type, target_id, params)
	if target == null:
		return _resp_err("Target not found", { "target_type": target_type, "target_id": target_id })

	target.set(prop, params.get("value", null))
	return _resp_ok({ "set": true })

func _generic_get(params: Dictionary) -> Dictionary:
	var target_type := String(params.get("target_type", params.get("targetType", "")))
	var target_id := params.get("target_id", params.get("targetId", ""))
	var prop := String(params.get("property", ""))
	if target_type.is_empty() or prop.is_empty():
		return _resp_err("target_type and property are required")

	if _blocked_target(target_type, String(target_id)) and not _dangerous_allowed():
		return _resp_err("Dangerous RPC blocked. Set ALLOW_DANGEROUS_OPS=true to allow OS/FileAccess/ProjectSettings access.", { "target_type": target_type, "target_id": target_id, "property": prop })

	var target := _get_target_object(target_type, target_id, params)
	if target == null:
		return _resp_err("Target not found", { "target_type": target_type, "target_id": target_id })

	return _resp_ok({ "value": _variant_to_json(target.get(prop)) })

func _inspect_class(params: Dictionary) -> Dictionary:
	var class_name := String(params.get("class_name", params.get("className", "")))
	if class_name.is_empty():
		return _resp_err("class_name is required")

	if not ClassDB.class_exists(class_name):
		return _resp_err(
			"Class not found in ClassDB. Script-defined global classes (class_name) are not always available via ClassDB.",
			{ "class_name": class_name, "suggestions": ["Use inspect_object on an instance instead."] }
		)

	return _resp_ok({
		"class_name": class_name,
		"methods": ClassDB.class_get_method_list(class_name),
		"properties": ClassDB.class_get_property_list(class_name),
		"signals": ClassDB.class_get_signal_list(class_name),
	})

func _inspect_object(params: Dictionary) -> Dictionary:
	var node_id := String(params.get("node_path", params.get("nodePath", params.get("node_id", params.get("nodeId", "")))))
	var instance_id := _get_instance_id(params, ["instance_id", "instanceId"])
	if node_id.is_empty() and instance_id == 0:
		return _resp_err("node_path (or instance_id) is required")

	var node: Node = null
	if instance_id != 0:
		var inst := instance_from_id(instance_id)
		if inst != null and inst is Node:
			node = inst as Node
	if node == null and not node_id.is_empty():
		node = _find_node(node_id)
	if node == null:
		return _resp_err("Node not found", { "node_id": node_id, "instance_id": instance_id })

	return _resp_ok({
		"node_id": node_id,
		"instance_id": node.get_instance_id(),
		"class": node.get_class(),
		"name": node.name,
		"properties": node.get_property_list(),
		"methods": node.get_method_list(),
		"signals": node.get_signal_list(),
	})
