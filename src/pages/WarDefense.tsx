import { useMemo, useState } from 'react'
import type { DefenseSetup, Hero, LoadoutSlot } from '../types'
import { getAllHeroes, newId, todayLocal, update, useUserData } from '../store'
import { HeroName, HeroPickerModal, SlotRow } from '../components/HeroSelect'
import { GearTabs, Line, LoadoutView, PickLine, ReserveView, SkillReserve, Step } from '../components/Loadout'
import { DECK_TYPES, DEFENSE_STYLES, FORMATIONS, WAR_DECK_SIZE } from '../data/gear'

/**
 * 길드전 방어 — 우리가 걸어 둘 3v3 방어덱과 세팅.
 *
 * 카운터덱(상대 방덱 → 우리 카운터)과 방향이 반대다. 여기 있는 건 '우리가 거는 덱'이다.
 * 입력 항목은 길드전 공격 쪽과 같은 부품(components/Loadout)을 쓴다.
 */
export function WarDefensePage() {
  const data = useUserData()
  const heroes = getAllHeroes()
  const heroMap = useMemo(() => new Map(heroes.map((h) => [h.id, h])), [heroes])
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const list = [...data.defenseSetups].sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0))

  function addSetup() {
    const id = newId('def')
    update((d) => {
      d.defenseSetups.push({ id, name: '새 방어덱', heroes: [], updatedAt: todayLocal() })
    })
    setEditing(id)
    setOpen(id)
  }

  return (
    <div>
      <h1>길드전 방어</h1>
      <p className="page-desc">
        우리가 걸어 둘 <b>3v3 방어덱</b>과 세팅을 정리합니다. 추천도(★)가 높은 순으로 정렬됩니다.
      </p>

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="primary" onClick={addSetup}>+ 방어덱 추가</button>
        <span className="spacer" />
        <span className="muted">{list.length}개</span>
      </div>

      {list.length === 0 && (
        <div className="card muted">아직 등록된 방어덱이 없어요. [+ 방어덱 추가]로 시작하세요.</div>
      )}

      {list.map((s) => (
        <DefenseCard
          key={s.id}
          setup={s}
          heroes={heroes}
          heroMap={heroMap}
          editing={editing === s.id}
          open={open === s.id}
          onToggle={() => setOpen(open === s.id ? null : s.id)}
          onEdit={() => { setEditing(editing === s.id ? null : s.id); setOpen(s.id) }}
        />
      ))}
    </div>
  )
}

export const Stars = ({ n }: { n?: number }) => (
  <span className="def-stars" title={`추천도 ${n ?? 0}/5`}>
    {'★'.repeat(n ?? 0)}<span className="muted">{'☆'.repeat(5 - (n ?? 0))}</span>
  </span>
)

