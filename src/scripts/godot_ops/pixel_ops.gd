extends "pixel_ops_base.gd"

# Backwards-compatible wrapper for older module paths. The main registry loads
# pixel_*_ops.gd modules directly.

var _tileset_ops: Object = null
var _world_ops: Object = null
var _object_ops: Object = null
var _sprite_ops: Object = null

func _ensure_modules() -> void:
	if _tileset_ops != null:
		return
	_tileset_ops = preload("pixel_tileset_ops.gd").new(ctx)
	_world_ops = preload("pixel_world_ops.gd").new(ctx)
	_object_ops = preload("pixel_object_ops.gd").new(ctx)
	_sprite_ops = preload("pixel_sprite_ops.gd").new(ctx)

func get_operations() -> Dictionary:
	_ensure_modules()
	return {
		"op_tileset_create_from_atlas": Callable(_tileset_ops, "op_tileset_create_from_atlas"),
		"op_world_scene_ensure_layers": Callable(_world_ops, "op_world_scene_ensure_layers"),
		"op_world_generate_tiles": Callable(_world_ops, "op_world_generate_tiles"),
		"op_place_objects_tile": Callable(_object_ops, "op_place_objects_tile"),
		"op_place_objects_scene_instances": Callable(_object_ops, "op_place_objects_scene_instances"),
		"op_spriteframes_from_aseprite_json": Callable(_sprite_ops, "op_spriteframes_from_aseprite_json"),
		"op_export_preview": Callable(_world_ops, "op_export_preview"),
	}

