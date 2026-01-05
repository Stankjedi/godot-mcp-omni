extends "ops_module_base.gd"

const USER_DATA_DIR := "user://.godot_mcp/game_data"

func get_operations() -> Dictionary:
	return {
		"project_config_save_game_data_v1": Callable(self, "project_config_save_game_data_v1"),
		"project_config_load_game_data_v1": Callable(self, "project_config_load_game_data_v1"),
		"project_config_project_setting_set_v1": Callable(self, "project_config_project_setting_set_v1"),
		"project_config_project_setting_get_v1": Callable(self, "project_config_project_setting_get_v1"),
		"project_config_input_map_setup_v1": Callable(self, "project_config_input_map_setup_v1"),
	}

func _safe_key(raw_key: Variant) -> String:
	var key := String(raw_key).strip_edges()
	if key.is_empty():
		return ""
	if key.find("/") != -1 or key.find("\\") != -1:
		return ""
	if key.find("..") != -1:
		return ""
	var bytes: PackedByteArray = key.to_utf8_buffer()
	for b in bytes:
		if typeof(b) != TYPE_INT:
			return ""
		var code := int(b)
		# Only allow ASCII: [A-Za-z0-9_.-]
		var ok = (
			(code >= 48 and code <= 57) or
			(code >= 65 and code <= 90) or
			(code >= 97 and code <= 122) or
			code == 95 or # _
			code == 45 or # -
			code == 46    # .
		)
		if not ok:
			return ""
	return key

func _ensure_user_dir(dir_path: String) -> int:
	var abs_dir := ProjectSettings.globalize_path(dir_path)
	if abs_dir.is_empty():
		return ERR_INVALID_PARAMETER
	return DirAccess.make_dir_recursive_absolute(abs_dir)

func project_config_save_game_data_v1(params: Dictionary) -> Dictionary:
	if not params.has("key"):
		return _err("key is required")
	if not params.has("value"):
		return _err("value is required")

	var key := _safe_key(params.key)
	if key.is_empty():
		return _err("Invalid key (use only [A-Za-z0-9_.-])", { "key": params.key })

	var dir_err := _ensure_user_dir(USER_DATA_DIR)
	if dir_err != OK:
		return _err("Failed to create user:// data directory", { "error": dir_err, "dir": USER_DATA_DIR })

	var file_path := USER_DATA_DIR + "/" + key + ".json"
	var payload := JSON.stringify(params.value)

	var f := FileAccess.open(file_path, FileAccess.WRITE)
	if f == null:
		return _err("Failed to open file for writing", { "error": FileAccess.get_open_error(), "path": file_path })
	f.store_string(payload)
	f.close()

	return _ok("Game data saved", { "path": file_path, "bytes": payload.to_utf8_buffer().size(), "key": key })

func project_config_load_game_data_v1(params: Dictionary) -> Dictionary:
	if not params.has("key"):
		return _err("key is required")

	var key := _safe_key(params.key)
	if key.is_empty():
		return _err("Invalid key (use only [A-Za-z0-9_.-])", { "key": params.key })

	var file_path := USER_DATA_DIR + "/" + key + ".json"
	if not FileAccess.file_exists(file_path):
		var has_default := params.has("default_value")
		return _ok(
			"Game data not found",
			{
				"found": false,
				"key": key,
				"path": file_path,
				"value": params.default_value if has_default else null,
			}
		)

	var f := FileAccess.open(file_path, FileAccess.READ)
	if f == null:
		return _err("Failed to open file for reading", { "error": FileAccess.get_open_error(), "path": file_path })
	var text := f.get_as_text()
	f.close()

	var json := JSON.new()
	var parse_err := json.parse(text)
	if parse_err != OK:
		return _err("Failed to parse JSON", { "error": json.get_error_message(), "line": json.get_error_line(), "path": file_path })

	return _ok("Game data loaded", { "found": true, "key": key, "path": file_path, "value": json.get_data() })

func project_config_project_setting_set_v1(params: Dictionary) -> Dictionary:
	if not params.has("key"):
		return _err("key is required")
	if not params.has("value"):
		return _err("value is required")

	var key := String(params.key).strip_edges()
	if key.is_empty():
		return _err("Invalid key", { "key": params.key })

	var before = ProjectSettings.get_setting(key, null)
	var value = _json_to_variant(params.value)
	ProjectSettings.set_setting(key, value)
	var save_err := ProjectSettings.save()
	if save_err != OK:
		return _err("ProjectSettings.save failed", { "error": save_err, "key": key })

	var after = ProjectSettings.get_setting(key, null)
	return _ok("Project setting updated", { "key": key, "before": before, "after": after })

func project_config_project_setting_get_v1(params: Dictionary) -> Dictionary:
	if not params.has("key"):
		return _err("key is required")
	var key := String(params.key).strip_edges()
	if key.is_empty():
		return _err("Invalid key", { "key": params.key })

	var value = ProjectSettings.get_setting(key, null)
	# Keep value JSON-friendly where possible; fallback to var_to_str.
	match typeof(value):
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING, TYPE_DICTIONARY, TYPE_ARRAY:
			return _ok("Project setting read", { "key": key, "value": value })
		_:
			return _ok("Project setting read", { "key": key, "value_str": var_to_str(value) })

func _keycode_from(v: Variant) -> int:
	match typeof(v):
		TYPE_INT:
			return int(v)
		TYPE_FLOAT:
			return int(round(float(v)))
		TYPE_STRING:
			var s := String(v).strip_edges()
			if s.begins_with("KEY_"):
				s = s.substr(4)
			if OS.has_method("find_keycode_from_string"):
				return int(OS.call("find_keycode_from_string", s))
	return 0

func project_config_input_map_setup_v1(params: Dictionary) -> Dictionary:
	if not params.has("actions") or typeof(params.actions) != TYPE_ARRAY:
		return _err("actions is required (array)")

	var actions: Array = params.actions
	var changed_actions: Array[String] = []
	var added_events := 0

	for i in actions.size():
		var item = actions[i]
		if typeof(item) != TYPE_DICTIONARY:
			continue
		var a: Dictionary = item
		var name := String(a.get("name", "")).strip_edges()
		if name.is_empty():
			continue

		var existed := InputMap.has_action(name)
		if not existed:
			var dz := 0.5
			if a.has("deadzone"):
				dz = float(_num(a.deadzone, 0.5))
			InputMap.add_action(name, dz)
			changed_actions.append(name)
		elif a.has("deadzone") and InputMap.has_method("action_set_deadzone"):
			InputMap.call("action_set_deadzone", name, float(_num(a.deadzone, 0.5)))
			changed_actions.append(name)

		if a.has("keys") and typeof(a.keys) == TYPE_ARRAY:
			for raw_key in a.keys:
				var keycode := _keycode_from(raw_key)
				if keycode <= 0:
					continue
				var ev := InputEventKey.new()
				ev.keycode = keycode
				ev.pressed = true
				InputMap.action_add_event(name, ev)
				added_events += 1
				if not changed_actions.has(name):
					changed_actions.append(name)

	var save_err := ProjectSettings.save()
	if save_err != OK:
		return _err("ProjectSettings.save failed", { "error": save_err })

	return _ok(
		"InputMap updated",
		{
			"changed_actions": changed_actions,
			"added_events": added_events,
		}
	)
