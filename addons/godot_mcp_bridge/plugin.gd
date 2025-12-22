@tool
extends EditorPlugin

const DEFAULT_PORT := 8765
const DEFAULT_HOST := "127.0.0.1"
const LOCK_PATH := "res://.godot_mcp/bridge.lock"
const PORT_PATH := "res://.godot_mcp_port"
const HOST_PATH := "res://.godot_mcp_host"

var _bridge_server: Node = null
var _handlers: RefCounted = null

func _enter_tree() -> void:
	var token := _read_token()
	var port := _read_port()
	var host := _read_host()

	var handlers_script = load("res://addons/godot_mcp_bridge/rpc_handlers.gd")
	if handlers_script == null:
		printerr("[godot_mcp_bridge] Failed to load script: res://addons/godot_mcp_bridge/rpc_handlers.gd")
		return

	_handlers = handlers_script.new(self, get_undo_redo())

	var bridge_script = load("res://addons/godot_mcp_bridge/bridge_server.gd")
	if bridge_script == null:
		printerr("[godot_mcp_bridge] Failed to load script: res://addons/godot_mcp_bridge/bridge_server.gd")
		_handlers = null
		return

	_bridge_server = bridge_script.new()
	add_child(_bridge_server)

	var result: Dictionary = _bridge_server.start(port, token, _handlers, host)
	if bool(result.get("ok", false)):
		_write_lock()
		print("[godot_mcp_bridge] Listening on %s:%s" % [String(result.get("host", "127.0.0.1")), str(result.get("port", port))])
		if token.is_empty():
			printerr("[godot_mcp_bridge] Warning: token is empty. Set GODOT_MCP_TOKEN or create res://.godot_mcp_token")
	else:
		printerr("[godot_mcp_bridge] Failed to start: " + str(result))

func _exit_tree() -> void:
	if _bridge_server != null:
		_bridge_server.stop()
		_bridge_server.queue_free()
		_bridge_server = null
	_clear_lock()
	_handlers = null

func _read_token() -> String:
	var t := OS.get_environment("GODOT_MCP_TOKEN")
	if not t.is_empty():
		return t.strip_edges()

	var f := FileAccess.open("res://.godot_mcp_token", FileAccess.READ)
	if f == null:
		return ""
	t = f.get_as_text().strip_edges()
	f.close()
	return t

func _read_port() -> int:
	var p := OS.get_environment("GODOT_MCP_PORT").strip_edges()
	if p.is_valid_int():
		return int(p)

	var f := FileAccess.open(PORT_PATH, FileAccess.READ)
	if f == null:
		return DEFAULT_PORT

	p = f.get_as_text().strip_edges()
	f.close()

	return int(p) if p.is_valid_int() else DEFAULT_PORT

func _read_host() -> String:
	var h := OS.get_environment("GODOT_MCP_HOST").strip_edges()
	if not h.is_empty():
		return h

	var f := FileAccess.open(HOST_PATH, FileAccess.READ)
	if f == null:
		return DEFAULT_HOST

	h = f.get_as_text().strip_edges()
	f.close()

	return h if not h.is_empty() else DEFAULT_HOST

func _write_lock() -> void:
	var dir := DirAccess.open("res://")
	if dir != null:
		dir.make_dir_recursive(".godot_mcp")
	var f := FileAccess.open(LOCK_PATH, FileAccess.WRITE)
	if f == null:
		return
	f.store_string(str(OS.get_process_id()))
	f.close()

func _clear_lock() -> void:
	if not FileAccess.file_exists(LOCK_PATH):
		return
	var abs_path := ProjectSettings.globalize_path(LOCK_PATH)
	DirAccess.remove_absolute(abs_path)
