import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { navigate, useRoute } from './router'
import { Icon } from './components/Icon'
import { ErrorBoundary } from './components/ErrorBoundary'
import { HomePage } from './pages/Home'
import { CutlinesPage } from './pages/Cutlines'
import { CountersPage } from './pages/Counters'
import { HeroesPage } from './pages/Heroes'
import { StatsPage } from './pages/Stats'
import { MembersPage } from './pages/Members'
import { SettingsPage } from './pages/Settings'
import { WarDefensePage } from './pages/WarDefense'
import { WarAttackPage } from './pages/WarAttack'
import { isAdmin } from './auth'
import { MemberLoginPage } from './pages/MemberLogin'
import { clearSession, isLoggedIn, isStaff, logoutAll, onAuthLost, onRoleChange } from './session'
import { clearSaveError, useGuildName, useSaveError } from './store'

interface MenuItem {
  route: string
  label: string
  icon: string
  admin?: boolean
  /** 운영진(길드마스터·부길드마스터)에게만 보이는 메뉴 */
  staff?: boolean
  /** 사이드바에서 이 항목 위에 그룹 제목을 넣는다 */
  group?: string
}

const MENU: MenuItem[] = [
  { route: 'home', label: '홈', icon: 'home' },
  { route: 'counters', label: '카운터덱', icon: 'target', group: '대전' },
  { route: 'heroes', label: '영웅 · 덱', icon: 'shield' },
  { route: 'warattack', label: '길드전 공격', icon: 'target', group: '길드전 세팅' },
  { route: 'wardefense', label: '길드전 방어', icon: 'shield' },
  // 점수 기록은 운영진만 본다. 워커가 이 세 메뉴가 쓰는 칸을 아예 안 내려보내므로
  // 메뉴를 감추지 않으면 빈 화면만 보게 된다.
  { route: 'siege', label: '공성전', icon: 'siege', staff: true, group: '길드 기록' },
  { route: 'destroyer', label: '파괴신', icon: 'destroyer', staff: true },
  { route: 'cutlines', label: '커트라인', icon: 'cutline', staff: true },
  { route: 'members', label: '길드원', icon: 'users', admin: true, group: '운영' },
  { route: 'settings', label: '데이터', icon: 'data', admin: true },
]

// 모바일 하단 탭은 5칸(4 + 더보기) — 자주 쓰는 대전 콘텐츠를 앞에 두고 나머지는 '더보기'로
const PRIMARY = ['home', 'counters', 'heroes', 'wardefense']
const SECONDARY = ['warattack', 'siege', 'destroyer', 'cutlines']
const ADMIN_ITEMS = MENU.filter((m) => m.admin)
const fullLabel = (label: string) =>
  ({ 데이터: '데이터 관리', 길드원: '길드원 관리', 공성전: '공성전 통계', 파괴신: '파괴신 통계', 커트라인: '커트라인 기준' } as Record<string, string>)[label] ?? label
const ROUTES = MENU.map((m) => m.route)

const Brand = () => (
  <span className="logo">
    <span className="em" aria-hidden>⚔️</span>
    <span className="logo-t">{useGuildName()}</span>
  </span>
)

type SideMode = 'full' | 'rail'
const SIDE_KEY = 'sena-guild-war:side'

/** 테마 — 자단(밝음) / 야청(어두움) */
type Theme = 'jadan' | 'yacheong'
const THEME_KEY = 'sena-guild-war:theme'
const THEME_LABEL: Record<Theme, string> = { jadan: '자단', yacheong: '야청' }

/**
 * 기기 설정을 따른다 — 라이트 모드면 자단, 다크 모드면 야청.
 * 사용자가 한 번 고르면 그 선택이 기기 설정을 이긴다.
 *
 * CSS도 같은 규칙(:root=자단 / @media dark=야청 / [data-theme=yacheong]=야청)을
 * 갖고 있어서 스크립트가 붙기 전 첫 페인트부터 올바른 테마로 그려진다.
 * 여기서는 '지금 적용된 테마'를 속성으로 확정해 아이콘·상단바 색을 맞춘다.
 */
