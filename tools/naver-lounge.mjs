#!/usr/bin/env node
/**
 * 세븐나이츠 리버스 공식 네이버 라운지 게시판 읽기 도구.
 *
 * game.naver.com 은 SPA라 HTML을 받아도 본문이 없고, WebFetch·브라우저 툴은
 * 정책상 이 도메인을 못 연다. 그래서 라운지 내부 API를 직접 호출한다.
 *
 *   node tools/naver-lounge.mjs list <boardId> [limit]   글 목록(제목·날짜·본문 유무)
 *   node tools/naver-lounge.mjs read <feedId>            글 한 편의 본문 전문(텍스트)
 *   node tools/naver-lounge.mjs boards                   게시판 id 목록
 *
 * 주요 게시판: 13=공략&TIP, 12=Best 공략
 */

const LOUNGE = 'sena_rebirth'
const API = `https://apis.naver.com/nng_main/nng_main/community/lounge/${LOUNGE}`
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Referer: `https://game.naver.com/lounge/${LOUNGE}/`,
  Accept: 'application/json',
}

async function api(path) {
  const res = await fetch(API + path, { headers: HEADERS })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`)
  return res.json()
}

const unescapeHtml = (s = '') =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')

/**
 * 본문 → 평문. 목록 API(`/feed`)는 스마트에디터 문서 JSON을, 단건 API(`/feed/{id}`)는
 * 렌더링된 HTML을 준다. 둘 다 받아 처리한다. 이미지는 [이미지] 자리표시자로만 남긴다.
 */
function contentsToText(raw) {
  const s = typeof raw === 'string' ? raw.trim() : ''
  return s.startsWith('<') ? htmlToText(s) : docToText(raw)
}

function htmlToText(html) {
  const images = (html.match(/<img\b/gi) ?? []).length
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<img\b[^>]*>/gi, '\n[이미지]\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((l) => unescapeHtml(l).replace(/​/g, '').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text, images }
}

/** 스마트에디터 문서 JSON → 평문. */
function docToText(raw) {
  let doc
  try {
    doc = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return { text: '', images: 0 }
  }
  const comps = doc?.document?.components ?? []
  let images = 0
  const out = []
  const paragraphs = (value = []) => {
    for (const p of value) {
      const line = (p.nodes ?? [])
        .map((n) => n.value ?? '')
        .join('')
        .trim()
      out.push(line)
    }
  }
  for (const c of comps) {
    switch (c['@ctype']) {
      case 'text':
        paragraphs(c.value)
        break
      case 'quotation':
        paragraphs(c.value)
        if (c.source) out.push(String(c.source))
        break
      case 'sectionTitle':
      case 'horizontalLine':
        out.push('')
        break
      case 'image':
      case 'imageStrip':
      case 'video':
      case 'sticker':
        images++
        out.push('[이미지]')
        break
      case 'oglink':
        out.push(`[링크] ${c?.link?.url ?? ''}`)
        break
      case 'table':
        for (const row of c?.value ?? []) {
          const cells = (row?.cells ?? []).map((cell) => {
            const buf = []
            for (const sub of cell?.value ?? []) if (sub['@ctype'] === 'text') for (const p of sub.value ?? []) buf.push((p.nodes ?? []).map((n) => n.value ?? '').join('').trim())
            return buf.join(' ')
          })
          out.push('| ' + cells.join(' | ') + ' |')
        }
        break
      default:
        break
    }
  }
  const text = out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text, images }
}

const fmtDate = (d = '') => (d.length >= 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d)

/** limit 상한이 있어 30건씩 나눠 받는다. */
async function fetchFeeds(boardId, want) {
  const out = []
  let offset = 0
  let total = null
  while (out.length < want) {
    const take = Math.min(30, want - out.length)
    const q = new URLSearchParams({ offset: String(offset), limit: String(take), order: 'NEW', boardId: String(boardId), buffFilteringYN: 'N' })
    const j = await api(`/feed?${q}`)
    total ??= j?.content?.totalCount ?? null
    const page = j?.content?.feeds ?? []
    if (!page.length) break
    out.push(...page)
    // 서버가 다음 offset을 돌려주면 그걸 쓰고, 아니면 받은 개수만큼 넘긴다
    const next = j?.content?.offset
    offset = typeof next === 'number' && next > offset ? next : offset + page.length
  }
  return { feeds: out, total }
}

async function list(boardId, limit = 30) {
  const { feeds, total } = await fetchFeeds(boardId, limit)
  console.log(`게시판 ${boardId} — 전체 ${total ?? '?'}건 중 최근 ${feeds.length}건\n`)
  for (const item of feeds) {
    const f = item.feed ?? {}
    const { text, images } = contentsToText(f.contents)
    // 본문에 실제 글자가 얼마나 있는지 = 텍스트 공략인지 이미지 공략인지 판단 근거
    const chars = text.replace(/\[이미지\]/g, '').replace(/\s/g, '').length
    console.log(`${f.feedId}\t${fmtDate(f.createdDate)}\t글자 ${String(chars).padStart(5)}\t이미지 ${String(images).padStart(3)}\t${unescapeHtml(f.title ?? '(무제)')}`)
  }
}

async function read(feedId) {
  const j = await api(`/feed/${feedId}`)
  const f = j?.content?.feed ?? {}
  const boardId = j?.content?.board?.boardId ?? ''
  const { text, images } = contentsToText(f.contents)
  console.log(`제목: ${unescapeHtml(f.title ?? '')}`)
  console.log(`작성: ${fmtDate(f.createdDate)}   이미지 ${images}장   글: https://game.naver.com/lounge/${LOUNGE}/board/${boardId}/detail/${feedId}`)
  console.log('─'.repeat(60))
  console.log(text || '(본문에 텍스트 없음 — 이미지 공략)')
}

async function boards() {
  // 게시판 목록만 /community 없는 경로에 있다
  const res = await fetch(`https://apis.naver.com/nng_main/nng_main/lounge/${LOUNGE}/board`, { headers: HEADERS })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — board`)
  const j = await res.json()
  for (const v of j?.content?.boardViews ?? []) {
    const b = v.board
    if (b) console.log(`${String(b.boardId).padStart(4)}  ${b.boardName}`)
  }
}

const [cmd, a, b] = process.argv.slice(2)
try {
  if (cmd === 'list') await list(a ?? 13, b ? +b : 30)
  else if (cmd === 'read') await read(a)
  else if (cmd === 'boards') await boards()
  else {
    console.log('사용법:\n  node tools/naver-lounge.mjs list <boardId> [limit]\n  node tools/naver-lounge.mjs read <feedId>\n  node tools/naver-lounge.mjs boards\n\n13=공략&TIP, 12=Best 공략')
    process.exit(1)
  }
} catch (e) {
  console.error('실패:', e.message)
  process.exit(1)
}
