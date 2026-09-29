// 초경량 해시 라우터 — GitHub Pages 등 정적 호스팅에서 새로고침해도 동작
import { useSyncExternalStore } from 'react'

function getHash(): string {
  return window.location.hash.replace(/^#\/?/, '') || 'home'
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function useRoute(): string {
  return useSyncExternalStore(subscribe, getHash)
}

export function navigate(route: string) {
  window.location.hash = `/${route}`
}
