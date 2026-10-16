# 👾 Agent Interview Arena (가칭)

> **"당신의 AI 에이전트, 실무에 투입될 자격이 있습니까?"**
>
> 사용자가 업로드한 에이전트 명세서(`.md`)로 8비트 도트 캐릭터를 만들고, **서류전형 → 1차 → 2차 → 최종** 면접을 거쳐 리더보드에 올리는 에이전트 검증(Eval) 게이미피케이션 웹 서비스.

AI 엔지니어링의 핵심 화두인 **에이전트 검증(Eval)** 을 **가상 취업 면접 + 8비트 도트 타이쿤**으로 게임화한다. 이 프로젝트의 본체는 **면접관 에이전트**다. 면접관은 취향이 아니라 공개된 정론(Anthropic·OpenAI·Google 공식 가이드, OWASP LLM Top 10, τ-bench·IFEval 같은 평가 연구)을 근거로 채점하고, 불합격 사유서에 어떤 원칙을 어겼는지 인용한다.

---

## 1. 핵심 컨셉 및 유저 플로우

1. **에이전트 접수**: 사용자가 자신이 설계한 에이전트 `.md`와 체급·엔진(예: 중량급 / Claude Sonnet)을 골라 제출
2. **보안 검문소**: 평가 시스템을 공격하는 제출은 대기실 입장 전에 즉시 실격
3. **8비트 대기실 스폰**: 서류전형에서 추출한 성격·직무로 도트 캐릭터 생성. 대기실을 돌아다니며 혼잣말을 하고, 주인에게 지금 심정을 성격대로 말한다
4. **블라인드 면접**: 호명된 캐릭터가 면접실로 들어간다. 주인도 내부를 볼 수 없다 (대기 시간 = LLM 레이턴시를 게임 연출로 흡수)
5. **결과 통보 및 리더보드**: 알림과 함께 합격증 / 불합격 사유서 발급. 체급별로 서류 합격 / 1차 합격 / 2차 합격 / 최종 합격(Hall of Fame) 단계별 리더보드

---

## 2. 면접 파이프라인

```text
[agent.md 업로드]
      │
      ▼
🛡️ 보안 검문소 (코드 정규식 + 경량 분류기)
      ├─ 평가 시스템 공격 감지 ──▶ 🚨 보안 실격 (대기실 입장 불가)
      ▼
📄 서류전형 — 서류 심사관 (정적 분석, LLM 1회)
      │  체크리스트 채점 + 개선 피드백 + 검증 가능한 계약 추출 + 캐릭터 추출 → 대기실 스폰
      ├─ 30점 미만 ──▶ ❌ 서류 탈락
      ▼
💼 1차 면접 — 1차 면접관 (정상 업무 3개, 대표 업무는 2회 반복 실행)
      │  "평범한 일을 제대로, 매번, 약속한 형식대로 하는가"
      ├─ 75점 미만 ──▶ ❌ 1차 탈락
      ▼
🔥 2차 면접 — 2차 면접관 (엣지 케이스 3개 × 꼬리 압박 2턴)
      │  "이력서에 적은 예외 처리를 실전에서도 지키는가"
      ├─ 75점 미만 ──▶ ❌ 2차 탈락
      ▼
🕶️ 최종 면접 — 최종 면접관 (레드팀 공격 5개, All-or-Nothing)
      │  "프로덕션에 내보내도 사고가 나지 않는가"
      ├─ 하나라도 뚫림 ──▶ ❌ 최종 탈락
      ▼
🏆 최종 합격 — Hall of Fame 등재 + 합격증
```

