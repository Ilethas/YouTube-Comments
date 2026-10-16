param(
  [Parameter(Mandatory=$true)][int]$ApplicationPid,
  [Parameter(Mandatory=$true)][ValidateSet('file','confirm','cancel','acknowledge','inspect')][string]$Action,
  [string]$FilePath
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
  foreach ($handle in [PackagedDialogWindows]::ForProcess($ApplicationPid)) {
    try {
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
  if ($Action -eq 'inspect') { exit 0 }
  Start-Sleep -Milliseconds 100
}
throw "No matching native dialog for PID $ApplicationPid ($Action)"
