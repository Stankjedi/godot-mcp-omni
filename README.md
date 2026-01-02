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

### 🧩 Pixel Pipeline (2D)

타일 시트 → 월드 → 오브젝트 생성까지 한 번에 자동화하는 2D 픽셀 파이프라인을 제공합니다.

- **타일셋/월드/오브젝트 생성**: TileSet/TileMapLayer/오브젝트 스프라이트 자동 생성
- **매크로 오케스트레이션**: `pixel_macro_run` 또는 `pixel_manager(action="macro_run")`로 단일 요청 실행
- **재현성 기록**: `res://.godot_mcp/pixel_manifest.json`에 실행 결과 기록

간단 예시:

```json
{
  "tool": "pixel_manager",
  "args": {
    "action": "macro_run",
    "projectPath": "/abs/path/to/project",
    "goal": "tilemap + world + objects (size 64x64, forest/grass/river)"
  }
}
```

자세한 사용법은 `docs/pixel_pipeline.md`를 참고하세요.

### 🧩 Macro Manager (Sequential Automation)

`macro_manager`는 “게임 기능 개발”을 위한 **순차 실행 매크로**(스캐폴딩) 도구입니다.

- 예: 입력/플레이어/카메라/UI/세이브/오디오 같은 시스템 뼈대를 프로젝트에 생성
- 출력은 기본적으로 `res://scripts/macro/...`, `res://scenes/generated/macro/...` 아래에 생성
- 실행 기록은 `res://.godot_mcp/macro_manifest.json`에 저장

자세한 사용법은 `docs/macro_manager.md`를 참고하세요.

관련 환경 변수:

- `ALLOW_EXTERNAL_TOOLS`
- `IMAGE_GEN_URL`
- `SPEC_GEN_URL`

### 🧭 Workflow (도구 호출 오케스트레이션)

여러 MCP 도구 호출을 “단계(steps)”로 묶어 순차 실행/검증할 수 있습니다.

- 스키마: `scripts/workflow.schema.json`
- 최소 예시: `scripts/workflow_example.json`
- 실행 스크립트: `scripts/run_workflow.js` (`npm run workflow:run`)
- 가이드: `docs/workflow.md`

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

### 2. MCP 서버 연결 (Cursor / VS Code / Antigravity)

#### ✅ 공통 개념 (중요)

- 이 프로젝트는 **MCP stdio 서버**입니다. 즉, 대부분의 MCP 클라이언트는 서버를 “실행(Command)”하고, **stdin/stdout**으로 통신합니다.
- `npm run build` 이후 실제 엔트리포인트는 `build/index.js` 입니다.
- 가장 단순한 실행 형태:
  ```bash
  node /absolute/path/to/godot-mcp-omni/build/index.js
  ```
- (추가) CLI 옵션:
  - `--help`, `--version`
  - `--doctor`: 서버를 시작하지 않고 환경/프로젝트 점검 후 종료 (exit code: 0/1)
    - (선택) `--project <path>`: 프로젝트 체크 활성화(미지정 시 환경 체크만 수행)
      - 참고: `--project` 사용 시 Doctor가 프로젝트에 **브리지 애드온을 자동 동기화/활성화**하고, 필요하면 `.godot_mcp_token`을 **자동 생성**할 수 있습니다(토큰 값은 출력하지 않음).
      - 또한 가능한 경우 **headless 에디터를 자동 실행**하여 Editor Bridge 연결(`health`)까지 검증합니다.
      - (WSL 주의) WSL에서 Windows Godot(`.exe`)를 실행하는 경우, 연결 검증을 위해 **0.0.0.0 바인딩 + WSL 게이트웨이 IP** 경유 접속을 시도할 수 있습니다.
    - (선택) `--doctor-readonly`: `--project` 사용 시 프로젝트 파일을 **수정하지 않고** 점검만 수행합니다(읽기 전용).
      - 자동 애드온 동기화/플러그인 활성화/토큰 생성/host·port 파일 쓰기/lock 파일 정리/에디터 자동 실행을 수행하지 않고, 필요한 조치를 `suggestions`로 안내합니다.
    - (선택) `--json`: 결과를 JSON으로 출력(기계 판독용, `--doctor`와 함께만 사용 가능)
      - 스키마(요약): `{ ok, summary, details: { godot, project? }, suggestions }`
  - `--run-scenarios`: CI-safe 시나리오 스모크 테스트 실행 후 종료 (exit code: 0/1)
  - `--godot-path <path>`: `GODOT_PATH` 대신 명시적으로 Godot 경로 지정(우선 적용)
  - `--strict-path-validation`: Godot 경로 검증을 엄격 모드로 실행
  - `--debug`: 디버그 로그 활성화(`DEBUG=true`)
  - `--print-mcp-config`: MCP 서버 설정 JSON 출력 후 종료 (IDE 연동시 활용)
  - `--list-tools`: 사용 가능한 MCP 도구 목록을 출력하고 종료합니다(서버 시작 없음, exit code: 0)
  - `--list-tools-json`: 사용 가능한 MCP 도구 목록을 JSON으로 출력하고 종료합니다(서버 시작 없음, exit code: 0)
  - (선택) 전역 설치/링크를 사용하면 `godot-mcp-omni` 바이너리로도 실행할 수 있습니다.

