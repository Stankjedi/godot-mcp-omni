# godot-mcp-omni

> **"AI가 Godot 게임 개발을 자동화할 수 있는 MCP 서버"**

`Coding-Solo/godot-mcp`의 확장 포크로, **headless 자동화**와 **에디터 실시간 제어**를 모두 지원합니다.

[![MCP Server](https://badge.mcpx.dev?type=server)](https://modelcontextprotocol.io/introduction)
[![Made with Godot](https://img.shields.io/badge/Made%20with-Godot%204.4+-478CBF?style=flat&logo=godot%20engine&logoColor=white)](https://godotengine.org)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-red.svg)](https://opensource.org/licenses/MIT)
[![후원페이지](https://img.shields.io/badge/후원페이지-Stankjedi-ff69b4?style=flat)](https://ctee.kr/place/stankjedi)

---

## ✨ 추가된 기능

[Coding-Solo/godot-mcp](https://github.com/Coding-Solo/godot-mcp) 기반으로 다음 기능들이 추가되었습니다:

### 🎬 Headless 작업 (CI/CD 지원)

- **Scene 관리**: `create_scene`, `add_node`, `save_scene` - GUI 없이 씬 생성/편집
- **텍스처 로딩**: `load_sprite` - PNG, SVG 텍스처를 Sprite에 로드
- **MeshLibrary**: `export_mesh_library` - 3D 씬을 GridMap용 라이브러리로 익스포트
- **에셋 임포트**: `godot_import_project_assets` - headless 모드에서 에셋 임포트

### 🔌 에디터 브릿지 (실시간 제어)

- **연결**: `godot_connect_editor` - 실행 중인 에디터와 TCP 연결
- **RPC 호출**: `godot_rpc` - 에디터에 직접 명령 전송
- **검사**: `godot_inspect` - 클래스/노드/인스턴스 정보 조회

### 🔧 UID 관리 (Godot 4.4+)

- `get_uid` - 파일의 UID 조회
- `update_project_uids` - 프로젝트 전체 UID 갱신

### 📊 진단 개선

- 연결 실패 시 상세 diagnostics + 해결 suggestions 제공
- 타입 안전한 입력 검증 (`unknown` + 런타임 체크)

---

## 📦 요구사항

- **Godot Engine 4.4+** ([다운로드](https://godotengine.org/download))
- **Node.js 20+** ([다운로드](https://nodejs.org/))
- **MCP 지원 AI 어시스턴트** (Cline, Cursor, Claude Desktop 등)

---

## 🚀 빠른 시작

### 1. 설치

```bash
git clone https://github.com/your-username/godot-mcp-omni.git
cd godot-mcp-omni
npm install
npm run build
```

### 2. 테스트 실행

```bash
# 단위 테스트
npm test

# 기본 검증 (CI-safe)
npm run verify:all

# 전체 검증 (로컬, Godot 필요)
GODOT_PATH=/path/to/godot npm run verify:full

# (선택) Godot 기반 검증만 실행
GODOT_PATH=/path/to/godot npm run verify:examples
GODOT_PATH=/path/to/godot VERIFY_MCP_SKIP_EDITOR=true npm run verify:mcp

# (선택) README/스프라이트 검증용 프로젝트 경로 오버라이드 (기본: <repoRoot>/.tmp/readme-test)
VERIFY_PROJECT_PATH=/abs/path/to/project GODOT_PATH=/path/to/godot npm run verify:examples
```

### 3. AI 어시스턴트에 연결

#### Cline 설정 (`cline_mcp_settings.json`)

```json
{
  "mcpServers": {
    "godot": {
      "command": "node",
      "args": ["/absolute/path/to/godot-mcp-omni/build/index.js"],
      "env": {
        "GODOT_PATH": "/path/to/godot"
      }
    }
  }
}
```

#### Cursor 설정 (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "godot": {
      "command": "node",
      "args": ["/absolute/path/to/godot-mcp-omni/build/index.js"]
    }
  }
}
```

---

## 🛠️ MCP 도구 레퍼런스

### 프로젝트 관리

| 도구                | 설명                             | 주요 파라미터                                 |
| ------------------- | -------------------------------- | --------------------------------------------- |
| `list_projects`     | 디렉토리에서 Godot 프로젝트 검색 | `directory`, `recursive`                      |
| `get_project_info`  | 프로젝트 구조 분석               | `projectPath`                                 |
| `godot_preflight`   | 환경 사전 점검                   | `projectPath`, `godotPath?`, `host?`, `port?` |
| `get_godot_version` | Godot 버전 조회                  | -                                             |
| `launch_editor`     | Godot 에디터 실행                | `projectPath`, `token?`, `port?`              |
| `run_project`       | 프로젝트 디버그 모드 실행        | `projectPath`, `scene?`                       |
| `stop_project`      | 실행 중인 프로젝트 중지          | -                                             |
| `get_debug_output`  | 디버그 출력 조회                 | -                                             |

### Scene 관리

| 도구                  | 설명                            | 주요 파라미터                                                                        |
| --------------------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| `create_scene`        | 새 Scene 생성                   | `projectPath`, `scenePath`, `rootNodeType?`                                          |
| `add_node`            | Scene에 노드 추가               | `projectPath`, `scenePath`, `nodeType`, `nodeName`, `parentNodePath?`, `properties?` |
| `save_scene`          | Scene 저장                      | `projectPath`, `scenePath`, `newPath?`                                               |
| `load_sprite`         | Sprite에 텍스처 로드            | `projectPath`, `scenePath`, `nodePath`, `texturePath`                                |
| `export_mesh_library` | 3D Scene → MeshLibrary 익스포트 | `projectPath`, `scenePath`, `outputPath`                                             |

### Headless 작업

| 도구                          | 설명                                           | 주요 파라미터                          |
| ----------------------------- | ---------------------------------------------- | -------------------------------------- |
| `godot_headless_op`           | 범용 headless 작업 실행                        | `projectPath`, `operation`, `params`   |
| `godot_headless_batch`        | 한 번의 Godot 실행으로 여러 headless 작업 수행 | `projectPath`, `steps`, `stopOnError?` |
| `godot_import_project_assets` | 프로젝트 에셋 임포트 (headless)                | `projectPath`, `godotPath?`            |

### UID 관리 (Godot 4.4+)

| 도구                  | 설명                   | 주요 파라미터             |
| --------------------- | ---------------------- | ------------------------- |
| `get_uid`             | 파일의 UID 조회        | `projectPath`, `filePath` |
| `update_project_uids` | 프로젝트 전체 UID 갱신 | `projectPath`             |

### 에디터 브릿지 (실시간 제어)

| 도구                   | 설명                      | 주요 파라미터                                           |
| ---------------------- | ------------------------- | ------------------------------------------------------- |
| `godot_sync_addon`     | MCP 브릿지 애드온 동기화  | `projectPath`, `enablePlugin?`                          |
| `godot_connect_editor` | 에디터 브릿지 연결        | `projectPath`, `token?`, `host?`, `port?`, `timeoutMs?` |
| `godot_rpc`            | 에디터에 RPC 요청 전송    | `request_json`, `timeoutMs?`                            |
| `godot_inspect`        | 클래스/노드/인스턴스 검사 | `query_json`, `timeoutMs?`                              |

---

## 🔧 환경 변수

| 변수                  | 설명                    | 기본값      |
| --------------------- | ----------------------- | ----------- |
| `GODOT_PATH`          | Godot 실행 파일 경로    | 자동 탐지   |
| `GODOT_MCP_TOKEN`     | 에디터 브릿지 인증 토큰 | -           |
| `GODOT_MCP_PORT`      | 에디터 브릿지 포트      | `8765`      |
| `GODOT_MCP_HOST`      | 에디터 브릿지 호스트    | `127.0.0.1` |
| `ALLOW_DANGEROUS_OPS` | 위험한 작업 허용 여부   | `false`     |
| `DEBUG`               | 디버그 로깅 활성화      | `false`     |

---

## 📋 사용 예시

### Scene 생성 및 노드 추가

```text
"MyGame 프로젝트에 Player.tscn 씬을 만들고 CharacterBody2D를 루트로 설정해줘"
"Player 씬에 Sprite2D 노드를 추가하고 player.png 텍스처를 로드해줘"
```

### godot_preflight (사전 점검)

에디터 브릿지/헤드리스 작업을 실행하기 전에, 프로젝트/애드온/포트/Godot 환경을 빠르게 점검합니다.

```json
{
  "projectPath": "/abs/path/to/MyGame",
  "host": "127.0.0.1",
  "port": 8765
}
```

권장 순서:

1. `godot_preflight`
2. (필요 시) `godot_sync_addon`
3. `launch_editor` 또는 `godot_connect_editor` → `godot_rpc`

### godot_headless_batch (멀티 스텝 scene flow)

```json
{
  "projectPath": "/abs/path/to/MyGame",
  "stopOnError": true,
  "steps": [
    {
      "operation": "create_scene",
      "params": {
        "scenePath": "scenes/Player.tscn",
        "rootNodeType": "CharacterBody2D"
      }
    },
    {
      "operation": "add_node",
      "params": {
        "scenePath": "scenes/Player.tscn",
        "parentNodePath": "root",
        "nodeType": "Sprite2D",
        "nodeName": "PlayerSprite"
      }
    },
    {
      "operation": "load_sprite",
      "params": {
        "scenePath": "scenes/Player.tscn",
        "nodePath": "root/PlayerSprite",
        "texturePath": "res://player.png"
      }
    },
    {
      "operation": "save_scene",
      "params": { "scenePath": "scenes/Player.tscn" }
    }
  ]
}
```

### 프로젝트 분석

```text
"MyGame 프로젝트 구조를 분석해서 개선점을 알려줘"
"현재 씬 수와 스크립트 수를 확인해줘"
```

### 에디터 제어

```text
"Godot 에디터를 실행하고 연결해줘"
"현재 열린 씬의 노드 구조를 보여줘"
```

### Headless CI/CD

```text
"프로젝트 에셋을 headless 모드로 임포트해줘"
"MeshLibrary.tres로 3D 메시를 익스포트해줘"
```

---

## 🔍 트러블슈팅

### 에디터 연결 실패

`godot_connect_editor` 실패 시 상세 진단 정보가 반환됩니다:

```json
{
  "ok": false,
  "summary": "Failed to connect editor bridge: ...",
  "details": {
    "host": "127.0.0.1",
    "port": 8765,
    "timeoutMs": 30000,
    "tokenSource": "env",
    "lockFileExists": false,
    "lastError": { "code": "ECONNREFUSED" },
    "suggestions": [
      "Confirm the editor is running and the plugin is enabled",
      "Check that the port is reachable"
    ]
  }
}
```

**해결 방법:**

1. Project Settings → Plugins에서 **Godot MCP Bridge** 활성화
2. `GODOT_MCP_TOKEN` 환경변수 또는 `.godot_mcp_token` 파일 확인
3. 방화벽에서 포트 허용

### SVG 로딩 실패

Headless 모드에서 SVG 로딩 실패 시:

```json
{
  "ok": false,
  "details": {
    "loader_path": "svg_from_string",
    "svg_loader_available": true,
    "suggestions": [
      "Prefer PNG textures for headless flows.",
      "Run an import step first or open the project once in the editor."
    ]
  }
}
```

**권장:** Headless 워크플로우에서는 PNG 사용

---

## 📁 프로젝트 구조

```
godot-mcp-omni/
├── src/
│   ├── server.ts           # MCP 서버 메인
│   ├── tools/
│   │   ├── editor.ts       # 에디터 브릿지 도구
│   │   ├── project.ts      # 프로젝트 관리 도구
│   │   ├── headless.ts     # Headless 작업 도구
│   │   └── types.ts        # 타입 정의
│   ├── scripts/
│   │   └── godot_operations.gd  # Godot 작업 스크립트
│   └── validation.ts       # 입력 검증
├── addons/
│   └── godot_mcp_bridge/   # Godot 에디터 플러그인
├── test/                   # 단위 테스트
└── scripts/
    └── verify_mcp.js       # E2E 검증 스크립트
```

---

## 📄 라이선스

MIT License - [LICENSE](LICENSE) 참조

---

## 🙏 크레딧

- 원본 프로젝트: [Coding-Solo/godot-mcp](https://github.com/Coding-Solo/godot-mcp)
