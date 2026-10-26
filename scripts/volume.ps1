# Persistent, line-delimited Core Audio worker. Only local parent-process stdin controls it.
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LumenVolume {
  [ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class Enumerator {}
  [ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IDevices {
    [PreserveSig] int EnumAudioEndpoints(int flow,int mask,out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow,int role,out IDevice device);
  }
  [ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IDevice {
    [PreserveSig] int Activate(ref Guid iid,int context,IntPtr parameters,[MarshalAs(UnmanagedType.IUnknown)] out object result);
    [PreserveSig] int OpenPropertyStore(int access,out IProperties properties);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  }
  [ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IProperties {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index,out PropertyKey key);
    [PreserveSig] int GetValue(ref PropertyKey key,out Variant value);
  }
  [StructLayout(LayoutKind.Sequential)] struct PropertyKey { public Guid format;public uint id; }
  [StructLayout(LayoutKind.Explicit,Size=24)] struct Variant { [FieldOffset(0)]public ushort type;[FieldOffset(8)]public IntPtr pointer; }
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref Variant value);
  [ComImport,Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IVolume {
    [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
    [PreserveSig] int GetChannelCount(out uint count);
    [PreserveSig] int SetMasterVolumeLevel(float level,ref Guid context);
    [PreserveSig] int SetMasterVolumeLevelScalar(float level,ref Guid context);
    [PreserveSig] int GetMasterVolumeLevel(out float level);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    [PreserveSig] int SetChannelVolumeLevel(uint channel,float level,ref Guid context);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint channel,float level,ref Guid context);
    [PreserveSig] int GetChannelVolumeLevel(uint channel,out float level);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint channel,out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)]bool mute,ref Guid context);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)]out bool mute);
  }
  public class Snapshot { public string deviceId;public string name;public int percent;public bool muted; }
  static void Release(object value) { if(value!=null && Marshal.IsComObject(value))Marshal.ReleaseComObject(value); }
  public static Snapshot Read(string command) {
    IDevices devices=null;IDevice device=null;object instance=null;IProperties properties=null;
    try {
      devices=(IDevices)new Enumerator();
      Marshal.ThrowExceptionForHR(devices.GetDefaultAudioEndpoint(0,0,out device));
      string id;Marshal.ThrowExceptionForHR(device.GetId(out id));
      var iid=new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
      Marshal.ThrowExceptionForHR(device.Activate(ref iid,23,IntPtr.Zero,out instance));
      var volume=(IVolume)instance;float level;bool mute;
      Marshal.ThrowExceptionForHR(volume.GetMasterVolumeLevelScalar(out level));
      Marshal.ThrowExceptionForHR(volume.GetMute(out mute));
      var context=Guid.Empty;
      if(command=="up"||command=="down") {
        float next=Math.Max(0,Math.Min(1,level+(command=="up"?.02f:-.02f)));
        Marshal.ThrowExceptionForHR(volume.SetMasterVolumeLevelScalar(next,ref context));
        if(mute && next>0)Marshal.ThrowExceptionForHR(volume.SetMute(false,ref context));
      } else if(command=="mute")Marshal.ThrowExceptionForHR(volume.SetMute(!mute,ref context));
      Marshal.ThrowExceptionForHR(volume.GetMasterVolumeLevelScalar(out level));
      Marshal.ThrowExceptionForHR(volume.GetMute(out mute));
      string name="Windows audio";
      if(device.OpenPropertyStore(0,out properties)>=0) {
        var key=new PropertyKey{format=new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"),id=14};Variant value;
        if(properties.GetValue(ref key,out value)>=0){try{if(value.type==31)name=Marshal.PtrToStringUni(value.pointer)??name;}finally{PropVariantClear(ref value);}}
      }
      return new Snapshot{deviceId=id,name=name,percent=(int)Math.Round(level*100,MidpointRounding.AwayFromZero),muted=mute};
    } finally {Release(properties);Release(instance);Release(device);Release(devices);}
  }
}
'@
[Console]::Out.WriteLine('{"ready":true}')
while($null -ne ($line=[Console]::ReadLine())) {
  $request=$null
  try {
    $request=$line | ConvertFrom-Json
    if($request.cmd -notin @('read','up','down','mute')){throw 'Invalid volume command'}
    $state=[LumenVolume]::Read([string]$request.cmd)
    [Console]::Out.WriteLine((@{id=$request.id;state=$state} | ConvertTo-Json -Depth 3 -Compress))
  } catch {
    [Console]::Out.WriteLine((@{id=$request.id;error='Windows audio endpoint is unavailable.'} | ConvertTo-Json -Compress))
  }
}