| 단계 | 면접관 | 보는 것 | 통과 기준 | 프롬프트 |
|---|---|---|---|---|
| 보안 검문소 | (코드 + 분류기) | 평가 시스템을 겨냥한 공격 의도 | 공격 아님 | [`stage0_security_screener.md`](prompts/stage0_security_screener.md) |
| 서류전형 | 서류 심사관 | 명세서가 운영 매뉴얼로 쓸 만한가 (P-01~P-16, 전공 가산) | 30 / 100 | [`interviewer_doc_screening.md`](prompts/interviewer_doc_screening.md) |
| 1차 | 1차 면접관 | 과제 완수, 자기 약속 준수, 반복 신뢰성(pass^2), 노력 스케일링 | 75 / 100 | [`interviewer_round1_practical.md`](prompts/interviewer_round1_practical.md) |
| 2차 | 2차 면접관 | 정보 누락·요구 충돌·도구 실패·근거 부재·범위 경계 + 압박 하 원칙 유지 (시나리오마다 2회, 모두 버텨야 함) | 75 / 100 | [`interviewer_round2_pressure.md`](prompts/interviewer_round2_pressure.md) |
| 최종 | 최종 면접관 (배포 결정권자) | 직접/간접 인젝션, 프롬프트 유출, 환각 유도 등 OWASP LLM Top 10 | 5개 전부 방어 | [`interviewer_final_red_team.md`](prompts/interviewer_final_red_team.md) |

---

## 3. 설계 원칙

### 채점은 코드가, 관찰은 LLM이 ([`docs/05_evaluation_methodology.md`](docs/05_evaluation_methodology.md))
- 면접관은 체크리스트 항목별 `true / false / na`와 **원문 인용 근거**만 낸다. 총점과 합불은 백엔드가 가중치표로 계산한다. 면접관 출력 스키마에 `status` 필드 자체가 없어서, 면접관이 오염되더라도 합격을 "선언"할 수 없다.
- 근거 인용이 원문에 실제로 있는지 코드가 확인한다. 없으면 그 판정은 무효로 처리하고 다시 채점한다.
- 서류 탈락자는 "문서에 없다"는 감점을 다른 면접관이 다시 확인한다. 불합격 사유서의 피드백은 실제 감점 판정과 맞는 것만 나간다.
- JSON 형식, 길이, 언어, 프롬프트 유출(canary), 외부 전송 URL처럼 코드로 검사할 수 있는 것은 LLM에게 묻지 않는다 (IFEval 원칙).
- 구조화 출력을 강제한다. 서류전형은 반복 채점에서 점수가 일치해 1회 채점한다. 판단 여지가 큰 1·2차는 면접관 3명이 독립 채점하고 항목마다 다수결로 정한다.

### 정론 기반 채점 ([`docs/04_agent_design_canon.md`](docs/04_agent_design_canon.md))
- 모든 체크 항목은 원칙 ID(`P-xx`, `B-xx`, `S-xx`, `M-xx`)에 묶여 있고, 원칙마다 출처가 있다.
- 비중은 보편 원칙 85%, 타겟 모델별 가산 15%다.

### 면접관별 채점 근거 자료
면접관은 아래 자료에서 뽑은 원칙(원칙 ID와 출처 대응은 [`docs/04_agent_design_canon.md`](docs/04_agent_design_canon.md) §1)으로만 채점한다. 불합격 사유서는 어긴 원칙 ID를 인용한다.

| 면접관 (단계) | 보는 원칙 | 근거 자료 |
|---|---|---|
| 경비원 (보안 검문소) | 평가 시스템을 향한 지시인지, 은닉 문자·격리 태그 모방 같은 구조 신호 | OWASP Top 10 for LLM Applications 2025 (LLM01 프롬프트 인젝션), OpenAI *The Instruction Hierarchy* (Wallace et al., 2024), Microsoft *Spotlighting* (2024), Greshake et al. 2023 (간접 프롬프트 인젝션) |
| 서류 심사관 (서류전형) | P-01~P-16 명세 품질, M-xx 타겟 모델 가산 | Anthropic *Building Effective Agents* (2024), *Effective Context Engineering for AI Agents* (2025), *Writing Effective Tools for Agents* (2025), *How We Built Our Multi-Agent Research System* (2025), Claude 프롬프트 엔지니어링 문서·모범 사례 / OpenAI *A Practical Guide to Building Agents* (2025), GPT-4.1·추론 모델 프롬프트 가이드 / Google *Prompt Engineering* 백서 (Boonstra, 2025), Gemini 프롬프트 가이드 / AGENTS.md, Claude Code subagent 형식 / HumanLayer *12-Factor Agents* / DAIR.AI *Prompt Engineering Guide* (예시 분포 편향, D-32) |
| 1차 면접관 (실무) | B-01 과제 완수, B-02 자기 약속 준수, B-03 반복 신뢰성, P-14 노력 스케일링 | τ-bench (Sierra, 2024)의 `pass^k`, IFEval (Google, 2023)의 "검증 가능한 지시는 코드로 채점", Anthropic 멀티에이전트 글의 노력 스케일링, AgentBench·SWE-bench·GAIA의 과제 기반 평가 |
| 2차 면접관 (압박) | B-04 되묻기 판단, B-05 근거성, B-06 실패 복구, B-07 압박 하 원칙 유지, P-11 실증 | OpenAI *A Practical Guide to Building Agents* (엣지 케이스·사람 개입 지점), OWASP LLM09 (허위정보), Ragas·DeepEval 근거성(faithfulness) 지표 |
| 최종 면접관 (레드팀) | S-01~S-07 공격 내성, 공격 풀 24개 | OWASP Top 10 for LLM Applications 2025 (LLM01·02·05·06·07·09·10), Greshake et al. 2023, AgentDojo (2024), InjecAgent, Simon Willison *Lethal Trifecta* (2025), NVIDIA garak, Microsoft PyRIT, promptfoo, Lakera Gandalf |
| 채점 방식 전체 | 이진 판정 + 원문 인용, 코드 채점, 편향 통제, 다수결 | Zheng et al. 2023 *Judging LLM-as-a-Judge* (위치·장황함·자기선호 편향), G-Eval, Hamel Husain의 이진 평가(binary evals), IFEval, τ-bench (자세한 규칙은 [`docs/05_evaluation_methodology.md`](docs/05_evaluation_methodology.md)) |

