# 세나 리버스 길드전 도우미

세븐나이츠 리버스 길드전 공략을 위한 길드 공유용 사이트.

## 기능

- **카운터덱 사전** — 상대 방어덱 영웅으로 검색하면 카운터 공격덱과 공략 포인트를 보여줌. 직접 추가/수정 가능.
- **결투장** — 결투장 덱과 스킬 순서 기록.
- **영웅 DB · 덱 빌더** — 등급/속성/포지션 필터, 5인 덱 저장.
- **공략 가이드** — 길드전 규칙과 팁. 길드 자체 공략 섹션 추가 가능.
- **공성전 · 파괴신 기록** — 결과 화면 캡처를 올리면 점수·순위를 읽어 자동으로 채움.
  캡처 여러 장을 이어 붙일 수 있고, 하단의 본인 행은 자동 제외.
- **커트라인** — 공성전 요일별 · 파괴신 파이 초월별 기준.
- **길드원 관리** (운영진) — 담당 배정 메모, 승패 기록.
- **데이터 관리** (운영진) — 입력 데이터 JSON 내보내기/가져오기.

## 개발

```bash
npm install
npm run dev     # 개발 서버
npm run build   # dist/ 에 정적 빌드
npm run preview
```

## 배포

`main` 브랜치에 푸시하면 GitHub Actions가 빌드하고 GitHub Pages에 자동 배포합니다.

- 사이트: <https://quartzbae.github.io/sena-guild-guide/>
- GitHub 저장소의 `Settings` → `Pages` → `Source`는 `GitHub Actions`로 설정

기존 수동 배포 스크립트는 필요할 때만 사용합니다.

사이트와 워커는 **따로** 배포합니다.

```bash
./deploy.ps1
```

빌드 후 `dist/` 를 `gh-pages` 브랜치로 force push 해서 GitHub Pages에 올립니다 (반영까지 1~2분).

`worker/` 안의 파일을 고쳤다면 워커도 따로 배포해야 해요 — [worker/README.md](worker/README.md) 참고.

```bash
cd worker && npx wrangler deploy
```

## 데이터 구조

초기 데이터는 저장소 안에 있습니다.

- `src/data/heroes.json` — 영웅 로스터
- `src/data/counters.json` — 방어덱→카운터덱
- `src/data/arena.json` — 결투장 덱
- `src/data/guide.ts` · `destroyerGuide.ts` · `heroRecs.ts` — 공략 문서

사이트에서 입력한 데이터는 **Cloudflare KV 공유 저장소**에 저장돼 길드원 전원이 같이 봅니다
(`src/data/config.ts` 의 `WORKER_URL` 이 비어 있으면 각자 브라우저 localStorage만 쓰는 로컬 모드).
[데이터 관리]에서 내보낸 JSON을 위 파일에 반영하면 배포본 기본 데이터로 승격됩니다.

> ⚠️ 로컬 개발 서버(`npm run dev`)와 브라우저 밖(Node 등)에서는 공유 저장소에 **쓰지 않습니다.**
> 개발 중 임시 데이터가 전 길드원 기록을 덮어쓰는 사고를 막기 위한 가드예요. 읽기는 됩니다.
