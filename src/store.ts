// 데이터 계층: 번들된 초기 데이터(JSON) + 사용자/공유 데이터 오버레이.
// 공유 모드: 워커(KV)가 연결되면 길드 공유 데이터를 받아오고, 관리자 편집은 워커로 자동 업로드.
// 로컬 모드: 워커 미연결 시 각자 브라우저(localStorage)에만 저장(기존 동작).

import { useSyncExternalStore } from 'react'
import type { ArenaEntry, CounterDeck, CounterEntry, CounterHeroSlot, Hero, Member, UserData } from './types'
import initialHeroes from './data/heroes.json'
import initialCounters from './data/counters.json'
import initialArena from './data/arena.json'
import { WORKER_URL } from './data/config'
import { applyRole, authHeaders, authLost, isStaff } from './session'

// 운영 공유 저장소에서 받은 예전 사본과 격리한 새 로컬 저장 공간.
const LS_KEY = 'sena-guild-war:v2'
const REV_KEY = 'sena-guild-war:rev'

const EMPTY: UserData = {
  customHeroes: [],
  counters: [],
  hiddenCounterIds: [],
  savedDecks: [],
  members: [],
  customGuides: [],
  arenaEntries: [],
  hiddenArenaIds: [],
  siegeRounds: [],
  destroyerRounds: [],
  defenseSetups: [],
  attackTargets: [],
  siegeGuides: [],
}

const ARRAY_FIELDS = Object.keys(EMPTY) as (keyof UserData)[]

/** 길드 이름 기본값 — 설정 전이거나 비워두면 이 이름으로 나온다 */
export const DEFAULT_GUILD_NAME = '붕붕단'
/** 길드 이름 최대 길이 — 로고 한 줄에 들어가는 선 */
const GUILD_NAME_MAX = 16

/** 외부에서 온 데이터(공유 pull·localStorage·가져오기)를 안전한 형태로 정규화.
 *  배열이어야 할 필드가 다른 타입이면 버림 — 오염된 공유 데이터 하나로
 *  전 길드원 화면이 깨지는 것 방지. (워커도 같은 검증을 하지만 이중 방어) */
