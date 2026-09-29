// 길드원 로그인.
//
// ★ 여기 있는 검사는 전부 '화면을 어디로 보낼까'를 정하는 용도다.
//   사이트는 정적 파일이라 코드가 통째로 공개된다. 누가 길드원인지는 워커만 판정한다.
//   (worker.js 의 guard() — 요청마다 명단을 다시 봐서, 나가면 그 즉시 끊긴다)
//
// 운영진 비밀번호는 예전엔 사이트 코드 안의 해시와 맞춰봤는데, 그건 감추기일 뿐이라
// 이제 워커 시크릿(ADMIN_PW)과 맞춘다. 사이트는 입력값을 들고 있다가 헤더로 보낼 뿐이다.
import { WORKER_URL } from './data/config'

const TOKEN_KEY = 'sena-guild-war:token'
const NAME_KEY = 'sena-guild-war:me'
const STAFF_KEY = 'sena-guild-war:staff'
const SADMIN_KEY = 'sena-guild-war:siteadmin'

/**
 * 운영진 비밀번호는 이 탭이 살아 있는 동안만 기억한다.
 *
 * 예전엔 localStorage 에 평문으로 넣어 두고 지우지도 않았다. 이건 워커의 최고권한
 * 비번이라, 공용 PC 나 XSS 한 방이면 그대로 넘어간다. 사이트 관리자로 로그인해
 * 있으면 토큰만으로 통하므로 대개는 칠 일도 없다 — adminHeaders() 참고.
 */
let adminPw = ''

const base = () => WORKER_URL.replace(/\/+$/, '')
const localDev = () => typeof window !== 'undefined'
  && ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)

const read = (k: string): string => {
  try { return localStorage.getItem(k) ?? '' } catch { return '' }
}
const write = (k: string, v: string) => {
  try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k) } catch { /* noop */ }
}

export const getToken = () => read(TOKEN_KEY)
export const getMe = () => read(NAME_KEY)
export const getAdminPw = () => adminPw
export const isLoggedIn = () => !base() || !!getToken()

/**
 * 운영진(길드마스터·부길드마스터)인가.
 *
 * ★ 화면을 어떻게 그릴지 정하는 데만 쓴다. 여기 값을 손대도 실제로는 아무것도
 *   못 한다 — 워커가 요청마다 명단의 역할을 다시 보고 판정하기 때문이다.
 *
 * 예전엔 로그인 전이면 전부 열어뒀다(`!isLoggedIn() ||`). 아이디를 다 나눠주기
 * 전까지 쓰라고 둔 장치인데, 게이트가 열린 순간에는 '안 들어온 사람'이 곧
 * '운영진'이 되는 뒤집힌 판정이 된다. 모르면 닫는 쪽으로 바꾼다.
 */
export const isStaff = () => (!base() ? localDev() : read(STAFF_KEY) === '1')

/**
 * 사이트 관리자인가 — 게임 안 직책과 별개로 지정한다.
 * 길드마스터가 바뀌어도 사이트를 관리하던 사람은 그대로 남는다.
 */
export const isSiteAdmin = () => (!base() ? localDev() : read(SADMIN_KEY) === '1')

// 권한이 바뀌면 화면을 다시 그려야 한다 (메뉴가 늘거나 준다)
type RoleListener = () => void
const roleListeners = new Set<RoleListener>()
export function onRoleChange(fn: RoleListener): () => void {
  roleListeners.add(fn)
  return () => { roleListeners.delete(fn) }
}

/**
 * 워커가 응답 헤더에 적어 보낸 '지금 이 사람의 권한'을 받아 적는다.
 *
 * 예전엔 로그인할 때 받은 값을 그대로 두고 끝이라, 누굴 관리자로 올려도
 * 그 사람이 다시 로그인하기 전까지 메뉴가 안 나타났다. 워커는 이미 관리자로
 * 대우하는데 화면만 모르는 상태였다. 이제 데이터를 받을 때마다 맞춘다.
 */
export function applyRole(r: Response): boolean {
  const staff = r.headers.get('x-role-staff')
  const admin = r.headers.get('x-role-admin')
  if (staff === null && admin === null) return false   // 헤더가 없으면(옛 워커) 그냥 둔다
  const nextStaff = staff === '1' ? '1' : ''
  const nextAdmin = admin === '1' ? '1' : ''
  if (read(STAFF_KEY) === nextStaff && read(SADMIN_KEY) === nextAdmin) return false
  write(STAFF_KEY, nextStaff)
  write(SADMIN_KEY, nextAdmin)
  for (const fn of roleListeners) fn()
  // ★ 바뀌었다고 알려준다. 권한이 바뀌면 같은 rev 라도 워커가 내려주는 칸이 달라져서
  //   (운영진 전용 필드가 붙거나 빠진다) store 가 데이터를 반드시 새로 받아야 한다.
  return true
}

