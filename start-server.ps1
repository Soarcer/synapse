Set-Location $PSScriptRoot

$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
	Get-Content $envFile | ForEach-Object {
		$line = $_.Trim()
		if (-not $line -or $line.StartsWith('#')) { return }
		$parts = $line.Split('=', 2)
		if ($parts.Count -eq 2) {
			$name = $parts[0].Trim()
			$value = $parts[1].Trim()
			Set-Item -Path "Env:$name" -Value $value
		}
	}
}

npx tsx server/index.ts
