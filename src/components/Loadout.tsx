import { useId, useState } from 'react'
import type { Hero, LoadoutSlot, RingPick, SkillPick, TimelineStep } from '../types'
import { SKILL_RESERVE_MAX } from '../types'
import { HeroName } from './HeroSelect'
import { ARMOR_OPTIONS, ATTUNE_SLOTS, GEAR_SETS, RING_STARS, RINGS, SIEGE_TURNS, STAT_HINTS, WEAPON_OPTIONS } from '../data/gear'

/**
 * 길드전 방어·공격이 같이 쓰는 입력 부품들.
 * 두 화면의 세팅 항목이 사실상 같아서, 한쪽만 고쳐 서로 어긋나는 걸 막으려고 여기 모았다.
 */

/** 고정 목록에서 하나 고르는 칩 묶음 — 다시 누르면 해제 */
export function Pick({ label, value, options, onPick }: {
  label: string
  value?: string
  options: readonly string[]
  onPick: (v?: string) => void
}) {
  return (
    <div className="def-pick">
      <span className="def-pick-l">{label}</span>
      <div className="def-pick-o">
        {options.map((o) => (
          <button key={o} className={`chip ${value === o ? 'on' : ''}`} onClick={() => onPick(value === o ? undefined : o)}>{o}</button>
        ))}
      </div>
    </div>
  )
}

/** 라벨 + 한 줄 입력 */
export function Line({ label, value, onChange, placeholder }: {
  label: string
  value?: string
  onChange: (v?: string) => void
  placeholder?: string
}) {
  return (
    <div className="row" style={{ marginTop: 8 }}>
      <label className="def-label">{label}</label>
      <input value={value ?? ''} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value || undefined)} style={{ flex: 1, minWidth: 160 }} />
    </div>
  )
}

/**
 * 칩으로 고르되 자유 입력도 받는 줄.
 *
 * 진형처럼 정해진 값이 있지만 '보호진형(멜키르)' 같이 덧붙여 적던 곳에 쓴다.
 * 칩만 두면 예전에 손으로 적어둔 값이 화면에서 사라져 보인다.
 */
export function PickLine({ label, value, options, onChange, placeholder }: {
  label: string
  value?: string
  options: readonly string[]
  onChange: (v?: string) => void
  placeholder?: string
}) {
  return (
    <div className="pick-line">
      <span className="def-label">{label}</span>
      <div className="pick-line-b">
        <div className="def-pick-o">
          {options.map((o) => (
            <button key={o} className={`chip ${value === o ? 'on' : ''}`}
              onClick={() => onChange(value === o ? undefined : o)}>{o}</button>
          ))}
        </div>
        <input value={value ?? ''} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value || undefined)} />
      </div>
    </div>
  )
}

/**
 * 세팅 단계 한 묶음.
 *
 * 예전엔 덱 정보·영웅 3인 장비·진형이 한 덩어리로 쭉 늘어서 있어서, 어디까지
 * 채웠는지 스스로도 못 봤다. 게임에서 하는 순서(덱 → 진형·펫 → 영웅별 장비)
 * 그대로 번호를 붙여 끊는다.
 */
export function Step({ n, title, desc, children }: {
  n: number
  title: string
  desc?: string
  children: React.ReactNode
}) {
  return (
    <section className="wz-step">
      <div className="wz-head">
        <em className="wz-n">{n}</em>
        <b>{title}</b>
        {desc && <span className="muted">{desc}</span>}
      </div>
      <div className="wz-body">{children}</div>
    </section>
  )
}

/** 이 영웅 칸에 뭐라도 적혀 있나 — 탭에 표시해서 빠뜨린 영웅을 찾게 한다 */
const slotFilled = (s: LoadoutSlot) =>
  !!(s.set || s.weapon1 || s.weapon2 || s.armor1 || s.armor2 || s.accessory ||
    (s.ringsMin ?? []).length || (s.ringsWant ?? []).length ||
    s.ringSub || (s.attune ?? []).some((v) => v && v.trim()) || s.subStats || s.stat)

