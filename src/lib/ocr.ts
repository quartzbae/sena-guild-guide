// 게임 결과 화면 캡처에서 '닉네임 + 점수'를 읽어내는 도구.
//
// 브라우저 안에서 도는 OCR(tesseract.js)이라 서버도 API 키도 필요 없다.
//
// 통째로 읽어서 줄 단위로 자르는 방식은 이 화면에서 통하지 않는다. 실측해 보면
// 이름과 점수가 서로 다른 줄로 튀어나오고, 왼쪽 일러스트와 상단 재화 숫자까지
// 뒤섞인다. 그래서 **좌표로 행을 잡는다**:
//
//   1) 전체를 한 번 읽어 단어별 위치를 얻는다
//   2) 우측 정렬된 숫자 기둥 중 가장 행이 많은 것을 '점수 열'로 본다
//      (왼쪽 패널의 길드 점수·개인 점수는 행 수가 적어 자연히 탈락한다)
//   3) 그 기둥의 y좌표가 곧 각 행. 간격이 일정하므로 빠진 행은 메운다
//   4) 이름 칸 왼쪽 경계는 행별 글자 최소 x좌표의 중앙값으로 유도한다
//   5) 행마다 점수 칸·이름 칸만 잘라서 다시 읽는다
//
// 잘라서 읽는 게 핵심이다. 통짜로 읽으면 아바타 그림이 레이아웃 분석을 흐트러뜨려
// 이름이 절반쯤 깨지는데, 이름 칸만 떼어 주면 거의 그대로 읽힌다.

/** OCR이 읽어낸 한 줄 */
export interface OcrRow {
  /** 원본 줄 (사용자가 눈으로 대조할 수 있게 그대로 보관) */
  raw: string
  /** 이름으로 읽힌 부분 */
  readName: string
  /** 점수로 읽힌 부분 */
  score?: number
  /** 친 횟수 ('3회 도전') — 파괴신 캡처를 서버가 읽었을 때만 온다 */
  count?: number
  /** 명단에서 찾아낸 이름 (없으면 undefined) */
  matched?: string
  /** 매칭 신뢰도 0~1 */
  confidence: number
  /** 비슷한 후보가 둘 이상이라 사람이 봐야 하는 경우 */
  ambiguous?: boolean
  /** 단정은 못 하지만 가장 그럴듯한 이름 (고를 때 힌트) */
  suggestion?: string
  /** 목록에서 읽은 순위 (여러 장을 합칠 때 정렬용) */
  rank?: number
}

/** 길드원 랭킹으로 인정할 최대 순위 — 이보다 크면 다른 목록(개인 랭킹 등)으로 본다 */
const MAX_GUILD_RANK = 60

/**
 * 목록 맨 아래에 고정된 '본인 순위' 행을 떼어낸다.
 *
 * 게임 랭킹 화면은 스크롤과 무관하게 본인 행을 목록 끝에 붙여 둔다. 그 행은
 * 스크롤해서 다음 장을 찍으면 목록 안에서 제자리로 다시 잡히므로 중복이다.
 * 판별 근거는 순위가 위 행에서 이어지지 않고 뛴다는 것 (예: … 4, 5 다음에 13).
 *
 * 프롬프트로도 빼라고 지시하지만 모델이 자주 무시한다 — 실측 확인(2026-08-17,
 * 파괴신 실캡처)에서 지시를 넣고 배포해도 그대로 딸려 왔다. 그래서 여기서 확정적으로 건다.
 *
 * 판정: **마지막 행은 순위가 딱 이어질 때만 남긴다.** 앞 행들의 최대 순위를 보고
 * `최대+1`이 아니면 고정행으로 본다. 앞 행 하나만 보면 안 되는 이유가 실캡처에 다 있었다:
 *   · 1,2,3,4,5 다음 13     → 뛰어넘음
 *   · 11,12,13,14,15 다음 13 → 되돌아감 (목록에 이미 13위가 있는데 고정행도 13위)
 *   · 26,27,28,-,- 다음 13   → 직전 행이 '0회 도전'이라 순위가 아예 없음
 * 마지막 셋은 '직전 행과만 비교' 방식으로는 하나도 안 걸렸다.
 */
function dropPinnedSelfRow(rows: OcrRow[]): OcrRow[] {
  if (rows.length < 2) return rows
  const last = rows[rows.length - 1]
  if (last.rank === undefined) return rows
  const prevRanks = rows.slice(0, -1).map((r) => r.rank).filter((r): r is number => r !== undefined)
  if (!prevRanks.length) return rows
  const maxPrev = Math.max(...prevRanks)
  return last.rank === maxPrev + 1 ? rows : rows.slice(0, -1)
}

/** 비교용 정규화 — 공백·특수문자 제거, 영문 소문자화 */
const norm = (s: string): string => s.toLowerCase().replace(/[\s·.,_\-|/\\[\]()]/g, '')