예시:

```bash
node build/index.js --doctor --json --godot-path /path/to/godot
```

프로젝트 포함 예시:

```bash
node build/index.js --doctor --json --project /path/to/godot-project --godot-path /path/to/godot
```

CI-safe 시나리오 실행 예시:

```bash
node build/index.js --run-scenarios --ci-safe
# stdout에 "SCENARIOS: OK"가 포함되면 성공입니다.
```

도구 목록 출력 예시:

```bash
node build/index.js --list-tools
```

출력 예시(축약):

```text
Total tools: 51

[server] (1)
- server_info
```

도구 목록 JSON 출력 예시:

```bash
node build/index.js --list-tools-json
```

#### ✅ MCP 설정 자동 생성

IDE에서 사용할 MCP 설정을 쉽게 생성할 수 있습니다:

```bash
node build/index.js --print-mcp-config --godot-path "C:\\Path\\To\\Godot_v4.5.1-stable_win64_console.exe"
```

출력 예시:

```json
{
  "command": "node",
  "args": ["/abs/path/to/godot-mcp-omni/build/index.js"],
  "env": {
    "GODOT_PATH": "C:\\Path\\To\\Godot_v4.5.1-stable_win64_console.exe"
  }
}
```

이 JSON을 IDE의 MCP 설정 파일(`mcp.json`, `cline_mcp_settings.json` 등)에 붙여넣어 사용할 수 있습니다.

#### ✅ 로컬 환경 변수(권장)

- `GODOT_PATH`는 **항상 Windows 경로(C:\\...)**로 지정하는 것을 표준으로 합니다.
  - 예시: `C:\\Path\\To\\Godot_v4.5.1-stable_win64_console.exe`

#### ✅ 경로 헷갈릴 때 체크리스트

- `GODOT_PATH`는 **Windows 경로**(`C:\\...`)로 고정합니다.
- MCP 서버 실행 환경에 따라 `command/args`만 해당 OS 경로로 맞추세요(Windows에서 실행하면 Windows 경로, WSL에서 실행하면 WSL 경로).
- (WSL에서 서버를 실행하더라도) `GODOT_PATH`가 Windows 경로이면 서버가 내부적으로 실행 가능한 경로로 처리합니다.

---

#### 🖱️ Cursor 설정

Note: Cursor의 MCP 설정 파일 경로/UI 명칭은 버전에 따라 다를 수 있습니다.

1. 아래 경로 중 하나에 `mcp.json`을 생성/수정합니다.
   - macOS/Linux: `~/.cursor/mcp.json`
   - Windows: `%USERPROFILE%\\.cursor\\mcp.json`
   - (선택) 프로젝트별 설정: `<project>/.cursor/mcp.json`
2. 다음을 추가합니다:
   ```json
   {
     "mcpServers": {
       "godot-omni": {
         "command": "node",
         "args": ["<ABS_PATH>/godot-mcp-omni/build/index.js"],
         "env": {
           "GODOT_PATH": "<YOUR_GODOT_PATH>"
         }
       }
     }
   }
   ```
3. Cursor를 재시작한 뒤, 도구 목록에 `godot_workspace_manager`, `godot_scene_manager` 등이 보이면 정상입니다.

---

#### 💻 VS Code (Cline / Roo Code) 설정