function normalize(raw: unknown): UserData {
  const base = structuredClone(EMPTY)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const src = raw as Record<string, unknown>
  // 문자열 id 만 담는 칸과, 객체를 담는 칸을 따로 거른다.
  // 배열인지만 보고 통과시켰더니 counters:[null] 한 줄에 홈·카운터덱이 통째로
  // 죽었다(getAllCounters 의 c.id 에서 TypeError). 워커도 같은 검증을 하지만,
  // 이미 저장된 오염 데이터는 여기서 걸러야 화면이 산다.
  const ID_FIELDS = new Set(['hiddenCounterIds', 'hiddenArenaIds'])
  // 배열로 쓰는 중첩 키가 배열이 아니면 그 원소를 통째로 버린다.
  // 워커도 같은 검사를 하지만(badNestedKey), 이미 KV 에 들어가 있는 오염 데이터는
  // 여기서 걸러야 화면이 산다 — `counters: [{ counters: null }]` 하나면 홈·카운터덱이
  // 전원에게서 TypeError 로 죽었고, '로컬 비우고 새로고침'을 눌러도 같은 KV 를
  // 다시 받아 와서 안 나았다.
  const NESTED_ARRAY_KEYS = new Set([
    'counters', 'defense', 'heroes', 'decks', 'entries', 'skills', 'records',
    'attune', 'ringsMin', 'ringsWant',
    // 길드전 공격·방어·공성전 공략이 .length / .map / .some 으로 바로 쓰는 키 (워커와 같은 목록)
    'enemy', 'reserve', 'timeline', 'tips',
  ])
  /**
   * 칸마다 '있어야 하는' 배열 키 — 없으면 [] 로 채운다(워커의 REQUIRED_ARRAYS 와 같다).
   *
   * ★ '있으면 배열이어야 한다' 만 보면 키를 아예 뺀 항목이 통과한다. `counters: [{ id: 'x' }]`
   *   하나에 홈·카운터덱이 `c.counters[0]`·`entry.counters.reduce` 에서 전원 TypeError 로
   *   죽었다. 워커가 이제 막지만, 이미 KV 에 들어간 것은 여기서 고쳐야 화면이 산다.
   *   버리지 않고 채운다 — 누군가 써 둔 항목을 통째로 사라지게 하지 않으려고.
   */
  const REQUIRED: Partial<Record<string, { self: string[]; nested?: Record<string, string[]> }>> = {
    counters: { self: ['defense', 'counters'], nested: { counters: ['heroes'] } },
    savedDecks: { self: ['heroes'] },
    defenseSetups: { self: ['heroes'] },
    attackTargets: { self: ['enemy', 'decks'], nested: { decks: ['heroes'] } },
    siegeGuides: { self: ['heroes'] },
  }
  const repair = (field: string, o: Record<string, unknown>) => {
    const spec = REQUIRED[field]
    const fill = (x: unknown, keys: string[]) => {
      if (!x || typeof x !== 'object' || Array.isArray(x)) return
      const r = x as Record<string, unknown>
      for (const k of keys) if (r[k] === undefined) r[k] = []
      // updatedAt 은 화면이 .localeCompare 로 정렬한다 — 숫자 하나면 홈·카운터덱이 죽는다
      if (r.updatedAt !== undefined && typeof r.updatedAt !== 'string') delete r.updatedAt
    }
    if (spec) {
      fill(o, spec.self)
      for (const [k, keys] of Object.entries(spec.nested ?? {})) {
        const arr = o[k]
        if (Array.isArray(arr)) for (const y of arr) fill(y, keys)
      }
    } else if (o.updatedAt !== undefined && typeof o.updatedAt !== 'string') {
      delete o.updatedAt
    }
  }
  /**
   * 중첩 배열 안의 빈 원소(null·배열)를 뺀다. 워커도 이제 막지만, 이미 KV 에 들어간
   * `heroes: [null]` 하나면 홈이 슬롯마다 h.name 을 읽다가 전원 TypeError 로 죽는다.
   * 항목 전체를 버리지 않고 그 빈 원소만 뺀다.
   */
  const dropEmpty = (v: unknown, depth = 0): void => {
    if (depth > 8 || !v || typeof v !== 'object') return
    if (Array.isArray(v)) { for (const x of v) dropEmpty(x, depth + 1); return }
    const o = v as Record<string, unknown>
    for (const [k, x] of Object.entries(o)) {
      if (NESTED_ARRAY_KEYS.has(k) && Array.isArray(x)) {
        o[k] = x.filter((e) => e !== null && e !== undefined && !Array.isArray(e))
      }
      dropEmpty(o[k], depth + 1)
    }
  }
  const nestedOk = (v: unknown, depth = 0): boolean => {
    if (depth > 8 || !v || typeof v !== 'object') return true
    if (Array.isArray(v)) return v.every((x) => nestedOk(x, depth + 1))
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (NESTED_ARRAY_KEYS.has(k) && x !== undefined && !Array.isArray(x)) return false
      if (!nestedOk(x, depth + 1)) return false
    }
    return true
  }
  for (const k of ARRAY_FIELDS) {
    const v = src[k]
    if (!Array.isArray(v)) continue
    const clean = ID_FIELDS.has(k)
      ? v.filter((x) => typeof x === 'string')
      : v.filter((x) => !!x && typeof x === 'object' && !Array.isArray(x))
        // 빠진 필수 배열을 먼저 채우고, 그래도 모양이 틀린(있는데 배열이 아닌) 원소만 버린다
        .map((x) => { repair(k, x as Record<string, unknown>); dropEmpty(x); return x })
        .filter((x) => nestedOk(x))
    ;(base as unknown as Record<string, unknown>)[k] = clean
  }
  // 변경 기록 — 운영진에게만 내려온다. 화면에 보여 주기만 하므로 모양만 확인한다.
  if (Array.isArray(src._log)) {
    base._log = (src._log as unknown[])
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e))
      .filter((e) => typeof e.at === 'number' && typeof e.by === 'string')
      .map((e) => ({
        at: e.at as number,
        by: String(e.by).slice(0, 40),
        id: typeof e.id === 'string' ? e.id : null,
        fields: Array.isArray(e.fields) ? (e.fields as unknown[]).filter((f): f is string => typeof f === 'string').slice(0, 20) : [],
        removed: typeof e.removed === 'number' ? e.removed : 0,
        added: typeof e.added === 'number' ? e.added : 0,
        modified: typeof e.modified === 'number' ? e.modified : 0,
      }))
      .slice(-100)
  }
  // 커트라인 기준표(객체 필드) — 숫자 값만 살린다
  const cg = src.cutlineGuide as Record<string, unknown> | undefined
  if (cg && typeof cg === 'object' && !Array.isArray(cg)) {
    const nums = (o: unknown): Record<string, number> => {
      const out: Record<string, number> = {}
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
          if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v
        }
      }
      return out
    }
    base.cutlineGuide = {
      destroyerByTier: nums(cg.destroyerByTier),
      siegeByDay: nums(cg.siegeByDay),
      ...(typeof cg.memo === 'string' && cg.memo.trim() ? { memo: String(cg.memo).slice(0, 2000) } : {}),
    }
  }
  // 길드 이름(문자열 필드) — 배열이 아니라 위 루프를 안 타므로 여기서 따로 받는다
  // 빈 문자열도 살려둔다 — 필드를 아예 지우면 워커가 '안 보낸 칸' 으로 보고 직전 이름을
  // 그대로 둬서 '기본값으로 되돌리기'가 영영 안 먹는다.
  if (typeof src.guildName === 'string') {
    const guildName = src.guildName.trim().slice(0, GUILD_NAME_MAX)
    // 예전 기본값이 공유 저장소에 저장된 경우도 새 기본 이름으로 이월한다.
    base.guildName = guildName === '피해증폭' ? '' : guildName
  }
  // 운영진 메모(이름 → 글). 일반 길드원에게는 워커가 아예 안 내려보내므로 보통 비어 있다
  const sn = src.staffNotes
  if (sn && typeof sn === 'object' && !Array.isArray(sn)) {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(sn as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) out[k] = v.slice(0, 2000)
    }
    if (Object.keys(out).length) base.staffNotes = out
  }
  return base
}

