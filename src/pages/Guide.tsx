import { useState } from 'react'
import { INITIAL_GUIDES } from '../data/guide'
import { canEditStaff, newId, update, useUserData } from '../store'
import { Markdown } from '../components/Markdown'
import { Modal } from '../components/Modal'

export function GuidePage() {
  const { customGuides } = useUserData()
  const sections = [...INITIAL_GUIDES, ...customGuides]
  const [showAdd, setShowAdd] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>가이드</h1>
          <p className="page-desc">길드전 규칙과 운영 팁. 길드 자체 공략도 추가할 수 있어요.</p>
        </div>
        {canEditStaff() && <button className="primary" onClick={() => setShowAdd(true)}>+ 섹션 추가</button>}
      </header>

      <div className="doc-split">
        {/* 데스크톱: 왼쪽 고정 목차 / 모바일: 가로 스크롤 칩 */}
        <nav className="doc-toc" aria-label="목차">
          <div className="sec-label toc-label">목차</div>
          {sections.map((s) => (
            <button key={s.id} onClick={() => {
              const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
              document.getElementById(s.id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
            }}>
              {s.title}
            </button>
          ))}
        </nav>

        <div className="doc-body">
          {sections.map((s) => {
            const isCustom = customGuides.some((c) => c.id === s.id)
            return (
              <article className="doc-sec" key={s.id} id={s.id}>
                <div className="doc-sec-head">
                  <h2>{s.title}</h2>
                  {isCustom && canEditStaff() && (
                    <button className="small danger" onClick={() => {
                      if (confirm(`'${s.title}' 섹션을 삭제할까요?`)) {
                        update((d) => { d.customGuides = d.customGuides.filter((g) => g.id !== s.id) })
                      }
                    }}>삭제</button>
                  )}
                </div>
                <Markdown text={s.body} />
              </article>
            )
          })}
        </div>
      </div>

      {showAdd && (
        <Modal
          title="가이드 섹션 추가"
          desc="### 소제목 · - 리스트 · **강조** · | 표 | 문법을 쓸 수 있어요."
          onClose={() => setShowAdd(false)}
          confirmClose={title.trim() || body.trim() ? '작성 중인 내용이 있어요. 저장하지 않고 닫을까요?' : undefined}
          wide
          footer={
            <>
              <button onClick={() => setShowAdd(false)}>취소</button>
              <button className="primary" disabled={!title.trim() || !body.trim()} onClick={() => {
                update((d) => { d.customGuides.push({ id: newId('guide'), title: title.trim(), body }) })
                setTitle(''); setBody(''); setShowAdd(false)
              }}>추가</button>
            </>
          }
        >
          <label className="fld">제목
            <input autoFocus placeholder="섹션 제목" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="fld">내용
            <textarea
              placeholder={'### 소제목\n- 리스트\n**강조**\n| 표 | 헤더 |'}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              style={{ minHeight: 240 }}
            /></label>
        </Modal>
      )}
    </div>
  )
}
