$ErrorActionPreference = 'Stop'

$flightsDir = Join-Path $PSScriptRoot 'FLIGHTS'
$files = Get-ChildItem -LiteralPath $flightsDir -Filter '2026-W*.json' | Sort-Object Name
if (-not $files) { throw 'No weekly files found in FLIGHTS.' }

$weekFiles = foreach ($file in $files) {
    $match = [regex]::Match($file.Name, '^(\d{4})-W(\d{2})\.json$')
    if ($match.Success) {
        [pscustomobject]@{ File = $file; Year = [int]$match.Groups[1].Value; Week = [int]$match.Groups[2].Value }
    }
}
$latestSourceWeek = ($weekFiles.Week | Measure-Object -Maximum).Maximum
$year = $weekFiles[0].Year
$today = Get-Date
$calendar = [System.Globalization.CultureInfo]::InvariantCulture.Calendar
$currentIsoWeek = $calendar.GetWeekOfYear($today, [System.Globalization.CalendarWeekRule]::FirstFourDayWeek, [DayOfWeek]::Monday)
$currentIsoYear = $today.Year
$liveSource = $weekFiles | Where-Object Week -eq $currentIsoWeek | Select-Object -First 1
if ($currentIsoYear -eq $year -and $currentIsoWeek -gt $latestSourceWeek) {
    $liveWeek = $currentIsoWeek
    $archiveThroughWeek = $latestSourceWeek
    $archiveItems = @($weekFiles)
    $liveFile = $null
} else {
    $liveWeek = $latestSourceWeek
    $archiveThroughWeek = $liveWeek - 1
    $archiveItems = @($weekFiles | Where-Object Week -lt $liveWeek)
    $liveFile = ('{0}-W{1:00}.json' -f $year, $liveWeek)
}

function Get-RouteType([string]$dep, [string]$arr) {
    $depUa = $dep.StartsWith('UK')
    $arrUa = $arr.StartsWith('UK')
    if ($depUa -and $arrUa) { return 'UA-UA' }
    if ($depUa -xor $arrUa) { return 'UA-INT' }
    return 'INT-INT'
}