/**
 * 지금 state 가 어떤 권한으로 받은 사본인가 — 'staff' / 'member' / ''(모름).
 *
 * ★ 사본과 **한 덩어리로** 저장한다(persistLocal). 따로 두면 탭 사이에서 어긋났다: 권한이 막
 *   올라간 뒤 옛 탭이 일반 길드원용 사본(점수 칸이 빈 것)을 저장소에 쓰고, 출처 표시는 다른
 *   탭이 쓴 'staff' 로 남아, 새 탭이 빈 점수 칸을 운영진 사본으로 믿었다. pull 은 이 값과
 *   응답의 권한 헤더가 다르면 rev 가 같아도 새로 받는다.
 */
let stateView: '' | 'staff' | 'member' = ''
/**
 * 아직 서버에 안 올라간 최상위 칸. 저장은 이 칸만 보낸다(워커가 합치기를 지원할 때).
 * 사본과 같이 저장해서, 탭을 닫았다 열어도 안 올라간 편집이 다음 저장에 실린다.
 */
const dirty = new Set<string>()

function load(): UserData {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return structuredClone(EMPTY)
    const parsed = JSON.parse(raw) as Record<string, unknown> | null
    const v = parsed?._view
    stateView = v === 'staff' || v === 'member' ? v : ''
    if (Array.isArray(parsed?._dirty)) {
      for (const k of parsed._dirty as unknown[]) if (typeof k === 'string') dirty.add(k)
    }
    return normalize(parsed)
  } catch {
    return structuredClone(EMPTY)
  }
}

/** 오늘 날짜 YYYY-MM-DD — 로컬 시간대 기준 (toISOString은 UTC라 오전 9시 전엔 하루 전으로 찍힘) */
export function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

let state: UserData = load()
const listeners = new Set<() => void>()

function persistLocal() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...state, _view: stateView, _dirty: [...dirty] }))
  } catch {
    /* noop */
  }
  listeners.forEach((l) => l())
}

// ---- 공유 저장소(워커 KV) 연동 ----

function readBase(): string {
  return WORKER_URL.replace(/\/+$/, '')
}

/**
 * ★ 로컬 개발 서버에서는 공유 저장소에 절대 쓰지 않는다.
 *
 * 개발 중 화면을 확인하려고 넣은 임시 데이터를 저장하면, 그게 그대로 길드 공유
 * 저장소로 올라가 전원의 실제 기록(공성전·파괴신)을 덮어쓴다. 실제로 한 번 났던
 * 사고라서 코드로 막아둔다. 읽기(pull)는 허용 — 실제 데이터로 화면을 보는 건 안전하다.
 *
 * localhost / 127.0.0.1 / *.local 에서 열렸으면 개발로 간주한다.
 */
function isLocalDev(): boolean {
  // 브라우저가 아니면(Node에서 번들을 불러 테스트하는 경우 등) 무조건 개발로 간주.
  // 실제로 이 판정이 false라서 Node 단위 테스트의 importJson이 실서버에
  // 빈 데이터를 push해 전 길드 데이터를 덮어쓴 사고가 있었다 (2026-08-14, 백업으로 복구).
  if (typeof window === 'undefined') return true
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')
}

