@tool
extends EditorPlugin

const DEFAULT_PORT := 8765

var _bridge_server: Node = null
var _handlers: RefCounted = null

func _enter_tree() -> void:
	var token := _read_token()
	var port := DEFAULT_PORT
	if OS.has_environment("GODOT_MCP_PORT"):
		port = int(OS.get_environment("GODOT_MCP_PORT"))

	_handlers = preload("rpc_handlers.gd").new(self, get_undo_redo())
	_bridge_server = preload("bridge_server.gd").new()
	add_child(_bridge_server)

	var result: Dictionary = _bridge_server.start(port, token, _handlers)
	if bool(result.get("ok", false)):
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
