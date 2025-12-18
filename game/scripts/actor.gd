extends Node2D
class_name Actor

enum Phase { IDLE, MOVE_TO_TARGET, ACTING, RETURNING }

var speed_px_per_sec := 120.0
var home_pos := Vector2.ZERO
var forest_pos := Vector2.ZERO
var target_pos := Vector2.ZERO
var phase := Phase.IDLE
var task: Dictionary = {}
var act_hours_left := 0

func configure(home: Vector2, forest: Vector2) -> void:
	home_pos = home
	forest_pos = forest
	position = home_pos

func _ready() -> void:
	set_process(true)
	GameState.task_assigned.connect(_on_task_assigned)
	GameState.hour_tick.connect(_on_hour_tick)

func _process(delta: float) -> void:
	match phase:
		Phase.MOVE_TO_TARGET, Phase.RETURNING:
			_move_towards(delta)
		_:
			pass

func _move_towards(delta: float) -> void:
	var dir = target_pos - position
	var dist = dir.length()
	if dist <= 1.0:
		position = target_pos
		_on_arrived()
		return
	var step = speed_px_per_sec * delta
	position += dir.normalized() * min(step, dist)

func _on_task_assigned(t: Dictionary) -> void:
	task = t.duplicate(true)
	act_hours_left = 0

	var target = String(task.get("target", "town"))
	if target == "forest":
		target_pos = forest_pos
		phase = Phase.MOVE_TO_TARGET
		GameState.set_actor_status("travel", "move_to_forest")
		return

	# Town tasks.
	target_pos = home_pos
	if position.distance_to(home_pos) > 1.0:
		phase = Phase.RETURNING
		GameState.set_actor_status("travel", "return_to_town")
		return

	phase = Phase.ACTING
	act_hours_left = 1
	GameState.set_actor_status("town", "act")

func _on_arrived() -> void:
	var target = String(task.get("target", "town"))

	if phase == Phase.MOVE_TO_TARGET and target == "forest":
		phase = Phase.ACTING
		act_hours_left = 1
		GameState.set_actor_status("forest", "act")

		# Combat stub (no animations yet).
		GameState.apply_action_effect("combat")
		print("[Combat] Auto-combat stub: fought a slime.")
		return

	# Arrived back in town.
	phase = Phase.ACTING
	act_hours_left = 1
	GameState.set_actor_status("town", "act")

func _on_hour_tick(_summary: Dictionary) -> void:
	if phase != Phase.ACTING:
		return

	act_hours_left -= 1
	if act_hours_left > 0:
		return

	var target = String(task.get("target", "town"))
	if target == "forest":
		# Done acting in forest -> return to town.
		target_pos = home_pos
		phase = Phase.RETURNING
		GameState.set_actor_status("travel", "return_to_town")
		return

	# Done acting in town -> task complete.
	phase = Phase.IDLE
	GameState.set_actor_status("town", "idle")
	GameState.mark_task_done()