function DefenseCard({
  setup, heroes, heroMap, editing, open, onToggle, onEdit,
}: {
  setup: DefenseSetup
  heroes: Hero[]
  heroMap: Map<string, Hero>
  editing: boolean
  open: boolean
  onToggle: () => void
  onEdit: () => void
}) {
  const [picking, setPicking] = useState<number | null>(null)

  const patch = (fn: (s: DefenseSetup) => void) =>
    update((d) => {
      const t = d.defenseSetups.find((x) => x.id === setup.id)
      if (t) { fn(t); t.updatedAt = todayLocal() }
    })

  const names = setup.heroes.map((h) => h.name)
  const slotPatch = (i: number, p: Partial<LoadoutSlot>) =>
    patch((s) => { if (s.heroes[i]) Object.assign(s.heroes[i], p) })

  return (
    <div className="card">
      <div className="row between" style={{ cursor: 'pointer' }} onClick={onToggle}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <strong>{setup.name}</strong>
          <Stars n={setup.tier} />
          {setup.style && <span className={`badge ${setup.style === '속공' ? 'alt' : 'tier'}`}>{setup.style}</span>}
          {setup.deckType && <span className="badge">{setup.deckType}</span>}
          {names.length > 0 && (
            <span className="muted">{names.map((n) => <HeroName key={n} hero={heroMap.get(n)} name={n} />)}</span>
          )}
        </div>
        <div className="row">
          <button className="small" onClick={(e) => { e.stopPropagation(); onEdit() }}>{editing ? '편집 끝' : '편집'}</button>
          <button className="small danger" onClick={(e) => {
            e.stopPropagation()
            if (confirm(`'${setup.name}' 방어덱을 삭제할까요?`)) update((d) => { d.defenseSetups = d.defenseSetups.filter((x) => x.id !== setup.id) })
          }}>✕</button>
          <span className="muted">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          {editing ? (
            <>
              {/* 게임에서 하는 순서대로 끊는다 — 덱 → 진형·펫 → 영웅별 장비 → 마무리 */}
              <Step n={1} title="덱 설정" desc="이름 · 추천도 · 유형과 3인 조합">
                <div className="row">
                  <label className="def-label">덱 이름</label>
                  <input value={setup.name} onChange={(e) => patch((s) => { s.name = e.target.value })} style={{ flex: 1, minWidth: 140 }} />
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <label className="def-label">추천도</label>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} className={`small ${setup.tier === n ? 'primary' : ''}`}
                      onClick={() => patch((s) => { s.tier = s.tier === n ? undefined : n })}>{n}★</button>
                  ))}
                  <label className="def-label" style={{ marginLeft: 10 }}>세팅</label>
                  {DEFENSE_STYLES.map((v) => (
                    <button key={v} className={`small ${setup.style === v ? 'primary' : ''}`}
                      onClick={() => patch((s) => { s.style = s.style === v ? undefined : v })}>{v}</button>
                  ))}
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <label className="def-label">덱 유형</label>
                  <div className="def-pick-o">
                    {DECK_TYPES.map((v) => (
                      <button key={v} className={`chip ${setup.deckType === v ? 'on' : ''}`}
                        onClick={() => patch((s) => { s.deckType = s.deckType === v ? undefined : v })}>{v}</button>
                    ))}
                  </div>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <label className="def-label">속공 수치</label>
                  <input type="number" className="num-tab" placeholder="이상" value={setup.speedMin ?? ''}
                    onChange={(e) => patch((s) => { s.speedMin = e.target.value === '' ? undefined : Number(e.target.value) })} style={{ width: 110 }} />
                  <span className="muted">~</span>
                  <input type="number" className="num-tab" placeholder="이하" value={setup.speedMax ?? ''}
                    onChange={(e) => patch((s) => { s.speedMax = e.target.value === '' ? undefined : Number(e.target.value) })} style={{ width: 110 }} />
                </div>

                <div className="cc-sec" style={{ marginTop: 12 }}>방어 조합 (최대 {WAR_DECK_SIZE}인)</div>
                <SlotRow
                  names={names}
                  heroMap={heroMap}
                  max={WAR_DECK_SIZE}
                  onPick={(i) => setPicking(i)}
                  onClear={(i) => patch((s) => {
                    const gone = s.heroes[i]?.name
                    s.heroes.splice(i, 1)
                    // 빠진 영웅의 스킬 예약도 같이 지운다 — 안 그러면 없는 영웅이 남는다
                    if (gone) s.reserve = (s.reserve ?? []).filter((r) => r.hero !== gone)
                  })}
                />
              </Step>

              <Step n={2} title="진형 · 펫">
                <PickLine label="진형" value={setup.formation} options={FORMATIONS}
                  onChange={(v) => patch((s) => { s.formation = v })} placeholder="예: 보호진형(멜키르)" />
                <Line label="펫" value={setup.pet} onChange={(v) => patch((s) => { s.pet = v })} placeholder="예: 루" />
              </Step>

              <Step n={3} title="영웅별 장비" desc="영웅을 골라 그 사람 것만 채웁니다">
                <GearTabs slots={setup.heroes} heroMap={heroMap} onChange={slotPatch} />
              </Step>

              <Step n={4} title="스킬 예약 · 마무리">
                <SkillReserve
                  slots={setup.heroes}
                  heroMap={heroMap}
                  reserve={setup.reserve}
                  onChange={(r) => patch((s) => { s.reserve = r })}
                />
                <Line label="덱 공통 부옵" value={setup.subStats} onChange={(v) => patch((s) => { s.subStats = v })} placeholder="영웅마다 따로 적었으면 비워두세요" />
                <Line label="장신구 요약" value={setup.accessoryNote} onChange={(v) => patch((s) => { s.accessoryNote = v })} placeholder="예: 6부6권" />
                <Line label="주의사항" value={setup.notes} onChange={(v) => patch((s) => { s.notes = v })} placeholder="주의점·상성 등" />
              </Step>
            </>
          ) : (
            <DefenseView setup={setup} heroMap={heroMap} />
          )}
        </div>
      )}

      {picking !== null && (
        <HeroPickerModal
          heroes={heroes}
          title={`방어 ${picking + 1}번 영웅`}
          selected={names}
          onClose={() => setPicking(null)}
          onPick={(id) => {
            patch((s) => {
              if (s.heroes[picking]) s.heroes[picking].name = id
              else s.heroes.push({ name: id })
            })
            setPicking(null)
          }}
        />
      )}
    </div>
  )
}

/** 잠금(보기) 상태 — 값이 있는 것만 보여 준다 */
function DefenseView({ setup, heroMap }: { setup: DefenseSetup; heroMap: Map<string, Hero> }) {
  const speed = [setup.speedMin, setup.speedMax].some((v) => typeof v === 'number')
    ? `${setup.speedMin ?? ''} ~ ${setup.speedMax ?? ''}`
    : undefined
  const rows: Array<[string, string | undefined]> = [
    ['덱 유형', setup.deckType],
    ['속공 수치', speed],
    ['진형', setup.formation],
    ['펫', setup.pet],
    ['덱 공통 부옵', setup.subStats],
    ['장신구 요약', setup.accessoryNote],
  ]
  const hasReserve = (setup.reserve ?? []).some((r) => r.skill)
  return (
    <>
      {setup.heroes.length === 0 && <p className="muted">영웅이 아직 없어요. [편집]에서 채워 주세요.</p>}
      {setup.heroes.map((h, i) => <LoadoutView key={i} slot={h} hero={heroMap.get(h.name)} />)}
      {hasReserve && (
        <div className="row" style={{ marginTop: 8 }}>
          <span className="def-label">스킬 예약</span>
          <ReserveView reserve={setup.reserve} heroMap={heroMap} />
        </div>
      )}
      {rows.filter(([, v]) => v && String(v).trim()).map(([k, v]) => (
        <div className="row" key={k} style={{ marginTop: 6 }}>
          <span className="def-label">{k}</span>
          <span>{v}</span>
        </div>
      ))}
      {/* 주의사항은 맨 아래에 따로 — 다른 줄에 섞여 있으면 정작 봐야 할 때 안 읽힌다 */}
      {setup.notes && setup.notes.trim() && (
        <div className="warn-note">
          <span className="warn-note-l">주의사항</span>
          <span>{setup.notes}</span>
        </div>
      )}
    </>
  )
}
