extends "ops_module_base.gd"

func get_operations() -> Dictionary:
	return {
		"doctor_scan_v1": Callable(self, "doctor_scan_v1"),
	}

func _doctor_opt_bool(params: Dictionary, key: String, fallback: bool) -> bool:
	if params.has(key):
		return bool(params.get(key))
	# accept camelCase fallbacks
	var camel := ""
	for part in key.split("_"):
		if camel.is_empty():
			camel = part
		else:
			camel += part.capitalize()
	if camel != "" and params.has(camel):
		return bool(params.get(camel))
	return fallback

func _doctor_opt_int(params: Dictionary, key: String, fallback: int) -> int:
	if params.has(key):
		return int(_num(params.get(key), float(fallback)))
	# accept camelCase fallbacks
	var camel := ""
	for part in key.split("_"):
		if camel.is_empty():
			camel = part
		else:
			camel += part.capitalize()
	if camel != "" and params.has(camel):
		return int(_num(params.get(camel), float(fallback)))
	return fallback

func _doctor_read_text(path_res: String) -> String:
	var p := _to_res_path(path_res)
	var f := FileAccess.open(p, FileAccess.READ)
	if f == null:
		return ""
	var text := f.get_as_text()
	f.close()
	return text

func _doctor_issue(
	issue_id: String,
	severity: String,
	category: String,
	title: String,
	message: String,
	location: Dictionary = {},
	evidence: String = "",
	suggested_fix: String = "",
	related_actions: Array = []
) -> Dictionary:
	var out := {
		"issueId": issue_id,
		"severity": severity,
		"category": category,
		"title": title,
		"message": message,
		"location": location,
	}
	if not evidence.is_empty():
		out["evidence"] = evidence
	if not suggested_fix.is_empty():
		out["suggestedFix"] = suggested_fix
	if related_actions.size() > 0:
		out["relatedMcpActions"] = related_actions
	return out

func _doctor_is_text_scan_ext(path: String) -> bool:
	var lower := path.to_lower()
	return (
		lower.ends_with(".tscn") or
		lower.ends_with(".tres") or
		lower.ends_with(".gd") or
		lower.ends_with(".import")
	)

func _doctor_list_files_sorted(base_path: String, allowed_exts: Array) -> Array[String]:
	var out: Array[String] = []
	var dir := DirAccess.open(base_path)
	if dir == null:
		return out

	var names: Array[String] = []
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not name.begins_with("."):
			names.append(name)
		name = dir.get_next()
	dir.list_dir_end()

	names.sort()

	for n in names:
		var base := base_path
		if not base.ends_with("/"):
			base += "/"
		var full := base + n
		if DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(full)):
			out.append_array(_doctor_list_files_sorted(full, allowed_exts))
		else:
			var lower := n.to_lower()
			for ext in allowed_exts:
				if lower.ends_with(String(ext)):
					out.append(full)
					break
	return out

func _doctor_extract_paths(text: String, prefix: String) -> Array[String]:
	var out: Array[String] = []
	var seen: Dictionary = {}
	var i := 0
	while true:
		i = text.find(prefix, i)
		if i == -1:
			break
		var j := i
		while j < text.length():
			var c := text[j]
			if c == '"' or c == "'" or c == " " or c == "\t" or c == "\n" or c == "\r" or c == ")" or c == "]" or c == ",":
				break
			j += 1
		var p := text.substr(i, j - i).strip_edges()
		if p.length() > 0 and not seen.has(p):
			seen[p] = true
			out.append(p)
		i = j
	out.sort()
	return out

func _doctor_parse_editor_plugins(project_godot_text: String) -> Array[String]:
	# Parses [editor_plugins] enabled=PackedStringArray("plugin_id", ...)
	var plugins: Array[String] = []
	var in_section := false
	var lines := project_godot_text.replace("\r\n", "\n").split("\n")
	for line in lines:
		var trimmed := String(line).strip_edges()
		if trimmed.begins_with("[") and trimmed.ends_with("]"):
			in_section = trimmed == "[editor_plugins]"
			continue
		if not in_section:
			continue
		if not trimmed.begins_with("enabled="):
			continue
		# Extract quoted strings
		var idx := 0
		while true:
			var start := trimmed.find("\"", idx)
			if start == -1:
				break
			var end := trimmed.find("\"", start + 1)
			if end == -1:
				break
			var value := trimmed.substr(start + 1, end - start - 1).strip_edges()
			if value.length() > 0 and not plugins.has(value):
				plugins.append(value)
			idx = end + 1
	plugins.sort()
	return plugins

