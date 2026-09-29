#!/usr/bin/env node
// 나무위키 '세븐나이츠 리버스/등장인물'에서 영웅을 긁어 heroes.json 에 없는 신규만 추가한다.
//
// 쓰는 법:  node tools/scrape-heroes.mjs            (신규만 미리보기)
//           node tools/scrape-heroes.mjs --write    (heroes.json 에 실제로 추가)
//
// 규칙(도감 정리 방침과 동일):
//   - 전설이 아니고 각성도 없으면 건너뛴다 (희귀·고급·일반 비각성은 이미 걷어냈다).
//   - 각성이 있으면 '각성 <이름>' 으로 넣는다(기본형은 안 넣는다).
//   - 나무위키 문서가 아닌 것(지역·소속 문서)은 걸러낸다.
//   - 띄어쓰기만 다른 표기('칼 헤론' vs '칼헤론')는 같은 영웅으로 본다.
//
// 정규식 추출이라 LLM 없이 돈다. 스킬 상세가 필요하면 사람이 나중에 채운다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const LIST = '세븐나이츠 리버스/등장인물'
const SUFFIX = '(세븐나이츠 리버스)'
const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..')
const HEROES = path.join(ROOT, 'src/data/heroes.json')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function get(title) {
  const url = 'https://namu.wiki/w/' + encodeURIComponent(title)
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
  return r.ok ? await r.text() : ''
}

// HTML → 평문(줄 단위). 표·목차가 한 줄씩 끊긴다.
function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => cp(+d))
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
}
const cp = (v) => (Number.isInteger(v) && v >= 0 && v <= 0x10ffff ? String.fromCodePoint(v) : '')

const GRADES = ['전설', '희귀', '고급', '일반']
const POSITIONS = ['공격형', '마법형', '방어형', '지원형', '만능형']

function parseHero(name, html) {
  const L = toText(html)
  const i = L.indexOf('게임 내 성능')
  if (i < 0) return { name, isHero: false }   // 지역·소속 문서 등
  // 등급/유형은 '게임 내 성능' 아래에 라벨-값으로 연달아 나온다
  const after = L.slice(i)
  const pick = (label, allow) => {
    const at = after.indexOf(label)
    if (at < 0) return ''
    for (let k = at + 1; k < Math.min(at + 4, after.length); k++) {
      const v = after[k].replace(/^캐릭터\s*/, '')
      if (allow.some((a) => v.includes(a))) return allow.find((a) => v.includes(a))
    }
    return ''
  }
  const grade = pick('등급', GRADES)
  const position = pick('유형', POSITIONS)
  // 각성: '각성' 이 제목(목차)에 독립 절로 있고 하위 문서 링크가 있는 경우.
  // '초월' 은 각성이 아니므로 제외. 원작(세븐나이츠) 신화각성 링크도 제외.
  const hasAwakening = L.some((l, k) =>
    /^\d+(\.\d+)*\.?$/.test(l) && L[k + 1] === '각성') ||
    L.some((l) => l === '각성' && L.includes(name + SUFFIX + '/각성'))
  return { name, isHero: true, grade, position, hasAwakening: !!hasAwakening }
}

async function main() {
  const write = process.argv.includes('--write')
  const roster = JSON.parse(fs.readFileSync(HEROES, 'utf8'))
  // 나무위키와 우리 표기가 띄어쓰기만 다른 경우가 있다('칼 헤론' vs '칼헤론').
  // 공백을 지우고 비교해야 같은 영웅을 신규로 잘못 집어오지 않는다.
  const key = (s) => s.replace(/\s+/g, '')
  const have = new Set(roster.map((h) => key(h.name)))
  const haveBase = new Set(roster.map((h) => key(h.name.replace(/^각성 /, ''))))

  console.log('등장인물 목록 받는 중…')
  const listHtml = await get(LIST)
  const links = [...listHtml.matchAll(/href=['"]\/w\/([^'"#?]+)['"]/g)]
    .map((m) => decodeURIComponent(m[1]))
  const heroPages = [...new Set(links.filter((d) => d.endsWith(SUFFIX)))]
  const names = heroPages.map((d) => d.slice(0, -SUFFIX.length))
  console.log(`영웅 문서 후보 ${names.length}개`)

  // 이미 있는 것(기본형/각성 어느 쪽이든)은 건너뛴다
  const fresh = names.filter((n) => !haveBase.has(key(n)) && !have.has(key(n)))
  console.log(`도감에 없는 후보 ${fresh.length}개: ${fresh.join(', ') || '(없음)'}`)

  const added = []
  for (const name of fresh) {
    process.stdout.write(`  ${name} … `)
    let info
    for (let a = 0; a < 2; a++) {
      try { info = parseHero(name, await get(name + SUFFIX)); break } catch { await sleep(1500) }
    }
    await sleep(800)
    if (!info || !info.isHero) { console.log('영웅 아님 — 건너뜀'); continue }
    if (!info.grade) { console.log('등급 못 읽음 — 건너뜀(직접 확인 필요)'); continue }
    // 도감에 남기는 기준: 전설이거나, 각성이 있거나. 그 외(희귀·고급·일반 비각성)는
    // 길드전에 안 쓰여서 이미 한 번 걷어냈다 — 다시 주워오면 안 된다.
    if (info.grade !== '전설' && !info.hasAwakening) {
      console.log(`${info.grade}·각성없음 — 규칙상 제외`); continue
    }
    const finalName = info.hasAwakening ? '각성 ' + name : name
    if (have.has(key(finalName))) { console.log('이미 있음'); continue }
    added.push({
      id: finalName, name: finalName, grade: info.grade,
      position: info.position || null, pvpRelevant: null,
      star: info.hasAwakening ? 7 : 6, cardBg: '04', cardBadge: '01',
      skills: [], custom: false,
    })
    console.log(`추가 → ${finalName} (${info.grade}/${info.position || '유형?'}${info.hasAwakening ? ', 각성' : ''})`)
  }

  console.log(`\n신규 ${added.length}명`)
  if (!added.length) return
  if (!write) { console.log('미리보기입니다. 실제로 넣으려면 --write 를 붙이세요.'); return }
  fs.writeFileSync(HEROES, JSON.stringify([...roster, ...added], null, 2) + '\n', 'utf8')
  console.log(`heroes.json 에 ${added.length}명 추가 완료.`)
  console.log('※ 스킬·카드 아트는 비어 있습니다 — 필요하면 채워 주세요.')
}

main().catch((e) => { console.error(e); process.exit(1) })
