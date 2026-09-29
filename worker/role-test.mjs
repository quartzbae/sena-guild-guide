// 권한을 올렸을 때 재로그인 없이 /data 응답 헤더로 전달되는지 확인한다.
const B = 'http://127.0.0.1:8799'
const PW = 'testpw'
const R = process.argv[2] || 'r1'
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (x ? '  <- ' + x : ''))) }

// 호출마다 다른 가상 IP — 워커의 IP 단위 호출 제한에 기능 테스트가 걸리지 않게 (sec-test.mjs 참고)
let ipSeq = 0
const call = async (p, { method = 'POST', body, token, admin } = {}) => {
  ipSeq++
  const h = { 'content-type': 'application/json', 'cf-connecting-ip': `10.250.${(ipSeq >> 8) & 255}.${ipSeq & 255}` }
  if (token) h.authorization = 'Bearer ' + token
  if (admin) h['x-admin-pw'] = Buffer.from(PW, 'utf8').toString('base64')
  const r = await fetch(B + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  let j = null
  try { j = await r.json() } catch { /* noop */ }
  return { s: r.status, j, h: r.headers }
}

const roster = {
  data: {
    members: [
      { id: 'a1', name: '길마' + R, role: '길드마스터', records: [] },
      { id: 'b1', name: '평민' + R, role: '멤버', records: [] },
      { id: 'own', name: '작업하는고양이', role: '멤버', records: [] },
    ],
    siegeRounds: [], staffNotes: {},
  },
}

await call('/auth/enable', { body: { on: false }, admin: true })
ok('명단 저장', (await call('/data', { body: roster })).s === 200)
await call('/auth/admins', { body: { ids: [] }, admin: true })

const ib = await call('/auth/issue', { body: { id: 'b1' }, admin: true })
await call('/auth/enable', { body: { on: true }, admin: true })

// 평범한 길드원으로 로그인
const lb = await call('/auth/login', { body: { name: '평민' + R, pw: ib.j.pw } })
const chg = await call('/auth/password', { body: { pw: ib.j.pw, next: 'pw123456' }, token: lb.j.token })
const tok = chg.j.token
ok('로그인 응답 admin=false', lb.j.admin === false || !lb.j.admin, JSON.stringify(lb.j))

// 아직 관리자 아님 → 헤더도 0
let d = await call('/data', { method: 'GET', token: tok })
ok('CORS 노출 헤더 있음', (d.h.get('access-control-expose-headers') || '').includes('x-role-admin'),
  d.h.get('access-control-expose-headers'))
ok('권한 올리기 전 x-role-admin=0', d.h.get('x-role-admin') === '0', d.h.get('x-role-admin'))
ok('권한 올리기 전 x-role-staff=0', d.h.get('x-role-staff') === '0', d.h.get('x-role-staff'))
ok('권한 올리기 전 운영진 데이터는 안 내려온다', !!d.j && !('siegeRounds' in d.j),
  JSON.stringify(Object.keys(d.j || {})))

// ★ 다른 관리자가 이 사람을 관리자로 올린다 (이 사람은 다시 로그인하지 않는다)
ok('관리자로 지정', (await call('/auth/admins', { body: { ids: ['b1'] }, admin: true })).s === 200)

d = await call('/data', { method: 'GET', token: tok })
ok('★ 재로그인 없이 x-role-admin=1', d.h.get('x-role-admin') === '1', d.h.get('x-role-admin'))
ok('★ 재로그인 없이 x-role-staff=1', d.h.get('x-role-staff') === '1', d.h.get('x-role-staff'))
// __stripped 같은 표식은 워커가 안 남긴다 — stripForMember 는 실제 키를 지운다.
// 그래서 운영진 전용 칸이 돌아왔는지로 본다(위에서 0 일 때는 없어야 한다).
ok('★ 이제 운영진 데이터가 내려온다', !!d.j && 'siegeRounds' in d.j,
  JSON.stringify(Object.keys(d.j || {})))

// 다시 내리면 즉시 0 으로
ok('관리자 해제', (await call('/auth/admins', { body: { ids: ['own'] }, admin: true })).s === 200)
d = await call('/data', { method: 'GET', token: tok })
ok('★ 해제 뒤 x-role-admin=0', d.h.get('x-role-admin') === '0', d.h.get('x-role-admin'))

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
