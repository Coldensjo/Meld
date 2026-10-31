# Drags the real mouse between two points of the built Meld window's page and saves a screenshot (#989).
# Points are in the page's CSS pixels from its top left (the client area), at 100% zoom.
#   powershell -File scripts\real-drag.ps1 -FromX 300 -FromY 200 -ToX 600 -ToY 400 [-Shot drag.png] [-Process Meld]
# Needs the window visible and not covered. Pair it with frontend/probes/desktop/cdp.mjs, which logs
# the page's drag events over the DevTools port (start Meld with MELD_DEBUG_PORT=9333).
param(
	[Parameter(Mandatory)][int]$FromX,
	[Parameter(Mandatory)][int]$FromY,
	[Parameter(Mandatory)][int]$ToX,
	[Parameter(Mandatory)][int]$ToY,
	[string]$Shot = '',
	[string]$Process = 'Meld',
	[int]$Steps = 20
)
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class U32 {
	[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
	[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
	[DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
	[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
	[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
	[DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, UIntPtr e);
}
'@
[void][U32]::SetProcessDPIAware()
# FindWindow by title failed in #930; the process's main window handle works.
$p = Get-Process $Process -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { throw "no $Process window" }
$h = $p.MainWindowHandle
[void][U32]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 300
$o = New-Object U32+POINT
[void][U32]::ClientToScreen($h, [ref]$o)
$LEFTDOWN = 0x2; $LEFTUP = 0x4
[void][U32]::SetCursorPos($o.X + $FromX, $o.Y + $FromY)
Start-Sleep -Milliseconds 100
[U32]::mouse_event($LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
for ($i = 1; $i -le $Steps; $i++) {
	$x = $o.X + $FromX + [int](($ToX - $FromX) * $i / $Steps)
	$y = $o.Y + $FromY + [int](($ToY - $FromY) * $i / $Steps)
	[void][U32]::SetCursorPos($x, $y)
	Start-Sleep -Milliseconds 20
}
Start-Sleep -Milliseconds 200
[U32]::mouse_event($LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 300
if ($Shot) {
	$b = New-Object System.Drawing.Bitmap ([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width) ([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height)
	$g = [System.Drawing.Graphics]::FromImage($b)
	$g.CopyFromScreen(0, 0, 0, 0, $b.Size)
	$b.Save($Shot)
}
