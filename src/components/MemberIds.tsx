import { useEffect, useState } from 'react'
import { PasswordInput } from './PasswordInput'
import { WORKER_URL } from '../data/config'
import { changeSiteAdmins, getAdminPw, isSiteAdmin, issueId, kickMember, listIds, revokeIds, setAdminPw, setGate,
  type AuditRow, type IdList } from '../session'

/** 7/14 21:05 처럼 짧게 */
const when = (ts: number | null | undefined): string => {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const ACTION_LABEL: Record<string, string> = {
  issue: '비번 발급', revoke: '아이디 해제', admins: '관리자 지정 변경',
  'gate-on': '로그인 검사 켬', 'gate-off': '로그인 검사 끔', kick: '강제 로그아웃',
}
const auditText = (a: AuditRow) =>
  `${when(a.at)} · ${a.by} — ${ACTION_LABEL[a.action] ?? a.action}${a.target ? ` (${a.target})` : ''}`

/**
 * 길드원 아이디 발급 — [길드원] 페이지의 운영진 도구.
 *
 * 순서가 중요하다. 로그인 검사를 먼저 켜면 아이디 없는 길드원 전원이 잠긴다.
 *   1) 길드원마다 아이디를 발급하고 임시 비번을 전달
 *   2) 다 돌린 뒤에 검사를 켠다
 * 그래서 검사 스위치는 맨 아래에 두고, 안 만든 사람이 남아 있으면 경고를 띄운다.
 *
 * 임시 비번은 발급 순간에만 보여준다. 워커는 해시만 갖고 있어서 다시 못 꺼낸다.
 */
export function MemberIds() {
  const [pw, setPw] = useState(getAdminPw())
  const [data, setData] = useState<IdList | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState<{ name: string; pw: string } | null>(null)

  async function load(nextPw?: string) {
    if (nextPw !== undefined) setAdminPw(nextPw)
    setErr(''); setBusy(true)
    // ★ 실패해도 보던 목록은 남긴다. 예전엔 null 로 비워서, 아이디 발급 직후 목록을 다시 받다가
    //   한 번 실패(429 등)하면 방금 발급한 임시 비번 상자까지 통째로 사라졌다 — 다시 볼 수 없는 값이다.
    try { setData(await listIds()) } catch (e) {
      setErr(e instanceof Error ? e.message : '목록을 못 받았어요.')
    } finally { setBusy(false) }
  }
  // 사이트 관리자로 로그인해 있으면 비번을 칠 필요가 없다 — 토큰만으로 통한다
  useEffect(() => {
    if (WORKER_URL.trim() && (getAdminPw() || isSiteAdmin())) void load()
  }, [])

  async function act(fn: () => Promise<unknown>) {
    setErr(''); setBusy(true)
    try { await fn(); await load() } catch (e) {
      setErr(e instanceof Error ? e.message : '요청이 실패했어요.')
      setBusy(false)
    }
  }

  const noId = data ? data.members.filter((m) => !m.excluded && !m.hasId) : []

  if (!WORKER_URL.trim()) {
    return (
      <div className="card id-panel">
        <strong>길드원 아이디</strong>
        <p className="muted">로컬 모드에서는 공유 계정 관리를 사용하지 않습니다.</p>
      </div>
    )
  }

  return (
    <div className="card id-panel">
      <strong>길드원 아이디</strong>
      <p className="muted">
        길드원마다 아이디를 만들어 두면, <b>길드를 나간 사람은 사이트를 못 엽니다.</b>
        명단에서 빼거나 외부 처리하는 순간 바로 막혀요.
      </p>
      <p className="muted">
        <b>영구 관리자</b> 한 명은 해제할 수 없게 못 박아 뒀습니다 — 서로 해제하다 아무도
        못 들어가는 일을 막는 마지막 고리예요.
        <b> 사이트 관리자</b>는 게임 직책과 별개입니다. 길드마스터가 바뀌어도 그대로 남고,
        아이디 발급과 검사 켜기를 할 수 있어요. 길드마스터·부길드마스터는 직책만으로
        <b>운영진</b>(통계·명단 편집)이 되지만, 여기 관리는 못 합니다.
      </p>

      {!data && !isSiteAdmin() && (
      <div className="row" style={{ marginTop: 10 }}>
        <label className="def-label">워커 비번</label>
        <span style={{ flex: 1, minWidth: 140, maxWidth: 240 }}>
          <PasswordInput value={pw} onChange={setPw} onEnter={() => void load(pw)}
            placeholder="워커 시크릿 ADMIN_PW" />
        </span>
        <button className="small primary" disabled={busy || !pw} onClick={() => void load(pw)}>확인</button>
      </div>
      )}

      {err && <p className="login-err">{err}</p>}

      {/* 발급한 임시 비번 — 목록과 따로 둔다(목록 재조회가 실패해도 사라지면 안 되는 값이다) */}
      {issued && (
        <div className="id-pw">
          <b>{issued.name}</b> 님의 임시 비밀번호 <code>{issued.pw}</code>
          <br />지금 복사해서 본인에게 전해주세요. <b>이 창을 닫으면 다시 못 봅니다</b> —
          잃어버리면 새로 발급하면 됩니다. 본인이 처음 로그인할 때 새 비밀번호를 정하게 돼 있고,
          <b> 7일 안에 로그인하지 않으면 만료</b>됩니다.
          <br />
          <button className="small" style={{ marginTop: 8 }}
            onClick={() => { void navigator.clipboard?.writeText(issued.pw); setIssued(null) }}>
            복사하고 닫기
          </button>
        </div>
      )}

      {data && data.dupNames.length > 0 && (
        <p className="login-err">
          이름이 겹친 길드원이 있어요 — {data.dupNames.join(' · ')}. 로그인은 이름으로 사람을 찾아서
          이 사람들은 <b>로그인할 수 없습니다.</b> [길드원] 명단에서 한쪽 이름을 고쳐 주세요.
        </p>
      )}

      {data && (
        <>
          <div className={`id-state ${data.on ? 'on' : ''}`} style={{ marginTop: 12 }}>
            {data.on
              ? <><b>로그인 검사 켜짐</b> — 아이디가 있어야 사이트가 열립니다.</>
              : <><b>로그인 검사 꺼짐</b> — 지금은 누구나 볼 수 있어요.
                  {data.offUntil
                    ? <> {when(data.offUntil)}에 저절로 다시 켜집니다.</>
                    : <> 아이디를 하나라도 만들면 검사가 저절로 켜집니다 — 명단을 다 심는 동안은
                        워커 시크릿으로 검사를 꺼 두세요(24시간 유지).</>}</>}
            <span className="spacer" />
            <button
              className={`small ${data.on ? 'danger' : 'primary'}`}
              disabled={busy || (!data.on && noId.length > 0)}
              onClick={() => {
                if (data.on) {
                  if (!confirm('검사를 끄면 누구나 점수·메모까지 볼 수 있게 됩니다.\n'
                    + '끄기는 영구 관리자만 할 수 있고, 24시간 뒤 저절로 다시 켜집니다. 끌까요?')) return
                } else if (!confirm(`지금 켜면 아이디 없는 사람은 사이트를 못 엽니다.\n아이디 ${data.members.filter((m) => m.hasId).length}명 발급됨. 켤까요?`)) return
                void act(() => setGate(!data.on))
              }}
            >{data.on ? '검사 끄기' : '검사 켜기'}</button>
          </div>

          {!data.on && noId.length > 0 && (
            <p className="muted" style={{ margin: '8px 0 0', fontSize: '0.85rem' }}>
              아직 아이디가 없는 길드원 {noId.length}명이 있어요 — {noId.map((m) => m.name).join(' · ')}.
              전원 발급해야 검사를 켤 수 있습니다.
            </p>
          )}

          <div className="id-rows">
            {data.members.map((m) => (
              <div key={m.id} className={`id-row ${m.excluded ? 'gone' : ''}`}>
                <span className="id-name">
                  {m.name}
                  {m.excluded && <span className="badge excluded" style={{ marginLeft: 6 }}>외부</span>}
                </span>
                <span className={`id-mark ${m.tmp ? 'tmp' : ''}`}>
                  {!m.hasId ? '아이디 없음' : m.tmp ? '임시 비번 (아직 안 바꿈 · 7일 뒤 만료)' : '사용 중'}
                  {m.owner && <span className="id-tag owner">영구 관리자</span>}
                  {m.staff && !m.admin && <span className="id-tag">운영진</span>}
                  {m.hasId && (
                    <span className="muted" style={{ marginLeft: 6, fontSize: '0.8rem' }}>
                      {m.lastAt ? `마지막 로그인 ${when(m.lastAt)}` : '로그인 기록 없음'}
                    </span>
                  )}
                </span>
                <span className="row" style={{ gap: 5 }}>
                  <label className="id-admin"
                    title={m.owner ? '영구 최고권한 — 해제할 수 없습니다' : '사이트 관리자 — 게임 직책과 별개'}>
                    <input type="checkbox" checked={m.admin} disabled={busy || m.owner}
                      onChange={(e) => {
                        const on = e.target.checked
                        // 명단에 있는 관리자만 센다 — 유령 id 는 힘이 없다
                        const left = data.admins.filter((n) => n !== m.id && !data.ghostAdmins.includes(n))
                        if (!on && !left.length && !confirm('관리자가 한 명도 없게 됩니다. 그래도 할까요?')) return
                        // 바뀐 것만 보낸다 — 목록 통째로 보내면 다른 관리자가 방금 한 변경을 덮는다
                        void act(() => changeSiteAdmins(on ? { add: [m.id] } : { remove: [m.id] }))
                      }} />
                    관리자
                  </label>
                  <button className="small" disabled={busy}
                    onClick={() => void act(async () => { setIssued({ name: m.name, pw: await issueId(m.id) }) })}>
                    {m.hasId ? '비번 재발급' : '아이디 만들기'}
                  </button>
                  {m.hasId && !m.owner && (
                    <button className="small" disabled={busy}
                      title="비번은 그대로 두고, 이 사람이 로그인해 둔 모든 기기에서 끊습니다"
                      onClick={() => { if (confirm(`'${m.name}' 님을 모든 기기에서 로그아웃시킬까요? 비번은 그대로라 다시 로그인하면 됩니다.`)) void act(() => kickMember(m.id)) }}>
                      로그아웃시키기
                    </button>
                  )}
                  {m.hasId && !m.owner && (
                    <button className="small danger" disabled={busy}
                      onClick={() => { if (confirm(`'${m.name}' 아이디를 없앨까요? 다시 못 들어옵니다.`)) void act(() => revokeIds([m.id])) }}>
                      ✕
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>

          {data.orphans.length > 0 && (
            <p className="muted" style={{ marginTop: 10, fontSize: '0.85rem' }}>
              명단에 없는데 아이디만 남은 계정 {data.orphans.length}개 — {data.orphans.join(' · ')}.
              이미 못 들어오지만 정리하려면{' '}
              <button className="small danger" disabled={busy}
                onClick={() => { if (confirm('남은 아이디를 모두 지울까요?')) void act(() => revokeIds(data.orphans)) }}>
                한 번에 지우기
              </button>
            </p>
          )}

          {data.ghostAdmins.length > 0 && (
            <p className="muted" style={{ marginTop: 10, fontSize: '0.85rem' }}>
              명단에 없는데 관리자 목록에만 남은 id {data.ghostAdmins.length}개 — {data.ghostAdmins.join(' · ')}.
              힘은 없지만(명단에 있어야 권한이 생깁니다) 정리하려면{' '}
              <button className="small danger" disabled={busy}
                onClick={() => { if (confirm('명단에 없는 관리자 id 를 목록에서 뺄까요?')) void act(() => changeSiteAdmins({ remove: data.ghostAdmins })) }}>
                목록에서 빼기
              </button>
            </p>
          )}

          {data.audit.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="muted" style={{ cursor: 'pointer' }}>관리 기록 (최근 {data.audit.length}건)</summary>
              <ul className="muted" style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: '0.85rem' }}>
                {data.audit.map((a, i) => <li key={i}>{auditText(a)}</li>)}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  )
}
