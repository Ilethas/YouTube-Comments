param(
  [Parameter(Mandatory=$true)][int]$ApplicationPid,
  [Parameter(Mandatory=$true)][ValidateSet('file','confirm','cancel','acknowledge','inspect','close-window','readers-ready')][string]$Action,
  [string]$FilePath,
  [string]$WindowTitle,
  [int]$ExpectedReaders=1
)
# Test-side Windows UI Automation only. No shipped hooks or privileged IPC.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class PackagedDialogWindows {
  delegate bool Callback(IntPtr handle, IntPtr param);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr param);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr parent, int id);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr handle, uint message, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr handle);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr handle, System.Text.StringBuilder name, int max);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr handle, System.Text.StringBuilder name, int max);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr handle, uint message, IntPtr wparam, string text);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string text);
  public static IntPtr[] ForProcess(uint pid) {
    var found = new List<IntPtr>();
    EnumWindows((handle,param) => { uint owner; GetWindowThreadProcessId(handle,out owner); if(owner==pid) found.Add(handle); return true; }, IntPtr.Zero);
    return found.ToArray();
  }
}
'@
$deadline=(Get-Date).AddSeconds(25)
while ((Get-Date) -lt $deadline) {
  $readerCount=0
  $readersReady=$true
  foreach ($handle in [PackagedDialogWindows]::ForProcess($ApplicationPid)) {
    try {
    if ($Action -in @('readers-ready','close-window')) {
      $nativeClass=New-Object System.Text.StringBuilder 256
      [void][PackagedDialogWindows]::GetClassName($handle,$nativeClass,256)
      if ($nativeClass.ToString() -ne 'Chrome_WidgetWin_1') { continue }
      $readerCount++
      $visible=[PackagedDialogWindows]::IsWindowVisible($handle)
      $enabled=[PackagedDialogWindows]::IsWindowEnabled($handle)
      $readersReady=$readersReady -and $visible -and $enabled
      if ($Action -eq 'close-window') {
        $nativeTitle=New-Object System.Text.StringBuilder 512
        [void][PackagedDialogWindows]::GetWindowText($handle,$nativeTitle,512)
        if ($WindowTitle -and $nativeTitle.ToString() -eq $WindowTitle) {
          if (-not $visible -or -not $enabled) { continue }
          if (-not [PackagedDialogWindows]::PostMessage($handle,0x0112,[IntPtr]0xF060,[IntPtr]::Zero)) { throw 'Native Close dispatch rejected' }
          Write-Output 'Native SC_CLOSE dispatched to exact visible/enabled disposable window'
          exit 0
        }
      }
      continue
    }
    $window=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
    if ($Action -eq 'inspect') { Write-Output "Window: $($window.Current.ClassName) $($window.Current.Name)" }
    if ($window.Current.ClassName -ne '#32770') { continue }
    $controls=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
    if ($Action -eq 'inspect') { $controls | Where-Object { $_.Current.ClassName -in @('Edit','Button','CCPushButton') -or $_.Current.AutomationId -eq 'ContentText' } | ForEach-Object { Write-Output "$($_.Current.ClassName) id=$($_.Current.AutomationId) handle=$($_.Current.NativeWindowHandle) text=$($_.Current.Name)" }; continue }
    if ($Action -eq 'file') {
      $fileEdit=$null
      foreach ($control in $controls) {
        if ($control.Current.AutomationId -in @('1148','1001')) {
          if ($control.Current.ClassName -eq 'Edit') { $fileEdit=$control; break }
        }
      }
      if ($null -eq $fileEdit) { continue }
      [void][PackagedDialogWindows]::SendMessage([IntPtr]$fileEdit.Current.NativeWindowHandle,0x000C,[IntPtr]::Zero,$FilePath)
    }
    $buttonIds=if ($Action -eq 'cancel') { @('2','CommandButton_100') } elseif ($Action -eq 'confirm') { @('101','CommandButton_101') } else { @('1','CommandButton_1') }
    foreach ($control in $controls) {
      # Electron message boxes use buttons 100/101 in visual order: Cancel, Restore.
      if ($control.Current.AutomationId -in $buttonIds -and $control.Current.NativeWindowHandle -ne 0) {
        [void][PackagedDialogWindows]::PostMessage([IntPtr]$control.Current.NativeWindowHandle,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
        Write-Output "Native dialog $Action completed"
        exit 0
      }
    }
    } catch [System.Windows.Automation.ElementNotAvailableException] { continue }
  }
  if ($Action -eq 'readers-ready' -and $readerCount -eq $ExpectedReaders -and $readersReady) { Write-Output "Native readers visible/enabled: $readerCount"; exit 0 }
  if ($Action -eq 'inspect') { exit 0 }
  Start-Sleep -Milliseconds 100
}
throw "No matching native dialog for PID $ApplicationPid ($Action); readerCount=$readerCount readersReady=$readersReady"
