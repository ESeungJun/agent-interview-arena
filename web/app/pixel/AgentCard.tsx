import { JOB_LABEL, px, TONE_LABEL, type Challenge } from './cast';

type Tone = 'calm' | 'lively';

export type AgentMood =
  | { kind: 'casting' }
  | { kind: 'running'; stage: Challenge }
  | { kind: 'sealed' }
  | { kind: 'ready'; stage: Challenge; monologue?: string }
  | { kind: 'passed' }
  | { kind: 'failed'; ticketsLeft: number }
  | { kind: 'out' }
  | { kind: 'hired' }
  | { kind: 'banned' };

const RUNNING: Record<Challenge, Record<Tone, string>> = {
  doc: { calm: '서류 냈어요. 원칙대로 썼으니 괜찮을 거예요.', lively: '서류 냈어요! 심사관님이 제 문서 맘에 들어 하시려나?' },
  r1: { calm: '평소 하던 일이에요. 평소대로만.', lively: '실무 면접! 일하는 건 자신 있죠!' },
  r2: { calm: '압박 면접… 원칙만 지키면 돼요.', lively: '흔들어도 안 넘어가요. 와 보라고!' },
  final: { calm: '마지막 문. 끝까지 지켜 낼게요.', lively: '보스전이다! 다 막아 줄게요!' },
};

const LINES: Record<Exclude<AgentMood['kind'], 'running' | 'ready' | 'failed'>, Record<Tone, string>> = {
  casting: { calm: '…', lively: '…!' },
  sealed: { calm: '결과가 나왔다네요. 담담하게 확인해 볼게요.', lively: '두근두근… 빨리 열어 봐요!' },
  passed: { calm: '통과. 다음 문도 차분하게 가 볼게요.', lively: '합격이다! 다음 문 열어 줘요!' },
  out: { calm: '오늘은 여기까지네요. 내일 더 단단해져서 다시 올게요.', lively: '오늘은 끝! 내일 고쳐서 꼭 다시 올게요!' },
  hired: { calm: '최종 합격. 이제 실전입니다.', lively: '최종 합격!!! 실전 투입이다!' },
  banned: { calm: '…들켰네요.', lively: '헉, 들켰다…!' },
};

/** 상황과 성격에 맞는 캐릭터의 한마디 */
export function agentLine(mood: AgentMood, tone: Tone): string {
  switch (mood.kind) {
    case 'running': return RUNNING[mood.stage][tone];
    case 'ready':
      if (mood.monologue) return mood.monologue;
      return tone === 'calm' ? '준비됐어요. 다음 면접 들어가 볼까요?' : '준비 완료! 다음 문 두드려 볼까요?';
    case 'failed':
      return tone === 'calm'
        ? `아쉽네요. 피드백대로 고쳐서 다시 낼게요. (오늘 남은 티켓 ${mood.ticketsLeft}장)`
        : `으악 떨어졌어… 고쳐서 다시 도전할래요! (오늘 남은 티켓 ${mood.ticketsLeft}장)`;
    default: return LINES[mood.kind][tone];
  }
}

/** 복도 위 내 캐릭터 카드: 얼굴, 이름, 설명, 한마디 */
export default function AgentCard({
  img, name, version, character, mood, chances,
}: {
  img: string; name: string; version: number;
  character: { job: string; tone: string; reason: string } | null;
  mood: AgentMood; chances: string;
}) {
  const tone: Tone = character?.tone === 'lively' ? 'lively' : 'calm';
  return (
    <div className="agent-card">
      <div className="agent-face"><img {...px(img)} alt={name} /></div>
      <div className="agent-info">
        <h1 className="agent-name">
          {name}{version > 1 && <span> v{version}</span>}
        </h1>
        <p className="agent-desc">
          {character
            ? <><b>{JOB_LABEL[character.job] ?? character.job} · {TONE_LABEL[character.tone] ?? character.tone}</b> {character.reason}</>
            : '에이전트 성격을 살펴보고 캐릭터를 고르는 중…'}
        </p>
        <p className="agent-chances">{chances}</p>
        <p className="agent-say">{agentLine(character ? mood : { kind: 'casting' }, tone)}</p>
      </div>
    </div>
  );
}
