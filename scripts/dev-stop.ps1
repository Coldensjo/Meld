# Stops what `make dev` started: whatever listens on this editor's dev ports (Wails 34125, Vite 5273)
# and the Meld-dev.exe built under this folder. Never touches the owner's own Meld (34115, 5173).
param()
$ErrorActionPreference = 'SilentlyContinue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ids = @()
foreach ($port in 34125, 5273) {
	$ids += Get-NetTCPConnection -State Listen -LocalPort $port | Select-Object -ExpandProperty OwningProcess
}
$ids += Get-Process -Name 'Meld-dev' | Where-Object { $_.Path -and $_.Path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) } | Select-Object -ExpandProperty Id
# Stop a wails.exe parent first, or it starts the app again when the app goes.
$ids = @($ids | ForEach-Object { $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$_").ParentProcessId; if ($parent -and (Get-Process -Id $parent).ProcessName -eq 'wails') { $parent }; $_ })
foreach ($id in ($ids | Where-Object { $_ -gt 0 } | Select-Object -Unique)) {
	Write-Host "dev-stop: stopping $((Get-Process -Id $id).ProcessName) ($id)"
	Stop-Process -Id $id -Force
}
exit 0
