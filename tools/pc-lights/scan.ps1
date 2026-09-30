# Lists the parts of this PC that may have RGB lights, with no extra tools.
# Covers what pc-lights (HID only) can't see: RAM and GPU on SMBus / I2C.
#
#   powershell -ExecutionPolicy Bypass -File tools\pc-lights\scan.ps1

$ErrorActionPreference = 'SilentlyContinue'

function Section($name) { Write-Host "`n== $name ==" -ForegroundColor Cyan }

Section 'Motherboard'
$board = Get-CimInstance Win32_BaseBoard
Write-Host "  $($board.Manufacturer) $($board.Product)"
$vendorApp = switch -Regex ($board.Manufacturer) {
    'Micro-Star' { 'MSI Mystic Light (HID, try: pc-lights mystic dump)' }
    'ASUS' { 'ASUS Aura (HID / SMBus)' }
    'Gigabyte' { 'Gigabyte RGB Fusion 2 (HID, ITE 048D)' }
    'ASRock' { 'ASRock Polychrome (HID / SMBus)' }
    default { 'unknown' }
}
Write-Host "  RGB: $vendorApp"

Section 'GPU'
$gpuVendors = @{ '1458' = 'Gigabyte (RGB Fusion over I2C)'; '1043' = 'ASUS (Aura over I2C)';
    '1462' = 'MSI (Mystic Light over I2C)'; '3842' = 'EVGA (I2C)'; '19DA' = 'Zotac (I2C)';
    '1569' = 'Palit'; '10DE' = 'NVIDIA Founders Edition'; '1DA2' = 'Sapphire (I2C)' }
foreach ($gpu in Get-CimInstance Win32_VideoController) {
    $sub = if ($gpu.PNPDeviceID -match 'SUBSYS_[0-9A-F]{4}([0-9A-F]{4})') { $Matches[1] } else { '' }
    $brand = if ($gpuVendors.ContainsKey($sub)) { $gpuVendors[$sub] } else { "board vendor $sub" }
    Write-Host "  $($gpu.Name): $brand"
}
Write-Host '  GPU RGB goes over the card''s I2C bus (NVAPI / ADL), not HID. Not tested yet.'

Section 'RAM'
# Part number prefixes of RGB kits.
$rgbRam = [ordered]@{
    '^CMW' = 'Corsair Vengeance RGB Pro'; '^CMWB' = 'Corsair Vengeance RGB Pro light kit (dummy)';
    '^CMH' = 'Corsair Vengeance RGB'; '^CMG' = 'Corsair Vengeance RGB RS'; '^CMT' = 'Corsair Dominator Platinum RGB';
    '^CMN' = 'Corsair Vengeance RGB RT'; '^F[45]-.*TZR' = 'G.Skill Trident Z RGB'; '^F[45]-.*TR5' = 'G.Skill Trident Z5 RGB';
    '^KF.*A$' = 'Kingston Fury RGB'; '^TF' = 'TeamGroup T-Force RGB'
}
foreach ($m in Get-CimInstance Win32_PhysicalMemory) {
    $part = $m.PartNumber.Trim()
    $kind = 'no RGB known'
    foreach ($re in $rgbRam.Keys) { if ($part -match $re) { $kind = $rgbRam[$re] } }
    Write-Host ("  {0,-6} {1,-22} {2}" -f $m.DeviceLocator, $part, $kind)
}
Write-Host '  RAM RGB goes over SMBus, which needs a kernel driver (PawnIO / WinRing0). Not tested yet.'

Section 'USB RGB controllers'
$usbVendors = @{ '1462' = 'MSI'; '1B1C' = 'Corsair'; '0B05' = 'ASUS'; '048D' = 'ITE / Gigabyte';
    '26CE' = 'ASRock'; '1E71' = 'NZXT'; '0CF2' = 'Lian Li'; '1038' = 'SteelSeries'; '1532' = 'Razer' }
$found = $false
foreach ($d in Get-PnpDevice -PresentOnly) {
    if ($d.InstanceId -notmatch '^USB\\VID_([0-9A-F]{4})&PID_([0-9A-F]{4})\\') { continue }
    $vid = $Matches[1]; $pidHex = $Matches[2]
    if (-not $usbVendors.ContainsKey($vid)) { continue }
    $desc = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_BusReportedDeviceDesc').Data
    Write-Host ("  {0}:{1}  {2,-12} {3}" -f $vid, $pidHex, $usbVendors[$vid], $desc)
    $found = $true
}
if (-not $found) { Write-Host '  none' }

Section 'RGB software running'
$apps = 'iCUE', 'Corsair.Service', 'MSI.CentralServer', 'MSI Center', 'LightKeeperService', 'MysticLight',
    'SignalRgb', 'OpenRGB', 'ArmouryCrate.Service', 'LightingService', 'RGBFusion', 'GCC'
$running = Get-Process | Where-Object { $apps -contains $_.Name } | Select-Object -ExpandProperty Name -Unique
if ($running) { $running | ForEach-Object { Write-Host "  $_" } } else { Write-Host '  none' }

Section 'Dynamic Lighting'
Write-Host '  run: pc-lights scan'
