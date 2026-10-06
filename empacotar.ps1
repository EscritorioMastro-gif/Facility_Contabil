# Gera um .zip do projeto pronto pra rodar em outra máquina.
# Inclui os .env (config), exclui node_modules/.venv/.git/dist (pesados e
# específicos da máquina — a outra máquina recria com npm install / venv).
#
# Uso:  powershell -ExecutionPolicy Bypass -File empacotar.ps1

$src = $PSScriptRoot
$nome = "extrato-dominio"
$stage = Join-Path $env:TEMP $nome
$zip = Join-Path ([Environment]::GetFolderPath('Desktop')) "$nome.zip"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (Test-Path $zip)   { Remove-Item $zip -Force }

Write-Host "Copiando (sem node_modules/.venv/.git/dist)..."
robocopy $src $stage /E /NFL /NDL /NJH /NJS `
  /XD node_modules .venv .git dist build .pytest_cache __pycache__ .vscode .idea `
  /XF *.tsbuildinfo *.log | Out-Null

# Segredos de administrador NÃO viajam no .zip: a secret key do Supabase dá
# acesso total ao banco (passa por cima de toda regra de acesso) e a
# SUPABASE_DB_URL tem a senha do Postgres. Na outra máquina, quem precisar
# delas cola de novo no backend\.env (README, Setup).
$envBackend = Join-Path $stage 'backend\.env'
if (Test-Path $envBackend) {
  $linhas = [System.IO.File]::ReadAllLines($envBackend) | ForEach-Object {
    if ($_ -match '^\s*(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_URL|SUPABASE_JWT_SECRET)\s*=') { "$($Matches[1])=" } else { $_ }
  }
  [System.IO.File]::WriteAllLines($envBackend, [string[]]$linhas, (New-Object System.Text.UTF8Encoding $false))
  Write-Host "Segredos de administrador retirados do backend\.env da copia."
}

Write-Host "Compactando..."
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
Remove-Item $stage -Recurse -Force

$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "`nPronto: $zip  ($mb MB)"
Write-Host "Na outra máquina: descompacta, e roda 'configurar.bat' (ou veja o README)."
