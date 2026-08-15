(function () {
  var DEBOUNCE_MS = 500;
  var MIN_CHARS = 3;

  function effectiveQuery(value) {
    var query = String(value || '').trim();
    return query.length >= MIN_CHARS ? query : '';
  }

  function buildUrl(form, searchQuery) {
    var action = form.getAttribute('action') || window.location.pathname;
    var params = new URLSearchParams();
    var pageInput = form.querySelector('input[name="page"]');
    var pageSizeInput = form.querySelector('input[name="pageSize"]');

    if (pageInput) params.set('page', pageInput.value || '1');
    if (pageSizeInput && pageSizeInput.value) params.set('pageSize', pageSizeInput.value);
    if (searchQuery) params.set('search', searchQuery);

    var queryString = params.toString();
    if (!queryString) return action;
    return action + (action.indexOf('?') === -1 ? '?' : '&') + queryString;
  }

  function initLiveSearch(form) {
    var input = form.querySelector('[data-live-search-input]') || form.querySelector('input[name="search"]');
    var resultsSelector = form.getAttribute('data-live-search-results') || '[data-live-search-results]';
    var results = document.querySelector(resultsSelector);
    if (!input || !results) return;

    var timer = null;
    var lastSubmitted = effectiveQuery(input.value);
    var requestId = 0;

    function applyResults(html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var nextResults = doc.querySelector(resultsSelector);
      if (!nextResults) return;
      results.innerHTML = nextResults.innerHTML;
    }

    function runSearch(rawQuery) {
      var next = effectiveQuery(rawQuery);
      if (next === lastSubmitted) return;
      lastSubmitted = next;

      var url = buildUrl(form, next);
      var id = ++requestId;

      fetch(url, {
        headers: {
          Accept: 'text/html',
          'X-Requested-With': 'XMLHttpRequest',
        },
        credentials: 'same-origin',
      })
        .then(function (response) {
          if (!response.ok) throw new Error('Search failed');
          return response.text();
        })
        .then(function (html) {
          if (id !== requestId) return;
          applyResults(html);
          if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', url);
          }
        })
        .catch(function () {
          if (id !== requestId) return;
          lastSubmitted = null;
        });
    }

    function scheduleSearch() {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        runSearch(input.value);
      }, DEBOUNCE_MS);
    }

    input.addEventListener('input', scheduleSearch);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      window.clearTimeout(timer);
      runSearch(input.value);
    });
  }

  document.querySelectorAll('[data-live-search]').forEach(initLiveSearch);
})();