/** 편집 거리 (Levenshtein) */
function distance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return prev[b.length]
}

/** 게임 UI에 늘 떠 있는 말들 — 이름으로 오인되면 안 된다 */
const UI_WORDS = new Set([
  '공략', '공지', '상점', '보상', '소탕', '입장', '연습전투', '순위', '점수', '길드',
  '랭킹', '길드원랭킹', '개인랭킹', '길드랭킹', '확인', '취소', '도움말', '전체',
])

/** 한 후보와의 유사도 0~1 */
function scoreAgainst(r: string, cand: string): number {
  const c = norm(cand)
  if (!c) return 0
  if (c === r) return 1

  // 부분 일치는 앞이나 뒤가 맞을 때만 인정한다. 가운데 토막이 걸리면
  // ('라에'가 '도라에몽팥빵'에) 엉뚱한 사람에게 붙는다.
  const edgeMatch =
    c.startsWith(r) || c.endsWith(r) || r.startsWith(c) || r.endsWith(c)
  if (edgeMatch) {
    // 글자가 잘려 읽힌 경우다. 잘린 이름이 **다른 사람의 완전한 이름**에
    // 밀리면 안 되므로(예: '엉덩' 이 '엉우'에 밀리는 일) 넉넉히 준다.
    const ratio = Math.min(c.length, r.length) / Math.max(c.length, r.length)
    return 0.55 + 0.45 * ratio
  }

  const d = distance(c, r)
  const len = Math.max(c.length, r.length)
  // 짧은 이름은 한 글자만 틀려도 비율 유사도가 확 떨어진다.
  // ('나는맛쥐' → '나는땃쥐' 는 4글자 중 1글자라 0.75)
  // 그래서 절대 편집거리도 같이 보고, 허용 오차 안이면 매칭으로 올린다.
  const tol = len <= 4 ? 1 : Math.floor(len * 0.3)
  const ratio = 1 - d / len
  return r.length >= 2 && d <= tol ? Math.max(ratio, 0.7) : ratio
}

/**
 * 읽은 이름을 길드원 명단에 맞춘다.
 * OCR이 한두 글자 틀려도 명단이 30명뿐이라 대개 제대로 붙는다.
 *
 * 다만 **엉뚱한 사람에게 점수가 조용히 들어가는 게 최악**이라, 1·2등 후보가
 * 엇비슷하면 붙이긴 하되 '확인 필요'로 표시해 사람 눈을 거치게 한다.
 */
export function matchName(
  read: string,
  roster: string[],
): { name?: string; confidence: number; ambiguous?: boolean; suggestion?: string } {
  const r = norm(read)
  if (!r) return { confidence: 0 }
  // 화면에 늘 떠 있는 UI 문구가 이름으로 둔갑하는 걸 먼저 막는다 ('공략'→'공리')
  if (UI_WORDS.has(r)) return { confidence: 0 }

  const ranked = roster
    .map((cand) => ({ name: cand, score: scoreAgainst(r, cand) }))
    .sort((a, b) => b.score - a.score)

  const best = ranked[0]
  if (!best) return { confidence: 0 }
  // 0.55 미만이면 '못 찾음'으로 두고 사람이 직접 고르게 한다
  if (best.score < 0.55) return { confidence: best.score }

  const second = ranked[1]
  const exact = best.score >= 1
  // 2등이 바짝 붙어 있으면 어느 쪽인지 단정할 수 없다
  const tooClose = !exact && !!second && best.score - second.score < 0.15
  // 두 글자 이름은 한 글자가 이름의 절반이라, 완전 일치가 아니면 글자만으로
  // 가려낼 방법이 없다. 붙이지 않고 사람에게 넘긴다.
  const tooShort = !exact && norm(best.name).length <= 2

  if (tooClose || tooShort) {
    // 넘기더라도 짐작은 알려 준다 — 고를 때 힌트가 된다
    return { confidence: best.score, ambiguous: true, suggestion: best.name }
  }
  return { name: best.name, confidence: best.score }
}

/**
 * '12,496,375' · '12 496 375' · '12.496.375' → 12496375
 * 0도 유효한 값이다 — 공성전 미참여자는 실제로 0점으로 목록에 남는다.
 */
function parseScore(s: string): number | undefined {
  const digits = s.replace(/[^\d]/g, '')
  if (!digits) return undefined
  const n = Number(digits)
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined
}

/**
 * 좌표를 못 잡았을 때 쓰는 예비 경로 — 텍스트를 줄 단위로 훑는다.
 * 잘라 올린 표처럼 단순한 이미지에서는 이것만으로도 충분하다.
 */
