import { useState } from 'react'
import { PasswordInput } from '../components/PasswordInput'
import { unlockGuestAccess } from '../guestAccess'
import { useGuildName } from '../store'

export function GuestLoginPage({ onDone }: { onDone: () => void }) {
  const guildName = useGuildName()
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')

  function enter(e: React.FormEvent) {
    e.preventDefault()
    if (!unlockGuestAccess(code)) {
      setErr('비밀번호가 맞지 않아요.')
      return
    }
    setErr('')
    onDone()
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <span aria-hidden>⚔️</span>
          <strong>{guildName}</strong>
        </div>
        <h1>길드원 입장</h1>
        <p className="login-desc">공유받은 비밀번호를 입력해주세요.</p>
        <form onSubmit={enter}>
          <label className="login-label">비밀번호</label>
          <PasswordInput value={code} onChange={setCode} autoFocus autoComplete="current-password"
            placeholder="비밀번호 입력" />
          {err && <p className="login-err">{err}</p>}
          <button className="primary login-go" disabled={!code}>들어가기</button>
        </form>
      </div>
    </div>
  )
}
