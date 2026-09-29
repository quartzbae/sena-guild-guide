import { useMemo, useRef, useState } from 'react'
import type { CounterDeck, CounterEntry, CounterHeroSlot, Formation, Hero } from '../types'
import {
  canEdit,
  counterHeroNames,
  getAllCounters,
  getAllHeroes,
  isBuiltinCounter,
  newId,
  slotName,
  toSlot,
  todayLocal,
  update,
  useUserData,
} from '../store'
import { DeckNames, HeroName, HeroPickerModal, HeroSearchBar, SlotRow } from '../components/HeroSelect'
import { Modal } from '../components/Modal'
import { useMediaQuery } from '../lib/useMediaQuery'

const CONFIDENCES: CounterDeck['confidence'][] = ['검증됨', '커뮤니티', '추측']
const FORMATIONS: Formation[] = ['공격진형', '밸런스진형', '보호진형', '기본진형']

export function CountersPage() {
  useUserData() // 변경 구독
  const heroes = getAllHeroes()
  const heroMap = useMemo(() => new Map(heroes.map((h) => [h.id, h])), [heroes])
  const counters = getAllCounters()
  const isDesktop = useMediaQuery('(min-width: 980px)')

  const [sel, setSel] = useState<string[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<CounterEntry | null>(null)
  const [editingIsNew, setEditingIsNew] = useState(false)

  const filtered = useMemo(() => {
    const list =
      sel.length === 0
        ? counters
        : counters.filter(
            (c) =>
              sel.every((id) => c.defense.includes(id)) ||
              c.counters.some((ct) => sel.every((id) => counterHeroNames(ct).includes(id))),
          )
    return [...list].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  }, [counters, sel])

  // 데스크톱은 오른쪽 상세가 비지 않게 항상 하나를 연다
  const currentId =
    openId && filtered.some((e) => e.id === openId) ? openId : isDesktop ? filtered[0]?.id ?? null : null
  const current = filtered.find((e) => e.id === currentId) ?? null

  function startNew() {
    setEditingIsNew(true)
    setEditing({ id: newId('counter'), defense: sel.slice(0, 3), counters: [], updatedAt: todayLocal() })
  }

  function remove(entry: CounterEntry) {
    if (!confirm('이 카운터 정보를 삭제할까요?')) return
    update((d) => {
      d.counters = d.counters.filter((c) => c.id !== entry.id)
      if (isBuiltinCounter(entry.id) && !d.hiddenCounterIds.includes(entry.id)) {
        d.hiddenCounterIds.push(entry.id)
      }
    })
    setOpenId(null)
  }

  const detailFor = (entry: CounterEntry) => (
    <EntryDetail
      entry={entry}
      heroMap={heroMap}
      sel={sel}
      onEdit={() => { setEditingIsNew(false); setEditing(structuredClone(entry)) }}
      onRemove={() => remove(entry)}
    />
  )

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>카운터덱</h1>
          <p className="page-desc">상대 방어덱을 고르면 어떤 조합으로 뚫는지 바로 보여줍니다.</p>
        </div>
        {canEdit() ? (
          <button className="primary" onClick={startNew}>+ 방어덱 등록</button>
        ) : (
          <span className="muted">🔒 등록·수정은 운영진만</span>
        )}
      </header>

      <div className="panel">
        <HeroSearchBar heroes={heroes} selected={sel} onChange={setSel} max={3} />
        <div className="hint-row">
          {sel.length === 0
            ? `전체 ${counters.length}개 방어덱`
            : `${filtered.length}개 덱이 선택한 영웅을 포함 — 방덱·카운터 양쪽에서 찾습니다`}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <p>일치하는 덱이 없어요.</p>
          {canEdit() && <button className="primary" onClick={startNew}>지금 조합으로 등록하기</button>}
        </div>
      ) : (
        <div className={`cd-split ${isDesktop ? 'is-desktop' : ''}`}>
          <div className="cd-list stagger" role="list">
            {filtered.map((entry) => {
              const defMatch = sel.length > 0 && sel.every((id) => entry.defense.includes(id))
              const ctrMatch =
                sel.length > 0 && !defMatch && entry.counters.some((c) => sel.every((id) => counterHeroNames(c).includes(id)))
              const best = entry.counters.reduce<number | undefined>(
                (m, c) => (typeof c.rating === 'number' ? Math.max(m ?? 0, c.rating) : m),
                undefined,
              )
              const active = current?.id === entry.id
              return (
                <div key={entry.id} role="listitem">
                  <button
                    className={`cd-row ${active ? 'active' : ''}`}
                    // 모바일은 아래로 펼치는 방식, 데스크톱은 오른쪽 상세를 바꾸는 선택 항목
                    aria-expanded={isDesktop ? undefined : active}
                    aria-current={isDesktop ? (active ? 'true' : undefined) : undefined}
                    onClick={() => setOpenId(active && !isDesktop ? null : entry.id)}
                  >
                    <span className="cd-row-top">
                      <DeckNames names={entry.defense} heroMap={heroMap} />
                      {ctrMatch && <em className="tag tag-ctr">카운터 일치</em>}
                    </span>
                    <span className="cd-row-sub">
                      <em>카운터 {entry.counters.length}개</em>
                      {typeof best === 'number' && <em className="tag tag-rate">추천도 {best}</em>}
                      {entry.defenseFormation && <em>{entry.defenseFormation}</em>}
                    </span>
                  </button>
                  {/* 모바일: 선택한 항목 바로 아래에 펼침 */}
                  {!isDesktop && active && <div className="cd-inline">{detailFor(entry)}</div>}
                </div>
              )
            })}
          </div>

          {/* 데스크톱: 오른쪽 상세 패널 */}
          {isDesktop && <div className="cd-detail-col">{current && detailFor(current)}</div>}
        </div>
      )}

      {editing && (
        <CounterForm
          entry={editing}
          heroes={heroes}
          heroMap={heroMap}
          isNew={editingIsNew}
          onClose={() => setEditing(null)}
          onSave={(e) => {
            update((d) => {
              const today = todayLocal()
              e.updatedAt = today
              e.counters.forEach((c) => { if (!c.updatedAt) c.updatedAt = today })
              const idx = d.counters.findIndex((c) => c.id === e.id)
              if (idx >= 0) d.counters[idx] = e
              else d.counters.push(e)
              d.hiddenCounterIds = d.hiddenCounterIds.filter((id) => id !== e.id)
            })
            setOpenId(e.id)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

/** 선택한 방어덱의 상세 — 방덱 정보 + 카운터덱 카드들 */
function EntryDetail({
  entry,
  heroMap,
  sel,
  onEdit,
  onRemove,
}: {
  entry: CounterEntry
  heroMap: Map<string, Hero>
  sel: string[]
  onEdit: () => void
  onRemove: () => void
}) {
  const isMatched = (c: CounterDeck) => sel.length > 0 && sel.every((id) => counterHeroNames(c).includes(id))
  return (
    <div className="cd-detail">
      <div className="cd-detail-head">
        <div>
          <div className="sec-label">상대 방어덱</div>
          <h2 className="cd-title"><DeckNames names={entry.defense} heroMap={heroMap} /></h2>
          <div className="cd-sub">
            {entry.defenseFormation && <span className="tag">{entry.defenseFormation}</span>}
            <span className="muted">업데이트 {entry.updatedAt}</span>
          </div>
          {entry.defenseNotes && <p className="cd-notes">{entry.defenseNotes}</p>}
        </div>
        {canEdit() && (
          <div className="row">
            <button className="small" onClick={onEdit}>수정</button>
            <button className="small danger" onClick={onRemove}>삭제</button>
          </div>
        )}
      </div>

      {entry.counters.length === 0 ? (
        <div className="empty sm">
          등록된 카운터가 없어요.{canEdit() ? ' [수정]에서 추가할 수 있어요.' : ''}
        </div>
      ) : (
        entry.counters.map((c, i) => <CounterCard key={i} index={i} c={c} heroMap={heroMap} matched={isMatched(c)} />)
      )}
    </div>
  )
}

/** 카운터덱 1개 카드 */
function CounterCard({
  index,
  c,
  heroMap,
  matched,
}: {
  index: number
  c: CounterDeck
  heroMap: Map<string, Hero>
  matched: boolean
}) {
  const slots = (c.heroes || []).map(toSlot)
  const facts: Array<[string, string | undefined]> = [
    ['펫', c.pet],
    ['진형', c.formation],
    ['팀 속공', c.teamSpeed],
    ['속공 순서', c.speedOrder],
    ['스킬 순서', c.skillOrder],
  ]
  const shown = facts.filter(([, v]) => v?.trim())

  return (
    <article className={`ccard ${matched ? 'matched' : ''}`}>
      <header className="ccard-head">
        <div>
          <div className="sec-label">카운터 {index + 1}</div>
          <h3>{c.name?.trim() || slots.map((s) => s.name).join(' · ') || '이름 없는 덱'}</h3>
        </div>
        <div className="ccard-badges">
          {typeof c.rating === 'number' && <span className="rate">★ {c.rating}<em>/10</em></span>}
          <span className={`tag conf-${c.confidence}`}>{c.confidence}</span>
        </div>
      </header>

      <div className="ccard-heroes">
        {slots.length === 0 && <span className="muted">영웅 미지정</span>}
        {slots.map((s, i) => (
          <div className="hslot" key={i}>
            <div className="hslot-name">
              <HeroName hero={heroMap.get(s.name)} name={s.name} />
              {s.place && <em className="hslot-place">{s.place}</em>}
            </div>
            {(s.ring || s.gear || s.stat) && (
              <dl className="hslot-facts">
                {s.ring && <><dt>반지</dt><dd>{s.ring}</dd></>}
                {s.gear && <><dt>장비</dt><dd>{s.gear}</dd></>}
                {s.stat && <><dt>스탯</dt><dd>{s.stat}</dd></>}
              </dl>
            )}
          </div>
        ))}
      </div>

      {shown.length > 0 && (
        <dl className="fact-grid">
          {shown.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {c.notes?.trim() && <p className="ccard-note">{c.notes}</p>}
    </article>
  )
}

/** 방어덱 · 카운터 편집 — 슬롯을 눌러 영웅을 고르는 방식 */
function CounterForm({
  entry,
  heroes,
  heroMap,
  onSave,
  onClose,
  isNew,
}: {
  entry: CounterEntry
  heroes: Hero[]
  heroMap: Map<string, Hero>
  onSave: (e: CounterEntry) => void
  onClose: () => void
  /** 새로 등록하는 중인지 (검색 영웅이 미리 채워져 있어도 '수정'으로 보이지 않게) */
  isNew: boolean
}) {
  const [draft, setDraft] = useState<CounterEntry>(() => {
    const d = structuredClone(entry)
    d.counters = d.counters.map((c) => ({ ...c, heroes: (c.heroes || []).map(toSlot) }))
    return d
  })
  // 작성 중인 내용이 있으면 배경 클릭·ESC로 닫을 때 한 번 물어본다
  const initial = useRef('')
  if (!initial.current) initial.current = JSON.stringify(draft)
  const dirty = JSON.stringify(draft) !== initial.current
  /** 어떤 슬롯을 채우는 중인지 — ci=null이면 방어덱 */
  const [picking, setPicking] = useState<{ ci: number | null; index: number } | null>(null)

  const setDeep = (fn: (d: CounterEntry) => void): void =>
    setDraft((prev) => { const next = structuredClone(prev); fn(next); return next })

  const counterSlots = (i: number) => (draft.counters[i].heroes as CounterHeroSlot[])

  function pickHero(heroId: string): void {
    if (!picking) return
    const { ci, index } = picking
    setDeep((d) => {
      if (ci === null) {
        // 다른 칸에 이미 있는 영웅이면 무시 (한 덱에 같은 영웅 중복 방지)
        if (d.defense.some((n, i) => i !== index && n === heroId)) return
        d.defense[index] = heroId
        d.defense = d.defense.filter(Boolean)
      } else {
        const slots = d.counters[ci].heroes as CounterHeroSlot[]
        if (slots.some((s, i) => i !== index && slotName(s) === heroId)) return
        // 다른 영웅으로 바꾸면 이전 영웅의 반지·장비·스탯이 따라오지 않게 새 슬롯으로 교체
        slots[index] = slots[index]?.name === heroId ? slots[index] : { name: heroId }
        d.counters[ci].heroes = slots.filter(Boolean)
      }
    })
    setPicking(null)
  }

  /** 이 덱에 이미 들어있는 영웅 (지금 고치는 칸은 제외 — 같은 영웅 재선택은 허용) */
  const alreadyPicked =
    picking === null
      ? []
      : (picking.ci === null ? draft.defense : counterSlots(picking.ci).map(slotName)).filter(
          (_, i) => i !== picking.index,
        )

  return (
    <>
      <Modal
        title={isNew ? '새 방어덱 등록' : '방어덱 · 카운터 수정'}
        desc="슬롯을 눌러 영웅을 고르세요. 세부 설정은 접혀 있어요."
        onClose={onClose}
        confirmClose={dirty ? '작성 중인 내용이 있어요. 저장하지 않고 닫을까요?' : undefined}
        wide
        footer={
          <>
            <button onClick={onClose}>취소</button>
            <button className="primary" disabled={draft.defense.length === 0} onClick={() => onSave(draft)}>
              저장
            </button>
          </>
        }
      >
        {/* 1. 상대 방어덱 */}
        <section className="fsec">
          <div className="fsec-head">
            <div className="sec-label">1 · 상대 방어덱</div>
            <select
              value={draft.defenseFormation ?? ''}
              onChange={(e) => setDeep((d) => { d.defenseFormation = (e.target.value || undefined) as Formation | undefined })}
            >
              <option value="">진형 미상</option>
              {FORMATIONS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <SlotRow
            names={draft.defense}
            heroMap={heroMap}
            onPick={(i) => setPicking({ ci: null, index: i })}
            onClear={(i) => setDeep((d) => { d.defense.splice(i, 1) })}
          />
          <input
            className="w-full"
            placeholder="방어덱 특징 메모 (예: 선공 위주, 연희 도발 조심)"
            value={draft.defenseNotes ?? ''}
            onChange={(e) => setDeep((d) => { d.defenseNotes = e.target.value })}
          />
        </section>

        {/* 2. 카운터덱들 */}
        <section className="fsec">
          <div className="fsec-head">
            <div className="sec-label">2 · 카운터덱 {draft.counters.length}개</div>
            <button
              className="small"
              onClick={() => setDeep((d) => { d.counters.push({ heroes: [], notes: '', confidence: '커뮤니티' }) })}
            >
              + 카운터 추가
            </button>
          </div>

          {draft.counters.length === 0 && (
            <div className="empty sm">아직 카운터가 없어요. [+ 카운터 추가]를 눌러 시작하세요.</div>
          )}

          {draft.counters.map((c, i) => (
            <div className="fcard" key={i}>
              <div className="fcard-head">
                <input
                  className="fcard-name"
                  placeholder={`카운터 ${i + 1} 별명 (예: 프목실)`}
                  value={c.name ?? ''}
                  onChange={(e) => setDeep((d) => { d.counters[i].name = e.target.value })}
                />
                <input
                  type="number" min={0} max={10} className="fcard-rate"
                  placeholder="추천도"
                  value={c.rating ?? ''}
                  onChange={(e) =>
                    setDeep((d) => {
                      d.counters[i].rating =
                        e.target.value === '' ? undefined : Math.max(0, Math.min(10, Number(e.target.value)))
                    })
                  }
                />
                <select
                  value={c.confidence}
                  onChange={(e) => setDeep((d) => { d.counters[i].confidence = e.target.value as CounterDeck['confidence'] })}
                >
                  {CONFIDENCES.map((cf) => <option key={cf} value={cf}>{cf}</option>)}
                </select>
                <button
                  className="small danger"
                  onClick={() => setDeep((d) => { d.counters.splice(i, 1) })}
                >삭제</button>
              </div>

              <SlotRow
                names={counterSlots(i).map(slotName)}
                heroMap={heroMap}
                onPick={(si) => setPicking({ ci: i, index: si })}
                onClear={(si) => setDeep((d) => { (d.counters[i].heroes as CounterHeroSlot[]).splice(si, 1) })}
              />

              <div className="fgrid">
                <label>펫
                  <input value={c.pet ?? ''} placeholder="예: 멜페로"
                    onChange={(e) => setDeep((d) => { d.counters[i].pet = e.target.value })} /></label>
                <label>진형
                  <input list="cc-formations" value={c.formation ?? ''} placeholder="예: 보호진형(멜키르)"
                    onChange={(e) => setDeep((d) => { d.counters[i].formation = e.target.value })} /></label>
                <label>팀 속공
                  <input value={c.teamSpeed ?? ''} placeholder="예: 290 이상"
                    onChange={(e) => setDeep((d) => { d.counters[i].teamSpeed = e.target.value })} /></label>
                <label>스킬 순서
                  <input value={c.skillOrder ?? ''} placeholder="예: 오목1 → 프레2"
                    onChange={(e) => setDeep((d) => { d.counters[i].skillOrder = e.target.value })} /></label>
              </div>

              <label className="fld">참고사항
                <textarea value={c.notes} placeholder="주의점·팁"
                  onChange={(e) => setDeep((d) => { d.counters[i].notes = e.target.value })} /></label>

              <details className="fdetails">
                <summary>영웅별 세팅 · 속공 순서 (선택)</summary>
                <label className="fld">속공 순서 <span className="muted">줄바꿈으로 구분</span>
                  <textarea value={c.speedOrder ?? ''} placeholder={'실베스타\n프레이야\n오목'}
                    onChange={(e) => setDeep((d) => { d.counters[i].speedOrder = e.target.value })} /></label>
                {counterSlots(i).length === 0 && <p className="muted">먼저 위에서 영웅을 고르면 칸이 생겨요.</p>}
                {counterSlots(i).map((s, si) => (
                  <div className="fslot" key={si}>
                    <div className="fslot-name"><HeroName hero={heroMap.get(s.name)} name={s.name} /></div>
                    <div className="fgrid">
                      <input placeholder="배치 (전방/후방)" value={s.place ?? ''}
                        onChange={(e) => setDeep((d) => { (d.counters[i].heroes as CounterHeroSlot[])[si].place = e.target.value })} />
                      <input placeholder="반지" value={s.ring ?? ''}
                        onChange={(e) => setDeep((d) => { (d.counters[i].heroes as CounterHeroSlot[])[si].ring = e.target.value })} />
                      <input placeholder="장비" value={s.gear ?? ''}
                        onChange={(e) => setDeep((d) => { (d.counters[i].heroes as CounterHeroSlot[])[si].gear = e.target.value })} />
                      <input placeholder="스탯" value={s.stat ?? ''}
                        onChange={(e) => setDeep((d) => { (d.counters[i].heroes as CounterHeroSlot[])[si].stat = e.target.value })} />
                    </div>
                  </div>
                ))}
              </details>
            </div>
          ))}
        </section>

        <datalist id="cc-formations">{FORMATIONS.map((f) => <option key={f} value={f} />)}</datalist>
      </Modal>

      {picking && (
        <HeroPickerModal
          heroes={heroes}
          title={picking.ci === null ? '방어덱 영웅 선택' : `카운터 ${picking.ci + 1} 영웅 선택`}
          selected={alreadyPicked}
          disabledIds={alreadyPicked}
          onPick={pickHero}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  )
}
