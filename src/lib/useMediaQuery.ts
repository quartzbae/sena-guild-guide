import { useEffect, useState } from 'react'

/** CSS 미디어쿼리 결과를 React 상태로 — 화면 폭에 따라 레이아웃을 통째로 바꿀 때 사용 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (): void => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    // 일부 환경(모바일 주소창 변화·개발자도구 기기 에뮬레이션)에선
    // change 이벤트가 오지 않아 레이아웃이 옛 상태로 남는다 — resize로 한 번 더 확인
    window.addEventListener('resize', onChange)
    window.addEventListener('orientationchange', onChange)
    return () => {
      mql.removeEventListener('change', onChange)
      window.removeEventListener('resize', onChange)
      window.removeEventListener('orientationchange', onChange)
    }
  }, [query])

  return matches
}
