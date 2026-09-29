import { useState } from 'react'
import type { Hero } from '../types'

/** 역할군 → 아이콘 번호 (게임 아이콘 순서) */
const ROLE_ICON: Record<string, string> = {
  공격형: '01', 마법형: '02', 방어형: '03', 지원형: '04', 만능형: '05',
}

// vite base가 './' 라 상대 경로 그대로 쓰면 하위 경로 배포(GitHub Pages)에서도 맞는다
const url = (p: string) => p

/**
 * 영웅 카드.
 *
 * 게임 카드와 같은 5겹 구성이다 — 등급 배경 / 카드 아트 / 특수 배지 / 역할 아이콘 / 별 등급.
 * 겹치는 위치는 실제 게임 UI 비율을 그대로 따랐다(세로가 가로의 약 1.24배).
 *
 * 파일 위치
 *   public/heroes/{id}.card.webp   카드 아트 (없으면 {id}.png 초상화로 대체)
 *   public/hero-card/*.webp        배경·아이콘·별·배지 (11개, 합쳐서 35KB)
 *
 * 파일명은 글자·숫자만 남기고 밑줄로 바꿨다 — '브란즈&브란셀'의 & 가 URL에서 걸렸었다.
 */
export function HeroPortrait({
  hero,
  name,
  size = 34,
  /** 프레임 없이 그림만 (좁은 자리용) */
  plain = false,
}: {
  hero?: Hero
  name: string
  /** 카드 가로 픽셀. 세로는 비율대로 따라간다 */
  size?: number
  plain?: boolean
}) {
  const [artFailed, setArtFailed] = useState(false)
  const id = hero?.id ?? name
  const file = encodeURIComponent(id.replace(/[^\p{L}\p{N}]+/gu, '_'))

  // 카드 아트가 없는 영웅(손오공·윤건)은 초상화로, 그것도 없으면 글자로 떨어진다
  const art = artFailed ? url(`heroes/${file}.png`) : url(`heroes/${file}.card.webp`)
  const [dead, setDead] = useState(false)

  const initial = (hero?.name ?? name).replace(/^각성\s*/, '').slice(0, 1)

  if (plain) {
    const style = { width: size, height: size } as const
    if (dead) {
      return <span className="hero-portrait fallback" style={style} aria-hidden>{initial}</span>
    }
    return (
      <img
        className="hero-portrait"
        style={style}
        src={art}
        alt=""
        decoding="async"
        onError={() => (artFailed ? setDead(true) : setArtFailed(true))}
      />
    )
  }

  const roleIcon = ROLE_ICON[hero?.position ?? '']
  const bg = hero?.cardBg ?? '04'
  const star = hero?.star
  const badge = hero?.cardBadge

  return (
    <span className="hero-card" style={{ width: size }} aria-hidden>
      <img className="hc-bg" src={url(`hero-card/grade_GradeBG${bg}.webp`)} alt="" decoding="async" />
      {dead ? (
        // 그림이 없어도 프레임은 유지한다 — 카드 하나만 모양이 달라지면 더 튄다
        <span className="hc-art none">{initial}</span>
      ) : (
        <img
          className="hc-art"
          src={art}
          alt=""
          decoding="async"
          onError={() => (artFailed ? setDead(true) : setArtFailed(true))}
        />
      )}
      {badge && <img className="hc-badge" src={url(`hero-card/badge_SPBG${badge}.webp`)} alt="" decoding="async" />}
      {roleIcon && <img className="hc-role" src={url(`hero-card/role_RoleIcon_${roleIcon}.webp`)} alt="" decoding="async" />}
      {star && <img className="hc-star" src={url(`hero-card/stars_Star_M${star}.webp`)} alt="" decoding="async" />}
    </span>
  )
}
