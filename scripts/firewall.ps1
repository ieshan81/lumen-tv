# Windows Firewall helper for the Lumen TV phone remote.
#   firewall.ps1 check -Port 4321 -Program <path to electron.exe>   -> prints "ok" or "blocked"
#   firewall.ps1 fix   -Port 4321                                   -> (needs admin) lets phones on your Wi-Fi reach the remote
#
# The rule it adds is narrow: TCP on one port, only from devices on your own local network, and the
# remote still needs its secret link. It works on "Public" Wi-Fi networks too, where Windows blocks by default.
param(
  [Parameter(Mandatory = $true)][string]$Command,
  [int]$Port = 4321,
  [string]$Program = ''
)
$ErrorActionPreference = 'Stop'
$ruleName = 'Lumen TV phone remote'
$discoveryRuleName = 'Lumen TV phone discovery'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

switch ($Command) {
  'check' {
    $tcpOk = $false
    $rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue |
      Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' -and $_.Direction -eq 'Inbound' }
    if ($rule) { $tcpOk = $true }
    $discoveryOk = [bool](Get-NetFirewallRule -DisplayName $discoveryRuleName -ErrorAction SilentlyContinue |
      Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' -and $_.Direction -eq 'Inbound' })

    if ((-not $tcpOk -or -not $discoveryOk) -and $Program) {
      # A rule Windows made when someone clicked "Allow access" counts, if it covers the current network type.
      $categories = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object { $_.NetworkCategory.ToString() })
      $filters = Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object { $_.Program -eq $Program }
      foreach ($f in $filters) {
        $r = Get-NetFirewallRule -AssociatedNetFirewallApplicationFilter $f -ErrorAction SilentlyContinue
        if ($r.Enabled -eq 'True' -and $r.Action -eq 'Allow' -and $r.Direction -eq 'Inbound') {
          $profiles = $r.Profile.ToString()
          if ($profiles -match 'Any' -or ($categories | Where-Object { $profiles -match $_ })) {
            $ports = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $r -ErrorAction SilentlyContinue
            if ($ports.Protocol -eq 'TCP' -and ($ports.LocalPort -eq 'Any' -or $ports.LocalPort -eq $Port)) { $tcpOk = $true }
            if ($ports.Protocol -eq 'UDP' -and ($ports.LocalPort -eq 'Any' -or $ports.LocalPort -eq '5353')) { $discoveryOk = $true }
          }
        }
      }
    }
    if ($tcpOk -and $discoveryOk) { 'ok' } else { 'blocked' }
  }
  'fix' {
    if (-not (Test-Admin)) {
      Write-Host 'This needs administrator rights. Use the tray menu item "Fix phone connection" and approve the Windows prompt.'
      exit 2
    }
    Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Get-NetFirewallRule -DisplayName $discoveryRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port `
      -RemoteAddress LocalSubnet -Profile Any `
      -Description 'Lets phones on the same Wi-Fi open the Lumen TV remote page.' | Out-Null
    New-NetFirewallRule -DisplayName $discoveryRuleName -Direction Inbound -Action Allow -Protocol UDP -LocalPort 5353 `
      -RemoteAddress LocalSubnet -Profile Any `
      -Description 'Lets phones find lumen.local even when the laptop Wi-Fi address changes.' | Out-Null
    Write-Host ''
    Write-Host "Done. Phones on your Wi-Fi can now reach the Lumen remote and discover lumen.local." -ForegroundColor Green
    Write-Host 'To undo it later: remove the "Lumen TV phone remote" and "Lumen TV phone discovery" firewall rules.'
    Write-Host ''
    Read-Host 'Press Enter to close this window'
  }
  default { throw "Unknown command: $Command" }
}
