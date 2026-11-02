$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  Add-Type -AssemblyName System.Speech
  $recognizerInfo = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -eq 'en-US' } | Select-Object -First 1
  if (-not $recognizerInfo) { throw 'Windows offline English speech recognition is not installed.' }
  $engine = [System.Speech.Recognition.SpeechRecognitionEngine]::new($recognizerInfo)
  $engine.SetInputToDefaultAudioDevice()
  $engine.LoadGrammar([System.Speech.Recognition.DictationGrammar]::new())
  $engine.add_SpeechRecognized({
    param($sender, $eventArgs)
    if ($eventArgs.Result.Confidence -ge 0.58) {
      $json = @{ type = 'speech'; text = $eventArgs.Result.Text; confidence = [math]::Round($eventArgs.Result.Confidence, 3) } | ConvertTo-Json -Compress
      [Console]::Out.WriteLine($json)
      [Console]::Out.Flush()
    }
  })
  $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  @{ type = 'ready'; culture = $recognizerInfo.Culture.Name } | ConvertTo-Json -Compress | Write-Output
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line -or $line -eq 'quit') { break }
    Start-Sleep -Milliseconds 120
  }
  $engine.RecognizeAsyncCancel()
  $engine.Dispose()
} catch {
  @{ type = 'error'; message = $_.Exception.Message } | ConvertTo-Json -Compress | Write-Output
  exit 1
}
