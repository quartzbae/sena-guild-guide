import { useMemo, useState } from 'react'
import type { Hero, LoadoutSlot, SiegeGuide } from '../types'
import { getAllHeroes, newId, todayLocal, update, useUserData } from '../store'
import { HeroName, HeroPickerModal, SlotRow } from '../components/HeroSelect'
import { Line, LoadoutEditor, LoadoutView, SkillTimeline, TimelineView } from '../components/Loadout'
import { SIEGE_BOSSES, SIEGE_DECK_SIZE, bossOf } from '../data/gear'
import { todayWeekday } from '../lib/stat'

/**
 * 공성전 공략 — 요일마다 보스가 정해져 있어서, 요일을 고르면 그 보스 기준으로 공략을 단다.
 *
 * [공성전] 메뉴는 점수 기록이고 여기는 '어떻게 잡는가'다. 둘을 합치지 않은 이유는
 * 기록은 주차마다 쌓이고 공략은 보스가 안 바뀌는 한 계속 쓰이기 때문이다.
 */
export function SiegeGuidePage() {
  const data = useUserData()
  const heroes = getAllHeroes()
  const heroMap = useMemo(() => new Map(heroes.map((h) => [h.id, h])), [heroes])
  const [day, setDay] = useState<string>(todayWeekday())
  const [open, setOpen] = useState<string | null>(null)

  const boss = bossOf(day)
  const list = data.siegeGuides.filter((g) => g.day === day)

  function addGuide() {
    const id = newId('sg')
    update((d) => {
      d.siegeGuides.push({ id, day, name: `${boss?.boss ?? day} 공략`, heroes: [], updatedAt: todayLocal() })
    })
    setOpen(id)
  }

  return (
    <div>
      <h1>공성전 공략</h1>
      <p className="page-desc">
        요일마다 보스가 정해져 있어요. 요일을 고르면 <b>그 보스 기준</b>으로 공략을 답니다.
        점수 기록은 <b>[공성전]</b> 메뉴에 있어요.
      </p>

      {/* 요일 = 보스. 요일만 적어두면 무슨 보스인지 매번 찾아봐야 해서 같이 보여준다 */}
      <div className="boss-tabs">
        {SIEGE_BOSSES.map((b) => {
          const n = data.siegeGuides.filter((g) => g.day === b.day).length
          return (
            <button key={b.day} className={`boss-tab ${day === b.day ? 'on' : ''}`} onClick={() => setDay(b.day)}>
              <span className="boss-day">{b.day}</span>
              <span className="boss-name">{b.boss}</span>
              <span className={`boss-type t-${b.type}`}>{b.type}</span>
              {n > 0 && <em className="boss-n">{n}</em>}
            </button>
          )
        })}
      </div>

      <div className="row" style={{ margin: '12px 0' }}>
        <strong style={{ fontSize: '1.05rem' }}>
          {day}요일 · {boss?.boss}
          <span className="muted" style={{ marginLeft: 6, fontSize: '0.88rem' }}>{boss?.type}</span>
        </strong>
        <span className="spacer" />
        <button className="primary" onClick={addGuide}>+ 공략 추가</button>
      </div>

      {list.length === 0 && (
        <div className="card muted">{day}요일 공략이 아직 없어요. [+ 공략 추가]로 등록하세요.</div>
      )}

      {list.map((g) => (
        <GuideCard
          key={g.id}
          guide={g}
          heroes={heroes}
          heroMap={heroMap}
          open={open === g.id}
          onToggle={() => setOpen(open === g.id ? null : g.id)}
        />
      ))}
    </div>
  )
}

