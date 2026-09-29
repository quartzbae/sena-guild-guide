import { useMemo, useRef, useState } from 'react'
import type { Grade, Hero, Position } from '../types'
import { Modal } from './Modal'
import { HeroPortrait } from './HeroPortrait'
// 영웅 카드(HeroPortrait)는 한동안 빼 두었다가 2026-09-21 에 다시 켰다.
//   - 도감 목록(Heroes.tsx)   프레임까지 있는 카드
//   - 선택 모달 타일(아래)     프레임 없는 작은 초상화 (plain)
// ★ HeroName 에는 안 넣는다. 홈·카운터덱이 이름을 '·' 로 이어 한 줄에 여러 명 쓰는
//   데 쓰이는 부품이라, 여기에 그림을 넣으면 그 줄들이 통째로 두꺼워진다.

const POSITIONS: Position[] = ['공격형', '마법형', '방어형', '지원형', '만능형']
const GRADES: Grade[] = ['전설', '희귀', '고급', '일반']

/** 영웅 이름 한 개를 보여주는 작은 표시 (유형 점 + 이름) */
export function HeroName({ hero, name }: { hero?: Hero; name: string }) {
  const pos = hero?.position
  return (
    <span className="hname">
      <i className={`pos-dot ${pos ? `pos-${pos}` : 'pos-none'}`} title={pos ?? '유형 미상'} />
      {hero?.name ?? name}
    </span>
  )
}

/** 덱 한 줄 (영웅 이름들을 · 로 이어 표시) */
export function DeckNames({ names, heroMap }: { names: string[]; heroMap: Map<string, Hero> }) {
  if (names.length === 0) return <span className="muted">영웅 없음</span>
  return (
    <span className="dnames">
      {names.map((n, i) => (
        <span key={`${n}-${i}`}>
          {i > 0 && <em className="dsep">·</em>}
          <HeroName hero={heroMap.get(n)} name={n} />
        </span>
      ))}
    </span>
  )
}

/**
 * 검색 우선 영웅 필터 — 입력하면 자동완성이 뜨고, 고르면 칩으로 쌓인다.
 * (예전처럼 영웅 60개 그리드를 항상 펼쳐두지 않아 화면이 짧아진다)
 */
export function HeroSearchBar({
  heroes,
  selected,
  onChange,
  max = 3,
  placeholder = '영웅 이름으로 찾기',
}: {
  heroes: Hero[]
  selected: string[]
  onChange: (next: string[]) => void
  max?: number
  placeholder?: string
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [browse, setBrowse] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => {
    const query = q.trim()
    if (!query) return []
    return heroes
      .filter((h) => h.name.includes(query) && !selected.includes(h.id))
      .slice(0, 8)
  }, [heroes, q, selected])

  const add = (id: string): void => {
    if (selected.includes(id) || selected.length >= max) return
    onChange([...selected, id])
    setQ('')
    setOpen(false)
    inputRef.current?.focus()
  }

  return (
    <div className="hsearch">
      <div className="hsearch-field">
        <span className="hsearch-ic" aria-hidden>🔍</span>
        <input
          ref={inputRef}
          value={q}
          placeholder={selected.length >= max ? `최대 ${max}명까지 선택했어요` : placeholder}
          disabled={selected.length >= max}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches[0]) { e.preventDefault(); add(matches[0].id) }
            if (e.key === 'Escape') { setQ(''); setOpen(false) }
          }}
        />
        {/* 최대 선택에 도달하면 목록을 열어도 고를 수 없으므로 버튼도 함께 잠근다 */}
        <button
          className="small ghost"
          disabled={selected.length >= max}
          title={selected.length >= max ? `최대 ${max}명까지 선택할 수 있어요` : undefined}
          onClick={() => setBrowse(true)}
        >
          전체 목록
        </button>
      </div>

      {open && matches.length > 0 && (
        <div className="hsearch-pop">
          {matches.map((h) => (
            <button key={h.id} className="hsearch-item" onMouseDown={(e) => e.preventDefault()} onClick={() => add(h.id)}>
              <HeroName hero={h} name={h.name} />
              <span className="muted">{h.grade}{h.position ? ` · ${h.position}` : ''}</span>
            </button>
          ))}
        </div>
      )}

      {selected.length > 0 && (
        <div className="hsearch-chips">
          {selected.map((id) => {
            const h = heroes.find((x) => x.id === id)
            return (
              <button key={id} className="pill" onClick={() => onChange(selected.filter((x) => x !== id))}>
                <HeroName hero={h} name={id} />
                <em>✕</em>
              </button>
            )
          })}
          <button className="small ghost" onClick={() => onChange([])}>모두 지우기</button>
        </div>
      )}

      {browse && (
        <HeroPickerModal
          heroes={heroes}
          title="영웅 선택"
          onPick={(id) => { add(id); setBrowse(false) }}
          onClose={() => setBrowse(false)}
          selected={selected}
          disabledIds={selected}
        />
      )}
    </div>
  )
}

