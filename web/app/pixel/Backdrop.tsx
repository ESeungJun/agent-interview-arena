import { memo } from 'react';
import { pixel, px } from './cast';

const ALL = ['code', 'docs', 'data', 'security', 'planner', 'general'].flatMap(j => [`${j}-calm`, `${j}-lively`]);
/** 대기실 바닥에 서 있는 자리 (가로 %, 아래에서 %, 크기 vh) — 가운데 콘텐츠 뒤로 가려지는 자리는 피한다 */
const SPOTS = [
  { left: 3, bottom: 8, size: 26 },
  { left: 12, bottom: 14, size: 20 },
  { left: 80, bottom: 10, size: 24 },
  { left: 89, bottom: 16, size: 19 },
  { left: 94, bottom: 4, size: 28 },
];

/** 지원서 아이디로 고정된 의사 난수: 같은 화면을 다시 열어도 같은 에이전트들이 같은 자리에 있다 */
function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296);
}

/**
 * 면접 화면 뒤 대기실: 흐리고 어두운 대기실 그림 위에, 차례를 기다리는 다른 에이전트들이 초점 밖처럼 서 있다.
 * 화면을 꽉 채우되 가운데 콘텐츠보다 눈에 띄지 않게 한다. 흐림·어둡게는 이미지에 미리 입혀 두었다(CSS filter 는 매 프레임 다시 그려 느리다).
 */
/** 진행 상황을 3초마다 다시 읽어도 배경은 다시 그리지 않는다 */
export default memo(function Backdrop({ seed, exclude }: { seed: string; exclude?: string }) {
  const rand = seeded(seed);
  // 피셔-예이츠 셔플: 같은 시드면 서버와 브라우저가 같은 순서를 만든다 (sort 에 난수 비교를 넘기면 엔진마다 결과가 달라 하이드레이션이 어긋난다)
  const pool = ALL.filter(a => a !== exclude);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return (
    <div className="backdrop" aria-hidden>
      <div className="backdrop-room" style={{ backgroundImage: `url(${pixel('scenes/lobby-blur')})` }} />
      {SPOTS.map((s, i) => (
        <img
          key={i}
          className="backdrop-agent"
          {...px(`agents-blur/${pool[i]}`)}
          alt=""
          style={{ left: `${s.left}%`, bottom: `${s.bottom}%`, height: `${s.size}vh` }}
        />
      ))}
    </div>
  );
});
