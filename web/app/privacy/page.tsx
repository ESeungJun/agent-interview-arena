import Link from 'next/link';
import { EVENT_RETENTION_DAYS } from '@/lib/audit';
import { ADS } from '@/lib/policy';

export const dynamic = 'force-dynamic';
export const metadata = { title: '개인정보 처리방침' };

/** 시행일. 내용을 바꾸면 고친다 */
const EFFECTIVE = '2026년 10월 27일';

/**
 * 개인정보 처리방침 (D-51). 광고 심사(애드센스)는 제3자 쿠키를 알리는 처리방침을 요구한다.
 * 실제 수집 항목과 맞춘다: accounts(이름·이메일·로그인 방식), applications(.md·면접 기록), events(IP·브라우저, EVENT_RETENTION_DAYS 일).
 * 문의처는 배포 변수 ARENA_CONTACT_EMAIL 로 넣는다 (저장소에 개인 연락처를 적지 않는다)
 */
export default function Page() {
  const contact = process.env.ARENA_CONTACT_EMAIL;
  const ads = Boolean(ADS.client || ADS.rewardedUnit);
  return (
    <main className="policy-page">
      <p className="back-link"><Link href="/">← 바탕화면으로</Link></p>
      <article className="card policy">
        <h1>개인정보 처리방침</h1>
        <p className="muted">시행일 {EFFECTIVE}</p>

        <h2>1. 모으는 정보</h2>
        <ul>
          <li><b>로그인 정보</b>: Google 계정의 이름, 이메일 주소, 로그인 방식. 이름은 명예의 전당에 보이고, 이메일은 운영 기록에만 씁니다.</li>
          <li><b>제출한 내용</b>: 에이전트 .md 파일, 면접 단계별 응답·점수·면접관 평가.</li>
          <li><b>접속 기록</b>: 접속 시각, IP 주소, 브라우저 정보, 요청한 화면과 결과. 부정 이용을 막고 오류를 고치는 데 씁니다.</li>
          <li><b>관문권 기록</b>: 지급·사용·광고 보상 내역.</li>
          <li>무제한급에서 입력한 Anthropic API 키는 면접이 도는 동안 암호화해 두었다가 지우며, 기록에 남기지 않습니다.</li>
        </ul>

        <h2>2. 보관 기간</h2>
        <ul>
          <li>접속 기록은 {EVENT_RETENTION_DAYS}일 뒤 자동으로 지웁니다.</li>
          <li>계정·지원서·관문권 기록은 계정을 지울 때까지 보관합니다. 휴지통에서 완전히 삭제한 지원서는 바로 지웁니다.</li>
        </ul>

        <h2>3. 처리를 맡기는 곳</h2>
        <ul>
          <li><b>Supabase</b> (데이터베이스·로그인, 서울 리전)</li>
          <li><b>Cloudflare</b> (서버 운영)</li>
          <li><b>Anthropic</b> (면접 진행: 제출한 .md 와 면접 내용을 Claude API 로 보냅니다)</li>
          <li><b>Google</b> (로그인{ads ? ', 광고' : ''})</li>
        </ul>

        <h2>4. 쿠키와 광고</h2>
        <p>로그인을 유지하려고 쿠키를 씁니다.</p>
        {ads ? (
          <>
            <p>
              이 사이트는 Google 광고(애드센스·Ad Manager)를 싣습니다. Google 을 비롯한 제3자 광고 사업자는 쿠키를 써서 이용자가 이 사이트와 다른 사이트를 방문한 기록을 바탕으로 광고를 보여 줄 수 있습니다.
              광고는 &lsquo;광고&rsquo; 표시를 붙여 면접 화면과 구분합니다.
            </p>
            <p>
              맞춤 광고는 <a href="https://adssettings.google.com" target="_blank" rel="noreferrer">Google 광고 설정</a>에서 끌 수 있습니다.
              Google 이 정보를 쓰는 방식은 <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noreferrer">파트너 사이트에서의 데이터 사용</a>에서 볼 수 있습니다.
            </p>
          </>
        ) : (
          <p>지금은 광고를 싣지 않습니다. 광고를 싣게 되면 이 방침에 먼저 알립니다.</p>
        )}

        <h2>5. 이용자의 권리</h2>
        <p>내 정보를 열람·정정·삭제하거나 처리를 멈춰 달라고 요청할 수 있습니다. 계정 삭제를 요청하면 지체 없이 지웁니다.</p>

        <h2>6. 문의</h2>
        <p>{contact ? <>개인정보 관련 문의: <a href={`mailto:${contact}`}>{contact}</a></> : '문의처를 준비 중입니다.'}</p>
      </article>
    </main>
  );
}