func _doctor_time_up(deadline_ms: int) -> bool:
	return Time.get_ticks_msec() >= deadline_ms

func _doctor_try_add_issue(
	issues: Array,
	issue_counts: Dictionary,
	counted: Dictionary,
	max_per_category: int,
	issue: Dictionary
) -> void:
	var key := String(issue.get("issueId", "")) + "|" + String(issue.get("category", "")) + "|" + JSON.stringify(issue.get("location", {})) + "|" + String(issue.get("message", ""))
	if counted.has(key):
		return
	var cat := String(issue.get("category", "other"))
	var current := int(issue_counts.get(cat, 0))
	if current >= max_per_category:
		return
	counted[key] = true
	issue_counts[cat] = current + 1
	issues.append(issue)

func doctor_scan_v1(params: Dictionary) -> Dictionary:
	var started_ms := Time.get_ticks_msec()
	var time_budget_ms := _doctor_opt_int(params, "time_budget_ms", 180000)
	if time_budget_ms <= 0:
		time_budget_ms = 180000
	var deadline_ms := started_ms + time_budget_ms

	var include_assets := _doctor_opt_bool(params, "include_assets", true)
	var include_scripts := _doctor_opt_bool(params, "include_scripts", true)
	var include_scenes := _doctor_opt_bool(params, "include_scenes", true)
	var include_uid := _doctor_opt_bool(params, "include_uid", true)
	var include_export := _doctor_opt_bool(params, "include_export", false)
	var deep_scene_instantiate := _doctor_opt_bool(params, "deep_scene_instantiate", false)
	var max_issues_per_category := _doctor_opt_int(params, "max_issues_per_category", 200)
	if max_issues_per_category <= 0:
		max_issues_per_category = 200

	var issues: Array = []
	var issue_counts: Dictionary = {}
	var counted: Dictionary = {}

	# Project settings checks
	var main_scene := String(ProjectSettings.get_setting("application/run/main_scene", "")).strip_edges()
	if main_scene.is_empty():
		_doctor_try_add_issue(issues, issue_counts, counted, max_issues_per_category, _doctor_issue(
			"MAIN_SCENE_MISSING",
			"error",
			"project",
			"Main Scene is not set",
			"Project setting application/run/main_scene is empty.",
			{ "file": "res://project.godot" },
			"",
			"Set a valid main scene in Project Settings (Application > Run > Main Scene)."
		))
	else:
		var main_res := _to_res_path(main_scene)
		if not FileAccess.file_exists(main_res):
			_doctor_try_add_issue(issues, issue_counts, counted, max_issues_per_category, _doctor_issue(
				"MAIN_SCENE_NOT_FOUND",
				"error",
				"project",
				"Main Scene path does not exist",
				"Main scene points to a missing file: " + main_res,
				{ "file": "res://project.godot" },
				"run/main_scene=" + main_res,
				"Fix the main scene path or restore the missing scene file."
			))

	# Addon/plugin enabled-but-missing checks (static from project.godot)
	var project_godot_text := _doctor_read_text("res://project.godot")
	if project_godot_text.is_empty():
		_doctor_try_add_issue(issues, issue_counts, counted, max_issues_per_category, _doctor_issue(
			"PROJECT_GODOT_UNREADABLE",
			"error",
			"project",
			"Cannot read project.godot",
			"Failed to read res://project.godot.",
			{ "file": "res://project.godot" }
		))
	else:
		var enabled_plugins := _doctor_parse_editor_plugins(project_godot_text)
		for plugin_id in enabled_plugins:
			if _doctor_time_up(deadline_ms):
				break
			var cfg := "res://addons/" + String(plugin_id) + "/plugin.cfg"
			if not FileAccess.file_exists(cfg):
				_doctor_try_add_issue(issues, issue_counts, counted, max_issues_per_category, _doctor_issue(
					"PLUGIN_ENABLED_BUT_MISSING",
					"warning",
					"project",
					"Editor plugin enabled but addon is missing",
					"Plugin is enabled in project.godot but addon files are missing: " + cfg,
					{ "file": "res://project.godot" },
					"enabled plugin: " + String(plugin_id),
					"Disable the plugin in project.godot or restore the addon folder under res://addons/."
				))

	# File list collection (deterministic order)
	var scripts: Array[String] = []
	var scenes: Array[String] = []
	var resources: Array[String] = []
	var import_files: Array[String] = []

	if include_scripts and not _doctor_time_up(deadline_ms):
		scripts = _doctor_list_files_sorted("res://", [".gd"])
	if include_scenes and not _doctor_time_up(deadline_ms):
		scenes = _doctor_list_files_sorted("res://", [".tscn"])
	if not _doctor_time_up(deadline_ms):
		resources = _doctor_list_files_sorted("res://", [".tres", ".res"])
	if include_assets and not _doctor_time_up(deadline_ms):
		import_files = _doctor_list_files_sorted("res://", [".import"])

	# Script load/parse checks (engine-level)
	if include_scripts:
		for script_path in scripts:
			if _doctor_time_up(deadline_ms):
				break
			var loaded_script := load(script_path)
			if loaded_script == null or not (loaded_script is Script):
				_doctor_try_add_issue(issues, issue_counts, counted, max_issues_per_category, _doctor_issue(
					"SCRIPT_PARSE_ERROR",
					"error",
					"scripts",
					"Script failed to load (parse/compile error or missing dependency)",
					"Godot failed to load the script resource.",
					{ "file": script_path },
					"",
					"Open the script and fix syntax errors or invalid extends/preload references.",
					["godot_workspace_manager(action=\"doctor_report\")"]
				))
			else:
				# Some script errors surface only on (re)compile; check reload() when available.
				if (loaded_script as Script).has_method("reload"):
					var reload_err := int((loaded_script as Script).call("reload"))
					if reload_err != OK:
						_doctor_try_add_issue(issues, issue_counts, counted, max_issues_per_category, _doctor_issue(
							"SCRIPT_PARSE_ERROR",
							"error",
							"scripts",
							"Script failed to compile (reload error)",
							"Godot reported a script reload error while compiling.",
							{ "file": script_path },
							"reload_error=" + str(reload_err),
							"Open the script and fix syntax/typing/extends/preload errors."
						))

	# Scene/resource load checks (engine-level; load only by default)
	if include_scenes:
		for scene_path in scenes:
			if _doctor_time_up(deadline_ms):
				break
			var scene_res := ResourceLoader.load(scene_path)
			if scene_res == null or not (scene_res is PackedScene):
				_doctor_try_add_issue(issues, issue_counts, counted, max_issues_per_category, _doctor_issue(
					"SCENE_LOAD_FAILED",
					"error",
					"scenes",
					"Scene failed to load",
					"Godot failed to load the scene (missing resource/script, parse error, or invalid reference).",
					{ "file": scene_path },
					"",
					"Inspect the scene for missing res:// paths, broken uid:// references, or script parse errors."
				))
			elif deep_scene_instantiate:
				var inst = (scene_res as PackedScene).instantiate()
				if inst == null:
					_doctor_try_add_issue(issues, issue_counts, counted, max_issues_per_category, _doctor_issue(
						"SCENE_INSTANTIATE_FAILED",
						"error",
						"scenes",
						"Scene failed to instantiate",
						"PackedScene.instantiate() returned null.",
						{ "file": scene_path },
						"",
						"Try loading the scene in the editor; verify node scripts and resources."
					))

	# Resource load checks (best-effort)
	for res_path in resources:
		if _doctor_time_up(deadline_ms):
			break
		var res_loaded := ResourceLoader.load(res_path)
		if res_loaded == null:
			_doctor_try_add_issue(issues, issue_counts, counted, max_issues_per_category, _doctor_issue(
				"RESOURCE_LOAD_FAILED",
				"warning",
				"scenes",
				"Resource failed to load",
				"Godot failed to load the resource file.",
				{ "file": res_path }
			))

	# Static reference integrity checks (res:// and uid://), plus import source checks
	var uid_refs_seen: Dictionary = {}
	var uid_refs: Array[String] = []
	var files_to_scan: Array[String] = []
	for p in scripts:
		files_to_scan.append(p)
	for p in scenes:
		files_to_scan.append(p)
	for p in resources:
		files_to_scan.append(p)
	for p in import_files:
		files_to_scan.append(p)
	files_to_scan.sort()

	for file_path in files_to_scan:
		if _doctor_time_up(deadline_ms):
			break
		if not _doctor_is_text_scan_ext(file_path):
			continue
		var text := _doctor_read_text(file_path)
		if text.is_empty():
			continue

		# res:// references
		var res_refs := _doctor_extract_paths(text, "res://")
		for ref in res_refs:
			if _doctor_time_up(deadline_ms):
				break
			var rp := _to_res_path(ref)
			if not FileAccess.file_exists(rp):
				_doctor_try_add_issue(issues, issue_counts, counted, max_issues_per_category, _doctor_issue(
					"MISSING_RES_REFERENCE",
					"error",
					"scenes",
					"Missing res:// reference target",
					"Referenced file does not exist: " + rp,
					{ "file": file_path },
					ref,
					"Restore the missing file or update the reference in the source file."
				))

		# uid:// references
		if include_uid:
			var uids := _doctor_extract_paths(text, "uid://")
			for u in uids:
				if _doctor_time_up(deadline_ms):
					break
				if not uid_refs_seen.has(u):
					uid_refs_seen[u] = true
					uid_refs.append(u)

		# .import files: source_file must exist
		if include_assets and file_path.to_lower().ends_with(".import"):
			var idx := text.find("source_file=")
			if idx != -1:
				var startq := text.find("\"", idx)
				var endq := text.find("\"", startq + 1) if startq != -1 else -1
				if startq != -1 and endq != -1:
					var source := text.substr(startq + 1, endq - startq - 1).strip_edges()
					if source.begins_with("res://") and not FileAccess.file_exists(source):
						_doctor_try_add_issue(issues, issue_counts, counted, max_issues_per_category, _doctor_issue(
							"IMPORT_SOURCE_MISSING",
							"warning",
							"assets",
							"Import source file is missing",
							"Import metadata references a missing source file: " + source,
							{ "file": file_path },
							"source_file=" + source,
							"Delete/reimport the asset, or restore the missing source file.",
							["godot_asset_manager(action=\"auto_import_check\")"]
						))

	# UID resolution checks (best-effort)
	if include_uid and not _doctor_time_up(deadline_ms):
		uid_refs.sort()
		for uid_path in uid_refs:
			if _doctor_time_up(deadline_ms):
				break
			var loaded_uid := ResourceLoader.load(uid_path)
			if loaded_uid == null:
				_doctor_try_add_issue(issues, issue_counts, counted, max_issues_per_category, _doctor_issue(
					"UID_UNRECOGNIZED",
					"error",
					"uid",
					"Unrecognized uid:// reference",
					"Godot failed to resolve this uid:// reference: " + uid_path,
					{ "uid": uid_path },
					uid_path,
					"Open the referenced resource in the editor (or run a UID maintenance workflow) and update broken UID references."
				))

	var duration_ms := Time.get_ticks_msec() - started_ms
	var version_info := Engine.get_version_info()
	var meta := {
		"scanStartedAtMs": started_ms,
		"scanDurationMs": duration_ms,
		"timeBudgetMs": time_budget_ms,
		"timedOut": _doctor_time_up(deadline_ms),
		"includeAssets": include_assets,
		"includeScripts": include_scripts,
		"includeScenes": include_scenes,
		"includeUID": include_uid,
		"includeExport": include_export,
		"deepSceneInstantiate": deep_scene_instantiate,
		"godotVersion": String(version_info.get("string", "")),
		"scanned": {
			"scripts": scripts.size(),
			"scenes": scenes.size(),
			"resources": resources.size(),
			"importFiles": import_files.size(),
			"uidRefs": uid_refs.size(),
		},
		"issueCountsByCategory": issue_counts,
	}

	return _ok("Doctor scan completed", { "meta": meta, "issues": issues })

