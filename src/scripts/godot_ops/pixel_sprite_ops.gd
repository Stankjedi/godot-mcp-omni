extends "pixel_ops_base.gd"

func get_operations() -> Dictionary:
	return {
		"op_spriteframes_from_aseprite_json": Callable(self, "op_spriteframes_from_aseprite_json"),
	}

func op_spriteframes_from_aseprite_json(params: Dictionary) -> Dictionary:
	var spritesheet_path := String(params.get("spritesheet_png_path", params.get("spritesheetPngPath", params.get("spritesheetPath", params.get("spritesheet_path", ""))))).strip_edges()
	if spritesheet_path.is_empty():
		return _err("spritesheet_png_path is required")

	var aseprite_json_path := String(params.get("aseprite_json_path", params.get("asepriteJsonPath", params.get("aseprite_json", params.get("asepriteJson", ""))))).strip_edges()
	if aseprite_json_path.is_empty():
		return _err("aseprite_json_path is required")

	var sprite_frames_path := String(params.get("sprite_frames_path", params.get("spriteFramesPath", params.get("output_path", params.get("outputPath", ""))))).strip_edges()
	if sprite_frames_path.is_empty():
		return _err("sprite_frames_path is required")

	var fps := float(_num(params.get("fps", 8.0), 8.0))
	if fps <= 0.0:
		fps = 8.0

	var loop := true
	if params.has("loop"):
		loop = bool(params.get("loop"))
	elif params.has("looped"):
		loop = bool(params.get("looped"))

	var res_sheet := _to_res_path(spritesheet_path)
	var loaded_sheet := load(res_sheet)
	var sheet_texture: Texture2D = null
	var texture_loader := "imported_load"
	if loaded_sheet != null and loaded_sheet is Texture2D:
		sheet_texture = loaded_sheet
	else:
		texture_loader = "image_load"
		var image := Image.new()
		var img_err := image.load(res_sheet)
		if img_err != OK:
			return _err("Failed to load spritesheet texture", { "spritesheet_path": res_sheet, "error": img_err, "loader_path": texture_loader })
		sheet_texture = ImageTexture.create_from_image(image)
	if sheet_texture == null:
		return _err("Failed to load spritesheet texture", { "spritesheet_path": res_sheet, "loader_path": texture_loader })

	var res_json := _to_res_path(aseprite_json_path)
	if not FileAccess.file_exists(res_json):
		return _err("Aseprite JSON not found", { "aseprite_json_path": res_json })
	var f := FileAccess.open(res_json, FileAccess.READ)
	if f == null:
		return _err("Failed to open Aseprite JSON", { "aseprite_json_path": res_json, "error": FileAccess.get_open_error() })
	var json_text := f.get_as_text()
	f.close()

	var json := JSON.new()
	var parse_err := json.parse(json_text)
	if parse_err != OK:
		return _err("Failed to parse Aseprite JSON", { "aseprite_json_path": res_json, "error": json.get_error_message(), "line": json.get_error_line() })
	var data = json.get_data()
	if typeof(data) != TYPE_DICTIONARY:
		return _err("Aseprite JSON must be an object", { "aseprite_json_path": res_json })
	var root: Dictionary = data

	var frames_value = root.get("frames", null)
	var frame_entries: Array = []
	if typeof(frames_value) == TYPE_ARRAY:
		frame_entries = frames_value
	elif typeof(frames_value) == TYPE_DICTIONARY:
		var keys: Array = frames_value.keys()
		keys.sort()
		for k in keys:
			frame_entries.append(frames_value[k])
	else:
		return _err("Aseprite JSON is missing frames", { "aseprite_json_path": res_json })

	var rects: Array[Rect2] = []
	for raw_frame in frame_entries:
		if typeof(raw_frame) != TYPE_DICTIONARY:
			continue
		var frame_dict: Dictionary = raw_frame
		if not frame_dict.has("frame") or typeof(frame_dict.frame) != TYPE_DICTIONARY:
			continue
		var fr: Dictionary = frame_dict.frame
		var x := _num(fr.get("x", -1), -1)
		var y := _num(fr.get("y", -1), -1)
		var w := _num(fr.get("w", -1), -1)
		var h := _num(fr.get("h", -1), -1)
		if x < 0 or y < 0 or w <= 0 or h <= 0:
			continue
		rects.append(Rect2(x, y, w, h))

	if rects.size() == 0:
		return _err("No valid frames found in Aseprite JSON", { "aseprite_json_path": res_json })

	var meta_value = root.get("meta", null)
	var meta: Dictionary = meta_value if typeof(meta_value) == TYPE_DICTIONARY else {}
	var tags_value = meta.get("frameTags", null)
	if typeof(tags_value) != TYPE_ARRAY:
		return _err(
			"Aseprite JSON is missing meta.frameTags",
			{
				"aseprite_json_path": res_json,
				"suggestions": [
					"Add at least one frame tag in Aseprite (e.g. \"idle\").",
					"Re-export with --list-tags support enabled (aseprite_doctor can confirm capabilities).",
				],
			}
		)

	var sprite_frames := SpriteFrames.new()
	var used_names: Dictionary = {}
	var animations: Array = []

	for raw_tag in tags_value:
		if typeof(raw_tag) != TYPE_DICTIONARY:
			continue
		var tag: Dictionary = raw_tag
		var name := String(tag.get("name", "")).strip_edges()
		if name.is_empty():
			continue
		var key := name.to_lower()
		if used_names.has(key):
			continue
		used_names[key] = true

		var from := int(_num(tag.get("from", 0)))
		var to := int(_num(tag.get("to", 0)))
		from = clamp(from, 0, rects.size() - 1)
		to = clamp(to, 0, rects.size() - 1)
		if from > to:
			var tmp := from
			from = to
			to = tmp

		var direction := String(tag.get("direction", "forward")).strip_edges()
		if direction.is_empty():
			direction = "forward"

		sprite_frames.add_animation(name)
		sprite_frames.set_animation_speed(name, fps)
		sprite_frames.set_animation_loop(name, loop)

		var frame_count := 0
		match direction:
			"reverse":
				for idx in range(to, from - 1, -1):
					var at := AtlasTexture.new()
					at.atlas = sheet_texture
					at.region = rects[idx]
					sprite_frames.add_frame(name, at)
					frame_count += 1
			"pingpong":
				for idx in range(from, to + 1):
					var at := AtlasTexture.new()
					at.atlas = sheet_texture
					at.region = rects[idx]
					sprite_frames.add_frame(name, at)
					frame_count += 1
				for idx in range(to - 1, from, -1):
					var at := AtlasTexture.new()
					at.atlas = sheet_texture
					at.region = rects[idx]
					sprite_frames.add_frame(name, at)
					frame_count += 1
			_:
				for idx in range(from, to + 1):
					var at := AtlasTexture.new()
					at.atlas = sheet_texture
					at.region = rects[idx]
					sprite_frames.add_frame(name, at)
					frame_count += 1

		animations.append({ "name": name, "from": from, "to": to, "direction": direction, "frames": frame_count })

	if animations.size() == 0:
		return _err("No valid frameTags found in Aseprite JSON", { "aseprite_json_path": res_json })

	var res_out := _to_res_path(sprite_frames_path)
	var dir_err := _ensure_dir_for_res_path(res_out)
	if dir_err != OK:
		return _err("Failed to create output directory", { "error": dir_err, "dir": res_out.get_base_dir() })

	var save_err := ResourceSaver.save(sprite_frames, res_out)
	if save_err != OK:
		return _err("Failed to save SpriteFrames", { "error": save_err, "sprite_frames_path": res_out })

	return _ok(
		"SpriteFrames generated",
		{
			"sprite_frames_path": res_out,
			"absolute_path": ProjectSettings.globalize_path(res_out),
			"spritesheet_path": res_sheet,
			"aseprite_json_path": res_json,
			"frame_count": rects.size(),
			"animations": animations,
			"fps": fps,
			"loop": loop,
		}
	)

