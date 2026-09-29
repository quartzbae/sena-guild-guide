import { useState } from 'react'
import { PasswordInput } from '../components/PasswordInput'
import { changePassword, login } from '../session'
import { useGuildName } from '../store'

/**
 * 길드원 로그인.
 *
 * 워커가 로그인을 요구할 때만(401/403) 이 화면이 뜬다. 검사를 안 켠 동안은
 * 아무도 이 화면을 안 본다 — 아이디를 다 나눠준 뒤에 켜는 순서라서.
 *
 * 임시 비밀번호로 들어오면 바로 새 비밀번호를 정하게 한다. 운영진이 발급한
 * 비번을 그대로 쓰면 운영진이 남의 계정으로 들어갈 수 있기 때문이다.
 */
export function MemberLoginPage({ reason, onDone }: {
  /** login = 로그인 필요 / gone = 명단에 없음 */
  reason: 'login' | 'gone'
  onDone: () => void
}) {
  const guildName = useGuildName()
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [changing, setChanging] = useState(false)
  const [next, setNext] = useState('')
  const [next2, setNext2] = useState('')

  async function doLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !pw) return
    setBusy(true); setErr('')
    try {
      const { mustChange } = await login(name, pw)
      if (mustChange) setChanging(true)
      else onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '로그인에 실패했어요.')
    } finally {
      setBusy(false)
    }
  }

  async function doChange(e: React.FormEvent) {
    e.preventDefault()
    // 워커도 같은 규칙으로 막는다(PW_MIN). 여기서는 왕복 전에 알려 주기만 한다.
    if (next.length < 8) { setErr('비밀번호는 8자 이상으로 해주세요.'); return }
    // 임시 비번을 그대로 쓰면 운영진이 아는 비번이 남는다 — 이 화면이 막으려던 상태다
    if (next === pw) { setErr('임시 비밀번호와 다르게 정해주세요.'); return }
    if (next !== next2) { setErr('새 비밀번호가 서로 달라요.'); return }
    setBusy(true); setErr('')
    try {
      await changePassword(pw, next)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '변경에 실패했어요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <span aria-hidden>⚔️</span>
          <strong>{guildName}</strong>
        </div>

        {changing ? (
          <>
            <h1>새 비밀번호를 정해주세요</h1>
            <p className="login-desc">
              지금 쓰신 건 운영진이 발급한 <b>임시 비밀번호</b>예요.
              본인만 아는 것으로 바꿔야 다른 사람이 못 들어옵니다.
            </p>
            <form onSubmit={doChange}>
              <label className="login-label">새 비밀번호 (8자 이상)</label>
              <PasswordInput value={next} onChange={setNext} autoFocus autoComplete="new-password" />
              <label className="login-label">한 번 더</label>
              <PasswordInput value={next2} onChange={setNext2} autoComplete="new-password" />
              {err && <p className="login-err">{err}</p>}
              <button className="primary login-go" disabled={busy}>
                {busy ? '바꾸는 중…' : '바꾸고 들어가기'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1>길드원 로그인</h1>
            <p className="login-desc">
              {reason === 'gone'
                ? '길드원 명단에 없어서 들어갈 수 없어요. 길드에 계신데 이 화면이 뜨면 운영진에게 말씀해주세요.'
                : '아이디는 게임 닉네임이에요. 비밀번호는 운영진에게 받으세요.'}
            </p>
            <form onSubmit={doLogin}>
              <label className="login-label">닉네임</label>
              <input value={name} autoFocus autoComplete="username"
                onChange={(e) => setName(e.target.value)} placeholder="게임에서 쓰는 닉네임" />
              <label className="login-label">비밀번호</label>
              <PasswordInput value={pw} onChange={setPw} autoComplete="current-password"
                placeholder="운영진에게 받은 비밀번호" />
              {err && <p className="login-err">{err}</p>}
              <button className="primary login-go" disabled={busy}>
                {busy ? '확인 중…' : '들어가기'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
