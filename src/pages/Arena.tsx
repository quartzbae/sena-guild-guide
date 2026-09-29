import { safeUrl } from '../lib/stat'
import { useMemo, useRef, useState } from 'react'
import type { ArenaDeckKind, ArenaEntry, ArenaHeroSlot, ArenaMode, Hero } from '../types'
import { canEditStaff, getAllArena, getAllHeroes, isBuiltinArena, newId, todayLocal, update, useUserData } from '../store'
import { HeroName, HeroPickerModal, HeroSearchBar, SlotRow } from '../components/HeroSelect'
import { Modal } from '../components/Modal'
import { useMediaQuery } from '../lib/useMediaQuery'
import { navigate } from '../router'

export const ARENA_MODES: { mode: ArenaMode; route: string; label: string; desc: string }[] = [
  { mode: 'normal', route: 'normal', label: '일반 결투장', desc: '점수 경쟁 5인 결투장. 방어로 걸어둘 덱과 공격 덱 세팅을 모아둡니다.' },
  { mode: 'high', route: 'high', label: '상급 결투장', desc: '상위 구간 메타. 속공 마덱 위주라 스킬 순서와 속공 순위가 승패를 가릅니다.' },
  { mode: 'live', route: 'live', label: '실시간 결투장', desc: '덱 3개를 준비해 밴픽 후 실시간 대전. 편성보다 밴픽·타이밍 운영이 핵심입니다.' },
]

const KINDS: ArenaDeckKind[] = ['공덱', '방덱', '마덱', '운영']
const modeOf = (route: string): ArenaMode => ARENA_MODES.find((m) => m.route === route)?.mode ?? 'normal'