/** 덱 슬롯 줄 — 빈 칸을 누르면 영웅 선택 모달이 뜬다 (3인 덱 편집의 기본 조작) */
export function SlotRow({
  names,
  heroMap,
  max = 3,
  onPick,
  onClear,
}: {
  names: string[]
  heroMap: Map<string, Hero>
  max?: number
  onPick: (index: number) => void
  onClear: (index: number) => void
}) {
  return (
    <div className="slots">
      {Array.from({ length: max }, (_, i) => {
        const name = names[i]
        if (!name) {
          return (
            <button key={i} className="slot slot-empty" onClick={() => onPick(i)}>
              <span>＋</span>
              <em>영웅 선택</em>
            </button>
          )
        }
        return (
          <div key={i} className="slot slot-filled">
            <button className="slot-main" onClick={() => onPick(i)} title="다른 영웅으로 바꾸기">
              <HeroName hero={heroMap.get(name)} name={name} />
            </button>
            <button className="slot-x" onClick={() => onClear(i)} aria-label="빼기">✕</button>
          </div>
        )
      })}
    </div>
  )
}

/** 영웅 하나를 고르는 모달 — 검색이 먼저, 필터는 접혀 있다 */
export function HeroPickerModal({
  heroes,
  title,
  onPick,
  onClose,
  selected = [],
  disabledIds = [],
}: {
  heroes: Hero[]
  title: string
  onPick: (heroId: string) => void
  onClose: () => void
  /** 표시만 강조 (이미 이 덱에 있는 영웅) */
  selected?: string[]
  /** 고를 수 없는 영웅 — 같은 덱에 같은 영웅이 두 번 들어가지 않게 */
  disabledIds?: string[]
}) {
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<Position | ''>('')
  const [grade, setGrade] = useState<Grade | ''>('')
  const [pvpOnly, setPvpOnly] = useState(false)

  const filtered = useMemo(
    () =>
      heroes.filter((h) => {
        if (q && !h.name.includes(q.trim())) return false
        if (pos && h.position !== pos) return false
        if (grade && h.grade !== grade) return false
        if (pvpOnly && !h.pvpRelevant) return false
        return true
      }),
    [heroes, q, pos, grade, pvpOnly],
  )

  return (
    <Modal title={title} desc={`${filtered.length}명 표시 중 · 이름을 입력하면 바로 좁혀져요`} onClose={onClose}>
      <input
        autoFocus
        className="pick-search"
        placeholder="영웅 이름 검색"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          const first = filtered.find((h) => !disabledIds.includes(h.id))
          if (e.key === 'Enter' && first) onPick(first.id)
        }}
      />

      <div className="seg-group">
        <div className="seg">
          <button className={grade === '' ? 'on' : ''} onClick={() => setGrade('')}>등급 전체</button>
          {GRADES.map((g) => (
            <button key={g} className={grade === g ? 'on' : ''} onClick={() => setGrade(g)}>{g}</button>
          ))}
        </div>
        <div className="seg">
          <button className={pos === '' ? 'on' : ''} onClick={() => setPos('')}>유형 전체</button>
          {POSITIONS.map((p) => (
            <button key={p} className={pos === p ? 'on' : ''} onClick={() => setPos(p)}>{p.replace('형', '')}</button>
          ))}
        </div>
        <button className={`seg-toggle ${pvpOnly ? 'on' : ''}`} onClick={() => setPvpOnly((v) => !v)}>
          ⭐ PvP 주력만
        </button>
      </div>

      <div className="pick-grid">
        {filtered.length === 0 && <span className="muted">조건에 맞는 영웅이 없어요.</span>}
        {filtered.map((h) => {
          const off = disabledIds.includes(h.id)
          return (
            <button
              key={h.id}
              className={`pick-item ${selected.includes(h.id) ? 'picked' : ''}`}
              disabled={off}
              title={off ? '이미 이 덱에 있는 영웅이에요' : undefined}
              onClick={() => onPick(h.id)}
            >
              {/* styles.css 의 .hero-card 주석이 '선택 모달 타일은 .pick-item 규칙이
                  담당' 이라고 적어 둔 그 자리다 — 작은 초상화로 넣는다(프레임은 도감에만). */}
              <HeroPortrait hero={h} name={h.name} size={38} plain />
              <i className={`pos-dot ${h.position ? `pos-${h.position}` : 'pos-none'}`} title={h.position ?? '유형 미상'} />
              <span className="pick-name">{h.name}</span>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
