#!/usr/bin/env node
/**
 * 디시인사이드 세븐나이츠 리버스 마이너 갤러리 읽기 도구.
 *
 * WebFetch로도 읽히긴 하지만 요약 모델을 거치면서 영웅 이름이 뭉개진다
 * (프레이야 → "프레이" 등). 덱 데이터는 한 글자만 틀려도 못 쓰므로
 * 원문 HTML을 직접 받아 본문만 평문으로 뽑는다.
 *
 *   node tools/dcinside.mjs list [말머리] [페이지]   글 목록
 *   node tools/dcinside.mjs read <글번호>            본문 전문
 *
 * 말머리: 20=공략/정보 (기본), all=전체
 */

const GALL = 'sevennightsrebirth'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Referer: `https://gall.dcinside.com/mgallery/board/lists/?id=${GALL}`,
  'Accept-Language': 'ko-KR,ko;q=0.9',
}

async function get(url) {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.text()
}

const unescapeHtml = (s = '') =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')

function htmlToText(html) {
  return html
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
}

async function list(head = '20', page = '1') {
  const headParam = head === 'all' ? '' : `&search_head=${head}`
  const html = await get(`https://gall.dcinside.com/mgallery/board/lists/?id=${GALL}&sort_type=N${headParam}&page=${page}`)
  const rows = html.split('<tr').slice(1)
  let n = 0
  for (const row of rows) {
    const no = row.match(/data-no="(\d+)"/)?.[1] ?? row.match(/[?&]no=(\d+)/)?.[1]
    if (!no) continue
    const titleHtml = row.match(/class="gall_tit[^"]*"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)?.[1]
    if (!titleHtml) continue
    const title = htmlToText(titleHtml).replace(/\s+/g, ' ').trim()
    if (!title) continue
    const date = row.match(/class="gall_date"[^>]*title="([^"]*)"/)?.[1]?.slice(0, 10) ?? ''
    console.log(`${no}\t${date}\t${title}`)
    n++
  }
  if (!n) console.error('목록을 못 읽었습니다 — 디시가 차단했거나 마크업이 바뀐 것.')
}

async function read(no) {
  const html = await get(`https://gall.dcinside.com/mgallery/board/view/?id=${GALL}&no=${no}`)
  const title = unescapeHtml(html.match(/<span class="title_subject">([\s\S]*?)<\/span>/)?.[1] ?? '').trim()
  const date = html.match(/class="gall_date"[^>]*>([^<]*)</)?.[1]?.trim() ?? ''
  const bodyHtml =
    html.match(/<div class="write_div"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/)?.[1] ??
    html.match(/<div class="writing_view_box"[^>]*>([\s\S]*?)<div class="/)?.[1]
  if (!bodyHtml) {
    console.error('본문을 못 찾았습니다 — 삭제된 글이거나 마크업이 바뀐 것.')
    process.exit(1)
  }
  const text = htmlToText(bodyHtml)
  const images = (bodyHtml.match(/<img\b/gi) ?? []).length
  console.log(`제목: ${title}`)
  console.log(`작성: ${date}   이미지 ${images}장   글: https://gall.dcinside.com/mgallery/board/view/?id=${GALL}&no=${no}`)
  console.log('─'.repeat(60))
  console.log(text.replace(/\[이미지\]/g, '[이미지]') || '(본문에 텍스트 없음 — 이미지 공략)')
}

const [cmd, a, b] = process.argv.slice(2)
try {
  if (cmd === 'list') await list(a ?? '20', b ?? '1')
  else if (cmd === 'read') await read(a)
  else {
    console.log('사용법:\n  node tools/dcinside.mjs list [말머리=20|all] [페이지]\n  node tools/dcinside.mjs read <글번호>')
    process.exit(1)
  }
} catch (e) {
  console.error('실패:', e.message)
  process.exit(1)
}
