# Read-only monitor inventory. Native desktop bounds link Electron displays to Windows hardware IDs.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LumenMonitors {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct Device {
    public int cb;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string DeviceName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceString;
    public int StateFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceID;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceKey;
  }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern bool EnumDisplayDevices(string name, uint index, ref Device device, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  public static Device NewDevice() { var d=new Device();d.cb=Marshal.SizeOf(typeof(Device));return d; }
  public static bool Adapter(uint index, ref Device device) { return EnumDisplayDevices(null,index,ref device,0); }
}
'@
try { [void][LumenMonitors]::SetThreadDpiAwarenessContext([IntPtr](-4)) } catch { }
function Read-EdidText($value) { -join @($value | Where-Object {$_ -ne 0} | ForEach-Object {[char]$_}) }
$edid=@(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorID -ErrorAction SilentlyContinue)
$screens=@([System.Windows.Forms.Screen]::AllScreens)
$result=@()
for($i=0;$i -lt 32;$i++) {
  $adapter=[LumenMonitors]::NewDevice()
  if(-not [LumenMonitors]::Adapter($i,[ref]$adapter)){break}
  for($j=0;$j -lt 16;$j++) {
    $monitor=[LumenMonitors]::NewDevice()
    if(-not [LumenMonitors]::EnumDisplayDevices($adapter.DeviceName,$j,[ref]$monitor,1)){break}
    $pieces=$monitor.DeviceID -split '#'
    $hardware=if($pieces.Length -ge 3){'DISPLAY\'+$pieces[1]+'\'+$pieces[2]}else{$monitor.DeviceID}
    $info=$edid | Where-Object {($_.InstanceName -replace '_\d+$','') -eq $hardware} | Select-Object -First 1
    $name=if($info){Read-EdidText $info.UserFriendlyName}else{$monitor.DeviceString}
    if(-not $name){$name=$monitor.DeviceString}
    $screen=$screens | Where-Object {$_.DeviceName -eq $adapter.DeviceName} | Select-Object -First 1
    $active=[bool]($screen -and ($adapter.StateFlags -band 1) -and ($monitor.StateFlags -band 1))
    $bounds=if($active){@{x=$screen.Bounds.X;y=$screen.Bounds.Y;width=$screen.Bounds.Width;height=$screen.Bounds.Height}}else{$null}
    $result += [pscustomobject]@{name=$name;hardwareId=$hardware.ToUpperInvariant();active=$active;bounds=$bounds}
  }
}
# WMI can still expose a connected, inactive HDMI target that has no desktop rectangle.
foreach($info in $edid){
  $hardware=($info.InstanceName -replace '_\d+$','').ToUpperInvariant()
  if(-not ($result | Where-Object {$_.hardwareId -eq $hardware})){
    $result += [pscustomobject]@{name=(Read-EdidText $info.UserFriendlyName);hardwareId=$hardware;active=$false;bounds=$null}
  }
}
ConvertTo-Json -InputObject @($result) -Depth 4 -Compress
