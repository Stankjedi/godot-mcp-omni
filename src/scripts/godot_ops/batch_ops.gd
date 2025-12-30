extends "ops_module_base.gd"

func get_operations() -> Dictionary:
	return {
		"batch": Callable(self, "batch"),
	}

func batch(params: Dictionary) -> Dictionary:
	if not params.has("steps") or typeof(params.steps) != TYPE_ARRAY:
		return _err("steps is required", { "received_type": typeof(params.get("steps")) })

	var stop_on_error := bool(params.get("stop_on_error", true))
	var steps: Array = params.steps
	var results: Array = []
	var failed_index := -1

	for i in range(steps.size()):
		var raw_step = steps[i]
		if typeof(raw_step) != TYPE_DICTIONARY:
			return _err("Each step must be an object", { "index": i })

		var step: Dictionary = raw_step
		var op := String(step.get("operation", "")).strip_edges()
		if op.is_empty():
			return _err("operation is required", { "index": i })

		var step_params: Dictionary = {}
		if step.has("params"):
			if typeof(step.params) == TYPE_DICTIONARY:
				step_params = step.params
			elif typeof(step.params) == TYPE_STRING:
				var json := JSON.new()
				var parse_err := json.parse(String(step.params))
				if parse_err != OK or typeof(json.get_data()) != TYPE_DICTIONARY:
					return _err("Failed to parse step params", { "index": i, "operation": op })
				step_params = json.get_data()
			else:
				return _err("params must be an object or JSON string", { "index": i, "operation": op })

		var res: Dictionary = _dispatch(op, step_params)
		results.append(res)

		if not bool(res.get("ok", false)):
			failed_index = i
			if stop_on_error:
				break

	if failed_index == -1:
		return _ok("Batch completed", { "results": results })

	return _err(
		"Batch failed at step " + str(failed_index),
		{ "results": results, "failed_index": failed_index }
	)

