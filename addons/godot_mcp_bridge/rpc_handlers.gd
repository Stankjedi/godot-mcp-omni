@tool
extends RefCounted
class_name GodotMcpRpcHandlers

var _plugin: EditorPlugin
var _undo: EditorUndoRedoManager

func _init(plugin: EditorPlugin, undo: EditorUndoRedoManager) -> void:
	_plugin = plugin
	_undo = undo

func capabilities() -> Dictionary:
	return {
		"protocol": "tcp-jsonl-1",
		"methods": [
			"open_scene",
			"save_scene",
			"get_current_scene",
			"list_open_scenes",
			"add_node",
			"remove_node",
			"set_property",
			"get_property",
			"connect_signal",
			"call",
			"set",
			"get",
			"inspect_class",
			"inspect_object",
		],
	}

func handle(method: String, params: Dictionary) -> Dictionary:
	match method:
		"open_scene":
			return _open_scene(params)
		"save_scene":
			return _save_scene(params)
		"get_current_scene":
			return _get_current_scene()
		"list_open_scenes":
			return _list_open_scenes()
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

func _scene_root() -> Node:
	return EditorInterface.get_edited_scene_root()

func _find_node(node_path: String) -> Node:
	var root := _scene_root()
	if root == null:
		return null

	var p := node_path.strip_edges()
	if p.is_empty() or p == "root" or p == "/root":
		return root
	if p.begins_with("root/"):
		p = p.substr(5)
	elif p.begins_with("/root/"):
		p = p.substr(6)

	return root.get_node_or_null(p)

func _open_scene(params: Dictionary) -> Dictionary:
	var p := String(params.get("path", ""))
	if p.is_empty():
		return _resp_err("path is required")

	EditorInterface.open_scene_from_path(p)
	return _resp_ok({ "requested_path": p })

func _save_scene(params: Dictionary) -> Dictionary:
	if params.has("path"):
		var p := String(params.get("path", ""))
		if p.is_empty():
			return _resp_err("path must be a non-empty string")
		EditorInterface.save_scene_as(p)
		return _resp_ok({ "saved_as": p })

	var err := EditorInterface.save_scene()
	if err != OK:
		return _resp_err("save_scene failed", { "error": err })
	return _resp_ok({ "saved": true })

func _get_current_scene() -> Dictionary:
	var root := _scene_root()
	if root == null:
		return _resp_err("No edited scene")
	return _resp_ok({ "path": root.scene_file_path, "name": root.name, "class": root.get_class() })

func _list_open_scenes() -> Dictionary:
	var scenes := EditorInterface.get_open_scenes()
	var out: Array[String] = []
	for s in scenes:
		out.append(String(s))
	return _resp_ok({ "scenes": out })

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

	_undo.create_action("godot_mcp:add_node")
	_undo.add_do_reference(node)
	_undo.add_do_method(parent, &"add_child", node)
	_undo.add_do_property(node, &"owner", root)
	_undo.add_undo_method(parent, &"remove_child", node)
	_undo.commit_action()

	return _resp_ok({ "added": true, "type": node_type, "name": node_name })

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

	_undo.create_action("godot_mcp:remove_node")
	_undo.add_undo_reference(node)
	_undo.add_do_method(parent, &"remove_child", node)
	_undo.add_undo_method(parent, &"add_child", node)
	_undo.add_undo_method(parent, &"move_child", node, idx)
	_undo.add_undo_property(node, &"owner", root)
	_undo.commit_action()

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

	_undo.create_action("godot_mcp:set_property")
	_undo.add_do_property(node, StringName(prop), new_value)
	_undo.add_undo_property(node, StringName(prop), old_value)
	_undo.commit_action()

	return _resp_ok({ "node_path": node_path, "property": prop })

