# Game Project (Separate Folder)

The Godot “vertical slice” game project is developed in a **separate folder** from this MCP server repo.

Recommended layout:

- `Godotomni/godot-mcp-omni/` (this repo)
- `Godotomni/game/` (Godot project repo)

Run the game (Windows example):

```powershell
$godot="C:\\path\\to\\Godot_v4.x_win64_console.exe"
& $godot --path ..\\game
```

Sync the editor bridge addon into the game project:

```powershell
cd .\\godot-mcp-omni
npm run sync:addon -- --project ..\\game
```
