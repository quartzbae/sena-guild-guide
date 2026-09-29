import { Fragment } from 'react'

/** 초간단 마크다운 렌더러: ###제목, - 리스트, **굵게**, | 표 | 지원 */
export function Markdown({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/)
  return (
    <div className="guide-body">
      {blocks.map((block, i) => <Block key={i} block={block} />)}
    </div>
  )
}

function Block({ block }: { block: string }) {
  const lines = block.split('\n')

  if (lines.every((l) => l.trim().startsWith('|'))) {
    const rows = lines
      .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
      .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c)))
    // 구분선(|---|)만 있는 블록이면 행이 하나도 안 남는다. 그대로 head.map 을 부르면
    // undefined 에서 터지고, 이 글은 공유 데이터라 한 줄로 전원의 화면이 죽는다.
    if (!rows.length) return null
    const [head, ...body] = rows
    return (
      <div className="table-wrap">
        <table>
          <thead><tr>{head.map((c, i) => <th key={i}><Inline text={c} /></th>)}</tr></thead>
          <tbody>
            {body.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j}><Inline text={c} /></td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (lines[0].startsWith('### ')) {
    return (
      <>
        <h3>{lines[0].slice(4)}</h3>
        {lines.length > 1 && <Block block={lines.slice(1).join('\n')} />}
      </>
    )
  }

  if (lines.every((l) => l.trim().startsWith('- '))) {
    return (
      <ul>
        {lines.map((l, i) => <li key={i}><Inline text={l.trim().slice(2)} /></li>)}
      </ul>
    )
  }

  return (
    <p>
      {lines.map((l, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          <Inline text={l} />
        </Fragment>
      ))}
    </p>
  )
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={i}>{p.slice(2, -2)}</strong>
          : <Fragment key={i}>{p}</Fragment>,
      )}
    </>
  )
}
