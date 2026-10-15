# 프로그램(exe 경로 또는 shell:AppsFolder\앱ID)의 고해상도 아이콘을 PNG로 저장합니다.
# 사용: powershell -File extract-icon.ps1 -Source "<경로 또는 shell:AppsFolder\ID>" -Out "<저장할 png>" [-Size 256]
param(
    [Parameter(Mandatory)] [string]$Source,
    [Parameter(Mandatory)] [string]$Out,
    [int]$Size = 256
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class IconGrab {
    [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx, cy; }

    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm); }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);

    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);

    public static void Save(string source, string outPath, int size) {
        Guid iid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
        IShellItemImageFactory f;
        SHCreateItemFromParsingName(source, IntPtr.Zero, ref iid, out f);
        SIZE sz; sz.cx = size; sz.cy = size;
        IntPtr hbm;
        int hr = f.GetImage(sz, 0x1 | 0x4, out hbm);   // BIGGERSIZEOK | ICONONLY
        if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        try {
            using (Bitmap raw = Image.FromHbitmap(hbm)) {
                // FromHbitmap 은 알파(투명도)를 버리므로 픽셀을 직접 ARGB 로 다시 읽음
                Rectangle r = new Rectangle(0, 0, raw.Width, raw.Height);
                BitmapData d = raw.LockBits(r, ImageLockMode.ReadOnly, raw.PixelFormat);
                try {
                    using (Bitmap argb = new Bitmap(d.Width, d.Height, d.Stride, PixelFormat.Format32bppArgb, d.Scan0))
                    using (Bitmap copy = new Bitmap(argb)) {
                        copy.Save(outPath, ImageFormat.Png);
                    }
                } finally { raw.UnlockBits(d); }
            }
        } finally { DeleteObject(hbm); }
    }
}
'@
[IconGrab]::Save($Source, $Out, $Size)
Write-Output "saved $Out"