func _get_property(params: Dictionary) -> Dictionary:
	var node_path := String(params.get("node_path", params.get("nodePath", "")))
	var prop := String(params.get("property", ""))
	if node_path.is_empty() or prop.is_empty():
		return _resp_err("node_path and property are required")

	var node := _find_node(node_path)
	if node == null:
		return _resp_err("Node not found", { "node_path": node_path })

	var value := node.get(prop)
	return _resp_ok({ "node_path": node_path, "property": prop, "value": _variant_to_json(value) })

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

	_undo.create_action("godot_mcp:connect_signal")
	_undo.add_do_method(from_node, &"connect", signal_name, callable, Object.CONNECT_PERSIST)
	_undo.add_undo_method(from_node, &"disconnect", signal_name, callable)
	_undo.commit_action()

	return _resp_ok({ "connected": true, "signal": signal_name_s })

func _get_target(target_type: String, target_id: String) -> Object:
	match target_type:
		"singleton":
			if target_id == "EditorInterface":
				return EditorInterface
			if Engine.has_singleton(target_id):
				return Engine.get_singleton(target_id)
			return null
		"node":
			return _find_node(target_id)
		"resource":
			return load(target_id)
		_:
			return null

func _generic_call(params: Dictionary) -> Dictionary:
	var target_type := String(params.get("target_type", ""))
	var target_id := String(params.get("target_id", ""))
	var method := String(params.get("method", ""))
	var args_v := params.get("args", [])
	var args: Array = args_v if typeof(args_v) == TYPE_ARRAY else []

	if target_type.is_empty() or target_id.is_empty() or method.is_empty():
		return _resp_err("target_type, target_id, method are required")

	var target := _get_target(target_type, target_id)
	if target == null:
		return _resp_err("Target not found", { "target_type": target_type, "target_id": target_id })
	if not target.has_method(method):
		return _resp_err("Target has no method", { "method": method })

	var result := target.callv(method, args)
	return _resp_ok({ "result": _variant_to_json(result) })

func _generic_set(params: Dictionary) -> Dictionary:
	var target_type := String(params.get("target_type", ""))
	var target_id := String(params.get("target_id", ""))
	var prop := String(params.get("property", ""))
	if target_type.is_empty() or target_id.is_empty() or prop.is_empty():
		return _resp_err("target_type, target_id, property are required")

	var target := _get_target(target_type, target_id)
	if target == null:
		return _resp_err("Target not found", { "target_type": target_type, "target_id": target_id })

	target.set(prop, params.get("value", null))
	return _resp_ok({ "set": true })

func _generic_get(params: Dictionary) -> Dictionary:
	var target_type := String(params.get("target_type", ""))
	var target_id := String(params.get("target_id", ""))
	var prop := String(params.get("property", ""))
	if target_type.is_empty() or target_id.is_empty() or prop.is_empty():
		return _resp_err("target_type, target_id, property are required")

	var target := _get_target(target_type, target_id)
	if target == null:
		return _resp_err("Target not found", { "target_type": target_type, "target_id": target_id })

	return _resp_ok({ "value": _variant_to_json(target.get(prop)) })

func _inspect_class(params: Dictionary) -> Dictionary:
	var class_name := String(params.get("class_name", params.get("className", "")))
	if class_name.is_empty():
		return _resp_err("class_name is required")
	if not ClassDB.class_exists(class_name):
		return _resp_err("Class not found", { "class_name": class_name })

	return _resp_ok({
		"class_name": class_name,
		"methods": ClassDB.class_get_method_list(class_name),
		"properties": ClassDB.class_get_property_list(class_name),
		"signals": ClassDB.class_get_signal_list(class_name),
	})

func _inspect_object(params: Dictionary) -> Dictionary:
	var node_path := String(params.get("node_path", params.get("nodePath", "")))
	if node_path.is_empty():
		return _resp_err("node_path is required")

	var node := _find_node(node_path)
	if node == null:
		return _resp_err("Node not found", { "node_path": node_path })

	return _resp_ok({
		"node_path": node_path,
		"class": node.get_class(),
		"properties": node.get_property_list(),
		"methods": node.get_method_list(),
		"signals": node.get_signal_list(),
	})