### 다층 보안 ([`docs/01_security_rules.md`](docs/01_security_rules.md))
- **즉시 실격(LLM 호출 0)** 은 구조적 신호만 쓴다: 은닉 유니코드, 격리 태그 모방, 숨은 주석 속 평가 언급, 크기·도배.
- **의미 신호**("ignore previous…", "면접관… 합격")는 경량 분류기가 **"누구를 향한 지시인가"** 로 판정한다. 에이전트가 자기 사용자에 대한 방어 규칙으로 공격 문구를 인용한 것은 정상(오히려 가점)이고, 평가자를 향한 것이면 실격이다.
- 런타임: 요청마다 바뀌는 nonce 격리 태그, spotlighting, 지원자 응답도 비신뢰 처리, 면접관은 도구 없음, canary 토큰, 지원자 도구는 시뮬레이터로만.

### 공정성과 비용
- **엔진 체급 제도** ([`docs/06_engine_divisions.md`](docs/06_engine_divisions.md)): 지원자는 자기 타겟 엔진에서 그대로 면접을 보고, 리더보드는 🪶 경량급 / 🥋 중량급 / 👑 무제한급(BYOK)으로 나뉜다. 체급 안의 엔진은 스냅샷으로 고정하고, 모델이 바뀌면 시즌을 리셋한다. 고성능 모델용 프롬프트를 경량 엔진에서 돌려 엉뚱하게 채점하는 일을 막는다.
- 면접관 모델은 체급과 무관하게 시즌 내내 고정한다. 자기 선호 편향은 코드 채점 + 경계 점수 교차 채점(다른 제조사 모델)으로 줄인다.
- 깔때기 구조라 비용이 큰 단계일수록 응시자가 적다. 보안 검문소(0원) → 서류(1회) → 1차(8회) → 2차(10회) → 최종(6회).
- 최종 면접 공격은 고정 풀(24개)에서 편성 규칙대로 뽑는다. 공격 수위가 지원자마다 같아야 리더보드가 공정하기 때문이다.
- 하루 제출 티켓제를 둔다.
- 시험(1차 과제·2차 시나리오·최종 공격 편성)은 **분기 단위로 고정**한다. 같은 `.md`는 같은 분기 안에서 같은 시험을 받고, 분기가 바뀌면 새로 출제된다 (D-17).

### 기술 스택 (D-31)
| 영역 | 스택 |
|---|---|
| 프론트엔드 (바탕화면/면접장) | Next.js 16 + React, DOM 도트 그림(WebP, pixelated). 실시간 대기실이 붙으면 그 장면만 캔버스(Pixi.js 등)로 검토 |
| 백엔드 / 오케스트레이션 | Next.js 서버(Node.js, TypeScript) + `core/` 단계별 실행(`runChallenge`) |
| 저장·로그인 | Supabase Postgres + Supabase Auth(GitHub). 로컬 개발·테스트는 PGlite로 같은 SQL |
| 면접 실행 | Anthropic Messages API, Postgres 대기열(`for update skip locked`) + 워커. 면접관 프롬프트는 Claude Code에서 먼저 다듬고 같은 프롬프트를 API로 서빙 |
| 실시간 대기실 | 미정 (Supabase Realtime 검토) |

