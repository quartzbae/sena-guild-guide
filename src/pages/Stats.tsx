import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import html2canvas from 'html2canvas'
import type { CutlineGuide, StatEntry, StatRound, UserData } from '../types'
import {
  activeMembers, excludedMembers, hiddenNames, newId, rosterNames, todayLocal, update, useGuildName, useUserData,
} from '../store'
import { isAdmin } from '../auth'
import { Markdown } from '../components/Markdown'
import { DESTROYER_GUIDES } from '../data/destroyerGuide'
import {
  Diff, RankMove, WEEKDAYS, fmt, midCompare, midUnit, perHit, tierShort, todayWeekday, weekRankMap, weekTotals,
} from '../lib/stat'
import { ScoreImport } from '../components/ScoreImport'

type Kind = 'siege' | 'destroyer'

const CFG: Record<
  Kind,
  {
    title: string; desc: string; metric: string; field: 'siegeRounds' | 'destroyerRounds'
    byDay: boolean; roundName: string; showJoined: boolean; hasCutline: boolean; deltaLabel: string
    /** 중간집계 열 사용 (파괴신) */
    showMid: boolean
    /** 직전 기록 열 제목 */
    prevLabel: string
    /** 최종 집계 열 제목 */
    finalLabel: string
  }
> = {
  siege: {
    title: '공성전 통계',
    desc: '주차를 고르고 요일(월~일)마다 [편집]을 눌러 점수를 입력하고 [저장]하면 잠겨요. 각 요일 점수를 지난주 같은 요일과 비교해 등락(%)이 표시돼요. 점수는 [📷 캡처에서 읽기]로 결과 화면을 붙여넣으면 자동으로 채워져요. 커트라인은 [커트라인] 메뉴의 요일별 기준표를 따르고, 이하 점수는 미달로 표시돼요. 명단은 [길드원] 메뉴 등록자가 자동으로 들어옵니다.',
    metric: '점수',
    field: 'siegeRounds',
    byDay: true,
    roundName: '주차',
    showJoined: false,
    hasCutline: true,
    deltaLabel: '전주 대비',
    showMid: false,
    prevLabel: '전 주',
    finalLabel: '이번 주',
  },
  destroyer: {
    title: '파괴신 통계',
    desc: '시즌별로 [편집]을 눌러 중간집계·최종 딜량을 입력하고 [저장]하면 잠겨요. 딜량은 [📷 캡처에서 읽기]로 결과 화면을 붙여넣으면 자동으로 채워지는데, 중간집계와 최종 집계 중 어디에 넣을지 고를 수 있어요. 중간집계는 총 딜량을 친 횟수로 나눈 1회 점수로 보여 주고(캡처에서 횟수도 같이 읽어요), 중간집계·시즌집계를 각각 전 시즌 같은 값과 비교해 차이를 표시해요. [커트라인] 메뉴의 파이 초월 단계별 기준 이하는 미달로 표시돼요. 명단은 [길드원] 메뉴 등록자가 자동으로 들어옵니다.',
    metric: '딜량',
    field: 'destroyerRounds',
    byDay: false,
    roundName: '시즌',
    showJoined: false,
    hasCutline: true,
    // 이번 시즌 집계 − 전 시즌 집계. 옆의 '중간집계 대비' 도 전 시즌과 비교하므로
    // '전 시즌 대비' 라고 하면 둘 중 어느 쪽인지 구분이 안 된다.
    deltaLabel: '시즌집계 대비',
    showMid: true,
    prevLabel: '전 시즌',
    finalLabel: '이번 시즌 집계',
  },
}


