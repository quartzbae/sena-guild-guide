import { useMemo, useState } from 'react'
import type { AttackDeck, AttackTarget, Hero, LoadoutSlot } from '../types'
import { getAllHeroes, newId, todayLocal, update, useUserData } from '../store'
import { HeroName, HeroPickerModal, SlotRow } from '../components/HeroSelect'
import { GearTabs, Line, LoadoutView, PickLine, ReserveView, SkillReserve, Step } from '../components/Loadout'
import { DECK_TYPES, FORMATIONS, WAR_DECK_SIZE } from '../data/gear'

/**
 * 길드전 공격 — 상대 방어덱을 등록해 두고, 그걸 뚫는 우리 공략을 붙인다.
 *
 * [카운터덱] 메뉴와 방향은 같지만 쓰임이 다르다. 카운터덱은 상시 참고용 사전이고,
 * 여기는 이번 길드전에서 실제로 마주친 상대 덱을 올려 두고 굴리는 작업판이다.
 * 그래서 상대 덱마다 우리 공략을 여러 개 달아 두고 골라 쓴다.
 */
export function WarAttackPage() {
  const data = useUserData()
  const heroes = getAllHeroes()
  const heroMap = useMemo(() => new Map(heroes.map((h) => [h.id, h])), [heroes])
  const targets = data.attackTargets
  const [selId, setSelId] = useState<string | null>(null)
  const sel = targets.find((t) => t.id === selId) ?? targets[0] ?? null

  function addTarget() {
    const id = newId('atk')
    update((d) => {
      d.attackTargets.push({ id, name: '새 상대 덱', enemy: [], decks: [], updatedAt: todayLocal() })
    })
    setSelId(id)
  }

  return (
    <div>
      <h1>길드전 공격</h1>
      <p className="page-desc">
        마주친 <b>상대 방어덱</b>을 등록해 두고, 그걸 뚫는 우리 공략을 붙입니다.
        상시 참고용 사전은 <b>[카운터덱]</b>, 여기는 이번 길드전용 작업판이에요.
      </p>

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="primary" onClick={addTarget}>+ 상대 덱 추가</button>
        <span className="spacer" />
        <span className="muted">{targets.length}개</span>
      </div>

      {targets.length === 0 ? (
        <div className="card muted">등록된 상대 덱이 없어요. [+ 상대 덱 추가]로 시작하세요.</div>
      ) : (
        <div className="atk-layout">
          <div className="atk-list">
            {targets.map((t) => (
              <button
                key={t.id}
                className={`atk-target ${sel?.id === t.id ? 'on' : ''}`}
                onClick={() => setSelId(t.id)}
              >
                <span className="atk-target-name">{t.name}</span>
                <span className="atk-faces">
                  {t.enemy.length === 0
                    ? <em className="muted">영웅 없음</em>
                    : t.enemy.map((n) => <HeroName key={n} hero={heroMap.get(n)} name={n} />)}
                </span>
                <em className="muted">공략 {t.decks.length}개</em>
              </button>
            ))}
          </div>

          <div className="atk-detail">
            {sel && <TargetPanel target={sel} heroes={heroes} heroMap={heroMap} onDeleted={() => setSelId(null)} />}
          </div>
        </div>
      )}
    </div>
  )
}

