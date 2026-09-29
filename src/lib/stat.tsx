// 공성전·파괴신 통계에서 공통으로 쓰는 것들.
// 통계 페이지와 홈의 요약표가 같은 규칙(숫자 표기·등락·커트라인 판정)을 쓰도록 한곳에 모았다.
import type { CutlineGuide, Member, StatEntry, StatRound } from '../types'

export const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일']
export const todayWeekday = (): string => WEEKDAYS[(new Date().getDay() + 6) % 7]

export const fmt = (n?: number): string =>
  typeof n === 'number' && !Number.isNaN(n) ? n.toLocaleString() : '-'

/** 직전 기록 대비 등락(%) */
export function Delta({ prev, cur }: { prev?: number; cur?: number }) {
  if (typeof cur !== 'number' || typeof prev !== 'number' || prev === 0) return <span className="muted">—</span>
  const pct = ((cur - prev) / Math.abs(prev)) * 100
  if (Math.abs(pct) < 0.05) return <span className="delta">0%</span>
  const up = pct > 0
  return <span className={`delta ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%</span>
}

/**
 * 직전 기록 대비 **점수차** — 절대값을 앞에, %를 뒤에.
 *
 * 공성전 점수차와 파괴신의 시즌집계·중간집계 대비가 이걸 쓴다. 파괴신도 예전엔
 * 딜량 자릿수가 커서 %(Delta)만 보였는데, 운영진이 '전 시즌과의 차이' 를 숫자로
 * 보고 싶어 해서 바꿨다(2026-09-28). 홈 카드처럼 좁은 곳은 여전히 Delta 를 쓴다.
 */
export function Diff({ prev, cur }: { prev?: number; cur?: number }) {
  if (typeof cur !== 'number' || typeof prev !== 'number') return <span className="muted">—</span>
  const d = cur - prev
  if (d === 0) return <span className="delta">±0</span>
  const pct = prev === 0 ? undefined : (d / Math.abs(prev)) * 100
  return (
    <span className={`delta ${d > 0 ? 'up' : 'down'}`}>
      {d > 0 ? '▲' : '▼'} {Math.abs(d).toLocaleString()}
      {pct !== undefined && (
        <span style={{ fontWeight: 400, opacity: 0.65, marginLeft: 4 }}>({Math.abs(pct).toFixed(1)}%)</span>
      )}
    </span>
  )
}

/**
 * 순위 변동. 등수는 작아지는 게 올라가는 것이라 부호를 뒤집어 본다
 * (3등 → 1등이면 ▲2).
 */
export function RankMove({ prev, cur }: { prev?: number; cur?: number }) {
  if (typeof cur !== 'number' || typeof prev !== 'number') {
    return <span className="muted" style={{ fontSize: '0.7rem' }}>—</span>
  }
  const d = prev - cur
  if (d === 0) return <span className="delta" style={{ fontSize: '0.7rem' }}>—</span>
  return (
    <span className={`delta ${d > 0 ? 'up' : 'down'}`} style={{ fontSize: '0.7rem' }}>
      {d > 0 ? '▲' : '▼'}{Math.abs(d)}
    </span>
  )
}

/** 집계 기준값 — 최종이 있으면 최종, 없으면 중간집계(파괴신 시즌 도중) */
export const effOf = (e: StatEntry, useMid: boolean): number | undefined =>
  typeof e.value === 'number' ? e.value : useMid ? e.mid : undefined

type MidLike = { mid?: number; midHits?: number } | undefined

/**
 * 파괴신 중간집계의 **1회 점수** — 총 딜량 ÷ 친 횟수 (반올림).
 *
 * 중간집계 시점에는 사람마다 친 횟수가 달라서, 총계끼리 놓으면 많이 친 사람이 이긴다.
 * 그래서 중간집계를 **보여 줄 때는** 화면·인쇄·홈 어디서든 이 값을 쓴다.
 * 횟수를 모르면(옛 기록·횟수 없이 손으로 넣은 값) undefined — 보여 주는 쪽이 총계로
 * 떨어뜨리고 '총' 을 붙인다(midShown).
 *
 * ★ 순위·합계·커트라인은 여전히 **총계**로 매긴다. 게임 순위가 총계 기준이고,
 *   커트라인도 시즌 총 딜량 기준이라 1회 점수와 견주면 전원이 통과해 버린다.
 */
export function perHit(e: MidLike): number | undefined {
  if (!e || typeof e.mid !== 'number' || typeof e.midHits !== 'number' || !(e.midHits > 0)) return undefined
  return Math.round(e.mid / e.midHits)
}

/** 중간집계를 화면에 놓을 값 — 1회 점수, 횟수를 모르면 총계 */
export const midShown = (e: MidLike): number | undefined => perHit(e) ?? e?.mid

/**
 * 중간집계 열 제목에 붙일 단위 — 실제로 들어 있는 값에 맞춘다.
 * ★ '1회' 로 고정하면 횟수가 없던 옛 시즌(2026-09-28 전 기록 전부)을 뽑을 때 제목은
 *   '1회' 인데 칸은 전부 총계가 되어, 밖으로 돌리는 표가 자기 숫자와 어긋났다.
 */
export function midUnit(entries: MidLike[]): '1회' | '총' | '1회·총' {
  const withMid = entries.filter((e) => typeof e?.mid === 'number')
  const n = withMid.filter((e) => perHit(e) !== undefined).length
  if (withMid.length > 0 && n === 0) return '총'
  return n === withMid.length ? '1회' : '1회·총'
}

/**
 * 중간집계 대비 — **전 시즌 중간집계 vs 이번 시즌 중간집계** 의 비교 짝.
 *
 * 둘 다 횟수가 있으면 1회 점수끼리, 둘 다 없으면 총계끼리 비교한다.
 * ★ 한쪽만 횟수가 있으면 **비교하지 않는다** — 1회 점수(수십만)에서 총계(수백만)를
 *   빼면 전원이 크게 떨어진 것처럼 나온다. 전 시즌에 횟수를 채워 넣으면 그때부터 나온다.
 */
export function midCompare(prev: MidLike, cur: MidLike): { prev?: number; cur?: number; mixed?: boolean } {
  if (typeof prev?.mid !== 'number' || typeof cur?.mid !== 'number') return {}
  const p = perHit(prev)
  const c = perHit(cur)
  if (p !== undefined && c !== undefined) return { prev: p, cur: c }
  if (p === undefined && c === undefined) return { prev: prev.mid, cur: cur.mid }
  return { mixed: true }
}

/**
 * 이 사람에게 적용되는 커트라인.
 *
 * 순서: 회차에 저장된 값 → [커트라인] 메뉴의 기준표 → 회차 기본값.
 *
 * 커트라인은 이제 [커트라인] 메뉴의 기준표 한 곳에서만 관리한다. 통계 화면의
 * 입력칸은 없앴다(등급이 늘면서 편집할 때마다 10칸 넘게 쌓였다).
 *
 * ★ 그래도 회차에 저장된 값을 먼저 본다. 지난 회차에는 그때 실제로 적용했던
 *   기준이 박혀 있는데, 지금 기준표로 덮으면 과거 미달 판정이 소급해서 바뀐다.
 *   기준표는 값이 없는 회차(=앞으로 만드는 회차)를 채우는 용도다.
 */
export function cutlineFor(
  round: StatRound,
  name: string,
  opts: { day?: string; tierOf?: Map<string, string>; guide?: CutlineGuide },
): number | undefined {
  if (opts.day) {
    const dc = round.dayCutlines?.[opts.day]
    if (typeof dc === 'number') return dc
    const gd = opts.guide?.siegeByDay?.[opts.day]
    if (typeof gd === 'number') return gd
    return round.cutline
  }
  const t = opts.tierOf?.get(name)
  const tc = t !== undefined ? round.tierCutlines?.[t] : undefined
  if (typeof tc === 'number') return tc
  const gt = t !== undefined ? opts.guide?.destroyerByTier?.[t] : undefined
  if (typeof gt === 'number') return gt
  return round.cutline
}

/** 주간 합계 한 줄 */
export interface WeekRow {
  name: string
  /** 월~일 점수의 합 */
  total: number
  /** 점수가 들어간 요일 수 (합계만 보면 몇 번 뛰었는지를 알 수 없다) */
  played: number
}

// 주간 합계에는 커트라인 미달을 안 센다. 커트라인은 '그날 이 점수가 미달이다' 라는
// 요일 단위 기준이라, 주간 표에 '미달 N회' 로 올리면 요일 표의 판정과 뜻이 다른
// 숫자가 같은 이름으로 나란히 놓인다. 미달은 요일 표에서 본다.

/**
 * 한 주차를 사람별로 합산한다. **합계가 0 인 사람은 빼고 돌려준다.**
 *
 * 한 번도 안 뛴 사람과 뛰었지만 0점인 사람 둘 다 빠진다 — 순위표에 0 이 줄줄이
 * 붙어도 읽을 게 없다.
 *
 * ★ 그래서 이 함수만으로는 '이번 주에 누가 안 뛰었나' 를 알 수 없다. 그 정보는
 *   두 군데에 남겨 뒀다 — 주간 표의 '참여 인원 N/명단수' 타일과, 요일 표의
 *   '미참여' 열(전체 기록 누적). 여기 필터를 되돌릴 때 그쪽도 같이 볼 것.
 */
export function weekTotals(
  round: StatRound | undefined,
  roster: string[],
  /** 표에서 감출 이름 (외부 처리한 길드원) — 합계·순위 어디에도 안 들어간다 */
  hidden?: Set<string>,
): WeekRow[] {
  const acc = new Map<string, WeekRow>()
  const row = (name: string) => {
    let r = acc.get(name)
    if (!r) { r = { name, total: 0, played: 0 }; acc.set(name, r) }
    return r
  }
  for (const name of roster) row(name)
  if (round) {
    for (const d of WEEKDAYS) {
      for (const e of round.days?.[d] ?? []) {
        if (typeof e.value !== 'number') continue
        if (hidden?.has(e.name)) continue
        const r = row(e.name)
        r.total += e.value
        r.played += 1
      }
    }
  }
  // 합계가 0(안 뛴 사람 + 0점 기록자)이면 표에 안 올린다.
  // 남은 행은 전부 점수가 있으므로 순위가 '-' 인 행이 섞일 일이 없다.
  return [...acc.values()]
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}

/** 합계 기준 등수 — 점수가 없으면 등수도 없다. 동점은 같은 등수(rankOf 와 같은 규칙) */
export function weekRankMap(rows: WeekRow[]): Map<string, number> {
  const scored = rows.filter((r) => r.played > 0)
  const m = new Map<string, number>()
  for (const r of scored) m.set(r.name, scored.filter((o) => o.total > r.total).length + 1)
  return m
}

/** 마지막에 기록된 회차 (배열 끝) */
export const lastRound = (rounds: StatRound[]): StatRound | undefined => rounds[rounds.length - 1]

/**
 * 실제로 값이 들어 있는 가장 최근 회차와 그 위치.
 * 새 주차/시즌을 만들어 두고 아직 입력 전이면 그 회차는 비어 있으므로,
 * 홈 요약이 빈 표가 되지 않도록 한 단계씩 뒤로 물러난다.
 */
export function lastFilled(
  rounds: StatRound[],
  byDay: boolean,
): { round?: StatRound; index: number } {
  for (let i = rounds.length - 1; i >= 0; i--) {
    const r = rounds[i]
    const has = byDay
      ? Object.values(r.days ?? {}).some((l) => l.some((e) => typeof e.value === 'number'))
      : (r.entries ?? []).some((e) => typeof e.value === 'number' || typeof e.mid === 'number')
    if (has) return { round: r, index: i }
  }
  return { round: undefined, index: -1 }
}

/** 그 주차에서 점수가 들어간 가장 나중 요일 (월→일 순서 기준) */
export function latestDayWithData(round?: StatRound): string | undefined {
  if (!round?.days) return undefined
  for (let i = WEEKDAYS.length - 1; i >= 0; i--) {
    const d = WEEKDAYS[i]
    if ((round.days[d] ?? []).some((e) => typeof e.value === 'number')) return d
  }
  return undefined
}

/**
 * 표에서 이름 옆에 붙일 짧은 등급 표기 — '파이 11초' → '11초'.
 *
 * ★ 표시용으로만 쓴다. 저장값(Member.tier)과 커트라인 기준표(destroyerByTier)의
 *   키는 '파이 …' 그대로여야 한다. 여기서 자른 문자열로 기준표를 찾으면 안 된다.
 *   '파이'로 시작하지 않는 값은 건드리지 않고 그대로 둔다.
 */
export const tierShort = (t?: string): string => {
  const s = (t ?? '').trim()
  return s.startsWith('파이') ? s.slice(2).trim() : s
}

/** 길드원 이름 → 등급 (파괴신 등급별 커트라인용) */
export const tierMap = (members: Member[]): Map<string, string> =>
  new Map(members.filter((m) => m.tier).map((m) => [m.name, m.tier as string]))

/**
 * 화면에 거는 링크 주소를 거른다.
 *
 * href 에는 javascript: 같은 스킴도 들어간다. 여기 오는 값은 학습(AI)이 외부
 * 라운지 글에서 뽑아 온 것이거나 운영진이 손으로 적은 것이라, 우리가 만든 값이
 * 아니다. http/https 가 아니면 링크를 아예 안 건다.
 */
export function safeUrl(u?: string): string | undefined {
  if (!u) return undefined
  try {
    const p = new URL(u, location.origin)
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.href : undefined
  } catch {
    return undefined
  }
}
