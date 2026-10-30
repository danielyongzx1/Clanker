$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $PSScriptRoot
$nodeExecutable = (Get-Command node.exe).Source
$hermesEnvFile = Join-Path $env:HERMES_HOME '.env'
if (-not (Test-Path -LiteralPath $hermesEnvFile -PathType Leaf)) { throw 'Set HERMES_HOME to your Hermes profile directory first.' }
if (-not (Test-Path -LiteralPath (Join-Path $bridgeRoot '.env') -PathType Leaf)) { throw 'Save your Hermes bridge BRIDGE_TOKEN in tools/remote-bridge/.env first.' }
$settings = @{ configFile = 'bridge.config.json'; envFile = '.env'; hermesEnvFile = $hermesEnvFile }
[IO.File]::WriteAllText((Join-Path $bridgeRoot 'hermes-startup.json'), ($settings | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
function Quote-PowerShell([string]$value) { return "'" + $value.Replace("'", "''") + "'" }
$command = 'Start-Process -WindowStyle Hidden -FilePath ' + (Quote-PowerShell $nodeExecutable) + ' -WorkingDirectory ' + (Quote-PowerShell $bridgeRoot) + " -ArgumentList 'src/run-hermes.mjs'"
$startupDirectory = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDirectory 'Clanker Hermes Bridge.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -WindowStyle Hidden -Command "' + $command.Replace('"', '`"') + '"'
$shortcut.WorkingDirectory = $bridgeRoot
$shortcut.Description = 'Start the Clanker Hermes bridge with its saved token at Windows sign-in.'
$shortcut.Save()
Write-Output ('Installed Hermes bridge startup: ' + $shortcutPath)
Write-Output 'Hermes keeps its existing gateway/service startup. Its configured API key and port do not rotate.'