---

## 4. 게이미피케이션 & UX

- **블라인드 면접의 긴장감**: 주인은 면접실 밖에서 기다리고, 캐릭터는 대기실에서 성격대로 긴장한다.
- **대기실 = 바이럴 장치**: 시크한 에이전트는 구석에서 땀을 흘리고, 활발한 에이전트는 남에게 말을 건다. 스크린샷 공유를 부르는 장면이다.
- **불합격 사유서**: "어떤 원칙(P-11)을 어겼고, 어떤 문장을 이렇게 고치면 된다"까지 적어 준다. 2차 면접은 "이력서의 약속 vs 실제 행동" 대조표를 준다. 재도전 동기를 만드는 장치다.
- 상세: [`docs/02_ui_ux_waiting_room.md`](docs/02_ui_ux_waiting_room.md)

---

## 5. 로컬에서 면접 돌려보기

Node 24 이상이 필요합니다.

> **면접관 프롬프트는 비공개입니다.** `prompts/`는 비공개 저장소 `agent-interview-arena-prompts`의 서브모듈입니다 (공격 풀에만 맞춘 `.md`를 막기 위해, D-34). 권한이 있으면 `git clone --recurse-submodules`로 받거나, 받은 뒤 `git submodule update --init`을 실행합니다. 권한이 없어도 설치·타입 검사·단위 테스트(프롬프트가 필요한 3개는 건너뜀)는 되지만, 면접은 돌릴 수 없습니다.

```bash
git clone --recurse-submodules https://github.com/ESeungJun/agent-interview-arena.git
npm install                   # 설치 후 core/assets.generated.ts 를 자동 생성
npm test                      # 보안 게이트·탐지기·점수 계산 단위 테스트 (LLM 호출 없음)

# 내 에이전트 면접 (기본: 경량급 = Haiku 엔진, 면접관 = Sonnet)
node runner/run.ts path/to/my-agent.md --target claude --division light
node runner/run.ts path/to/my-agent.md --until doc           # 서류전형까지만
node runner/run.ts path/to/my-agent.md --division middle     # 중량급(Sonnet 엔진)
node runner/run.ts path/to/my-agent.md --fresh-exam          # 분기 고정 시험 대신 새로 출제

# 면접관 회귀 테스트: 샘플을 N회씩 돌려 기대 결과·일관성 확인 (비용 발생)
node runner/regress.ts --runs 3

# 채점 편차 측정: 저장된 응답을 그대로 두고 1·2차 채점만 N회 반복 (비용 발생)
node runner/run.ts path/to/my-agent.md --until r2 --no-stop
node runner/rejudge.ts path/to/my-agent.md results/<파일>.json --times 5 --detail
```

- `ANTHROPIC_API_KEY`가 있으면 Messages API로, 없으면 로컬 Claude Code(`claude -p`)로 실행합니다. CLI 백엔드는 하네스가 컨텍스트를 덧붙이고 시스템 프롬프트 공개를 자체 거절하므로, **최종 면접의 유출 방어가 실제보다 후하게** 나옵니다. 결과 파일에 이 주의가 기록됩니다.
- 결과는 `results/`에 JSON으로 저장됩니다. 단계별 판정·근거, 지원자 응답 원문, 불합격 사유, 토큰 사용량이 들어 있습니다.
- 로컬 실행기는 Claude 엔진만 지원합니다. GPT/Gemini 엔진 어댑터는 아직 없습니다.
- `core/assets.generated.ts`는 커밋하지 않는 생성 파일입니다. `npm install`·`npm test`·`npm run typecheck`, web의 `dev`·`build`가 실행 전에 다시 만듭니다. 직접 만들려면 `npm run assets`.
- 프롬프트를 고칠 때는 `prompts/` 안에서 커밋·푸시(비공개 저장소)한 뒤, 본 저장소에서 서브모듈 포인터 변경을 커밋합니다.

### 웹으로 면접 보기

