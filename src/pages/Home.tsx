import { useMemo } from 'react'
import type { CutlineGuide, Member, StatEntry, StatRound } from '../types'
import {
  counterHeroNames, getAllCounters, getAllHeroes, hiddenNames, rosterNames, useGuildName, useUserData,
} from '../store'
import { navigate } from '../router'
import { DeckNames } from '../components/HeroSelect'
import {
  Delta, WEEKDAYS, cutlineFor, effOf, fmt, lastFilled, latestDayWithData, midCompare, midShown, perHit, tierMap,
  tierShort, weekTotals,
} from '../lib/stat'

const LINKS: Array<{ route: string; label: string; desc: string }> = [
  { route: 'counters', label: '카운터덱', desc: '상대 방덱을 뚫는 조합 찾기' },
  { route: 'heroes', label: '영웅 · 덱', desc: '3인 덱 짜고 저장하기' },
]

export function HomePage() {
  const userData = useUserData()
  const heroes = getAllHeroes()
  const heroMap = useMemo(() => new Map(heroes.map((h) => [h.id, h])), [heroes])
  const counters = getAllCounters()
  const recent = [...counters].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 3)

  const stats: Array<{ n: number; label: string; route: string }> = [
    { n: counters.length, label: '방어덱 공략', route: 'counters' },
    { n: heroes.length, label: '영웅', route: 'heroes' },
    { n: userData.siegeRounds.length, label: '공성전 주차', route: 'siege' },
    { n: userData.destroyerRounds.length, label: '파괴신 시즌', route: 'destroyer' },
  ]

  return (
    <div>
      <header className="hero-head">
        <div className="sec-label">세븐나이츠 리버스</div>
        <h1>{useGuildName()}</h1>
        <p>길드전 카운터덱부터 공성전·파괴신 기록까지, 길드에 필요한 걸 한곳에.</p>
      </header>

      <div className="kpi-row stagger">
        {stats.map((s) => (
          <button className="kpi" key={s.route} onClick={() => navigate(s.route)}>
            <span className="kpi-n">{s.n}</span>
            <span className="kpi-l">{s.label}</span>
          </button>
        ))}
      </div>

      {/* 공성전·파괴신은 운영진만 입력하므로, 길드원에겐 최근 기록을 표로 바로 보여준다 */}
      <div className="stat-preview-row">
        <SiegePreview rounds={userData.siegeRounds} members={userData.members} guide={userData.cutlineGuide} />
        <SiegeWeekPreview rounds={userData.siegeRounds} members={userData.members} />
        <DestroyerPreview rounds={userData.destroyerRounds} members={userData.members} guide={userData.cutlineGuide} />
      </div>

      <section className="panel">
        <div className="panel-head">
          <div className="sec-label">최근 등록된 카운터</div>
          <button className="small ghost" onClick={() => navigate('counters')}>전체 보기 →</button>
        </div>
        {recent.length === 0 && <p className="muted">아직 등록된 공략이 없어요.</p>}
        <div className="recent-list stagger">
          {recent.map((c) => (
            <button key={c.id} className="recent" onClick={() => navigate('counters')}>
              <span className="recent-line">
                <em className="sec-label">방덱</em>
                <DeckNames names={c.defense} heroMap={heroMap} />
              </span>
              {c.counters[0] && (
                <span className="recent-line">
                  <em className="sec-label">카운터</em>
                  <DeckNames names={counterHeroNames(c.counters[0])} heroMap={heroMap} />
                  {c.counters.length > 1 && <em className="muted">외 {c.counters.length - 1}개</em>}
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="sec-label">바로 가기</div>
        </div>
        <div className="quick-grid stagger">
          {LINKS.map((l) => (
            <button className="quick" key={l.route} onClick={() => navigate(l.route)}>
              <strong>{l.label}</strong>
              <span>{l.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <p className="foot-note">
        덱·공략은 길드원 누구나, <b>공성전·파괴신 기록은 운영진</b>이 입력합니다. 저장한 내용은 길드 공유 저장소에 자동 반영돼요.
      </p>
    </div>
  )
}

/** 홈 요약표 공통 뼈대 — 순위·이름·값·등락, 커트라인 미달은 붉게 */
function PreviewTable({
  route,
  title,
  subtitle,
  metric,
  rows,
  empty,
}: {
  route: string
  title: string
  subtitle?: string
  metric: string
  rows: Array<{
    name: string
    /** 파괴신 등급 — 이름 옆에 작게 */
    tier?: string
    /** 이름 옆에 붙일 짧은 꼬리표 (주간 합계의 '3/7' 참여 일수) */
    note?: string
    /** 합계·입력 인원을 세는 값 */
    value?: number
    /**
     * 표에 보여 줄 값 — 없으면 value. 파괴신 시즌 도중에는 value(총 딜량, 합계용)와
     * 보이는 값(1회 점수)이 다르다. prev 는 **보이는 값과 같은 단위**로 넘길 것.
     */
    shown?: number
    prev?: number
    fail: boolean
  }>
  empty: string
}) {
  const scored = rows.filter((r) => typeof r.value === 'number')
  const total = scored.reduce((s, r) => s + (r.value as number), 0)
  const failCount = rows.filter((r) => r.fail).length

  return (
    <section className="panel stat-preview">
      <div className="panel-head">
        <div>
          <div className="sec-label">{title}</div>
          {subtitle && <div className="sp-sub">{subtitle}</div>}
        </div>
        <button className="small ghost" onClick={() => navigate(route)}>전체 보기 →</button>
      </div>

      {scored.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{empty}</p>
      ) : (
        <>
          <div className="sp-facts">
            <span><b className="num-tab">{scored.length}</b><em>명 입력</em></span>
            <span><b className="num-tab">{fmt(total)}</b><em>{metric} 합계</em></span>
            {failCount > 0 && <span className="sp-fail"><b className="num-tab">{failCount}</b><em>명 미달</em></span>}
          </div>
          {/* 30명이 넘어도 홈이 길어지지 않게 표 안에서만 스크롤 — 자기 순위를 찾을 수 있게 전원 표시 */}
          <div className="sp-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>순위</th>
                  <th>길드원</th>
                  <th style={{ textAlign: 'right' }}>{metric}</th>
                  <th style={{ width: 78 }}>등락</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.name} className={r.fail ? 'row-fail' : ''}>
                    <td><b>{typeof r.value === 'number' ? i + 1 : '-'}</b></td>
                    <td className={r.fail ? 'cell-fail' : ''}>
                      {r.name}
                      {r.tier && <span className="sp-tier">{tierShort(r.tier)}</span>}
                      {r.note && <span className="sp-tier">{r.note}</span>}
                    </td>
                    <td style={{ textAlign: 'right' }} className="num-tab"><b>{fmt(r.shown ?? r.value)}</b></td>
                    <td><Delta prev={r.prev} cur={r.shown ?? r.value} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

function SiegePreview({ rounds, members, guide }: { rounds: StatRound[]; members: Member[]; guide?: CutlineGuide }) {
  const { round, index } = lastFilled(rounds, true)
  const day = latestDayWithData(round)
  const prevRound = index > 0 ? rounds[index - 1] : undefined

  const list: StatEntry[] = day ? round?.days?.[day] ?? [] : []
  const prevValues = new Map(
    (day ? prevRound?.days?.[day] ?? [] : [])
      .filter((e) => typeof e.value === 'number')
      .map((e) => [e.name, e.value as number]),
  )

  // 외부 처리한 길드원은 뺀다 — 지금 길드에 없는 사람이 랭킹에 끼지 않게
  const hidden = hiddenNames(members)
  const rows = [...list]
    .filter((e) => typeof e.value === 'number' && !hidden.has(e.name))
    .sort((a, b) => (b.value as number) - (a.value as number))
    .map((e) => {
      const cut = round ? cutlineFor(round, e.name, { day, guide }) : undefined
      return {
        name: e.name,
        value: e.value,
        prev: prevValues.get(e.name),
        fail: typeof cut === 'number' && (e.value as number) <= cut,
      }
    })

  return (
    <PreviewTable
      route="siege"
      title="공성전"
      subtitle={round ? `${round.label}${day ? ` · ${day}요일` : ''}` : undefined}
      metric="점수"
      rows={rows}
      empty="아직 기록된 점수가 없어요."
    />
  )
}

/**
 * 공성전 주간 합계 — 요일 하나가 아니라 그 주차 월~일을 사람별로 더한 순위.
 *
 * 옆의 SiegePreview 가 '가장 최근에 점수가 들어간 요일 하나'를 보여 주는 것과 짝이다.
 * 합산 규칙은 [공성전] 화면의 [Σ 주간 합계]와 **같은 함수**(lib/stat 의 weekTotals)를
 * 쓴다 — 같은 규칙을 두 파일에 따로 적었다가 커트라인 판정이 화면마다 갈린 적이 있다.
 *
 * ★ 미달은 색으로 표시하지 않는다. 주간 미달은 '몇 번' 이라는 횟수라 요일 표의
 *   '이 점수가 미달이다' 와 뜻이 다른데, 같은 빨간색을 쓰면 한 화면에서 두 가지를
 *   가리키게 된다. 횟수는 [공성전]의 주간 합계 표에서 본다.
 * ★ 이름 옆 '3/7' 은 참여 요일 수다. 합계만 놓으면 3일 뛴 사람이 7일 뛴 사람을
 *   이길 수 있어서, 등수가 그 사실을 가린다.
 */
function SiegeWeekPreview({
  rounds, members,
}: {
  rounds: StatRound[]
  members: Member[]
}) {
  const { round, index } = lastFilled(rounds, true)
  const prevRound = index > 0 ? rounds[index - 1] : undefined
  const roster = rosterNames(members)

  const hidden = hiddenNames(members)
  const prevTotal = new Map(
    weekTotals(prevRound, roster, hidden).map((r) => [r.name, r.total]),
  )
  // weekTotals 가 합계 0(안 뛴 사람·0점)을 이미 빼고 준다
  const rows = weekTotals(round, roster, hidden)
    .map((r) => ({
      name: r.name,
      note: `${r.played}/${WEEKDAYS.length}`,
      value: r.total,
      prev: prevTotal.get(r.name),
      fail: false,
    }))

  return (
    <PreviewTable
      route="siege"
      title="공성전 주간 합계"
      subtitle={round ? `${round.label} · 월~일 합계` : undefined}
      metric="점수"
      rows={rows}
      empty="아직 기록된 점수가 없어요."
    />
  )
}

function DestroyerPreview({ rounds, members, guide }: { rounds: StatRound[]; members: Member[]; guide?: CutlineGuide }) {
  const { round, index } = lastFilled(rounds, false)
  const prevRound = index > 0 ? rounds[index - 1] : undefined
  const tierOf = tierMap(members)
  // 외부 처리한 길드원은 뺀다 (공성전 카드와 같은 규칙)
  const hidden = hiddenNames(members)

  const prevValues = new Map(
    (prevRound?.entries ?? [])
      .filter((e) => typeof e.value === 'number')
      .map((e) => [e.name, e.value as number]),
  )

  const prevEntries = new Map((prevRound?.entries ?? []).map((e) => [e.name, e]))

  // 시즌 도중이면 최종이 없고 중간집계만 있으므로 그것으로 순위를 낸다
  // (순위·합계·커트라인은 총 딜량 — 게임 순위와 커트라인이 총계 기준이다)
  const rows = (round?.entries ?? [])
    .map((e) => ({ e, v: effOf(e, true) }))
    .filter((x) => typeof x.v === 'number' && !hidden.has(x.e.name))
    .sort((a, b) => (b.v as number) - (a.v as number))
    .map(({ e, v }) => {
      const cut = round ? cutlineFor(round, e.name, { tierOf, guide }) : undefined
      const base = { name: e.name, tier: tierOf.get(e.name), value: v, fail: typeof cut === 'number' && (v as number) <= cut }
      if (typeof e.value === 'number') return { ...base, prev: prevValues.get(e.name) }
      // 중간집계만 있는 사람 — 1회 점수로 보이고, 등락은 **전 시즌 중간집계**와 같은 단위로.
      // (예전엔 전 시즌 최종 총계와 견줘서 시즌 도중엔 전원이 크게 떨어진 것처럼 나왔다)
      const c = midCompare(prevEntries.get(e.name), e)
      return {
        ...base,
        note: perHit(e) !== undefined ? `${e.midHits}회` : '총',
        shown: midShown(e),
        prev: c.prev,
      }
    })

  const midOnly = !!round?.entries.length && round.entries.every((e) => typeof e.value !== 'number')

  return (
    <PreviewTable
      route="destroyer"
      title="파괴신"
      subtitle={round ? `${round.label}${midOnly ? ' · 중간집계 1회 점수' : ''}` : undefined}
      metric="딜량"
      rows={rows}
      empty="아직 기록된 딜량이 없어요."
    />
  )
}
