extends "ops_module_base.gd"

func get_operations() -> Dictionary:
	return {
		"get_godot_version": Callable(self, "get_godot_version"),
		"load_sprite": Callable(self, "load_sprite"),
		"create_resource": Callable(self, "create_resource"),
		"export_mesh_library": Callable(self, "export_mesh_library"),
		"get_uid": Callable(self, "get_uid"),
		"resave_resources": Callable(self, "resave_resources"),
	}

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
