param([ValidateSet('seal','unseal')][string]$Mode)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$raw=[Console]::In.ReadToEnd()
$entropy=[Text.Encoding]::UTF8.GetBytes('Lumen TV private settings v1')
if($Mode -eq 'seal') {
  $bytes=[Text.Encoding]::UTF8.GetBytes($raw)
  [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser))
} else {
  $bytes=[Convert]::FromBase64String($raw)
  [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser))
}
