# Sound output helper for Lumen TV.
#   audio.ps1 list           -> JSON: [{ id, name, isDefault }] for active playback devices
#   audio.ps1 set <id>       -> make that device the default output (all roles)
# Endpoint enumeration follows Windows Core Audio's active render-device collection:
# https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/nf-mmdeviceapi-immdeviceenumerator-enumaudioendpoints
param(
  [Parameter(Mandatory = $true)][string]$Command,
  [string]$DeviceId
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class LumenAudio {
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out ICollection devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }

  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ICollection {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int Item(uint index, out IMMDevice device);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    [PreserveSig] int OpenPropertyStore(int access, out IProperties properties);
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
  public class Output { public string id;public string name;public bool isDefault; }
  static void Release(object value) { if(value!=null && Marshal.IsComObject(value))Marshal.ReleaseComObject(value); }

  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumerator { }

  [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPolicyConfig {
    int GetMixFormat(string name, IntPtr format);
    int GetDeviceFormat(string name, bool isDefault, IntPtr format);
    int ResetDeviceFormat(string name);
    int SetDeviceFormat(string name, IntPtr endpointFormat, IntPtr mixFormat);
    int GetProcessingPeriod(string name, bool isDefault, IntPtr defaultPeriod, IntPtr minimumPeriod);
    int SetProcessingPeriod(string name, IntPtr period);
    int GetShareMode(string name, IntPtr mode);
    int SetShareMode(string name, IntPtr mode);
    int GetPropertyValue(string name, bool fxStore, IntPtr key, IntPtr value);
    int SetPropertyValue(string name, bool fxStore, IntPtr key, IntPtr value);
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string name, int role);
    int SetEndpointVisibility(string name, bool visible);
  }

  [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
  class PolicyConfigClient { }

  public static string GetDefaultId() {
    var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice device=null;
    try {
    // dataFlow 0 = render, role 0 = console
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 0, out device));
    string id;
    Marshal.ThrowExceptionForHR(device.GetId(out id));
    return id;
    } finally {Release(device);Release(enumerator);}
  }

  public static Output[] List() {
    var enumerator=(IMMDeviceEnumerator)new MMDeviceEnumerator();ICollection collection=null;
    var outputs=new System.Collections.Generic.List<Output>();
    try {
      string current=null;try{current=GetDefaultId();}catch{}
      Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(0,1,out collection));
      uint count;Marshal.ThrowExceptionForHR(collection.GetCount(out count));
      for(uint i=0;i<count;i++) {
        IMMDevice device=null;IProperties properties=null;
        try {
          Marshal.ThrowExceptionForHR(collection.Item(i,out device));
          string id;Marshal.ThrowExceptionForHR(device.GetId(out id));string name="Audio output";
          if(device.OpenPropertyStore(0,out properties)>=0){
            var key=new PropertyKey{format=new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"),id=14};Variant value;
            if(properties.GetValue(ref key,out value)>=0){try{if(value.type==31)name=Marshal.PtrToStringUni(value.pointer)??name;}finally{PropVariantClear(ref value);}}
          }
          outputs.Add(new Output{id=id,name=name,isDefault=id==current});
        } finally {Release(properties);Release(device);}
      }
      return outputs.ToArray();
    } finally {Release(collection);Release(enumerator);}
  }

  public static void SetDefault(string id) {
    var policy = (IPolicyConfig)new PolicyConfigClient();
    try {
    for (int role = 0; role < 3; role++) {
      Marshal.ThrowExceptionForHR(policy.SetDefaultEndpoint(id, role));
    }
    } finally {Release(policy);}
  }
}
'@

switch ($Command) {
  'list' {
    $devices = @([LumenAudio]::List())
    ConvertTo-Json -InputObject $devices -Compress
  }
  'set' {
    if (-not $DeviceId) { throw 'set needs a device id' }
    [LumenAudio]::SetDefault($DeviceId)
    'ok'
  }
  default { throw "Unknown command: $Command" }
}