function useTheme(): [Theme, () => void] {
  const [pref, setPref] = useState<Theme | null>(() => {
    try {
      const v = localStorage.getItem(THEME_KEY)
      return v === 'jadan' || v === 'yacheong' ? v : null
    } catch {
      return null
    }
  })
  const [sys, setSys] = useState<Theme>(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'yacheong' : 'jadan',
  )

  // 고른 적이 없을 때만 기기 설정 변화를 따라간다
  useEffect(() => {
    if (pref) return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => setSys(mql.matches ? 'yacheong' : 'jadan')
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [pref])

  const theme = pref ?? sys

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    // 모바일 브라우저 상단 바 색까지 맞춘다
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === 'yacheong' ? '#15171a' : '#f8f5f4')
  }, [theme])

  const toggle = (): void => {
    const next: Theme = theme === 'jadan' ? 'yacheong' : 'jadan'
    setPref(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      /* 시크릿 모드 등 — 이번 세션에만 적용 */
    }
  }

  return [theme, toggle]
}

/**
 * 사이드바 펼침/접힘. 기본은 접힘(아이콘 레일) — 화면 폭과 무관하게 이 사이트의 기본값이다.
 * 사용자가 펼치면 그 선택을 계속 따른다.
 * CSS의 기본값도 레일이라, 스크립트가 붙기 전에 메뉴가 펼쳐졌다 접히는 깜빡임이 없다.
 */
function useSidebarMode(): [SideMode, () => void] {
  const [mode, setMode] = useState<SideMode>(() => {
    try {
      const v = localStorage.getItem(SIDE_KEY)
      return v === 'full' || v === 'rail' ? v : 'rail'
    } catch {
      return 'rail'
    }
  })

  // data-side를 DOM에 쓰는 일은 Sidebar가 맡는다 — 표시자 위치를 재기 '전에'
  // 속성이 적용돼야 해서, 측정하는 쪽과 같은 레이아웃 이펙트 안에서 처리한다.

  const toggle = (): void => {
    const next: SideMode = mode === 'full' ? 'rail' : 'full'
    setMode(next)
    try {
      localStorage.setItem(SIDE_KEY, next)
    } catch {
      /* 시크릿 모드 등 — 이번 세션에만 적용 */
    }
  }

  return [mode, toggle]
}

/**
 * 사이드바 — 활성 항목을 따라 미끄러지는 표시자.
 * 항목 사이에 그룹 제목이 끼어 높이가 일정하지 않아, 위치를 실측해 CSS 변수로 넘긴다.
 */