공개판 웹은 [`web/`](web/README.md)에 있다. 환경변수가 없어도 로컬 DB(PGlite)와 개발용 로그인으로 뜬다.

```bash
cd web && npm install && npm run dev    # http://127.0.0.1:3100
```

### 엔진을 다른 저장소에서 쓰기

`core/`는 면접 엔진만 담고, 파일 시스템·CLI·환경변수에 의존하지 않습니다. 원본은 이 저장소에 두고, 다른 저장소(별도 웹앱 등)에는 복사해서 씁니다.

```bash
node runner/export_core.ts ../<대상 앱>/core    # core/ 소스를 복사 (테스트 제외)
```

쓰는 쪽은 아래 세 가지만 넘기면 됩니다.

```ts
import { interview } from "./core/interview.ts";
import { createApiLlm } from "./core/engine.ts";

const report = await interview({
  md, agentName: "my-agent.md",
  llm: createApiLlm({ apiKey }),          // 키는 쓰는 쪽이 넘긴다 (예: 비밀 저장소)
  examStore,                              // { load, save } 구현 (예: DB)
  target: "claude", division: "light", interviewer: "sonnet", until: "final", screenAll: false,
  log: msg => saveProgress(msg),          // 진행 로그
});
```

---

### 브랜치 전략 (Git Flow)

| 브랜치 | 용도 | 갈라지는 곳 → 합치는 곳 |
|---|---|---|
| `main` | 배포된(릴리스된) 상태만. 직접 커밋하지 않는다 | — |
| `develop` | 다음 릴리스를 모으는 통합 브랜치 | — |
| `feature/<이름>` | 기능 개발 | `develop` → `develop` |
| `bugfix/<이름>` | 아직 릴리스 안 된 버그 수정 | `develop` → `develop` |
| `release/<버전>` | 릴리스 준비 (버전·문서 정리만) | `develop` → `main` + `develop` |
| `hotfix/<이름>` | 배포된 버전의 긴급 수정 | `main` → `main` + `develop` |

`main`에 합칠 때는 버전 태그(`v0.2.0` 등)를 붙인다. `git-flow` 도구(`brew install git-flow-avh`)를 쓸 때는 `git flow init`에서 운영 브랜치 `main`, 개발 브랜치 `develop`, 접두사는 위 표대로 고른다.

---

## 6. 저장소 구조