/** 반지 한 줄 표기 — '6성 권능 / 불사' */
const ringText = (list?: RingPick[]) =>
  (list ?? []).map((r) => [r.star, r.name].filter(Boolean).join(' ')).join(' / ')

/**
 * 반지 고르기 — 여러 개 고를 수 있고, 고른 것마다 성급을 붙인다.
 *
 * 하나만 고르게 했더니 '권능이든 불사든 상관없다' 를 적을 데가 없었다.
 * 성급은 같은 반지라도 값이 달라서(6부 vs 4부) 같이 적어야 뜻이 통한다.
 */
function RingPicker({ label, hint, value, onChange }: {
  label: string
  hint: string
  value?: RingPick[]
  onChange: (v?: RingPick[]) => void
}) {
  const list = value ?? []
  const set = (next: RingPick[]) => onChange(next.length ? next : undefined)
  const toggle = (name: string) => {
    const at = list.findIndex((r) => r.name === name)
    if (at >= 0) set(list.filter((_, i) => i !== at))
    else set([...list, { name, star: RING_STARS[0] }])
  }
  const star = (name: string, s: string) =>
    set(list.map((r) => (r.name === name ? { ...r, star: s || undefined } : r)))

  return (
    <div className="ring-row">
      <span className="ring-l">{label}<em>{hint}</em></span>
      <div className="ring-chips">
        {RINGS.map((name) => {
          const pick = list.find((r) => r.name === name)
          return (
            <span key={name} className={`ring-chip ${pick ? 'on' : ''}`}>
              <button className="chip" onClick={() => toggle(name)}>{name}</button>
              {pick && (
                <select value={pick.star ?? ''} onChange={(e) => star(name, e.target.value)}
                  aria-label={`${name} 성급`}>
                  <option value="">성급</option>
                  {RING_STARS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 영웅별 장비 — 탭으로 한 명씩.
 *
 * 3인분을 한 화면에 다 펼치면 세로로 길어져서 위아래 비교가 안 된다.
 * 게임 장비 세팅 창처럼 영웅을 골라 그 사람 것만 만진다.
 */
export function GearTabs({ slots, heroMap, onChange }: {
  slots: LoadoutSlot[]
  heroMap: Map<string, Hero>
  onChange: (i: number, p: Partial<LoadoutSlot>) => void
}) {
  const [tab, setTab] = useState(0)
  if (slots.length === 0) {
    return <p className="muted" style={{ margin: '4px 0 0' }}>영웅을 먼저 배치하면 장비를 세팅할 수 있어요.</p>
  }
  // 영웅을 빼면 탭 번호가 명단 밖으로 나간다 — 마지막 칸으로 당겨 준다
  const i = Math.min(tab, slots.length - 1)
  const slot = slots[i]
  return (
    <div className="gear-tabs">
      <div className="gear-tabbar">
        {slots.map((s, j) => {
          const h = heroMap.get(s.name)
          return (
            <button key={j} className={`gear-tab ${j === i ? 'on' : ''}`} onClick={() => setTab(j)}>
              <i className={`pos-dot ${h?.position ? `pos-${h.position}` : 'pos-none'}`} />
              {h?.name ?? s.name}
              {slotFilled(s) && <em className="gear-done" title="세팅 입력됨">●</em>}
            </button>
          )
        })}
      </div>
      <LoadoutEditor slot={slot} hero={heroMap.get(slot.name)} onChange={(p) => onChange(i, p)} />
    </div>
  )
}

/**
 * 영웅 1인의 장비 세팅.
 *
 * 무기·방어구는 각각 두 자리라 '무기 1 / 방어구 1 / 무기 2 / 방어구 2' 로 번갈아
 * 세워 두면 같은 부위끼리 눈으로 못 묶는다. 부위별로 붙여 둔다.
 */
export function LoadoutEditor({ slot, hero, onChange }: {
  slot: LoadoutSlot
  hero?: Hero
  onChange: (p: Partial<LoadoutSlot>) => void
}) {
  // 편집기가 여러 개 겹치는 화면(공성전 5인)이 있어서 목록 id 를 겹치지 않게 만든다
  const hintId = useId()
  const attune = slot.attune ?? []
  // 빈 칸만 남으면 필드째 없앤다 — 안 그러면 저장본에 ['','','',''] 가 쌓인다
  const setAttune = (k: number, v: string) => {
    const next = Array.from({ length: ATTUNE_SLOTS }, (_, j) => (j === k ? v : attune[j] ?? ''))
    onChange({ attune: next.some((x) => x.trim()) ? next : undefined })
  }

  return (
    <div className="def-slot">
      <div className="def-slot-head"><HeroName hero={hero} name={slot.name} /></div>

      {/* 부세공·조율 목록은 게임에서 확인을 못 해 자유 입력이다. 자주 쓰는 이름만 거들어 준다 */}
      <datalist id={hintId}>{STAT_HINTS.map((v) => <option key={v} value={v} />)}</datalist>

      <Pick label="장비 세트" value={slot.set} options={GEAR_SETS} onPick={(v) => onChange({ set: v })} />

      <div className="gear-pair">
        <span className="gear-part">무기 주옵</span>
        <Pick label="1" value={slot.weapon1} options={WEAPON_OPTIONS} onPick={(v) => onChange({ weapon1: v })} />
        <Pick label="2" value={slot.weapon2} options={WEAPON_OPTIONS} onPick={(v) => onChange({ weapon2: v })} />
      </div>
      <div className="gear-pair">
        <span className="gear-part">갑바 주옵</span>
        <Pick label="1" value={slot.armor1} options={ARMOR_OPTIONS} onPick={(v) => onChange({ armor1: v })} />
        <Pick label="2" value={slot.armor2} options={ARMOR_OPTIONS} onPick={(v) => onChange({ armor2: v })} />
      </div>
      <div className="gear-pair gear-rings">
        <span className="gear-part">반지</span>
        <div className="ring-box">
          <RingPicker label="최소" hint="이건 있어야 한다"
            value={slot.ringsMin} onChange={(v) => onChange({ ringsMin: v })} />
          <RingPicker label="권장" hint="있으면 제일 좋다"
            value={slot.ringsWant} onChange={(v) => onChange({ ringsWant: v })} />
          {slot.accessory && (
            <p className="ring-old">
              옛 기록: <b>{slot.accessory}</b>
              <button className="small" onClick={() => onChange({ accessory: undefined })}>지우기</button>
            </p>
          )}
          <div className="def-pick" style={{ marginTop: 4 }}>
            <span className="def-pick-l">부세공</span>
            <input list={hintId} placeholder="예: 효과 저항" value={slot.ringSub ?? ''}
              onChange={(e) => onChange({ ringSub: e.target.value || undefined })} />
          </div>
        </div>
      </div>
      <div className="gear-pair">
        <span className="gear-part">전장 조율</span>
        <div className="attune">
          {Array.from({ length: ATTUNE_SLOTS }, (_, k) => (
            <input key={k} list={hintId} placeholder={`${k + 1}칸`} value={attune[k] ?? ''}
              onChange={(e) => setAttune(k, e.target.value)} />
          ))}
        </div>
      </div>

      <input placeholder="부옵 우선순위 (예: 막기 > 생명 > 방어)" value={slot.subStats ?? ''}
        onChange={(e) => onChange({ subStats: e.target.value || undefined })} style={{ width: '100%', marginTop: 8 }} />
      <input placeholder="그 외 한 줄 (속공 수치·전용장비 등)" value={slot.stat ?? ''}
        onChange={(e) => onChange({ stat: e.target.value || undefined })} style={{ width: '100%', marginTop: 6 }} />
    </div>
  )
}

/** 잠금(보기) 상태의 세팅 한 줄 — 값이 있는 것만 · 로 이어 붙인다 */
export function LoadoutView({ slot, hero }: { slot: LoadoutSlot; hero?: Hero }) {
  // 같은 부위 두 자리는 '/' 로 붙여 한 덩어리로 읽히게 한다
  const pair = (a?: string, b?: string, label?: string) => {
    const v = [a, b].filter(Boolean).join(' / ')
    return v ? `${label} ${v}` : ''
  }
  const attune = (slot.attune ?? []).filter((v) => v && v.trim())
  const parts = [
    slot.set,
    pair(slot.weapon1, slot.weapon2, '무기'),
    pair(slot.armor1, slot.armor2, '갑바'),
    ringText(slot.ringsMin) && `반지 최소 ${ringText(slot.ringsMin)}`,
    ringText(slot.ringsWant) && `권장 ${ringText(slot.ringsWant)}`,
    slot.accessory && `반지 ${slot.accessory}`,
    slot.ringSub && `반지 부세공 ${slot.ringSub}`,
    attune.length ? `조율 ${attune.join(' / ')}` : '',
    slot.subStats && `부옵 ${slot.subStats}`,
    slot.stat,
  ].filter(Boolean)
  return (
    <div className="def-slot">
      <div className="def-slot-head"><HeroName hero={hero} name={slot.name} /></div>
      {parts.length ? <span className="muted">{parts.join(' · ')}</span> : <span className="muted">세팅 미입력</span>}
    </div>
  )
}

/**
 * 스킬 예약 — 덱에 올린 영웅의 실제 스킬 이름 중에서 순서대로 고른다.
 * 예전엔 '겔1 → 팔2' 같은 줄임말을 손으로 적었는데, 영웅 데이터에 스킬 이름이
 * 생겨서 고르게 바꿨다. 줄임말은 사람마다 달라 나중에 못 알아본다.
 */
export function SkillReserve({ slots, heroMap, reserve, onChange }: {
  slots: LoadoutSlot[]
  heroMap: Map<string, Hero>
  reserve?: SkillPick[]
  onChange: (r: SkillPick[]) => void
}) {
  const list = reserve ?? []
  const set = (i: number, p: Partial<SkillPick>) => {
    const next = list.map((x, j) => (j === i ? { ...x, ...p } : x))
    onChange(next)
  }
  const add = () => {
    const first = slots[0]
    if (!first) return
    onChange([...list, { hero: first.name, skill: '' }])
  }

  if (slots.length === 0) {
    return <p className="muted" style={{ margin: '8px 0 0' }}>영웅을 먼저 배치하면 스킬을 고를 수 있어요.</p>
  }

  return (
    <div className="reserve">
      {list.map((r, i) => {
        const hero = heroMap.get(r.hero)
        return (
          <div className="row reserve-row" key={i}>
            <span className="reserve-n">{i + 1}</span>
            <select value={r.hero} onChange={(e) => set(i, { hero: e.target.value, skill: '' })}>
              {slots.map((s) => (
                <option key={s.name} value={s.name}>{heroMap.get(s.name)?.name ?? s.name}</option>
              ))}
            </select>
            <select value={r.skill} onChange={(e) => set(i, { skill: e.target.value })} style={{ flex: 1, minWidth: 120 }}>
              <option value="">— 스킬 선택 —</option>
              {(hero?.skills ?? []).map((s) => (
                <option key={s.name} value={s.name}>{s.name} ({s.type})</option>
              ))}
            </select>
            <button className="small danger" onClick={() => onChange(list.filter((_, j) => j !== i))}>✕</button>
          </div>
        )
      })}
      {list.length < SKILL_RESERVE_MAX && (
        <button className="small" onClick={add}>＋ 스킬 예약 추가 ({list.length}/{SKILL_RESERVE_MAX})</button>
      )}
    </div>
  )
}

/** 보기 상태의 스킬 예약 — 1 겔리두스 창공의 패왕 → 2 … */
export function ReserveView({ reserve, heroMap }: { reserve?: SkillPick[]; heroMap: Map<string, Hero> }) {
  const list = (reserve ?? []).filter((r) => r.skill)
  if (!list.length) return null
  return (
    <span className="reserve-view">
      {list.map((r, i) => (
        <span key={i}>
          {i > 0 && <em className="dsep">→</em>}
          <b>{heroMap.get(r.hero)?.name ?? r.hero}</b> {r.skill}
        </span>
      ))}
    </span>
  )
}

/**
 * 턴 타임라인 — 몇 턴에 누가 무슨 스킬을 쓰는지.
 *
 * 보스를 상대하는 공성전·원정대용. 길드전(PvP)은 몇 턴에 끝날지 몰라 순서만
 * 예약하지만, 보스전은 턴이 정해져 있어 '0턴 미호 → 4턴 나타' 식으로 못 박는다.
 * 턴은 4턴 간격(0·4·8…68)만 고른다 — 스킬 쿨이 4턴이라 그 사이 턴은 쓸 일이 없다.
 */
export function SkillTimeline({ slots, heroMap, timeline, onChange }: {
  slots: LoadoutSlot[]
  heroMap: Map<string, Hero>
  timeline?: TimelineStep[]
  onChange: (t: TimelineStep[]) => void
}) {
  const list = timeline ?? []
  const set = (i: number, p: Partial<TimelineStep>) =>
    onChange(list.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const add = () => {
    const first = slots[0]
    if (!first) return
    // 마지막 단계 다음 턴을 기본값으로 — 보통 순서대로 쌓는다
    const last = list[list.length - 1]
    const next = last ? SIEGE_TURNS.find((t) => t > last.turn) ?? last.turn : SIEGE_TURNS[0]
    onChange([...list, { turn: next, hero: first.name, skill: '' }])
  }

  if (slots.length === 0) {
    return <p className="muted" style={{ margin: '8px 0 0' }}>영웅을 먼저 배치하면 스킬을 고를 수 있어요.</p>
  }

  // 턴 순서대로 보여 준다 — 입력 순서와 실제 순서가 달라도 헷갈리지 않게
  const order = list.map((s, i) => ({ s, i })).sort((a, b) => a.s.turn - b.s.turn)

  return (
    <div className="timeline">
      {order.map(({ s, i }) => {
        const hero = heroMap.get(s.hero)
        return (
          <div className="timeline-row" key={i}>
            <select className="tl-turn" value={s.turn} onChange={(e) => set(i, { turn: Number(e.target.value) })}>
              {SIEGE_TURNS.map((t) => <option key={t} value={t}>{t}턴</option>)}
            </select>
            <select value={s.hero} onChange={(e) => set(i, { hero: e.target.value, skill: '' })}>
              {slots.map((x) => (
                <option key={x.name} value={x.name}>{heroMap.get(x.name)?.name ?? x.name}</option>
              ))}
            </select>
            <select value={s.skill} onChange={(e) => set(i, { skill: e.target.value })} style={{ minWidth: 130 }}>
              <option value="">— 스킬 —</option>
              {(hero?.skills ?? []).map((k) => (
                <option key={k.name} value={k.name}>{k.name} ({k.type})</option>
              ))}
            </select>
            <input placeholder="메모 (선택)" value={s.memo ?? ''}
              onChange={(e) => set(i, { memo: e.target.value || undefined })} style={{ flex: 1, minWidth: 100 }} />
            <button className="small danger" onClick={() => onChange(list.filter((_, j) => j !== i))}>✕</button>
          </div>
        )
      })}
      <button className="small" onClick={add}>＋ 타임라인 단계 추가 ({list.length}단계)</button>
    </div>
  )
}

/** 보기 상태의 타임라인 */
export function TimelineView({ timeline, heroMap }: { timeline?: TimelineStep[]; heroMap: Map<string, Hero> }) {
  const list = (timeline ?? []).filter((s) => s.skill).sort((a, b) => a.turn - b.turn)
  if (!list.length) return null
  return (
    <div className="timeline-view">
      {list.map((s, i) => (
        <div className="tl-item" key={i}>
          <em className="tl-badge">{s.turn}턴</em>
          <b>{heroMap.get(s.hero)?.name ?? s.hero}</b>
          <span>{s.skill}</span>
          {s.memo && <span className="muted">— {s.memo}</span>}
        </div>
      ))}
    </div>
  )
}
