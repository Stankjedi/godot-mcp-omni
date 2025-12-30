extends "ops_module_base.gd"

func get_operations() -> Dictionary:
	return {
		"read_text_file": Callable(self, "read_text_file"),
		"write_text_file": Callable(self, "write_text_file"),
	}

func read_text_file(params: Dictionary) -> Dictionary:
	if not params.has("path"):
		return _err("path is required")

	var file_path := _to_res_path(String(params.path))
	var f := FileAccess.open(file_path, FileAccess.READ)
	if f == null:
		return _err("Failed to open file for reading", { "error": FileAccess.get_open_error(), "path": file_path })
	var content := f.get_as_text()
	f.close()

	return _ok("File read", { "path": file_path, "content": content })

func write_text_file(params: Dictionary) -> Dictionary:
	for k in ["path", "content"]:
		if not params.has(k):
			return _err(k + " is required")

	var file_path := _to_res_path(String(params.path))
	var content := String(params.content)

	var dir_err := _ensure_dir_for_res_path(file_path)
	if dir_err != OK:
		return _err("Failed to create directory", { "error": dir_err, "dir": file_path.get_base_dir() })

	var f := FileAccess.open(file_path, FileAccess.WRITE)
	if f == null:
		return _err("Failed to open file for writing", { "error": FileAccess.get_open_error(), "path": file_path })
	f.store_string(content)
	f.close()

	return _ok("File written", { "path": file_path, "bytes": content.to_utf8_buffer().size() })