export function parseLines(text: string, roster: string[]): OcrRow[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const rows: OcrRow[] = []
  // 이름만 있는 줄이 연속으로 나올 수 있어(닉네임 다음 줄에 길드명) 후보를 쌓아 둔다
  let pending: string[] = []

  const push = (raw: string, readName: string, scoreText: string) => {
    const score = parseScore(scoreText)
    const m = matchName(readName, roster)
    rows.push({
      raw,
      readName: readName.trim(),
      score,
      matched: m.name,
      confidence: m.confidence,
      ambiguous: m.ambiguous,
      suggestion: m.suggestion,
    })
  }

  /** 쌓아둔 줄 중 명단에 가장 잘 붙는 것을 고른다 (길드명 줄에 밀리지 않게) */
  const bestPending = (): string | undefined => {
    if (!pending.length) return undefined
    let best: { text: string; score: number } | undefined
    for (const p of pending) {
      const s = matchName(p, roster).confidence
      if (!best || s > best.score) best = { text: p, score: s }
    }
    return best?.text
  }

  for (const line of lines) {
    // 구분자를 하나 이상 요구해야 'kyle07 12,496,375'의 07이 점수로 딸려가지 않는다
    const m = line.match(/^(.*?)[\s:·|]+([\d][\d,.\s]{0,15})$/)
    const onlyNumber = /^[\d][\d,.\s]*$/.test(line)
    const hasDigit = /\d/.test(line)

    if (onlyNumber && pending.length) {
      const name = bestPending() as string
      push(`${name}  ${line}`, name, line)
      pending = []
      continue
    }
    if (m && m[1].trim() && parseScore(m[2]) !== undefined) {
      push(line, m[1], m[2])
      pending = []
      continue
    }
    // 숫자가 전혀 없는 줄 = 이름만 있는 줄일 수 있으니 쌓아 둔다
    if (!hasDigit) pending.push(line)
  }

  return rows
}

export interface OcrProgress {
  /** 0~1 */
  progress: number
  status: string
}

// ---------------------------------------------------------------- 좌표 유도

interface Word { text: string; conf: number; x0: number; y0: number; x1: number; y1: number }

const digitsOf = (s: string): string => s.replace(/\D/g, '')

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function collectWords(blocks: any): Word[] {
  const out: Word[] = []
  for (const b of blocks ?? [])
    for (const p of b.paragraphs ?? [])
      for (const l of p.lines ?? [])
        for (const w of l.words ?? [])
          if (w.text?.trim()) out.push({ text: w.text.trim(), conf: w.confidence, ...w.bbox })
  return out
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * 우측 정렬된 숫자 기둥 중 가장 행이 많은 것을 '점수 열'로 본다.
 * 왼쪽 패널의 길드 점수·개인 점수도 기둥을 이루지만 서너 줄뿐이라 밀린다.
 */
function findScoreColumn(words: Word[], width: number): { x1: number; items: Word[] } | undefined {
  const nums = words.filter((w) => {
    const d = digitsOf(w.text).length
    return d >= 5 && d <= 12
  })
  const tol = Math.max(20, width * 0.02)
  const cols: { x1: number; items: Word[] }[] = []
  for (const w of [...nums].sort((a, b) => a.x1 - b.x1)) {
    const c = cols.find((c) => Math.abs(c.x1 - w.x1) <= tol)
    if (c) {
      c.items.push(w)
      c.x1 = median(c.items.map((i) => i.x1))
    } else cols.push({ x1: w.x1, items: [w] })
  }
  // 행이 많은 쪽 우선, 같으면 오른쪽(점수는 대개 가장 오른쪽 열)
  cols.sort((a, b) => b.items.length - a.items.length || b.x1 - a.x1)
  return cols[0]
}

/** 행 y좌표 — 간격이 일정하므로 중간에 빠진 행은 메운다 */
function rowPositions(items: Word[]): { rows: number[]; pitch: number } {
  const ys = [...new Set(items.map((i) => i.y0))].sort((a, b) => a - b)
  if (ys.length < 2) return { rows: ys, pitch: 0 }
  const pitch = median(ys.slice(1).map((y, i) => y - ys[i]))
  if (!pitch) return { rows: ys, pitch: 0 }
  const out = [ys[0]]
  for (let i = 1; i < ys.length; i++) {
    const gap = ys[i] - ys[i - 1]
    const k = Math.round(gap / pitch)
    // 2~6칸이 통째로 비었고 간격이 얼추 맞으면 그 사이를 채운다
    if (k >= 2 && k <= 6 && Math.abs(gap - k * pitch) < pitch * 0.25)
      for (let j = 1; j < k; j++) out.push(Math.round(ys[i - 1] + pitch * j))
    out.push(ys[i])
  }
  return { rows: out, pitch }
}

/**
 * 이름 칸 왼쪽 경계. ±30px만 어긋나도 첫 글자가 잘리거나 아바타가 끼어들어
 * 인식률이 무너지므로 고정값을 쓰지 않고 실제 글자 위치에서 유도한다.
 */
function nameLeftEdge(words: Word[], rows: number[], scoreX0: number, h: number, width: number): number {
  const cand = words.filter(
    (w) =>
      w.conf >= 60 &&
      w.x1 < scoreX0 - h * 0.5 &&
      w.x0 > scoreX0 - width * 0.45 &&
      /[가-힣A-Za-z0-9]/.test(w.text),
  )
  const mins: number[] = []
  for (const y of rows) {
    const band = cand.filter((w) => w.y0 > y - h * 1.6 && w.y1 < y + h * 0.8)
    if (band.length) mins.push(Math.min(...band.map((w) => w.x0)))
  }
  // 근거가 없으면 넉넉히 잡는다 — 아바타가 좀 들어와도 명단 대조가 걸러 준다
  if (mins.length < 2) return Math.round(scoreX0 - width * 0.25)
  return Math.round(median(mins) - h * 0.4)
}

/**
 * 이미지를 캔버스로 옮긴다.
 * 너무 작으면 글자가 뭉개지고 너무 크면 느려서, 폭을 1200~2600으로 맞춘다.
 * 좌표계를 하나로 두려고 판독도 전부 이 캔버스에서 한다.
 */
interface Rect { left: number; top: number; width: number; height: number }

/**
 * 잘라낸 조각을 새 캔버스로 넘긴다.
 * tesseract에 rectangle만 주면 호출마다 원본 전체를 워커로 넘겨 다시 디코드한다.
 * 조각만 넘기면 훨씬 빠르고, 폰에서 메모리가 터지는 것도 막는다.
 */
function crop(src: HTMLCanvasElement, r: Rect): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(r.width))
  c.height = Math.max(1, Math.round(r.height))
  c.getContext('2d')?.drawImage(src, Math.round(r.left), Math.round(r.top), c.width, c.height, 0, 0, c.width, c.height)
  return c
}

