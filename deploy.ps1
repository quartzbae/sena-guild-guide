# 빌드 후 dist를 gh-pages 브랜치로 강제 푸시해서 GitHub Pages에 배포
#
# ★ dist 안에 매번 새 git 저장소를 만드는 방식이라, 저장소 루트의 .gitignore 가
#   여기엔 하나도 안 걸린다. public/ 에 실수로 넣어 둔 백업 JSON(길드원 실명·점수)이나
#   소스맵이 있으면 git add -A 가 군말 없이 담아 공개 저장소로 밀어 올린다.
#   그래서 (1) 올리기 전에 확장자를 검사하고, (2) .git 정리 실패를 경고로 드러낸다.
$ErrorActionPreference = 'Stop'

# ★ 배포 전에 origin 을 따라잡았는지 본다.
#   이 스크립트는 워킹트리를 그대로 빌드해 gh-pages 로 force push 한다. 로컬이
#   behind 인 채로 돌리면 origin 에만 있는 커밋이 라이브에서 조용히 되돌아간다.
#   2026-09-17 에 실제로 났다 — fail-closed 로그인 게이트가 빠진 번들이 나가서,
#   토큰 없는 사람에게 커트라인·공성전·파괴신 메뉴가 그대로 보였다.
git fetch origin --quiet
$behind = (git rev-list --count HEAD..origin/master 2>$null)
if ($behind -and [int]$behind -gt 0) {
  throw "로컬이 origin/master 보다 $behind 커밋 뒤처져 있습니다. 먼저 따라잡으세요 (git pull --rebase). 이대로 배포하면 origin 에만 있는 변경이 라이브에서 사라집니다."
}

# ★ 반대 방향도 막는다 — 라이브는 반드시 origin/master 에 있는 것과 같아야 한다.
#   뒤처짐만 보면 '커밋은 했는데 push 를 안 한 것'과 '아예 커밋을 안 한 수정'이
#   그대로 라이브로 나간다. 2026-09-08~16 에 실제로 났다: CSP 가 라이브에만 있고
#   master 에는 없어서, 다른 곳에서 master 를 배포하자 CSP 가 조용히 빠질 뻔했다.
#   그 상태에서는 라이브가 무엇으로 만들어졌는지 저장소 어디에도 기록이 없다.
$ahead = (git rev-list --count origin/master..HEAD 2>$null)
if ($ahead -and [int]$ahead -gt 0) {
  throw "origin/master 에 없는 커밋이 $ahead 개 있습니다. 먼저 push 하세요 (git push). 라이브는 origin 과 같아야 합니다."
}
# 번들에 들어가는 경로만 본다. public/ 은 그대로 복사되므로 추적 안 하는 파일도
# 막는다(백업 JSON 을 여기 떨궈 둔 채 배포하면 공개 저장소로 나간다).
$buildInputs = 'src', 'public', 'index.html', 'vite.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json'
$dirty = git status --porcelain --untracked-files=all -- $buildInputs
if ($dirty) {
  $dirty | ForEach-Object { Write-Host "  $_" }
  throw '위 변경이 커밋되지 않았습니다. 커밋·push 한 뒤 배포하세요. 커밋 안 한 코드가 라이브에만 나가면 되돌릴 기준이 사라집니다.'
}

npm run build
if ($LASTEXITCODE -ne 0) { throw '빌드 실패 — 배포를 중단합니다. (옛 dist 가 그대로 올라가는 걸 막습니다)' }

$remote = git remote get-url origin

# 지난 배포의 찌꺼기가 남아 있으면 커밋이 계속 쌓인다 — 시작 전에도 한 번 턴다
Remove-Item -Recurse -Force dist\.git -ErrorAction SilentlyContinue
if (Test-Path dist\.git) { throw 'dist\.git 를 못 지웠습니다. 파일을 잡고 있는 프로그램을 닫고 다시 시도하세요.' }

# 올라가면 안 되는 것들 — 있으면 멈춘다
# ★ 이름 규칙이 이 프로젝트가 실제로 뱉는 파일과 어긋나 있었다.
#   사이트의 JSON 내보내기는 sena-guild-war-2026-09-17.json, 워커에서 내려받은
#   복구용 백업은 guild-data-daily_2026-09-06.json 이다 — 둘 다 backup-* 도 아니고
#   확장자는 .json 이라, 막으려던 바로 그 파일(길드원 실명·회차별 점수·
#   운영진 메모)이 검사를 그냥 통과했다. .env 도 Extension 비교라 .env.local 은
#   Extension 이 '.local' 이어서 안 걸렸다. 이름으로도 같이 본다.
$badExt = '.map', '.bak', '.env', '.log', '.key', '.pem', '.p12'
$badName = '^backup-', '^guild-data', '^sena-guild-war-.*\.json$', '^\.env', '\.key$', '\.pem$', '\.p12$'
$bad = Get-ChildItem -Path dist -Recurse -File | Where-Object {
  $f = $_
  ($badExt -contains $f.Extension) -or ($badName | Where-Object { $f.Name -match $_ })
}
if ($bad) {
  $bad | ForEach-Object { Write-Host "  $($_.FullName)" }
  throw '위 파일이 dist 에 있습니다. 공개 저장소로 올라가니 먼저 정리하세요.'
}

Push-Location dist
try {
  git init -b gh-pages | Out-Null
  git add -A
  git commit -m "deploy $(Get-Date -Format yyyy-MM-dd_HHmm)" | Out-Null
  git push -f $remote gh-pages
} finally {
  Pop-Location
  Remove-Item -Recurse -Force dist\.git -ErrorAction SilentlyContinue
  if (Test-Path dist\.git) {
    Write-Warning 'dist\.git 를 못 지웠습니다 — 직접 지우세요. 그냥 두면 다음 배포부터 커밋이 쌓여, 잠깐 올렸다 지운 파일도 히스토리에서 복원됩니다.'
  }
}
Write-Host "배포 완료 — 반영까지 1~2분 걸릴 수 있어요."
