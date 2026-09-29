import { Component, type ReactNode } from 'react'

/** 렌더 중 오류가 나도 사이트 전체가 백지가 되지 않게 하는 방어벽.
 *  (오염된 공유 데이터 등) — 새로고침/로컬 데이터 초기화로 복구 유도. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { err?: Error }> {
  state: { err?: Error } = {}

  static getDerivedStateFromError(err: Error) {
    return { err }
  }

  render() {
    if (this.state.err) {
      return (
        <div className="card">
          <h2>⚠️ 화면을 그리다 문제가 생겼어요</h2>
          <p className="muted">
            공유 데이터가 잠시 손상됐거나 브라우저 캐시가 꼬였을 수 있어요.
            새로고침으로 해결되지 않으면 로컬 데이터를 비우고 다시 받아보세요.
            (로컬 초기화는 이 브라우저 캐시만 지우고, 길드 공유 데이터는 그대로예요.)
          </p>
          <p className="muted" style={{ fontSize: '0.8rem' }}>{String(this.state.err?.message ?? this.state.err)}</p>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" onClick={() => location.reload()}>새로고침</button>
            <button className="danger" onClick={() => {
              try {
                localStorage.removeItem('sena-guild-war:v1')
                localStorage.removeItem('sena-guild-war:rev')
              } catch { /* noop */ }
              location.reload()
            }}>로컬 데이터 비우고 새로고침</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