async function toCanvas(file: Blob): Promise<{ canvas: HTMLCanvasElement; bmp: ImageBitmap; scale: number }> {
  const bmp = await createImageBitmap(file)
  // 좌표를 뽑는 단계는 넉넉히 크게 본다. 작으면 글자 위치가 뭉개져 이름 칸
  // 경계가 어긋나고, 그러면 판독을 아무리 잘해도 소용이 없다.
  const scale = Math.min(2600 / bmp.width, Math.max(1, 1900 / bmp.width))
  const canvas = draw(bmp, Math.round(bmp.width * scale), Math.round(bmp.height * scale))
  return { canvas, bmp, scale }
}

/** 원본에서 원하는 크기로 한 번에 그린다 */
function draw(bmp: ImageBitmap, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('캔버스를 만들 수 없어요')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, w, h)
  return c
}

/**
 * 띠 영역의 평균 밝기(0~255). 목록 행은 밝은 카드 위에 있고,
 * 하단의 '본인 순위' 행은 어두운 카드라 이걸로 가려낸다.
 */
function bandLuma(canvas: HTMLCanvasElement, r: Rect): number {
  const ctx = canvas.getContext('2d')
  if (!ctx) return 255
  const x = Math.max(0, Math.round(r.left))
  const y = Math.max(0, Math.round(r.top))
  const w = Math.min(canvas.width - x, Math.max(1, Math.round(r.width)))
  const h = Math.min(canvas.height - y, Math.max(1, Math.round(r.height)))
  if (w <= 0 || h <= 0) return 255
  const d = ctx.getImageData(x, y, w, h).data
  let sum = 0
  let n = 0
  // 전부 훑을 필요 없이 성기게 표본만 뜬다
  const stride = Math.max(4, Math.floor(d.length / 4 / 400)) * 4
  for (let i = 0; i < d.length; i += stride) {
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    n++
  }
  return n ? sum / n : 255
}

// ---------------------------------------------------------------- 본체

/**
 * 목록(밝은 카드) 영역만 남기고 위아래를 잘라낸다.
 * 하단의 '본인 순위' 행은 어두운 카드라, 모델에게 말로 빼 달라고 부탁하는 대신
 * 아예 보내지 않는 쪽이 확실하다. (프롬프트 지시는 실측상 자주 무시됐다)
 */