function TargetPanel({ target, heroes, heroMap, onDeleted }: {
  target: AttackTarget
  heroes: Hero[]
  heroMap: Map<string, Hero>
  onDeleted: () => void
}) {
  const [picking, setPicking] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [openDeck, setOpenDeck] = useState<string | null>(null)

  const patch = (fn: (t: AttackTarget) => void) =>
    update((d) => {
      const t = d.attackTargets.find((x) => x.id === target.id)
      if (t) { fn(t); t.updatedAt = todayLocal() }
    })

  function addDeck() {
    const id = newId('atkdeck')
    patch((t) => { t.decks.push({ id, name: '새 공략', heroes: [] }) })
    setOpenDeck(id)
  }

  return (
    <div className="card">
      <div className="row between">
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <strong style={{ fontSize: '1.05rem' }}>{target.name}</strong>
          {target.enemyFormation && <span className="badge tier">{target.enemyFormation}</span>}
          {target.enemyPet && <span className="badge alt">펫 {target.enemyPet}</span>}
        </div>
        <div className="row">
          <button className="small" onClick={() => setEditing((v) => !v)}>{editing ? '편집 끝' : '상대 덱 편집'}</button>
          <button className="small danger" onClick={() => {
            if (confirm(`'${target.name}' 상대 덱을 삭제할까요? 달아둔 공략도 함께 사라져요.`)) {
              update((d) => { d.attackTargets = d.attackTargets.filter((x) => x.id !== target.id) })
              onDeleted()
            }
          }}>✕</button>
        </div>
      </div>

      {editing ? (
        <div style={{ marginTop: 10 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <label className="def-label">덱 제목</label>
            <input value={target.name} onChange={(e) => patch((t) => { t.name = e.target.value })} style={{ flex: 1, minWidth: 140 }} />
          </div>
          <div className="cc-sec">상대 조합 (최대 {WAR_DECK_SIZE}인)</div>
          <SlotRow
            names={target.enemy}
            heroMap={heroMap}
            max={WAR_DECK_SIZE}
            onPick={(i) => setPicking(i)}
            onClear={(i) => patch((t) => { t.enemy.splice(i, 1) })}
          />
          <PickLine label="상대 진형" value={target.enemyFormation} options={FORMATIONS}
            onChange={(v) => patch((t) => { t.enemyFormation = v })} placeholder="예: 보호진형(멜키르)" />
          <Line label="상대 펫" value={target.enemyPet} onChange={(v) => patch((t) => { t.enemyPet = v })} placeholder="예: 루" />
          <Line label="특이사항" value={target.note} onChange={(v) => patch((t) => { t.note = v })} placeholder="예: 겔리두스 부활 주의" />
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {target.enemy.length === 0
              ? <span className="muted">상대 영웅이 아직 없어요. [상대 덱 편집]에서 채워 주세요.</span>
              : target.enemy.map((n) => (
                <span className="atk-enemy" key={n}>
                  <i className={`pos-dot ${heroMap.get(n)?.position ? `pos-${heroMap.get(n)!.position}` : 'pos-none'}`} />
                  {heroMap.get(n)?.name ?? n}
                </span>
              ))}
          </div>
          {target.note && <p className="atk-note">{target.note}</p>}
        </div>
      )}

      <div className="row between" style={{ marginTop: 16, marginBottom: 6 }}>
        <div className="cc-sec">우리 공략 {target.decks.length}개</div>
        <button className="small primary" onClick={addDeck}>+ 공략 추가</button>
      </div>

      {target.decks.length === 0 && <p className="muted">아직 공략이 없어요. [+ 공략 추가]로 등록하세요.</p>}
      {target.decks.map((deck) => (
        <AttackDeckCard
          key={deck.id}
          targetId={target.id}
          deck={deck}
          heroes={heroes}
          heroMap={heroMap}
          open={openDeck === deck.id}
          onToggle={() => setOpenDeck(openDeck === deck.id ? null : deck.id)}
        />
      ))}

      {picking !== null && (
        <HeroPickerModal
          heroes={heroes}
          title={`상대 ${picking + 1}번 영웅`}
          selected={target.enemy}
          onClose={() => setPicking(null)}
          onPick={(id) => {
            patch((t) => {
              if (t.enemy[picking]) t.enemy[picking] = id
              else t.enemy.push(id)
            })
            setPicking(null)
          }}
        />
      )}
    </div>
  )
}

function AttackDeckCard({ targetId, deck, heroes, heroMap, open, onToggle }: {
  targetId: string
  deck: AttackDeck
  heroes: Hero[]
  heroMap: Map<string, Hero>
  open: boolean
  onToggle: () => void
}) {
  const [picking, setPicking] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)

  const patch = (fn: (d: AttackDeck) => void) =>
    update((d) => {
      const t = d.attackTargets.find((x) => x.id === targetId)
      const k = t?.decks.find((x) => x.id === deck.id)
      if (t && k) { fn(k); t.updatedAt = todayLocal() }
    })

  const names = deck.heroes.map((h) => h.name)
  const slotPatch = (i: number, p: Partial<LoadoutSlot>) =>
    patch((k) => { if (k.heroes[i]) Object.assign(k.heroes[i], p) })

  const speed = [deck.speedMin, deck.speedMax].some((v) => typeof v === 'number')
    ? `${deck.speedMin ?? ''} ~ ${deck.speedMax ?? ''}`
    : undefined
  const rows: Array<[string, string | undefined]> = [
    ['덱 유형', deck.deckType],
    ['속공 수치', speed],
    ['진형', deck.formation],
    ['펫', deck.pet],
  ]

  return (
    <div className="atk-deck">
      <div className="row between" style={{ cursor: 'pointer' }} onClick={onToggle}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <strong>{deck.name || '이름 없는 공략'}</strong>
          {deck.deckType && <span className="badge">{deck.deckType}</span>}
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
            if (confirm('이 공략을 삭제할까요?')) {
              update((d) => {
                const t = d.attackTargets.find((x) => x.id === targetId)
                if (t) t.decks = t.decks.filter((x) => x.id !== deck.id)
              })
            }
          }}>✕</button>
          <span className="muted">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          {editing ? (
            <>
              {/* 방어 쪽과 같은 순서 — 덱 → 진형·펫 → 영웅별 장비 → 마무리 */}
              <Step n={1} title="덱 설정" desc="이름 · 유형과 3인 조합">
                <div className="row">
                  <label className="def-label">공략 이름</label>
                  <input value={deck.name ?? ''} onChange={(e) => patch((k) => { k.name = e.target.value })}
                    placeholder="예: 여포덱" style={{ flex: 1, minWidth: 140 }} />
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <label className="def-label">덱 유형</label>
                  <div className="def-pick-o">
                    {DECK_TYPES.map((v) => (
                      <button key={v} className={`chip ${deck.deckType === v ? 'on' : ''}`}
                        onClick={() => patch((k) => { k.deckType = k.deckType === v ? undefined : v })}>{v}</button>
                    ))}
                  </div>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <label className="def-label">속공 수치</label>
                  <input type="number" className="num-tab" placeholder="이상" value={deck.speedMin ?? ''}
                    onChange={(e) => patch((k) => { k.speedMin = e.target.value === '' ? undefined : Number(e.target.value) })} style={{ width: 110 }} />
                  <span className="muted">~</span>
                  <input type="number" className="num-tab" placeholder="이하" value={deck.speedMax ?? ''}
                    onChange={(e) => patch((k) => { k.speedMax = e.target.value === '' ? undefined : Number(e.target.value) })} style={{ width: 110 }} />
                </div>

                <div className="cc-sec" style={{ marginTop: 12 }}>우리 조합 (최대 {WAR_DECK_SIZE}인)</div>
                <SlotRow
                  names={names}
                  heroMap={heroMap}
                  max={WAR_DECK_SIZE}
                  onPick={(i) => setPicking(i)}
                  onClear={(i) => patch((k) => {
                    const gone = k.heroes[i]?.name
                    k.heroes.splice(i, 1)
                    if (gone) k.reserve = (k.reserve ?? []).filter((r) => r.hero !== gone)
                  })}
                />
              </Step>

              <Step n={2} title="진형 · 펫">
                <PickLine label="진형" value={deck.formation} options={FORMATIONS}
                  onChange={(v) => patch((k) => { k.formation = v })} placeholder="예: 공격진형" />
                <Line label="펫" value={deck.pet} onChange={(v) => patch((k) => { k.pet = v })} placeholder="예: 카람" />
              </Step>

              <Step n={3} title="영웅별 장비" desc="영웅을 골라 그 사람 것만 채웁니다">
                <GearTabs slots={deck.heroes} heroMap={heroMap} onChange={slotPatch} />
              </Step>

              <Step n={4} title="스킬 예약 · 마무리">
                <SkillReserve
                  slots={deck.heroes}
                  heroMap={heroMap}
                  reserve={deck.reserve}
                  onChange={(r) => patch((k) => { k.reserve = r })}
                />
                <Line label="주의사항" value={deck.notes} onChange={(v) => patch((k) => { k.notes = v })} placeholder="주의점·순서 등" />
              </Step>
            </>
          ) : (
            <>
              {deck.heroes.length === 0 && <p className="muted">영웅이 아직 없어요. [편집]에서 채워 주세요.</p>}
              {deck.heroes.map((h, i) => <LoadoutView key={i} slot={h} hero={heroMap.get(h.name)} />)}
              {(deck.reserve ?? []).some((r) => r.skill) && (
                <div className="row" style={{ marginTop: 8 }}>
                  <span className="def-label">스킬 예약</span>
                  <ReserveView reserve={deck.reserve} heroMap={heroMap} />
                </div>
              )}
              {rows.filter(([, v]) => v && String(v).trim()).map(([k, v]) => (
                <div className="row" key={k} style={{ marginTop: 6 }}>
                  <span className="def-label">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
              {/* 주의사항은 맨 아래에 따로 — 다른 줄에 섞여 있으면 정작 봐야 할 때 안 읽힌다 */}
              {deck.notes && deck.notes.trim() && (
                <div className="warn-note">
                  <span className="warn-note-l">주의사항</span>
                  <span>{deck.notes}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {picking !== null && (
        <HeroPickerModal
          heroes={heroes}
          title={`공략 ${picking + 1}번 영웅`}
          selected={names}
          onClose={() => setPicking(null)}
          onPick={(id) => {
            patch((k) => {
              if (k.heroes[picking]) k.heroes[picking].name = id
              else k.heroes.push({ name: id })
            })
            setPicking(null)
          }}
        />
      )}
    </div>
  )
}
