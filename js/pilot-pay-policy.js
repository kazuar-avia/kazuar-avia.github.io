(function () {
  const RULE = {
    version: 'draft-7-fdr',
    hourlyRate: 65,
    preparationHours: 1,
    managementShare: 0.01,
    managementBonusCap: 2500,
    delayLiabilityShare: 0.05,
    incidentLiabilityShare: 0.10,
    incidentLiabilityCap: 2500,
    crosswindBonusPerKt: 0.02,
    route: {'UA-UA':1.25, 'UA-INT':1.15, 'INT-INT':1}
  };
  const contextCache = new WeakMap();

  const flightDate = flight => new Date(
    flight.times?.closed || flight.times?.actualArrival || flight.times?.takeoff || flight.times?.scheduledDeparture
  );
  const streakFlightDate = flight => new Date(
    flight.times?.actualDeparture || flight.times?.takeoff || flight.times?.scheduledDeparture || flight.times?.open || flight.times?.closed || flight.times?.actualArrival
  );
  const streakCloseDate = flight => new Date(
    flight.times?.closed || flight.times?.actualArrival || flight.times?.scheduledArrival
  );

  function addUtcMonths(date, months) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
  }

  function loyaltyCoefficient(firstDate, currentDate, totalFlights) {
    const days = Math.floor((currentDate - firstDate) / 86400000);
    if (currentDate > addUtcMonths(firstDate, 6) && totalFlights > 60) return 1.50;
    if (currentDate >= addUtcMonths(firstDate, 6) && totalFlights >= 60) return 1.45;
    if (currentDate >= addUtcMonths(firstDate, 5) && totalFlights >= 50) return 1.40;
    if (currentDate >= addUtcMonths(firstDate, 4) && totalFlights >= 40) return 1.35;
    if (currentDate >= addUtcMonths(firstDate, 3) && totalFlights >= 30) return 1.30;
    if (currentDate >= addUtcMonths(firstDate, 2) && totalFlights >= 20) return 1.25;
    if (currentDate >= addUtcMonths(firstDate, 1) && totalFlights >= 15) return 1.20;
    if (days >= 14 && totalFlights >= 10) return 1.15;
    if (days >= 7 && totalFlights >= 5) return 1.10;
    if (days >= 1 && totalFlights >= 1) return 1.05;
    return 1;
  }

  function regularityCoefficient(last10, last20, last30) {
    if (last30 >= 30) return 1.50;
    if (last30 >= 20) return 1.40;
    if (last30 >= 15) return 1.30;
    if (last20 >= 10) return 1.20;
    if (last10 >= 5) return 1.10;
    if (last30 >= 1) return 1.05;
    return 1;
  }

  function utcDayKey(date) {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  function streakDaysForFlight(list, currentDate) {
    const currentDay = utcDayKey(currentDate);
    const startDays = new Set(
      list
        .map(flight => streakFlightDate(flight))
        .filter(date => Number.isFinite(date.getTime()) && date <= currentDate)
        .map(utcDayKey)
    );
    const closedDays = new Set(
      list
        .map(flight => streakCloseDate(flight))
        .filter(date => Number.isFinite(date.getTime()) && date <= currentDate)
        .map(utcDayKey)
    );
    const hadActivityOnDay = day => startDays.has(day) || closedDays.has(day);
    if (!startDays.has(currentDay)) return 0;
    if (!hadActivityOnDay(currentDay - 86400000)) {
      const hasEarlierSameDayFlight = list
        .some(flight => {
          const start = streakFlightDate(flight);
          const close = streakCloseDate(flight);
          return (Number.isFinite(start.getTime()) && start < currentDate && utcDayKey(start) === currentDay)
            || (Number.isFinite(close.getTime()) && close < currentDate && utcDayKey(close) === currentDay);
        });
      return hasEarlierSameDayFlight ? 1 : 0;
    }
    let streak = 1;
    for (let offset = 1; offset <= 8; offset += 1) {
      if (!hadActivityOnDay(currentDay - offset * 86400000)) break;
      streak += 1;
    }
    return streak;
  }

  function streakCoefficient(streakDays) {
    const days = Math.max(0, Number(streakDays) || 0);
    if (days >= 5) return 1.5;
    return 1 + days * 0.10;
  }

  function buildContextMap(flights) {
    if (contextCache.has(flights)) return contextCache.get(flights);
    const result = new Map();
    const byPilot = new Map();
    (flights || []).filter(flight => flight.status === 'completed').forEach(flight => {
      const id = String(flight.pilot?.id || '');
      if (!byPilot.has(id)) byPilot.set(id, []);
      byPilot.get(id).push(flight);
    });
    byPilot.forEach(list => {
      list.sort((a,b) => flightDate(a) - flightDate(b));
      const firstDate = flightDate(list[0]);
      list.forEach((flight, index) => {
        const currentDate = flightDate(flight);
        const elapsed = prior => currentDate - flightDate(prior);
        const throughCurrent = list.slice(0, index + 1);
        const last10 = throughCurrent.filter(prior => elapsed(prior) <= 10 * 86400000).length;
        const last20 = throughCurrent.filter(prior => elapsed(prior) <= 20 * 86400000).length;
        const last30 = throughCurrent.filter(prior => elapsed(prior) <= 30 * 86400000).length;
        const totalFlights = index + 1;
        const loyaltyK = loyaltyCoefficient(firstDate, currentDate, totalFlights);
        const baseRegularityK = regularityCoefficient(last10, last20, last30);
        const streakDate = streakFlightDate(flight);
        const streakDays = streakDaysForFlight(list, streakDate);
        const streakK = streakCoefficient(streakDays);
        const regularityK = baseRegularityK * streakK;
        result.set(flight, {
          firstDate, currentDate, membershipDays:Math.floor((currentDate-firstDate)/86400000), totalFlights,
          last10, last20, last30, loyaltyK, baseRegularityK, streakDays, streakK, regularityK
        });
      });
    });
    contextCache.set(flights, result);
    return result;
  }

  function aircraftCoefficient(icao = '', flightType = '') {
    const code = String(icao || '').trim().toUpperCase();
    const table = window.UCAAAircraftDifficulty?.coefficients || {};
    const isCargo = String(flightType || '').toLowerCase() === 'cargo';
    if (isCargo && table[`${code}F`] != null) return Number(table[`${code}F`]);
    if (table[code] != null) return Number(table[code]);
    return Number(window.UCAAAircraftDifficulty?.defaultCoefficient) || 1;
  }

  function landingFpm(flight) {
    for (const violation of flight.operations?.violations || []) {
      const match = String(violation?.title || '').match(/([0-9.]+)G\s*\(([0-9.]+)\s*ft\/min/i);
      if (match) return Math.abs(Number(match[2])) || 0;
    }
    return 0;
  }

  function masteryCoefficient(fpm) {
    const value = Math.abs(Number(fpm) || 0);
    if (value <= 50) return 1;
    if (value <= 99) return 1.05;
    if (value <= 150) return 1.10;
    if (value <= 199) return 1.15;
    if (value <= 300) return 1.30;
    if (value <= 349) return 1.20;
    if (value <= 399) return 1.10;
    if (value <= 449) return 1.05;
    if (value <= 500) return 1;
    if (value <= 599) return 0.90;
    if (value <= 749) return 0.75;
    return 0.50;
  }

  function ratingCoefficient(rating) {
    const value = Math.max(0, Number(rating) || 0);
    if (value >= 10) return 1.30;
    if (value >= 9) return 1.20;
    if (value >= 8) return 1.10;
    if (value >= 7.5) return 1.00;
    if (value >= 7) return 0.90;
    if (value >= 6.5) return 0.80;
    if (value >= 6) return 0.70;
    if (value >= 5.5) return 0.60;
    return value / 10;
  }

  function delayedPenalty(flight) {
    return (flight.operations?.violations || []).reduce((total, violation) => {
      if (!/^Flight delayed\b/i.test(String(violation?.title || ''))) return total;
      return total + Math.max(0, Number(violation?.cash ?? violation?.penalty?.cash) || 0);
    }, 0);
  }

  function seriousIncidentViolations(flight) {
    return (flight.operations?.violations || []).filter(violation => {
      const title = String(violation?.title || '');
      const cash = Math.max(0, Number(violation?.cash ?? violation?.penalty?.cash) || 0);
      return /runway excursion|\bMTOW exceeded|\bMLW exceeded|landing before runway threshold/i.test(title)
        || (cash > 0 && /touchdown/i.test(title));
    });
  }

  function seriousIncidentReasons(flight) {
    const classify = title => {
      const value = String(title || '');
      if (/runway excursion/i.test(value)) return 'Runway excursion';
      if (/\bMTOW exceeded/i.test(value)) return 'MTOW exceeded';
      if (/\bMLW exceeded/i.test(value)) return 'MLW exceeded';
      if (/landing before runway threshold/i.test(value)) return 'Landing before threshold';
      if (/touchdown/i.test(value)) return 'Hard touchdown';
      return 'Серйозний інцидент';
    };
    return [...new Set(seriousIncidentViolations(flight).map(violation => classify(violation.title)))];
  }

  function seriousIncidentPenalty(flight) {
    const incidentCash = seriousIncidentViolations(flight).reduce(
      (total, violation) => total + Math.max(0, Number(violation?.cash ?? violation?.penalty?.cash) || 0), 0
    );
    return Math.min(Math.max(0, Number(flight.finance?.penalties) || 0), incidentCash);
  }

  function isLandingRelated(title) {
    const value = String(title || '');
    if (/\b(?:MTOW|MLW) exceeded/i.test(value)) return false;
    return /landing|touchdown|tail strike on landing|wing\/engine strike on landing|off centerline landing|long landing|landing before runway threshold/i.test(value);
  }

  function seriousIncidentDetails(flight) {
    const violations = seriousIncidentViolations(flight);
    const totalCash = violations.reduce(
      (sum, violation) => sum + Math.max(0, Number(violation?.cash ?? violation?.penalty?.cash) || 0), 0
    );
    const penalty = seriousIncidentPenalty(flight);
    const scale = totalCash > 0 ? Math.min(1, penalty / totalCash) : 0;
    return violations.map(violation => {
      const title = String(violation?.title || '');
      const cash = Math.max(0, Number(violation?.cash ?? violation?.penalty?.cash) || 0) * scale;
      return {
        title,
        cash,
        liabilityRate:/\b(?:MTOW|MLW) exceeded/i.test(title) ? 0.05 : RULE.incidentLiabilityShare,
        landingRelated:isLandingRelated(title)
      };
    });
  }

  function fdrAnalysis(flight) {
    const existingFinancialPenalty = Math.max(
      0,
      Number(flight.finance?.penalties) || 0,
      (flight.operations?.violations || []).reduce(
        (sum, violation) => sum + Math.max(0, Number(violation?.cash ?? violation?.penalty?.cash) || 0),
        0
      )
    );
    if (flight.status !== 'completed' || Number(flight.rating) >= 8 || existingFinancialPenalty > 0) {
      return {total:0, rawTotal:0, cap:1500, capped:false, items:[], hardTouchdown:false, blocksBonuses:false, blocksLandingBonuses:false};
    }
    const violations = flight.operations?.violations || [];
    const pointsOf = violation => Math.abs(Number(violation?.points ?? violation?.penalty?.points) || 0);
    const cashOf = violation => Math.max(0, Number(violation?.cash ?? violation?.penalty?.cash) || 0);
    const touchdown = violations.map(violation => {
      const match = String(violation?.title || '').match(/touchdown:\s*([0-9.]+)G\s*\(([0-9.]+)\s*ft\/min/i);
      return match ? {violation, g:Number(match[1]) || 0, fpm:Number(match[2]) || 0} : null;
    }).find(Boolean);
    const companionRisk = violations.some(violation =>
      /stall warning|overspeed|unstable approach/i.test(String(violation?.title || ''))
    ) || Boolean(touchdown?.g >= 1.8);
    const items = [];
    const add = (key, label, amount, meta = {}) => {
      const value = Math.max(0, Math.round(Number(amount) || 0));
      if (value) items.push({key, label, amount:value, blockBonuses:meta.blockBonuses !== false, ...meta});
    };

    for (const violation of violations) {
      const title = String(violation?.title || '');
      const points = pointsOf(violation);
      let match;
      if ((match = title.match(/Stall warning for\s+([0-9.]+)\s+seconds/i))) {
        add('stall', `stall warning ${Math.round(Number(match[1]) || 0)} с`, Math.min(2500, points * 5));
      } else if ((match = title.match(/Overspeed for\s+([0-9.]+)\s+seconds/i))) {
        add('overspeed', `overspeed ${Math.round(Number(match[1]) || 0)} с`, Math.min(2500, points * 5));
      } else if ((match = title.match(/Insufficient fuel reserves.*actual:\s*([0-9.]+)\s*kg,\s*required:\s*([0-9.]+)\s*kg/i))) {
        const missing = Math.max(0, Number(match[2]) - Number(match[1]));
        add('fuelReserve', `недостатній резерв пального: бракувало ${Math.round(missing)} кг`, Math.max(500, missing));
      } else if (/Incorrect flaps for (?:takeoff|landing)/i.test(title) && companionRisk) {
        add('flaps', /takeoff/i.test(title) ? 'неправильні закрилки на зльоті' : 'неправильні закрилки на посадці', 750, {landingRelated:/landing/i.test(title)});
      } else if (/Unstable approach/i.test(title) && points >= 125) {
        add('unstableApproach', 'нестабільний захід', Math.min(1500, points * 5), {landingRelated:true});
      } else if ((match = title.match(/Late landing configuration \(at\s*([0-9.]+)ft/i)) && Number(match[1]) < 800) {
        const altitude = Number(match[1]) || 0;
        add('lateConfiguration', `посадкова конфігурація лише на ${Math.round(altitude)} ft`, 800 - altitude, {landingRelated:true});
      } else if ((match = title.match(/Off centerline landing \(deviation\s*([0-9.]+)m/i)) && Number(match[1]) >= 15) {
        const deviation = Number(match[1]);
        add('centerline', `відхилення від осі ${deviation.toFixed(2)} м`, deviation * 10, {landingRelated:true});
      } else if ((match = title.match(/Long landing \(([0-9.]+)m from threshold beyond ([0-9.]+)m max accepted/i))) {
        const actual = Number(match[1]) || 0;
        const maximum = Number(match[2]) || 0;
        add('longLanding', `long landing: ${Math.round(actual)} м при максимумі ${Math.round(maximum)} м`, actual - maximum, {landingRelated:true});
      } else if ((match = title.match(/Short landing \(([0-9.]+)m from threshold before ([0-9.]+)m min accepted/i))) {
        const actual = Number(match[1]) || 0;
        const minimum = Number(match[2]) || 0;
        add('shortLanding', `short landing: ${Math.round(actual)} м при мінімумі ${Math.round(minimum)} м`, minimum - actual, {landingRelated:true});
      } else if ((match = title.match(/Max G exceeded:\s*([0-9.]+)G/i))) {
        const value = Number(match[1]) || 0;
        const sameAsTouchdown = touchdown?.g >= 1.8 && value <= touchdown.g + 0.25;
        if (!sameAsTouchdown) {
          const amount = points * 10;
          add('maxG', `перевищення Max G: ${value.toFixed(2)}G`, amount);
        }
      } else if ((match = title.match(/Min G exceeded:\s*(-?[0-9.]+)G/i))) {
        const value = Number(match[1]) || 0;
        add('minG', `від’ємне перевантаження ${value.toFixed(2)}G`, points * 10);
      }
    }

    if (touchdown?.g >= 1.8 && cashOf(touchdown.violation) === 0) {
      const amount = Math.min(2500, Math.max(50,
        Math.round((50 + (touchdown.g - 1.8) * 3500) / 50) * 50
      ));
      add('hardTouchdown', `${touchdown.g >= 2.5 ? 'terrifying' : 'hard'} landing ${touchdown.g.toFixed(2)}G / ${Math.round(touchdown.fpm)} fpm`, amount, {
        g:touchdown.g, fpm:touchdown.fpm, incidentCost:touchdown.g >= 2.5 ? 25000 : amount, landingRelated:true
      });
    }

    const rawTotal = items.reduce((sum, item) => sum + item.amount, 0);
    const cap = touchdown?.g >= 1.8 ? 2500 : 1500;
    return {
      total:Math.min(rawTotal, cap),
      rawTotal,
      cap,
      capped:rawTotal > cap,
      items,
      hardTouchdown:items.some(item => item.key === 'hardTouchdown'),
      blocksBonuses:items.some(item => item.blockBonuses !== false),
      blocksLandingBonuses:items.some(item => item.landingRelated && item.blockBonuses !== false)
    };
  }

  function breakdown(flight, insurancePayout = 0, allFlights = null) {
    if (flight.status !== 'completed') return {
      total:0, preparationPay:0, flightBasePay:0, flightAdjustedPay:0, managementBonus:0,
      delayDeduction:0, insuranceLiability:0, incidentLiability:0, masteryK:1, crosswindK:1, crosswindKt:0,
      routeK:1, aircraftK:1, onlineK:1, flightHours:0, fpm:0, insurancePayout:0,
      insuranceCase:0, insuranceLandingRelated:false, seriousIncident:false, seriousIncidentPenalty:0, seriousIncidentReasons:[], seriousIncidentItems:[], incidentLandingRelated:false, managementBonusBlocked:false, landingBonusesBlocked:false, fdrPenalty:0, fdrRawTotal:0, fdrCap:1500, fdrCapped:false, fdrItems:[], fdrBlocksBonuses:false, fdrBlocksLandingBonuses:false, companyUncovered:0, loyaltyK:1, regularityK:1, effectiveHourlyRate:RULE.hourlyRate,
      salaryBeforeSkill:0, masteryAdjustment:0, crosswindAdjustment:0, salaryBeforeDeductions:0, totalDeductions:0, salaryBeforeBonus:0
    };
    const fallbackContext = {firstDate:flightDate(flight),currentDate:flightDate(flight),membershipDays:0,totalFlights:1,last10:1,last20:1,last30:1,loyaltyK:1,baseRegularityK:1.05,streakDays:1,streakK:1.10,regularityK:1.155};
    const context = allFlights ? (buildContextMap(allFlights).get(flight) || fallbackContext) : fallbackContext;
    const rateK = 1 + (context.loyaltyK - 1) + (context.regularityK - 1);
    const effectiveHourlyRate = RULE.hourlyRate * rateK;
    const flightHours = Math.max(0, Number(flight.times?.durationMinutes) || 0) / 60;
    const preparationPay = RULE.preparationHours * effectiveHourlyRate;
    const flightBasePay = flightHours * effectiveHourlyRate;
    const routeK = RULE.route[flight.routeType] || 1;
    const aircraftK = aircraftCoefficient(flight.aircraft?.icao, flight.flightType);
    const onlineK = String(flight.operations?.network || '').toLowerCase() === 'vatsim' ? 1.30 : 1;
    const flightAdjustedPay = flightBasePay * routeK * aircraftK * onlineK;
    const newSkyProfit = Number(flight.finance?.balance) || 0;
    const insuranceCase = window.UCAAInsurance.eligibleDamage(flight);
    const incidentPenalty = insuranceCase ? 0 : seriousIncidentPenalty(flight);
    const incidentReasons = insuranceCase ? [] : seriousIncidentReasons(flight);
    const incidentItems = insuranceCase ? [] : seriousIncidentDetails(flight);
    const seriousIncident = incidentReasons.length > 0;
    const fdr = fdrAnalysis(flight);
    const fdrPenalty = fdr.total;
    const insuranceLandingRelated = Boolean(insuranceCase && (flight.operations?.violations || []).some(
      violation => isLandingRelated(violation?.title)
    ));
    const incidentLandingRelated = incidentItems.some(item => item.landingRelated);
    const landingBonusesBlocked = Boolean(insuranceLandingRelated || incidentLandingRelated || fdr.blocksLandingBonuses);
    const managementBonusBlocked = Boolean(insuranceCase || seriousIncident || fdr.blocksBonuses);
    const bonusesBlocked = managementBonusBlocked;
    const ratingK = ratingCoefficient(flight.rating);
    const managementBonus = managementBonusBlocked
      ? 0
      : Math.min(RULE.managementBonusCap, Math.max(0, newSkyProfit * RULE.managementShare * ratingK));
    const fpm = landingFpm(flight);
    const masteryK = landingBonusesBlocked ? 1 : masteryCoefficient(fpm);
    const crosswindKt = Math.max(0, Number(flight.operations?.touchdownWeather?.crosswind) || 0);
    const crosswindK = landingBonusesBlocked ? 1 : 1 + crosswindKt * RULE.crosswindBonusPerKt;
    const earningsBeforeDeductions = preparationPay + flightAdjustedPay;
    const delayCash = delayedPenalty(flight);
    const delayDeduction = delayCash * RULE.delayLiabilityShare;
    const insuranceLiability = window.UCAAInsurance.pilotLiability(flight);
    const incidentLiability = Math.min(
      RULE.incidentLiabilityCap,
      incidentItems.reduce((sum, item) => sum + item.cash * item.liabilityRate, 0)
    );
    const covered = Math.max(0, Number(insurancePayout) || 0);
    const companyUncovered = Math.max(0, insuranceCase - covered);
    const salaryBeforeSkill = earningsBeforeDeductions;
    const masteryAdjustment = salaryBeforeSkill * (masteryK - 1);
    const crosswindAdjustment = salaryBeforeSkill * (crosswindK - 1);
    const salaryBeforeDeductions = salaryBeforeSkill + masteryAdjustment + crosswindAdjustment;
    const totalDeductions = delayDeduction + insuranceLiability + incidentLiability + fdrPenalty;
    const salaryBeforeBonus = salaryBeforeDeductions;
    const total = salaryBeforeDeductions + managementBonus - totalDeductions;
    return {
      total, preparationPay, flightBasePay, flightAdjustedPay, managementBonus,
      delayCash, delayDeduction, insuranceLiability, incidentLiability, masteryK, crosswindK, crosswindKt,
      routeK, aircraftK, onlineK, flightHours, fpm, newSkyProfit,
      insurancePayout:covered, insuranceCase, insuranceLandingRelated, seriousIncident, seriousIncidentPenalty:incidentPenalty, seriousIncidentReasons:incidentReasons, seriousIncidentItems:incidentItems, incidentLandingRelated, bonusesBlocked, managementBonusBlocked, landingBonusesBlocked, companyUncovered, earningsBeforeDeductions,
      fdrPenalty, fdrRawTotal:fdr.rawTotal, fdrCap:fdr.cap, fdrCapped:fdr.capped, fdrItems:fdr.items, fdrHardTouchdown:fdr.hardTouchdown, fdrBlocksBonuses:fdr.blocksBonuses, fdrBlocksLandingBonuses:fdr.blocksLandingBonuses,
      salaryBeforeSkill, masteryAdjustment, crosswindAdjustment, salaryBeforeDeductions, totalDeductions, salaryBeforeBonus,
      loyaltyK:context.loyaltyK, regularityK:context.regularityK, baseRegularityK:context.baseRegularityK || context.regularityK, streakDays:context.streakDays || 0, streakK:context.streakK || 1,
      effectiveHourlyRate, rateK, context, ratingK
    };
  }

  const pay = (flight, insurancePayout = 0, allFlights = null) => breakdown(flight, insurancePayout, allFlights).total;

  window.UCAAPilotPay = {RULE, aircraftCoefficient, landingFpm, masteryCoefficient, ratingCoefficient, delayedPenalty, seriousIncidentViolations, seriousIncidentReasons, seriousIncidentPenalty, seriousIncidentDetails, isLandingRelated, fdrAnalysis, loyaltyCoefficient, regularityCoefficient, streakCoefficient, buildContextMap, breakdown, pay};
})();
