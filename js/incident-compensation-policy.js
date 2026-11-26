(function () {
  const MIN_INCIDENT_COST = 30000;

  function cabinCrewPay(flight) {
    if (flight.status !== 'completed') return 0;
    const hours = Math.max(0, Number(flight.times?.durationMinutes) || 0) / 60;
    const isCargo = String(flight.flightType || '').toLowerCase() === 'cargo';
    const crew = isCargo ? 1 : Math.ceil(Math.max(0, Number(flight.operations?.passengers) || 0) / 50);
    return hours * 50 * crew;
  }

  function compensationType(flight) {
    const penalties = Math.max(0, Number(flight.finance?.penalties) || 0);
    const insuranceCase = window.UCAAInsurance.eligibleDamage(flight) > 0;
    const seriousIncident = window.UCAAPilotPay.seriousIncidentViolations(flight)
      .some(violation => !/\b(?:MLW|MTOW) exceeded/i.test(String(violation?.title || '')));
    const adverseTouchdown = (flight.operations?.violations || []).some(violation =>
      /^(Terrible|Bad|Hard) touchdown:/i.test(String(violation?.title || ''))
    );
    const fdrHardTouchdown = Boolean(window.UCAAPilotPay.fdrAnalysis(flight).hardTouchdown);
    const fullProfitCompensation = penalties >= MIN_INCIDENT_COST && (insuranceCase || seriousIncident);
    const partialRefund = (penalties > 0 && penalties < MIN_INCIDENT_COST && adverseTouchdown) || fdrHardTouchdown;
    if (!fullProfitCompensation && !partialRefund) return null;

    const isCargo = String(flight.flightType || '').toLowerCase() === 'cargo';
    const hasCargo = Number(flight.operations?.cargo) > 0 || Number(flight.operations?.cargoWeightKg) > 0;
    const mode = fullProfitCompensation ? 'profit' : 'refund20';
    if (isCargo) return hasCargo ? {key:'cargo', label:'Пошкоджений вантаж', mode} : null;
    return Number(flight.operations?.passengers) > 0
      ? {key:'passengers', label:'Моральні компенсації пасажирам', mode}
      : null;
  }

  function breakdown(flight, insurancePayout = 0, allFlights = null) {
    const pilotSalary = window.UCAAPilotPay.pay(flight, insurancePayout, allFlights);
    const cabinSalary = cabinCrewPay(flight);
    const profitBeforeCompensation = (Number(flight.finance?.balance) || 0)
      + Math.max(0, Number(insurancePayout) || 0) - pilotSalary - cabinSalary;
    const type = compensationType(flight);
    const refundBase = type?.key === 'cargo'
      ? Math.max(0, Number(flight.finance?.details?.cargo) || 0)
      : Math.max(0, Number(flight.finance?.details?.tickets) || 0);
    const minimumRefund = refundBase * 0.20;
    const compensation = !type ? 0
      : type.mode === 'refund20' ? minimumRefund
        : Math.max(minimumRefund, Math.max(0, profitBeforeCompensation));
    return {
      type,
      compensation,
      pilotSalary,
      cabinSalary,
      refundBase,
      profitBeforeCompensation,
      companyProfit: profitBeforeCompensation - compensation
    };
  }

  window.UCAAIncidentCompensation = {MIN_INCIDENT_COST, cabinCrewPay, compensationType, breakdown};
})();
