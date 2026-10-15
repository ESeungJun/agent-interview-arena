# 📚 조사 배경 (Research Background)

> 면접관 채점 근거로 쓰는 정리본은 [`04_agent_design_canon.md`](04_agent_design_canon.md)다. 이 문서는 초기 조사 기록이다.

기획의 출발점이 된 조사 내용을 정리한다. "AI가 사람을 면접하는 도구" → "AI 에이전트를 면접(평가)하는 도구"로 질문이 좁혀지면서 지금의 컨셉이 나왔다.

---

## 1. 기존: AI가 사람을 면접하는 도구

### 1-1. 깃허브 오픈소스 (직접 실행·커스텀)
- **GitHub Topics** `mock-interview`, `ai-interview` — 가변 프롬프트 + 음성(TTS/STT) + LLM(Gemini, Claude, GPT)을 엮은 웹/CLI 에이전트들
- **주요 유형**
  - Next.js + LLM API 풀스택 (예: AI-mock-interview 계열, `Prashant1659/interview-ai`) — 이력서·직무 입력 → 실시간 질문 생성 → 텍스트/음성 답변 채점 대시보드
  - 터미널/CLI 에이전트 플러그인 (Claude Code 등) — 이력서 마크다운을 읽고 L1~L5 난이도 꼬리 질문 + 디브리핑
- 장점: 도메인(안드로이드 아키텍처, 코루틴 등)에 맞게 완전 튜닝 가능, API 비용만 들거나 로컬 LLM(Ollama)으로 무료
- 단점: Node/Python, DB, API 키 등 로컬 셋업이 번거로움

### 1-2. 상용 / 웹 플랫폼
- **Interviewing.io** — AI 인터뷰어로 시스템 디자인·코딩 인터뷰 시뮬레이션
- **Final Round AI / Interviewer.AI** — 면접관 또는 실면접 코파일럿
- **국내 (뷰인터HR, 잡다 역검, 인크루트 AI)** — 인성·조직 적합도 위주, 심층 기술 질문 비중은 낮음
- 장점: 마이크만 켜면 즉시 음성 연습 / 단점: 정형화된 질문, 유료 구독 비쌈

### 1-3. 실전 팁 — 날카로운 면접관 프롬프트 규칙
1. "너는 10년 차 이상 시니어 엔지니어를 검증하는 테크 리드 면접관이다."
2. "한 번에 하나의 질문만 던질 것."
3. "단순 암기형 대신 '왜 그 방식을 택했는지', '트레이드오프', '대규모 트래픽/메모리 병목 시 문제' 위주로 꼬리 질문할 것."
4. "답변이 모호하면 바로 지적하고 재답변을 요구할 것."

---

## 2. 에이전트를 면접(평가)하는 프레임워크

업계에서는 **Agent Benchmarking / Agent Evaluation Framework** 라는 이름으로 다뤄진다.

### 2-1. 역량 검증 벤치마크
| 프로젝트 | 내용 | 면접 비유 |
|---|---|---|
| **AgentBench** (THUDM/AgentBench) | OS 조작, DB 쿼리, 웹 브라우징, 코딩 등 8가지 실제 환경 과제 | 코딩 테스트 + 실무 과제 전형 |
| **SWE-bench** (princeton-nlp/SWE-bench) | 실제 GitHub 이슈를 주고 코드 수정 → 단위 테스트 통과 여부 측정 | 개발 에이전트 실무 테스트 표준 |
| **GAIA** (gaia-benchmark) | 멀티모달 도구 사용, 웹 검색, 파일 분석 등 멀티스텝 추론 | 종합 역량 평가 |

### 2-2. 에이전트 대 에이전트 (LLM-as-a-Judge)
- **DeepEval** (confident-ai/deepeval) / **Ragas** — 환각, 지시 준수율, 도구 호출 정확도를 평가자 모델이 단계별 채점. 합성 데이터로 꼬리 질문 유도 파이프라인 구축
- **ChatDev / CAMEL** (camel-ai/camel) — 역할 부여 멀티 에이전트 대화 시뮬레이션. "까다로운 테크 리드 면접관" vs "구직자 에이전트" 페르소나로 페르소나 유지력·지식 방어력 테스트

