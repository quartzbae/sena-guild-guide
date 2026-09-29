import { useMemo, useState } from 'react'
import type { Grade, Hero, Position, SavedDeck } from '../types'
import { canEditStaff, getAllHeroes, newId, todayLocal, update, useUserData } from '../store'
import { DeckNames, HeroName, HeroPickerModal, SlotRow } from '../components/HeroSelect'
import { HeroPortrait } from '../components/HeroPortrait'
import { Modal } from '../components/Modal'
import { recFor } from '../data/heroRecs'

const GRADES: Grade[] = ['전설', '희귀', '고급', '일반']
const POSITIONS: Position[] = ['공격형', '마법형', '방어형', '지원형', '만능형']

export function HeroesPage() {
  const userData = useUserData()
  const heroes = getAllHeroes()
  const heroMap = useMemo(() => new Map(heroes.map((h) => [h.id, h])), [heroes])

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>영웅 · 덱</h1>
          <p className="page-desc">3인 덱을 짜서 저장하고, 영웅 정보를 찾아보세요.</p>
        </div>
      </header>
      <DeckBuilder heroes={heroes} heroMap={heroMap} savedDecks={userData.savedDecks} />
      <HeroBrowser heroes={heroes} />
    </div>
  )
}

function DeckBuilder({
  heroes,
  heroMap,
  savedDecks,
}: {
  heroes: Hero[]
  heroMap: Map<string, Hero>
  savedDecks: SavedDeck[]
}) {
  const [sel, setSel] = useState<string[]>([])
  const [name, setName] = useState('')
  const [kind, setKind] = useState<SavedDeck['kind']>('공격덱')
  const [memo, setMemo] = useState('')
  const [picking, setPicking] = useState<number | null>(null)

  function save() {
    if (sel.length === 0 || !name.trim()) return
    update((d) => {
      d.savedDecks.push({
        id: newId('deck'),
        name: name.trim(),
        heroes: sel,
        memo: memo.trim() || undefined,
        kind,
        updatedAt: todayLocal(),
      })
    })
    setSel([]); setName(''); setMemo('')
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div className="sec-label">덱 빌더</div>
          <span className="muted">길드전 파티는 3인</span>
        </div>

        <SlotRow
          names={sel}
          heroMap={heroMap}
          onPick={(i) => setPicking(i)}
          onClear={(i) => setSel((s) => s.filter((_, j) => j !== i))}
        />

        {sel.length > 0 && <DeckRecs heroIds={sel} heroMap={heroMap} />}

        {canEditStaff() && (
          <div className="deck-save">
            <input placeholder="덱 이름" value={name} onChange={(e) => setName(e.target.value)} />
            <select value={kind} onChange={(e) => setKind(e.target.value as SavedDeck['kind'])}>
              <option value="공격덱">공격덱</option>
              <option value="방어덱">방어덱</option>
            </select>
            <input placeholder="메모 (선택)" value={memo} onChange={(e) => setMemo(e.target.value)} />
            <button className="primary" disabled={sel.length === 0 || !name.trim()} onClick={save}>덱 저장</button>
          </div>
        )}

        {picking !== null && (
          <HeroPickerModal
            heroes={heroes}
            title="덱에 넣을 영웅"
            selected={sel}
            onPick={(id) => {
              setSel((s) => {
                const next = [...s]
                next[picking] = id
                return next.filter(Boolean)
              })
              setPicking(null)
            }}
            onClose={() => setPicking(null)}
          />
        )}
      </section>

      {savedDecks.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div className="sec-label">저장된 덱 {savedDecks.length}개</div>
          </div>
          <div className="deck-list stagger">
            {savedDecks.map((d) => (
              <div className="deck-item" key={d.id}>
                <div className="deck-item-main">
                  <div className="deck-item-title">
                    <strong>{d.name}</strong>
                    <span className={`tag ${d.kind === '공격덱' ? 'tag-atk' : 'tag-def'}`}>{d.kind}</span>
                  </div>
                  <DeckNames names={d.heroes} heroMap={heroMap} />
                  {d.memo && <p className="muted deck-item-memo">{d.memo}</p>}
                </div>
                {canEditStaff() && (
                  <button className="small danger" onClick={() => {
                    if (confirm(`'${d.name}' 덱을 삭제할까요?`)) {
                      update((u) => { u.savedDecks = u.savedDecks.filter((x) => x.id !== d.id) })
                    }
                  }}>삭제</button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function DeckRecs({ heroIds, heroMap }: { heroIds: string[]; heroMap: Map<string, Hero> }) {
  return (
    <div className="recs">
      <div className="sec-label">추천 세팅</div>
      {heroIds.map((id, i) => {
        const h = heroMap.get(id)
        const rec = recFor(h?.name ?? id, h?.position ?? null)
        return (
          <div className="rec" key={`${id}-${i}`}>
            <div className="rec-hero"><HeroName hero={h} name={id} /></div>
            <dl className="rec-facts">
              <div><dt>반지</dt><dd>{rec.accessory ?? '—'}</dd></div>
              <div><dt>장비</dt><dd>{rec.gear ?? '—'}</dd></div>
              <div><dt>펫</dt><dd>{rec.pet ?? '—'}</dd></div>
            </dl>
            {rec.note && <p className="rec-note">{rec.note}</p>}
          </div>
        )
      })}
    </div>
  )
}

function HeroBrowser({ heroes }: { heroes: Hero[] }) {
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<Position | ''>('')
  const [grade, setGrade] = useState<Grade | ''>('')
  const [pvpOnly, setPvpOnly] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  const filtered = heroes.filter((h) => {
    if (q && !h.name.includes(q.trim())) return false
    if (pos && h.position !== pos) return false
    if (grade && h.grade !== grade) return false
    if (pvpOnly && !h.pvpRelevant) return false
    return true
  })

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="sec-label">영웅 {filtered.length}<span className="muted">/{heroes.length}</span></div>
        {canEditStaff() && <button className="small" onClick={() => setShowAdd(true)}>+ 영웅 추가</button>}
      </div>

      <input className="w-full" placeholder="영웅 이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="seg-group">
        <div className="seg">
          <button className={grade === '' ? 'on' : ''} onClick={() => setGrade('')}>등급 전체</button>
          {GRADES.map((g) => <button key={g} className={grade === g ? 'on' : ''} onClick={() => setGrade(g)}>{g}</button>)}
        </div>
        <div className="seg">
          <button className={pos === '' ? 'on' : ''} onClick={() => setPos('')}>유형 전체</button>
          {POSITIONS.map((p) => (
            <button key={p} className={pos === p ? 'on' : ''} onClick={() => setPos(p)}>{p.replace('형', '')}</button>
          ))}
        </div>
        <button className={`seg-toggle ${pvpOnly ? 'on' : ''}`} onClick={() => setPvpOnly((v) => !v)}>⭐ PvP 주력만</button>
      </div>

      <div className="hero-grid stagger">
        {filtered.length === 0 && <span className="muted">조건에 맞는 영웅이 없어요.</span>}
        {filtered.map((h) => (
          <div className="hcard" key={h.id}>
            {/* 카드 아트를 다시 켰다(2026-09-21). 글자만 보던 동안에도 컴포넌트와
                이미지(public/heroes·public/hero-card)는 그대로 있었다. */}
            <div className="hcard-art">
              <HeroPortrait hero={h} name={h.name} size={88} />
            </div>
            <div className="hcard-top">
              <HeroName hero={h} name={h.name} />
              {h.pvpRelevant && <em className="hcard-star" title="PvP 주력">⭐</em>}
            </div>
            <div className="hcard-meta">
              <span className={`tag grade-${h.grade}`}>{h.grade}</span>
              {h.position && <span className="tag">{h.position}</span>}
            </div>
            {h.role && <p className="hcard-role">{h.role}</p>}
            {h.custom && canEditStaff() && (
              <button className="small danger hcard-del" onClick={() => {
                if (confirm(`'${h.name}' 영웅을 삭제할까요?`)) {
                  update((u) => { u.customHeroes = u.customHeroes.filter((x) => x.id !== h.id) })
                }
              }}>삭제</button>
            )}
          </div>
        ))}
      </div>

      {showAdd && <AddHeroForm onClose={() => setShowAdd(false)} />}
    </section>
  )
}

function AddHeroForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [grade, setGrade] = useState<Grade>('전설')
  const [pos, setPos] = useState<Position>('공격형')
  const [role, setRole] = useState('')

  return (
    <Modal
      title="영웅 추가"
      desc="DB에 없는 신규 영웅을 직접 넣을 수 있어요."
      onClose={onClose}
      confirmClose={name.trim() || role.trim() ? '작성 중인 내용이 있어요. 닫을까요?' : undefined}
      footer={
        <>
          <button onClick={onClose}>취소</button>
          <button className="primary" disabled={!name.trim()} onClick={() => {
            update((d) => {
              d.customHeroes.push({
                id: newId('hero'),
                name: name.trim(),
                grade, position: pos,
                role: role.trim() || undefined,
                pvpRelevant: true,
                custom: true,
              })
            })
            onClose()
          }}>추가</button>
        </>
      }
    >
      <div className="fgrid">
        <label>이름<input autoFocus placeholder="영웅 이름" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>등급
          <select value={grade} onChange={(e) => setGrade(e.target.value as Grade)}>
            {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select></label>
        <label>유형
          <select value={pos} onChange={(e) => setPos(e.target.value as Position)}>
            {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select></label>
        <label>역할 <span className="muted">선택</span>
          <input placeholder="예: 광역 누커" value={role} onChange={(e) => setRole(e.target.value)} /></label>
      </div>
    </Modal>
  )
}
