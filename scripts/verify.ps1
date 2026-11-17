$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

npm run typecheck
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm run lint
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$env:CHAOSTWIN_EXPECT_LOCAL_ANDROID = '1'
npm run test:integration
exit $LASTEXITCODE
