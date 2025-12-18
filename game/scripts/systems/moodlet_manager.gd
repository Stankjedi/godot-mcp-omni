extends RefCounted
class_name MoodletManager

var active_ids: Array[String] = []

func reset(needs) -> void:
	tick_hour(needs)

func tick_hour(needs) -> void:
	active_ids.clear()

	# Hunger moodlets.
	if needs.hunger < 20.0:
		active_ids.append("well_fed")
	elif needs.hunger > 80.0:
		active_ids.append("starving")
	elif needs.hunger > 50.0:
		active_ids.append("hungry")

	# Fatigue moodlets.
	if needs.fatigue < 20.0:
		active_ids.append("rested")
	elif needs.fatigue > 80.0:
		active_ids.append("exhausted")

func get_task_bias() -> Dictionary:
	var bias = { "explore": 0.0, "maintenance": 0.0, "town": 0.0 }

	if active_ids.has("starving"):
		bias["town"] += 1.0
		bias["explore"] -= 1.0
	if active_ids.has("hungry"):
		bias["town"] += 0.4
		bias["explore"] -= 0.2
	if active_ids.has("exhausted"):
		bias["maintenance"] += 1.0
		bias["explore"] -= 1.0
	if active_ids.has("rested"):
		bias["explore"] += 0.2
	if active_ids.has("well_fed"):
		bias["explore"] += 0.2

	return bias
