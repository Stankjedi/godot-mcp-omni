# Game Loop (Vertical Slice)

Project: `game/`

## Playable loop

When you press Play:

- Starts in town (`%Town`)
- Assigns one initial task: `explore_forest` (travel → act/combat stub → return)
- Advances an in-game hour every 1 real second
- Prints a summary line to the Output every in-game hour

Main scene: `game/scenes/World.tscn`

Autoload: `GameState` (`game/autoload/GameState.gd`)

## Systems (stubs)

Data lives in `GameState` and lightweight system classes:

- `game/scripts/systems/world_clock.gd` — timekeeping + day/night flag
- `game/scripts/systems/needs_component.gd` — Hunger/Fatigue drift + clamping
- `game/scripts/systems/moodlet_manager.gd` — derived moodlets (5+)
- `game/scripts/systems/task_planner.gd` — utility scoring + next-task choice

Execution is handled by the actor FSM:

- `game/scripts/actor.gd` — move → act → return

## Adding/adjusting tasks

Edit `TaskPlanner.choose_next_task(...)` in `game/scripts/systems/task_planner.gd`.

Task dictionaries look like:

- `id`: `"explore_forest" | "eat" | "rest"`
- `category`: `"explore" | "town" | "maintenance"`
- `target`: `"forest" | "town"`
- `effect` (optional): `"eat" | "rest"` applied when the task completes

Tune category priorities in `GameState.priorities` (`game/autoload/GameState.gd`).

## Adding/adjusting moodlets

Moodlets are currently derived from needs thresholds in `MoodletManager.tick_hour(...)` (`game/scripts/systems/moodlet_manager.gd`).

Bias rules for task selection live in `MoodletManager.get_task_bias()`.

## Next expansion TODOs

- Replace placeholder geometry with real `TileMap` content + tileset sources
- Add real inventory/food + sleep actions instead of instant effects
- Add combat entities + HP + target selection (still no animations required)
- Replace print-only UI with interactive priority controls in the HUD

