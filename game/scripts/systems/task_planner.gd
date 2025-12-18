extends RefCounted
class_name TaskPlanner

func choose_next_task(
	priorities: Dictionary,
	needs,
	moodlets,
	did_first_explore: bool
) -> Dictionary:
	# Force one initial explore trip to satisfy the vertical-slice loop.
	if not did_first_explore:
		return { "id": "explore_forest", "category": "explore", "target": "forest", "done": false }

	var bias: Dictionary = moodlets.get_task_bias()
	var explore_score = float(priorities.get("explore", 0.0)) + float(bias.get("explore", 0.0))
	var maintenance_score = float(priorities.get("maintenance", 0.0)) + float(bias.get("maintenance", 0.0))
	var town_score = float(priorities.get("town", 0.0)) + float(bias.get("town", 0.0))

	# Needs-driven utility.
	town_score += max(0.0, (needs.hunger - 60.0) / 40.0)
	maintenance_score += max(0.0, (needs.fatigue - 60.0) / 40.0)
	explore_score -= max(0.0, (needs.hunger - 70.0) / 30.0)
	explore_score -= max(0.0, (needs.fatigue - 70.0) / 30.0)

	if maintenance_score >= town_score and maintenance_score >= explore_score:
		return { "id": "rest", "category": "maintenance", "target": "town", "effect": "rest", "done": false }

	if town_score >= explore_score:
		return { "id": "eat", "category": "town", "target": "town", "effect": "eat", "done": false }

	return { "id": "explore_forest", "category": "explore", "target": "forest", "done": false }
