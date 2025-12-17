@tool
extends Node

var _server := TCPServer.new()
var _client: StreamPeerTCP = null
var _buffer := ""
var _authed := false
var _token := ""
var _handlers: RefCounted = null
var _host := "127.0.0.1"
var _port := 0

func start(port: int, token: String, handlers: RefCounted) -> Dictionary:
	_token = token.strip_edges()
	_handlers = handlers
	_host = "127.0.0.1"
	_port = port

	var err := _server.listen(port, _host)
	if err != OK:
		return { "ok": false, "error": "listen_failed", "details": { "error": err, "host": _host, "port": port } }

	set_process(true)
	return { "ok": true, "host": _host, "port": port }

func stop() -> void:
	set_process(false)
	_authed = false
	_buffer = ""
	if _client != null:
		_client.disconnect_from_host()
		_client = null
	_server.stop()

func _process(_delta: float) -> void:
	if _server.is_connection_available():
		var next_client := _server.take_connection()
		if _client != null:
			_client.disconnect_from_host()
		_client = next_client
		_client.set_no_delay(true)
		_buffer = ""
		_authed = false

	if _client == null:
		return

	_client.poll()
	var status := _client.get_status()
	if status != StreamPeerTCP.STATUS_CONNECTED:
		return

	var avail := _client.get_available_bytes()
	if avail > 0:
		var packet := _client.get_partial_data(avail)
		var err := int(packet[0])
		var data: PackedByteArray = packet[1]
		if err == OK and data.size() > 0:
			_buffer += data.get_string_from_utf8()

	while true:
		var idx := _buffer.find("\n")
		if idx == -1:
			break
		var line := _buffer.substr(0, idx).strip_edges()
		_buffer = _buffer.substr(idx + 1)
		if line.is_empty():
			continue
		_handle_line(line)

func _handle_line(line: String) -> void:
	var json := JSON.new()
	var err := json.parse(line)
	if err != OK:
		_send({ "type": "error", "error": "bad_json", "details": { "message": json.get_error_message(), "line": json.get_error_line() } })
		return

	var msg := json.get_data()
	if typeof(msg) != TYPE_DICTIONARY:
		_send({ "type": "error", "error": "bad_message", "details": { "expected": "object" } })
		return

	if not _authed:
		_handle_hello(msg)
		return

	_handle_request(msg)

func _handle_hello(msg: Dictionary) -> void:
	if _token.is_empty():
		_send({ "type": "hello_error", "error": "Server token not configured. Set GODOT_MCP_TOKEN or res://.godot_mcp_token." })
		return

	if String(msg.get("type", "")) != "hello":
		_send({ "type": "hello_error", "error": "First message must be {type:\"hello\", token:\"...\"}." })
		return

	var token := String(msg.get("token", ""))
	if token != _token:
		_send({ "type": "hello_error", "error": "Invalid token." })
		return

	_authed = true
	var caps: Dictionary = {}
	if _handlers != null and _handlers.has_method("capabilities"):
		caps = _handlers.capabilities()

	_send({ "type": "hello_ok", "capabilities": caps })

func _handle_request(msg: Dictionary) -> void:
	var id_v := msg.get("id", null)
	if typeof(id_v) != TYPE_INT:
		_send({ "id": 0, "ok": false, "error": { "message": "Missing numeric id" } })
		return

	var id := int(id_v)
	var method := String(msg.get("method", ""))
	var params_v := msg.get("params", {})
	var params: Dictionary = params_v if typeof(params_v) == TYPE_DICTIONARY else {}

	if _handlers == null or not _handlers.has_method("handle"):
		_send({ "id": id, "ok": false, "error": { "message": "Handlers not available" } })
		return

	var resp: Dictionary = _handlers.handle(method, params)
	if bool(resp.get("ok", false)):
		_send({ "id": id, "ok": true, "result": resp.get("result", null) })
	else:
		_send({ "id": id, "ok": false, "error": resp.get("error", { "message": "Unknown error" }) })

func _send(obj: Dictionary) -> void:
	if _client == null:
		return

	var payload := (JSON.stringify(obj) + "\n").to_utf8_buffer()
	_client.put_data(payload)