function cropToList(c: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = c.getContext('2d')
  if (!ctx) return c
  // 오른쪽 절반(목록 영역)의 가로줄 평균 밝기로 밝은 띠를 찾는다
  const x0 = Math.round(c.width * 0.45)
  const w = Math.max(1, Math.round(c.width * 0.5))
  const d = ctx.getImageData(x0, 0, w, c.height).data
  const rowLuma = (y: number): number => {
    let sum = 0
    let n = 0
    const base = y * w * 4
    for (let i = 0; i < w * 4; i += 24) {
      sum += 0.299 * d[base + i] + 0.587 * d[base + i + 1] + 0.114 * d[base + i + 2]
      n++
    }
    return n ? sum / n : 0
  }
  let top = -1
  let bottom = -1
  for (let y = 0; y < c.height; y++) {
    if (rowLuma(y) >= 150) {
      if (top < 0) top = y
      bottom = y
    }
  }
  // 밝은 띠를 못 찾았거나(전부 어두운 화면) 이미 목록만 있는 이미지면 그대로 둔다.
  //
  // ★ 띠가 화면 높이의 일부에 불과하면 그건 목록이 아니라 다른 UI다 — 자르지 않는다.
  //   파괴신 화면에서 실제로 터졌던 버그: 목록 행이 어두운 색이라 밝기로 안 잡히고,
  //   대신 하단 버튼 줄(720px 중 46px)만 밝은 띠로 잡혀서 목록이 한 줄도 없는
  //   조각을 서버로 보냈다. 서버는 표를 못 찾고, 그러면 tesseract 폴백이 그 조각에서
  //   엉뚱한 숫자를 읽어 온다. 40px이라는 절대값 기준으로는 이게 안 걸렸다.
  //   못 자르는 건 손해가 적다 — 전체 화면을 보내도 모델이 잘 읽는다(실측).
  const minBand = Math.round(c.height * 0.35)
  if (top < 0 || bottom - top < minBand || (top < 8 && c.height - bottom < 8)) return c
  const pad = 14
  const cy = Math.max(0, top - pad)
  const ch = Math.min(c.height, bottom + pad) - cy
  const out = document.createElement('canvas')
  out.width = c.width
  out.height = ch
  out.getContext('2d')?.drawImage(c, 0, cy, c.width, ch, 0, 0, c.width, ch)
  return out
}

/** 서버로 보내기 좋게 줄인다. 실측상 1000~1300px 폭에서 가장 잘 읽힌다. */
async function toUploadBlob(file: Blob): Promise<{ b64: string; mime: string }> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height))
  const c = cropToList(draw(bmp, Math.round(bmp.width * k), Math.round(bmp.height * k)))
  bmp.close()
  const blob: Blob = await new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('이미지 변환 실패'))), 'image/jpeg', 0.92),
  )
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return { b64: btoa(bin), mime: 'image/jpeg' }
}

/** 서버(/ocr)의 AI 모델로 읽는 기본 경로 */
async function readImageApi(
  file: Blob,
  roster: string[],
  onProgress?: (p: OcrProgress) => void,
  metric?: string,
): Promise<{ rows: OcrRow[]; text: string }> {
  const { WORKER_URL } = await import('../data/config')
  // 이 파일은 캡처를 쓸 때만 동적으로 불린다 — 의존도 같은 방식으로 늦게 가져온다
  const { authHeaders } = await import('../session')
  const base = (WORKER_URL || '').replace(/\/+$/, '')
  if (!base) throw new Error('서버 주소가 없어요')

  onProgress?.({ progress: 0.15, status: '이미지 준비 중' })
  const { b64, mime } = await toUploadBlob(file)

  onProgress?.({ progress: 0.35, status: 'AI가 읽는 중' })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 45_000)
  let data: { ok?: boolean; rows?: Array<{ rank?: number; name: string; score: number; count?: number }>; error?: string }
  try {
    // ★ 토큰을 반드시 같이 보낸다. 워커가 /ocr 에 guard() 를 걸었는데(Origin 헤더는
    //   curl 이면 아무 값이나 넣을 수 있어서 문이 못 됐다) 여기가 안 따라가서, 서버
    //   판독이 매번 401 로 죽고 아래 catch 가 tesseract 폴백으로 조용히 넘어갔다.
    //   화면에는 '서버가 응답하지 않아…' 한 줄만 떠서 아무도 몰랐다.
    const res = await fetch(`${base}/ocr`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      // metric — 화면에 적힌 수치 이름('점수'/'딜량'). 워커가 프롬프트에 넣어
      // 파괴신 딜량처럼 자릿수가 큰 값을 흘리지 않게 한다. 워커가 값을 검증한다.
      body: JSON.stringify({ image: b64, mime, roster, metric }),
      signal: ctrl.signal,
    })
    data = await res.json()
  } finally {
    clearTimeout(timer)
  }
  if (!data.ok || !Array.isArray(data.rows)) throw new Error(data.error || '서버가 읽지 못했어요')

  onProgress?.({ progress: 0.9, status: '결과 정리 중' })
  const rows: OcrRow[] = []
  for (const r of data.rows) {
    if (typeof r?.name !== 'string' || !Number.isSafeInteger(r?.score) || r.score < 0) continue
    const rank = Number.isSafeInteger(r.rank) && (r.rank as number) > 0 ? r.rank : undefined
    // 개인 랭킹처럼 전혀 다른 목록을 읽었을 때 걸러내는 문지방.
    // 예전엔 30이었는데, 명단이 30명을 넘으면 마지막 사람이 조용히 사라졌다.
    // 길드 인원보다 넉넉하되 개인 랭킹(수백~수천 위)과는 확실히 구분되는 값으로 둔다.
    if (rank !== undefined && rank > MAX_GUILD_RANK) continue
    const m = matchName(r.name, roster)
    // 워커가 이미 걸렀지만 여기서도 한 번 더 — 작은 양의 정수만 받는다
    const count = Number.isSafeInteger(r.count) && (r.count as number) > 0 && (r.count as number) <= 999
      ? (r.count as number) : undefined
    rows.push({
      raw: `${rank !== undefined ? rank + '위 · ' : ''}${r.name}   ${r.score.toLocaleString()}`
        + (count !== undefined ? `  · ${count}회` : ''),
      readName: r.name,
      score: r.score,
      count,
      matched: m.name,
      confidence: m.confidence,
      ambiguous: m.ambiguous,
      suggestion: m.suggestion,
      rank,
    })
  }
  // 같은 사람이 두 행에 붙었으면 확실한 쪽만 남긴다 (조용한 덮어쓰기 방지)
  const seen = new Map<string, number>()
  rows.forEach((r, i) => {
    if (!r.matched) return
    const prev = seen.get(r.matched)
    if (prev === undefined) {
      seen.set(r.matched, i)
    } else if (rows[i].confidence > rows[prev].confidence) {
      rows[prev] = { ...rows[prev], matched: undefined }
      seen.set(r.matched, i)
    } else {
      rows[i] = { ...rows[i], matched: undefined }
    }
  })
  // 다른 화면(길드 랭킹 등)이면 명단에 붙는 비율이 낮다 — 표를 내놓지 않는다
  const hit = rows.filter((r) => r.matched).length
  if (rows.length >= 3 && hit / rows.length < 0.4) return { rows: [], text: '' }
  return { rows, text: data.rows.map((r) => `${r.name}  ${r.score}`).join('\n') }
}