export function ArenaPage({ sub }: { sub: string }) {
  useUserData() // 변경 구독
  const heroes = getAllHeroes()
  const heroMap = useMemo(() => new Map(heroes.map((h) => [h.id, h])), [heroes])
  const all = getAllArena()
  const isDesktop = useMediaQuery('(min-width: 980px)')

  const mode = modeOf(sub)
  const meta = ARENA_MODES.find((m) => m.mode === mode)!

  const [sel, setSel] = useState<string[]>([])
  const [kind, setKind] = useState<ArenaDeckKind | ''>('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<ArenaEntry | null>(null)
  const [editingIsNew, setEditingIsNew] = useState(false)

  const inMode = all.filter((e) => e.mode === mode)
  const filtered = useMemo(() => {
    const list = inMode.filter((e) => {
      if (kind && e.kind !== kind) return false
      if (sel.length && !sel.every((id) => e.heroes.some((s) => s.name === id))) return false
      return true
    })
    return [...list].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  }, [inMode, kind, sel])

  // 데스크톱은 오른쪽 상세가 비지 않게 항상 하나를 연다
  const currentId =
    openId && filtered.some((e) => e.id === openId) ? openId : isDesktop ? filtered[0]?.id ?? null : null
  const current = filtered.find((e) => e.id === currentId) ?? null

  function startNew() {
    setEditingIsNew(true)
    setEditing({
      id: newId('arena'),
      mode,
      kind: mode === 'live' ? '운영' : '공덱',
      name: '',
      heroes: sel.map((n) => ({ name: n })),
      updatedAt: todayLocal(),
    })
  }

  function remove(entry: ArenaEntry) {
    if (!confirm(`'${entry.name || '이 덱'}'을 삭제할까요?`)) return
    update((d) => {
      d.arenaEntries = d.arenaEntries.filter((a) => a.id !== entry.id)
      if (isBuiltinArena(entry.id) && !d.hiddenArenaIds.includes(entry.id)) d.hiddenArenaIds.push(entry.id)
    })
    setOpenId(null)
  }

  const detailFor = (entry: ArenaEntry) => (
    <ArenaDetail
      entry={entry}
      heroMap={heroMap}
      onEdit={() => { setEditingIsNew(false); setEditing(structuredClone(entry)) }}
      onRemove={() => remove(entry)}
    />
  )

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>결투장</h1>
          <p className="page-desc">{meta.desc}</p>
        </div>
        {canEditStaff() && <button className="primary" onClick={startNew}>+ 덱 등록</button>}
      </header>

      {/* 하위 메뉴 — 일반 / 상급 / 실시간. --i는 미끄러지는 알약 위치 */}
      <nav
        className="seg seg-lg"
        aria-label="결투장 종류"
        style={{
          ['--i' as string]: ARENA_MODES.findIndex((m) => m.mode === mode),
          ['--n' as string]: ARENA_MODES.length,
        }}
      >
        {ARENA_MODES.map((m) => (
          <button
            key={m.mode}
            className={mode === m.mode ? 'on' : ''}
            aria-current={mode === m.mode ? 'page' : undefined}
            onClick={() => { navigate(`arena/${m.route}`); setOpenId(null) }}
          >
            {m.label}
            <em className="seg-count">{all.filter((e) => e.mode === m.mode).length}</em>
          </button>
        ))}
      </nav>

      <div className="panel">
        <HeroSearchBar heroes={heroes} selected={sel} onChange={setSel} max={5} />
        <div className="seg">
          <button className={kind === '' ? 'on' : ''} onClick={() => setKind('')}>전체</button>
          {KINDS.filter((k) => (mode === 'live' ? true : k !== '운영')).map((k) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k}</button>
          ))}
        </div>
        <div className="hint-row">
          {sel.length === 0 && !kind
            ? `${meta.label} ${inMode.length}개`
            : `${filtered.length}개 일치`}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <p>{inMode.length === 0 ? `아직 등록된 ${meta.label} 덱이 없어요.` : '조건에 맞는 덱이 없어요.'}</p>
          {canEditStaff() && <button className="primary" onClick={startNew}>덱 등록하기</button>}
        </div>
      ) : (
        <div className={`cd-split ${isDesktop ? 'is-desktop' : ''}`}>
          <div className="cd-list stagger" role="list">
            {filtered.map((entry) => {
              const active = current?.id === entry.id
              return (
                <div key={entry.id} role="listitem">
                  <button
                    className={`cd-row ${active ? 'active' : ''}`}
                    aria-expanded={isDesktop ? undefined : active}
                    aria-current={isDesktop ? (active ? 'true' : undefined) : undefined}
                    onClick={() => setOpenId(active && !isDesktop ? null : entry.id)}
                  >
                    <span className="cd-row-top">
                      <strong className="ar-row-name">{entry.name || '이름 없는 덱'}</strong>
                      <em className={`tag kind-${entry.kind}`}>{entry.kind}</em>
                    </span>
                    <span className="cd-row-sub">
                      {entry.heroes.length > 0 && <em>{entry.heroes.map((h) => h.name).join(' · ')}</em>}
                      {entry.score && <em className="tag tag-rate">{entry.score}</em>}
                    </span>
                  </button>
                  {!isDesktop && active && <div className="cd-inline">{detailFor(entry)}</div>}
                </div>
              )
            })}
          </div>

          {isDesktop && <div className="cd-detail-col">{current && detailFor(current)}</div>}
        </div>
      )}

      {editing && (
        <ArenaForm
          entry={editing}
          heroes={heroes}
          heroMap={heroMap}
          isNew={editingIsNew}
          onClose={() => setEditing(null)}
          onSave={(e) => {
            update((d) => {
              e.updatedAt = todayLocal()
              const idx = d.arenaEntries.findIndex((a) => a.id === e.id)
              if (idx >= 0) d.arenaEntries[idx] = e
              else d.arenaEntries.push(e)
              d.hiddenArenaIds = d.hiddenArenaIds.filter((id) => id !== e.id)
            })
            setOpenId(e.id)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function ArenaDetail({
  entry,
  heroMap,
  onEdit,
  onRemove,
}: {
  entry: ArenaEntry
  heroMap: Map<string, Hero>
  onEdit: () => void
  onRemove: () => void
}) {
  const facts: Array<[string, string | undefined]> = [
    ['진형', entry.formation],
    ['스킬 순서', entry.skillOrder],
    ['달성', entry.score],
  ]
  const shown = facts.filter(([, v]) => v?.trim())
  // 속공 순위가 하나라도 있으면 그 순서대로, 없으면 입력 순서대로 보여준다
  const ordered = entry.heroes.some((h) => typeof h.speed === 'number')
    ? [...entry.heroes].sort((a, b) => (a.speed ?? 99) - (b.speed ?? 99))
    : entry.heroes

  return (
    <div className="cd-detail">
      <div className="cd-detail-head">
        <div>
          <div className="sec-label">{entry.kind}</div>
          <h2 className="cd-title">{entry.name || '이름 없는 덱'}</h2>
          <div className="cd-sub">
            <span className={`tag kind-${entry.kind}`}>{entry.kind}</span>
            {entry.source && <span className="tag">{entry.source}</span>}
            <span className="muted">업데이트 {entry.updatedAt}</span>
          </div>
          {entry.summary && <p className="cd-notes">{entry.summary}</p>}
        </div>
        {canEditStaff() && (
          <div className="row">
            <button className="small" onClick={onEdit}>수정</button>
            <button className="small danger" onClick={onRemove}>삭제</button>
          </div>
        )}
      </div>

      {shown.length > 0 && (
        <dl className="fact-grid">
          {shown.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      )}

      {ordered.length > 0 && (
        <div className="ar-heroes">
          {ordered.map((s, i) => (
            <div className="hslot" key={i}>
              <div className="hslot-name">
                {typeof s.speed === 'number' && <em className="ar-speed" title="속공 순위">속{s.speed}</em>}
                <HeroName hero={heroMap.get(s.name)} name={s.name} />
              </div>
              {(s.gear || s.ring || s.exclusive || s.stat) && (
                <dl className="hslot-facts">
                  {s.gear && <><dt>장비</dt><dd>{s.gear}</dd></>}
                  {s.ring && <><dt>반지</dt><dd>{s.ring}</dd></>}
                  {s.exclusive && <><dt>전용</dt><dd>{s.exclusive}</dd></>}
                  {s.stat && <><dt>스탯</dt><dd>{s.stat}</dd></>}
                </dl>
              )}
            </div>
          ))}
        </div>
      )}

      {entry.tips && entry.tips.length > 0 && (
        <div className="ar-tips">
          <div className="sec-label">공략 포인트</div>
          <ul>{entry.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      )}

      {entry.sourceUrl && (
        <p className="ar-source">
          출처: <a href={safeUrl(entry.sourceUrl)} target="_blank" rel="noopener noreferrer">{entry.source || '원문 보기'}</a>
        </p>
      )}
    </div>
  )
}

function ArenaForm({
  entry,
  heroes,
  heroMap,
  isNew,
  onSave,
  onClose,
}: {
  entry: ArenaEntry
  heroes: Hero[]
  heroMap: Map<string, Hero>
  isNew: boolean
  onSave: (e: ArenaEntry) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<ArenaEntry>(() => structuredClone(entry))
  const initial = useRef('')
  if (!initial.current) initial.current = JSON.stringify(draft)
  const dirty = JSON.stringify(draft) !== initial.current
  const [picking, setPicking] = useState<number | null>(null)

  const setDeep = (fn: (d: ArenaEntry) => void): void =>
    setDraft((prev) => { const next = structuredClone(prev); fn(next); return next })

  function pickHero(heroId: string): void {
    if (picking === null) return
    const index = picking
    setDeep((d) => {
      // 다른 칸에 이미 있는 영웅이면 무시 (한 덱에 같은 영웅 중복 방지)
      if (d.heroes.some((s, i) => i !== index && s.name === heroId)) return
      // 다른 영웅으로 바꾸면 이전 영웅의 세팅이 따라오지 않게 새 슬롯으로 교체
      d.heroes[index] = d.heroes[index]?.name === heroId ? d.heroes[index] : { name: heroId }
      d.heroes = d.heroes.filter(Boolean)
    })
    setPicking(null)
  }

  const alreadyPicked = picking === null ? [] : draft.heroes.map((s) => s.name).filter((_, i) => i !== picking)
  const tipsText = (draft.tips ?? []).join('\n')

  return (
    <>
      <Modal
        title={isNew ? '결투장 덱 등록' : '결투장 덱 수정'}
        desc="슬롯을 눌러 영웅을 고르세요. 결투장은 5인 편성입니다."
        onClose={onClose}
        confirmClose={dirty ? '작성 중인 내용이 있어요. 저장하지 않고 닫을까요?' : undefined}
        wide
        footer={
          <>
            <button onClick={onClose}>취소</button>
            <button className="primary" disabled={!draft.name.trim()} onClick={() => onSave(draft)}>저장</button>
          </>
        }
      >
        <section className="fsec">
          <div className="fsec-head">
            <div className="sec-label">1 · 기본</div>
            <div className="row">
              <select value={draft.mode} onChange={(e) => setDeep((d) => { d.mode = e.target.value as ArenaMode })}>
                {ARENA_MODES.map((m) => <option key={m.mode} value={m.mode}>{m.label}</option>)}
              </select>
              <select value={draft.kind} onChange={(e) => setDeep((d) => { d.kind = e.target.value as ArenaDeckKind })}>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
          </div>
          <input
            className="w-full"
            autoFocus
            placeholder="덱 이름 (예: 속딸 겔두 방덱, 프연프 마덱)"
            value={draft.name}
            onChange={(e) => setDeep((d) => { d.name = e.target.value })}
          />
          <input
            className="w-full"
            placeholder="한 줄 요약 (선택)"
            value={draft.summary ?? ''}
            onChange={(e) => setDeep((d) => { d.summary = e.target.value || undefined })}
          />
          <div className="fgrid">
            <label>진형
              <input value={draft.formation ?? ''} placeholder="예: 공격진형"
                onChange={(e) => setDeep((d) => { d.formation = e.target.value || undefined })} /></label>
            <label>스킬 순서
              <input value={draft.skillOrder ?? ''} placeholder="예: 프2 멜2 레2"
                onChange={(e) => setDeep((d) => { d.skillOrder = e.target.value || undefined })} /></label>
            <label>달성 점수·랭킹
              <input value={draft.score ?? ''} placeholder="예: 7100점 마감"
                onChange={(e) => setDeep((d) => { d.score = e.target.value || undefined })} /></label>
            <label>출처
              <input value={draft.source ?? ''} placeholder="예: 디시 공략/정보"
                onChange={(e) => setDeep((d) => { d.source = e.target.value || undefined })} /></label>
          </div>
          <input
            className="w-full"
            placeholder="원문 주소 (선택)"
            value={draft.sourceUrl ?? ''}
            onChange={(e) => setDeep((d) => { d.sourceUrl = e.target.value || undefined })}
          />
        </section>

        <section className="fsec">
          <div className="fsec-head">
            <div className="sec-label">2 · 편성 {draft.heroes.length}/5</div>
          </div>
          <SlotRow
            names={draft.heroes.map((s) => s.name)}
            heroMap={heroMap}
            max={5}
            onPick={(i) => setPicking(i)}
            onClear={(i) => setDeep((d) => { d.heroes.splice(i, 1) })}
          />

          <details className="fdetails" open={draft.heroes.length > 0}>
            <summary>영웅별 세팅 (속공 순위 · 장비 · 반지 · 전용장비)</summary>
            {draft.heroes.length === 0 && <p className="muted">먼저 위에서 영웅을 고르면 칸이 생겨요.</p>}
            {draft.heroes.map((s, i) => (
              <div className="fslot" key={i}>
                <div className="fslot-name"><HeroName hero={heroMap.get(s.name)} name={s.name} /></div>
                <div className="fgrid">
                  <input type="number" min={1} max={5} placeholder="속공 순위" value={s.speed ?? ''}
                    onChange={(e) => setDeep((d) => {
                      d.heroes[i].speed = e.target.value === '' ? undefined : Math.max(1, Math.min(5, Number(e.target.value)))
                    })} />
                  <input placeholder="장비 (예: 추적자 약치공공)" value={s.gear ?? ''}
                    onChange={(e) => setDeep((d) => { d.heroes[i].gear = e.target.value || undefined })} />
                  <input placeholder="반지 (예: 6부6권)" value={s.ring ?? ''}
                    onChange={(e) => setDeep((d) => { d.heroes[i].ring = e.target.value || undefined })} />
                  <input placeholder="전용장비 (예: 4파쇄)" value={s.exclusive ?? ''}
                    onChange={(e) => setDeep((d) => { d.heroes[i].exclusive = e.target.value || undefined })} />
                  <input placeholder="스탯 한 줄" value={s.stat ?? ''}
                    onChange={(e) => setDeep((d) => { d.heroes[i].stat = e.target.value || undefined })} />
                </div>
              </div>
            ))}
          </details>
        </section>

        <section className="fsec">
          <div className="fsec-head"><div className="sec-label">3 · 공략 포인트</div></div>
          <label className="fld">
            <span className="muted">한 줄에 하나씩</span>
            <textarea
              value={tipsText}
              placeholder={'속공을 못 따면 강점이 사라진다\n막기는 40 정도가 이상적'}
              style={{ minHeight: 140 }}
              onChange={(e) => setDeep((d) => {
                const lines = e.target.value.split('\n')
                // 입력 중 빈 줄이 지워지지 않도록 저장 시점에만 정리
                d.tips = lines.length === 1 && !lines[0].trim() ? undefined : lines
              })}
            />
          </label>
        </section>
      </Modal>

      {picking !== null && (
        <HeroPickerModal
          heroes={heroes}
          title="결투장 편성 영웅 선택"
          selected={alreadyPicked}
          disabledIds={alreadyPicked}
          onPick={pickHero}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  )
}