/** 워커에 보낼 인증 헤더. 토큰이 없으면 빈 객체 — 검사를 안 켠 동안은 그래도 통한다 */
export function authHeaders(): Record<string, string> {
  const t = getToken()
  return t ? { authorization: `Bearer ${t}` } : {}
}
/**
 * 운영진 비번은 base64로 싸서 보낸다.
 *
 * HTTP 헤더에는 Latin-1 글자만 담을 수 있어서, 비번에 한글이 한 자라도 있으면
 * fetch가 요청을 만들다 그대로 터진다("String contains non ISO-8859-1 code point").
 * 서버에 닿지도 못하고 브라우저에는 'Failed to fetch' 로만 보여서 원인을 찾기 어렵다.
 */
export function adminHeaders(): Record<string, string> {
  const p = getAdminPw()
  // 비번을 안 넣어뒀으면 로그인 토큰으로 간다 — 사이트 관리자면 그것만으로 통한다.
  if (!p) return authHeaders()
  const bytes = new TextEncoder().encode(p)
  return { 'x-admin-pw': btoa(String.fromCharCode(...bytes)) }
}

// 워커가 로그인을 요구하면(401/403) 화면을 로그인으로 돌리기 위한 알림
type Listener = (reason: 'login' | 'gone') => void
const listeners = new Set<Listener>()
export function onAuthLost(fn: Listener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
/**
 * store 의 pull/push 가 401·403 을 만나면 부른다.
 * keepToken — 임시 비번 상태(mustchange)처럼 '로그인 화면으로 가되 토큰은 살려 둘' 때.
 * 그 토큰이 있어야 새 비번 화면에서 비번을 바꿀 수 있다.
 */
export function authLost(reason: 'login' | 'gone', opts: { keepToken?: boolean } = {}) {
  if (!opts.keepToken) clearSession()
  for (const fn of listeners) fn(reason)
}

export function clearSession() {
  write(TOKEN_KEY, '')
  write(NAME_KEY, '')
  write(STAFF_KEY, '')
  write(SADMIN_KEY, '')
  adminPw = ''
  // 공유 데이터 사본도 같이 턴다. 안 그러면 서버가 일부러 빼고 보낸 운영진 전용
  // 칸(점수·커트라인·운영진 메모)이 브라우저에 남아 다음 사람 화면에 그대로 그려진다.
  write('sena-guild-war:v1', '')
  write('sena-guild-war:v2', '')
  write('sena-guild-war:rev', '')
  write('sena-guild-war:view', '')   // 사본의 출처 표시 (store.ts 의 VIEW_KEY)
}

/**
 * 모든 기기에서 로그아웃 — 이 계정으로 나간 토큰을 워커에서 전부 끊는다.
 * 로그아웃 버튼은 이 브라우저만 지워서, 잃어버린 폰이나 공용 PC 의 토큰은 30일 동안
 * 그대로 살아 있었다. 서버 호출이 실패해도 이 브라우저는 지운다.
 */
export async function logoutAll(): Promise<void> {
  try {
    await post('/auth/logout-all', {}, authHeaders())
  } finally {
    clearSession()
  }
}

async function post(path: string, body: unknown, extra: Record<string, string> = {}) {
  const r = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extra },
    body: JSON.stringify(body ?? {}),
  })
  return unwrap(r)
}

/**
 * 서버가 준 사유를 그대로 보여준다. 워커가 터지면(500) 본문이 JSON이 아니라
 * 사유가 없는데, 그때 '실패했어요'만 뜨면 원인을 못 찾는다 — 상태 코드라도 붙인다.
 */
async function unwrap(r: Response) {
  const j = await r.json().catch(() => null) as { error?: string } | null
  if (r.ok) return j ?? {}
  if (j?.error) throw new Error(j.error)
  throw new Error(
    r.status >= 500 ? `서버 오류 (${r.status}) — 워커 로그를 봐야 해요.`
      : `요청이 막혔어요 (${r.status}).`)
}

