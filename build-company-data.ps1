param(
  [string]$FleetSource = (Join-Path $PSScriptRoot 'COMPANY\fleet-source.txt'),
  [string]$SchedulesSource = (Join-Path $PSScriptRoot 'COMPANY\schedules-source.csv'),
  [string]$OutputDirectory = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$companyDirectory = Join-Path $OutputDirectory 'COMPANY'
New-Item -ItemType Directory -Force -Path $companyDirectory | Out-Null

function Convert-Money([string]$text) {
  $clean = ($text -replace '\$', '').Trim()
  if ($clean -notmatch '^(-?[0-9.]+)\s*([kKmM]?)') { return 0 }
  $value = [double]$Matches[1]
  if ($Matches[2] -match '[kK]') { $value *= 1000 }
  if ($Matches[2] -match '[mM]') { $value *= 1000000 }
  return [math]::Round($value)
}

$lines = @(Get-Content -Encoding UTF8 $FleetSource | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$dateIndexes = @()
for ($index = 0; $index -lt $lines.Count; $index++) {
  if ($lines[$index] -match '^\d{2} [A-Z][a-z]{2} \d{4}$') { $dateIndexes += $index }
}

$fleet = @()
for ($recordIndex = 0; $recordIndex -lt $dateIndexes.Count; $recordIndex++) {
  $dateIndex = $dateIndexes[$recordIndex]
  $end = if ($recordIndex + 1 -lt $dateIndexes.Count) { $dateIndexes[$recordIndex + 1] - 3 } else { $lines.Count }
  $segment = @($lines[($dateIndex + 2)..($end - 1)])
  $flightIndex = -1
  for ($segmentIndex = 0; $segmentIndex -lt $segment.Count; $segmentIndex++) {
    if ($segment[$segmentIndex] -match '^\d+ \(\d+\)$') { $flightIndex = $segmentIndex; break }
  }
  if ($flightIndex -lt 0) { continue }
  $flightMatch = [regex]::Match($segment[$flightIndex], '^(\d+) \((\d+)\)$')
  $hours = if ($segment[$flightIndex + 1] -match '^(\d+)') { [int]$Matches[1] } else { 0 }
  $fleet += [pscustomobject][ordered]@{
    name = $lines[$dateIndex - 3]
    icao = $lines[$dateIndex - 2]
    variant = $lines[$dateIndex - 1]
    leased = ([datetime]::ParseExact($lines[$dateIndex], 'dd MMM yyyy', [Globalization.CultureInfo]::InvariantCulture)).ToString('yyyy-MM-dd')
    airframeId = $lines[$dateIndex + 1]
    configuration = @($segment[0..($flightIndex - 1)])
    flights = [int]$flightMatch.Groups[1].Value
    secondaryFlights = [int]$flightMatch.Groups[2].Value
    hours = $hours
    location = $segment[$flightIndex + 2]
    revenue = Convert-Money $segment[$flightIndex + 3]
    expenses = Convert-Money $segment[$flightIndex + 4]
    balance = Convert-Money $segment[$flightIndex + 5]
  }
}

$fleetTypes = @($fleet | Group-Object icao | ForEach-Object {
  $variants = @($_.Group.variant | Sort-Object -Unique)
  [pscustomobject][ordered]@{
    icao = $_.Name
    variants = $variants
    aircraft = $_.Count
    flights = [int](($_.Group | Measure-Object flights -Sum).Sum)
    hours = [int](($_.Group | Measure-Object hours -Sum).Sum)
    revenue = [int64](($_.Group | Measure-Object revenue -Sum).Sum)
    expenses = [int64](($_.Group | Measure-Object expenses -Sum).Sum)
    balance = [int64](($_.Group | Measure-Object balance -Sum).Sum)
  }
} | Sort-Object @{Expression='aircraft';Descending=$true}, icao)

$scheduleLines = Get-Content -Encoding UTF8 $SchedulesSource
$header = 'number,dep,arr,type,duration,mon,tue,wed,thu,fri,sat,sun,airframes,active'
$headerIndex = [array]::IndexOf($scheduleLines, $header)
if ($headerIndex -lt 0) { throw 'Schedule CSV header not found.' }
$scheduleRows = @($scheduleLines[$headerIndex..($scheduleLines.Count - 1)] | ConvertFrom-Csv)
$days = @('mon','tue','wed','thu','fri','sat','sun')
$schedules = @($scheduleRows | ForEach-Object {
  $row = $_
  $availableDays = @($days | Where-Object { $row.$_ -eq 'true' })
  [pscustomobject][ordered]@{
    number = $row.number
    dep = $row.dep
    arr = $row.arr
    type = $row.type
    duration = [int]$row.duration
    days = $availableDays
    mon = $row.mon -eq 'true'; tue = $row.tue -eq 'true'; wed = $row.wed -eq 'true'; thu = $row.thu -eq 'true'
    fri = $row.fri -eq 'true'; sat = $row.sat -eq 'true'; sun = $row.sun -eq 'true'
    airframes = $row.airframes
    active = $row.active -eq 'true'
  }
})
$activeSchedules = @($schedules | Where-Object active)
$activeDaysPerWeek = 0
foreach ($schedule in $activeSchedules) { $activeDaysPerWeek += $schedule.days.Count }
$scheduleGroups = @($schedules | Group-Object airframes | ForEach-Object {
  $active = @($_.Group | Where-Object active)
  $weeklyDays = 0
  foreach ($schedule in $active) { $weeklyDays += $schedule.days.Count }
  [pscustomobject][ordered]@{
    airframes = if ($_.Name) { $_.Name } else { 'ALL' }
    routes = $_.Count
    active = $active.Count
    daysPerWeek = $weeklyDays
    pax = @($_.Group | Where-Object type -eq 'pax').Count
    cargo = @($_.Group | Where-Object type -eq 'cargo').Count
  }
} | Sort-Object @{Expression='active';Descending=$true}, airframes)

$airportCounts = @{}
foreach ($schedule in $activeSchedules) {
  foreach ($icao in @($schedule.dep, $schedule.arr)) { $airportCounts[$icao] = 1 + [int]$airportCounts[$icao] }
}
$topAirports = @($airportCounts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 15 | ForEach-Object { [ordered]@{icao=$_.Key; routes=$_.Value} })

$companyData = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  sources = [ordered]@{fleet='fleet-source.txt';schedules='schedules-source.csv'}
  economy = [ordered]@{
    baseline = [ordered]@{from='2026-05-01';to='2026-06-20';label='UCAA control period from restructuring'}
    revenue = 20620897
    penalties = 727219
    schedulers = 3800000
    airports = 1600000
    handling = 985700
    fleet = 5300000
    fuel = 3759661
    approximate = @('schedulers','airports','fleet')
    fixedCosts = [ordered]@{days=29;fleet=1376416;airports=1123384;handling=476416;schedulers=3800000;total=6776216;dailyAverage=233662.62}
    calibrationDays = @(
      [ordered]@{date='2026-06-20';fleetFixed=45446;airportFixed=82770;handlingExtra=31935;schedulers=137900},
      [ordered]@{date='2026-06-15';fleetFixed=45207;airportFixed=97042;handlingExtra=13211;schedulers=127600},
      [ordered]@{date='2026-05-25';fleetFixed=50121;airportFixed=96728;handlingExtra=10309;schedulers=124500}
    )
  }
  fleet = [ordered]@{aircraft=$fleet;types=$fleetTypes;count=$fleet.Count;typeCount=$fleetTypes.Count}
  schedules = [ordered]@{routes=$schedules;groups=$scheduleGroups;count=$schedules.Count;active=$activeSchedules.Count;inactive=$schedules.Count-$activeSchedules.Count;activeDaysPerWeek=$activeDaysPerWeek;topAirports=$topAirports}
}

$fleetDestination = Join-Path $companyDirectory 'fleet-source.txt'
$schedulesDestination = Join-Path $companyDirectory 'schedules-source.csv'
if ([IO.Path]::GetFullPath($FleetSource) -ne [IO.Path]::GetFullPath($fleetDestination)) {
  Copy-Item -LiteralPath $FleetSource -Destination $fleetDestination -Force
}
if ([IO.Path]::GetFullPath($SchedulesSource) -ne [IO.Path]::GetFullPath($schedulesDestination)) {
  Copy-Item -LiteralPath $SchedulesSource -Destination $schedulesDestination -Force
}
$companyData | ConvertTo-Json -Depth 10 -Compress | Set-Content -Encoding UTF8 (Join-Path $companyDirectory 'company-data.json')
Write-Host "Company data: $($fleet.Count) aircraft, $($fleetTypes.Count) types, $($schedules.Count) schedules ($($activeSchedules.Count) active)."