/**
 * 이미지에서 이름과 점수를 읽는다.
 * 기본은 서버(/ocr)의 AI 모델 — 몇 초면 끝나고 게임 폰트도 잘 읽는다.
 * 서버가 죽었거나 무료 할당량이 바닥나면 브라우저 tesseract로 폴백한다.
 */
export async function readImage(
  file: Blob,
  roster: string[],
  onProgress?: (p: OcrProgress) => void,
  /** 화면에 적힌 수치 이름 ('점수' | '딜량') — 서버 프롬프트에만 쓰인다 */
  metric?: string,
): Promise<{ rows: OcrRow[]; text: string }> {
  // 본인 고정행 제거는 서버·브라우저 어느 경로로 읽었든 똑같이 건다
  try {
    const r = await readImageApi(file, roster, onProgress, metric)
    return { ...r, rows: dropPinnedSelfRow(r.rows) }
  } catch {
    onProgress?.({ progress: 0, status: '서버가 응답하지 않아 브라우저에서 읽어요' })
    const r = await readImageLocal(file, roster, onProgress)
    return { ...r, rows: dropPinnedSelfRow(r.rows) }
  }
}

/**
 * 브라우저 안에서 읽는 예비 경로 (tesseract.js).
 * 서버(/ocr)가 안 될 때만 쓴다 — 무겁고 느리지만 인터넷이 아예 없어도 돈다.
 * tesseract.js는 이 기능을 쓸 때만 동적 import로 불러와 첫 화면 로딩에 영향이 없다.
 */
