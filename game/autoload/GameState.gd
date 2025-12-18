extends Node

signal hour_tick(summary: Dictionary)
signal task_assigned(task: Dictionary)

const WorldClockScript := preload("res://scripts/systems/world_clock.gd")
const NeedsComponentScript := preload("res://scripts/systems/needs_component.gd")
const MoodletManagerScript := preload("res://scripts/systems/moodlet_manager.gd")
const TaskPlannerScript := preload("res://scripts/systems/task_planner.gd")

var clock
var needs
var moodlets
var planner

var priorities = {
	"explore": 1.0,
	"maintenance": 0.6,
	"town": 0.6,
}

var current_task: Dictionary = {}
var actor_status = {
	"location": "town",
	"phase": "idle",
}

var _started = false
var _did_first_explore = false

func _ready() -> void:
	clock = WorldClockScript.new()
	needs = NeedsComponentScript.new()
	moodlets = MoodletManagerScript.new()
	planner = TaskPlannerScript.new()
	set_process(false)

func start() -> void:
	if _started:
		return
	_started = true

	clock.reset(1, 6, 1.0) # Day 1, 06:00, 1 second per in-game hour.
	needs.reset()
	moodlets.reset(needs)

	set_process(true)
	_assign_task_if_needed()
	_emit_hour_summary(false)

func _process(delta: float) -> void:
	var advanced = int(clock.tick(delta))
	if advanced <= 0:
		return
	for _i in range(advanced):
		_on_hour_passed()

func _on_hour_passed() -> void:
	needs.tick_hour(actor_status, current_task)
	moodlets.tick_hour(needs)
	_assign_task_if_needed()
	_emit_hour_summary(true)

func _assign_task_if_needed() -> void:
	if current_task.is_empty() or bool(current_task.get("done", false)):
		current_task = planner.choose_next_task(priorities, needs, moodlets, _did_first_explore)
		if String(current_task.get("id", "")) == "explore_forest":
			_did_first_explore = true
		emit_signal("task_assigned", current_task)

func set_actor_status(location: String, phase: String) -> void:
	actor_status["location"] = location
	actor_status["phase"] = phase

func mark_task_done(result: Dictionary = {}) -> void:
	if current_task.is_empty():
		return
	current_task["done"] = true
	if not result.is_empty():
		current_task["result"] = result

	var effect = String(current_task.get("effect", ""))
	if effect == "eat":
		apply_action_effect("eat")
	elif effect == "rest":
		apply_action_effect("rest")

func apply_action_effect(effect_id: String) -> void:
	match effect_id:
		"eat":
			needs.apply_delta(-35.0, 0.0)
		"rest":
			needs.apply_delta(0.0, -45.0)
		"combat":
			needs.apply_delta(0.0, 8.0)
		_:
			pass

func _emit_hour_summary(print_line: bool) -> void:
	var summary = {
		"day": clock.day,
		"hour": clock.hour,
		"is_day": clock.is_day(),
		"hunger": needs.hunger,
		"fatigue": needs.fatigue,
		"moodlets": moodlets.active_ids,
		"task": current_task,
		"actor": actor_status,
		"priorities": priorities,
	}

	if print_line:
		var moodlet_text = ",".join(moodlets.active_ids)
		print(
			"[Day %d %02d:00] loc=%s phase=%s task=%s hunger=%.1f fatigue=%.1f moodlets=%s"
			% [
				clock.day,
				clock.hour,
				String(actor_status.get("location", "")),
				String(actor_status.get("phase", "")),
				String(current_task.get("id", "none")),
				needs.hunger,
				needs.fatigue,
				moodlet_text,
			]
		)

	emit_signal("hour_tick", summary)
