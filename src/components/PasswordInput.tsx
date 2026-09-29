import { useId, useState } from 'react'

/**
 * 비밀번호 칸 — 눈 아이콘을 누르면 글자가 보인다.
 *
 * 운영진이 발급한 임시 비번은 옮겨 적는 값이라(FKYFNQSY 같은 8자리) 가려두면
 * 오타를 내고도 어디가 틀렸는지 알 수가 없다. 보이게 할 수단을 준다.
 *
 * 기본은 가림이다. 누가 옆에서 볼 수도 있으니 보이는 상태로 시작하지 않는다.
 */
export function PasswordInput({ value, onChange, autoComplete, autoFocus, placeholder, onEnter }: {
  value: string
  onChange: (v: string) => void
  autoComplete?: string
  autoFocus?: boolean
  placeholder?: string
  onEnter?: () => void
}) {
  const [shown, setShown] = useState(false)
  const id = useId()

  return (
    <div className="pw-field">
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter() }}
      />
      <button
        type="button"
        className="pw-eye"
        aria-controls={id}
        aria-pressed={shown}
        aria-label={shown ? '비밀번호 가리기' : '비밀번호 보기'}
        title={shown ? '가리기' : '보기'}
        onClick={() => setShown((v) => !v)}
      >
        {shown ? (
          // 가리기 — 눈에 빗금
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M10.6 6.2A9.7 9.7 0 0112 6c5 0 9 4.5 9 6 0 .7-.9 2-2.3 3.2M6.3 8.2C4.1 9.6 3 11.3 3 12c0 1.5 4 6 9 6 1.4 0 2.6-.3 3.7-.8" />
            <path d="M9.9 9.9a3 3 0 004.2 4.2" />
            <path d="M4 4l16 16" />
          </svg>
        ) : (
          // 보기 — 눈
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
            <circle cx="12" cy="12" r="2.6" />
          </svg>
        )}
      </button>
    </div>
  )
}