export function StatsPage({ kind }: { kind: Kind }) {
  const data = useUserData()
  const cfg = CFG[kind]
  const rounds = data[cfg.field]
  const admin = isAdmin()
  // 명단은 '지금 길드에 있는' 사람만 — 외부 처리한 계정은 미달·누락 집계 대상이 아니다.
  // 지난 회차에 남아 있는 그들의 점수는 storedExtra(외부) 경로로 그대로 표에 남는다.
  const roster = rosterNames(data.members)
  // 캡처 판독에는 외부 계정 이름도 넘긴다 — 복귀 처리를 깜빡한 채 캡처를 올려도
  // 이름이 엉뚱하게 붙지 않고, 수동 선택 목록에서도 고를 수 있게.
  const knownExtra = excludedMembers(data.members).map((m) => m.name)
  /** 표·집계에서 감출 이름 (외부 처리한 길드원) */
  const hidden = hiddenNames(data.members)
  // 파괴신에만 공략 문서 탭 (감탱이 시트 이관본)
  const guides = kind === 'destroyer' ? DESTROYER_GUIDES : null
  const [view, setView] = useState<'stats' | 'guide'>('stats')

  const [selId, setSelId] = useState<string | null>(null)
  const [day, setDay] = useState<string>(todayWeekday())
  /**
   * 주간 합계를 보고 있나.
   *
   * ★ 처음엔 day 에 '주간' 이라는 값을 끼워 넣었는데, EntryTable 의 key 가
   *   `current.id + day` 라서 주간으로 갔다 오면 **재마운트**됐다 — 그 안의
   *   editing·draft 가 통째로 사라져서, 25명분 점수를 치던 중에 주간 합계를 한 번
   *   눌러 보면 경고도 없이 전부 날아갔다. day 는 늘 진짜 요일로 두고 이 깃발만
   *   따로 두면 key 가 안 바뀌어 입력이 살아 있다. `days['주간']` 같은 이상한
   *   키가 생길 여지도 없어진다.
   */
  const [weekView, setWeekView] = useState(false)
  const current = rounds.find((r) => r.id === selId) ?? rounds[rounds.length - 1] ?? null

  const stored: StatEntry[] = current ? (cfg.byDay ? current.days?.[day] ?? [] : current.entries) : []
  // 공성전은 요일마다 기준점이 달라 요일별 커트라인 사용 (없으면 주차 공통값으로 폴백)
  const curCutline = current
    ? (cfg.byDay ? current.dayCutlines?.[day] ?? current.cutline : current.cutline)
    : undefined
  // 파괴신: 길드원 등급(영웅 초월 단계)별 커트라인 — 이름→등급, 등급 목록
  // 이름→등급은 외부 계정까지 담아 둔다 — 그들이 외부 행으로 남아 있을 때
  // 엉뚱한 기본 커트라인 대신 본인 등급 기준이 적용되도록.
  const tierOf = new Map(data.members.filter((m) => m.tier).map((m) => [m.name, m.tier as string]))
  // 커트라인을 입력할 등급 목록은 활동 중인 사람 기준 — 아무도 없는 등급까지 칸을 만들 필요는 없다
  const tierList = [...new Set(activeMembers(data.members).map((m) => m.tier).filter((t): t is string => !!t))].sort()
  const tierCutlines = current?.tierCutlines

  const currentIndex = current ? rounds.findIndex((r) => r.id === current.id) : -1
  const prevRound = currentIndex > 0 ? rounds[currentIndex - 1] : undefined
  const prevList: StatEntry[] = prevRound ? (cfg.byDay ? prevRound.days?.[day] ?? [] : prevRound.entries) : []
  const prevValues = new Map(prevList.filter((e) => typeof e.value === 'number').map((e) => [e.name, e.value as number]))
  // 파괴신: 전 시즌 기록 통째로 — '중간집계 대비' 가 전 시즌 중간집계(와 그때 친 횟수)를 본다
  const prevEntries = cfg.showMid ? new Map(prevList.map((e) => [e.name, e])) : undefined
  // 순위변동·누적 미참여는 공성전 표에만 붙인다 — 파괴신은 시즌 수가 적어 뜻이 옅다.
  const prevRanks = cfg.byDay ? rankMapOf(prevList) : undefined
  // 전 주차를 다 훑으므로(주차×요일) 기록이 쌓이면 무거워진다 — rounds 가 바뀔 때만 다시 센다.
  const misses = useMemo(() => (cfg.byDay ? missMapOf(rounds, true) : undefined), [rounds, cfg.byDay])

  function patchRounds(fn: (rs: StatRound[]) => void) {
    update((d: UserData) => { fn(d[cfg.field]) })
  }
  function patchRound(roundId: string, fn: (r: StatRound) => void) {
    patchRounds((rs) => { const r = rs.find((x) => x.id === roundId); if (r) fn(r) })
  }

  function addRound() {
    const label = prompt(`${cfg.roundName} 이름을 입력하세요. (예: ${cfg.byDay ? '7월 2주 / 시즌 12' : '1회차 / 시즌 12'})`)?.trim()
    if (!label) return
    const id = newId(kind)
    patchRounds((rs) => rs.push({ id, label, date: todayLocal(), entries: [], ...(cfg.byDay ? { days: {} } : {}) }))
    setSelId(id)
  }
  function renameRound(r: StatRound) {
    const label = prompt(`${cfg.roundName} 이름 변경`, r.label)?.trim()
    if (label) patchRound(r.id, (x) => { x.label = label })
  }
  function deleteRound(r: StatRound) {
    if (!confirm(`'${r.label}' ${cfg.roundName}를 삭제할까요? (기록 전체가 사라져요)`)) return
    patchRounds((rs) => { const i = rs.findIndex((x) => x.id === r.id); if (i >= 0) rs.splice(i, 1) })
    setSelId(null)
  }

  /** 현재 보고 있는 표를 PNG 이미지로 저장 — 인쇄 뷰(.print-root)를 그대로 캡처 */
  async function saveImage() {
    if (!current) return
    const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '')
    let fileName: string
    if (cfg.byDay && weekView) {
      // ★ 주간 합계를 보고 있으면 인쇄 뷰(.print-root)도 주간 표라, 요일 기준으로
      //   판정하면 안 된다. 월요일만 비어 있어도 '점수가 없다'며 거부했고 파일명도
      //   '월요일' 로 붙어서, 실제로 담긴 그림(주간 표)과 이름이 어긋났다.
      const any = WEEKDAYS.some((d) => (current.days?.[d] ?? []).some((e) => typeof e.value === 'number'))
      if (!any) {
        alert(`이번 ${cfg.roundName}에 입력된 점수가 없어요.`)
        return
      }
      fileName = `공성전-${safe(current.label)}-주간합계.png`
    } else if (cfg.byDay) {
      const d = WEEKDAYS.includes(day) ? day : WEEKDAYS[0]
      if (!(current.days?.[d] ?? []).some((e) => typeof e.value === 'number')) {
        alert(`${d}요일에 입력된 점수가 없어요.`)
        return
      }
      fileName = `공성전-${safe(current.label)}-${d}요일.png`
    } else {
      if (!current.entries.some((e) => typeof e.value === 'number' || typeof e.mid === 'number')) {
        alert('입력된 딜량이 없어요.')
        return
      }
      fileName = `파괴신-${safe(current.label)}.png`
    }

    const src = document.querySelector('.print-root')
    if (!(src instanceof HTMLElement)) return
    // 인쇄와 같은 스타일로, 폭만 촘촘하게(600px) 렌더해 캡처 — 칸 안 빈 공간 축소.
    // 화면 밖에 배치(주의: opacity:0/visibility:hidden으로 숨기면 html2canvas가 빈 이미지를 만든다)
    const wrap = document.createElement('div')
    wrap.style.cssText = 'position:fixed;left:-10000px;top:0;width:600px;background:#fff;padding:20px;z-index:-1;'
    const clone = src.cloneNode(true) as HTMLElement
    clone.style.display = 'block'
    wrap.appendChild(clone)
    document.body.appendChild(wrap)
    try {
      try { await document.fonts.ready } catch { /* noop */ }
      // 캡처 크기를 표 전체 크기로 명시 — 기본값은 '브라우저 창' 크기라
      // 인원이 많아 표가 창보다 길면 아래가 잘림 (30명 이상에서 발생)
      const w = Math.ceil(wrap.scrollWidth)
      const h = Math.ceil(wrap.scrollHeight)
      const canvas = await html2canvas(wrap, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
        width: w,
        height: h,
        windowWidth: w,
        windowHeight: h,
        scrollX: 0,
        scrollY: 0,
      })
      const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/png'))
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      wrap.remove()
    }
  }

  /** [저장] — 현재 회차/요일의 기록을 통째로 교체 (편집 모드 결과 한 번에 커밋) */
  const saveAll = (list: StatEntry[]) => {
    if (!current) return
    patchRound(current.id, (r) => {
      // ★ 커트라인(cutline·dayCutlines·tierCutlines)은 건드리지 않는다.
      //   통계 화면에서 더 이상 편집하지 않으므로 저장할 값도 없고, 예전처럼
      //   빈 값을 받아 delete 하면 지난 회차에 박혀 있던 기준이 통째로 날아간다.
      //   앞으로의 기준은 [커트라인] 메뉴의 기준표가 담당한다.
      if (cfg.byDay) {
        if (!r.days) r.days = {}
        r.days[day] = list
      } else {
        r.entries = list
      }
    })
  }

  return (
    <div>
      <h1>{cfg.title}</h1>

      {/* 파괴신: 통계/공략 전환 탭 */}
      {guides && (
        <div className="row" style={{ marginBottom: 12 }}>
          <button className={`small ${view === 'stats' ? 'primary' : ''}`} onClick={() => setView('stats')}>📊 통계</button>
          <button className={`small ${view === 'guide' ? 'primary' : ''}`} onClick={() => setView('guide')}>📖 공략</button>
        </div>
      )}

      {guides && view === 'guide' && (
        <>
          <p className="page-desc">파괴신 공략 정리 — 감탱이 작성 ('파괴신 정리 _ 길드공유용' 시트 이관본)</p>
          <div className="toc">
            {guides.map((s) => (
              <button key={s.id} className="small" onClick={() => {
                document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' })
              }}>{s.title}</button>
            ))}
          </div>
          {guides.map((s) => (
            <div className="card" key={s.id} id={s.id}>
              <h2 style={{ marginTop: 0 }}>{s.title}</h2>
              <Markdown text={s.body} />
            </div>
          ))}
        </>
      )}

      {(!guides || view === 'stats') && (
        <>
      <p className="page-desc">{cfg.desc}</p>

      <div className="row" style={{ marginBottom: 12 }}>
        {rounds.map((r) => (
          <button key={r.id} className={`small ${current?.id === r.id ? 'primary' : ''}`} onClick={() => setSelId(r.id)}>
            {r.label}
          </button>
        ))}
        {rounds.length === 0 && <span className="muted">아직 {cfg.roundName}가 없어요.</span>}
        <span className="spacer" />
        {admin ? (
          <button className="primary" onClick={addRound}>+ 새 {cfg.roundName}</button>
        ) : (
          <span className="muted">🔒 입력·수정은 운영진만</span>
        )}
      </div>

      {!current ? (
        <div className="card muted">기록된 {cfg.roundName}가 없어요.{admin ? ` [+ 새 ${cfg.roundName}]로 시작하세요.` : ''}</div>
      ) : (
        <div className="card">
          <div className="row between">
            <div>
              <strong style={{ fontSize: '1.1rem' }}>{current.label}</strong>
              {current.date && <span className="muted" style={{ marginLeft: 8 }}>기록 시작 {current.date}</span>}
            </div>
            <div className="row">
              <button className="small" onClick={() => window.print()}>🖨 표 인쇄</button>
              <button className="small" onClick={() => void saveImage()}>🖼 이미지 저장</button>
              {admin && (
                <>
                  <button className="small" onClick={() => renameRound(current)}>이름변경</button>
                  <button className="small danger" onClick={() => deleteRound(current)}>{cfg.roundName}삭제</button>
                </>
              )}
            </div>
          </div>

          {cfg.byDay && (
            <div className="row" style={{ marginTop: 12, gap: 6 }}>
              {WEEKDAYS.map((d) => {
                const cnt = (current.days?.[d] ?? []).filter((e) => typeof e.value === 'number').length
                return (
                  <button
                    key={d}
                    className={`small ${!weekView && day === d ? 'primary' : ''}`}
                    onClick={() => { setDay(d); setWeekView(false) }}
                  >
                    {d}{cnt ? ` (${cnt})` : ''}
                  </button>
                )
              })}
              {/* 요일과 같은 줄에 둔다 — '어느 요일을 볼까'와 '한 주 전체를 볼까'는
                  같은 층위의 선택이다. 고르는 요일(day)은 그대로 두고 깃발만 세운다. */}
              <button
                className={`small ${weekView ? 'primary' : ''}`}
                style={{ marginLeft: 6 }}
                onClick={() => setWeekView(true)}
              >
                Σ 주간 합계
              </button>
            </div>
          )}

          {cfg.byDay && weekView && (
            <WeekTotals
              round={current}
              prevRound={prevRound}
              roster={roster}
              metric={cfg.metric}
              prevLabel={prevRound?.label}
              hidden={hidden}
            />
          )}
          {/* ★ 주간 합계일 때 EntryTable 을 **떼지 않고 감춘다.** 떼면 그 안의
              editing·draft 가 통째로 사라져서, 점수를 치던 중에 주간 합계를 한 번
              눌러 보면 경고도 없이 전부 날아갔다(주간 표는 저장본만 보므로 방금 친
              값이 거기 보이지도 않는다 — 날린 대가로 얻는 것도 없었다).
              key 에 day 만 들어가므로 이 전환에서는 재마운트도 일어나지 않는다. */}
          <div style={cfg.byDay && weekView ? { display: 'none' } : undefined}>
          <EntryTable
            key={(current.id) + (cfg.byDay ? day : '')}
            roster={roster}
            knownExtra={knownExtra}
            stored={stored}
            metric={cfg.metric}
            admin={admin}
            showJoined={cfg.showJoined}
            hasCutline={cfg.hasCutline}
            cutline={curCutline}
            guide={data.cutlineGuide}
            dayKey={cfg.byDay ? day : undefined}
            dayCutline={cfg.byDay ? current.dayCutlines?.[day] : undefined}
            tierOf={cfg.byDay ? undefined : tierOf}
            tierList={cfg.byDay ? undefined : tierList}
            tierCutlines={tierCutlines}
            heading={cfg.byDay ? `${day}요일 기록` : undefined}
            prevValues={prevValues}
            prevEntries={prevEntries}
            deltaLabel={cfg.deltaLabel}
            showMid={cfg.showMid}
            prevLabel={cfg.prevLabel}
            finalLabel={cfg.finalLabel}
            prevRoundLabel={prevRound?.label}
            prevRanks={prevRanks}
            misses={misses}
            onSaveAll={saveAll}
          />
          </div>
        </div>
      )}

      {current && createPortal(
        <PrintContent kind={kind} cfg={cfg} current={current} prevRound={prevRound} roster={roster} day={day} tierOf={cfg.byDay ? undefined : tierOf} guide={data.cutlineGuide} misses={misses} weekView={cfg.byDay && weekView} hidden={hidden} />,
        document.body,
      )}
        </>
      )}
    </div>
  )
}

