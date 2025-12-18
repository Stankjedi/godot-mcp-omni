extends RefCounted
class_name NeedsComponent

var hunger: float = 20.0
var fatigue: float = 10.0

var hunger_per_hour: float = 4.0
var fatigue_per_hour: float = 3.0

func reset() -> void:
	hunger = 20.0
	fatigue = 10.0

func tick_hour(_actor_status: Dictionary, task: Dictionary) -> void:
	hunger += hunger_per_hour
	fatigue += fatigue_per_hour

	var task_id = String(task.get("id", ""))
	if task_id == "explore_forest" and not bool(task.get("done", false)):
		hunger += 2.0
		fatigue += 4.0

	hunger = clamp(hunger, 0.0, 100.0)
	fatigue = clamp(fatigue, 0.0, 100.0)

func apply_delta(delta_hunger: float, delta_fatigue: float) -> void:
	hunger += delta_hunger
	fatigue += delta_fatigue
	hunger = clamp(hunger, 0.0, 100.0)
	fatigue = clamp(fatigue, 0.0, 100.0)
