extends "ops_module_base.gd"

func _tile_size_from_any(params: Dictionary, keys: Array, fallback: Vector2i) -> Vector2i:
	for k in keys:
		if not params.has(k):
			continue
		var v = params.get(k)
		match typeof(v):
			TYPE_INT, TYPE_FLOAT, TYPE_STRING:
				var n := int(_num(v, float(fallback.x)))
				if n > 0:
					return Vector2i(n, n)
			_:
				return _vec2i_from(v, fallback)
	return fallback

func _map_size_from(value, fallback: Vector2i) -> Vector2i:
	var v = _json_to_variant(value)
	if typeof(v) == TYPE_VECTOR2I:
		return v
	if typeof(v) == TYPE_VECTOR2:
		return Vector2i(int((v as Vector2).x), int((v as Vector2).y))
	if typeof(v) == TYPE_ARRAY:
		var a: Array = v
		if a.size() >= 2:
			return Vector2i(int(_num(a[0])), int(_num(a[1])))
	if typeof(v) == TYPE_DICTIONARY:
		var d: Dictionary = v
		if d.has("width") and d.has("height"):
			return Vector2i(int(_num(d.get("width"))), int(_num(d.get("height"))))
		if d.has("w") and d.has("h"):
			return Vector2i(int(_num(d.get("w"))), int(_num(d.get("h"))))
		if d.has("x") and d.has("y"):
			return Vector2i(int(_num(d.get("x"))), int(_num(d.get("y"))))
	return fallback

func _method_argc(obj: Object, method_name: String) -> int:
	if obj == null:
		return -1
	if not obj.has_method(method_name):
		return -1
	var list := obj.get_method_list()
	for m in list:
		if typeof(m) != TYPE_DICTIONARY:
			continue
		var d: Dictionary = m
		if String(d.get("name", "")) != method_name:
			continue
		if d.has("args") and typeof(d.get("args")) == TYPE_ARRAY:
			return (d.get("args") as Array).size()
	return -1

func _layer_set_cell(layer: Object, coords: Vector2i, source_id: int, atlas_coords: Vector2i, alternative: int) -> void:
	if layer == null:
		return
	if not layer.has_method("set_cell"):
		return
	var argc := _method_argc(layer, "set_cell")
	if argc == 2:
		layer.call("set_cell", coords, source_id)
	elif argc == 3:
		layer.call("set_cell", coords, source_id, atlas_coords)
	else:
		layer.call("set_cell", coords, source_id, atlas_coords, alternative)

func _layer_get_cell_atlas(layer: Object, coords: Vector2i) -> Vector2i:
	if layer == null:
		return Vector2i(-1, -1)
	if not layer.has_method("get_cell_atlas_coords"):
		return Vector2i(-1, -1)
	var argc := _method_argc(layer, "get_cell_atlas_coords")
	if argc == 1:
		var v = layer.call("get_cell_atlas_coords", coords)
		if typeof(v) == TYPE_VECTOR2I:
			return v
		if typeof(v) == TYPE_VECTOR2:
			return Vector2i(int((v as Vector2).x), int((v as Vector2).y))
	return Vector2i(-1, -1)

func _layer_clear(layer: Object) -> void:
	if layer == null:
		return
	if layer.has_method("clear"):
		layer.call("clear")

func _ensure_child(parent: Node, name: String, type_name: String) -> Node:
	if parent == null:
		return null
	var existing := parent.get_node_or_null(name)
	if existing != null:
		return existing
	var inst = _instantiate_class(type_name)
	if inst == null or not (inst is Node):
		return null
	var node := inst as Node
	node.name = name
	parent.add_child(node)
	return node

func _atlas_from_mapping(mapping: Dictionary, key: String, fallback: Vector2i) -> Vector2i:
	if mapping.has(key):
		return _vec2i_from(mapping.get(key), fallback)
	return fallback

func _find_layer_node(root: Node, name: String) -> Node:
	if root == null:
		return null
	var tile_layers := root.get_node_or_null("TileLayers")
	if tile_layers != null:
		var n := tile_layers.get_node_or_null(name)
		if n != null:
			return n
	return root.get_node_or_null(name)

func _atlas_list_from(value) -> Array:
	var out: Array = []
	if typeof(value) == TYPE_ARRAY:
		for raw in value:
			out.append(_vec2i_from(raw, Vector2i(-1, -1)))
	return out

func _atlas_in_list(atlas: Vector2i, list: Array) -> bool:
	for v in list:
		if typeof(v) == TYPE_VECTOR2I and v == atlas:
			return true
	return false

func _is_near_atlas(layer: Object, pos: Vector2i, targets: Array, dist: int, map_size: Vector2i) -> bool:
	if layer == null:
		return false
	if targets.size() == 0:
		return false
	if dist <= 0:
		return false
	for dy in range(-dist, dist + 1):
		var ny := pos.y + dy
		if ny < 0 or ny >= map_size.y:
			continue
		for dx in range(-dist, dist + 1):
			var nx := pos.x + dx
			if nx < 0 or nx >= map_size.x:
				continue
			var at := _layer_get_cell_atlas(layer, Vector2i(nx, ny))
			if _atlas_in_list(at, targets):
				return true
	return false

