import { useState } from 'react'
import type { Member, MemberRole, StatRound } from '../types'
import { canEditStaff, getUserData, newId, todayLocal, update, useUserData } from '../store'
import { MemberIds } from '../components/MemberIds'

const ROLES: MemberRole[] = ['길드마스터', '부길드마스터', '정예멤버', '멤버']
const roleRank = (r?: MemberRole) => {
  const i = ROLES.indexOf(r ?? '멤버')
  return i < 0 ? ROLES.length : i
}

type Filter = '전체' | '활동' | '외부'

export function MembersPage() {
  // 아이디 관리는 따로 연다 — 목록 위에 붙여 두니 정작 길드원 목록이 안 보였다
  const [showIds, setShowIds] = useState(false)
  const { members } = useUserData()
  const [newName, setNewName] = useState('')
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('전체')
  // 이미 쓰고 있는 등급 목록 (입력 자동완성용)
  const tiers = [...new Set(members.map((m) => m.tier).filter((t): t is string => !!t))].sort()

  const activeCount = members.filter((m) => !m.excluded).length
  const excludedCount = members.length - activeCount

  // 활동 중인 사람 먼저, 그 안에서 역할 순 (마스터 → 부마스터 → 정예 → 멤버).
  // 외부 처리한 계정은 명단 아래로 몰아 둔다 — 평소엔 눈에 안 걸리게.
  const sorted = [...members].sort(
    (a, b) => Number(!!a.excluded) - Number(!!b.excluded) || roleRank(a.role) - roleRank(b.role),
  )
  const query = q.trim()
  const shown = sorted.filter((m) => {
    if (filter === '활동' && m.excluded) return false
    if (filter === '외부' && !m.excluded) return false
    if (!query) return true
    return m.name.includes(query) || (m.owner ?? '').includes(query) || (m.tier ?? '').includes(query)
  })
  const roleCount = (r: MemberRole) => members.filter((m) => !m.excluded && (m.role ?? '멤버') === r).length




  /** 쉼표·줄바꿈으로 여러 명 한 번에 추가 (이미 있는 이름은 건너뜀) */
  function addMember() {
    const names = newName.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
    if (!names.length) return
    update((d) => {
      const existing = new Set(d.members.map((m) => m.name))
      for (const n of names) {
        if (existing.has(n)) continue
        d.members.push({ id: newId('member'), name: n, records: [] })
        existing.add(n)
      }
    })
    setNewName('')
  }

  // 아이디 관리는 화면을 통째로 갈아 끼운다 — 목록과 섞어 두면 둘 다 보기 나쁘다
  if (showIds) {
    return (
      <div>
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="small" onClick={() => setShowIds(false)}>← 길드원 목록</button>
        </div>
        <h1>길드원 아이디</h1>
        <MemberIds />
      </div>
    )
  }

  return (
    <div>
      <h1>길드원 관리</h1>
      <p className="page-desc">
        길드원별 역할과 아이디를 관리합니다. 여러 명은 쉼표로 한 번에 추가하고, 삭제는 각 줄의 ✕를 누르세요.
        <br />
        자리 때문에 잠시 나가 있는 계정은 <b>삭제하지 말고 [외부로 제외]</b>를 쓰세요 — 기록은 남고 통계 명단에서만 빠집니다.
      </p>

      <div className="card">
        <div className="row">
          <input placeholder="길드원 이름 (쉼표로 여러 명 한 번에)" value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addMember()} style={{ flex: 1, minWidth: 180 }} />
          <button className="primary" disabled={!newName.trim()} onClick={addMember}>+ 추가</button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input placeholder="🔍 이름·주인·등급 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          <span className="muted">
            {query ? `${shown.length}명 표시 / ` : ''}활동 {activeCount}명
            {excludedCount > 0 && <> · 외부 {excludedCount}명</>}
            {ROLES.slice(0, 3).map((r) => roleCount(r) > 0 && <span key={r}> · {r} {roleCount(r)}</span>)}
          </span>
        </div>
        <div className="row" style={{ marginTop: 8, gap: 6 }}>
          {(['전체', '활동', '외부'] as Filter[]).map((f) => (
            <button key={f} className={`small ${filter === f ? 'primary' : ''}`} onClick={() => setFilter(f)}>
              {f}
              {f === '활동' ? ` ${activeCount}` : f === '외부' ? ` ${excludedCount}` : ` ${members.length}`}
            </button>
          ))}
          <span className="spacer" />
          <button className="small" onClick={() => setShowIds(true)}>아이디 관리</button>
        </div>
      </div>


      {/* 등급 입력 자동완성 (이미 쓰고 있는 등급) */}
      <datalist id="member-tiers">{tiers.map((t) => <option key={t} value={t} />)}</datalist>

      {shown.map((m) => (
        <MemberCard key={m.id} member={m}
          expanded={expanded === m.id}
          onToggle={() => setExpanded(expanded === m.id ? null : m.id)} />
      ))}
      {members.length === 0 && (
        <div className="card muted">아직 길드원이 없어요. 위에서 이름을 입력해 추가하세요.</div>
      )}
      {members.length > 0 && shown.length === 0 && (
        <div className="card muted">
          {query ? `'${query}' 검색 결과가 없어요.` : filter === '외부' ? '외부로 제외해 둔 계정이 없어요.' : '표시할 길드원이 없어요.'}
        </div>
      )}
    </div>
  )
}

