extends Node2D

@onready var town: Node2D = %Town
@onready var forest: Node2D = %Forest
@onready var actor: Node2D = %Actor

func _ready() -> void:
	if actor.has_method("configure"):
		actor.call("configure", town.position, forest.position)
	if actor.has_method("set_process"):
		actor.call("set_process", true)

	GameState.hour_tick.connect(_on_hour_tick)
	GameState.start()

func _on_hour_tick(summary: Dictionary) -> void:
	var is_day = bool(summary.get("is_day", true))
	modulate = Color(1, 1, 1, 1) if is_day else Color(0.4, 0.4, 0.6, 1)
