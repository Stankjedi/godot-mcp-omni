extends CanvasLayer

@onready var time_label: Label = %TimeLabel
@onready var needs_label: Label = %NeedsLabel
@onready var moodlets_label: Label = %MoodletsLabel
@onready var task_label: Label = %TaskLabel

func _ready() -> void:
	GameState.hour_tick.connect(_on_hour_tick)

func _on_hour_tick(summary: Dictionary) -> void:
	var day = int(summary.get("day", 1))
	var hour = int(summary.get("hour", 0))
	var is_day = bool(summary.get("is_day", true))
	var hunger = float(summary.get("hunger", 0.0))
	var fatigue = float(summary.get("fatigue", 0.0))
	var moodlets: Array = summary.get("moodlets", [])
	var task: Dictionary = summary.get("task", {})
	var actor: Dictionary = summary.get("actor", {})

	time_label.text = "Day %d  %02d:00  (%s)" % [day, hour, "Day" if is_day else "Night"]
	needs_label.text = "Hunger: %.1f   Fatigue: %.1f" % [hunger, fatigue]
	moodlets_label.text = "Moodlets: %s" % [", ".join(moodlets)]
	task_label.text = "Task: %s   Loc: %s   Phase: %s" % [
		String(task.get("id", "none")),
		String(actor.get("location", "?")),
		String(actor.get("phase", "?")),
	]
