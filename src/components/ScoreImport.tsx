import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { matchName, readImage, type OcrRow } from '../lib/ocr'

/**
 * 받침 유무에 따라 조사를 고른다 ('점수를' / '딜량을').
 * 한글 음절은 U+AC00부터 28개 종성 단위로 배열돼 있어, 나머지가 0이면 받침이 없다.
 */
function josa(word: string, withFinal: string, withoutFinal: string): string {
  const c = word.charCodeAt(word.length - 1)
  const hangul = c >= 0xac00 && c <= 0xd7a3
  return hangul && (c - 0xac00) % 28 !== 0 ? withFinal : withoutFinal
}

/**
 * 결과 화면 캡처에서 닉네임·점수를 읽어 채우는 창.
 *
 * OCR은 틀릴 수 있으므로 **바로 반영하지 않는다**. 읽은 결과를 표로 보여주고,
 * 사람이 이름·점수를 고친 뒤 [적용]을 눌러야 입력칸에 들어간다.
 * 적용해도 아직 편집 중 상태라, 최종 반영은 기존처럼 [저장]을 눌러야 한다.
 */
export function ScoreImport({
  roster,
  extraNames,
  metric,
  targets,
  onApply,
  onClose,
}: {
  roster: string[]
  /**
   * 명단 밖이지만 이름은 아는 계정 (외부 처리한 길드원).
   * 판독 후보와 수동 선택 목록에는 넣되, '아직 안 나온 사람' 집계에는 넣지 않는다 —
   * 지금 길드에 없는 계정이라 캡처에 안 나오는 게 정상이기 때문.
   */
  extraNames?: string[]
  metric: string
  /**
   * 읽은 값을 어느 칸에 넣을지. 두 개 이상이면 사용자가 고른다.
   * 파괴신은 중간집계·최종 집계 두 칸이라, 안 물어보면 시즌 도중 캡처가
   * 최종 집계로 잘못 들어간다. 공성전은 칸이 하나라 생략한다.
   */
  targets?: Array<{ key: string; label: string }>
  /** count 는 파괴신 중간집계 캡처에서 읽은 '친 횟수' — 없을 수 있다 */
  onApply: (values: Array<{ name: string; value: number; count?: number }>, target: string) => void
  onClose: () => void
}) {
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [rows, setRows] = useState<OcrRow[] | null>(null)
  const [rawText, setRawText] = useState('')
  const [error, setError] = useState('')
  const [showRaw, setShowRaw] = useState(false)
  const [target, setTarget] = useState(targets?.[0]?.key ?? 'value')
  const fileRef = useRef<HTMLInputElement>(null)
  // 붙여넣기 리스너는 한 번만 등록되므로, 최신 값을 ref로 건네준다.
  // (예전엔 첫 렌더의 roster를 붙잡아 붙여넣기와 드롭이 다른 결과를 냈다)
  const runRef = useRef<(f: Blob) => Promise<void>>()
  const busyRef = useRef(false)

  // 미리보기 URL 정리
  useEffect(() => () => { if (imgUrl) URL.revokeObjectURL(imgUrl) }, [imgUrl])

  /** 이름을 붙여볼 후보 전체 (명단 + 외부 처리한 계정) */
  const extras = extraNames ?? []
  const candidates = extras.length ? [...roster, ...extras] : roster

  /**
   * 새로 읽은 행들을 기존 표에 합친다. 30명이 한 화면에 다 안 나와서
   * 스크롤하며 여러 장을 찍는 게 기본 사용법이다.
   * - 같은 사람이 두 장에 겹치면: 점수가 같으면 그대로, 다르면 새 값으로
   *   바꾸되 '확인 필요'를 붙인다 (조용히 덮어쓰지 않게)
   * - 이름을 못 붙인 줄은 그대로 쌓아 사람이 고르게 둔다
   */
  function mergeRows(prev: OcrRow[], added: OcrRow[]): OcrRow[] {
    const out = [...prev]
    for (const r of added) {
      if (r.matched) {
        const i = out.findIndex((p) => p.matched === r.matched)
        if (i >= 0) {
          if (out[i].score !== r.score) out[i] = { ...r, ambiguous: true }
          continue
        }
      }
      out.push(r)
    }
    // 점수 내림차순 = 순위순. 여러 장을 섞어 올려도 표가 게임 화면과 같은 순서가 된다
    return out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  }

  async function run(file: Blob) {
    if (busyRef.current) return // 읽는 중에 또 넣으면 워커가 겹쳐 폰에서 메모리가 터진다
    busyRef.current = true
    setError('')
    setBusy(true)
    setProgress(0)
    setStatus('준비 중')
    if (imgUrl) URL.revokeObjectURL(imgUrl)
    setImgUrl(URL.createObjectURL(file))
    try {
      const { rows: r, text } = await readImage(file, candidates, (p) => {
        setProgress(p.progress)
        setStatus(p.status)
      }, metric)
      setRawText(text)
      setRows((prev) => mergeRows(prev ?? [], r))
      if (r.length === 0) setError('이 캡처에서는 이름과 점수를 찾지 못했어요. 표가 크게 나오도록 잘라서 다시 올려보세요.')
    } catch (e) {
      setError(
        '글자를 읽는 데 실패했어요. 인터넷 연결을 확인해 주세요. (' +
          (e instanceof Error ? e.message : String(e)) +
          ')',
      )
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  runRef.current = run

  /** 여러 장을 한 번에 받아 차례로 읽는다 (동시에 돌리면 워커가 겹쳐 폰에서 메모리가 터진다) */
  async function runMany(files: File[]) {
    for (const f of files.filter((f) => f.type.startsWith('image/'))) await run(f)
  }
  /** 드롭된 것 중 이미지 전부 */
  const droppedFiles = (e: React.DragEvent) => [...(e.dataTransfer.files ?? [])]

  // 붙여넣기(Ctrl+V)로 바로 받기
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
      const file = item?.getAsFile()
      if (file) { e.preventDefault(); void runRef.current?.(file) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  const setRow = (i: number, patch: Partial<OcrRow>) =>
    setRows((prev) => (prev ? prev.map((r, j) => (j === i ? { ...r, ...patch } : r)) : prev))

  const usable = (rows ?? []).filter((r) => r.matched && typeof r.score === 'number')
  // 아직 어떤 캡처에도 안 나온 길드원 — 다음 장을 언제 찍을지 판단하는 근거
  const missing = rows ? roster.filter((n) => !usable.some((r) => r.matched === n)) : []
  // 같은 사람이 두 번 잡히면 뒤엣것이 덮어써서 조용히 틀릴 수 있으니 미리 알린다
  const dupes = [...new Set(usable.map((r) => r.matched).filter((n, i, a) => a.indexOf(n) !== i))]
  // 칸이 둘 이상일 때만 어디에 넣는지 밝힌다 (공성전은 칸이 하나라 군더더기)
  const targetLabel = targets && targets.length > 1 ? targets.find((t) => t.key === target)?.label : undefined
  // 친 횟수는 중간집계 칸에 넣을 때만 저장한다 — 그때만 칸을 보여 준다.
  // (최종 집계로 넣으면서 횟수 칸을 보여 주면 '읽었는데 왜 안 들어갔지' 가 된다)
  const showCount = target === 'mid'

  return (
    <Modal
      title={`캡처에서 ${metric} 읽기`}
      desc={`결과 화면을 캡처해 올리면 닉네임과 ${metric}${josa(metric, '을', '를')} 읽어 입력칸을 채웁니다. 한 화면에 다 안 나오면 스크롤해서 여러 장을 차례로 올리면 됩니다.`}
      onClose={onClose}
      wide
      footer={
        <>
          <button onClick={onClose}>취소</button>
          <button
            className="primary"
            disabled={usable.length === 0}
            onClick={() => {
              onApply(usable.map((r) => ({ name: r.matched as string, value: r.score as number, count: r.count })), target)
              onClose()
            }}
          >
            {usable.length > 0
              ? `${usable.length}명 ${targetLabel ? `${targetLabel}에 ` : ''}적용`
              : '적용'}
          </button>
        </>
      }
    >
      {/* 파괴신처럼 넣을 칸이 둘일 때 — 올리기 전에 정하고, 결과를 본 뒤에도 바꿀 수 있다 */}
      {targets && targets.length > 1 && (
        <div className="ocr-target">
          <span className="ocr-target-label">어느 칸에 넣을까요?</span>
          <div className="row" style={{ gap: 6 }}>
            {targets.map((t) => (
              <button
                key={t.key}
                className={`small ${target === t.key ? 'primary' : ''}`}
                onClick={() => setTarget(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ★ 파일 입력은 조건부 블록 밖에 둔다 — 안에 두었더니 첫 장을 읽은 뒤 블록이
          사라지면서 fileRef.current가 null이 되어, [＋ 다른 캡처 추가] 클릭이
          아무 반응 없이 무시됐다. multiple이라 한 번에 여러 장도 고를 수 있다. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const fs = [...(e.target.files ?? [])]
          e.target.value = '' // 같은 파일을 다시 골라도 onChange가 뜨게
          void runMany(fs)
        }}
      />

      {/* 아직 읽은 게 없을 때 (0명 인식으로 끝난 경우 포함 — 그때도 다시 올릴 길이 있어야 한다) */}
      {(!rows || rows.length === 0) && (
        <div
          className={`ocr-drop ${busy ? 'busy' : ''}`}
          onClick={() => !busy && fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            if (!busy) void runMany(droppedFiles(e))
          }}
        >
          <div className="ocr-drop-ic" aria-hidden>🖼</div>
          <strong>캡처 이미지를 여기에 끌어다 놓거나 클릭해서 고르세요</strong>
          <span className="muted">여러 장을 한 번에 골라도 되고, Ctrl+V 로 붙여넣어도 됩니다</span>
        </div>
      )}

      {busy && (
        <div className="ocr-progress">
          <div className="ocr-bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <span className="muted">{status} {Math.round(progress * 100)}%</span>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.82rem' }}>
            보통 몇 초면 끝납니다. 서버가 응답하지 않으면 브라우저에서 직접 읽는데, 그때는 30초쯤 걸려요.
          </p>
        </div>
      )}

      {error && <p className="ocr-error">{error}</p>}

      {imgUrl && rows && (
        <details className="fdetails">
          <summary>올린 이미지 보기</summary>
          <img src={imgUrl} alt="올린 캡처" className="ocr-preview" />
        </details>
      )}

      {rows && rows.length > 0 && (
        <>
          <div
            className={`ocr-more ${busy ? 'busy' : ''}`}
            onClick={() => !busy && fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (!busy) void runMany(droppedFiles(e))
            }}
          >
            ＋ 다른 캡처 추가 — 눌러서 고르거나, 끌어놓거나, Ctrl+V (여러 장도 한 번에, 자동으로 합쳐져요)
          </div>
          {missing.length > 0 && (
            <p className="ocr-missing">
              아직 없는 길드원 {missing.length}명: {missing.slice(0, 8).join(', ')}
              {missing.length > 8 && ` 외 ${missing.length - 8}명`}
            </p>
          )}
          <div className="hint-row">
            {usable.length}명 인식 · <b>이름이나 점수가 틀렸으면 여기서 고친 뒤 적용하세요.</b>
          </div>
          {dupes.length > 0 && (
            <p className="ocr-error">같은 사람이 여러 줄에 잡혔어요: {dupes.join(', ')} — 하나만 남기고 [건너뜀]으로 바꿔주세요.</p>
          )}
          <div className="table-wrap ocr-table">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '38%' }}>읽은 줄</th>
                  <th>길드원</th>
                  <th style={{ textAlign: 'right', width: 130 }}>{metric}</th>
                  {showCount && <th style={{ textAlign: 'right', width: 72 }} title="캡처의 'N회 도전'">횟수</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={r.matched ? '' : 'row-fail'}>
                    <td className="ocr-raw">
                      {r.raw}
                      {!r.matched && r.suggestion && (
                        <em className="ocr-guess"> 혹시 {r.suggestion}?</em>
                      )}
                    </td>
                    <td>
                      <select
                        value={r.matched ?? ''}
                        onChange={(e) => setRow(i, { matched: e.target.value || undefined, confidence: e.target.value ? 1 : 0 })}
                      >
                        <option value="">— 건너뜀 —</option>
                        {roster.map((n) => <option key={n} value={n}>{n}</option>)}
                        {extras.length > 0 && (
                          <optgroup label="외부 처리한 계정">
                            {extras.map((n) => <option key={n} value={n}>{n}</option>)}
                          </optgroup>
                        )}
                      </select>
                      {r.matched && (r.ambiguous || r.confidence < 0.85) && (
                        <em
                          className="ocr-warn"
                          title={
                            r.ambiguous
                              ? '비슷한 이름이 둘 이상이라 어느 쪽인지 확실하지 않아요'
                              : '글자가 정확히 일치하지 않아 비슷한 이름으로 맞춘 것'
                          }
                        >
                          확인 필요
                        </em>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        className="num-tab"
                        value={r.score ?? ''}
                        placeholder="0"
                        onChange={(e) => setRow(i, { score: e.target.value === '' ? undefined : Number(e.target.value) })}
                        style={{ width: 120, textAlign: 'right' }}
                      />
                    </td>
                    {showCount && (
                      <td style={{ textAlign: 'right' }}>
                        {/* 잘못 읽었으면 여기서 고친다 — 적용하면 중간집계 옆에 그대로 붙는다 */}
                        <input
                          type="number"
                          className="num-tab"
                          min={0}
                          value={r.count ?? ''}
                          placeholder="—"
                          onChange={(e) => setRow(i, { count: e.target.value === '' ? undefined : Number(e.target.value) })}
                          style={{ width: 60, textAlign: 'right' }}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="fdetails" open={showRaw} onToggle={(e) => setShowRaw((e.target as HTMLDetailsElement).open)}>
            <summary>읽은 원문 전체 (잘 안 맞을 때 확인용)</summary>
            <pre className="ocr-rawtext">{rawText}</pre>
          </details>

          <button className="small" style={{ marginTop: 10 }} onClick={() => { setRows(null); setError('') }}>
            전부 지우고 처음부터
          </button>
        </>
      )}
    </Modal>
  )
}

/** 이름만 따로 맞춰볼 때 (테스트·디버그용으로 내보냄) */
export { matchName }
