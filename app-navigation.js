(function () {
  const views = {
    dashboard: document.querySelector('#dashboardView'),
    pilots: document.querySelector('#pilotsView'),
    profile: document.querySelector('#profileView'),
    company: document.querySelector('#companyView')
  };

  function showView() {
    const selected = location.hash === '#pilots' ? 'pilots' : location.hash === '#profile' ? 'profile' : location.hash === '#company' ? 'company' : 'dashboard';
    Object.entries(views).forEach(([name, view]) => { view.hidden = name !== selected; });
    document.querySelectorAll('[data-view-link]').forEach(link => {
      link.classList.toggle('active', link.dataset.viewLink === selected);
      link.setAttribute('aria-current', link.dataset.viewLink === selected ? 'page' : 'false');
    });
  }

  addEventListener('hashchange', showView);
  showView();
})();