/** 이름 병합(길드원+외부) 후 점수 있는 사람만 내림차순 정렬 */
function buildRanked(roster: string[], stored: StatEntry[], hidden?: Set<string>): StatEntry[] {
  const rosterSet = new Set(roster)
  // 외부 처리한 길드원은 표에서 감춘다 — 손으로 넣은 비길드원 이름은 그대로 남는다
  const extra = stored.map((e) => e.name).filter((n) => !rosterSet.has(n) && !hidden?.has(n))
  const map = new Map(stored.map((e) => [e.name, e]))
  // 최종 집계가 없으면 중간집계 기준 (시즌 도중에도 출력 가능)
  const eff = (e: StatEntry) => (typeof e.value === 'number' ? e.value : e.mid)
  return [...roster, ...extra]
    .map((name) => ({ name, ...(map.get(name) ?? {}) } as StatEntry))
    .filter((e) => typeof eff(e) === 'number')
    .sort((a, b) => (eff(b) as number) - (eff(a) as number))
}

/** 집계 기준값 — 최종 우선, 없으면 중간집계 */
function effValue(e: StatEntry): number | undefined {
  return typeof e.value === 'number' ? e.value : e.mid
}


/**
 * 주간 합계 랭킹 (공성전 전용).
 *
 * 요일 표가 '그날 누가 잘했나' 라면 이쪽은 '이번 주 전체로 누가 잘했나' 다.
 * 전 주차의 합계·등수와 나란히 놓아 점수차와 순위변동을 같이 본다.
 *
 * ★ 읽기 전용이다. 여기 숫자는 전부 요일 표에 입력된 값에서 계산해 나오므로,
 *   고치려면 해당 요일로 가서 고쳐야 한다. (EntryTable 을 재사용하지 않는 이유)
 * ★ '참여' 열을 같이 보여준다 — 합계만 놓으면 5일 뛴 사람과 7일 뛴 사람이
 *   구분되지 않아 등수가 사실을 가린다.
 */
