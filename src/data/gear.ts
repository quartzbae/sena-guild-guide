// 길드전·공성전 세팅에서 쓰는 고정 목록.
// 게임에 정해져 있는 값이라 사용자가 늘릴 일이 없어 코드에 둔다.
// (영웅·카운터덱처럼 계속 늘어나는 건 JSON + 공유 저장소로 간다)

/** 장비 세트 */
export const GEAR_SETS = [
  '선봉장', '추적자', '성기사', '수문장', '수호자', '암살자', '복수자', '주술사', '조율자',
] as const

/**
 * 반지 — 길드전에서 실제로 쓰는 것만 남겼다.
 *
 * 예전 목록에 있던 '상태이상'·'출혈&화상'·'토벌&공성' 은 뺐다. 길드전에서 안 쓰는데
 * 칸만 차지해서, 고를 때 눈이 한 번 더 걸렸다.
 *
 * 공성전도 같은 편집기를 쓴다 — 거기서 다른 반지가 필요해지면 목록을 넘길 인자부터
 * 만들어야 한다. RingPicker 가 이 상수를 직접 import 하고 있어서, LoadoutEditor →
 * GearTabs → RingPicker 로 내려보내는 길이 아직 없다.
 */
export const RINGS = [
  '권능', '불사', '부활', '즉사', '벞제', '디버프', '기합', '철벽',
] as const

/** 반지 성급 — 같은 반지도 성급에 따라 값이 달라서 같이 적는다 */
export const RING_STARS = ['6성', '5성', '4성'] as const

/** 무기 주옵션 */
export const WEAPON_OPTIONS = [
  '약점 공격 확률', '치명타 확률', '치명타 피해', '모든 공격력(%)', '효과 적중', '방어력(%)', '생명력(%)',
] as const

/** 전장 조율 칸 수 */
export const ATTUNE_SLOTS = 4

/**
 * 부세공·조율에 적는 능력치 이름 — 고르는 게 아니라 직접 쓰되 자동완성으로만 돕는다.
 * 게임의 정확한 옵션 목록을 확인하지 못해서 목록으로 묶어 강제하지 않는다.
 */
export const STAT_HINTS = [
  '공격력', '방어력', '생명력', '속공',
  '치명타 확률', '치명타 피해', '약점 공격 확률', '막기 확률',
  '받는 피해 감소', '효과 적중', '효과 저항',
] as const

/** 방어구 주옵션 */
export const ARMOR_OPTIONS = [
  '받는 피해 감소', '막기 확률', '모든 공격력(%)', '방어력(%)', '생명력(%)', '효과 저항',
] as const

/** 공성전 요일별 보스 — 요일이 고정이라 표처럼 쓴다 */
export const SIEGE_BOSSES: Array<{ day: string; boss: string; type: string }> = [
  { day: '월', boss: '루디', type: '마법' },
  { day: '화', boss: '아일린', type: '마법' },
  { day: '수', boss: '레이첼', type: '마법' },
  { day: '목', boss: '델론즈', type: '물리' },
  { day: '금', boss: '제이브', type: '물리' },
  { day: '토', boss: '스파이크', type: '물리' },
  { day: '일', boss: '크리스', type: '단일' },
]

export const bossOf = (day: string) => SIEGE_BOSSES.find((b) => b.day === day)

/** 길드전은 3v3 */
export const WAR_DECK_SIZE = 3
/** 공성전 편성 인원 */
export const SIEGE_DECK_SIZE = 5

/**
 * 턴 타임라인에서 고를 수 있는 턴.
 * 스킬 쿨이 4턴이라 0·4·8…68 로 끊어 쓴다 (전 턴을 다 늘어놓으면 고르기만 힘들다).
 */
export const SIEGE_TURNS = Array.from({ length: 18 }, (_, i) => i * 4)

/** 방어 세팅 타입 — 속공과 내실 사이를 반반 가는 '속내실' 이 실제로 제일 흔하다 */
export const DEFENSE_STYLES = ['속공', '속내실', '내실'] as const

/** 진형 — 게임에 정해진 네 가지. 자유 입력도 같이 받는다('보호진형(멜키르)' 같은 메모) */
export const FORMATIONS = ['기본진형', '공격진형', '밸런스진형', '보호진형'] as const

/** 덱 유형 — 이 덱이 뭘로 이기는 덱인지 */
export const DECK_TYPES = ['공덱', '마덱', '방덱', '즉사덱', '하이브리드'] as const
