// 운영 메뉴([길드원]·[데이터])를 보여줄지 정한다.
//
// ★ 예전엔 여기 '관리자 비밀번호' 로그인이 따로 있었다. 없앴다.
//   비번을 두 번 받을 이유가 없다 — 누가 관리자인지는 워커가 길드원 로그인 때
//   이미 판정해서 내려준다(session 의 isSiteAdmin). 게다가 그 두 번째 비번이
//   워커 시크릿과 어긋나면 자기 사이트에서 잠겼다.
//
//   정적 사이트라 이 판정은 '화면을 어떻게 그릴까'용일 뿐이다. 실제 차단은
//   워커가 요청마다 한다(worker.js 의 guard / handleAuth 관문).
import { clearAdminPw, isSiteAdmin } from './session'

/** 운영진 전용 화면 */
export const ADMIN_ROUTES = ['members', 'settings']

/**
 * 운영 메뉴를 열어 줄 사람인가.
 *
 * ★ 예전엔 앞에 `!isLoggedIn() ||` 가 붙어 있었다. 아이디를 다 나눠주기 전까지
 *   [길드원] 화면에 들어갈 수 있게 열어 둔 장치였는데, App 이 fail-closed 가
 *   된 뒤로는 토큰이 없으면 로그인 화면만 그려서 열어 줄 대상이 화면 자체를
 *   못 본다. 남겨두면 '안 들어온 사람'이 곧 '관리자'가 되는 뒤집힌 판정만
 *   남는다 — session 의 isStaff 가 같은 이유로 먼저 걷어냈다.
 */
export const isAdmin = (): boolean => isSiteAdmin()

/** 남은 뒷정리 — 메모리에 든 워커 비번을 턴다 */
export function logout(): void {
  clearAdminPw()
}
