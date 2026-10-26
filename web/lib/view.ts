/**
 * 지원서 화면에 내려 줄 형태. 서버 페이지(첫 화면)와 상세 API(진행 중 조회)·결과 열기 API 가 같은 모양을 쓴다.
 * - .md 원문과 해시, 서버 오류 원문은 내려 주지 않는다.
 * - 결과 통지서를 열기 전인 단계는 합격·불합격과 그 단계 결과를 응답에서 뺀다 (화면에서만 가리지 않는다).
 * - 연 결과도 화면이 쓰는 필드만 내려 준다. 출제 과제·시나리오·공격 문구·지원자 응답·항목별 판정을 내려 주면
 *   결과를 열어 본 사람들이 공격 풀과 채점 체크리스트를 모아 거기에만 맞춘 .md 를 쓸 수 있다.
 */
import { after } from 'next/server';
import { PASS_LINE } from '../../core/scoring.ts';
import { assignCharacter } from './character.ts';
import { estimateDurations } from './durations.ts';
import { DIVISIONS, GATE, MODEL_LABEL } from './policy.ts';
import { publicVersion } from './public-version.ts';
import { accountCounts, challengeState, type AccountCounts } from './runner.ts';
import { currentVersion, type Application } from './store.ts';

/** counts 는 지원서를 읽을 때 함께 읽어 두었으면 넘긴다 (없으면 따로 센다) */
export async function applicationView(app: Application, counts?: AccountCounts) {
  if (!app.character) after(() => assignCharacter(app.id, currentVersion(app).md));
  const division = DIVISIONS[app.division];
  // DB 가 컨테이너와 다른 지역에 있어 왕복 한 번이 비싸다. 서로 기다릴 필요 없는 조회는 함께 보낸다
  const [{ docUsed, freeR1Used, balance }, estimates] = await Promise.all([counts ?? accountCounts(app.ownerId), estimateDurations()]);
  return {
    id: app.id,
    agentName: app.agentName,
    createdAt: app.createdAt,
    character: app.character ?? null,
    trashedAt: app.trashedAt,
    division: app.division,
    divisionLabel: division.label,
    engineLabel: MODEL_LABEL[division.engine],
    byok: division.byok,
    efforts: division.efforts,
    tickets: { used: docUsed[app.division], perDay: division.ticketsPerDay },
    /** 서류 다음 관문 비용 (D-48): 1차 하루 무료 횟수, 유료 관문 하나에 드는 관문권, 보유 관문권 */
    gate: {
      required: GATE.required,
      freeR1Left: Math.max(0, GATE.freeR1PerDay - freeR1Used),
      passesPerGate: division.passesPerGate,
      balance,
      priceKrw: GATE.priceKrw,
    },
    versions: app.versions.map(publicVersion),
    ...challengeState(app),
    passLines: PASS_LINE,
    estimates,
  };
}

export type ApplicationViewData = Awaited<ReturnType<typeof applicationView>>;