async function readImageLocal(
  file: Blob,
  roster: string[],
  onProgress?: (p: OcrProgress) => void,
): Promise<{ rows: OcrRow[]; text: string }> {
  const { createWorker, PSM } = await import('tesseract.js')
  const { canvas, bmp, scale } = await toCanvas(file)
  const W = canvas.width

  const worker = await createWorker('kor+eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      // 준비 단계(코어·학습데이터 내려받기)만 그대로 보여 준다.
      // 판독은 호출이 수십 번이라 로거를 그대로 쓰면 진행률이 널뛴다.
      if (m.status !== 'recognizing text') onProgress?.({ progress: (m.progress ?? 0) * 0.25, status: m.status })
    },
  })

  const step = (done: number, total: number, status: string) =>
    onProgress?.({ progress: 0.3 + 0.7 * (done / Math.max(1, total)), status })

  try {
    // 1) 전체 한 번 — 어디에 무엇이 있는지 파악한다.
    //    주의: 여기서 PSM을 명시로 설정하면 인식이 크게 나빠진다(단어 221→95). 기본값을 그대로 둔다.
    step(0, 1, '화면 훑는 중')
    const scan = async () => {
      const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true })
      const words = collectWords(data.blocks)
      return { text: data.text ?? '', words, col: findScoreColumn(words, W) }
    }

    // 기본 모드로 먼저 본다. 여기서 PSM을 명시로 설정하면 오히려 인식이 크게
    // 나빠지므로(단어 221→95) 손대지 않는다.
    let { text, words, col } = await scan()

    // 목록만 잘라 올린 캡처는 기본 모드가 흰 카드 영역을 통째로 건너뛰는 일이 있다.
    // 그럴 때는 '흩어진 글자 찾기' 모드로 한 번 더 훑는다.
    if (!col || col.items.length < 2) {
      step(0, 1, '다른 방식으로 다시 훑는 중')
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
      const retry = await scan()
      await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
      if (retry.col && retry.col.items.length >= 2) ({ text, words, col } = retry)
    }

    if (!col || col.items.length < 2) {
      // 그래도 못 찾았다 — 표만 잘라 올린 단순한 이미지일 수 있으니 줄 단위로 시도
      return { rows: parseLines(text, roster), text }
    }

    const h = median(col.items.map((i) => i.y1 - i.y0)) || 30
    // 위아래가 잘린 행은 글자 높이가 눈에 띄게 낮다. 앞자리가 날아간 점수가
    // 그럴듯한 숫자로 들어가는 게 누락보다 나쁘므로 아예 뺀다.
    const solid = col.items.filter((i) => i.y1 - i.y0 >= h * 0.85)
    const items = solid.length >= 2 ? solid : col.items
    const scoreX0 = Math.min(...items.map((i) => i.x0))
    const scoreX1 = Math.max(...items.map((i) => i.x1))
    const { rows: base, pitch } = rowPositions(items)

    // 글자가 작으면(폰 캡처 등) 판독 전에 키운다. 이미지 폭이 아니라 **실제 글자
    // 높이**를 기준으로 삼아야 한다 — 폭으로 정하면 이미 충분히 큰 글자까지
    // 흐려져 오히려 나빠진다.
    // 판독용 배율은 **원본의 글자 크기**로 정한다. 이미 또렷한 글자를 억지로
    // 키우면 흐려져서 오히려 나빠지고, 작은 글자는 키워야 읽힌다.
    // (원본 글자 31px → 그대로, 15px → 2배 남짓)
    const glyph = h / scale
    const readScale = glyph >= 26 ? 1 : Math.min(3, 32 / glyph)
    const readCanvas =
      Math.abs(readScale - scale) < 0.02
        ? canvas
        : draw(bmp, Math.round(bmp.width * readScale), Math.round(bmp.height * readScale))
    const f = readScale / scale
    const zoomed = (r: Rect): Rect => ({
      left: r.left * f, top: r.top * f, width: r.width * f, height: r.height * f,
    })
    const left = Math.max(0, nameLeftEdge(words, base, scoreX0, h, W))

    // 목록 위아래로 한 칸씩 더 짚어 본다 — 1차 패스가 놓친 목록 행을 줍기 위해서다.
    // 헛다리를 짚어도 아래 검증에서 걸러진다.
    const probes: number[] =
      pitch > 0 ? [Math.round(base[base.length - 1] + pitch), Math.round(base[0] - pitch)] : []
    const isProbe = new Set(
      probes.filter((y) => y > h * 0.5 && y + h * 1.5 < canvas.height && !base.includes(y)),
    )
    // 하단의 '본인 순위' 행은 목록이 아니므로 뺀다. 목록 행은 밝은 카드,
    // 본인 행은 어두운 카드라 이름 칸의 배경 밝기로 가려진다.
    const isBright = (y: number) =>
      bandLuma(canvas, {
        left,
        top: y - h * 1.2,
        width: Math.max(1, scoreX0 - h * 0.5 - left),
        height: h * 2,
      }) >= 140
    const rows = [...base, ...isProbe].filter(isBright).sort((a, b) => a - b)

    const total = rows.length * 2
    let done = 0

    // 2) 이름 먼저. 짚어 본 자리가 헛다리인지는 이름으로 판가름 나므로,
    //    이름을 먼저 읽어 두면 쓸데없는 점수 판독을 건너뛸 수 있다.
    const nameRect = (y: number) => ({
      left,
      top: Math.max(0, Math.round(y - h * 1.45)),
      width: Math.round(scoreX0 - h * 0.5 - left),
      height: Math.round(h * 2),
    })
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '' })
    const reads: string[] = []
    const matches: ReturnType<typeof matchName>[] = []
    for (const y of rows) {
      const { data: d } = await worker.recognize(crop(readCanvas, zoomed(nameRect(y))))
      const read = d.text.replace(/\s+/g, ' ').trim()
      reads.push(read)
      matches.push(matchName(read, roster))
      step(++done, total, `이름 읽는 중 ${done}/${rows.length}`)
    }

    // 3) 못 붙은 행만 언어를 바꿔 다시 읽는다.
    //    kor+eng는 짧은 한글 이름을 라틴 문자로 confident하게 오독할 때가 있고
    //    ('나는땃쥐' → 'Lhe') 한국어 전용으로 읽으면 살아난다. 반대로 영문 닉은
    //    한국어 전용에서 깨지므로 영어 전용도 한 번 더 시도한다.
    //    짚어 본 자리는 애초에 근거가 없어 재시도 대상에서 뺀다 — 언어를 바꾸는 건 비싸다.
    let lang = 'kor+eng'
    for (const retryLang of ['kor', 'eng']) {
      const todo = matches
        .map((m, i) => (m.name || isProbe.has(rows[i]) ? -1 : i))
        .filter((i) => i >= 0)
      if (!todo.length) break
      onProgress?.({ progress: 0.6, status: `못 읽은 ${todo.length}줄 다시 보는 중` })
      await worker.reinitialize(retryLang)
      lang = retryLang
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE })
      for (const i of todo) {
        const { data: d } = await worker.recognize(crop(readCanvas, zoomed(nameRect(rows[i]))))
        const read = d.text.replace(/\s+/g, ' ').trim()
        const m = matchName(read, roster)
        if (m.name) {
          reads[i] = read
          matches[i] = m
        }
      }
    }

    // 4) 점수 — 숫자만 나오게 묶어 두면 정확하다. 헛다리로 판명난 자리는 읽지 않는다.
    //    재시도로 언어를 바꿨다면 반드시 되돌린다. 한국어 전용 모델로 숫자를 읽으면
    //    자릿수가 틀어진다(11,975,149 → 1159757149).
    if (lang !== 'kor+eng') await worker.reinitialize('kor+eng')
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789,' })
    const scores: (number | undefined)[] = []
    for (const [i, y] of rows.entries()) {
      if (isProbe.has(y) && !matches[i].name) {
        scores.push(undefined)
        continue
      }
      const { data: d } = await worker.recognize(
        crop(readCanvas, zoomed({
          left: Math.max(0, scoreX0 - h * 2),
          top: Math.max(0, y - h * 0.6),
          width: scoreX1 - scoreX0 + h * 3,
          height: h * 2,
        })),
      )
      scores.push(parseScore(d.text))
      step(++done, total, `점수 읽는 중 ${done - rows.length}/${rows.length}`)
    }

    // 5) 같은 이름이 여러 행에 붙었으면 가장 확실한 한 행만 남긴다.
    //    조용히 덮어써서 남의 점수가 들어가는 것보다 사람이 고르는 게 낫다.
    const byName = new Map<string, number[]>()
    matches.forEach((m, i) => {
      if (!m.name) return
      const list = byName.get(m.name) ?? []
      list.push(i)
      byName.set(m.name, list)
    })
    for (const idxs of byName.values()) {
      if (idxs.length < 2) continue
      const keep = idxs.reduce((a, b) => (matches[a].confidence >= matches[b].confidence ? a : b))
      for (const i of idxs) if (i !== keep) matches[i] = { confidence: matches[i].confidence }
    }

    const out: OcrRow[] = []
    rows.forEach((y, i) => {
      const score = scores[i]
      const row: OcrRow = {
        raw: `${reads[i] || '(못 읽음)'}   ${score?.toLocaleString() ?? '-'}`,
        readName: reads[i],
        score,
        matched: matches[i].name,
        confidence: matches[i].confidence,
        ambiguous: matches[i].ambiguous,
        suggestion: matches[i].suggestion,
      }
      // 짚어 본 자리는 애초에 행이 있다는 근거가 없으므로, 이름과 점수가 둘 다
      // 제대로 나왔을 때만 인정한다. 그래야 목록 밖의 안내문 숫자 같은 게 안 섞인다.
      if (isProbe.has(y)) {
        if (row.matched && score !== undefined && String(score).length >= 4) out.push(row)
        return
      }
      // 이름도 점수도 못 건진 줄은 보여 줘 봐야 방해만 된다
      if (row.matched || score !== undefined) out.push(row)
    })

    // 길드원 랭킹이 아닌 화면(길드 랭킹·서버 랭킹 등)을 올리면 낯선 이름들이
    // 어설프게 붙는다. 명단에 붙은 비율이 너무 낮으면 표를 내놓지 않는 편이 낫다.
    const hit = out.filter((r) => r.matched).length
    if (out.length >= 3 && hit / out.length < 0.4) return { rows: [], text }

    return { rows: out, text }
  } finally {
    bmp.close()
    await worker.terminate().catch(() => {})
  }
}