VS Code 자체가 MCP를 “기본 기능”으로 제공하는 형태는 클라이언트/확장(예: **Cline**, **Roo Code**)에 따라 다릅니다.

##### Cline

1. Cline 패널에서 **MCP Servers**로 이동합니다.
2. **Configure MCP Servers** / **Advanced MCP Settings** 등으로 `cline_mcp_settings.json`을 엽니다.
3. `mcpServers` 아래에 다음을 추가합니다:
   ```json
   {
     "mcpServers": {
       "godot-omni": {
         "command": "node",
         "args": ["<ABS_PATH>/godot-mcp-omni/build/index.js"],
         "env": {
           "GODOT_PATH": "<YOUR_GODOT_PATH>"
         }
       }
     }
   }
   ```

##### Roo Code

1. Roo Code 패널의 MCP 설정에서 **Edit Global MCP**(`mcp_settings.json`) 또는 **Edit Project MCP**(`.roo/mcp.json`)를 엽니다.
2. `mcpServers` 아래에 위와 동일한 `godot-omni` 구성을 추가합니다.

---

#### 🤖 Antigravity 연동

Note: Antigravity의 UI 명칭/설정 파일은 버전에 따라 다를 수 있습니다.

1. 에이전트 패널 상단의 `...` 메뉴에서 **MCP Store**를 엽니다.
2. **Manage MCP Servers** → **View raw config**를 선택합니다.
3. `mcp_config.json`의 `mcpServers` 아래에 추가합니다:
   ```json
   {
     "mcpServers": {
       "godot-omni": {
         "command": "node",
         "args": ["<ABS_PATH>/godot-mcp-omni/build/index.js"],
         "env": {
           "GODOT_PATH": "<YOUR_GODOT_PATH>"
         }
       }
     }
   }
   ```
4. 저장 후, MCP 도구 목록에서 `godot_workspace_manager`, `godot_scene_manager` 등이 보이면 정상입니다.

---

### 3. Godot 프로젝트 준비 (Editor Bridge 연결용)

에디터와 실시간 통신이 필요한 경우(`godot_workspace_manager`의 `connect` 액션 등), 프로젝트에 브릿지 애드온이 설치되어 있어야 합니다.

#### 3.1 토큰/포트 준비

- 프로젝트 루트에 토큰 파일을 만들어 두면 연결이 가장 단순해집니다:
  - `<project>/.godot_mcp_token` : 임의의 문자열(예: `my-token-123`)
  - (선택) `<project>/.godot_mcp_port` : 포트 번호(기본 8765)
  - (선택) `<project>/.godot_mcp_host` : 바인드/접속 호스트
    - WSL에서 Windows Godot를 구동하는 경우, `0.0.0.0` 바인드 후 **WSL 게이트웨이 IP**로 접속해야 할 수 있습니다(테스트에서는 `172.x.x.x` 형태).

#### 3.2 애드온 동기화 + 플러그인 활성화

1. MCP 도구 `godot_sync_addon`으로 프로젝트에 애드온을 동기화합니다. (권장: `enablePlugin: true`)
2. Godot 에디터에서 **Project Settings > Plugins**에서 `Godot MCP Bridge`가 활성화되어 있는지 확인합니다.

#### 3.3 에디터 실행/연결 (권장 플로우)

1. (선택) 에디터 실행:
   - MCP에서 `godot_workspace_manager(action="launch")` 사용, 또는
   - 사용자가 직접 Godot 에디터를 열어도 됩니다.
2. 에디터 브릿지 연결:
   - `godot_workspace_manager(action="connect")` 호출
3. 연결 확인:
   - `godot_rpc`로 `health` 호출(예: `{ method: "health", params: {} }`) 또는
   - `godot_preflight` 도구로 환경 점검을 수행합니다.

---

## 🧪 로컬에서 MCP 사용/디버깅하는 방법

### 1) MCP Inspector로 직접 호출

```bash
cd godot-mcp-omni
npm run inspector
```

### 2) 통합 검증(자동 테스트)

