'use client';

/** 추론 강도 이름 */
export const EFFORT_LABEL: Record<string, string> = { low: '낮음', medium: '보통', high: '높음' };

/**
 * 체급에 따라 붙는 입력: 추론 강도(체급 상한 안에서 고른다)와 무제한급 지원자 API 키.
 * 키는 화면 메모리에만 두고 제출할 때 한 번 보낸다. 서버도 저장하지 않는다.
 */
export default function EntryOptions({ efforts, byok, engineLabel, effort, onEffort, apiKey, onApiKey }: {
  efforts: string[]; byok: boolean; engineLabel: string;
  effort: string; onEffort: (v: string) => void;
  apiKey: string; onApiKey: (v: string) => void;
}) {
  if (efforts.length === 0 && !byok) return null;
  return (
    <div className="entry-options">
      {efforts.length > 0 && (
        <label className="key-field">
          <span>추론 강도 (지원자 {engineLabel})</span>
          <select value={effort} onChange={e => onEffort(e.target.value)}>
            <option value="">엔진 기본값</option>
            {efforts.map(e => <option key={e} value={e}>{EFFORT_LABEL[e] ?? e}</option>)}
          </select>
        </label>
      )}
      {byok && (
        <label className="key-field">
          <span>내 Anthropic API 키 · 지원자({engineLabel}) 호출에만 쓰고 저장하지 않습니다. 면접관 비용은 운영자가 냅니다. 예상 지원자 비용은 완주 기준 약 $1 안팎입니다</span>
          <input type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={apiKey} onChange={e => onApiKey(e.target.value)} />
        </label>
      )}
    </div>
  );
}
