# Herdr + Codex + Claude Opus 5.5 오케스트레이션 실전 설정 가이드

> **기준:** 2026-11-03 · macOS / Ghostty(권장) / Herdr TUI / Claude Code / Codex / Git  
> **참고 영상:** [Herdr로 LLM 오케스트레이션 액기스 모음](https://www.youtube.com/watch?v=1AlbTXb8oPc) (약 21분)  
> **문서 목적:** 코드팩토리 영상의 팁을 하나의 재사용 가능한 설정 문서로 재구성. **오른쪽 Codex가 메인 오케스트레이터, 왼쪽 Claude Opus 5.5가 구현 워커**, 단일 Git 저장소 기반으로 시작하여 Worktree·병렬 워커·원격 머신으로 확장한다.
>
> **중요:** 이 문서는 영상 대본 + Herdr/Claude 공식 문서를 바탕으로 재현할 수 있게 작성한 **재구성 가이드**다. 영상 제작자의 비공개 개인 스킬·설정 원본을 확보하거나 복제한 것은 아니다. Herdr의 **공식 `herdr` Skill을 설치**하고 아래의 **맞춤 작업 규칙/프롬프트**를 추가하는 방식이다. CLI 옵션은 버전별로 달라질 수 있으므로 **설치된 `herdr --help`, `herdr agent`, `herdr pane`가 최종 기준**이다.

---

## 0. 완성 목표: 최종 화면과 운영 방식

```text
Herdr / Workspace: my-app / Tab: MAIN-ORCHESTRATION
┌─────────────────────────────────┬───────────────────────────────────┐
│ LEFT: Claude Code               │ RIGHT: Codex                      │
│ Model: claude-opus-5-5           │ ROLE: MAIN ORCHESTRATOR           │
│ Agent name: opus_worker         │ Agent name: orchestrator          │
│                                 │                                   │
│ [구현/수정/테스트]               │ [기획/지시/모니터링/리뷰/검증]    │
│                                 │                                   │
│ 작업 완료 결과 ────────────────→ │ Herdr agent read / wait           │
│ ←──────────────── 지시/재작업   │ Herdr agent prompt                │
└─────────────────────────────────┴───────────────────────────────────┘
                         │
              하나의 Git 저장소 / origin
                         │
            필요할 때 별도의 Git Worktree
         feature/ui   feature/api   feature/test
                         │
             테스트 → 리뷰 → 승인 → 병합
```

**기본 원칙:** 첫날은 **Codex만 지시·리뷰**, **Claude만 파일 수정**. 양쪽이 같은 폴더를 보더라도 *동일 파일을 동시에 편집하지 않도록* 한다. 동시에 여러 기능을 수정해야 할 때만 **Worktree별 워커를 분리**한다. Worktree가 여러 개여도 Git 저장소 및 `origin` 원격은 동일한 프로젝트를 공유한다.

### 영상의 핵심 팁 체크리스트

- [x] Ghostty 같은 빠른 터미널에서 Herdr TUI 실행
- [x] Workspace / Tab / Pane 이해 및 좌우/상하 분할, 확대
- [x] 에이전트 상태(`working`, `idle`, `done`, `blocked`, `unknown`) 확인
- [x] Herdr Skill 설치 후 **자연어로 Pane·에이전트 조종**
- [x] Codex를 메인으로 유지하면서 Opus에게 실제 코딩 위임
- [x] Meta-prompting: 메인 Codex가 워커용 프롬프트를 직접 구성
- [x] Git Worktree로 독립 브랜치 및 개발 공간 생성
- [x] Worktree를 새 Workspace로 등록하거나 현재 Tab Pane에서 열기
- [x] 여러 구현 후보를 병렬 Fan-out → 결과 비교 → 선택 병합
- [x] Skill 기반 `분석 → 우선순위 → 개발 → 검증` 페이즈 자동화
- [x] 원격 Mac/서버 등록, SSH/Tailscale 및 원격 분산 작업
- [x] E2E 테스트를 별도 머신에 분산하는 운영 아이디어
- [x] 세션 유지/재접속 및 안전한 권한 관리

---

## 1. 준비물 및 설치

**필요한 것:** macOS, Git, Homebrew(권장), 설치·로그인된 Claude Code/ Codex CLI, Herdr TUI. Ghostty는 권장일 뿐 필수는 아니다. Claude 구독/계정에서 **Opus 5.5 사용 권한**이 있어야 실제로 선택 가능하다.

### 1-1. 기존 도구 확인

```bash
brew --version
git --version
claude --version
codex --version
```

명령을 찾지 못하면 해당 프로그램의 **공식 설치 가이드**부터 진행한다. 이 문서는 CLI가 이미 설치되어 있다는 전제를 둔다. Claude Code와 Codex는 각각 최초 실행 시 로그인/권한 승인 필요.

### 1-2. Ghostty(선택)와 Herdr 설치

```bash
brew install --cask ghostty   # Ghostty를 아직 설치하지 않았다면
brew install herdr            # Herdr TUI
herdr --version
```

이미 다른 터미널을 사용한다면 Ghostty 설치는 생략해도 된다. 업데이트는 `brew upgrade herdr`로 한다(Homebrew 설치 시).

### 1-3. **공식 Herdr Skill 설치 — 핵심**

```bash
npx skills add herdrdev/herdr --skill herdr -g
```

- `-g`: 지원되는 코딩 에이전트의 전역 스킬로 설치. 프로젝트 안에서만 설치하려면 생략.
- 설치 프롬프트에서 Codex/Claude 대상과 설치 위치를 확인한다. 설치 이후 새 에이전트 세션을 시작한다.
- 이 스킬은 Herdr CLI를 활용해 Pane 생성, 에이전트 실행, 상태 읽기, 작업 지시 등을 수행하도록 AI를 안내한다.
- **스킬을 깔았다고 자동으로 두 AI가 서로 대화하는 것은 아니다.** 아래 '오케스트레이터 부트스트랩 프롬프트'가 역할과 흐름을 정의한다.
- 공식 스킬이 실제로 사용하는 명령어 확인: `herdr --skill` 또는 [Herdr 공식 Skill](https://github.com/herdrdev/herdr/blob/master/skills/herdr/SKILL.md).

### 1-4. 모델 지정 확인

```bash
claude --model claude-opus-5-5
```

Claude Code 세션 안에서 `/status`를 입력하여 모델 확인. 기존 Claude 세션에서는 `/model`로 모델 변경 가능. 구독/계정에서 이용이 안 되면 **자동 대체하지 말고 사용자에게 알린 후** 사용 가능한 모델을 선택한다.

### 1-5. Git 원격 확인

```bash
cd /경로/내-프로젝트
git status --short
git branch --show-current
git remote -v
```

- 기존 Git 프로젝트면 그대로 사용.
- Git 미초기화 프로젝트면 프로젝트에서 `git init` 후 파일을 검토하고 **명시적으로 첫 커밋**을 만든다.
- `git remote -v`가 비어 있으면 아직 GitHub 등 외부 원격 저장소에 연결되지 않은 상태. **임의의 원격 주소를 만들지 않는다.**
- 작업 시작 전 `git status`가 깨끗한지 확인. 기존 미커밋 변경은 사용자 소유이므로 에이전트가 임의로 덮어쓰거나 삭제해서는 안 된다.

---

## 2. 가장 빠른 시작: **왼쪽 Claude / 오른쪽 Codex** 자동 협업

### 2-1. 프로젝트에서 Herdr 실행

```bash
cd /경로/내-프로젝트
herdr
```

Herdr는 기본 세션에 연결된다. Workspace가 비어 있으면 생성한다. 프로젝트를 별도 Workspace로 관리하면 나중에 다른 프로젝트의 에이전트 상태와 섞이지 않는다.

### 2-2. 화면을 좌우로 분할

1. 최초의 **왼쪽 Pane을 빈 셸 상태로 유지**한다. `claude`를 미리 실행하지 않는다.
2. `Ctrl+B`를 누른 다음 `v`를 누르거나, Pane 오른쪽 클릭 → 오른쪽 분할(Split Right).
3. **오른쪽 Pane**을 클릭하고 `codex` 실행.
4. 화면은 **왼쪽 빈 셸 / 오른쪽 Codex** 상태. 이제 Codex가 Herdr Skill로 왼쪽에 Opus를 실행하게 한다.

> **중요:** Herdr의 `agent start`는 **기존의 사용 가능한 셸 Pane에서만** 동작한다. Pane을 먼저 확보해야 하며, 이미 에이전트가 실행 중인 Pane에는 다른 에이전트를 덮어씌우지 않는다.

### 2-3. 오른쪽 Codex에 그대로 붙여 넣는 '부트스트랩 프롬프트'

아래 텍스트는 문서의 가장 중요한 부분. **새 프로젝트에서도 복사해서 쓸 수 있다.**

```text
너는 지금부터 이 프로젝트의 MAIN ORCHESTRATOR이며, 실제 구현은 Claude Code에게 위임한다.

[화면 규칙]
- 현재 Herdr Tab의 오른쪽 Pane = 너(Codex, 메인 오케스트레이터).
- 바로 왼쪽 Pane = Claude Code Opus 5.5 워커.
- 화면의 좌우 배치를 유지한다. 이미 실행 중인 다른 사용자 세션을 변경하거나 닫지 않는다.

[Herdr 초기화]
1) 먼저 test "${HERDR_ENV:-}" = 1 을 검사한다. Herdr 내부가 아니면 중단하고 이유를 보고한다.
2) 공식 herdr 스킬과 설치된 CLI 도움말(herdr --help / herdr agent / herdr pane)을 확인한다.
3) 현재 Pane ID, 같은 Tab의 Pane 목록, 왼쪽 이웃 Pane을 확인한다. ID는 명령 결과 JSON에서 읽으며 추측하지 않는다.
4) 현재 Codex 에이전트에 가능한 경우 orchestrator라는 라이브 이름을 부여한다.
5) 왼쪽 Pane이 비어 있는 정상 셸인지 확인한다. 그 경우에만 Herdr agent start로
   opus_worker 라는 이름의 Claude Code를 실행하고, 모델 옵션은
   --model claude-opus-5-5 로 전달한다.
6) Claude Code가 실제 Opus 5.5로 실행되었는지 확인한다. 계정 권한이나 모델 문제로 실패하면 중단해서 보고한다. 임의로 다른 모델로 바꾸지 않는다.
7) Git 현재 브랜치, 작업 트리 변경사항, origin 설정을 읽어 요약한다. 기존 사용자 변경은 절대 지우지 않는다.

[역할]
- 너(Codex): 요구사항 분석, 작업을 독립 단위로 분해, 워커에게 목표/파일 범위/검증 기준 전달,
  진행 상태 모니터링, 결과 리뷰, 테스트 확인, 다음 작업 조율.
- Claude opus_worker: 코드 구현/수정/필요한 테스트 실행, 변경 내역과 검증 결과 보고.
- 나는 오른쪽 Codex와 계속 대화한다. 너는 긴 구현 작업으로 메인 대화 흐름을 막지 마라.

[협업 통신]
- Herdr Skill과 herdr agent prompt/wait/read/get을 이용해 Claude에게 작업을 전달하고 결과를 수집한다.
- 작업을 지시할 때 단순히 '만들어줘'라고 하지 말고 성공 조건, 수정 파일 범위,
  테스트 및 완료 보고 양식을 메타프롬프팅하여 보낸다.
- 진행 중인 AI 상태를 확인하고 blocked/unknown/timeout에서 임의 재전송하지 않는다.
- 워커 완료 보고는 요약, 변경 파일, 테스트 결과, 남은 리스크로 수집한다.

[Git 안전 규칙]
- 이 기본 2-Pane 모드에서는 Claude만 파일 수정하고 Codex는 리뷰/지시 위주로 행동한다.
- 2개 이상의 워커가 동시에 코드를 수정하려면 사전에 개별 Git Worktree를 만들어라.
- 하나의 Git 저장소와 origin을 유지하고, 작업별 브랜치를 분리한다.
- main 직접 수정/merge/push, force push, 데이터 삭제, 배포, 비밀정보 출력,
  권한 우회 실행은 내 명시적인 승인 전에는 하지 않는다.
- Claude에 --dangerously-skip-permissions 등 권한 우회 옵션을 사용하지 않는다.

[작업 흐름]
PLAN -> DELEGATE -> MONITOR -> READ/REVIEW -> VERIFY -> REPORT -> (승인 시 MERGE)
작업이 크면 단계별로 나누고, 각 단계의 통과 기준을 확인한 뒤 다음 단계로 이동한다.

지금은 코딩을 시작하지 말고, ① 좌/우 에이전트가 준비됐는지 ② Opus 5.5 모델 확인
③ Git 저장소 상태 ④ 실행 준비 완료 여부를 표로 보고해라.
```

**참고:** 부트스트랩은 Herdr 내부에서 실행되어야 한다. Codex가 `HERDR_ENV=1`을 못 보면 밖에서 실행된 것이므로 Herdr 내부 Pane에서 다시 실행한다.

### 2-4. 정상 동작을 검증하는 작은 테스트

오른쪽 Codex에 다음 요청을 한다.

```text
왼쪽 opus_worker에게 '현재 Git 저장소를 읽기 전용으로 분석하고 구조와 주요 실행 명령을 10줄 이내로 보고하라'는 작업을 위임해 줘.
Herdr를 통해 상태를 확인하고, 완료 후 너의 말로 요약해 줘. 아직 파일은 수정하지 마.
```

기대 흐름: **Codex → `agent prompt opus_worker` → Claude 응답 → Codex `agent read` → 요약**. 실제 코딩 전 이 과정이 잘 되는지 확인하는 것이 좋다.

### 2-5. 공식 CLI를 직접 확인할 때 사용하는 명령

아래 명령은 **Herdr 안의 셸에서 실행**하거나 Codex에게 실행시키는 명령이다. 실행 중 에이전트의 입력 프롬프트에 Bash 명령을 그대로 적지 말고 에이전트에게 해당 셸 명령을 수행하도록 요청한다.

```bash
# Herdr 에이전트가 자기 환경을 체크
test "${HERDR_ENV:-}" = 1

# 현재 Herdr의 상태 확인
herdr status
herdr pane current --current
herdr pane list
herdr pane neighbor --direction left --current
herdr agent list

# 현재 Codex가 자신의 Pane ID로 이름을 등록할 때
herdr agent rename "$HERDR_PANE_ID" orchestrator

# 왼쪽 셸 Pane ID가 확인된 경우에만 아래 명령 실행
# <LEFT_PANE_ID>는 실제 JSON 결과에서 얻은 값으로 바꾼다.
herdr agent start opus_worker --kind claude --pane <LEFT_PANE_ID> -- --model claude-opus-5-5

# 지시, 종료 상태/출력 읽기
herdr agent prompt opus_worker "이 프로젝트의 구조를 10줄로 요약해 줘." --wait --timeout 120000
herdr agent get opus_worker
herdr agent read opus_worker --source recent-unwrapped --lines 120
```

`--wait`는 상태가 안정화될 때까지 기다리지, 테스트 통과를 보장하지 않는다. 작업 시간이 길면 타임아웃에 걸릴 수 있으며, **타임아웃이 났다고 작업 미시작이라고 추정해서 동일 프롬프트를 재전송하면 안 된다.** `get`과 `read`로 현재 상태를 다시 확인한다.

---

## 3. 실제 코딩 작업을 맡기는 메타프롬프팅 템플릿

메인 Codex가 워커에게 전달할 작업 계약(Task Contract)을 만들게 한다. 대화만 하는 것이 아니라 **파일 범위와 검증 기준**을 붙이는 것이 중요하다.

```text
우리 프로젝트에 [원하는 기능]을 만들어 줘.

너는 구현을 직접 하지 말고, 구현 작업 계약을 먼저 작성하여 왼쪽 opus_worker에게 위임해.
작업 계약에 반드시 포함할 항목:
- 목표 / 사용자 관점에서의 완료 조건
- 수정 허용 파일 및 수정 금지 파일
- 기술 스택 / 기존 코드에서 지켜야 할 규칙
- 테스트 실행 명령과 성공 기준
- 불명확한 사항과 반드시 확인받을 항목
- 보고 형식: 변경 파일, 핵심 구현, 테스트 결과, 미해결 이슈

Herdr로 작업을 보내고 에이전트 상태를 모니터링해.
완료되면 diff를 검토하고 테스트 증거를 확인한 후 결과를 나에게 보고해.
merge, push, 배포는 하지 마.
```

**영상 예시 그대로 적용(09:16~11:46):** 먼저 Codex와 대화하면서 주식 차트 모니터링 사이트의 MVP 기능 세 가지를 확정 → Codex가 새 Claude Pane에 Next.js 구현 작업 위임 → Codex와 사용자는 계속 리서치/기획 진행 → 워커가 완료 보고 → 메인 Codex가 리뷰.

**주의:** 외부 API 키가 필요한 주식 시세 연동은 승인된 공급자/무료 정책을 확인해야 하며, 데모라면 모의 데이터로 시작한다.

---

## 4. Git 협업 모드 두 가지 — **한 저장소**를 유지하면서 충돌 줄이기

### 모드 A. 1:1 협업 (처음 권장)

```text
하나의 Git 저장소 + 하나의 작업 디렉터리
 ├─ 왼쪽 Claude: 실제 수정/테스트/커밋 제안
 └─ 오른쪽 Codex: 작업 분배/코드 리뷰/검증/결과 보고
```

- **장점:** 설정이 단순하고 한눈에 두 AI의 대화/작업을 확인 가능.
- **규칙:** 동일 디렉터리에서는 **Claude만 쓰기 권한을 행사하도록 역할을 분리**. Codex가 검토 중 파일을 수정하면 동시 충돌 위험이 생김.
- **커밋:** 원칙적으로 단계마다 검증하고 합의 후 커밋. 에이전트가 무조건 자동 커밋하는 방식은 권장하지 않음.

### 모드 B. N개 독립 개발 (영상의 Worktree 방식)

```text
Git repository / origin = 동일
  ├─ main: 통합/검증용
  ├─ Worktree feature/ui: Claude worker 1
  ├─ Worktree feature/api: Codex/Claude worker 2
  └─ Worktree feature/test: 검증 worker 3
```

각 Worktree는 **서로 다른 체크아웃 디렉터리와 브랜치**를 갖고, 같은 Git 저장소 이력을 공유한다. Herdr의 `worktree create`는 Worktree뿐 아니라 **연결된 Workspace**도 만든다. 현재 Tab의 추가 Pane에 열고 싶다면 그 Worktree **경로를 `--cwd`로 지정**해 새 Pane을 생성하면 된다.

```bash
# 예: Git 프로젝트 루트에서 실행한다고 가정
herdr worktree list --cwd "$PWD"

# feature/ui 브랜치용 Worktree + Herdr Workspace 생성
herdr worktree create --cwd "$PWD" --branch feature/ui --label "UI 개발" --no-focus

# 결과 JSON에 생성된 실제 경로/Workspace ID가 나타남.
# 임의 경로를 추정하지 말고 해당 결과를 사용한다.
```

**Codex에 요청할 문장:**

```text
새로운 UI 기능과 API 기능을 병렬 개발하고 싶어.
먼저 서로 독립적인 파일 범위를 분석한 다음 Herdr Worktree 2개를 만들어 줘.
각 Worktree를 별도 Workspace로 등록하고, 각 공간에서 별도의 Claude/Codex 워커가 작업하게 해.
두 워커의 변경 파일이 겹치면 먼저 작업 계획을 조정해.
각각 테스트한 후 비교 보고하고, 병합은 내 승인 후 진행해.
```

**현재 Tab에 여러 Worktree를 한눈에 보고 싶은 경우(영상 07:04~08:07):**

```text
feature/test Worktree를 만들어. 별도 Workspace로 볼 필요는 없고,
현재 Tab 오른쪽(상황에 따라 아래쪽)에 셸 Pane을 추가해 그 Worktree 경로에서
Codex 테스트 워커를 실행해 줘. 다른 Pane의 Git 작업 경로는 바꾸지 마.
```

**정리/병합 시:** `git status`, 변경 diff, 테스트 결과를 확인하고 승인된 브랜치만 병합. Worktree 삭제는 사용자 작업 삭제로 이어질 수 있으므로 **작업 디렉터리와 미커밋 변경을 확인하기 전에는 제거 금지**.

---

## 5. 영상처럼 3·5·7개 후보 병렬 실행 (Fan-out / Fan-in)

### 언제 쓰나?

- 게임 콘셉트 3종 구현 / UI 시안 3종 / 알고리즘 대안 3종
- 동일 버그에 대한 **서로 독립적인 해결 가설** 비교
- 다른 모델이나 노력 수준의 결과를 비교할 때
- 시간이 많이 드는 E2E 테스트를 독립 환경에서 나눠 실행할 때

### 메인 Codex에 붙여 넣을 요청

```text
[기획 내용]을 바탕으로 독립적인 구현안 3개를 병렬로 만들어 보자.

1) 먼저 3개 후보의 목적과 공통 평가 기준을 표로 정리해.
2) Git Worktree를 후보별로 분리해. 같은 디렉터리를 동시에 쓰지 마.
3) Herdr에서 후보별 별도 워커 세션을 실행하고 독립 프롬프트를 생성해 위임해.
4) 모델은 우선 사용 가능한 Claude Opus 5.5로 시도하되, 요금/사용 한도를
   고려해 내가 별도 승인하지 않으면 후보를 3개보다 늘리지 마.
5) 각 결과를 실행/테스트하여 기능 완성도, 버그, 코드 품질, UX를 비교해.
6) 가장 좋은 후보를 추천하되 자동 merge/push는 하지 마.
7) 각 워커가 blocked면 내 승인을 기다려. 실패한 워커는 원인부터 보고해.
```

### Fan-in(결과 수집) 평가표

| 후보 | Git 브랜치 | 구현 완료 | 테스트 | 장점 | 위험 | 추천 여부 |
|---|---|---|---|---|---|---|
| A | `feature/idea-a` | 실제 결과 | 실제 결과 | 근거 | 근거 | 평가 |
| B | `feature/idea-b` | 실제 결과 | 실제 결과 | 근거 | 근거 | 평가 |
| C | `feature/idea-c` | 실제 결과 | 실제 결과 | 근거 | 근거 | 평가 |

**과장 방지:** 병렬화는 API/구독 한도, 머신 자원, 공통 파일 의존성에 묶인다. 3개를 돌린다고 언제나 3배 빨라지는 것은 아니다.

---

## 6. 영상의 '복잡한 오케스트레이션'을 만드는 단계별 태스크 플로우

영상 14:08~15:14의 핵심: **사용자 피드백 → 리서치/중요도 → 독립 브랜치 → 구현 → 검증**. 이것은 Herdr가 자동으로 기본 제공하는 완성 워크플로우가 아니라 **Skill·프롬프트·테스트 도구로 직접 구성하는 단계형 운영 규칙**이다.

```mermaid
flowchart TD
  A[요구사항 또는 사용자 피드백] --> B[메인 Codex가 분석 및 우선순위 선정]
  B --> C{독립 개발 가능한가?}
  C -- 예 --> D[Worktree별 워커 생성 및 병렬 구현]
  C -- 아니오 --> E[선행 단계부터 순차 실행]
  D --> F[단위 테스트 / 빌드 / 정적 검사]
  E --> F
  F --> G{모두 통과했는가?}
  G -- 아니오 --> H[오류 범위/횟수를 제한한 재작업]
  H --> F
  G -- 예 --> I[독립 리뷰 및 변경사항 보고]
  I --> J{사용자 승인?}
  J -- 예 --> K[브랜치 병합/필요시 배포]
  J -- 아니오 --> L[대기 또는 수정 요청]
```

### 권장 페이즈와 완료 조건

| 페이즈 | 누가 담당 | 완료 조건 |
|---|---|---|
| Phase 0: 저장소 점검 | Codex | `git status`, 실행법, 위험 변경 파악 |
| Phase 1: 기능 기획/리서치 | Codex | 요구사항, 범위, 우선순위 확정 |
| Phase 2: 작업 분해 | Codex | 각 Task의 수정 범위/의존성 명확 |
| Phase 3: 개발 | Claude/Codex 워커 | 코드 변경 및 자기 점검 완료 |
| Phase 4: 검증 | 테스트 워커 | lint, typecheck, unit/E2E 등 실제 실행 기록 |
| Phase 5: 리뷰 | 메인 Codex | 변경 diff 및 요구사항 충족 여부 확인 |
| Phase 6: 병합/배포 | 사용자 승인 이후 | 승인 범위에서만 Git 변경 및 배포 |

### Codex에 전달할 '장기 운영 프롬프트'

```text
앞으로 이 프로젝트에서 기능 요청을 받으면 다음 태스크 플로우를 반복해:

DISCOVER -> PLAN -> PRIORITIZE -> ISOLATE -> DELEGATE -> MONITOR -> VERIFY -> REVIEW -> REPORT

- 독립적인 수정만 병렬 실행한다.
- 각 작업을 추적할 수 있도록 짧은 작업 ID, 브랜치, 소유 워커, 완료 조건을 정한다.
- Herdr에서 워커 상태를 확인하되 완료 상태만 보고 성공했다고 판단하지 않는다.
- 각 워커에게는 명시적 테스트와 결과 보고 형식을 부여한다.
- 테스트가 실패한 경우 에러 로그를 수집하고 원인을 분석한다.
- 재시도 횟수는 최대 2회로 제한하고 반복 실패는 사용자에게 보고한다.
- 매 단계가 끝날 때 변경 파일/테스트/리스크를 요약한다.
- 위험한 권한 승인, main 병합, push, 배포는 사용자에게 묻는다.

먼저 현재 저장소에 맞춰 이 플로우의 첫 번째 3개 작업 후보를 제시해.
```

> **주의:** `prompt → wait → read`는 실행 관리 API다. '워커가 자발적으로 메인에게 보고'하는 동작은 추가 메시지 전송 규칙이나 메인 폴링·Skill 등의 조합으로 구현해야 한다. **기본 Herdr가 메인 AI를 무조건 자동으로 깨워서 판정해 주는 것으로 가정하지 말 것.**

---

## 7. Herdr에서 에이전트 상태를 확인하고 개입하는 법

| 표시/상태 | 의미 | 대응 |
|---|---|---|
| `working` | 현재 AI 작업 진행 | 불필요한 중복 지시 자제 |
| `idle` | 입력 받을 준비 | 필요한 후속 지시 가능 |
| `done` | 완료 후 아직 확인 안 한 상태로 보일 수 있음 | 출력 읽고 성공 여부 직접 검증 |
| `blocked` | 권한 승인 / 질문 등으로 진행 중단 | 화면 확인 후 명시적 승인/거절 |
| `unknown` | 상태 자동 판별 불확실 | 완료로 단정하지 말고 직접 읽기 |

```bash
herdr agent list
herdr agent get opus_worker
herdr agent read opus_worker --source recent-unwrapped --lines 120

# 이미 동작 중인 워커의 상태 변화를 기다릴 때
herdr agent wait opus_worker --timeout 120000

# 실패/불명확 상태에서는 read 후 판단, 무작정 재지시 금지
```

- `agent prompt`로 작업을 보낸 순간의 ACK만으로는 실제 작업 수행/성공을 보장하지 않는다.
- `agent wait`는 상태가 안정화되는 시점만 판단한다.
- `blocked`에서는 민감한 명령 승인을 **자동으로 누르지 않는다**.
- 출력이 잘리면 `--lines`를 늘리거나, 워커에게 결과를 별도 Markdown 파일로 작성하고 **파일 경로만 보고**하도록 할 수 있다(그 파일은 별도의 검토 후 커밋).

---

## 8. 화면 운용 팁 — 코드팩토리 영상의 Workspace / Tab / Pane

### 레이아웃 설계

| 대상 | 추천 형태 | 이유 |
|---|---|---|
| 메인 오케스트레이션 | 같은 Tab 좌/우 2 Pane | 메인 대화와 코딩 상태를 동시에 확인 |
| 구현 후보 다수 | 다른 Worktree + Workspace | 브랜치·파일 범위 격리 |
| 내용/스크립트 아이디어 | 같은 Workspace의 주제별 Tab | 공유 자원을 쓰면서 대화 맥락 구분 |
| 서버·빌드·테스트 | 별도 Tab 또는 Pane | 개발 대화와 프로세스 로그 분리 |

### 자주 쓰는 단축키 (기본 키 설정 기준)

`Ctrl+B`를 누른 뒤 두 번째 키를 누른다. 최신 공식 키맵을 기준으로 작성했다.

| 동작 | 키 |
|---|---|
| 오른쪽 분할 | `Ctrl+B`, `v` |
| 아래쪽 분할 | `Ctrl+B`, `-` |
| 현재 Pane 확대/복원 | `Ctrl+B`, `z` |
| 새 Tab | `Ctrl+B`, `c` |
| 좌/하/상/우 이동 | `Ctrl+B`, `h` / `j` / `k` / `l` |
| Workspace 탐색 | `Ctrl+B`, `w` |
| 세션에서 분리(백그라운드 유지) | `Ctrl+B`, `q` |
| Pane 닫기 | `Ctrl+B`, `x` (주의: 해당 프로세스도 종료 가능) |
| 전체 단축키 확인 | `Ctrl+B`, `?` |

더 편하면 마우스 오른쪽 클릭으로 분할·이름 변경, 테두리 드래그로 크기 조정. 영상처럼 상태 사이드바에서 `working`과 `blocked`를 우선 확인하면 효율적이다.

### 중요한 구분

- **Tab이 다르다고 Git 작업 폴더가 격리되는 것은 아니다.**
- **Worktree가 달라도 동일한 외부 DB, API, 포트는 공유할 수 있다.** 테스트 충돌 가능성 확인.
- 세션을 화면에서 분리해도 Herdr 서버의 프로세스는 계속 실행될 수 있다. 장시간 실행 작업은 사용량·보안 정책을 고려한다.

---

## 9. 원격 Mac/서버로 확장 (영상 15:16~20:59)

**목표:** 같은 Herdr 창에서 로컬 및 원격 머신 작업을 관리. 주력 Mac에서는 Codex로 기획/조정, 원격 Mac에서는 Claude Code 실행, 서버에서는 빌드/테스트 수행.

```text
Mac (메인) / Herdr TUI
   ├─ Local: Codex orchestrator
   ├─ Remote Mac #1: Claude Opus worker
   └─ Remote Linux/Mac #2: 빌드·E2E 테스트
          ↕
     SSH + (네트워크 밖에서는 Tailscale 등)
```

### 9-1. SSH가 먼저다

원격 Mac/서버에서 SSH 서비스를 활성화하고 계정·공개키를 적절히 설정한다. 원격 시스템 계정에 필요한 도구 설치 및 인증이 따로 필요하다. Herdr는 비밀번호/SSH 키를 대신 관리하지 않는다.

```bash
# 메인 Mac에서 원격 SSH 접속 확인
ssh workbox

# Herdr의 원격 머신 등록 (대화형 터미널에서)
herdr machine add workbox --label "Build Mac"
herdr machine list
herdr machine status "Build Mac"
```

`workbox`는 `~/.ssh/config`에 설정한 SSH Host 별칭 또는 적절한 SSH 대상이다. **IP/호스트명을 추측하지 말고 실제 환경의 값을 사용**한다. 원격 Herdr 버전·서버 호환 여부가 맞지 않으면 등록 과정에서 별도 안내/승인 요청이 뜰 수 있다.

### 9-2. Codex가 원격 에이전트를 제어

```bash
# 등록한 프로필의 실제 label 또는 ID 사용
herdr --machine "Build Mac" agent list
herdr --machine "Build Mac" pane list

# 원격 워커가 이미 있는 경우
herdr --machine "Build Mac" agent prompt <REMOTE_AGENT_NAME> \
  "현재 테스트 상태를 간결하게 보고해 줘." --wait --timeout 120000
```

- 머신마다 Pane ID와 에이전트 이름의 범위가 별개다. 로컬의 `w1:p1`과 원격의 `w1:p1`은 다른 것이다.
- 원격에서 Worktree를 쓸 때 해당 머신에 실제 Git 체크아웃과 의존성이 있는지 확인한다. **Herdr가 파일을 자동 동기화하지는 않는다.**
- 원격 서버의 CPU/메모리로 빌드와 테스트를 돌리는 것은 가능하지만, **클라우드 LLM의 모델 추론을 원격 GPU로 옮기는 기술은 아니다.**

### 9-3. 다른 네트워크에 있을 땐 Tailscale

1. 양쪽 기기에 Tailscale을 설치하고 같은 Tailnet에 참여시킨다.
2. Tailscale을 통해 각 기기의 사설 주소/호스트명 접근을 확인한다.
3. 원격 머신의 SSH가 그 경로로 정상 연결되는지 확인한다.
4. SSH가 된다면 `herdr machine add ...`로 등록한다.
5. ACL/디바이스 승인, SSH 키, OS 권한을 별도로 관리한다.

**영상의 '같은 와이파이처럼' 설명은 접근 편의성을 비유한 것**이다. Tailscale은 네트워크 경로를 제공하며, SSH 권한이나 기기간 파일 동기화까지 자동으로 완성하지는 않는다.

### 9-4. E2E 테스트를 원격으로 배분하기

```text
검증 항목 100개가 있다면:
1) Codex가 환경·의존성에 따라 테스트 묶음을 나눈다.
2) 각 원격 머신에 동일 커밋/의존성과 필요한 인증·시드 데이터를 준비한다.
3) 머신마다 독립된 테스트 실행 명령을 보낸다.
4) 각 머신에서 테스트 실행 후 결과 파일/로그를 수집한다.
5) Codex가 실패 유형을 통합하고 다시 수정 작업을 분배한다.
```

테스트 수가 많다고 무조건 10대에 동등 분할하는 것은 아니다. 공유 DB, 비용, 네트워크와 실행 환경의 일관성을 검토해야 한다.

---

## 10. 매일 사용하는 운영 규칙 (추천)

### A. 아침/프로젝트 시작

```text
현재 Git 상태와 지난 작업 결과를 확인하고,
오늘 처리할 독립 작업을 우선순위별로 3개만 제시해.
각 작업의 담당 워커와 검증 기준을 정하되 아직 작업하지 마.
```

### B. 기능 하나 맡기기

```text
기능: [원하는 기능]
오른쪽 Codex에서 작업을 계획하고 왼쪽 Claude Opus 5.5에 구현을 위임해.
기존 코드 규약을 준수하고 테스트를 실행한 뒤 변경 파일/테스트 로그를 보고해.
Codex는 완료 결과를 검토하고 실패 항목만 재작업을 요청해.
```

### C. 세 개 후보 동시에 제작

```text
[주제]를 서로 다른 콘셉트 세 가지로 만들어 보자.
3개 독립 Worktree, 워커, 평가 기준을 설정하고 동시에 실행해.
각 후보의 장단점과 실행 결과를 비교하고 추천안만 보고해. 자동 병합 금지.
```

### D. 다른 워커의 리뷰 받기

```text
현재 변경을 구현하지 않은 별도 에이전트에게 읽기 전용 코드 리뷰를 위임해.
버그 가능성과 테스트 누락을 우선 검토하고, 수정은 원래 구현 워커에게 되돌려 줘.
```

### E. 작업 중간 개입

```text
현재 Herdr의 모든 에이전트를 조회하고,
working/idle/done/blocked/unknown을 분류해.
막힌 워커의 실제 메시지를 읽어 필요한 승인이나 질문만 나에게 전달해.
```

### F. 세션 나갔다가 다시 접속

```bash
# Herdr 내부에서 Ctrl+B, q 로 분리
# 나중에 같은 컴퓨터에서 다시 접속
cd /경로/내-프로젝트
herdr
```

기존 세션이 존재하면 연결된다. 작업을 마치기 전에 Git 미커밋 변경, 진행 중인 서버/테스트, 원격 머신의 실행 상태를 확인한다. `herdr server stop`은 Pane 프로세스까지 영향을 줄 수 있으므로 단순 분리 용도로 사용하지 않는다.

---

## 11. 문제 해결 표

| 증상 | 확인할 것 | 대응 |
|---|---|---|
| Codex가 Herdr 명령 제어 못 함 | `HERDR_ENV`, Herdr 내부 실행 여부 | Herdr Pane에서 시작하고 공식 Skill 설치 재확인 |
| Claude가 Opus 5.5 아님 | Claude `/status`, 사용 권한 | 정확한 `--model claude-opus-5-5` 전달, 허용 모델 확인 |
| `agent start` 실패 | 대상 Pane 셸 활성 상태인지 | 빈 셸 Pane 확보, `herdr agent` 도움말 확인 |
| 오른쪽 Codex가 사라짐 | Split 대상 잘못 선택했는지 | 다른 세션 강제 종료하지 말고 현재 레이아웃부터 조사 |
| 에이전트 `blocked` | 권한/질문 팝업 | 본인이 승인할 내용 확인. 무조건 자동 Enter 금지 |
| 작업 timeout | 실제 실행 중인지 | `agent get`/`agent read` 후 재시도 판단 |
| 여러 AI가 같은 코드 덮어씀 | 동일 디렉터리/파일 동시 수정 | 기본 1 writer 원칙 또는 Worktree 분리 |
| Worktree 브랜치 충돌 | 동일 브랜치 중복 사용 | 기능별 고유 브랜치 이름과 체크아웃 경로 설정 |
| 원격 머신 연결 실패 | SSH, Tailscale, 네트워크, Herdr 버전 | `ssh workbox`, `machine status`, 인증 상태 확인 |
| '완료' 표시인데 테스트 실패 | 에이전트 완료 ≠ 품질 통과 | 빌드/테스트 결과와 diff 직접 확인 |
| 메인 Codex 컨텍스트가 지나치게 커짐 | 모든 로그를 메인에 전달하는지 | 결과 요약/테스트 증거/필수 오류만 보고 |

---

## 12. 영상 타임라인 인덱스: 빠르게 다시 찾기

| 시각 | 영상의 핵심 팁 | 문서 위치 |
|---|---|---|
| [0:00](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=0) | AI가 AI에게 작업을 배정하는 워크플로우 | §0, §3 |
| [1:12](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=72) | Ghostty 및 Herdr 설치 개념 | §1 |
| [2:14](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=134) | Workspace·Tab·Pane 구조 | §2, §8 |
| [3:05](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=185) | Tab 생성 및 Pane 좌우/상하 분할 | §2, §8 |
| [4:22](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=262) | Ctrl+B 단축키와 확대 | §8 |
| [5:08](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=308) | 에이전트 상태 및 막힘 표시 | §7 |
| [6:13](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=373) | Skill로 Worktree + Workspace 자동 생성 | §1, §4 |
| [7:04](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=424) | Worktree만 만들고 현재 Tab에 Pane 추가 | §4 |
| [8:31](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=511) | 콘텐츠 Tab 분류 vs 개발 Worktree 분리 | §8 |
| [9:00](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=540) | Codex를 메인 에이전트로 사용 | §2, §3 |
| [10:18](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=618) | Opus 5.5 Pane 생성 및 구현 위임 | §2, §3 |
| [10:52](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=652) | 메타프롬프팅과 컨텍스트 유지 | §3 |
| [12:42](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=762) | Opus 세 개로 후보 병렬 제작 | §5 |
| [13:16](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=796) | 여러 대안을 동시에 만들고 비교·머지 | §5 |
| [14:08](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=848) | Skill로 단계별 자동화·모니터링 | §6 |
| [15:16](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=916) | 원격 머신 연결이 핵심 강점 | §9 |
| [16:33](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=993) | Machines 등록 및 원격 터미널 | §9 |
| [17:59](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=1079) | 로컬 1개 + 원격 2개 워커 분산 | §9 |
| [18:54](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=1134) | E2E 테스트 여러 머신에 분배 | §9 |
| [20:14](https://www.youtube.com/watch?v=1AlbTXb8oPc&t=1214) | Tailscale로 다른 네트워크 연결 | §9 |

---

## 13. 공식 참고 자료 (설치/CLI를 확인할 때 우선 참조)

1. [Herdr 설치](https://herdr.dev/tui/docs/install/)
2. [Herdr 빠른 시작](https://herdr.dev/tui/docs/quick-start/)
3. [Herdr 공식 Skill 설치 및 사용](https://herdr.dev/tui/docs/agent-skill/)
4. [Herdr 공식 CLI 참조](https://herdr.dev/tui/docs/cli-reference/)
5. [Herdr 에이전트 자동화 공식 가이드](https://herdr.dev/tui/docs/agent-automation/)
6. [Herdr 키보드 단축키](https://herdr.dev/tui/docs/keyboard/)
7. [Herdr 원격 머신 연결](https://herdr.dev/tui/docs/connecting-machines/)
8. [Claude Code 공식 모델 선택](https://support.claude.com/en/articles/11940350-claude-code-model-configuration)
9. [Tailscale 요금/무료 범위](https://tailscale.com/pricing)
10. [원본 영상](https://www.youtube.com/watch?v=1AlbTXb8oPc)

---

## 14. 마지막 점검표 — 여기까지 되면 목표 달성

- [ ] Herdr TUI에서 **왼쪽 Claude Opus 5.5**, **오른쪽 Codex**가 실제로 떠 있다.
- [ ] Codex는 메인 오케스트레이터로 자신의 역할을 이해한다.
- [ ] `herdr` 공식 Skill이 Codex에 로드된다.
- [ ] Codex가 Herdr CLI로 Claude에게 작업을 전달하고 결과를 읽는다.
- [ ] 같은 Git 저장소를 사용하지만 동시 파일 수정 충돌을 방지한다.
- [ ] 작업 완료를 `agent done` 표시만 보고 판단하지 않고 테스트로 검증한다.
- [ ] 기능이 독립적일 때 Worktree를 생성하고 병렬 워커를 추가할 수 있다.
- [ ] 여러 후보를 비교하고 **승인된** 결과만 병합한다.
- [ ] 원격 머신/ Tailscale은 필요할 때만 선택적으로 확장한다.
- [ ] 메인 Codex의 대화 컨텍스트는 계속 유지된다.

**한 줄 결론:** `Herdr`는 화면과 에이전트를 제어하고, `Codex`는 작업 계획·배정·검증을 담당하며, `Claude Opus 5.5`는 독립적인 구현을 수행한다. **Git Worktree + 테스트 + 승인**이 이를 안전한 협업 개발 시스템으로 만든다.
