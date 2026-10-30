# Local parent-process worker. Targets one exact external desktop rectangle; never changes HDR settings.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class LumenPicture {
  [StructLayout(LayoutKind.Sequential)] struct Luid {public uint low;public int high;}
  [StructLayout(LayoutKind.Sequential)] struct Source {public Luid adapter;public uint id,mode,status;}
  [StructLayout(LayoutKind.Sequential)] struct Rational {public uint numerator,denominator;}
  [StructLayout(LayoutKind.Sequential)] struct Target {public Luid adapter;public uint id,mode,technology,rotation,scaling;public Rational refresh;public uint scan;public int available;public uint status;}
  [StructLayout(LayoutKind.Sequential)] struct Path {public Source source;public Target target;public uint flags;}
  [StructLayout(LayoutKind.Sequential)] struct Header {public uint type,size;public Luid adapter;public uint id;}
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct SourceName {public Header header;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)]public string name;}
  [StructLayout(LayoutKind.Sequential)] struct Advanced {public Header header;public uint value,encoding,bits;}
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Device {public int cb;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)]public string name;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)]public string description;public int flags;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)]public string id;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)]public string key;}
  [DllImport("user32.dll")] static extern int GetDisplayConfigBufferSizes(uint flags,out uint paths,out uint modes);
  [DllImport("user32.dll")] static extern int QueryDisplayConfig(uint flags,ref uint paths,[Out]Path[] data,ref uint modes,IntPtr modeData,IntPtr topology);
  [DllImport("user32.dll",EntryPoint="DisplayConfigGetDeviceInfo")] static extern int SourceInfo(ref SourceName value);
  [DllImport("user32.dll",EntryPoint="DisplayConfigGetDeviceInfo")] static extern int AdvancedInfo(ref Advanced value);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool EnumDisplayDevices(string name,uint index,ref Device device,uint flags);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
  [DllImport("gdi32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateDC(string driver,string device,IntPtr output,IntPtr init);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool GetDeviceGammaRamp(IntPtr dc,[Out]ushort[] ramp);
  [DllImport("gdi32.dll")] static extern bool SetDeviceGammaRamp(IntPtr dc,ushort[] ramp);
  public class Snapshot {public string device,hardwareId;public int x,y,width,height;public ushort[] ramp;}
  static Snapshot original=null;static ushort[] applied=null;static List<Snapshot> others=new List<Snapshot>();
  static string Hardware(string name){
    string result=null;
    for(uint i=0;i<16;i++){var d=new Device();d.cb=Marshal.SizeOf(typeof(Device));if(!EnumDisplayDevices(name,i,ref d,1))break;if((d.flags&1)==0)continue;if(result!=null)throw new Exception("Mirrored outputs cannot be tuned independently.");result=d.id;}
    if(String.IsNullOrEmpty(result))throw new Exception("Windows could not identify this display.");return result;
  }
  static bool Same(ushort[] a,ushort[] b){if(a==null||b==null||a.Length!=768||b.Length!=768)return false;for(int i=0;i<768;i++)if(Math.Abs((int)a[i]-b[i])>384)return false;return true;}
  static ushort[] Read(string name){var dc=CreateDC("DISPLAY",name,IntPtr.Zero,IntPtr.Zero);if(dc==IntPtr.Zero)throw new Exception("The projector display is unavailable.");try{var values=new ushort[768];if(!GetDeviceGammaRamp(dc,values))throw new Exception("This driver cannot read picture curves.");return values;}finally{DeleteDC(dc);}}
  static void Write(string name,ushort[] values){
    if(values==null||values.Length!=768)throw new Exception("Invalid picture curve.");
    for(int c=0;c<3;c++)for(int i=1;i<256;i++)if(values[c*256+i]<values[c*256+i-1])throw new Exception("Picture curves must be monotonic.");
    var dc=CreateDC("DISPLAY",name,IntPtr.Zero,IntPtr.Zero);if(dc==IntPtr.Zero)throw new Exception("The projector display is unavailable.");
    try{if(!SetDeviceGammaRamp(dc,values)||!Same(Read(name),values))throw new Exception("The display driver did not apply this correction. Your original picture is retained.");}finally{DeleteDC(dc);}
  }
  static void RequireSdr(string name){
    uint p,m;if(GetDisplayConfigBufferSizes(2,out p,out m)!=0)throw new Exception("Windows color mode could not be checked.");
    var paths=new Path[p];var modes=Marshal.AllocHGlobal(checked((int)m*64));
    try{
      if(QueryDisplayConfig(2,ref p,paths,ref m,modes,IntPtr.Zero)!=0)throw new Exception("Display topology changed. Try again.");
      bool found=false;
      for(int i=0;i<p;i++){
        var source=new SourceName{header=new Header{type=1,size=(uint)Marshal.SizeOf(typeof(SourceName)),adapter=paths[i].source.adapter,id=paths[i].source.id}};
        if(SourceInfo(ref source)!=0||source.name!=name)continue;
        var info=new Advanced{header=new Header{type=9,size=(uint)Marshal.SizeOf(typeof(Advanced)),adapter=paths[i].target.adapter,id=paths[i].target.id}};
        if(AdvancedInfo(ref info)!=0)throw new Exception("Windows color mode could not be verified. Manual projector adjustments are still available.");
        if((info.value&2)!=0)throw new Exception("Automatic picture preview requires SDR. HDR and Advanced Color are left unchanged.");found=true;
      }
      if(!found)throw new Exception("The projector is no longer connected.");
    }finally{Marshal.FreeHGlobal(modes);}
  }
  public static Snapshot Capture(int x,int y,int width,int height){
    if(original!=null)throw new Exception("A picture session is already active.");
    try{SetThreadDpiAwarenessContext(new IntPtr(-4));}catch{}
    System.Windows.Forms.Screen match=null;
    foreach(var screen in System.Windows.Forms.Screen.AllScreens){var b=screen.Bounds;if(b.X==x&&b.Y==y&&b.Width==width&&b.Height==height){if(match!=null)throw new Exception("The selected display is ambiguous.");match=screen;}}
    if(match==null)throw new Exception("The selected projector display is unavailable.");
    RequireSdr(match.DeviceName);
    var bounds=match.Bounds;var snapshot=new Snapshot{device=match.DeviceName,hardwareId=Hardware(match.DeviceName),x=bounds.X,y=bounds.Y,width=bounds.Width,height=bounds.Height,ramp=Read(match.DeviceName)};
    others.Clear();foreach(var screen in System.Windows.Forms.Screen.AllScreens)if(screen.DeviceName!=match.DeviceName)others.Add(new Snapshot{device=screen.DeviceName,hardwareId=Hardware(screen.DeviceName),ramp=Read(screen.DeviceName)});
    original=snapshot;applied=snapshot.ramp;return snapshot;
  }
  public static bool Apply(ushort[] values){
    if(original==null)throw new Exception("Start picture setup first.");
    if(Hardware(original.device)!=original.hardwareId)throw new Exception("The selected projector changed.");
    RequireSdr(original.device);
    if(!Same(Read(original.device),applied))throw new Exception("Another Windows color setting changed. Close picture setup and try again.");
    var previous=applied;var otherValues=new Dictionary<string,ushort[]>();
    foreach(var display in others)if(Hardware(display.device)==display.hardwareId)otherValues[display.device]=Read(display.device);
    try{
      Write(original.device,values);
      foreach(var display in others)if(otherValues.ContainsKey(display.device)&&Hardware(display.device)==display.hardwareId&&!Same(Read(display.device),otherValues[display.device])){Write(display.device,otherValues[display.device]);throw new Exception("This driver links multiple displays. Independent picture tuning is unavailable.");}
      applied=values;return true;
    }catch{try{Write(original.device,previous);applied=previous;}catch{}throw;}
  }
  public static bool Recover(string device,string hardware,ushort[] baseline,ushort[] expected,ushort[] previous){
    foreach(var screen in System.Windows.Forms.Screen.AllScreens)if(Hardware(screen.DeviceName)==hardware){
      RequireSdr(screen.DeviceName);var current=Read(screen.DeviceName);bool identical=baseline!=null&&baseline.Length==768;
      if(identical)for(int i=0;i<768;i++)if(baseline[i]!=current[i]){identical=false;break;}
      if(!identical&&(Same(current,expected)||Same(current,previous)))Write(screen.DeviceName,baseline);return true;
    }
    throw new Exception("Reconnect the projector to restore its earlier picture settings.");
  }
  public static bool Release(){if(original==null)return true;Recover(original.device,original.hardwareId,original.ramp,applied,null);original=null;applied=null;others.Clear();return true;}
}
'@ -ReferencedAssemblies System.Windows.Forms,System.Drawing
[Console]::Out.WriteLine('{"ready":true}')
try {
  while($null -ne ($line=[Console]::ReadLine())) {
    $request=$null
    try {
      $request=$line | ConvertFrom-Json
      $result=switch($request.cmd){
        'capture' {[LumenPicture]::Capture([int]$request.bounds.x,[int]$request.bounds.y,[int]$request.bounds.width,[int]$request.bounds.height)}
        'apply' {[LumenPicture]::Apply([System.UInt16[]]$request.ramp)}
        'recover' {[LumenPicture]::Recover([string]$request.snapshot.device,[string]$request.snapshot.hardwareId,[System.UInt16[]]$request.snapshot.ramp,[System.UInt16[]]$request.snapshot.applied,[System.UInt16[]]$request.snapshot.previousApplied)}
        'release' {[LumenPicture]::Release()}
        default {throw 'Invalid picture command.'}
      }
      [Console]::Out.WriteLine((@{id=$request.id;result=$result} | ConvertTo-Json -Depth 6 -Compress))
    }catch{$problem=$_.Exception;while($problem.InnerException){$problem=$problem.InnerException};[Console]::Out.WriteLine((@{id=$request.id;error=$problem.Message} | ConvertTo-Json -Compress))}
  }
}finally{try{[void][LumenPicture]::Release()}catch{}}