```bash
cd godot-mcp-omni

# CI-safe 기본 테스트 (GODOT_PATH 없어도 통과; Godot-required 일부 테스트는 스킵)
npm test

# (권장) CI와 동일한 pinned Godot 바이너리를 다운로드/캐시하여 사용
# - 성공 시 stdout에는 Godot 실행 파일 경로만 출력됩니다.
GODOT_PATH="$(node scripts/install_godot.js --version 4.5.1-stable --platform linux-x86_64)" npm test

# Godot 포함 통합 경로까지 확인하려면 GODOT_PATH를 지정
GODOT_PATH="$(pwd)/.tools/godot/4.5.1-stable/Godot_v4.5.1-stable_win64_console.exe" npm test

# (선택) README 예제 검증 스크립트
# - GODOT_PATH가 있으면 그대로 사용하고, 없으면 자동 탐지를 시도합니다.
npm run verify:readme
npm run verify:sprite

# 경로를 명시(override)하고 싶으면:
GODOT_PATH="C:\\Path\\To\\Godot_v4.5.1-stable_win64_console.exe" npm run verify:examples
```

### 3) Viewport 캡처 주의사항

- `godot_editor_view_manager(action="capture_viewport")`는 **GUI 에디터**에서 가장 안정적입니다.
- `--headless -e`로 구동된 에디터에서는 렌더 텍스처가 없어 캡처가 실패할 수 있습니다.

### 4) Cleanup

로컬 개발 중 누적되는 임시 산출물을 정리하려면 아래 명령을 사용하세요:

```bash
cd godot-mcp-omni
npm run clean:tmp
```

---

## 🛠️ MCP 도구 레퍼런스

### 🏗️ Godot Scene Manager (`godot_scene_manager`)

씬과 노드 구조를 관리합니다. (Hybrid 지원)

| 액션        | 설명                   | 주요 파라미터                                                                               |
| :---------- | :--------------------- | :------------------------------------------------------------------------------------------ |
| `create`    | 노드 생성 (씬 내)      | `nodeType`, `nodeName`, `parentNodePath?`, `props?`, (Headless: `projectPath`, `scenePath`) |
| `duplicate` | 노드 복제              | `nodePath`, `newName?`                                                                      |
| `reparent`  | 노드 부모 변경         | `nodePath`, `newParentPath`, `index?`                                                       |
| `instance`  | 씬을 노드로 인스턴스화 | `scenePath`, `parentNodePath?`, `name?`, `props?`                                           |
| `remove`    | 노드 삭제              | `nodePath`                                                                                  |
| `undo`      | 마지막 작업 취소       | -                                                                                           |
| `redo`      | 취소한 작업 다시 실행  | -                                                                                           |

---

### 🔍 Godot Inspector Manager (`godot_inspector_manager`)

노드와 리소스의 속성을 검사하고 수정합니다. (Hybrid 지원)

| 액션                | 설명                           | 주요 파라미터                                              |
| :------------------ | :----------------------------- | :--------------------------------------------------------- |
| `query`             | 씬 트리 노드 검색              | `name?`, `nameContains?`, `className?`, `group?`, `limit?` |
| `inspect`           | 클래스/노드/인스턴스 정보 조회 | `className`, `nodePath`, 또는 `instanceId` (하나 선택)     |
| `select`            | 에디터에서 노드 선택           | `nodePath` 또는 `instanceId`, `additive?`                  |
| `connect_signal`    | 시그널 연결                    | `fromNodePath`, `signal`, `toNodePath`, `method`           |
| `disconnect_signal` | 시그널 연결 해제               | `fromNodePath`, `signal`, `toNodePath`, `method`           |
| `property_list`     | 프로퍼티 목록 조회             | `className`, `nodePath`, 또는 `instanceId` (하나 선택)     |

---

### 🎨 Godot Asset Manager (`godot_asset_manager`)

프로젝트 자산과 UID 시스템을 관리합니다.

| 액션                | 설명                                   | 주요 파라미터                                                         |
| :------------------ | :------------------------------------- | :-------------------------------------------------------------------- |
| `load_texture`      | Sprite2D에 텍스처 로드                 | `projectPath`, `scenePath`, `nodePath`, `texturePath`                 |
| `get_uid`           | 파일의 UID 조회 (Godot 4.4+)           | `projectPath`, `filePath`                                             |
| `scan`              | 파일시스템 스캔                        | - (에디터) 또는 `projectPath` (Headless)                              |
| `reimport`          | 특정 파일 재임포트                     | `files` (배열)                                                        |
| `auto_import_check` | 임포트 상태 갱신(스캔/필요시 리임포트) | `projectPath` (Headless), `files?`, `forceReimport?` (에디터 연결 시) |

