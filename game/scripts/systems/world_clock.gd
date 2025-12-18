extends RefCounted
class_name WorldClock

var day: int = 1
var hour: int = 6
var seconds_per_hour: float = 1.0

var _accum: float = 0.0

func reset(day_: int = 1, hour_: int = 6, seconds_per_hour_: float = 1.0) -> void:
	day = day_
	hour = hour_
	seconds_per_hour = max(seconds_per_hour_, 0.05)
	_accum = 0.0

func tick(delta: float) -> int:
	_accum += max(delta, 0.0)
	var hours = int(floor(_accum / seconds_per_hour))
	if hours <= 0:
		return 0
	_accum -= float(hours) * seconds_per_hour

	for _i in range(hours):
		hour += 1
		if hour >= 24:
			hour = 0
			day += 1

	return hours

func is_day() -> bool:
	return hour >= 6 and hour < 18