function WeekTotals({
  round, prevRound, roster, metric, prevLabel, hidden,
}: {
  round: StatRound
  prevRound?: StatRound
  roster: string[]
  metric: string
  prevLabel?: string
  /** 표에서 감출 이름 (외부 처리한 길드원) */
  hidden?: Set<string>
}) {
  const rows = weekTotals(round, roster, hidden)
  const rank = weekRankMap(rows)
  const prevRows = weekTotals(prevRound, roster, hidden)
  const prevRank = weekRankMap(prevRows)
  const prevTotal = new Map(prevRows.map((r) => [r.name, r.total]))

  const sum = rows.reduce((s, r) => s + r.total, 0)
  const top = rows[0]
  const rosterSet = new Set(roster)
  // 0점인 사람은 표에서 빠지므로(weekTotals), '누가 안 뛰었나' 는 이 타일로만 남는다.
  // 분모는 명단 인원 — 표에 보이는 줄 수로 하면 늘 N/N 이 되어 아무 말도 안 한다.
  const joined = rows.filter((r) => rosterSet.has(r.name)).length

  return (
    <div style={{ marginTop: 14 }}>
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <strong>주간 합계</strong>
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          월~일 {metric}를 사람별로 더한 값이에요. 고치려면 해당 요일에서 고쳐주세요.
        </span>
      </div>

      <div className="stat-tiles" style={{ marginTop: 8 }}>
        <div className="stat-tile"><div className="num">{joined}<span style={{ fontSize: '0.9rem', color: 'var(--text-3)' }}>/{roster.length}</span></div><div className="label">참여 인원</div></div>
        <div className="stat-tile"><div className="num">{fmt(sum)}</div><div className="label">주간 {metric} 합계</div></div>
        <div className="stat-tile"><div className="num" style={{ fontSize: '1.15rem' }}>{top ? top.name : '-'}</div><div className="label">주간 1위 ({fmt(top?.total)})</div></div>
      </div>

      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="stat-table">
          <thead>
            <tr>
              <th style={{ width: 58 }}>순위</th>
              <th>길드원</th>
              <th style={{ width: 62 }}>참여</th>
              <th style={{ textAlign: 'right' }}>
                전 주
                {prevLabel && <span className="muted" style={{ fontWeight: 400, fontSize: '0.75rem' }}> ({prevLabel})</span>}
              </th>
              <th style={{ textAlign: 'right' }}>주간 합계</th>
              <th style={{ width: 150 }}>전주 대비</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="muted">[길드원] 메뉴에 등록된 사람이 없어요.</td></tr>
            )}
            {rows.map((r) => {
              const cur = rank.get(r.name)
              return (
                /* ★ 행에 row-fail(빨강)을 쓰지 않는다. 이 저장소에서 그 색은 요일 표·홈
                     어디서나 '커트라인 미달' 한 가지 뜻이다. 여기에 '미참여' 로 칠하면
                     같은 화면에서 빨간 줄이 두 가지를 가리키게 되고(진짜 미달자는 하얗게
                     남는다), 인쇄본에는 색이 안 붙어 화면과 인쇄물이 갈렸다.
                     미참여는 '참여 0/7' 칸이 빨갛게 드러낸다. */
                <tr key={r.name}>
                  <td>
                    <b>{cur ?? '-'}</b>
                    <div style={{ marginTop: 1 }}><RankMove prev={prevRank.get(r.name)} cur={cur} /></div>
                  </td>
                  <td>
                    <b>{r.name}</b>
                    {!rosterSet.has(r.name) && <span className="muted" style={{ marginLeft: 4, fontSize: '0.75rem' }}>(외부)</span>}
                  </td>
                  <td>
                    <span className={r.played === WEEKDAYS.length ? 'delta up' : 'delta'}>
                      {r.played}<span style={{ fontWeight: 400, opacity: 0.6 }}>/{WEEKDAYS.length}</span>
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }} className="num-tab muted">{fmt(prevTotal.get(r.name))}</td>
                  <td style={{ textAlign: 'right' }}><b className="num-tab">{fmt(r.total)}</b></td>
                  <td><Diff prev={prevTotal.get(r.name)} cur={r.total} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * 그 목록에서의 등수 — 점수 내림차순, 동점은 같은 등수.
 * EntryTable 의 rankOf 와 같은 규칙이어야 순위변동이 어긋나지 않는다.
 */
function rankMapOf(list: StatEntry[]): Map<string, number> {
  const vals = list.map((e) => effValue(e)).filter((v): v is number => typeof v === 'number')
  const m = new Map<string, number>()
  for (const e of list) {
    const v = effValue(e)
    if (typeof v === 'number') m.set(e.name, vals.filter((o) => o > v).length + 1)
  }
  return m
}

/**
 * 전체 기록 누적 미참여 횟수.
 *
 * 슬롯 = 점수가 한 명이라도 들어간 (주차 × 요일). 아직 입력 전인 요일은 슬롯으로
 * 안 센다 — 안 그러면 만들어만 둔 주차가 전원 미참여로 찍힌다.
 *
 * ★ 그 사람 기록이 **처음 등장한 슬롯부터** 센다. 길드에 없던 주에 '미참여'할 수는
 *   없는데, 맨 앞부터 세면 늦게 들어온 사람이 수십 회로 찍혀 숫자가 뜻을 잃는다.
 *   그래서 분모(of)도 같이 돌려준다 — '12/70' 처럼 모수를 보여야 읽힌다.
 *
 * 공성전은 요일마다 별개 전투라 슬롯이 주차×요일이다. 파괴신은 시즌 하나가
 * 슬롯이지만, 시즌 수가 적어 이 열은 공성전에서만 쓴다.
 */
function missMapOf(rounds: StatRound[], byDay: boolean): Map<string, { miss: number; of: number }> {
  const slots: Set<string>[] = []
  for (const r of rounds) {
    const lists = byDay ? WEEKDAYS.map((d) => r.days?.[d] ?? []) : [r.entries ?? []]
    for (const list of lists) {
      const names = list.filter((e) => typeof e.value === 'number').map((e) => e.name)
      if (names.length) slots.push(new Set(names))
    }
  }
  const firstAt = new Map<string, number>()
  slots.forEach((s, i) => s.forEach((n) => { if (!firstAt.has(n)) firstAt.set(n, i) }))
  const out = new Map<string, { miss: number; of: number }>()
  firstAt.forEach((start, name) => {
    let miss = 0
    for (let i = start; i < slots.length; i++) if (!slots[i].has(name)) miss++
    out.set(name, { miss, of: slots.length - start })
  })
  return out
}

/** 점수차 텍스트 (인쇄용, 색 없이 ▲/▼) */
function diffText(prev?: number, cur?: number): string {
  if (typeof cur !== 'number' || typeof prev !== 'number') return '—'
  const d = cur - prev
  return d === 0 ? '±0' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toLocaleString()}`
}

/** 순위 변동 텍스트 (인쇄용) */
function moveText(prev?: number, cur?: number): string {
  if (typeof cur !== 'number' || typeof prev !== 'number') return '—'
  const d = prev - cur
  return d === 0 ? '—' : `${d > 0 ? '▲' : '▼'}${Math.abs(d)}`
}

/** 등락 % 텍스트 (인쇄용, 색 없이 ▲/▼) */
function pctText(prev?: number, cur?: number): string {
  if (typeof cur !== 'number' || typeof prev !== 'number' || prev === 0) return '—'
  const p = ((cur - prev) / Math.abs(prev)) * 100
  if (Math.abs(p) < 0.05) return '0%'
  return `${p > 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(1)}%`
}
/**
 * 차이 + % 한 칸에 — 화면의 Diff 와 **글자까지** 같은 모양 (파괴신 인쇄본).
 * pctText 를 빌려 쓰면 아주 작은 변화가 '0%' 로 떨어져 화면('0.0%')과 갈렸다.
 */
function diffPctText(prev?: number, cur?: number): string {
  const d = diffText(prev, cur)
  if (d === '—' || d === '±0' || !prev) return d
  const p = Math.abs((((cur as number) - prev) / Math.abs(prev)) * 100)
  return `${d} (${p.toFixed(1)}%)`
}
/** 인쇄본 중간집계 칸 — 1회 점수 (N회), 횟수를 모르면 총 딜량 (총) */
function midPrintText(e: StatEntry): string {
  const ph = perHit(e)
  if (ph !== undefined) return `${fmt(ph)} (${e.midHits}회)`
  return typeof e.mid === 'number' ? `${fmt(e.mid)} (총)` : '-'
}


/** 화면엔 숨김(.print-root), 인쇄 시에만 보이는 표. body에 portal로 렌더. */
function PrintContent({
  kind,
  cfg,
  current,
  prevRound,
  roster,
  day,
  weekView,
  tierOf,
  guide,
  misses,
  hidden,
}: {
  kind: Kind
  cfg: (typeof CFG)[Kind]
  current: StatRound
  prevRound?: StatRound
  roster: string[]
  /** 공성전: 화면에서 선택된 요일 — 그 요일만 인쇄 */
  day?: string
  /** 공성전: 화면이 주간 합계면 인쇄도 주간 합계로 */
  weekView?: boolean
  /** 파괴신: 길드원 이름 → 등급 */
  tierOf?: Map<string, string>
  /** 공성전: 전체 기록 누적 미참여 */
  misses?: Map<string, { miss: number; of: number }>
  /** 표에서 감출 이름 (외부 처리한 길드원) */
  hidden?: Set<string>
  /** [커트라인] 메뉴의 기준표 — 화면 표와 같은 판정을 쓰도록 함께 넘긴다 */
  guide?: CutlineGuide
}) {
  const printedAt = todayLocal()
  const guildName = useGuildName()

  if (cfg.byDay && weekView) {
    // 화면이 주간 합계면 인쇄도 주간 합계로 — 표를 뽑아 공유하는 게 이 화면의 주 용도다
    const rows = weekTotals(current, roster, hidden)
    const rank = weekRankMap(rows)
    const prevRows = weekTotals(prevRound, roster, hidden)
    const prevRank = weekRankMap(prevRows)
    const prevTotal = new Map(prevRows.map((r) => [r.name, r.total]))
    const joined = rows.filter((r) => roster.includes(r.name)).length
    return (
      <div className="print-root">
        <div className="print-head">
          <h2>{cfg.title} — {current.label} · 주간 합계</h2>
          <span className="print-meta">출력일 {printedAt} · {guildName}</span>
        </div>
        {rows.length === 0 ? (
          <p>이번 {cfg.roundName}에 입력된 점수가 없어요.</p>
        ) : (
          <div className="print-block">
            <h3>주간 합계 (월~일)</h3>
            <div className="print-sub">
              참여 {joined}/{roster.length}명 · 합계 {fmt(rows.reduce((s, r) => s + r.total, 0))}
              {prevRound && <> · 전 주: {prevRound.label}</>}
            </div>
            <table className="print-table">
              <thead><tr><th>순위</th><th>변동</th><th>길드원</th><th>참여</th><th>전 주</th><th>주간 합계</th><th>점수차</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const cur = rank.get(r.name)
                  return (
                    <tr key={r.name}>
                      <td>{cur ?? '-'}</td>
                      <td>{moveText(prevRank.get(r.name), cur)}</td>
                      <td>{r.name}</td>
                      <td className="num-tab">{r.played}/{WEEKDAYS.length}</td>
                      <td className="num-tab">{fmt(prevTotal.get(r.name))}</td>
                      <td className="num-tab">{fmt(r.total)}</td>
                      <td className="num-tab">{diffText(prevTotal.get(r.name), r.total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  if (cfg.byDay) {
    // 공성전 — 화면에서 보고 있는 요일 하나만 인쇄 (지난주 같은 요일 대비 %)
    const d = day && WEEKDAYS.includes(day) ? day : WEEKDAYS[0]
    const ranked = buildRanked(roster, current.days?.[d] ?? [], hidden)
    const prevMap = new Map(
      (prevRound?.days?.[d] ?? []).filter((e) => typeof e.value === 'number').map((e) => [e.name, e.value as number]),
    )
    const prevRankMap = rankMapOf(prevRound?.days?.[d] ?? [])
    const total = ranked.reduce((s, e) => s + (e.value as number), 0)
    // 요일별 커트라인 — 회차 저장값 → [커트라인] 기준표 → 주차 공통값
    const dayCut = current.dayCutlines?.[d] ?? guide?.siegeByDay?.[d] ?? current.cutline
    const isFail = (e: StatEntry) => typeof dayCut === 'number' && typeof e.value === 'number' && e.value <= dayCut
    return (
      <div className="print-root">
        <div className="print-head">
          <h2>{cfg.title} — {current.label} · {d}요일</h2>
          <span className="print-meta">출력일 {printedAt} · {guildName}</span>
        </div>
        {ranked.length === 0 ? (
          <p>{d}요일에 입력된 점수가 없어요.</p>
        ) : (
          <div className="print-block">
            <h3>{d}요일</h3>
            <div className="print-sub">
              {ranked.length}명 · 합계 {fmt(total)}
              {typeof dayCut === 'number' && <> · 커트라인 {fmt(dayCut)} 이하 미달</>}
            </div>
            <table className="print-table">
              <thead><tr><th>순위</th><th>변동</th><th>길드원</th><th>전 주</th><th>이번 주</th><th>점수차</th><th>{cfg.deltaLabel}</th><th>미참여</th></tr></thead>
              <tbody>
                {ranked.map((e, i) => {
                  const m = misses?.get(e.name)
                  return (
                  <tr key={e.name}>
                    <td>{i + 1}</td>
                    <td>{moveText(prevRankMap.get(e.name), i + 1)}</td>
                    <td className={isFail(e) ? 'cell-fail' : ''}>{e.name}</td>
                    <td className="num-tab">{fmt(prevMap.get(e.name))}</td>
                    <td className="num-tab">{fmt(e.value)}</td>
                    <td className="num-tab">{diffText(prevMap.get(e.name), e.value)}</td>
                    <td>{pctText(prevMap.get(e.name), e.value)}</td>
                    <td className="num-tab">{m ? `${m.miss}/${m.of}` : '—'}</td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // 파괴신 — 전 시즌 · 이번 시즌 · 상승% 한 표에
  const curRanked = buildRanked(roster, current.entries, hidden)
  const prevMap = new Map(
    (prevRound?.entries ?? []).filter((e) => typeof e.value === 'number').map((e) => [e.name, e.value as number]),
  )
  // 중간집계 대비용 — 전 시즌 중간집계와 그때 친 횟수
  const prevEntryMap = new Map((prevRound?.entries ?? []).map((e) => [e.name, e]))
  const curTotal = curRanked.reduce((s, e) => s + (effValue(e) as number), 0)
  const hasMid = curRanked.some((e) => typeof e.mid === 'number')
  const unit = midUnit(curRanked)
  // 커트라인 이하 미달자 — 회차에 저장된 값 → [커트라인] 기준표 → 시즌 기본값
  const tierCuts = current.tierCutlines ?? {}
  const cutFor = (name: string) => {
    const t = tierOf?.get(name)
    const tc = t !== undefined ? tierCuts[t] : undefined
    if (typeof tc === 'number') return tc
    const gt = t !== undefined ? guide?.destroyerByTier?.[t] : undefined
    if (typeof gt === 'number') return gt
    return current.cutline
  }
  const isFail = (e: StatEntry) => {
    const c = cutFor(e.name)
    return typeof c === 'number' && typeof effValue(e) === 'number' && (effValue(e) as number) <= c
  }
  /** 인쇄용 등급 커트라인 — 화면과 같은 순서(회차 저장값 → 기준표) */
  const tierCutOf = (t: string): number | undefined => {
    const tc = tierCuts[t]
    if (typeof tc === 'number') return tc
    const gt = guide?.destroyerByTier?.[t]
    return typeof gt === 'number' ? gt : undefined
  }
  const usedTiers = [...new Set(curRanked.map((e) => tierOf?.get(e.name)).filter((t): t is string => !!t && typeof tierCutOf(t) === 'number'))].sort()
  return (
    <div className="print-root">
      <div className="print-head">
        <h2>{cfg.title}</h2>
        <span className="print-meta">출력일 {printedAt} · {guildName}</span>
      </div>
      <div className="print-block">
        <h3>이번 시즌: {current.label}</h3>
        <div className="print-sub">
          {curRanked.length}명 · 합계 {fmt(curTotal)}
          {prevRound && <> · 전 시즌: {prevRound.label}</>}
          {(usedTiers.length > 0 || typeof current.cutline === 'number') && (
            <> · 커트라인 {usedTiers.map((t) => `${t} ${fmt(tierCutOf(t))}`).join(' / ')}
              {typeof current.cutline === 'number' && `${usedTiers.length ? ' / ' : ''}${usedTiers.length ? '기본 ' : ''}${fmt(current.cutline)}`} 이하 미달</>
          )}
          {/* 뽑아서 돌리는 표라 단위를 표 밖에도 적어 둔다 — 숫자만 보면 총계로 읽힌다 */}
          {hasMid && (unit === '총'
            ? <> · 중간집계는 총 딜량(친 횟수 기록 없음)</>
            : <> · 중간집계는 1회 점수(총 딜량 ÷ 친 횟수){unit === '1회·총' && ', 횟수가 없는 사람은 총 딜량(총)'}</>)}
        </div>
        <table className="print-table">
          <thead><tr><th>순위</th><th>길드원</th><th>전 시즌</th>{hasMid && <th>중간집계({unit})</th>}<th>이번 시즌 집계</th><th>{cfg.deltaLabel}</th>{hasMid && <th>중간집계 대비</th>}</tr></thead>
          <tbody>
            {curRanked.map((e, i) => (
              <tr key={e.name}>
                <td>{i + 1}</td>
                <td className={isFail(e) ? 'cell-fail' : ''}>
                  {e.name}
                  {tierOf?.get(e.name) && <span className="print-tier">{tierShort(tierOf.get(e.name))}</span>}
                </td>
                <td className="num-tab">{fmt(prevMap.get(e.name))}</td>
                {hasMid && <td className="num-tab">{midPrintText(e)}</td>}
                <td className="num-tab">{fmt(e.value)}</td>
                {/* 화면과 같은 규칙 — 시즌집계는 최종끼리, 중간집계는 중간집계끼리(1회 점수) */}
                <td className="num-tab">{diffPctText(prevMap.get(e.name), e.value)}</td>
                {hasMid && <td className="num-tab">{(() => {
                  const c = midCompare(prevEntryMap.get(e.name), e)
                  return diffPctText(c.prev, c.cur)
                })()}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * 파괴신 중간집계 칸 (보기) — **1회 점수**(총 딜량 ÷ 친 횟수)를 앞에, 횟수를 옆에.
 * 횟수를 모르는 기록은 나눌 수 없어서 총 딜량을 그대로 두고 '총' 을 붙인다 —
 * 같은 칸에 1회 점수와 총계가 섞여 있어도 어느 쪽인지 구분되게.
 */
function MidCell({ e }: { e: StatEntry }) {
  const ph = perHit(e)
  if (ph !== undefined) {
    return (
      <span className="num-tab" title={`총 ${fmt(e.mid)} ÷ ${e.midHits}회`}>
        {fmt(ph)}<span className="mid-hits">{e.midHits}회</span>
      </span>
    )
  }
  if (typeof e.mid !== 'number') return <span className="num-tab">-</span>
  return (
    <span className="num-tab" title="친 횟수가 없어 1회 점수를 못 냈어요 — 총 딜량입니다. [편집]에서 횟수를 넣으면 1회 점수로 바뀌어요.">
      {fmt(e.mid)}<span className="mid-hits">총</span>
    </span>
  )
}

/** 중간집계 대비 — 전 시즌 중간집계와의 차이 (단위 규칙은 lib/stat 의 midCompare) */
function MidDiff({ prev, cur }: { prev?: StatEntry; cur: StatEntry }) {
  const c = midCompare(prev, cur)
  if (c.mixed) {
    return (
      <span className="muted" title={`${perHit(prev) === undefined ? '전 시즌' : '이번 시즌'} 중간집계에 친 횟수가 없어 1회 점수끼리 비교할 수 없어요. 그 시즌 [편집]에서 횟수를 넣으면 비교돼요.`}>—</span>
    )
  }
  return (
    <span title={typeof c.prev === 'number' ? `전 시즌 중간집계 ${fmt(c.prev)}${perHit(prev) !== undefined ? ` (1회 · ${prev?.midHits}회 침)` : ' (총)'}` : undefined}>
      <Diff prev={c.prev} cur={c.cur} />
    </span>
  )
}

function EntryTable({
  roster,
  knownExtra,
  stored,
  metric,
  admin,
  showJoined,
  hasCutline,
  cutline,
  guide,
  dayKey,
  dayCutline,
  tierOf,
  tierList,
  tierCutlines,
  heading,
  prevValues,
  prevEntries,
  prevRanks,
  misses,
  deltaLabel,
  showMid,
  prevLabel,
  finalLabel,
  prevRoundLabel,
  onSaveAll,
}: {
  roster: string[]
  /**
   * 외부 처리한 길드원 이름. 두 가지로 쓴다 —
   *   1) 표에서 **감춘다** (지금 길드에 없는 사람이 랭킹·합계에 끼지 않게)
   *   2) 캡처 판독 후보로는 계속 넘긴다 (복귀 처리를 깜빡해도 그 행이 엉뚱한
   *      길드원 이름으로 붙지 않게)
   */
  knownExtra?: string[]
  stored: StatEntry[]
  metric: string
  admin: boolean
  showJoined: boolean
  hasCutline: boolean
  cutline?: number
  /** [커트라인] 메뉴의 기준표 — 회차에 저장된 값이 없을 때 여기서 가져온다 */
  guide?: CutlineGuide
  /** 공성전: 지금 보고 있는 요일 (기준표의 요일별 커트라인을 찾는 키) */
  dayKey?: string
  /** 공성전: 그 회차에 저장된 그 요일의 커트라인 — 기준표보다 우선한다 */
  dayCutline?: number
  /** 길드원 이름 → 등급 (파괴신) */
  tierOf?: Map<string, string>
  /** 등급 목록 (파괴신) */
  tierList?: string[]
  /** 등급별 커트라인 (파괴신) */
  tierCutlines?: Record<string, number>
  heading?: string
  prevValues: Map<string, number>
  /** 전 시즌 기록 (파괴신) — 중간집계 대비가 전 시즌 중간집계·횟수를 본다 */
  prevEntries?: Map<string, StatEntry>
  /** 전 주 같은 요일의 등수 — 넘기면 순위변동을 보여준다 (공성전) */
  prevRanks?: Map<string, number>
  /** 전체 기록 누적 미참여 — 넘기면 열이 생긴다 (공성전) */
  misses?: Map<string, { miss: number; of: number }>
  deltaLabel: string
  showMid: boolean
  prevLabel: string
  finalLabel: string
  prevRoundLabel?: string
  onSaveAll: (list: StatEntry[]) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, Partial<StatEntry>>>({})
  const [localExtra, setLocalExtra] = useState<string[]>([])
  /** 편집 중 표에 쓸 이름 순서 (점수순으로 얼려 둔 값) */
  const [editOrder, setEditOrder] = useState<string[]>([])
  /** 편집 중 ✕로 지운 외부(비명단) 이름 — 저장 시 기록에서 제거됨 */
  const [removedExtra, setRemovedExtra] = useState<string[]>([])
  const [newName, setNewName] = useState('')
  const [importing, setImporting] = useState(false)

  const useTiers = !!tierList?.length

  const rosterSet = new Set(roster)
  const storedMap = new Map(stored.map((e) => [e.name, e]))
  // 외부 처리한 길드원(knownExtra)은 여기서 빠진다 — 점수는 저장돼 있지만 표에 안 올린다.
  // 손으로 적어 넣은 비길드원 이름은 knownExtra 에 없으므로 그대로 (외부) 행으로 남는다.
  const hiddenSet = new Set(knownExtra ?? [])
  const storedExtra = stored.map((e) => e.name)
    .filter((n) => !rosterSet.has(n) && !removedExtra.includes(n) && !hiddenSet.has(n))
  const baseNames = [...roster, ...storedExtra, ...localExtra.filter((n) => !rosterSet.has(n) && !storedExtra.includes(n))]

  const valOf = (name: string): Partial<StatEntry> => (editing ? draft[name] ?? {} : storedMap.get(name) ?? {})
  const rows: StatEntry[] = baseNames.map((name) => ({ name, ...valOf(name) }))

  // 집계 기준값 — 최종이 있으면 최종, 없으면 중간집계 (시즌 도중에도 순위·합계가 나오게)
  const effOf = (e: StatEntry) => (typeof e.value === 'number' ? e.value : showMid ? e.mid : undefined)
  const scored = rows.filter((e) => typeof effOf(e) === 'number')
  const total = scored.reduce((s, e) => s + (effOf(e) as number), 0)
  const midCount = rows.filter((e) => typeof e.mid === 'number').length
  const finalCount = rows.filter((e) => typeof e.value === 'number').length
  const joinedCount = rows.filter((e) => e.joined).length
  const ranked = [...rows].sort((a, b) => (effOf(b) ?? -Infinity) - (effOf(a) ?? -Infinity))
  const top = scored.length ? ranked[0] : undefined

  /**
   * 순위 숫자 — 표에 놓인 자리가 아니라 '지금 값'으로 매긴다.
   * 편집 중에는 표 순서를 얼려 두기 때문에(아래 참고), 자리로 번호를 매기면
   * 방금 점수를 넣은 사람이 맨 아래 자리의 번호를 달고 있게 된다.
   * 동점이면 같은 순위가 나오는데, 자리 번호보다 이쪽이 사실에 가깝다.
   */
  const rankOf = (e: StatEntry): number | undefined => {
    const v = effOf(e)
    if (typeof v !== 'number') return undefined
    return rows.filter((o) => (effOf(o) ?? -Infinity) > v).length + 1
  }

  /**
   * 편집 중 표 순서. 점수순으로 보되 **타이핑 중에는 얼려 둔다** —
   * 값이 바뀔 때마다 다시 정렬하면 한 글자 칠 때마다 행이 뛰어다닌다.
   * 편집 시작·캡처 적용·[다시 정렬] 때만 새로 잡는다.
   * 편집 중에 추가된 외부 이름은 순서 목록에 없으므로 뒤로 보낸다.
   */
  const orderIdx = new Map(editOrder.map((n, i) => [n, i]))
  const editRows = editOrder.length
    ? [...rows].sort((a, b) => (orderIdx.get(a.name) ?? Infinity) - (orderIdx.get(b.name) ?? Infinity))
    : rows
  const displayRows = editing ? editRows : ranked

  // 커트라인은 회차에 저장된 값 → [커트라인] 기준표 → 회차 기본값 순으로 찾는다.
  // (통계 화면에서는 더 이상 편집하지 않으므로 편집/보기 상태를 구분하지 않는다)
  //
  // ★ 예전엔 공성전에서 **기준표를 먼저** 봤다 — 바로 위 문장과도, 정본인
  //   lib/stat.tsx 의 cutlineFor 와도 반대였다. 그래서 회차에 dayCutlines 가 박힌
  //   옛 주차에서 같은 점수가 이 표에서는 미달, 인쇄본에서는 통과로
  //   갈렸다(같은 화면 안에서 숫자가 안 맞았다). 정본 순서로 되돌린다 —
  //   지난 회차에는 그때 실제로 적용했던 기준이 박혀 있고, 지금 기준표로 덮으면
  //   과거 미달 판정이 소급해서 바뀐다는 게 그 순서의 이유다.
  const effCutline = cutline
  const effTierCuts = tierCutlines ?? {}
  /** 이 사람에게 적용되는 커트라인 */
  const cutFor = (name: string): number | undefined => {
    const t = tierOf?.get(name)
    const tc = t !== undefined ? effTierCuts[t] : undefined
    if (typeof tc === 'number') return tc
    const gt = t !== undefined ? guide?.destroyerByTier?.[t] : undefined
    if (typeof gt === 'number') return gt
    // 공성전 — 회차 저장값(dayCutline)이 기준표보다 앞선다
    if (dayKey) {
      if (typeof dayCutline === 'number') return dayCutline
      const gd = guide?.siegeByDay?.[dayKey]
      if (typeof gd === 'number') return gd
    }
    return effCutline
  }
  /** 등급 하나에 적용되는 커트라인 (표시용) */
  const cutForTier = (t: string): number | undefined => {
    const tc = effTierCuts[t]
    if (typeof tc === 'number') return tc
    const gt = guide?.destroyerByTier?.[t]
    return typeof gt === 'number' ? gt : undefined
  }
  /** 등급이 없는 사람에게 적용되는 값 (표시용) */
  const baseCut = dayKey
    ? (dayCutline ?? guide?.siegeByDay?.[dayKey] ?? effCutline)
    : effCutline
  // 실제로 적용되는 커트라인이 한 명이라도 있으면 판정을 보여 준다
  const showVerdict = hasCutline && rows.some((e) => typeof cutFor(e.name) === 'number')
  const isFail = (e: StatEntry) => {
    if (!showVerdict) return false
    const c = cutFor(e.name)
    return typeof c === 'number' && typeof effOf(e) === 'number' && (effOf(e) as number) <= c
  }
  const failCount = rows.filter(isFail).length

  // 공성전도 '전 주' 열을 쓴다 — 예전엔 파괴신(showMid)만 썼고 공성전은 인쇄본에만 있었다.
  const showPrev = showMid || !!prevRanks
  // 고정 5칸 = 순위 · 길드원 · 점수 · 등락 · 메모
  const cols = 5 + (showPrev ? 1 : 0) + (showMid ? 2 : 0) + (misses ? 1 : 0)
    + (showJoined ? 1 : 0) + (showVerdict ? 1 : 0) + (editing ? 1 : 0)

  /** 주어진 값 기준 점수순 이름 배열 — 편집 표의 순서를 잡는 데 쓴다 */
  function rankedNames(source: Record<string, Partial<StatEntry>>, names: string[]): string[] {
    const val = (n: string) => {
      const e = source[n] ?? {}
      return typeof e.value === 'number' ? e.value : showMid && typeof e.mid === 'number' ? e.mid : undefined
    }
    return [...names].sort((a, b) => (val(b) ?? -Infinity) - (val(a) ?? -Infinity))
  }

  function startEdit() {
    const d: Record<string, Partial<StatEntry>> = {}
    // ★ 여기는 필드를 **골라** 담는다. StatEntry 에 칸을 새로 만들면 이 목록에도 넣을 것 —
    //   빠지면 저장된 값이 편집 초안에 안 실리고, [편집]→[저장]만 눌러도 조용히 사라진다.
    //   midHits(친 횟수)가 실제로 그렇게 빠질 뻔했다.
    for (const name of baseNames) {
      const e = storedMap.get(name)
      if (e) d[name] = { value: e.value, mid: e.mid, midHits: e.midHits, joined: e.joined, memo: e.memo }
    }
    setDraft(d)
    setLocalExtra([])
    setRemovedExtra([])
    setEditOrder(rankedNames(d, baseNames))
    setEditing(true)
  }
  const setField = (name: string, patch: Partial<StatEntry>) => setDraft((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }))
  function save() {
    const list = baseNames
      .map((name) => ({ name, ...(draft[name] ?? {}) } as StatEntry))
      .filter((e) => typeof e.value === 'number' || typeof e.mid === 'number' || e.joined || (e.memo ?? '').trim())
    onSaveAll(list)
    setEditing(false)
    setLocalExtra([])
    setRemovedExtra([])
    setEditOrder([])
  }
  function cancel() {
    setEditing(false)
    setLocalExtra([])
    setRemovedExtra([])
    setDraft({})
    setEditOrder([])
  }
  function addExternal() {
    const n = newName.trim()
    setNewName('')
    if (!n || baseNames.includes(n)) return
    setLocalExtra((prev) => [...prev, n])
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        {heading ? <div className="cc-sec">{heading}</div> : <span />}
        {admin && !editing && <button className="primary small" onClick={startEdit}>✏️ {metric} 입력·수정</button>}
        {admin && editing && (
          <span className="row" style={{ gap: 8 }}>
            <button className="small" onClick={() => setImporting(true)}>📷 캡처에서 읽기</button>
            {/* 손으로 입력하면 순서를 얼려 둔 채로 두다가, 다 넣고 나서 이걸로 정렬 */}
            <button className="small" title="지금 입력된 값 기준으로 표를 점수순으로 다시 정렬합니다"
              onClick={() => setEditOrder(rankedNames(draft, baseNames))}>↕ 점수순 다시 정렬</button>
            <span className="delta up" style={{ fontSize: '0.85rem' }}>✏️ 편집 중 — 아래 [저장]을 눌러야 반영돼요</span>
          </span>
        )}
      </div>

      {importing && (
        <ScoreImport
          roster={baseNames}
          extraNames={(knownExtra ?? []).filter((n) => !baseNames.includes(n))}
          metric={metric}
          // 파괴신은 중간집계·최종 두 칸이라 어디에 넣을지 물어본다.
          // 시즌 도중 캡처가 최종 집계로 잘못 들어가면 순위·미달이 통째로 어긋난다.
          targets={showMid ? [{ key: 'mid', label: '중간집계' }, { key: 'value', label: finalLabel }] : undefined}
          onClose={() => setImporting(false)}
          onApply={(values, target) => {
            const next = { ...draft }
            for (const { name, value, count } of values) {
              next[name] = target === 'mid'
                // ★ 중간집계와 친 횟수는 같은 캡처에서 나온 짝이라 같이 갈아 끼운다.
                //   새 캡처에 횟수가 없으면 지운다 — 안 그러면 옛 횟수가 새 딜량 옆에
                //   붙어 남아서 '이 딜량을 이 횟수로 냈다' 는 거짓이 된다.
                ? { ...next[name], mid: value, midHits: count }
                : { ...next[name], value }
            }
            setDraft(next)
            // 캡처를 넣었으면 순위가 확 바뀐다 — 이때는 표 순서를 새로 잡아 준다
            setEditOrder(rankedNames(next, baseNames))
          }}
        />
      )}

      {/* 커트라인 입력칸은 없앴다 — [커트라인] 메뉴의 기준표 한 곳에서만 관리한다.
          등급이 늘면서 편집할 때마다 입력칸이 10칸 넘게 쌓여 점수 입력을 밀어냈다. */}
      {hasCutline && editing && (
        <p className="cutline-note">
          커트라인은 <b>[커트라인]</b> 메뉴의 기준표를 따릅니다.
          {' '}지난 회차에 따로 저장된 값이 있으면 그 회차는 그 값을 그대로 씁니다.
        </p>
      )}
      {/* 실제로 적용 중인 커트라인을 보여 준다 — 회차 저장값이든 기준표에서 온 값이든
          사람이 보기엔 '지금 이 표에 적용된 값'이 중요하다 */}
      {hasCutline && !editing && showVerdict && (
        <div className="muted" style={{ marginBottom: 10 }}>
          커트라인{' '}
          {useTiers && tierList!.filter((t) => typeof cutForTier(t) === 'number').map((t) => (
            <span key={t}>
              {t} <b className="num-tab" style={{ color: 'var(--text)' }}>{fmt(cutForTier(t))}</b>
              {' / '}
            </span>
          ))}
          {typeof baseCut === 'number' && (
            <span>{useTiers ? '기본 ' : ''}<b className="num-tab" style={{ color: 'var(--text)' }}>{fmt(baseCut)}</b></span>
          )}
          {' '}{metric} 이하는 <span className="badge lose">미달</span>
        </div>
      )}

      <div className="stat-tiles stagger" style={{ margin: '0 0 6px' }}>
        {showMid ? (
          <>
            <div className="stat-tile"><div className="num">{midCount}<span style={{ fontSize: '0.9rem', color: 'var(--text-3)' }}>/{rows.length}</span></div><div className="label">중간집계 입력</div></div>
            <div className="stat-tile"><div className="num">{finalCount}<span style={{ fontSize: '0.9rem', color: 'var(--text-3)' }}>/{rows.length}</span></div><div className="label">최종 집계 입력</div></div>
          </>
        ) : (
          <div className="stat-tile"><div className="num">{scored.length}<span style={{ fontSize: '0.9rem', color: 'var(--text-3)' }}>/{rows.length}</span></div><div className="label">{metric} 입력</div></div>
        )}
        {showJoined && <div className="stat-tile"><div className="num">{joinedCount}</div><div className="label">참여 인원</div></div>}
        {showVerdict && <div className="stat-tile"><div className="num" style={{ color: failCount ? 'var(--danger)' : 'var(--ok)' }}>{failCount}</div><div className="label">미달 인원</div></div>}
        <div className="stat-tile"><div className="num">{fmt(total)}</div><div className="label">{metric} 합계</div></div>
        <div className="stat-tile"><div className="num" style={{ fontSize: '1.15rem' }}>{top ? top.name : '-'}</div><div className="label">{metric} 1위 ({fmt(top ? effOf(top) : undefined)})</div></div>
      </div>

      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="stat-table">
          <thead>
            <tr>
              <th style={{ width: prevRanks && !editing ? 58 : 44 }}>{editing ? '#' : '순위'}</th>
              <th>길드원</th>
              {showPrev && <th style={{ textAlign: 'right' }}>{prevLabel}{prevRoundLabel ? <span className="muted" style={{ fontWeight: 400, fontSize: '0.75rem' }}> ({prevRoundLabel})</span> : ''}</th>}
              {/* 보기: 1회 점수(총 ÷ 횟수) / 편집: 캡처에 찍히는 그대로 총계와 횟수를 넣는다 */}
              {showMid && (
                <th style={{ textAlign: 'right' }} title={editing ? undefined : '총 딜량 ÷ 친 횟수. 횟수가 없는 기록은 총 딜량에 \'총\' 이 붙어요'}>
                  중간집계
                  <span className="muted" style={{ fontWeight: 400, fontSize: '0.75rem' }}>{editing ? ' (총 · 횟수)' : ` (${midUnit(rows)})`}</span>
                </th>
              )}
              <th style={{ textAlign: 'right' }}>{showMid ? finalLabel : metric}</th>
              <th style={{ width: showMid ? 150 : 100 }} title={showMid ? '이번 시즌 집계 − 전 시즌 집계' : undefined}>{deltaLabel}</th>
              {showMid && <th style={{ width: 150 }} title="이번 시즌 중간집계 − 전 시즌 중간집계 (1회 점수끼리)">중간집계 대비</th>}
              {showVerdict && <th style={{ width: 64 }}>판정</th>}
              {showJoined && <th style={{ width: 60 }}>참여</th>}
              {misses && <th style={{ width: 84 }} title="전체 기록 누적 — 점수가 안 들어간 요일 수 / 그 사람 첫 기록 이후 전체 요일 수">미참여</th>}
              <th>메모</th>
              {editing && <th style={{ width: 44 }} />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={cols} className="muted">[길드원] 메뉴에 등록된 사람이 없어요. 먼저 길드원을 등록해주세요.</td></tr>
            )}
            {displayRows.map((e, i) => (
              <tr key={e.name} className={isFail(e) ? 'row-fail' : ''}>
                <td>
                  <b>{rankOf(e) ?? '-'}</b>
                  {prevRanks && !editing && (
                    <div style={{ marginTop: 1 }}><RankMove prev={prevRanks.get(e.name)} cur={rankOf(e)} /></div>
                  )}
                </td>
                <td className={isFail(e) ? 'cell-fail' : ''}>
                  <b>{e.name}</b>
                  {tierOf?.get(e.name) && <span className="muted" style={{ marginLeft: 4, fontSize: '0.72rem' }}>{tierShort(tierOf.get(e.name))}</span>}
                  {!rosterSet.has(e.name) && <span className="muted" style={{ marginLeft: 4, fontSize: '0.75rem' }}>(외부)</span>}
                </td>
                {showPrev && <td style={{ textAlign: 'right' }} className="num-tab muted">{fmt(prevValues.get(e.name))}</td>}
                {showMid && <td style={{ textAlign: 'right' }}>{editing ? (
                  <span className="mid-edit">
                    <input type="number" value={e.mid ?? ''} placeholder="0" className="num-tab"
                      onChange={(ev) => setField(e.name, { mid: ev.target.value === '' ? undefined : Number(ev.target.value) })}
                      style={{ width: 120, textAlign: 'right' }} />
                    {/* 친 횟수 — 캡처로 들어오지만 손으로도 고칠 수 있게 */}
                    <input type="number" value={e.midHits ?? ''} placeholder="회" className="num-tab mid-hits-input"
                      min={1} step={1} title="친 횟수 — 넣으면 보기 화면에서 1회 점수(총 ÷ 횟수)로 바뀌어요"
                      onChange={(ev) => setField(e.name, { midHits: ev.target.value === '' ? undefined : Number(ev.target.value) })} />
                  </span>
                ) : (<MidCell e={e} />)}</td>}
                <td style={{ textAlign: 'right' }}>{editing ? (
                  <input type="number" value={e.value ?? ''} placeholder="0" className="num-tab"
                    onChange={(ev) => setField(e.name, { value: ev.target.value === '' ? undefined : Number(ev.target.value) })}
                    style={{ width: 120, textAlign: 'right' }} />
                ) : (<b className="num-tab">{fmt(e.value)}</b>)}</td>
                {/* 차이(절대값) + %.
                    ★ 파괴신 시즌집계 대비는 **최종끼리만** 비교한다(effOf 로 중간집계에 떨어뜨리지
                      않는다). 시즌 도중에 이번 시즌 중간집계를 전 시즌 최종과 빼면 전원이 크게
                      떨어진 것처럼 나왔다 — 시즌 도중 비교는 옆의 '중간집계 대비' 가 맡는다. */}
                <td><Diff prev={prevValues.get(e.name)} cur={showMid ? e.value : effOf(e)} /></td>
                {showMid && <td><MidDiff prev={prevEntries?.get(e.name)} cur={e} /></td>}
                {showVerdict && <td>{typeof effOf(e) === 'number' ? (isFail(e) ? <span className="badge lose">미달</span> : <span className="badge win">통과</span>) : <span className="muted">—</span>}</td>}
                {showJoined && <td>{editing ? (
                  <input type="checkbox" checked={!!e.joined} onChange={(ev) => setField(e.name, { joined: ev.target.checked })} />
                ) : (<span className={`badge ${e.joined ? 'win' : 'lose'}`}>{e.joined ? 'O' : 'X'}</span>)}</td>}
                {misses && <td>{(() => {
                  const m = misses.get(e.name)
                  if (!m) return <span className="muted">—</span>
                  return (
                    <span className={m.miss ? 'delta down' : 'delta'}>
                      {m.miss}<span style={{ fontWeight: 400, opacity: 0.6 }}>/{m.of}</span>
                    </span>
                  )
                })()}</td>}
                <td>{editing ? (
                  <input value={e.memo ?? ''} placeholder="메모" onChange={(ev) => setField(e.name, { memo: ev.target.value })} style={{ width: '100%', minWidth: 90 }} />
                ) : (<span className="muted">{e.memo || ''}</span>)}</td>
                {editing && <td>{!rosterSet.has(e.name) && <button className="small danger" title="이 외부 인원 기록 삭제 (저장 시 반영)" onClick={() => {
                  // 이번 편집에서 방금 추가한 이름이면 목록에서만 빼고,
                  // 이미 저장돼 있던 외부 항목이면 삭제 표시 → [저장] 때 기록에서 제거
                  setLocalExtra((prev) => prev.filter((x) => x !== e.name))
                  setRemovedExtra((prev) => (prev.includes(e.name) ? prev : [...prev, e.name]))
                }}>✕</button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 하단 저장/취소 (편집 모드) */}
      {admin && editing && (
        <>
          <div className="row" style={{ marginTop: 12 }}>
            <input placeholder="외부(비길드원) 이름 추가" value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addExternal() }} />
            <button className="small" onClick={addExternal}>+ 추가</button>
          </div>
          <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end', gap: 10 }}>
            <button onClick={cancel}>취소</button>
            <button className="primary" onClick={save}>💾 저장</button>
          </div>
        </>
      )}
    </div>
  )
}