function Convert-Flight($flight, $pilot, [int]$week) {
    $totals = $flight.result.totals
    $duration = if ($null -ne $flight.durationAct) { [double]$flight.durationAct } else { 0 }
    $completed = $duration -gt 0 -and ($null -ne $flight.arrTimeAct -or $null -ne $flight.close)
    $violations = @($flight.result.violations | ForEach-Object {
        [ordered]@{
            title = $_.title
            points = if ($null -ne $_.penalty.points) { [double]$_.penalty.points } else { 0 }
            cash = if ($null -ne $_.penalty.cash) { [double]$_.penalty.cash } else { 0 }
        }
    })
    $weatherViolation = @($flight.result.violations | Where-Object {
        $null -ne $_.entry.payload.weather -and ($null -ne $_.entry.payload.touchDown -or [string]$_.title -match '(?i)touchdown|landing')
    }) | Select-Object -First 1
    if ($null -eq $weatherViolation) {
        $weatherViolation = @($flight.result.violations | Where-Object { $null -ne $_.entry.payload.weather }) | Select-Object -First 1
    }
    $weatherSource = $weatherViolation.entry.payload.weather
    $touchdownWeather = if ($null -ne $weatherSource -and $null -ne $weatherSource.windDir -and $null -ne $weatherSource.windSpd) {
        [ordered]@{
            windDir = [double]$weatherSource.windDir
            windSpd = [double]$weatherSource.windSpd
            crosswind = if ($null -ne $weatherSource.windX) { [Math]::Abs([double]$weatherSource.windX) } else { $null }
        }
    } else { $null }
    [ordered]@{
        id = [string]$flight._id
        sourceWeek = $week
        status = if ($completed) { 'completed' } else { 'failed' }
        pilot = [ordered]@{ id = [string]$pilot.pilot_id; name = [string]$pilot.fullname; avatar = $pilot.avatar }
        flightNumber = [string]$flight.flightNumber
        flightType = [string]$flight.type
        aircraft = [ordered]@{ id = $null; icao = [string]$flight.aircraft.icao; name = [string]$flight.aircraft.name; fleetName = [string]$flight.aircraft.name }
        departure = [ordered]@{ icao = [string]$flight.dep.icao; name = [string]$flight.dep.name; city = [string]$flight.dep.city }
        arrival = [ordered]@{ icao = [string]$flight.arr.icao; name = [string]$flight.arr.name; city = [string]$flight.arr.city }
        actualArrival = if ($null -ne $flight.actArr) { [ordered]@{ icao = [string]$flight.actArr.icao; name = [string]$flight.actArr.name; city = [string]$flight.actArr.city } } else { $null }
        routeType = Get-RouteType ([string]$flight.dep.icao) ([string]$flight.arr.icao)
        times = [ordered]@{
            scheduledDeparture = $flight.depTime
            scheduledArrival = $flight.arrTime
            actualDeparture = $flight.depTimeAct
            takeoff = $flight.takeoffTimeAct
            actualArrival = $flight.arrTimeAct
            closed = $flight.close
            durationMinutes = $duration
        }
        rating = if ($null -ne $flight.rating) { [double]$flight.rating } else { $null }
        finance = [ordered]@{
            revenue = if ($null -ne $totals.revenue) { [double]$totals.revenue } else { 0 }
            expenses = if ($null -ne $totals.expenses) { [double]$totals.expenses } else { 0 }
            penalties = if ($null -ne $totals.penalties) { [double]$totals.penalties } else { 0 }
            balance = if ($null -ne $totals.balance) { [double]$totals.balance } else { 0 }
            details = [ordered]@{
                tickets = if ($null -ne $flight.result.revenue.tickets) { [double]$flight.result.revenue.tickets } else { 0 }
                cargo = if ($null -ne $flight.result.revenue.cargo) { [double]$flight.result.revenue.cargo } else { 0 }
                fuel = if ($null -ne $flight.result.expenses.fuel) { [double]$flight.result.expenses.fuel } else { 0 }
                aircraft = if ($null -ne $flight.result.expenses.aircraft) { [double]$flight.result.expenses.aircraft } else { 0 }
                handling = if ($null -ne $flight.result.expenses.handling) { [double]$flight.result.expenses.handling } else { 0 }
                landing = if ($null -ne $flight.result.expenses.landing) { [double]$flight.result.expenses.landing } else { 0 }
            }
            pilotPay = $null
            payRuleVersion = $null
        }
        operations = [ordered]@{
            distance = if ($null -ne $totals.distance) { [double]$totals.distance } else { 0 }
            fuel = if ($null -ne $totals.fuel) { [double]$totals.fuel } else { 0 }
            passengers = if ($null -ne $flight.payload.pax) { [double]$flight.payload.pax } else { 0 }
            passengersByClass = if ($null -ne $totals.payload.paxByClass) { $totals.payload.paxByClass } else { $null }
            cargo = if ($null -ne $flight.payload.cargo) { [double]$flight.payload.cargo } else { 0 }
            cargoWeightKg = if ($null -ne $flight.payload.weights.cargo) { [double]$flight.payload.weights.cargo } else { 0 }
            ticketPrice = if ($null -ne $totals.prices.ticketPrice) { [double]$totals.prices.ticketPrice } else { 0 }
            cargoUnitPrice = if ($null -ne $totals.prices.cargoUnitPrice) { [double]$totals.prices.cargoUnitPrice } else { 0 }
            simulator = [string]$flight.simulator
            network = [string]$flight.network.name
            emergency = [bool]$flight.emergency
            free = [bool]$flight.free
            scheduled = [bool]$flight.schedule
            charter = [bool]$flight.charter
            touchdownWeather = $touchdownWeather
            violations = $violations
        }
    }
}

$archiveFlights = @()
foreach ($item in $archiveItems) {
    $pilots = [IO.File]::ReadAllText($item.File.FullName, [Text.Encoding]::UTF8) | ConvertFrom-Json
    foreach ($pilot in $pilots) {
        foreach ($flight in $pilot.flights) {
            $archiveFlights += [pscustomobject](Convert-Flight $flight $pilot $item.Week)
        }
    }
}
$archiveFlights = @($archiveFlights | Sort-Object id -Unique)
$generatedAt = [DateTime]::UtcNow.ToString('o')
$archive = [ordered]@{
    schemaVersion = 1
    generatedAt = $generatedAt
    throughWeek = $archiveThroughWeek
    flights = $archiveFlights
}
$manifest = [ordered]@{
    schemaVersion = 1
    generatedAt = $generatedAt
    year = $year
    archiveFile = 'archive.json'
    archiveThroughWeek = $archiveThroughWeek
    archiveFlights = $archiveFlights.Count
    liveWeek = $liveWeek
    liveFile = $liveFile
}

$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $flightsDir 'archive.json'), ($archive | ConvertTo-Json -Depth 12 -Compress), $utf8)
[IO.File]::WriteAllText((Join-Path $flightsDir 'manifest.json'), ($manifest | ConvertTo-Json -Depth 5 -Compress), $utf8)

Write-Output ('Archive flights: {0}; through W{1:00}; live week: W{2:00}; live file: {3}' -f $archiveFlights.Count, $archiveThroughWeek, $liveWeek, $(if ($liveFile) { $liveFile } else { 'not formed yet' }))
