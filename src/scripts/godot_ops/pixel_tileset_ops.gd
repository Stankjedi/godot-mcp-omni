extends "pixel_ops_base.gd"

func get_operations() -> Dictionary:
	return {
		"op_tileset_create_from_atlas": Callable(self, "op_tileset_create_from_atlas"),
	}

func op_tileset_create_from_atlas(params: Dictionary) -> Dictionary:
	var png_path := String(params.get("png_path", params.get("pngPath", ""))).strip_edges()
	var output_tileset_path := String(params.get("output_tileset_path", params.get("outputTilesetPath", ""))).strip_edges()
	if png_path.is_empty():
		return _err("png_path is required")
	if output_tileset_path.is_empty():
		return _err("output_tileset_path is required")

	var allow_overwrite := bool(params.get("allow_overwrite", params.get("allowOverwrite", false)))
	var tile_size := _tile_size_from_any(params, ["tile_size", "tileSize"], Vector2i(16, 16))
	if tile_size.x <= 0 or tile_size.y <= 0:
		return _err("Invalid tile_size", { "tile_size": tile_size })

	var res_png := _to_res_path(png_path)
	var res_out := _to_res_path(output_tileset_path)

	if ResourceLoader.exists(res_out) and not allow_overwrite:
		return _err("TileSet already exists", { "tileset_path": res_out, "suggestions": ["Set allowOverwrite=true to overwrite."] })

	var tex: Texture2D = null
	var loaded = load(res_png)
	if loaded is Texture2D:
		tex = loaded as Texture2D
		var s = tex.get_size()
		if int(s.x) <= 0 or int(s.y) <= 0:
			tex = null

	if tex == null:
		# Fallback: try loading as Image from absolute path (useful when import hasn't run yet).
		var image := Image.new()
		var abs_path := ProjectSettings.globalize_path(res_png)
		var img_err := image.load(abs_path)
		if img_err == OK:
			if ClassDB.class_has_method("ImageTexture", "create_from_image"):
				tex = ImageTexture.create_from_image(image)
			else:
				var image_tex := ImageTexture.new()
				image_tex.create_from_image(image)
				tex = image_tex

	if tex == null:
		return _err("Failed to load atlas texture", { "png_path": res_png, "suggestions": ["Ensure the PNG exists under res:// and is importable by Godot."] })

	var size_v = tex.get_size()
	var tex_w := int(size_v.x)
	var tex_h := int(size_v.y)
	if tex_w <= 0 or tex_h <= 0:
		return _err("Invalid atlas texture size", { "png_path": res_png, "size": size_v })

	var columns := int(floor(float(tex_w) / float(tile_size.x)))
	var rows := int(floor(float(tex_h) / float(tile_size.y)))
	if columns <= 0 or rows <= 0:
		return _err("Atlas texture is smaller than tile_size", { "png_path": res_png, "tile_size": tile_size, "texture_size": Vector2i(tex_w, tex_h) })

	var cells: Array = []
	for ay in range(rows):
		for ax in range(columns):
			cells.append({ "atlas_x": ax, "atlas_y": ay })

	var tileset_resp := _create_tileset_from_texture(res_png, tile_size, cells)
	if not bool(tileset_resp.get("ok", false)):
		return _err("Failed to create TileSet from atlas", { "details": tileset_resp })

	var tileset_res: TileSet = tileset_resp.get("tileset")
	var source_id := int(tileset_resp.get("source_id", -1))

	var dir_err := _ensure_dir_for_res_path(res_out)
	if dir_err != OK:
		return _err("Failed to create output directory", { "error": dir_err, "dir": res_out.get_base_dir() })

	var save_err := ResourceSaver.save(tileset_res, res_out)
	if save_err != OK:
		return _err("Failed to save TileSet", { "error": save_err, "tileset_path": res_out })

	return _ok("TileSet created from atlas", { "tileset_path": res_out, "png_path": res_png, "tile_size": tile_size, "columns": columns, "rows": rows, "source_id": source_id })

