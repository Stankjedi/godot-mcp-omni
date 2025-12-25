# godot-mcp-omni

> **"AI가 Godot 게임 개발을 자동화할 수 있는 강력한 Unified MCP 서버"**

`Coding-Solo/godot-mcp`의 확장 포크로, **Hybrid Dispatcher** 시스템을 통해 headless 자동화와 에디터 실시간 제어를 지능적으로 통합 지원합니다.

[![MCP Server](https://badge.mcpx.dev?type=server)](https://modelcontextprotocol.io/introduction)
[![Made with Godot](https://img.shields.io/badge/Made%20with-Godot%204.4+-478CBF?style=flat&logo=godot%20engine&logoColor=white)](https://godotengine.org)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-red.svg)](https://opensource.org/licenses/MIT)
[![후원페이지](https://img.shields.io/badge/후원페이지-Stankjedi-ff69b4?style=flat)](https://ctee.kr/place/stankjedi)

---

## ✨ 주요 특징 (v0.2.0)

### 🚀 통합 관리자 시스템 (Unified Managers)
 granular한 도구들을 5개의 핵심 관리자로 통폐합하여 복잡성을 줄이고 사용성을 극대화했습니다.

- **Hybrid Dispatcher**: 에디터 연결 상태를 자동 감지하여 RPC(실시간) 또는 Headless(명령행) 모드를 지능적으로 선택합니다.
- **Auto-Type Casting**: JSON 데이터를 Godot 내장 타입(Vector3, Color, Transform 등)으로 자동 변환 지원.

### 🔌 실시간 에디터 제어 및 시각화 (Roadmap 5.4)
AI가 에디터의 눈과 손이 되어 협업할 수 있는 기능을 제공합니다.

- **Viewport Capture**: 현재 에디터 뷰포트를 스냅샷(Base64 PNG)으로 캡처하여 AI에게 전달.
- **Screen Switch**: 2D, 3D, Script 화면 간 즉각적인 전환 지원.
- **Script Editor**: 특정 스크립트 열기, 커서 이동 및 중단점(Breakpoint) 원격 관리.
- **Transactional Edition**: 에디터 내 Undo/Redo 시스템과 완벽하게 연동되는 원자적 작업 수행.

### 🎬 Headless & CI/CD 자동화
GUI 없이도 강력한 프로젝트 조작이 가능합니다.

- **Atomic Batching**: 여러 작업을 한 번의 Godot 실행으로 처리하는 배치 작업 지원.
- **Asset Pipeline**: 텍스처 로딩, UID 조회 및 업데이트(Godot 4.4+) 기능 제공.

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

### 2. AI 어시스턴트에 연결

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

---

## 🛠️ MCP 도구 레퍼런스

### 🏗️ Godot Scene Manager (`godot_scene_manager`)
씬과 노드 구조를 관리합니다. (Hybrid 지원)

| 액션 | 설명 | 주요 파라미터 |
| :--- | :--- | :--- |
| `create` | 노드 생성 (씬 내) | `nodeType`, `nodeName`, `parentNodePath?`, `props?`, (Headless: `projectPath`, `scenePath`) |
| `duplicate` | 노드 복제 | `nodePath`, `newName?` |
| `reparent` | 노드 부모 변경 | `nodePath`, `newParentPath`, `index?` |
| `instance` | 씬을 노드로 인스턴스화 | `scenePath`, `parentNodePath?`, `name?`, `props?` |
| `remove` | 노드 삭제 | `nodePath` |
| `undo` | 마지막 작업 취소 | - |
| `redo` | 취소한 작업 다시 실행 | - |


---

### 🔍 Godot Inspector Manager (`godot_inspector_manager`)
노드와 리소스의 속성을 검사하고 수정합니다. (Hybrid 지원)

| 액션 | 설명 | 주요 파라미터 |
| :--- | :--- | :--- |
| `query` | 씬 트리 노드 검색 | `name?`, `nameContains?`, `className?`, `group?`, `limit?` |
| `inspect` | 클래스/노드/인스턴스 정보 조회 | `className`, `nodePath`, 또는 `instanceId` (하나 선택) |
| `select` | 에디터에서 노드 선택 | `nodePath` 또는 `instanceId`, `additive?` |
| `connect_signal` | 시그널 연결 | `fromNodePath`, `signal`, `toNodePath`, `method` |
| `disconnect_signal` | 시그널 연결 해제 | `fromNodePath`, `signal`, `toNodePath`, `method` |
| `property_list` | 프로퍼티 목록 조회 | `className`, `nodePath`, 또는 `instanceId` (하나 선택) |

---

### 🎨 Godot Asset Manager (`godot_asset_manager`)
프로젝트 자산과 UID 시스템을 관리합니다.

| 액션 | 설명 | 주요 파라미터 |
| :--- | :--- | :--- |
| `load_texture` | Sprite2D에 텍스처 로드 | `projectPath`, `scenePath`, `nodePath`, `texturePath` |
| `get_uid` | 파일의 UID 조회 (Godot 4.4+) | `projectPath`, `filePath` |
| `scan` | 파일시스템 스캔 | - (에디터) 또는 `projectPath` (Headless) |
| `reimport` | 특정 파일 재임포트 | `files` (배열) |
| `auto_import_check` | 헤드리스 임포트 | `projectPath`, `godotPath?` |

---

### 🚀 Godot Workspace Manager (`godot_workspace_manager`)
프로젝트 라이프사이클 및 에디터 연결을 관리합니다.

| 액션 | 설명 | 주요 파라미터 |
| :--- | :--- | :--- |
| `launch` | Godot 에디터 실행 | `projectPath`, `token?`, `port?`, `godotPath?` |
| `connect` | 에디터 브릿지 TCP 연결 | `projectPath`, `token?`, `host?`, `port?`, `timeoutMs?` |
| `run` | 프로젝트 디버그 모드 실행 | `projectPath?`, `scene?`, `mode?` (auto/headless) |
| `stop` | 실행 중인 프로젝트 중지 | `mode?` (auto/headless) |
| `restart` | 프로젝트 재시작 | `projectPath?`, `mode?` (auto/headless) |
| `open_scene` | 에디터에서 씬 열기 | `scenePath` |
| `save_all` | 모든 씬 저장 | - |

---

### 📺 Godot Editor View Manager (`godot_editor_view_manager`)
에디터 GUI를 직접 제어합니다. (Editor Only)

| 액션 | 설명 | 주요 파라미터 |
| :--- | :--- | :--- |
| `capture_viewport` | 에디터 뷰포트 스냅샷 캡처 (Base64 PNG) | `maxSize?`, `savePath?` |
| `switch_screen` | 메인 화면 전환 (2D/3D/Script) | `screenName` |
| `edit_script` | 스크립트 파일 열기 및 이동 | `scriptPath`, `lineNumber?` |
| `add_breakpoint` | 스크립트에 중단점 추가 | `scriptPath`, `lineNumber` |

---

### ⚙️ Headless Batch Operations
GUI 없이 여러 작업을 한 번에 처리합니다.

| 도구 | 설명 | 주요 파라미터 |
| :--- | :--- | :--- |
| `godot_headless_op` | 단일 헤드리스 작업 실행 | `projectPath`, `operation`, `params` |
| `godot_headless_batch` | 다중 스텝 배치 작업 실행 | `projectPath`, `steps` (배열), `stopOnError?` |

---

### 🔧 Low-Level RPC (`godot_rpc`)
에디터 브릿지에 직접 RPC 요청을 전송합니다.

| 도구 | 설명 | 주요 파라미터 |
| :--- | :--- | :--- |
| `godot_rpc` | Raw RPC JSON 요청 | `request_json` (`{ method, params }`), `timeoutMs?` |
| `godot_inspect` | 클래스/노드/인스턴스 정보 조회 | `query_json`, `timeoutMs?` |

---


## 🔧 환경 변수

| 변수 | 설명 | 기본값 |
| :--- | :--- | :--- |
| `GODOT_PATH` | Godot 실행 파일 경로 | 자동 탐지 |
| `GODOT_MCP_TOKEN` | 에디터 브릿지 인증 토큰 | - |
| `GODOT_MCP_PORT` | 에디터 브릿지 포트 | `8765` |
| `ALLOW_DANGEROUS_OPS`| 위험한 작업 허용 여부 | `false` |

---

## 📋 사용 예시

### AI에게 시각적 정보 요청
> "지금 에디터 뷰포트 상황을 캡처해서 보여줘"

### 노드 생성 및 프로퍼티 설정 (Auto-Casting)
> "CharacterBody2D 노드를 'Player'라는 이름으로 추가하고, Position을 (100, 200, 0)으로 설정해줘"

### 스크립트 디버깅 보조
> "Player.gd 파일을 열고 15번 라인에 중단점을 걸어줘"

---

## 📁 프로젝트 구조

```
godot-mcp-omni/
├── src/
│   ├── server.ts           # MCP 서버 메인
│   ├── tools/
│   │   ├── scene.ts        # Scene Manager
│   │   ├── inspector.ts    # Inspector Manager
│   │   ├── asset.ts        # Asset Manager
│   │   ├── workspace.ts    # Workspace Manager
│   │   └── view.ts         # Editor View Manager
│   ├── scripts/
│   │   └── godot_operations.gd  # Headless 엔진
│   └── bridge/             # RPC Dispatcher 로직
├── addons/
│   └── godot_mcp_bridge/   # Godot 에디터 플러그인 (v0.2.0)
└── test/                   # 검증 테스트 세트
```

---

## 🙏 크레딧

- 원본 프로젝트: [Coding-Solo/godot-mcp](https://github.com/Coding-Solo/godot-mcp)
- 확장 및 유지보수: [Stankjedi](https://github.com/Stankjedi)