function Sidebar({
  items,
  active,
  admin,
  loggedIn,
  mode,
  theme,
  onToggleTheme,
  onToggle,
  onLogout,
  onLogoutAll,
}: {
  items: MenuItem[]
  active: string
  admin: boolean
  /** 길드원으로 로그인해 있나 — 로그아웃 버튼을 관리자에게만 보여주면 안 된다 */
  loggedIn: boolean
  mode: SideMode
  theme: Theme
  onToggleTheme: () => void
  onToggle: () => void
  onLogout: () => void
  /** 모든 기기에서 로그아웃 — 잃어버린 폰·공용 PC 에 남은 로그인까지 끊는다 */
  onLogoutAll: () => void
}) {
  const navRef = useRef<HTMLElement | null>(null)
  const [ind, setInd] = useState<{ y: number; h: number } | null>(null)
  // 접힌 상태에서 아이콘에 커서를 올리면 나오는 이름표 (y = 항목의 세로 중심)
  const [flyout, setFlyout] = useState<{ y: number; label: string } | null>(null)

  // 접기/펼치기·페이지 이동으로 항목이 사라지면 이름표도 같이 거둔다
  useEffect(() => { setFlyout(null) }, [mode, active])

  /** 항목에 커서를 올렸을 때 이름표를 그 항목 높이에 맞춰 띄운다 */
  const showFlyout = (e: { currentTarget: HTMLElement }, label: string): void => {
    if (mode === 'full') return
    const r = e.currentTarget.getBoundingClientRect()
    setFlyout({ y: r.top + r.height / 2, label })
  }
  const hideFlyout = (): void => setFlyout(null)
  const flyoutProps = (label: string) => ({
    onMouseEnter: (e: { currentTarget: HTMLElement }) => showFlyout(e, label),
    onMouseLeave: hideFlyout,
    onFocus: (e: { currentTarget: HTMLElement }) => showFlyout(e, label),
    onBlur: hideFlyout,
  })

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    // ★ 접힘/펼침 속성을 먼저 반영한 뒤에 잰다.
    //   이 쓰기를 다른 이펙트에 두면(자식 이펙트가 부모보다 먼저 도는 탓에)
    //   그룹 제목이 나타나기 전 위치를 재게 되어 표시자가 엉뚱한 항목에 남는다.
    document.documentElement.dataset.side = mode
    const measure = (): void => {
      const el = nav.querySelector<HTMLElement>('.side-item.active')
      // 높이가 0이면 아직 레이아웃(또는 CSS)이 적용되기 전이라 표시자를 숨긴 채 다음 측정을 기다린다
      if (!el || el.offsetHeight === 0) { setInd(null); return }
      setInd((prev) =>
        prev && prev.y === el.offsetTop && prev.h === el.offsetHeight ? prev : { y: el.offsetTop, h: el.offsetHeight },
      )
    }
    measure()
    // 스타일·폰트가 늦게 적용되거나 접기/펼치기로 폭이 바뀔 때
    const ro = new ResizeObserver(measure)
    ro.observe(nav)
    // ★ 사이드바가 display:none(모바일 폭)에서 다시 보이게 될 때는 ResizeObserver가
    //   울리지 않는다. 창을 좁게 열었다 넓히면 표시자가 안 뜨므로 resize도 함께 듣는다.
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
    // 접기/펼치기로 항목 높이가 달라질 수 있어 mode도 의존성에 넣는다
  }, [active, items.length, mode])

  return (
    <aside className="sidebar">
      <button className="side-brand" onClick={() => navigate('home')} aria-label="홈으로">
        <Brand />
      </button>

      <nav className="side-nav" ref={navRef} aria-label="주 메뉴">
        {ind && (
          <span
            className="side-ind"
            // --ind-h: 접힌 상태에서 폭을 높이와 같게 잡아 정사각형으로 만들 때 쓴다
            style={{ transform: `translateY(${ind.y}px)`, height: ind.h, ['--ind-h' as string]: `${ind.h}px` }}
            aria-hidden
          />
        )}
        {items.map((m) => (
          <div key={m.route} className="side-slot">
            {m.group && <div className="side-group">{m.group}</div>}
            <button
              className={`side-item ${active === m.route ? 'active' : ''}`}
              aria-current={active === m.route ? 'page' : undefined}
              // 접힌 상태에선 라벨 폭이 0이라 이름이 비어 보인다 — 이름은 aria-label이 책임진다
              aria-label={m.label}
              onClick={() => navigate(m.route)}
              {...flyoutProps(m.label)}
            >
              <Icon name={m.icon} className="ic" />
              <span className="side-label">{m.label}</span>
            </button>
          </div>
        ))}
      </nav>

      <div className="side-foot">
        <button
          className="side-item side-theme"
          onClick={onToggleTheme}
          aria-label={`화면 ${THEME_LABEL[theme]} — 눌러서 ${THEME_LABEL[theme === 'jadan' ? 'yacheong' : 'jadan']}으로`}
          {...flyoutProps(`${THEME_LABEL[theme]} → ${THEME_LABEL[theme === 'jadan' ? 'yacheong' : 'jadan']}`)}
        >
          <Icon name="theme" className="ic" />
          <span className="side-label">{THEME_LABEL[theme]}</span>
        </button>
        <button
          className="side-item side-toggle"
          onClick={onToggle}
          aria-label={mode === 'full' ? '메뉴 접기' : '메뉴 펼치기'}
          aria-expanded={mode === 'full'}
          {...flyoutProps(mode === 'full' ? '메뉴 접기' : '메뉴 펼치기')}
        >
          <Icon name="collapse" className="ic" />
          <span className="side-label">메뉴 접기</span>
        </button>
        {loggedIn && (
          <button className="side-item side-lock" onClick={onLogout} aria-label="로그아웃" {...flyoutProps('로그아웃')}>
            <Icon name="lock" className="ic" />
            <span className="side-label">로그아웃</span>
          </button>
        )}
        {loggedIn && (
          <button className="side-item side-lock" onClick={onLogoutAll} aria-label="모든 기기에서 로그아웃"
            {...flyoutProps('모든 기기에서 로그아웃')}>
            <Icon name="users" className="ic" />
            <span className="side-label">모든 기기 로그아웃</span>
          </button>
        )}
      </div>

      {/* 이름표는 사이드바 안이 아니라 밖에 둔다 — .side-nav의 세로 스크롤에 가로로 잘리지 않게 */}
      <span className={`side-flyout ${flyout ? 'on' : ''}`} style={{ ['--fy' as string]: `${flyout?.y ?? 0}px` }} aria-hidden>
        {flyout?.label ?? ''}
      </span>
    </aside>
  )
}

