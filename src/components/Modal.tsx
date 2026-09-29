import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** 열려 있는 모달 스택 — ESC는 맨 위 모달 하나만 닫는다
 *  (영웅 피커에서 ESC를 눌렀는데 뒤의 편집 폼까지 닫혀 편집 내용이 날아가는 것 방지) */
const stack: object[] = []
/** 배경 스크롤 잠금은 겹친 모달 수를 세어 마지막 하나가 닫힐 때만 해제 */
let lockCount = 0
let prevOverflow = ''

/** 공용 모달 — 배경 클릭·ESC로 닫힘, 내용이 길면 내부 스크롤.
 *  body에 portal로 띄워 부모의 overflow/stacking 영향을 받지 않는다. */
export function Modal({
  title,
  desc,
  onClose,
  footer,
  wide,
  confirmClose,
  children,
}: {
  title: string
  desc?: string
  onClose: () => void
  footer?: ReactNode
  /** 편집처럼 폼이 넓어야 하는 화면 */
  wide?: boolean
  /** 값이 있으면 배경 클릭·ESC로 닫을 때 이 문구로 한 번 물어본다 (작성 중 내용 보호) */
  confirmClose?: string
  children: ReactNode
}) {
  const token = useRef({})
  const panelRef = useRef<HTMLDivElement>(null)
  // onClose가 렌더마다 새 함수여도 효과가 재실행되지 않게 ref로 최신값만 유지
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const confirmRef = useRef(confirmClose)
  confirmRef.current = confirmClose

  // 모달을 연 버튼을 커밋 전에 잡아둔다 (autoFocus가 먼저 실행되면 놓치기 때문)
  const openerRef = useRef<HTMLElement | null>(null)
  if (openerRef.current === null) openerRef.current = (document.activeElement as HTMLElement) ?? null

  function requestClose(): void {
    const msg = confirmRef.current
    if (msg && !window.confirm(msg)) return
    closeRef.current()
  }

  useEffect(() => {
    const me = token.current
    stack.push(me)

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && stack[stack.length - 1] === me) {
        e.stopPropagation()
        requestClose()
      }
    }
    document.addEventListener('keydown', onKey)

    if (lockCount === 0) {
      prevOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    lockCount += 1

    const opener = openerRef.current
    return () => {
      const i = stack.indexOf(me)
      if (i >= 0) stack.splice(i, 1)
      document.removeEventListener('keydown', onKey)
      lockCount = Math.max(0, lockCount - 1)
      if (lockCount === 0) document.body.style.overflow = prevOverflow
      opener?.focus?.()
    }
    // 마운트/언마운트에만 — onClose는 ref로 읽는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 포커스를 모달 안으로 (autoFocus가 이미 옮겼으면 그대로 둔다)
  useEffect(() => {
    const panel = panelRef.current
    if (!panel || panel.contains(document.activeElement)) return
    const first = panel.querySelector<HTMLElement>(
      'input:not([disabled]), textarea, select, button:not(.modal-x)',
    )
    ;(first ?? panel).focus()
  }, [])

  return createPortal(
    <div
      className="modal-backdrop"
      onClick={(e) => {
        // 모달 안에서 드래그하다 밖에서 손을 뗀 경우까지 닫히지 않게
        if (e.target === e.currentTarget) requestClose()
      }}
    >
      <div
        ref={panelRef}
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // 탭이 배경으로 새지 않게 모달 안에서 순환
          if (e.key !== 'Tab') return
          const items = panelRef.current?.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
          )
          if (!items || items.length === 0) return
          const first = items[0]
          const last = items[items.length - 1]
          if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        }}
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {desc && <p className="modal-desc">{desc}</p>}
          </div>
          <button className="modal-x" onClick={requestClose} aria-label="닫기">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