/** 공유 저장소에 업로드해도 되는 상황인지 */
function canPush(): boolean {
  if (!readBase()) return false
  if (isLocalDev()) {
    console.warn('[store] 로컬 개발 서버라 공유 저장소 업로드를 건너뜁니다 (변경은 이 브라우저에만 저장).')
    return false
  }
  return true
}

/** 공유 저장소가 연결된 상태인지 (워커 URL 존재) */
export function sharedMode(): boolean {
  return !!readBase()
}

/**
 * 길드전 관련(카운터덱·공격·방어·공성전 공략)을 고칠 수 있는가.
 * 로그인한 길드원이면 누구나 된다.
 */
export function canEdit(): boolean {
  return true
}

/**
 * 운영진만 손대는 곳 — 영웅·결투장·가이드·명단·설정·점수 기록.
 *
 * ★ 화면에서 버튼을 감출 뿐이다. 진짜 판정은 워커가 한다. 여기를 우회해서
 *   저장을 눌러도 워커가 허용된 칸만 반영하고 나머지는 저장된 값을 그대로 둔다.
 */
export function canEditStaff(): boolean {
  return isStaff()
}

// 편집 버전(타임스탬프). KV는 최종 일관성이라 방금 저장한 것보다 오래된 데이터가
// 읽힐 수 있음 — 버전을 비교해 "내 최신 편집보다 오래된 pull"이 입력을 덮어쓰지 않게 함.
let rev = 0
try {
  rev = Number(localStorage.getItem(REV_KEY) || 0) || 0
} catch {
  /* noop */
}
// 과거에 조작된 미래 시각 rev가 저장돼 있으면 동기화가 영영 얼어붙음 — 해제
if (rev > Date.now() + 60 * 60 * 1000) rev = 0

function saveRev(v: number) {
  rev = v
  try {
    localStorage.setItem(REV_KEY, String(v))
  } catch {
    /* noop */
  }
}

/**
 * 워커가 '보낸 칸만 받아 합치기' 를 지원하는가 — 응답 헤더 x-save-merge 로 안다.
 *
 * ★ 확인하기 전에는 예전처럼 상태 전체를 보낸다. 옛 워커는 운영진 저장을 통째로 저장해서,
 *   바뀐 칸만 보내면 안 보낸 칸(카운터덱·영웅·가이드…)이 전부 지워진다. 프론트가 워커보다
 *   먼저 배포되거나 워커 배포가 늦어져도 데이터가 사라지지 않게 한다.
 */
let serverMerges = false
const noteMerge = (r: Response) => { serverMerges = r.headers.get('x-save-merge') === '1' }

/**
 * 워커가 거절했을 때 화면을 어디로 보낼지 정한다.
 *
 * 401 은 무조건 로그인. 403 은 사유를 봐야 한다 — 명단에서 빠졌으면(gone)
 * 로그인 화면으로 보내야 하지만, 그냥 권한이 모자란 것(운영진 전용)이라면
 * 로그아웃시키면 안 된다. 사유를 안 보고 끊으면 일반 길드원이 운영진 화면을
 * 한 번 스칠 때마다 튕겨나간다.
 */
async function noteAuth(r: Response) {
  if (r.status === 401) { authLost('login'); return }
  if (r.status !== 403) return
  const code = await r.clone().json().then((j) => (j as { code?: string }).code).catch(() => undefined)
  if (code === 'gone') authLost('gone')
  // ★ 임시 비번 상태(mustchange)면 로그인 화면으로 보내되 토큰은 지우지 않는다. 지우면
  //   새 비번 화면에 있는 동안 60초 pull 이 토큰을 날려서 비번 변경이 401 로 실패했다.
  else if (code === 'mustchange') authLost('login', { keepToken: true })
}

/**
 * 공유 데이터를 받는다.
 * force — rev 비교를 건너뛰고 서버 상태로 바꾼다. 저장이 거절됐을 때 쓴다: 거절된 편집
 *   (예: 대량 삭제)이 화면에만 남아 있으면, 그 뒤 모든 저장이 같은 이유로 계속 거절된다.
 * keep  — force 일 때 서버 사본 위에 다시 얹을 '아직 안 올라간 칸'. 거절 사유가 된 칸만 빼고
 *   나머지 편집(예: 같이 입력한 점수)은 살린다. force 가 아니면 안 올라간 칸을 전부 얹는다.
 */
