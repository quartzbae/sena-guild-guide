// 미니멀 라인 아이콘 (currentColor 사용)
const PATHS: Record<string, string> = {
  home: 'M4 11 12 4l8 7M6 9.5V20h12V9.5',
  target:
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z',
  shield: 'M12 3.5 5.5 6v5.2c0 4.3 2.8 7 6.5 8.3 3.7-1.3 6.5-4 6.5-8.3V6L12 3.5Z',
  book: 'M12 6C10.5 5 8 4.5 5 4.5V18c3 0 5.5.5 7 1.5 1.5-1 4-1.5 7-1.5V4.5c-3 0-5.5.5-7 1.5ZM12 6v13.5',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4.2-4.2',
  users:
    'M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 19.5c0-2.9 2.5-4.5 5.5-4.5s5.5 1.6 5.5 4.5M16 11.2a2.6 2.6 0 1 0-1-5M18.2 15c2.1.3 3.3 1.9 3.3 4.5',
  data: 'M12 3.2c3.9 0 7 1.2 7 2.8s-3.1 2.8-7 2.8-7-1.2-7-2.8 3.1-2.8 7-2.8ZM5 6v12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8V6M5 12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8',
  menu: 'M4 7h16M4 12h16M4 17h16',
  siege: 'M6 21V3M6 4h11l-2.5 4L17 12H6',
  destroyer: 'M12 21a5 5 0 0 0 5-5c0-4-3-5.5-3-9-2 1-3 3-3 5-1-1-1.5-2-1.5-3.2C6.5 11 7 13 7 16a5 5 0 0 0 5 5Z',
  lock: 'M7 10V7.5a5 5 0 0 1 10 0V10M5.5 10h13a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1ZM12 14.5v2.5',
  // 결투장 — 교차한 검 두 자루
  arena: 'M4 4h3l10.5 10.5M20 4h-3L6.5 14.5M14.5 15 18 18.5l-2 2-3.5-3.5M9.5 15 6 18.5l2 2 3.5-3.5',
  // 사이드바 접기 — 세로선 + 왼쪽 화살표
  collapse: 'M4.5 5v14M20 12H9.5M13 8l-3.5 4 3.5 4',
  // 커트라인 — 막대들 위를 가로지르는 기준선
  cutline: 'M5.5 20v-5.5M10.5 20V8.5M15.5 20v-8M20 20V6M3.5 13h17.5M3.5 20h17.5',
  // 테마 — 반쪽만 찬 원
  theme: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 3.5v17M12 6.6a5.4 5.4 0 0 1 0 10.8',
}

export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? ''} />
    </svg>
  )
}
