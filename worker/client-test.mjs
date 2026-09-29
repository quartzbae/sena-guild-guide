// 클라이언트 저장 프로토콜 통합 테스트 — 실제 src/store.ts 를 번들해 로컬 워커(wrangler dev)에 붙여 돌린다.
// 화면 없이 브라우저 전역(window·document·localStorage·fetch)만 흉내 낸다.
//
//   cd worker && npx wrangler dev --local --port 8799 --var ADMIN_PW:testpw
//   node worker/client-test.mjs <실행마다 다른 글자>      (sec-test 와 1분 간격을 둘 것)
//
// ★ store.ts 의 업로드 가드(localhost·Node 에서는 push 안 함)를 풀려고 호스트명을 운영 주소로 흉내 낸다.
//   그래서 fetch 가 로컬 워커(127.0.0.1:8799)가 아닌 곳으로 가려 하면 무조건 던진다 — 이 검사를 빼지 말 것.
//   2026-08-14 에 Node 테스트가 운영 데이터를 덮은 사고가 있었다.
import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = path.join(ROOT, 'node_modules', '.cache', 'client-test', 'store.mjs')
await build({
  entryPoints: [path.join(ROOT, 'src', 'store.ts')], bundle: true, format: 'esm', platform: 'neutral',
  mainFields: ['module', 'main'], loader: { '.json': 'json' }, external: ['react'], outfile: BUNDLE, logLevel: 'error',
})
const W = 'http://127.0.0.1:8799'
const PROD = 'https://sena-guild-search.ericalapiestral.workers.dev'
const PW = 'testpw'
const R = process.argv[2] || 'h1'
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (x ? '  <- ' + x : ''))) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let ipSeq = 0
const realFetch = globalThis.fetch
const direct = async (path, { method = 'POST', body, token, admin } = {}) => {
  ipSeq++
  const h = { 'content-type': 'application/json', 'cf-connecting-ip': `10.77.${(ipSeq >> 8) & 255}.${ipSeq & 255}` }
  if (token) h.authorization = 'Bearer ' + token
  if (admin) h['x-admin-pw'] = Buffer.from(PW).toString('base64')
  const r = await realFetch(W + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  let j = null; try { j = await r.json() } catch { /* 없음 */ }
  return { s: r.status, j }
}

// ---- 준비: 명단·아이디·토큰 ----
const members = [
  { id: 'm1', name: '길마' + R, role: '길드마스터', records: [] },
  { id: 'm2', name: '쫄병' + R, role: '멤버', records: [] },
  { id: 'own', name: '작업하는고양이', role: '멤버', records: [] },
]
await direct('/auth/enable', { body: { on: false }, admin: true })
await direct('/data', { body: { data: { members, siegeRounds: [{ label: '1주차', entries: [{ name: '길마' + R, value: 100 }] }], staffNotes: { m2: '메모' }, counters: [], savedDecks: [] } } })
const i1 = await direct('/auth/issue', { body: { id: 'm1' }, admin: true })
const i2 = await direct('/auth/issue', { body: { id: 'm2' }, admin: true })
await direct('/auth/enable', { body: { on: true }, admin: true })
const tokenFor = async (name, tmp, next) => {
  const l = await direct('/auth/login', { body: { name, pw: tmp } })
  const c = await direct('/auth/password', { body: { pw: tmp, next }, token: l.j?.token })
  return c.j?.token
}
const staffTok = await tokenFor('길마' + R, i1.j.pw, 'harnessP1' + R)
const memTok = await tokenFor('쫄병' + R, i2.j.pw, 'harnessP2' + R)
ok('준비: 운영진·길드원 토큰', !!staffTok && !!memTok)

// ---- 브라우저 흉내 ----
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
globalThis.window = {
  location: { hostname: 'ericalapiestral-hash.github.io' },   // 공유 저장소 업로드가 켜지는 주소
  setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t),
  setInterval: () => 0, addEventListener: () => {},
}
globalThis.document = { hidden: false, addEventListener: () => {} }

let posts = []            // 스토어가 보낸 POST /data 본문
let stripMerge = false    // true 면 옛 워커처럼 x-save-merge 헤더를 떼어 낸다
globalThis.fetch = async (url, init = {}) => {
  const u = String(url).replace(PROD, W)
  // ★ 로컬 워커가 아니면 절대 안 보낸다. store.ts 의 업로드 가드를 풀려고 호스트명을 운영 주소로
  //   흉내 내고 있어서, 주소 치환이 한 번이라도 빗나가면(WORKER_URL 이 바뀌는 등) 실제 길드
  //   데이터에 쓰게 된다 — 2026-08-14 에 Node 테스트가 운영 데이터를 덮은 사고와 같은 길이다.
  if (!u.startsWith(W + '/')) throw new Error('로컬 워커가 아닌 주소로 가려는 요청을 막았습니다: ' + u)
  const headers = { ...(init.headers || {}), 'cf-connecting-ip': `10.78.${(++ipSeq >> 8) & 255}.${ipSeq & 255}` }
  if (u.endsWith('/data') && init.method === 'POST') posts.push(JSON.parse(init.body))
  const r = await realFetch(u, { ...init, headers, keepalive: undefined })
  if (!stripMerge) return r
  const h = new Headers(r.headers); h.delete('x-save-merge')
  return new Response(await r.arrayBuffer(), { status: r.status, headers: h })
}