function GuideCard({ guide, heroes, heroMap, open, onToggle }: {
  guide: SiegeGuide
  heroes: Hero[]
  heroMap: Map<string, Hero>
  open: boolean
  onToggle: () => void
}) {
  const [picking, setPicking] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)

  const patch = (fn: (g: SiegeGuide) => void) =>
    update((d) => {
      const t = d.siegeGuides.find((x) => x.id === guide.id)
      if (t) { fn(t); t.updatedAt = todayLocal() }
    })

  const names = guide.heroes.map((h) => h.name)
  const slotPatch = (i: number, p: Partial<LoadoutSlot>) =>
    patch((g) => { if (g.heroes[i]) Object.assign(g.heroes[i], p) })

  const rows: Array<[string, string | undefined]> = [
    ['속공 순서', guide.speedOrder],
    ['메모', guide.notes],
  ]

  return (
    <div className="card">
      <div className="row between" style={{ cursor: 'pointer' }} onClick={onToggle}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <strong>{guide.name}</strong>
          {names.length > 0 && (
            <span className="muted">{names.map((n) => <HeroName key={n} hero={heroMap.get(n)} name={n} />)}</span>
          )}
        </div>
        <div className="row">
          <button className="small" onClick={(e) => { e.stopPropagation(); setEditing((v) => !v); if (!open) onToggle() }}>
            {editing ? '편집 끝' : '편집'}
          </button>
          <button className="small danger" onClick={(e) => {
            e.stopPropagation()
            if (confirm(`'${guide.name}' 공략을 삭제할까요?`)) update((d) => { d.siegeGuides = d.siegeGuides.filter((x) => x.id !== guide.id) })
          }}>✕</button>
          <span className="muted">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          {editing ? (
            <>
              <div className="row" style={{ marginBottom: 8 }}>
                <label className="def-label">공략 이름</label>
                <input value={guide.name} onChange={(e) => patch((g) => { g.name = e.target.value })} style={{ flex: 1, minWidth: 140 }} />
              </div>

              <div className="cc-sec">편성 (최대 {SIEGE_DECK_SIZE}인)</div>
              <SlotRow
                names={names}
                heroMap={heroMap}
                max={SIEGE_DECK_SIZE}
                onPick={(i) => setPicking(i)}
                onClear={(i) => patch((g) => {
                  const gone = g.heroes[i]?.name
                  g.heroes.splice(i, 1)
                  if (gone) g.timeline = (g.timeline ?? []).filter((s) => s.hero !== gone)
                })}
              />

              {guide.heroes.map((h, i) => (
                <LoadoutEditor key={i} slot={h} hero={heroMap.get(h.name)} onChange={(p) => slotPatch(i, p)} />
              ))}

              <div className="cc-sec" style={{ marginTop: 12 }}>스킬 시전 순서</div>
              <SkillTimeline
                slots={guide.heroes}
                heroMap={heroMap}
                timeline={guide.timeline}
                onChange={(t) => patch((g) => { g.timeline = t })}
              />

              <Line label="속공 순서" value={guide.speedOrder} onChange={(v) => patch((g) => { g.speedOrder = v })} placeholder="예: 미호 > 나타 > 리나" />
              <Line label="메모" value={guide.notes} onChange={(v) => patch((g) => { g.notes = v })} placeholder="주의점·조건 등" />
            </>
          ) : (
            <>
              {guide.heroes.length === 0 && <p className="muted">영웅이 아직 없어요. [편집]에서 채워 주세요.</p>}
              {guide.heroes.map((h, i) => <LoadoutView key={i} slot={h} hero={heroMap.get(h.name)} />)}
              {(guide.timeline ?? []).some((s) => s.skill) && (
                <div style={{ marginTop: 10 }}>
                  <span className="def-label">스킬 시전 순서</span>
                  <TimelineView timeline={guide.timeline} heroMap={heroMap} />
                </div>
              )}
              {rows.filter(([, v]) => v && String(v).trim()).map(([k, v]) => (
                <div className="row" key={k} style={{ marginTop: 6 }}>
                  <span className="def-label">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {picking !== null && (
        <HeroPickerModal
          heroes={heroes}
          title={`편성 ${picking + 1}번 영웅`}
          selected={names}
          onClose={() => setPicking(null)}
          onPick={(id) => {
            patch((g) => {
              if (g.heroes[picking]) g.heroes[picking].name = id
              else g.heroes.push({ name: id })
            })
            setPicking(null)
          }}
        />
      )}
    </div>
  )
}