async function pull(force = false, keep?: string[]) {
  const base = readBase()
  if (!base) return
  try {
    const r = await fetch(`${base}/data`, { cache: 'no-store', headers: authHeaders() })
    if (!r.ok) { await noteAuth(r); return }
    noteMerge(r)
    // 데이터보다 먼저 권한을 맞춘다 — 아래 normalize 가 isStaff() 를 본다
    const roleChanged = applyRole(r)
    const data = await r.json()
    if (data && typeof data === 'object' && Object.keys(data).length) {
      let incRev = Number(data._rev || 0) || 0
      // 미래 시각으로 조작된 rev 방어 — 그대로 저장하면 이후 모든 pull이 무시됨
      if (incRev > Date.now() + 60 * 60 * 1000) incRev = Date.now()
      const staffHdr = r.headers.get('x-role-staff')
      const hdrView: '' | 'staff' | 'member' = staffHdr === '1' ? 'staff' : staffHdr === '0' ? 'member' : ''
      // 내 최신 편집(rev)보다 오래되거나 같은 버전이면 무시 — 입력 중 덮어쓰기 방지
      //
      // ★ 단, 권한이 바뀌었거나 이 사본의 출처가 지금 권한과 다르면 건너뛰면 안 된다.
      //   rev 는 그대로인데 워커가 내려주는 칸이 달라지기 때문이다(stripForMember).
      //   일반 길드원용 사본(점수 칸이 빈 것)을 운영진 화면이 들고 있으면, 그 빈 칸을
      //   고쳐 저장하는 순간 공성전·파괴신 기록이 덮인다. 출처 비교는 탭 사이에서 건너온
      //   사본까지 잡는다(권한 플래그는 이미 다른 탭이 바꿔 둬서 roleChanged 가 거짓이다).
      const viewStale = !!hdrView && hdrView !== stateView
      if (!force && !roleChanged && !viewStale && rev && incRev <= rev) return
      // 아직 안 올라간 편집은 서버 사본 위에 다시 얹는다 (새로 받았다고 입력을 잃지 않게)
      const carry = force ? (keep ?? []) : [...dirty]
      const local = state as unknown as Record<string, unknown>
      const mine: Record<string, unknown> = {}
      for (const k of carry) if (k in local) mine[k] = local[k]
      state = { ...normalize(data), ...mine } as UserData
      if (force) { dirty.clear(); for (const k of Object.keys(mine)) dirty.add(k) }
      if (incRev) saveRev(incRev)
      stateView = hdrView
      persistLocal()
      // 얹은 편집이 있으면 올린다 (탭을 닫았다 열어 저장소에 남아 있던 것 포함)
      if (dirty.size && pushTimer === undefined) schedulePush()
    }
  } catch {
    /* 오프라인: 로컬 캐시 유지 */
  }
}

let pushTimer: number | undefined

/** 잦은 입력(키 입력마다)을 1.2초로 몰아서 한 번만 업로드 */
function schedulePush() {
  if (!canPush()) return
  if (pushTimer !== undefined) window.clearTimeout(pushTimer)
  pushTimer = window.setTimeout(() => {
    pushTimer = undefined
    void push()
  }, 1200)
}