export default function App() {
  const route = useRoute()
  const base = route.split('/')[0]
  const [sheet, setSheet] = useState(false)
  // 권한은 길드원 로그인에서만 온다. 로그인·로그아웃 둘 다 새로고침을 타므로
  // 상태로 들고 있을 이유가 없다.
  const admin = isAdmin()
  const [sideMode, toggleSide] = useSidebarMode()
  const [theme, toggleTheme] = useTheme()
  const guildName = useGuildName()

  // 브라우저 탭 제목 — index.html에 박힌 기본 제목을 길드 이름으로 덮는다
  useEffect(() => { document.title = `${guildName} · 세나 리버스 길드` }, [guildName])

  // 워커가 로그인을 요구하면 화면 전체를 로그인으로 돌린다.
  // 검사를 안 켠 동안은 이 알림이 오지 않으므로 아무 일도 일어나지 않는다.
  const [authLost, setAuthLost] = useState<'login' | 'gone' | null>(null)
  useEffect(() => onAuthLost(setAuthLost), [])
  // 워커가 '너 이제 관리자야'라고 알려주면 메뉴를 다시 그린다 — 재로그인 없이
  const [, bumpRole] = useState(0)
  useEffect(() => onRoleChange(() => bumpRole((v) => v + 1)), [])

  // 운영진이 아니면 점수 기록과 운영 메뉴를 아예 안 그린다
  const staff = isStaff()
  const visible = MENU.filter((m) => (!m.admin || admin) && (!m.staff || staff))
  const adminActive = ADMIN_ITEMS.some((m) => m.route === base)
  const moreActive = adminActive || SECONDARY.includes(base)
  const primaryIndex = PRIMARY.indexOf(base)

  // 페이지를 옮기면 맨 위에서 시작 — 긴 목록을 보다 이동했을 때 중간에 떨어지지 않게
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
  }, [base])

  /**
   * 로그아웃은 '이 브라우저에 아무것도 안 남는다'는 뜻이어야 한다.
   * 예전엔 관리자 UI 플래그만 지워서, 30일짜리 로그인 토큰과 마지막으로 받은
   * 길드 데이터 사본(닉네임·점수·운영진 메모)이 그대로 남았다. 공용 PC 에서
   * 탭만 닫고 자리를 뜨면 다음 사람이 그대로 그 사람 계정이 됐다.
   */
  function doLogout() {
    clearSession()      // 토큰 · 이름 · 권한 플래그 · 워커 비번 · 공유 데이터 사본
    location.hash = '#/home'
    location.reload()   // 메모리에 남은 상태까지 확실히 턴다
  }

  /**
   * 모든 기기에서 로그아웃.
   * 위 로그아웃은 이 브라우저만 지운다 — 토큰은 서버에 상태가 없는 30일짜리라, 잃어버린
   * 폰이나 공용 PC 에 남은 로그인은 그대로 살아 있었다. 워커가 세션 버전을 올려 전부 끊는다.
   */
  async function doLogoutAll() {
    if (!confirm('이 계정으로 로그인해 둔 모든 기기(폰·PC)에서 로그아웃합니다. 할까요?')) return
    try {
      await logoutAll()
    } catch (e) {
      // ★ 조용히 넘어가면 안 된다 — 다른 기기의 로그인이 그대로 살아 있는데 끊긴 줄 알게 된다.
      //   이 브라우저는 logoutAll 의 finally 가 지운다.
      alert(`다른 기기에서는 로그아웃하지 못했어요: ${e instanceof Error ? e.message : String(e)}\n`
        + '이 기기에서만 로그아웃됐습니다. 다시 로그인한 뒤 한 번 더 시도하거나, 관리자에게 강제 로그아웃을 부탁하세요.')
    }
    location.hash = '#/home'
    location.reload()
  }

  // 로그인이 풀리면 사이트 전체를 가린다 — 읽기도 막는 게 목적이라 화면부터 덮는다.
  //
  // ★ 토큰이 없으면 워커 응답을 기다리지 않고 그 자리에서 막는다(fail-closed).
  //   authLost 만 보던 때는 401 이 도착할 때까지 사이트가 그대로 그려졌고,
  //   워커에 아예 못 닿으면(pull 의 catch 가 오프라인으로 삼킨다) 401 이 영영
  //   안 와서 문이 열린 채로 남았다. 워커를 못 믿는 상황일수록 닫혀 있어야 한다.
  if (authLost || !isLoggedIn()) {
    return <MemberLoginPage reason={authLost ?? 'login'} onDone={() => { setAuthLost(null); location.reload() }} />
  }

  return (
    <>
      <SaveErrorBanner />
      <Sidebar
        items={visible}
        active={base}
        admin={admin}
        loggedIn={isLoggedIn()}
        mode={sideMode}
        theme={theme}
        onToggleTheme={toggleTheme}
        onToggle={toggleSide}
        onLogout={doLogout}
        onLogoutAll={() => void doLogoutAll()}
      />

      {/* 모바일 상단 앱바 */}
      <header className="mobile-appbar">
        <Brand />
      </header>

      <main>
        {/* key={base}: 오류가 나도 다른 페이지로 이동하면 오류 상태가 풀리고, 전환 애니메이션도 다시 돈다 */}
        <ErrorBoundary key={base}>
          <div className="page" key={route}>
            <>
                {base === 'home' && <HomePage />}
                {base === 'counters' && <CountersPage />}
                {base === 'heroes' && <HeroesPage />}
                {/* ★ admin 라우트처럼 렌더에서도 막는다. 메뉴만 감추면 해시를 직접 쳐서 들어올
          수 있고, 평소엔 워커가 STAFF_ONLY_FIELDS 를 안 내려보내 빈 표가 나오지만
          pull 이 멈춘 동안(rev 꼬임·오프라인)에는 localStorage 에 남은 강등 전 사본이
          그대로 그려졌다. */}
      {base === 'siege' && (staff ? <StatsPage kind="siege" /> : <HomePage />)}
                {base === 'destroyer' && (staff ? <StatsPage kind="destroyer" /> : <HomePage />)}
                {base === 'cutlines' && (staff ? <CutlinesPage /> : <HomePage />)}
                {base === 'wardefense' && <WarDefensePage />}
                {base === 'warattack' && <WarAttackPage />}
                {/* 운영 메뉴는 워커가 실제로 막는다 — 여기 검사는 화면을 안 그리는 용도다 */}
                {base === 'members' && (admin ? <MembersPage /> : <HomePage />)}
                {base === 'settings' && (admin ? <SettingsPage /> : <HomePage />)}
                {!ROUTES.includes(base) && <HomePage />}
            </>
          </div>
        </ErrorBoundary>
      </main>

      <div className="footer-note">
        {guildName} · 세븐나이츠 리버스 길드 사이트 — 길드전 · 공성전 · 파괴신을 한곳에서.
      </div>

      {/* 모바일 하단 탭바 */}
      <nav className="bottom-nav" style={{ ['--i' as string]: primaryIndex < 0 ? 4 : primaryIndex }}>
        {primaryIndex >= 0 && <span className="bn-ind" aria-hidden />}
        {PRIMARY.map((r) => {
          const m = MENU.find((x) => x.route === r)!
          return (
            <button key={r} className={base === r ? 'active' : ''} onClick={() => navigate(r)}>
              <Icon name={m.icon} className="ic" />
              {m.label}
            </button>
          )
        })}
        <button className={moreActive ? 'active' : ''} onClick={() => setSheet(true)}>
          <Icon name="menu" className="ic" />
          더보기
        </button>
      </nav>

      {/* 더보기 시트 */}
      {sheet && (
        <>
          <div className="sheet-backdrop" onClick={() => setSheet(false)} />
          <div className="sheet" role="dialog" aria-label="더보기 메뉴">
            <div className="sheet-handle" />
            <div className="stagger">
              {/* 운영진 전용 메뉴는 여기서도 뺀다 — 사이드바에서만 감추면 모바일에서 새어 나간다 */}
              {SECONDARY.filter((r) => visible.some((m) => m.route === r)).map((r) => {
                const m = MENU.find((x) => x.route === r)!
                return (
                  <button
                    key={r}
                    className={`sheet-item ${base === r ? 'active' : ''}`}
                    onClick={() => { navigate(r); setSheet(false) }}
                  >
                    <Icon name={m.icon} className="ic" />
                    {fullLabel(m.label)}
                  </button>
                )
              })}
              <div className="sheet-sep" />
              <button className="sheet-item" onClick={toggleTheme}>
                <Icon name="theme" className="ic" />
                화면 · <b>{THEME_LABEL[theme]}</b>
                <em className="sheet-hint">눌러서 {THEME_LABEL[theme === 'jadan' ? 'yacheong' : 'jadan']}으로</em>
              </button>
              <div className="sheet-sep" />
              {admin && ADMIN_ITEMS.map((m) => (
                <button
                  key={m.route}
                  className={`sheet-item ${base === m.route ? 'active' : ''}`}
                  onClick={() => { navigate(m.route); setSheet(false) }}
                >
                  <Icon name={m.icon} className="ic" />
                  {fullLabel(m.label)}
                </button>
              ))}
              {isLoggedIn() && (
                <button className="sheet-item" onClick={() => { doLogout(); setSheet(false) }}>
                  <Icon name="lock" className="ic" />
                  로그아웃
                </button>
              )}
              {isLoggedIn() && (
                <button className="sheet-item" onClick={() => { setSheet(false); void doLogoutAll() }}>
                  <Icon name="users" className="ic" />
                  모든 기기에서 로그아웃
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}

/**
 * 공유 저장소에 저장이 실패했을 때 띄우는 띠.
 *
 * 저장은 1.2초 몰아치기로 화면 뒤에서 일어난다. 예전엔 실패해도 아무 표시가 없어서
 * 저장된 줄 알고 화면을 닫았고, 그 입력이 그대로 사라졌다. (게다가 실패한 저장이
 * 로컬 rev 만 올려놔서 그 브라우저는 이후 공유 데이터를 영영 못 받았다 — store 의
 * push() 주석 참고)
 */
function SaveErrorBanner() {
  const err = useSaveError()
  if (!err) return null
  return (
    <div className="save-error" role="alert">
      <b>저장 안 됨</b> — {err}
      <button className="small" onClick={clearSaveError}>닫기</button>
    </div>
  )
}