---

### 🧩 Aseprite Manager (`aseprite_manager`)

Aseprite CLI 기반으로 스프라이트/스프라이트시트 export를 수행하고, (옵션) Godot 임포트 갱신까지 처리합니다.

- 출력 파일명(stem)은 항상 `A_` 접두어가 강제됩니다.
- 외부 도구 실행이므로 `ALLOW_EXTERNAL_TOOLS=true`가 필요합니다.
- Aseprite 경로는 `ASEPRITE_PATH`로 지정(권장)하거나, `aseprite`가 PATH에 있어야 합니다.
- 자세한 문서: `docs/aseprite_manager.md`

| 액션                                 | 설명                               | 주요 파라미터                                                 |
| :----------------------------------- | :--------------------------------- | :------------------------------------------------------------ |
| `doctor`                             | Aseprite CLI 탐지/지원 플래그 점검 | -                                                             |
| `version`                            | Aseprite 버전 조회                 | -                                                             |
| `list_tags`                          | 태그 목록 조회                     | `projectPath`, `inputFile`                                    |
| `list_layers`                        | 레이어 목록 조회                   | `projectPath`, `inputFile`, `hierarchy?`                      |
| `list_slices`                        | 슬라이스 목록 조회                 | `projectPath`, `inputFile`                                    |
| `export_sheet`                       | 시트 PNG + 메타 JSON export        | `projectPath`, `inputFile`, `sheet`, `output?`, `options?`    |
| `export_sheets_by_tags`              | 태그별 시트 분리 export            | `projectPath`, `inputFile`, `tags`, `sheet`, `output?`        |
| `export_sheet_and_reimport`          | export_sheet 후 임포트 갱신        | `projectPath`, `inputFile`, `sheet`, `reimport?`              |
| `export_sheets_by_tags_and_reimport` | 태그별 export 후 임포트 갱신       | `projectPath`, `inputFile`, `tags`, `sheet`, `reimport?`      |
| `batch`                              | 여러 Aseprite 작업 배치 실행       | `projectPath`, `jobs`, `maxParallelJobs?`, `continueOnError?` |

---

### 🚀 Godot Workspace Manager (`godot_workspace_manager`)

프로젝트 라이프사이클 및 에디터 연결을 관리합니다.

| 액션            | 설명                                                       | 주요 파라미터                                             |
| :-------------- | :--------------------------------------------------------- | :-------------------------------------------------------- |
| `launch`        | Godot 에디터 실행                                          | `projectPath`, `token?`, `port?`, `godotPath?`            |
| `connect`       | 에디터 브릿지 TCP 연결                                     | `projectPath`, `token?`, `host?`, `port?`, `timeoutMs?`   |
| `run`           | 프로젝트 디버그 모드 실행                                  | `projectPath?`, `scene?`, `mode?` (auto/headless)         |
| `stop`          | 실행 중인 프로젝트 중지                                    | `mode?` (auto/headless)                                   |
| `restart`       | 프로젝트 재시작                                            | `projectPath?`, `mode?` (auto/headless)                   |
| `open_scene`    | 에디터에서 씬 열기                                         | `scenePath`                                               |
| `save_all`      | 모든 씬 저장                                               | -                                                         |
| `doctor_report` | (Headless) 프로젝트 정적 점검 후 Markdown 리포트 생성/갱신 | `projectPath`, `reportRelativePath?`, `options?`, `mode?` |

---

### 📺 Godot Editor View Manager (`godot_editor_view_manager`)

에디터 GUI를 직접 제어합니다. (Editor Only)

| 액션               | 설명                                   | 주요 파라미터               |
| :----------------- | :------------------------------------- | :-------------------------- |
| `capture_viewport` | 에디터 뷰포트 스냅샷 캡처 (Base64 PNG) | `maxSize?`                  |
| `switch_screen`    | 메인 화면 전환 (2D/3D/Script)          | `screenName`                |
| `edit_script`      | 스크립트 파일 열기 및 이동             | `scriptPath`, `lineNumber?` |
| `add_breakpoint`   | 스크립트에 중단점 추가                 | `scriptPath`, `lineNumber`  |