export async function login(name: string, pw: string): Promise<{ mustChange: boolean }> {
  const j = await post('/auth/login', { name: name.trim(), pw }) as
    { token: string; name: string; mustChange?: boolean; staff?: boolean; admin?: boolean }
  write(TOKEN_KEY, j.token)
  write(NAME_KEY, j.name)
  write(STAFF_KEY, j.staff ? '1' : '')
  write(SADMIN_KEY, j.admin ? '1' : '')
  return { mustChange: !!j.mustChange }
}

export async function changePassword(pw: string, next: string) {
  // 비번을 바꾸면 그 전에 나간 토큰이 워커에서 전부 죽는다 — 지금 들고 있는 것도
  // 포함이라, 새로 받은 토큰으로 갈아끼우지 않으면 바로 튕긴다.
  const j = await post('/auth/password', { pw, next }, authHeaders()) as { token?: string }
  if (j.token) write(TOKEN_KEY, j.token)
}

// ---- 운영진 ----

export function setAdminPw(pw: string) { adminPw = pw }
export function clearAdminPw() { adminPw = '' }

export type IdRow = {
  /** 길드원 고유 id — 닉이 바뀌어도 안 변한다. 발급·해제는 전부 이걸로 한다 */
  id: string
  name: string; excluded: boolean; role: string
  admin: boolean; staff: boolean
  /** 영구 최고권한 — 화면에서 해제할 수 없다 */
  owner: boolean
  hasId: boolean; tmp: boolean; at: number | null
  /** 마지막 로그인 시각 — 계정이 도용됐는지 볼 수 있게 */
  lastAt: number | null
}
/** 관리자 행동 기록 한 줄 (재발급·해제·관리자 지정·검사 켜고 끄기·강제 로그아웃) */
export type AuditRow = { at: number; by: string; action: string; target?: string }
export type IdList = {
  on: boolean
  /** 꺼져 있으면 저절로 다시 켜지는 시각 */
  offUntil: number | null
  owner: string | null; admins: string[]; members: IdRow[]; orphans: string[]
  /** 명단에 없는 관리자 id — 힘은 없지만 목록에 남아 있는 것 */
  ghostAdmins: string[]
  audit: AuditRow[]
  /** 이름이 겹친 길드원 — 로그인이 이름으로 사람을 찾아서 이 사람들은 못 들어온다 */
  dupNames: string[]
}

export async function listIds(): Promise<IdList> {
  const r = await fetch(`${base()}/auth/list`, { method: 'POST', headers: adminHeaders() })
  const j = await unwrap(r) as Partial<IdList>
  // 옛 워커는 새 칸을 안 준다 — 화면이 undefined 를 만지지 않게 채운다
  return {
    on: !!j.on, offUntil: j.offUntil ?? null, owner: j.owner ?? null,
    admins: j.admins ?? [], orphans: j.orphans ?? [], ghostAdmins: j.ghostAdmins ?? [],
    audit: j.audit ?? [], dupNames: j.dupNames ?? [],
    members: (j.members ?? []).map((m) => ({ ...m, lastAt: m.lastAt ?? null })),
  }
}

/**
 * 사이트 관리자를 올리고 내린다 — **바뀐 것만** 보낸다.
 * 예전엔 목록을 통째로 보내서, 페이지를 연 뒤 다른 관리자가 한 변경이 오래된 사본으로
 * 조용히 되돌아갔다.
 */
export async function changeSiteAdmins(change: { add?: string[]; remove?: string[] }) {
  await post('/auth/admins', { add: change.add ?? [], remove: change.remove ?? [] }, adminHeaders())
}

/** 강제 로그아웃 — 그 사람의 모든 토큰을 끊는다. 비번은 그대로 */
export async function kickMember(id: string) {
  await post('/auth/kick', { id }, adminHeaders())
}

/** 아이디 발급 — 임시 비밀번호는 이때 한 번만 돌려받는다. 다시 볼 수 없다 */
export async function issueId(id: string): Promise<string> {
  const j = await post('/auth/issue', { id }, adminHeaders()) as { pw: string }
  return j.pw
}

export async function revokeIds(ids: string[]) {
  await post('/auth/revoke', { ids }, adminHeaders())
}

/**
 * 로그인 검사를 켜고 끈다. 켜면 그 순간부터 아이디 없는 사람은 사이트를 못 연다.
 * 끄기는 영구 관리자·워커 시크릿만 되고, 24시간 뒤 저절로 다시 켜진다(워커가 판정).
 */
export async function setGate(on: boolean) {
  await post('/auth/enable', { on }, adminHeaders())
}