function MemberCard({ member, expanded, onToggle }: {
  member: Member
  expanded: boolean
  onToggle: () => void
}) {
  const [memo, setMemo] = useState(() => getUserData().staffNotes?.[member.id] ?? '')
  const [owner, setOwner] = useState(member.owner ?? '')
  const [nick, setNick] = useState(member.name)
  const [tier, setTier] = useState(member.tier ?? '')

  /**
   * 닉네임 변경 — 게임에서 닉을 바꾸면 기록이 옛 이름에 묶여 끊긴다.
   * 그래서 '이름으로 사람을 가리키는 곳'을 전부 같이 옮긴다:
   *   공성전·파괴신 기록(entries/days) · 부계정 주인 표기
   *
   * ★ 이름으로 길드원을 가리키는 필드를 새로 만들면 여기에도 넣을 것.
   *   (원정대 배치가 실제로 여기서 빠져 있어서 닉을 바꾸면 배치에서 조용히 사라졌다)
   *
   * 외부 처리(excluded)와는 규칙이 반대다. 저기는 '같은 이름의 다른 상황'이라 기록을
   * 안 건드리지만, 닉 변경은 '같은 사람의 다른 이름'이라 기록이 따라와야 맞다.
   */
  function renameMember(next: string) {
    const to = next.trim()
    const from = member.name
    if (!to || to === from) { setNick(from); return }

    // 검사는 update() 밖에서 — 안에서 되돌리면 바뀐 게 없는데도 공유 저장소로 올라간다
    const now = getUserData()
    if (now.members.some((m) => m.id !== member.id && m.name === to)) {
      alert(`'${to}' 이름을 가진 길드원이 이미 있어요.\n그대로 두면 두 사람 점수가 한 칸에 합쳐져서 막았어요.`)
      setNick(from)
      return
    }

    // 뭐가 같이 움직이는지 세어서 보여준다 — 칸을 빠져나가기만 해도(onBlur) 이름이 바뀌기 때문
    const countIn = (rounds: StatRound[]) =>
      rounds.reduce((n, r) => {
        let c = r.entries.filter((e) => e.name === from).length
        if (r.days) for (const day of Object.keys(r.days)) c += r.days[day].filter((e) => e.name === from).length
        return n + c
      }, 0)
    const siege = countIn(now.siegeRounds)
    const destroyer = countIn(now.destroyerRounds)
    const moved = [
      siege && `공성전 기록 ${siege}건`,
      destroyer && `파괴신 기록 ${destroyer}건`,
    ].filter(Boolean).join(' · ')
    if (moved && !confirm(`'${from}' → '${to}'\n\n${moved}도 함께 따라갑니다. 바꿀까요?`)) {
      setNick(from)
      return
    }

    update((d) => {
      const target = d.members.find((m) => m.id === member.id)
      if (!target) return
      target.name = to
      for (const m of d.members) if (m.owner === from) m.owner = to
      const renameEntries = (list?: { name: string }[]) => list?.forEach((e) => { if (e.name === from) e.name = to })
      for (const r of [...d.siegeRounds, ...d.destroyerRounds]) {
        renameEntries(r.entries)
        if (r.days) for (const day of Object.keys(r.days)) renameEntries(r.days[day])
      }
    })
  }


  return (
    <div className={`card member-card${member.excluded ? ' is-excluded' : ''}`}>
      <div className="row between" style={{ cursor: 'pointer' }} onClick={onToggle}>
        <div className="row">
          <strong>{member.name}</strong>
          {member.excluded && <span className="badge excluded">외부</span>}
          {member.role && member.role !== '멤버' && <span className={`badge role-${member.role}`}>{member.role}</span>}
          {member.isAlt && <span className="badge alt">부계정</span>}
          {member.tier && <span className="badge tier">{member.tier}</span>}
          {member.owner && <span className="muted">· 주인 {member.owner}</span>}
        </div>
        <div className="row">
          <span className="muted">{expanded ? '▲' : '▼'}</span>
          <button className="small danger" title="길드원 삭제" onClick={(e) => {
            e.stopPropagation()
            if (confirm(`'${member.name}' 길드원을 삭제할까요? 기록도 함께 삭제됩니다.`)) {
              update((d) => {
                d.members = d.members.filter((x) => x.id !== member.id)
              })
            }
          }}>✕</button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>닉네임</label>
            <input value={nick} onChange={(e) => setNick(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') renameMember((e.target as HTMLInputElement).value) }}
              onBlur={(e) => renameMember(e.target.value)}
              style={{ flex: 1, minWidth: 140 }} />
            <button className="small" onClick={() => renameMember(nick)}>이름 변경</button>
            <span className="muted" style={{ fontSize: '0.78rem' }}>바꾸면 공성전·파괴신 기록도 같이 따라가요</span>
          </div>
          <div className="row" style={{ marginBottom: 10 }}>
            <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>역할</label>
            <select value={member.role ?? '멤버'} onChange={(e) => {
              const role = e.target.value as MemberRole
              update((d) => { const t = d.members.find((x) => x.id === member.id); if (t) t.role = role === '멤버' ? undefined : role })
            }}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <label className="row" style={{ gap: 6, fontSize: '0.85rem', cursor: 'pointer', marginLeft: 4 }}>
              <input type="checkbox" checked={!!member.isAlt} onChange={(e) => {
                const v = e.target.checked
                update((d) => { const t = d.members.find((x) => x.id === member.id); if (t) t.isAlt = v || undefined })
              }} />
              부계정
            </label>
            <label className="row" style={{ gap: 6, fontSize: '0.85rem', cursor: 'pointer', marginLeft: 4 }}>
              <input type="checkbox" checked={!!member.excluded} onChange={(e) => {
                const v = e.target.checked
                update((d) => { const t = d.members.find((x) => x.id === member.id); if (t) t.excluded = v || undefined })
              }} />
              외부 제외
            </label>
          </div>
          {member.excluded && (
            <p className="member-excluded-note">
              지금 길드에 없는 계정으로 표시돼 있어요 — 공성전·파괴신 명단과 커트라인 집계에서 빠집니다.
              지난 회차에 남은 점수와 아래 승패 기록은 그대로예요.
            </p>
          )}
          <div className="row" style={{ marginBottom: 10 }}>
            <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>계정 주인</label>
            <input placeholder="계정 주인 이름 (선택 — 비우면 표시 안 됨)" value={owner}
              onChange={(e) => setOwner(e.target.value)}
              onBlur={(e) => { const v = e.target.value.trim(); update((d) => { const t = d.members.find((x) => x.id === member.id); if (t) t.owner = v || undefined }) }}
              style={{ flex: 1 }} />
          </div>
          <div className="row" style={{ marginBottom: 10 }}>
            <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>등급</label>
            <input list="member-tiers" placeholder="파괴신 등급 (예: 파이 3초월 — 비우면 기본 커트라인 적용)" value={tier}
              onChange={(e) => setTier(e.target.value)}
              onBlur={(e) => { const v = e.target.value.trim(); update((d) => { const t = d.members.find((x) => x.id === member.id); if (t) t.tier = v || undefined }) }}
              style={{ flex: 1 }} />
            <span className="muted" style={{ fontSize: '0.78rem' }}>파괴신 커트라인이 등급별로 적용돼요</span>
          </div>
          {/* 운영진 메모 — 명단이 아니라 staffNotes 에 따로 담긴다.
              워커가 일반 길드원에게는 이 칸을 아예 안 내려보내므로 본인도 못 본다. */}
          {canEditStaff() && (
            <div className="staff-note">
              <label className="def-label">
                운영진 메모
                <span className="muted"> — 길드원에게는 안 보입니다</span>
              </label>
              <textarea rows={2} value={memo} placeholder="이 사람에 대해 운영진끼리만 볼 메모"
                onChange={(e) => setMemo(e.target.value)}
                onBlur={() => update((d) => {
                  const v = memo.trim()
                  const notes = { ...(d.staffNotes ?? {}) }
                  if (v) notes[member.id] = v.slice(0, 2000)
                  else delete notes[member.id]
                  // ★ 빈 객체를 남긴다. undefined 로 두면 push 의 JSON.stringify 가 키를 통째로
    //   빼고, 워커의 CARRY_OVER_FIELDS 이월이 '요청에 없음'을 '변경 없음'으로 읽어
    //   직전 메모를 되살린다 — 지웠다고 알려주고 실제로는 계속 보관하는 상태가 됐다.
    //   길드 이름(guildName)에 대해 CLAUDE.md 가 못 박아 둔 그 함정과 같은 것이다.
    d.staffNotes = notes
                })} />
            </div>
          )}


        </div>
      )}
    </div>
  )
}