let inst = 0
const boot = async (token, name) => {
  store.clear()
  store.set('sena-guild-war:token', token)
  store.set('sena-guild-war:me', name)
  posts = []
  const m = await import(pathToFileURL(BUNDLE).href + '?i=' + (++inst))
  for (let i = 0; i < 50 && m.getUserData().members.length !== 3; i++) await sleep(100)
  return m
}
const settle = () => sleep(2600)   // 1.2초 몰아치기 + 왕복
const keysOf = (p) => Object.keys(p?.data || {}).filter((k) => k !== '_rev').sort().join(',')
const server = async () => (await direct('/data', { method: 'GET', token: staffTok })).j

console.log('\n== A. 합치기 워커 — 바뀐 칸만 보낸다 ==')
{
  const s = await boot(staffTok, '길마' + R)
  ok('첫 pull 로 공유 데이터를 받았다', s.getUserData().members.length === 3)
  s.update((d) => { d.counters = [...d.counters, { id: 'counter-hA' + R, defense: [], counters: [], updatedAt: '2026-01-01' }] })
  const blob = JSON.parse(store.get('sena-guild-war:v1') || '{}')
  ok('★ 올리기 전 편집이 사본과 함께 저장된다(_dirty)', Array.isArray(blob._dirty) && blob._dirty.includes('counters'), JSON.stringify(blob._dirty))
  await settle()
  ok('★ 보낸 칸은 counters 하나뿐', posts.length === 1 && keysOf(posts[0]) === 'counters', posts.map(keysOf).join(' | '))
  const g = await server()
  ok('서버에 반영됐다', !!g?.counters?.some((c) => c.id === 'counter-hA' + R))
  ok('★ 안 보낸 점수 기록은 그대로', g?.siegeRounds?.length === 1, JSON.stringify(g?.siegeRounds))
  const after = JSON.parse(store.get('sena-guild-war:v1') || '{}')
  ok('올라간 뒤 _dirty 가 비었다', Array.isArray(after._dirty) && after._dirty.length === 0, JSON.stringify(after._dirty))
}

console.log('\n== B. 옛 워커(헤더 없음) — 전체를 보낸다 ==')
{
  stripMerge = true
  const s = await boot(staffTok, '길마' + R)
  s.update((d) => { d.counters = [...d.counters, { id: 'counter-hB' + R, defense: [], counters: [], updatedAt: '2026-01-01' }] })
  await settle()
  const k = keysOf(posts[0])
  ok('★ 합치기를 확인 못 하면 상태 전체를 보낸다(옛 워커가 안 보낸 칸을 지우지 않게)',
    posts.length === 1 && k.includes('members') && k.includes('siegeRounds') && k.includes('counters'), k)
  stripMerge = false
}

console.log('\n== C. 대량 삭제 거절 — 그 칸만 되돌리고 다른 편집은 살린다 ==')
{
  const five = Array.from({ length: 5 }, (_, i) => ({ id: 'counter-c' + i + R, defense: [], counters: [], updatedAt: '2026-01-01' }))
  await direct('/data', { body: { data: { counters: five } }, token: staffTok })
  const s = await boot(memTok, '쫄병' + R)
  ok('길드원 사본에 카운터 5개', s.getUserData().counters.length === 5, String(s.getUserData().counters.length))
  s.update((d) => {
    d.counters = d.counters.slice(0, 1)                                    // 4개 삭제 → 거절돼야
    d.savedDecks = [...d.savedDecks, { id: 'deck-x' + R, name: 'x', heroes: [], kind: '공격덱', updatedAt: '2026-01-01' }]
  })
  await settle(); await settle()
  ok('첫 저장은 두 칸을 보냈다', keysOf(posts[0]) === 'counters,savedDecks', posts.map(keysOf).join(' | '))
  ok('★ 거절 뒤 savedDecks 만 다시 보냈다', posts.length >= 2 && keysOf(posts[posts.length - 1]) === 'savedDecks', posts.map(keysOf).join(' | '))
  const g = await server()
  ok('★ 서버의 카운터 5개는 그대로', g?.counters?.length === 5, String(g?.counters?.length))
  ok('★ 같이 한 덱 편집은 살아서 저장됐다', !!g?.savedDecks?.some((x) => x.id === 'deck-x' + R))
  ok('★ 화면의 카운터도 서버 상태로 돌아왔다', s.getUserData().counters.length === 5, String(s.getUserData().counters.length))
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