---

### ⚙️ Headless Batch Operations

GUI 없이 여러 작업을 한 번에 처리합니다.

| 도구                   | 설명                     | 주요 파라미터                                 |
| :--------------------- | :----------------------- | :-------------------------------------------- |
| `godot_headless_op`    | 단일 헤드리스 작업 실행  | `projectPath`, `operation`, `params`          |
| `godot_headless_batch` | 다중 스텝 배치 작업 실행 | `projectPath`, `steps` (배열), `stopOnError?` |

---

### 🔧 Low-Level RPC (`godot_rpc`)

에디터 브릿지에 직접 RPC 요청을 전송합니다.

| 도구            | 설명                           | 주요 파라미터                                       |
| :-------------- | :----------------------------- | :-------------------------------------------------- |
| `godot_rpc`     | Raw RPC JSON 요청              | `request_json` (`{ method, params }`), `timeoutMs?` |
| `godot_inspect` | 클래스/노드/인스턴스 정보 조회 | `query_json`, `timeoutMs?`                          |

---

## 🔧 환경 변수

| 변수                   | 설명                                       | 기본값      |
| :--------------------- | :----------------------------------------- | :---------- |
| `GODOT_PATH`           | Godot 실행 파일 경로                       | 자동 탐지   |
| `GODOT_MCP_TOKEN`      | 에디터 브릿지 인증 토큰                    | -           |
| `GODOT_MCP_PORT`       | 에디터 브릿지 포트                         | `8765`      |
| `GODOT_MCP_HOST`       | 에디터 브릿지 바인드 호스트                | `127.0.0.1` |
| `ALLOW_EXTERNAL_TOOLS` | 외부 도구 실행 허용(Aseprite/HTTP 등)      | `false`     |
| `ASEPRITE_PATH`        | Aseprite 설치 디렉터리 또는 실행 파일 경로 | 자동 탐지   |
| `ALLOW_DANGEROUS_OPS`  | 위험한 작업 허용 여부                      | `false`     |

참고:

- `GODOT_PATH`가 설정되지 않은 경우, 실행 파일 자동 탐지를 시도합니다.
- 이 레포에서 실행할 때는(레포 루트 또는 `godot-mcp-omni/`), `Godot_v*` / `Godot_*` 번들 디렉터리 아래의 Godot 실행 파일도 후보에 포함합니다.
- 자동 탐지를 원치 않으면 `GODOT_PATH` 또는 `--godot-path`로 명시적으로 지정하세요.

---

## 📋 사용 예시

### AI에게 시각적 정보 요청

> "지금 에디터 뷰포트 상황을 캡처해서 보여줘"

### 노드 생성 및 프로퍼티 설정 (Auto-Casting)

> "CharacterBody2D 노드를 'Player'라는 이름으로 추가하고, Position을 (100, 200, 0)으로 설정해줘"

### 스크립트 디버깅 보조

> "Player.gd 파일을 열고 15번 라인에 중단점을 걸어줘"

### Doctor Report (Headless 진단 리포트)

> "godot_workspace_manager(action='doctor_report', projectPath='...')를 실행해서 .godot_mcp/reports/doctor_report.md를 생성(또는 갱신)해줘"

---

## 📁 프로젝트 구조

```
godot-mcp-omni/
├── src/
│   ├── server.ts           # MCP 서버 메인
│   ├── tools/
│   │   ├── unified.ts      # Unified Managers (action 디스패처)
│   │   ├── editor.ts       # Editor-bridge 기반 툴
│   │   ├── headless.ts     # Headless 기반 툴
│   │   ├── project.ts      # 프로젝트/실행/프리플라이트 도구
│   │   └── context.ts      # 서버 컨텍스트(상태/유틸)
│   ├── scripts/
│   │   └── godot_operations.gd  # Headless 엔진
├── addons/
│   └── godot_mcp_bridge/   # Godot 에디터 플러그인 (v0.2.0)
└── test/                   # 검증 테스트 세트
```

---

## 🙏 크레딧

- 원본 프로젝트: [Coding-Solo/godot-mcp](https://github.com/Coding-Solo/godot-mcp)
- 확장 및 유지보수: [Stankjedi](https://github.com/Stankjedi)