async function push(keepalive = false) {
  const base = readBase()
  if (!base || !canPush()) return
  // 보낼 칸 — 합치기를 지원하는 워커면 바뀐 칸만, 아니면(옛 워커·아직 모름) 전부
  const sending = serverMerges ? [...dirty] : null
  if (sending && !sending.length) return
  // 보내는 동안 또 고친 칸은 성공해도 '올라감' 으로 치면 안 된다 — 보낸 그대로인지 비교한다
  const local = state as unknown as Record<string, unknown>
  const snap = new Map((sending ?? Object.keys(local)).map((k) => [k, JSON.stringify(local[k])]))
  const prevRev = rev
  const nextRev = Math.max(Date.now(), rev + 1)
  saveRev(nextRev)
  /**
   * ★ 저장이 실패하면 rev 를 반드시 되돌린다.
   *
   * 예전엔 보내기 전에 올린 rev 를 실패해도 그대로 뒀다. 그러면 로컬 rev 가 서버
   * _rev 보다 앞서게 되고, pull 의 `incRev <= rev` 가 그때부터 **모든** 갱신을
   * 조용히 건너뛴다 — 그 브라우저만 공유 데이터에서 영영 떨어져 나가고, 화면에는
   * 아무 표시도 없었다. 413(크기 초과)·400(검증)·403(영구 관리자 보호)처럼
   * noteAuth 가 안 보는 거절이 한 번만 나도 그렇게 됐다.
   *
   * 보내는 사이에 다른 push 가 rev 를 또 올렸으면 건드리지 않는다.
   */
  const rollback = () => { if (rev === nextRev) saveRev(prevRev) }
  // 편집 권한은 워커가 본다 — 로그인 토큰을 같이 보내고, 거절당하면 로그인 화면으로.
  try {
    const r = await fetch(`${base}/data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: pushBody(sending),
      keepalive,
    })
    noteMerge(r)
    if (!r.ok) {
      rollback()
      await noteAuth(r)
      // 401 은 로그인 화면이 뜨므로 따로 알릴 필요가 없다. 나머지는 사용자가 알아야
      // 한다 — 저장이 안 됐는데 됐다고 믿으면 그 입력을 그대로 잃는다.
      if (r.status !== 401) {
        const j = await r.clone().json().catch(() => null) as { error?: string; code?: string; field?: string } | null
        const why = j?.error || `저장이 거절됐어요 (${r.status})`
        if (r.status === 429 && j?.code === 'rate') {
          // 너무 잦다 — 입력은 맞으니 잠시 뒤 한 번 더 보낸다 (그 사이 새 입력이 있으면 그쪽이 보낸다)
          setSaveError(why + ' 잠시 뒤 자동으로 다시 저장해요.')
          window.setTimeout(() => { if (pushTimer === undefined) void push() }, 15_000)
        } else if (r.status === 429 || r.status === 503) {
          // 오늘 한도·서버 저장소 문제 — 입력은 맞으니 화면은 그대로 두고 알리기만 한다
          setSaveError(why)
        } else if (r.status !== 403 || j?.code !== 'gone') {
          // ★ 검증에 걸린 저장(대량 삭제·모양·크기 등)은 그 칸을 서버 상태로 되돌린다.
          //   거절된 편집이 화면에만 남아 있으면 그 뒤 모든 저장이 같은 이유로 계속 거절되고,
          //   rev 도 되돌렸으니 보통 pull 로는 안 풀린다(incRev <= rev).
          //   워커가 어느 칸 때문인지(field) 알려 주면 그 칸만 버리고 나머지 편집은 다시 얹는다.
          //   모르면 전부 되돌린다 — 어느 칸이 문제인지 모른 채 다시 보내면 같은 거절이 되풀이된다.
          const keep = j?.field ? [...dirty].filter((k) => k !== j.field) : []
          setSaveError(why + (j?.field ? ` — 그 칸은 서버에 저장된 상태로 되돌렸어요.` : ' — 서버에 저장된 상태로 되돌렸어요.'))
          void pull(true, keep)
        }
      }
      return
    }
    setSaveError('')
    // 올라간 칸을 지운다 — 보내는 사이에 또 고친 칸(지금 값이 보낸 값과 다름)은 남겨 둬
    // 다음 저장에 실린다
    const now = state as unknown as Record<string, unknown>
    for (const [k, s] of snap) if (JSON.stringify(now[k]) === s) dirty.delete(k)
    persistLocal()
    // 저장 응답에도 권한이 실려 온다 — 바뀌었으면 곧바로 새로 받는다(내려오는 칸이 달라진다)
    if (applyRole(r)) void pull(true, [...dirty])
    // 워커가 서버 시각으로 스탬프한 최종 rev를 돌려줌 — 클라이언트 시계 오차와
    // 무관하게 모두가 한 시계(서버)를 기준으로 버전 비교하도록 맞춤
    const j = (await r.json().catch(() => null)) as { rev?: number } | null
    if (j && typeof j.rev === 'number' && j.rev > 0) saveRev(j.rev)
  } catch {
    rollback()
    setSaveError('서버에 못 닿았어요 — 저장되지 않았습니다.')
  }
}

/**
 * 보낼 본문. fields 가 있으면 그 칸만(바뀐 칸), 없으면 전부(옛 워커 호환).
 * 변경 기록(_log)은 워커가 관리하므로 빼고 보낸다(최대 100건이라 무게만 는다).
 */
function pushBody(fields?: string[] | null): string {
  const local = state as unknown as Record<string, unknown>
  const data: Record<string, unknown> = {}
  for (const k of fields ?? Object.keys(local)) {
    if (k === '_log' || !(k in local)) continue
    data[k] = local[k]
  }
  return JSON.stringify({ data: { ...data, _rev: rev } })
}

// 최초 로드 시 공유 데이터를 당겨오고, 이후 주기적으로 동기화
// (백그라운드 탭은 건너뜀 — KV 무료 한도 절약. 탭으로 돌아오면 즉시 갱신)
if (typeof window !== 'undefined') {
  pull()
  window.setInterval(() => {
    if (!document.hidden) pull()
  }, 60000)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pull()
  })
  // 탭을 닫을 때 아직 안 올라간 입력이 있으면 마지막으로 전송
  //
  // ★ keepalive 요청은 브라우저가 본문을 64KiB 로 제한한다. 저장본이 그보다 크면 요청 자체가
  //   실패하는데, 페이지가 닫히는 중이라 오류 표시도 안 보여서 마지막 입력이 조용히 사라졌다.
  //   크면 보내지 않고 '떠나시겠어요?' 를 띄운다 — 머물면 1.2초 뒤 평소대로 저장된다.
  window.addEventListener('beforeunload', (e) => {
    if (pushTimer === undefined) return
    if (new Blob([pushBody()]).size < 60_000) {
      window.clearTimeout(pushTimer)
      pushTimer = undefined
      void push(true)
    } else {
      e.preventDefault()
      e.returnValue = ''
    }
  })
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getUserData(): UserData {
  return state
}

/**
 * 마지막 저장 실패 사유. 빈 문자열이면 정상.
 *
 * 저장은 1.2초 몰아치기(schedulePush)로 화면 뒤에서 일어나서, 실패해도 사용자는
 * 성공한 줄 안다. 공유 데이터라 그 오해가 곧 기록 분실로 이어진다.
 */
let saveError = ''
const saveErrorListeners = new Set<() => void>()

function setSaveError(msg: string) {
  if (saveError === msg) return
  saveError = msg
  for (const fn of saveErrorListeners) fn()
}

export function clearSaveError() { setSaveError('') }

export function useSaveError(): string {
  return useSyncExternalStore(
    (fn) => { saveErrorListeners.add(fn); return () => { saveErrorListeners.delete(fn) } },
    () => saveError,
  )
}

/** React 훅: 사용자/공유 데이터 구독 */
export function useUserData(): UserData {
  return useSyncExternalStore(subscribe, getUserData)
}

/** 길드 이름 — 안 정했으면 기본값. 로고·홈 제목·푸터·인쇄표가 이걸 같이 본다 */
export function useGuildName(): string {
  return useUserData().guildName?.trim() || DEFAULT_GUILD_NAME
}

/**
 * 길드 이름 저장 — 비우면 기본값으로 되돌아간다.
 * 되돌릴 때 필드를 delete 하지 않고 빈 문자열을 남기는 게 중요하다.
 * 워커는 '요청에 없는 필드'를 직전 값으로 이월하므로, 지워버리면 옛 이름이 되살아난다.
 */
export function setGuildName(next: string) {
  const v = next.trim().slice(0, GUILD_NAME_MAX)
  update((d) => { d.guildName = v === DEFAULT_GUILD_NAME ? '' : v })
}

export function update(mutator: (draft: UserData) => void) {
  const draft = structuredClone(state)
  mutator(draft)
  // 바뀐 최상위 칸을 적어 둔다 — 저장은 이 칸만 보낸다(건드리지 않은 칸을 오래된 사본으로
  // 되돌리지 않게. 점수 칸이 빈 사본이 기록을 [] 로 덮던 사고도 이것으로 원천 차단된다)
  const before = state as unknown as Record<string, unknown>
  const after = draft as unknown as Record<string, unknown>
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (k === '_log') continue
    if (JSON.stringify(after[k]) !== JSON.stringify(before[k])) dirty.add(k)
  }
  state = draft
  persistLocal()
  schedulePush()
}

/** 상태를 통째로 갈아끼운 경우(가져오기·초기화) — 모든 칸을 올려야 한다 */
function markAllDirty() {
  for (const k of Object.keys(state)) if (k !== '_log') dirty.add(k)
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

// ---- 카운터 영웅 슬롯 헬퍼 (구버전 문자열 ↔ 상세 슬롯 호환) ----

export function slotName(h: string | CounterHeroSlot): string {
  // 이중 방어 — 빈 슬롯(null) 하나가 홈 전체를 죽이지 않게 (normalize·워커도 막는다)
  if (typeof h === 'string') return h
  return h && typeof h.name === 'string' ? h.name : ''
}

export function toSlot(h: string | CounterHeroSlot): CounterHeroSlot {
  return typeof h === 'string' ? { name: h } : { ...h }
}

/** 카운터덱의 영웅 이름 목록 (검색·매칭용) */
export function counterHeroNames(c: CounterDeck): string[] {
  return (c.heroes || []).map(slotName)
}

// ---- 길드원 명단 ----
// '외부 처리'된 계정은 지금 길드에 없는 계정이다. 자리 때문에 들락날락하는
// 부계정을 삭제하지 않고 내려두려고 만든 구분이라, 판정 기준은 한 군데로 모은다.
//
// ★ 이 구분은 '누가 있어야 하는가'(명단)만 바꾼다. '누가 실제로 몇 점을 냈는가'
//   (StatRound.entries/days)는 이름으로 저장돼 있어 손대지 않는다 — 지난 회차
//   기록에서 사람이 사라지면 그때 표가 거짓이 되기 때문.
//   ★ 2026-09-22 부터 화면에서는 감춘다(hiddenNames). 저장된 값은 그대로라
//     복귀 처리하면 지난 회차 표에 즉시 다시 나타난다 — 지우는 것과 다르다.

/** 지금 길드에 있는 길드원만 */
export function activeMembers(members: Member[]): Member[] {
  return members.filter((m) => !m.excluded)
}

/** 외부 처리해 둔 계정만 */
export function excludedMembers(members: Member[]): Member[] {
  return members.filter((m) => m.excluded)
}

/** 통계·커트라인이 기준으로 삼는 명단 (외부 처리 제외) */
export function rosterNames(members: Member[]): string[] {
  return activeMembers(members).map((m) => m.name)
}

/**
 * 표·집계에서 감출 이름 — 외부 처리한 길드원(2026-09-22).
 *
 * 예전엔 점수가 있으면 `(외부)` 행으로 순위에 같이 들어갔는데, 지금 길드에 없는
 * 사람이 랭킹·합계에 끼는 게 맞지 않아 화면에서 뺀다.
 *
 * ★ **기록을 지우는 게 아니라 감추는 것이다.** `StatRound.entries/days` 의 값은
 *   그대로 남아 있어서, 복귀 처리(excluded 해제)하면 지난 회차 표에 즉시 다시 나타난다.
 * ★ 손으로 적어 넣은 비길드원 이름(용병 등)은 여기 안 들어간다 — 그쪽은 계속 보인다.
 *   같은 `(외부)` 라벨을 쓰지만 서로 다른 것이다(이쪽은 Member.excluded).
 */
export function hiddenNames(members: Member[]): Set<string> {
  return new Set(excludedMembers(members).map((m) => m.name))
}

// ---- 병합된 뷰 (초기 데이터 + 사용자 데이터) ----

export function getAllHeroes(): Hero[] {
  return [...(initialHeroes as Hero[]), ...state.customHeroes]
}

export function getAllCounters(): CounterEntry[] {
  const userIds = new Set(state.counters.map((c) => c.id))
  const hidden = new Set(state.hiddenCounterIds)
  const base = (initialCounters as CounterEntry[]).filter(
    (c) => !userIds.has(c.id) && !hidden.has(c.id),
  )
  return [...state.counters, ...base]
}

/** 초기 데이터에 포함된 엔트리인지 (사용자 수정본 제외) */
export function isBuiltinCounter(id: string): boolean {
  return (initialCounters as CounterEntry[]).some((c) => c.id === id)
}

export function getAllArena(): ArenaEntry[] {
  const userIds = new Set(state.arenaEntries.map((a) => a.id))
  const hidden = new Set(state.hiddenArenaIds)
  const base = (initialArena as ArenaEntry[]).filter((a) => !userIds.has(a.id) && !hidden.has(a.id))
  return [...state.arenaEntries, ...base]
}

export function isBuiltinArena(id: string): boolean {
  return (initialArena as ArenaEntry[]).some((a) => a.id === id)
}

// ---- 내보내기 / 가져오기 ----

export function exportJson(): string {
  return JSON.stringify(state, null, 2)
}

export function importJson(raw: string): { ok: boolean; error?: string } {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) throw new Error('형식이 올바르지 않음')
    state = normalize(parsed)
    markAllDirty()
    persistLocal()
    void push()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 전체 초기화 — 명단(members)은 남긴다.
 *
 * ★ 명단이 곧 로그인 자격이다. 예전엔 명단까지 [] 로 보내서, 영구 관리자가 누르면 본인을
 *   포함해 전원이 잠겼고(그 뒤로는 워커 시크릿만 남는다), 그 밖의 운영진이 누르면 영구
 *   관리자 보호에 걸려 초기화 전체가 거절됐다. 워커도 이제 명단을 통째로 비우는 저장을 막는다.
 */
export function resetAll() {
  state = { ...structuredClone(EMPTY), members: state.members }
  markAllDirty()
  persistLocal()
  void push()
}
