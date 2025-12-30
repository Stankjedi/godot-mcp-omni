extends RefCounted

var ctx: Object

func _init(ctx_ref: Object) -> void:
	ctx = ctx_ref

func _dispatch(operation: String, params: Dictionary) -> Dictionary:
	return ctx._dispatch(operation, params)

func _log_debug(message: String) -> void:
	ctx._log_debug(message)

func _log_info(message: String) -> void:
	ctx._log_info(message)

func _log_error(message: String) -> void:
	ctx._log_error(message)

func _ok(summary: String, details: Dictionary = {}) -> Dictionary:
	return ctx._ok(summary, details)

func _err(summary: String, details: Dictionary = {}) -> Dictionary:
	return ctx._err(summary, details)

func _to_res_path(p: String) -> String:
	return ctx._to_res_path(p)

func _num(v, fallback: float = 0.0) -> float:
	return ctx._num(v, fallback)

func _set_if_has(obj: Object, prop: String, value) -> bool:
	return ctx._set_if_has(obj, prop, value)

func _json_to_variant(value):
	return ctx._json_to_variant(value)

func _prop_type(obj: Object, prop: String) -> int:
	return ctx._prop_type(obj, prop)

func _json_to_variant_for_type(value, expected_type: int):
	return ctx._json_to_variant_for_type(value, expected_type)

func _vec2i_from(value, fallback: Vector2i) -> Vector2i:
	return ctx._vec2i_from(value, fallback)

func _uid_text_from_value(value: Variant) -> String:
	return ctx._uid_text_from_value(value)

func _ensure_dir_for_res_path(res_path: String) -> int:
	return ctx._ensure_dir_for_res_path(res_path)

func _instantiate_class(name_of_class: String) -> Variant:
	return ctx._instantiate_class(name_of_class)

func _find_node(scene_root: Node, node_path: String) -> Node:
	return ctx._find_node(scene_root, node_path)

func _node_path_str(scene_root: Node, node: Node) -> String:
	return ctx._node_path_str(scene_root, node)

func _unique_child_name(parent: Node, desired: String) -> String:
	return ctx._unique_child_name(parent, desired)


# -----------------------------------------------------------------------------
# Shared helper (moved from godot_operations.gd)

func _create_tileset_from_texture(texture_path: String, tile_size: Vector2i, cells: Array) -> Dictionary:
	var res_path := _to_res_path(texture_path)
	if res_path.is_empty():
		return { "ok": false, "message": "Invalid texture path", "texture_path": texture_path }
	var texture = load(res_path)
	# Note: In headless flows without prior import, `load(res://some.png)` can return a
	# Texture2D with size (0,0). Fall back to Image.load on the absolute path in that case.
	if texture != null and texture is Texture2D:
		var s = (texture as Texture2D).get_size()
		if int(s.x) <= 0 or int(s.y) <= 0:
			texture = null

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

