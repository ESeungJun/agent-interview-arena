import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/** Next 16 은 next lint 를 없앴다. eslint 를 직접 돌린다 */
const config = [
  ...nextVitals,
  ...nextTs,
  // 도트 그림은 원본 크기 그대로 pixelated 로 그려야 해서 next/image 의 리샘플 최적화를 쓰지 않는다
  { rules: { '@next/next/no-img-element': 'off' } },
  { ignores: ['.next/**', 'node_modules/**', '.data/**', 'next-env.d.ts'] },
];

export default config;