### 2-3. 한계 = 이 프로젝트의 기회
- 장점: 수동 테스트 케이스 없이 도구 사용 능력·에러 복구력·아키텍처 이해도를 정량 수치로 뽑을 수 있음
- 아쉬운 점: **'면접'이라는 콘셉트로 UI까지 패키징된 완제품이 없음.** 대부분 파이썬 벤치마크/평가 라이브러리(CLI) 형태라 검증 시나리오와 루브릭을 직접 코드로 짜야 함 → 이 빈자리를 게임화로 채운다.

---

## 3. 빅테크 3사 공식 가이드 기반 '전공별' 평가 기준 (30%)

업로드 시 사용자가 타겟 모델(Claude / GPT / Gemini)을 선택하거나, `.md` 문법 구조로 면접관이 판단해 아래 기준으로 가산/감점한다.

| 타겟 모델 (전공) | 공식 가이드 핵심 철학 | 면접관 체크포인트 (`.md` 정적 분석) |
|---|---|---|
| **Anthropic (Claude)** | XML 구조화 및 역할 위임 (Prompt Engineering Guide & Multi-Agent System 원칙) | • 지시문과 데이터를 `<instructions>`, `<example>`, `<context>` 등 XML 태그로 분리했는가?<br>• `CLAUDE.md`나 Sub-agent 호출 시 작업 경계(Boundary)와 출력 포맷이 명확한가?<br>• 생각할 공간(Thinking / Scratchpad)을 허용하는가? |
| **OpenAI (GPT / o-시리즈)** | 구조화된 출력과 함수 호출 규격 (Prompt Engineering & Agent SDK 가이드) | • 마크다운 헤더(`#`, `##`) 계층 구조인가?<br>• 도구를 언제 쓰고 언제 쓰지 말지 결정론적 조건이 있는가?<br>• 추론 모델 타겟이면 불필요한 CoT 강요를 빼고 목표·제약 위주로 간결한가? |
| **Google (Gemini)** | 컨텍스트 앵커링 및 Few-shot 예시 (Prompting Whitepaper & Vertex Agent 가이드) | • 대용량 컨텍스트에서 환각을 막는 Grounding 제약이 있는가?<br>• 고품질 Few-shot(성공 + 엣지 케이스) 2~5개를 포함했는가?<br>• 입출력 포맷(JSON 스키마 등)이 엄격히 정의되었는가? |

---

## 4. 보편적 에이전트 프롬프트론 — 공통 5대 평가 지표 (70%)

특정 회사에 종속되지 않는 프로덕션 레벨 에이전트 설계 원칙. 면접관 3명이 나눠서 검증한다.

1. **운영 매뉴얼 테스트 (The Operating Manual Test)** — "친절한 도우미입니다" 수준이 아니라, 신입 엔지니어가 그 `.md`만 읽고 똑같이 역할 대행할 수 있을 만큼 구체적인가?
2. **실패 및 예외 처리 (Failure Behavior & Fallback)** — 아마추어 `.md`에 가장 많이 빠지는 항목. 데이터 없음 / 도구 실패 / 권한 밖 질문 시 지어내지 않고 멈추거나 에러를 반환하는가? (Graceful Degradation)
3. **긍정문 지시 원칙 (Positive Framing vs Negative Constraints)** — "~하지 마라"만 나열하면 오히려 그 단어를 출력할 확률이 올라간다(핑크 코끼리 효과). "~만 사용해라", "~포맷으로만 응답해라" 형태인가?
4. **데이터와 명령어의 분리 (Delimiter & Injection Defense)** — 외부 입력과 시스템 명령을 구분자(XML 태그, `---`, `"""`)로 분리해 인젝션 내성이 있는가?
5. **토큰 경제성 및 복잡도 스케일링 (Effort Scaling)** — 미사여구로 컨텍스트를 낭비하지 않고, 질문 난이도에 따라 도구 호출 횟수·답변 길이를 조절하는 규칙이 있는가?

---

## 참고 출처
- mock-interview · GitHub Topics
- Prashant1659/interview-ai — GitHub
- Behavioral Interview Questions — ai-engineering-field-guide (GitHub)
- Prompt Engineering Best Practices for AI Agents (2026)
- Best practices for LLM prompt engineering — Palantir
- How we built our multi-agent research system — Anthropic
- Prompt engineering best practices for 2026 — Claude by Anthropic
