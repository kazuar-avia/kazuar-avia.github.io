(function () {
  const MONTHLY_PREMIUM = 100000;
  const MONTHLY_COVER_LIMIT = 1000000;
  const PENALTY_THRESHOLD = 150000;
  const PILOT_DAMAGE_DEDUCTION = 5000;
  const DAY_MS = 86400000;

  const flightDate = flight => new Date(
    flight.times?.closed || flight.times?.actualArrival ||
    flight.times?.takeoff || flight.times?.scheduledDeparture
  );

  function eligibleDamage(flight) {
    const penalties = Math.max(0, Number(flight.finance?.penalties) || 0);
    return penalties >= PENALTY_THRESHOLD ? penalties : 0;
  }

  const pilotLiability = flight => eligibleDamage(flight)
    ? Math.min(PILOT_DAMAGE_DEDUCTION, eligibleDamage(flight) * 0.02)
    : 0;
  const salaryBalance = flight => (Number(flight.finance?.balance) || 0) + eligibleDamage(flight);

  function coverageMap(flights) {
    const claimsByMonth = new Map();
    flights.forEach(flight => {
      const date = flightDate(flight);
      const eligible = eligibleDamage(flight);
      if (Number.isNaN(date.getTime()) || !eligible) return;
      const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!claimsByMonth.has(month)) claimsByMonth.set(month, []);
      claimsByMonth.get(month).push({flight, eligible});
    });
    const result = new Map();
    claimsByMonth.forEach(claims => {
      const total = claims.reduce((sum, claim) => sum + claim.eligible, 0);
      const factor = total ? Math.min(1, MONTHLY_COVER_LIMIT / total) : 0;
      claims.forEach(claim => result.set(claim.flight, claim.eligible * factor));
    });
    return result;
  }

  function summary(flights, start, end) {
    const coverageByFlight = coverageMap(flights);
    const claimsByMonth = new Map();
    let payout = 0;
    flights.forEach(flight => {
      const date = flightDate(flight);
      if (Number.isNaN(date.getTime()) || date < start || date >= end) return;
      const covered = coverageByFlight.get(flight) || 0;
      if (!covered) return;
      const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      claimsByMonth.set(month, (claimsByMonth.get(month) || 0) + covered);
      payout += covered;
    });
    let premium = 0;
    const startDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const atBoundary = end.getUTCHours() === 0 && end.getUTCMinutes() === 0 && end.getUTCSeconds() === 0;
    const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + (atBoundary ? 0 : 1)));
    for (let day = startDay; day < endDay; day = new Date(day.getTime() + DAY_MS)) {
      const daysInMonth = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
      premium += MONTHLY_PREMIUM / daysInMonth;
    }
    return {premium, payout, net:payout - premium, claimsByMonth, coverageByFlight};
  }

  window.UCAAInsurance = {
    MONTHLY_PREMIUM, MONTHLY_COVER_LIMIT, PENALTY_THRESHOLD, PILOT_DAMAGE_DEDUCTION,
    eligibleDamage, pilotLiability, salaryBalance, coverageMap, summary
  };
})();
