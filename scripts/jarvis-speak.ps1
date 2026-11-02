param([Parameter(Mandatory=$true)][string]$Text)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Speech
$voice = [System.Speech.Synthesis.SpeechSynthesizer]::new()
$voice.Rate = 1
$voice.Volume = 82
$voice.Speak($Text.Substring(0, [Math]::Min(280, $Text.Length)))
$voice.Dispose()
