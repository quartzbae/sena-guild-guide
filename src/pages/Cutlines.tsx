import { useMemo, useState } from 'react'
import type { CutlineGuide } from '../types'
import { activeMembers, update, useUserData } from '../store'
import { isAdmin } from '../auth'
import { WEEKDAYS, fmt } from '../lib/stat'

/**
 * 커트라인 기준표 — 회차마다 넣는 커트라인과 별개로, 상시 참고하는 기준.
 *  - 공성전: 요일마다 넘어야 하는 점수
 *  - 파괴신: 파이 초월 단계(길드원 등급)마다 넘어야 하는 딜량
 * 운영진이 적고, 길드원 전원이 본다. 저장하면 공유 저장소로 자동 반영.
 */

const EMPTY_GUIDE: CutlineGuide = { destroyerByTier: {}, siegeByDay: {} }

/** '파이 6초' → 6 (정렬용). 형식이 다르면 맨 뒤로 */
function tierOrder(t: string): number {
  const m = t.match(/(\d+)\s*초/)
  return m ? Number(m[1]) : 999
}

export function CutlinesPage() {
  const userData = useUserData()
  const admin = isAdmin()
  const guide = userData.cutlineGuide ?? EMPTY_GUIDE

  // 파이 초월 단계 목록 = 저장된 기준 + 길드원 등급에 실제로 있는 단계
  // (외부 처리한 계정은 빼고 센다 — 지금 길드에 없는 사람이 인원수를 부풀리면 안 된다)
  const memberTiers = useMemo(() => {
    const count = new Map<string, number>()
    for (const m of activeMembers(userData.members)) {
      if (m.tier) count.set(m.tier, (count.get(m.tier) ?? 0) + 1)
    }
    return count
  }, [userData.members])

  const tierRows = useMemo(() => {
    const keys = new Set([...Object.keys(guide.destroyerByTier), ...memberTiers.keys()])
    return [...keys].sort((a, b) => tierOrder(a) - tierOrder(b) || a.localeCompare(b))
  }, [guide.destroyerByTier, memberTiers])

  const [editing, setEditing] = useState(false)
  const [dDraft, setDDraft] = useState<Record<string, string>>({})
  const [sDraft, setSDraft] = useState<Record<string, string>>({})
  const [memoDraft, setMemoDraft] = useState('')
  const [newTier, setNewTier] = useState('')

  const startEdit = () => {
    setDDraft(Object.fromEntries(Object.entries(guide.destroyerByTier).map(([k, v]) => [k, String(v)])))
    setSDraft(Object.fromEntries(Object.entries(guide.siegeByDay).map(([k, v]) => [k, String(v)])))
    setMemoDraft(guide.memo ?? '')
    setNewTier('')
    setEditing(true)
  }

  const save = () => {
    const toNums = (o: Record<string, string>): Record<string, number> => {
      const out: Record<string, number> = {}
      for (const [k, v] of Object.entries(o)) {
        const n = Number(String(v).replace(/[^\d]/g, ''))
        if (v !== '' && Number.isFinite(n) && n >= 0) out[k] = n
      }
      return out
    }
    update((d) => {
      d.cutlineGuide = {
        destroyerByTier: toNums(dDraft),
        siegeByDay: toNums(sDraft),
        ...(memoDraft.trim() ? { memo: memoDraft.trim() } : {}),
      }
    })
    setEditing(false)
  }

  const addTier = () => {
    const n = Number(newTier)
    if (!Number.isFinite(n) || n <= 0 || n > 30) return
    const key = `파이 ${n}초`
    setDDraft((prev) => (key in prev ? prev : { ...prev, [key]: '' }))
    setNewTier('')
  }

  // 편집 중에는 초안의 키까지 행으로 보여 준다 (새로 추가한 단계 포함)
  const shownTiers = editing
    ? [...new Set([...tierRows, ...Object.keys(dDraft)])].sort((a, b) => tierOrder(a) - tierOrder(b) || a.localeCompare(b))
    : tierRows

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="sec-label">길드 기록</div>
          <h1>커트라인 기준</h1>
          <p className="muted">
            공성전은 요일마다, 파괴신은 파이 초월 단계마다 넘어야 하는 점수예요. 이 값 <b>이하</b>면 미달.
          </p>
        </div>
        {admin && !editing && (
          <button className="primary" onClick={startEdit}>✏️ 수정</button>
        )}
        {admin && editing && (
          <span className="row" style={{ gap: 8 }}>
            <button onClick={() => setEditing(false)}>취소</button>
            <button className="primary" onClick={save}>저장</button>
          </span>
        )}
      </div>

      <div className="cutline-grid">
        <section className="panel">
          <div className="panel-head">
            <div className="sec-label">공성전 · 요일별</div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>요일</th>
                  <th style={{ textAlign: 'right' }}>커트라인</th>
                </tr>
              </thead>
              <tbody>
                {WEEKDAYS.map((d) => (
                  <tr key={d}>
                    <td>{d}요일</td>
                    <td style={{ textAlign: 'right' }}>
                      {editing ? (
                        <input
                          type="number"
                          className="num-tab"
                          value={sDraft[d] ?? ''}
                          placeholder="미설정"
                          onChange={(e) => setSDraft((p) => ({ ...p, [d]: e.target.value }))}
                          style={{ width: 130, textAlign: 'right' }}
                        />
                      ) : guide.siegeByDay[d] !== undefined ? (
                        <b className="num-tab">{fmt(guide.siegeByDay[d])}</b>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div className="sec-label">파괴신 · 파이 초월별</div>
          </div>
          {shownTiers.length === 0 ? (
            <p className="muted">아직 적힌 기준이 없어요.{admin ? ' [수정]을 눌러 단계를 추가해 보세요.' : ''}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>초월 단계</th>
                    <th>해당 길드원</th>
                    <th style={{ textAlign: 'right' }}>커트라인</th>
                    {editing && <th style={{ width: 40 }} />}
                  </tr>
                </thead>
                <tbody>
                  {shownTiers.map((t) => (
                    <tr key={t}>
                      <td>{t}</td>
                      <td className="muted">{memberTiers.get(t) ? `${memberTiers.get(t)}명` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {editing ? (
                          <input
                            type="number"
                            className="num-tab"
                            value={dDraft[t] ?? ''}
                            placeholder="미설정"
                            onChange={(e) => setDDraft((p) => ({ ...p, [t]: e.target.value }))}
                            style={{ width: 130, textAlign: 'right' }}
                          />
                        ) : guide.destroyerByTier[t] !== undefined ? (
                          <b className="num-tab">{fmt(guide.destroyerByTier[t])}</b>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      {editing && (
                        <td>
                          {!memberTiers.get(t) && (
                            <button
                              className="small ghost"
                              title="이 단계 삭제"
                              onClick={() =>
                                setDDraft((p) => {
                                  const next = { ...p }
                                  delete next[t]
                                  return next
                                })
                              }
                            >
                              ✕
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {editing && (
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <span className="muted" style={{ fontSize: '0.85rem' }}>단계 추가:</span>
              <span className="muted">파이</span>
              <input
                type="number"
                className="num-tab"
                value={newTier}
                min={1}
                max={30}
                placeholder="12"
                onChange={(e) => setNewTier(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTier()}
                style={{ width: 70, textAlign: 'right' }}
              />
              <span className="muted">초</span>
              <button className="small" onClick={addTier}>추가</button>
            </div>
          )}
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <div className="sec-label">메모</div>
        </div>
        {editing ? (
          <textarea
            value={memoDraft}
            onChange={(e) => setMemoDraft(e.target.value)}
            placeholder="예: 신입은 첫 주 커트라인 면제 / 미달 2회면 경고"
            rows={3}
            style={{ width: '100%', resize: 'vertical' }}
          />
        ) : guide.memo ? (
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{guide.memo}</p>
        ) : (
          <p className="muted" style={{ margin: 0 }}>적힌 메모가 없어요.</p>
        )}
      </section>

      {!admin && (
        <p className="foot-note">커트라인 기준은 운영진이 관리해요. 문의는 운영진에게!</p>
      )}
    </div>
  )
}
