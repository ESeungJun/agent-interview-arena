import path from 'node:path';

// 면접 엔진(core/)은 저장소 루트에 있다. 복사하지 않고 바로 가져오므로 빌드 루트를 저장소 루트로 잡는다
const root = path.resolve(import.meta.dirname, '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: root,
  turbopack: { root },
  // PGlite(로컬 개발 DB)는 WASM 파일을 런타임에 읽어 번들에 넣지 않는다
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  // 다른 사이트가 이 화면을 프레임에 넣어 버튼을 누르게 하는 공격(클릭재킹)을 막고, 기본 보안 헤더를 붙인다
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
