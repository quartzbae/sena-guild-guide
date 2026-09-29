// 보안 패치 회귀 테스트 — wrangler dev --local 에 대고 실제 요청을 쏜다.
//   cd worker && npx wrangler dev --local --port 8799 --var ADMIN_PW:testpw
//   node sec-test.mjs <실행마다 다른 글자>
const B = process.env.BASE || 'http://127.0.0.1:8799'
// ★ 로컬 말고는 절대 안 돈다. 첫 동작이 로그인 검사 끄기이고 이어서 /data 에 테스트
//   명단을 덮어쓴다 — BASE 를 운영 주소로 두고 돌리면 실제 명단이 사라진다.
//   (2026-08-14 에 테스트가 운영 데이터를 덮은 사고가 이미 한 번 있었다)
if (!['127.0.0.1', 'localhost'].includes(new URL(B).hostname)) {
  console.error('BASE 가 로컬이 아닙니다: ' + B + ' — 이 테스트는 데이터를 덮어써서 로컬에서만 돌립니다.')
  process.exit(2)
}
const PW = 'testpw'
const R = process.argv[2] || 'a'   // 실행마다 다른 이름 (로컬 KV 가 남아서)
let pass = 0, fail = 0

const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  <- ' + extra : '')) }
}

// ★ 호출마다 다른 가상 IP 로 보낸다. 워커가 IP 단위로 호출을 제한하므로(RL_AUTH·RL_CRED),
//   한 IP 로 몰아 보내면 기능 테스트가 제한에 걸린다. 로컬 런타임은 이 헤더를 그대로
//   넘기고, 운영에서는 Cloudflare 가 덮어쓰므로 위조 통로가 아니다.
//   제한 자체를 보는 테스트는 ip 를 고정해서 보낸다.
let ipSeq = 0
const nextIp = () => { ipSeq++; return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}` }
const call = async (path, { method = 'POST', body, token, admin, adminPw, ip, origin } = {}) => {
  const h = { 'content-type': 'application/json', 'cf-connecting-ip': ip || nextIp() }
  if (origin) h.origin = origin
  if (token) h.authorization = 'Bearer ' + token
  if (admin || adminPw) h['x-admin-pw'] = Buffer.from(adminPw || PW, 'utf8').toString('base64')
  const r = await fetch(B + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  let j = null
  try { j = await r.json() } catch { /* 본문 없음 */ }
  return { s: r.status, j, h: r.headers }
}

const roster = (extra = []) => ({
  data: {
    members: [
      { id: 'm1', name: '길마' + R, role: '길드마스터', records: [] },
      { id: 'm2', name: '쫄병' + R, role: '멤버', records: [] },
      { id: 'own', name: '작업하는고양이', role: '멤버', records: [] },
      ...extra,
    ],
    siegeRounds: [{ label: '1주차', entries: [{ name: '길마' + R, value: 100 }] }],
    staffNotes: { m2: '비밀메모' },
  },
})

console.log('\n== 준비: 검사 꺼진 상태에서 명단 심기 ==')
await call('/auth/enable', { body: { on: false }, admin: true })
// ★ 로컬 KV 는 실행 사이에 남고, 워커는 이제 '안 보낸 칸' 을 지우지 않는다(합치기). 다른 테스트
//   (client-test 등)가 남긴 카운터가 살아 있으면 뒤의 길드원 저장이 '대량 삭제' 로 걸린다 —
//   공유 칸을 빈 배열로 명시해서 비우고 시작한다.
ok('명단 저장 (공유 칸 비우고 시작)', (await call('/data', {
  body: { data: { ...roster().data, counters: [], hiddenCounterIds: [], savedDecks: [], defenseSetups: [], attackTargets: [], siegeGuides: [] } },
})).s === 200)
// 로컬 KV 는 실행 사이에 남는다 — 관리자 목록을 영구 관리자만 남기고 턴다
await call('/auth/admins', { body: { ids: [] }, admin: true })

console.log('\n== 신규: handleAuth 는 POST 만 ==')
ok('GET /auth/enable → 405', (await call('/auth/enable', { method: 'GET' })).s === 405)
ok('POST /auth/enable 빈 본문 → 400', (await call('/auth/enable', { body: {}, admin: true })).s === 400)

console.log('\n== 아이디 발급 후 검사 켜기 ==')
const i1 = await call('/auth/issue', { body: { id: 'm1' }, admin: true })
const i2 = await call('/auth/issue', { body: { id: 'm2' }, admin: true })
ok('m1 발급', i1.s === 200 && !!i1.j.pw)
ok('m2 발급', i2.s === 200 && !!i2.j.pw)
ok('자격 없이 발급 시도 → 403',
  (await call('/auth/issue', { body: { id: 'own' } })).s === 403)
const own = await call('/auth/issue', { body: { id: 'own' }, admin: true })
ok('영구관리자 재발급(시크릿)은 허용', own.s === 200)
ok('검사 켜기', (await call('/auth/enable', { body: { on: true }, admin: true })).s === 200)

console.log('\n== 문이 실제로 닫혔나 ==')
ok('토큰 없이 GET /data → 401', (await call('/data', { method: 'GET' })).s === 401)
ok('토큰 없이 /api/siege → 401', (await call('/api/siege', { method: 'GET' })).s === 401)

console.log('\n== 임시 비번 → 정규 비번, 그리고 옛 토큰 무효화 ==')
const l1 = await call('/auth/login', { body: { name: '길마' + R, pw: i1.j.pw } })
ok('로그인', l1.s === 200 && !!l1.j.token, JSON.stringify(l1.j))
ok('mustChange 표시', l1.j.mustChange === true)
ok('임시 비번으로는 /data 거부(403 mustchange)',
  (await call('/data', { method: 'GET', token: l1.j.token })).s === 403)
const chg = await call('/auth/password', { body: { pw: i1.j.pw, next: 'newpass1' }, token: l1.j.token })
ok('비번 변경 + 새 토큰 반환', chg.s === 200 && !!chg.j.token, JSON.stringify(chg.j))
ok('★ 비번 바꾸기 전 토큰은 죽는다', (await call('/data', { method: 'GET', token: l1.j.token })).s === 401)
ok('새 토큰은 통한다', (await call('/data', { method: 'GET', token: chg.j.token })).s === 200)
const staffTok = chg.j.token

console.log('\n== 운영진 전용 데이터가 일반 길드원에게 안 나가나 ==')
const l2 = await call('/auth/login', { body: { name: '쫄병' + R, pw: i2.j.pw } })
const chg2 = await call('/auth/password', { body: { pw: i2.j.pw, next: 'newpass2' }, token: l2.j.token })
const memTok = chg2.j.token
const memData = await call('/data', { method: 'GET', token: memTok })
ok('일반 길드원 /data 에 siegeRounds 없음', memData.s === 200 && !('siegeRounds' in memData.j))
ok('일반 길드원 /data 에 staffNotes 없음', !('staffNotes' in memData.j))
ok('★ 일반 길드원 /api/siege → 403',
  (await call('/api/siege', { method: 'GET', token: memTok })).s === 403)
ok('운영진 /api/siege → 200',
  (await call('/api/siege', { method: 'GET', token: staffTok })).s === 200)

console.log('\n== ★ 신규: 이번 감사에서 나온 구멍들 ==')
// W2 — members 를 통째로 빼면 명단이 사라져 전원(영구 관리자 포함)이 잠겼다
ok('★ members 를 빼고 저장해도 명단이 남는다',
  (await call('/data', { body: { data: {} }, token: staffTok })).s === 200)
const kept = await call('/data', { method: 'GET', token: staffTok })
ok('★ 명단이 그대로다', Array.isArray(kept.j?.members) && kept.j.members.length === 3,
  JSON.stringify(kept.j?.members?.length))
// W1 — 중첩 배열 검증
ok('★ counters 안의 counters:null → 400',
  (await call('/data', {
    body: { data: { counters: [{ id: 'x', defense: [], counters: null }] } }, token: memTok,
  })).s === 400)
ok('정상 중첩은 통과', (await call('/data', {
  body: { data: { counters: [{ id: 'x', defense: [], counters: [] }] } }, token: memTok,
})).s === 200)
// W5 — 일반 길드원이 칸을 부풀려 저장본을 막는 것
ok('★ 일반 길드원의 거대한 칸 → 413', (await call('/data', {
  body: { data: { counters: [{ id: 'big', defense: [], counters: [], memo: 'A'.repeat(250_000) }] } },
  token: memTok,
})).s === 413)
await call('/data', { body: { data: roster().data }, token: staffTok })   // 원복
// W4 — /learn/latest 가 관문 밖에 있어 인터넷 누구나 브리핑을 읽었다
ok('★ /learn/latest 토큰 없이 → 401',
  (await call('/learn/latest', { method: 'GET' })).s === 401)
ok('★ /learn/latest 일반 길드원 → 403',
  (await call('/learn/latest', { method: 'GET', token: memTok })).s === 403)
ok('/learn/latest 운영진 → 200',
  (await call('/learn/latest', { method: 'GET', token: staffTok })).s === 200)

console.log('\n== ★ 운영진 전용 칸은 요청에서 빠져도 이월된다 ==')
// 권한이 막 바뀐 클라이언트는 siegeRounds 가 없는 stripped 사본을 들고 있다.
// 그 상태로 저장해도 과거 회차가 날아가면 안 된다.
await call('/data', { body: { data: { members: roster().data.members } }, token: staffTok })
const carried = await call('/data', { method: 'GET', token: staffTok })
ok('★ 요청에서 빠진 siegeRounds 가 살아남는다',
  Array.isArray(carried.j?.siegeRounds) && carried.j.siegeRounds.length === 1,
  JSON.stringify(carried.j?.siegeRounds))
ok('요청에서 빠진 staffNotes 도 살아남는다', carried.j?.staffNotes?.m2 === '비밀메모')
// 그래도 '빈 배열을 보내는 것'은 통해야 한다 — [전체 초기화]가 그 경로다
await call('/data', { body: { data: { ...roster().data, siegeRounds: [] } }, token: staffTok })
const cleared = await call('/data', { method: 'GET', token: staffTok })
ok('★ 빈 배열을 명시하면 실제로 비워진다',
  Array.isArray(cleared.j?.siegeRounds) && cleared.j.siegeRounds.length === 0,
  JSON.stringify(cleared.j?.siegeRounds))
await call('/data', { body: { data: roster().data }, token: staffTok })   // 뒷 테스트를 위해 원복

console.log('\n== ★ 명단에서 빠진 사이트 관리자 차단 ==')
ok('m2 를 사이트 관리자로', (await call('/auth/admins', { body: { ids: ['m2'] }, admin: true })).s === 200)
ok('m2 가 /auth/list 사용 가능', (await call('/auth/list', { token: memTok })).s === 200)
// ★ 사이트 관리자여도 영구 관리자 비번은 못 건드린다 — 재발급은 곧 계정 인수다.
//   토큰만으로 부르면 worker 의 ownerId 가드(handleAuth 의 /auth/issue)에 걸려야 한다.
//   위의 '자격 없이' 케이스는 그 앞의 관리자 관문에서 먼저 막혀 여기까지 안 온다.
ok('★ 사이트 관리자라도 영구관리자 재발급은 시크릿 없이 거부',
  (await call('/auth/issue', { body: { id: 'own' }, token: memTok })).s === 403)
// m2 를 명단에서 지운다 (운영진 권한으로 저장)
await call('/data', {
  body: { data: { ...roster().data, members: roster().data.members.filter((m) => m.id !== 'm2') } },
  token: staffTok,
})
ok('★ 명단에서 지운 뒤 m2 의 /auth/list → 403',
  (await call('/auth/list', { token: memTok })).s === 403)
ok('★ 명단에서 지운 뒤 m2 의 /auth/enable → 403',
  (await call('/auth/enable', { body: { on: false }, token: memTok })).s === 403)
const after = await call('/auth/list', { admin: true })
// 목록에서 지우지는 않는다 — 운영진이 members 만 고쳐도 다른 관리자를 영구 강등시킬
// 수 있었기 때문이다. 대신 힘이 없고(위 403 둘), 화면에서 정리하게 표시해 준다.
ok('★ 유령 관리자 id 는 목록에 남아도 힘이 없다(ghostAdmins 로 표시)',
  after.s === 200 && Array.isArray(after.j?.ghostAdmins) && after.j.ghostAdmins.includes('m2'),
  JSON.stringify(after.j?.ghostAdmins))

console.log('\n== ★ 외부 처리는 계정 정지가 아니다 ==')
// 외부 처리는 '집계에서 뺀다' 는 뜻이다. 관리자가 자리 때문에 잠깐 명단에서
// 내려가 있는 동안 사이트를 통째로 못 쓰게 되면 명단을 되돌릴 사람이 없어진다.
//
// ★ POST /data 는 guard() 를 타므로 x-admin-pw 로는 못 쓴다 — 토큰으로 보내야 한다.
//   (처음에 admin:true 로 보냈다가 저장이 안 돼서 테스트가 헛돌았다)
{
  const exRoster = (mut) => ({ data: { ...roster().data, members: roster().data.members.map(mut) } })
  // m1(길마·운영진)은 아직 사이트 관리자가 아니다 → 외부 처리하면 예전처럼 막혀야 한다
  ok('외부 처리 저장',
    (await call('/data', {
      body: exRoster((m) => (m.id === 'm1' ? { ...m, excluded: true } : m)), token: staffTok,
    })).s === 200)
  ok('★ 외부 처리된 일반 계정은 여전히 차단',
    (await call('/data', { method: 'GET', token: staffTok })).s === 403)
  ok('★ 외부 처리된 일반 계정은 로그인도 거부',
    (await call('/auth/login', { body: { name: '길마' + R, pw: 'newpass1' } })).s === 401)
  // 시크릿으로 사이트 관리자로 올린다 (/auth/* 는 x-admin-pw 로 통한다)
  ok('m1 을 사이트 관리자로', (await call('/auth/admins', { body: { ids: ['m1'] }, admin: true })).s === 200)
  ok('★ 외부 처리된 사이트 관리자는 통과',
    (await call('/data', { method: 'GET', token: staffTok })).s === 200)
  ok('★ 외부 처리된 사이트 관리자는 로그인도 된다',
    (await call('/auth/login', { body: { name: '길마' + R, pw: 'newpass1' } })).s === 200)
  ok('★ 외부 처리된 사이트 관리자는 /auth/list 도 쓴다',
    (await call('/auth/list', { token: staffTok })).s === 200)
  // 원복 — 이제 m1 이 통하므로 자기 토큰으로 되돌릴 수 있다
  await call('/data', { body: { data: roster().data }, token: staffTok })
  await call('/auth/admins', { body: { ids: [] }, admin: true })
  ok('원복 후 정상', (await call('/data', { method: 'GET', token: staffTok })).s === 200)
}

console.log('\n== 아이디 해제가 토큰을 실제로 끊나 ==')
await call('/data', { body: roster(), token: staffTok })       // m2 명단 복구
const l2b = await call('/auth/login', { body: { name: '쫄병' + R, pw: 'newpass2' } })
ok('m2 재로그인', l2b.s === 200)
ok('해제', (await call('/auth/revoke', { body: { ids: ['m2'] }, admin: true })).s === 200)
ok('★ 해제된 아이디의 토큰 → 401', (await call('/data', { method: 'GET', token: l2b.j.token })).s === 401)

console.log('\n== 로그인 시도 제한 ==')
let got429 = false
for (let i = 0; i < 13; i++) {
  // 같은 곳에서 같은 닉으로 — 제한은 '어디서 + 누구' 단위다
  const r = await call('/auth/login', { body: { name: '길마' + R, pw: 'wrong' + i }, ip: '10.200.0.1' })
  if (r.s === 429) { got429 = true; break }
}
ok('★ 반복 실패 시 429', got429)
ok('다른 곳에서의 같은 닉 로그인은 막히지 않는다(남의 닉으로 잠그기 방지)',
  (await call('/auth/login', { body: { name: '길마' + R, pw: 'wrong-x' }, ip: '10.200.0.2' })).s === 401)

console.log('\n== 저장 상한 ==')
const big = await call('/data', {
  body: { data: { ...roster().data, counters: Array.from({ length: 2500 }, (_, i) => ({ id: 'c' + i })) } },
  token: staffTok,
})
ok('항목 수 상한 → 413', big.s === 413, 'status=' + big.s)

console.log('\n== 잘못된 본문 방어 ==')
const nullBody = await fetch(B + '/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: 'null',
})
ok('JSON null 로그인 → 500 아님', nullBody.status !== 500, 'status=' + nullBody.status)

console.log('\n== 2차 패치 ==')
// 오염 원소 하나로 전원 화면이 죽던 것
const poisoned = await call('/data', {
  body: { data: { ...roster().data, counters: [null] } }, token: staffTok,
})
ok('★ counters:[null] → 400', poisoned.s === 400, 'status=' + poisoned.s)

// 영구 관리자를 명단에서 밀어내기
const kick = await call('/data', {
  body: { data: { ...roster().data, members: roster().data.members.filter((m) => m.id !== 'own') } },
  token: staffTok,
})
ok('★ 영구 관리자 명단에서 제거 → 403', kick.s === 403, 'status=' + kick.s)
const excl = await call('/data', {
  body: {
    data: {
      ...roster().data,
      members: roster().data.members.map((m) => (m.id === 'own' ? { ...m, excluded: true } : m)),
    },
  },
  token: staffTok,
})
ok('★ 영구 관리자 외부처리 → 403', excl.s === 403, 'status=' + excl.s)

// 본문을 읽기 전에 크기로 자르는가
const huge = await fetch(B + '/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'x'.repeat(40000), pw: 'y' }),
})
ok('★ 과대 본문 로그인 → 413', huge.status === 413, 'status=' + huge.status)

console.log('\n== 3차 패치: 비번 규칙·관리자 관문 ==')
// ★ 각 테스트가 '자기 문제' 만 잡도록 짠다. 수정 전 워커에 대고 돌렸을 때, 앞 테스트의
//   부작용(비번이 바뀌어 토큰이 죽는 등)으로 뒤 테스트가 엉뚱한 이유로 통과·실패하면
//   그 테스트는 아무것도 증명하지 못한다. 그래서 거절돼야 할 요청은 '틀린 현재 비번' 으로
//   보내 옛 워커에서도 비번이 바뀌지 않게 하고, 관리자 지정은 옛·새 워커 모두 받는
//   { ids } 로 한다(add/remove 는 따로 본다).
const i2b = await call('/auth/issue', { body: { id: 'm2' }, admin: true })
const l2c = await call('/auth/login', { body: { name: '쫄병' + R, pw: i2b.j?.pw } })
ok('m2 재발급 후 임시 로그인', l2c.s === 200 && l2c.j?.mustChange === true, JSON.stringify(l2c.j))
ok('관리자로 지정(ids)', (await call('/auth/admins', { body: { ids: ['m2'] }, admin: true })).s === 200)
ok('★ 임시 비번 상태의 사이트 관리자 → /auth/list 403',
  (await call('/auth/list', { token: l2c.j?.token })).s === 403)
// 현재 비번이 틀린 채로 보낸다 — 새 워커는 규칙에서 먼저 400, 옛 워커는 현재 비번에서 401
ok('★ 현재 비번과 같은 새 비번 → 400',
  (await call('/auth/password', { body: { pw: 'samepass9', next: 'samepass9' }, token: l2c.j?.token })).s === 400)
ok('★ 7자 비번 → 400',
  (await call('/auth/password', { body: { pw: 'wrong-now', next: 'abc1234' }, token: l2c.j?.token })).s === 400)
const c2 = await call('/auth/password', { body: { pw: i2b.j?.pw, next: 'newpass2b' }, token: l2c.j?.token })
ok('정규 비번으로 변경', c2.s === 200 && !!c2.j?.token, JSON.stringify(c2.j))
const m2Tok = c2.j?.token
ok('정규 비번 뒤에는 /auth/list 200', (await call('/auth/list', { token: m2Tok })).s === 200)

const lst1 = await call('/auth/list', { admin: true })
ok('★ 관리 기록이 남는다(재발급·지정)',
  Array.isArray(lst1.j?.audit) && lst1.j.audit.some((a) => a.action === 'issue') && lst1.j.audit.some((a) => a.action === 'admins'),
  JSON.stringify(lst1.j?.audit?.slice(0, 3)))
ok('★ 관리 기록에 비번이 없다', Array.isArray(lst1.j?.audit) && !JSON.stringify(lst1.j.audit).includes(String(i2b.j?.pw)))
ok('★ 마지막 로그인 시각이 보인다', (lst1.j?.members?.find((m) => m.id === 'm2')?.lastAt || 0) > 0,
  JSON.stringify(lst1.j?.members?.find((m) => m.id === 'm2')))

// 바뀐 것만 보내는 관리자 지정
ok('관리자 해제(remove) 요청', (await call('/auth/admins', { body: { remove: ['m2'] }, admin: true })).s === 200)
ok('★ remove 로 해제된다', !(await call('/auth/list', { admin: true })).j?.admins?.includes('m2'))
ok('관리자 지정(add) 요청', (await call('/auth/admins', { body: { add: ['m2'] }, admin: true })).s === 200)
ok('★ add 로 지정된다', !!(await call('/auth/list', { admin: true })).j?.admins?.includes('m2'))
await call('/auth/admins', { body: { ids: ['m2'] }, admin: true })   // 옛 워커에서도 m2 가 관리자이게

console.log('\n== 3차 패치: 검사 끄기 ==')
{
  const r = await call('/auth/enable', { body: { on: false }, token: m2Tok })
  ok('★ 사이트 관리자(영구 아님)의 검사 끄기 → 403', r.s === 403, 'status=' + r.s)
  if (r.s === 200) await call('/auth/enable', { body: { on: true }, admin: true })   // 옛 워커에서 꺼졌으면 되돌린다
}
const off = await call('/auth/enable', { body: { on: false }, admin: true })
ok('★ 시크릿으로 끄면 자동 복구 시각이 붙는다', off.s === 200 && off.j?.offUntil > Date.now(), JSON.stringify(off.j))
ok('꺼진 동안 목록에 복구 시각이 보인다', ((await call('/auth/list', { admin: true })).j?.offUntil || 0) > Date.now())
ok('다시 켜기', (await call('/auth/enable', { body: { on: true }, admin: true })).s === 200)

console.log('\n== 3차 패치: 세션 ==')
const la = await call('/auth/login', { body: { name: '쫄병' + R, pw: 'newpass2b' } })
ok('두 번째 기기 로그인', la.s === 200)
ok('모든 기기 로그아웃 요청', (await call('/auth/logout-all', { token: m2Tok })).s === 200)
ok('★ 그 뒤 첫 기기 토큰 → 401', (await call('/data', { method: 'GET', token: m2Tok })).s === 401)
ok('★ 그 뒤 두 번째 기기 토큰도 → 401', (await call('/data', { method: 'GET', token: la.j?.token })).s === 401)
const lb2 = await call('/auth/login', { body: { name: '쫄병' + R, pw: 'newpass2b' } })
ok('다시 로그인하면 된다', lb2.s === 200 && (await call('/data', { method: 'GET', token: lb2.j?.token })).s === 200)
ok('강제 로그아웃 요청(관리자)', (await call('/auth/kick', { body: { id: 'm2' }, admin: true })).s === 200)
ok('★ 강제 로그아웃 뒤 토큰 → 401', (await call('/data', { method: 'GET', token: lb2.j?.token })).s === 401)
const lb3 = await call('/auth/login', { body: { name: '쫄병' + R, pw: 'newpass2b' } })
ok('강제 로그아웃은 비번을 안 바꾼다', lb3.s === 200)
const memTok3 = lb3.j?.token
ok('★ 영구 관리자는 사이트 관리자가 강제 로그아웃 못 한다',
  (await call('/auth/kick', { body: { id: 'own' }, token: memTok3 })).s === 403)
// 뒤 테스트에서는 일반 길드원으로 쓴다
await call('/auth/admins', { body: { ids: [] }, admin: true })
ok('m2 가 일반 길드원으로 돌아왔다', !(await call('/auth/list', { admin: true })).j?.admins?.includes('m2'))

console.log('\n== 3차 패치: 공유 칸 모양 ==')
ok('★ attackTargets 의 enemy 가 null → 400', (await call('/data', {
  body: { data: { attackTargets: [{ id: 'a', name: 'x', enemy: null, decks: [] }] } }, token: memTok3,
})).s === 400)
ok('★ counters 의 updatedAt 이 숫자 → 400', (await call('/data', {
  body: { data: { counters: [{ id: 'u', defense: [], counters: [], updatedAt: 1 }] } }, token: memTok3,
})).s === 400)
ok('★ defenseSetups 의 reserve 가 숫자 → 400', (await call('/data', {
  body: { data: { defenseSetups: [{ id: 'd', name: 'x', heroes: [], reserve: 1 }] } }, token: memTok3,
})).s === 400)
const filled = await call('/data', {
  body: { data: { attackTargets: [{ id: 'a', name: 'x' }], counters: [{ id: 'y' }] } }, token: memTok3,
})
ok('필수 배열이 빠진 항목도 저장은 된다', filled.s === 200, 'status=' + filled.s + ' ' + JSON.stringify(filled.j))
{
  const g = await call('/data', { method: 'GET', token: memTok3 })
  const at = g.j?.attackTargets?.find((t) => t.id === 'a')
  const ct = g.j?.counters?.find((c) => c.id === 'y')
  ok('★ 빠진 enemy·decks 를 [] 로 채운다', Array.isArray(at?.enemy) && Array.isArray(at?.decks), JSON.stringify(at))
  ok('★ 빠진 defense·counters 를 [] 로 채운다', Array.isArray(ct?.defense) && Array.isArray(ct?.counters), JSON.stringify(ct))
}

console.log('\n== 3차 패치: 대량 삭제·변경 기록 ==')
// 운영진 저장은 이제 '안 보낸 칸' 을 지우지 않는다(합치기) — 앞 테스트가 남긴 카운터를 먼저 비운다
await call('/data', { body: { data: { counters: [], hiddenCounterIds: [] } }, token: staffTok })
// 화면이 만드는 새 카운터 id 는 'counter-' 로 시작한다(store.ts 의 newId). 그 밖의 새 id 는
// 기본 카운터를 가리는 것으로 보고 한 번에 3개까지만 받는다 — 아래 '가리기' 테스트 참고.
const five = Array.from({ length: 5 }, (_, i) => ({ id: 'counter-bk' + i + R, defense: [], counters: [] }))
ok('카운터 5개로', (await call('/data', { body: { data: { counters: five } }, token: memTok3 })).s === 200)
const bulk = await call('/data', { body: { data: { counters: five.slice(0, 1) } }, token: memTok3 })
ok('★ 일반 길드원이 한 번에 4개 삭제 → 403 bulk', bulk.s === 403 && bulk.j?.code === 'bulk', JSON.stringify(bulk.j))
ok('★ 거절 사유가 된 칸을 알려 준다(field)', bulk.j?.field === 'counters', JSON.stringify(bulk.j))
ok('3개 삭제는 된다', (await call('/data', { body: { data: { counters: five.slice(0, 2) } }, token: memTok3 })).s === 200)
const hide = await call('/data', { body: { data: { hiddenCounterIds: ['d1', 'd2', 'd3', 'd4'] } }, token: memTok3 })
ok('★ 기본 카운터 4개를 한꺼번에 숨기기 → 403', hide.s === 403, 'status=' + hide.s)
{
  // ★ 지우지 않고 '비우기' — id 는 두고 내용만 바꾸면 삭제로 안 세던 우회로
  const four = Array.from({ length: 4 }, (_, i) => ({ id: 'bm' + i, defense: ['가'], counters: [] }))
  await call('/data', { body: { data: { counters: four } }, token: staffTok })
  const blank = await call('/data', {
    body: { data: { counters: four.map((c) => ({ id: c.id, defense: [], counters: [] })) } }, token: memTok3,
  })
  ok('★ 4개의 내용을 한꺼번에 비우기 → 403 bulk', blank.s === 403 && blank.j?.code === 'bulk', JSON.stringify(blank.j))
  // ★ 기본 카운터와 같은 id 로 빈 항목을 넣어 가리기 — 기본 카운터 사전을 통째로 덮던 우회로
  const shade = await call('/data', {
    body: { data: { counters: [...four, ...['lounge-z1', 'lounge-z2', 'lounge-z3', 'lounge-z4'].map((id) => ({ id, defense: [], counters: [] }))] } },
    token: memTok3,
  })
  ok('★ 기본 카운터 4개를 빈 항목으로 가리기 → 403 bulk', shade.s === 403 && shade.j?.code === 'bulk', JSON.stringify(shade.j))
  const mine = await call('/data', {
    body: { data: { counters: [...four, ...Array.from({ length: 5 }, (_, i) => ({ id: 'counter-new' + i + R, defense: [], counters: [] }))] } },
    token: memTok3,
  })
  ok('화면이 만드는 새 카운터(counter-…)는 여러 개 한 번에 추가된다', mine.s === 200, JSON.stringify(mine.j))
  // ★ 객체 칸의 문자열 원소 — 예전엔 받아 줘서, 길드원 한 명이 넣어 두면 다른 길드원의 저장이
  //   전부 '대량 삭제' 로 거절됐다(클라이언트는 그 문자열을 버리고 보내니까)
  ok('★ counters 에 문자열 원소 → 400', (await call('/data', {
    body: { data: { counters: [...four, 'a', 'b', 'c', 'd'] } }, token: memTok3,
  })).s === 400)
  // ★ 중첩 배열의 빈 슬롯 — 홈이 슬롯마다 h.name 을 읽다 전원 TypeError 로 죽었다
  ok('★ 카운터 덱의 heroes:[null] → 400', (await call('/data', {
    body: { data: { counters: [...four, { id: 'counter-nz' + R, defense: [], counters: [{ heroes: [null], notes: '', confidence: '추측' }] }] } },
    token: memTok3,
  })).s === 400)
}
ok('운영진은 대량 삭제가 된다',
  (await call('/data', { body: { data: { ...roster().data, counters: [] } }, token: staffTok })).s === 200)
const same1 = await call('/data', { body: { data: { counters: [] } }, token: memTok3 })
ok('★ 안 바뀐 저장은 쓰지 않는다', same1.s === 200 && same1.j?.unchanged === true, JSON.stringify(same1.j))
{
  const sv = await call('/data', { method: 'GET', token: staffTok })
  const mv = await call('/data', { method: 'GET', token: memTok3 })
  ok('★ 운영진은 변경 기록을 본다', Array.isArray(sv.j?._log) && sv.j._log.some((e) => e.by === '쫄병' + R),
    JSON.stringify(sv.j?._log?.slice(-2)))
  ok('★ 변경 기록이 비우기·가리기도 센다(modified)', Array.isArray(sv.j?._log) && sv.j._log.some((e) => e.modified > 0),
    JSON.stringify(sv.j?._log?.slice(-3)))
  ok('★ 일반 길드원에게는 변경 기록·저장 횟수가 안 간다', mv.s === 200 && !('_log' in mv.j) && !('_wb' in mv.j))
  await call('/data', { body: { data: { ...roster().data, staffNotes: { m2: '메모' + R }, _log: [{ by: '위조' }] } }, token: staffTok })
  const v2 = await call('/data', { method: 'GET', token: staffTok })
  ok('★ 클라이언트가 보낸 _log 는 무시된다', !v2.j?._log?.some((e) => e.by === '위조'), JSON.stringify(v2.j?._log?.slice(-1)))
}

console.log('\n== 3차 패치: 바뀐 칸만 받아 합치기 ==')
// 예전엔 저장이 상태 전체를 받아 통째로 바꿔서, 오래된 사본이 다른 사람의 변경을 되돌렸고
// 점수 칸이 빈 사본(권한이 막 바뀐 탭)이 기록을 [] 로 덮었다. 이제 보낸 칸만 얹는다.
await call('/data', { body: { data: { ...roster().data } }, token: staffTok })
{
  const h = await call('/data', { method: 'GET', token: staffTok })
  ok('★ 워커가 합치기를 알린다(x-save-merge)', h.h?.get('x-save-merge') === '1', String(h.h?.get('x-save-merge')))
  const ps = await call('/data', { body: { data: { counters: [{ id: 'counter-v1', defense: [], counters: [] }] } }, token: staffTok })
  ok('운영진이 한 칸만 보낸 저장', ps.s === 200, JSON.stringify(ps.j))
  const g = await call('/data', { method: 'GET', token: staffTok })
  ok('★ 안 보낸 siegeRounds 는 그대로', g.j?.siegeRounds?.length === 1, JSON.stringify(g.j?.siegeRounds))
  ok('★ 안 보낸 명단·운영진 메모도 그대로', g.j?.members?.length === 3 && !!g.j?.staffNotes, JSON.stringify(Object.keys(g.j || {})))
  ok('보낸 칸은 반영된다', !!g.j?.counters?.some((c) => c.id === 'counter-v1'))
  await call('/data', { body: { data: { counters: [], _view: 'member' } }, token: staffTok })
  ok('옛 번들의 _view 는 저장본에 안 남는다', !('_view' in ((await call('/data', { method: 'GET', token: staffTok })).j || {})))
}

console.log('\n== 3차 패치: 영구 관리자 이름 ==')
{
  const rename = await call('/data', {
    body: { data: { ...roster().data, members: roster().data.members.map((m) => (m.id === 'own' ? { ...m, name: '딴이름' } : m)) } },
    token: staffTok,
  })
  ok('★ 영구 관리자 이름 바꾸기 → 403', rename.s === 403, 'status=' + rename.s)
  const dup = await call('/data', {
    body: { data: { ...roster().data, members: [{ id: 'fake', name: '작업하는고양이', role: '멤버', records: [] }, ...roster().data.members] } },
    token: staffTok,
  })
  ok('★ 영구 관리자와 같은 이름의 가짜 엔트리 → 400', dup.s === 400, 'status=' + dup.s)
  // ★ 명단을 통째로 비우면 전원이 잠긴다 — 영구 관리자 본인의 저장이어도 막아야 한다
  //   (영구 관리자 보호는 '본인' 저장을 막지 않아서 [전체 초기화]가 그대로 통과했다)
  const lo = await call('/auth/login', { body: { name: '작업하는고양이', pw: own.j?.pw } })
  const oc = await call('/auth/password', { body: { pw: own.j?.pw, next: 'ownerpass9' }, token: lo.j?.token })
  const ownTok = oc.j?.token
  ok('영구 관리자 로그인', !!ownTok, JSON.stringify(oc.j))
  const emptyOwn = await call('/data', { body: { data: { ...roster().data, members: [] } }, token: ownTok })
  ok('★ 영구 관리자도 명단을 통째로 비울 수 없다 → 400', emptyOwn.s === 400, 'status=' + emptyOwn.s)
  ok('명단이 그대로 남아 있다', ((await call('/data', { method: 'GET', token: staffTok })).j?.members?.length || 0) === 3)
}

console.log('\n== 3차 패치: 일별 백업 ==')
ok('★ 일별 백업 날짜 목록(운영진)', await (async () => {
  const r = await call('/data/daily?list=1', { method: 'GET', token: staffTok })
  return r.s === 200 && Array.isArray(r.j?.days)
})())
ok('일별 백업 목록은 일반 길드원 403', (await call('/data/daily?list=1', { method: 'GET', token: memTok3 })).s === 403)
ok('잘못된 날짜 → 400', (await call('/data/daily?day=../x', { method: 'GET', token: staffTok })).s === 400)

console.log('\n== 3차 패치: 명단에서 빠진 사람의 비번 변경 ==')
await call('/data', { body: { data: { ...roster().data, members: roster().data.members.filter((m) => m.id !== 'm2') } }, token: staffTok })
ok('★ 명단에서 빠진 사람의 비번 변경 → 403',
  (await call('/auth/password', { body: { pw: 'newpass2b', next: 'newpass2c' }, token: memTok3 })).s === 403)
await call('/data', { body: roster(), token: staffTok })   // 원복
const lb4 = await call('/auth/login', { body: { name: '쫄병' + R, pw: 'newpass2b' } })
const memTok4 = lb4.j?.token

console.log('\n== 3차 패치: /ocr 본문 방어 ==')
ok('★ /ocr 에 JSON null → 400 (500 아님)',
  (await call('/ocr', { body: null, token: memTok4, origin: 'http://localhost:5199' })).s === 400)

console.log('\n== 3차 패치: 호출 제한 (같은 곳에서 퍼붓기) ==')
{
  let s429 = false
  for (let i = 0; i < 7; i++) {
    const r = await call('/auth/list', { adminPw: 'wrong' + i, ip: '10.201.0.1' })
    if (r.s === 429) { s429 = true; break }
  }
  ok('★ 틀린 시크릿을 퍼부으면 429', s429)
  ok('★ 한도를 넘긴 뒤에는 맞는 시크릿도 429(비교 자체를 안 한다)',
    (await call('/auth/list', { admin: true, ip: '10.201.0.1' })).s === 429)
  let a429 = false
  for (let i = 0; i < 35; i++) {
    const r = await call('/auth/login', { body: { name: '' }, ip: '10.202.0.1' })
    if (r.s === 429) { a429 = true; break }
  }
  ok('★ /auth/* 를 퍼부으면 429', a429)
  let w429 = false
  for (let i = 0; i < 70; i++) {
    const r = await call('/data', { body: { data: { counters: [] } }, token: memTok4 })
    if (r.s === 429) { w429 = true; break }
  }
  ok('★ 한 사람이 저장을 퍼부으면 429', w429)
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