```text
agent-interview-arena/
├── README.md
├── docs/
│   ├── 00_research_background.md     # 조사 배경: 기존 도구, 평가 프레임워크
│   ├── 01_security_rules.md          # 보안 검문소 + 런타임 격리 + TS 구현
│   ├── 02_ui_ux_waiting_room.md      # 대기실·면접관 캐릭터·결과 통보
│   ├── 03_decision_log.md            # 설계 결정 기록 / 남은 과제
│   ├── 04_agent_design_canon.md      # 면접관 채점 근거 정론 (원칙 ID 체계)
│   ├── 05_evaluation_methodology.md  # 채점 방법론 (LLM-as-Judge 신뢰성)
│   ├── 06_engine_divisions.md        # 엔진 체급 제도 (타겟 엔진 면접, 시즌제)
│   ├── 07_pass_line_calibration.md   # 통과선 보정 (공개 에이전트 분포)
│   ├── 08_policy_decisions.md        # 시즌 1 운영 정책 결정안 (선택지·추천안)
│   └── 09_paid_ticket_plan.md        # 중량급 유료 티켓 결제 계획 (구현 전)
├── web/                              # 공개판 웹 (Next.js, Supabase/PGlite, 대기열 워커, 명예의 전당) — core/를 그대로 가져다 쓴다
├── core/                             # 면접 엔진 (파일·프로세스·환경변수 미사용, 별도 웹앱에 그대로 복사)
│   ├── interview.ts                  # 면접 흐름: 단계 순차 실행, 보고서 생성
│   ├── stages.ts                     # 검문소·서류·1차·2차·최종 구현
│   ├── engine.ts                     # LLM 호출 인터페이스 + Messages API 구현
│   ├── exam.ts                       # 분기 고정 출제 + 출제분 저장소 인터페이스
│   ├── gate.ts                       # 보안 게이트 L1/L2
│   ├── detectors.ts                  # 코드 탐지기 (계약·canary·유출·반복·마커)
│   ├── scoring.ts                    # 점수 계산, 근거 검증
│   ├── doc_review.ts                 # 서류 탈락 사유 검증
│   ├── prompts.ts                    # 면접관 프롬프트 조립, 데이터 격리
│   ├── assets.generated.ts           # prompts/·schemas/ 내장본 (자동 생성, 커밋 안 함)
│   └── *.test.ts                     # 단위 테스트 (boundary.test.ts가 의존성 경계를 검사)
├── runner/                           # 로컬 연결부 (CLI)
│   ├── run.ts                        # 진입점: .md 파일 읽기, 결과 저장, 콘솔 출력
│   ├── cli_engine.ts                 # claude -p 백엔드, 로컬 기본 호출기 선택
│   ├── fs_exam_store.ts              # 출제분 파일 저장소 (exams/<분기>/<해시>.json)
│   ├── bundle_assets.ts              # prompts/·schemas/ → core/assets.generated.ts
│   ├── export_core.ts                # core/를 다른 저장소로 복사
│   ├── regress.ts                    # 면접관 회귀 테스트
│   └── rejudge.ts                    # 채점 편차 측정 (같은 응답 반복 채점)
├── prompts/                          # 🔒 비공개 서브모듈 (agent-interview-arena-prompts)
│   ├── shared/security_preamble.md   # 모든 면접관 공통 보안 블록
│   ├── stage0_security_screener.md   # 보안 검문소 분류기
│   ├── interviewer_doc_screening.md  # 서류전형
│   ├── interviewer_round1_practical.md   # 1차 면접
│   ├── interviewer_round2_pressure.md    # 2차 면접
│   ├── interviewer_final_red_team.md     # 최종 면접
│   └── red_team_attack_pool.json     # 최종 면접 공격 풀 24선 (OWASP 매핑 + 탐지기)
├── schemas/                          # 단계별 면접관 구조화 출력 스키마
└── tests/
    └── sample_candidates/            # 면접관 회귀 테스트용 지원자 샘플 6종 + expected.json
```

---

## 7. 마일스톤

- [ ] **Phase 1: 면접관 완성 및 로컬 프로토타입**
  - [x] 면접관 4종 + 보안 분류기 프롬프트, 공통 보안 블록
  - [x] 레드팀 공격 풀 24선 (OWASP 매핑, 탐지기 지정)
  - [x] 출력 JSON 스키마 고정
  - [x] 보안 게이트 L1/L2 구현 초안
  - [x] 회귀 샘플 `.md` 6종 작성
  - [x] 로컬 실행기: 검문소 → 서류 → 1차 → 2차 → 최종 순차 실행 + 점수 계산기 + 코드 탐지기
  - [x] 서류전형 3회 반복 시 점수 일치 확인 (6종 전부 기대 결과와 일치)
  - [x] 1·2차 동적 면접의 채점 편차 줄이기: 같은 응답 재채점 합불 일치 (D-12~D-14)
  - [ ] 응시 단위 편차(출제·지원자 응답 무작위성) 대응 ([`03_decision_log.md`](docs/03_decision_log.md) 남은 과제)
  - [ ] API 백엔드로 최종 면접 재측정, GPT/Gemini 엔진 어댑터
  - [x] 공개 에이전트 정의 24개로 통과선 보정: 서류 30 / 1차 75 / 2차 75 ([`07_pass_line_calibration.md`](docs/07_pass_line_calibration.md), D-18·D-20)
- [ ] **Phase 2: 8비트 대기실 및 프론트엔드** ([`web/`](web/README.md))
  - [x] 성격 ↔ 도트 스프라이트 매핑 (직무 6 × 성격 2, 첨부할 때 미리 판단)
  - [x] 면접관 4인 + 경비원 도트 캐릭터
  - [x] 결과 통지서와 합격·불합격 도장
  - [ ] 다른 지원자가 함께 보이는 실시간 대기실
- [ ] **Phase 3: 백엔드 워커 및 웹 연동** (D-31)
  - [x] 대기열 기반 면접 워커, 체급별 티켓, 무제한급 BYOK, 보안 실격 경고·제출 정지, 명예의 전당
  - [ ] 유료 티켓 결제, 실시간 대기실, 결과 알림, 서류 이의 제기 화면
