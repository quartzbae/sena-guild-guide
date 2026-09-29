// 가벼운 지인용 입장 화면이다. 정적 번들에 포함되므로 보안 비밀번호로 간주하면 안 된다.
const GUEST_CODE = 'guest'
const ADMIN_CODE = 'masterpass'
const GUEST_SESSION_KEY = 'sena-guild-guide:guest-access'
const ADMIN_SESSION_KEY = 'sena-guild-guide:admin-access'

export function hasGuestAccess(): boolean {
  try { return sessionStorage.getItem(GUEST_SESSION_KEY) === '1' } catch { return false }
}

export function hasAdminAccess(): boolean {
  try { return sessionStorage.getItem(ADMIN_SESSION_KEY) === '1' } catch { return false }
}

export function unlockGuestAccess(code: string): boolean {
  if (code === ADMIN_CODE) {
    try { sessionStorage.setItem(ADMIN_SESSION_KEY, '1') } catch { /* 이번 탭 메모리만으로 계속 */ }
    return true
  }
  if (code !== GUEST_CODE) return false
  try { sessionStorage.setItem(GUEST_SESSION_KEY, '1') } catch { /* 이번 탭 메모리만으로 계속 */ }
  return true
}

export function clearGuestAccess(): void {
  try {
    sessionStorage.removeItem(GUEST_SESSION_KEY)
    sessionStorage.removeItem(ADMIN_SESSION_KEY)
  } catch { /* noop */ }
}
