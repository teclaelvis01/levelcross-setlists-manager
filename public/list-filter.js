(function () {
  var DEBOUNCE_MS = 300;
  var MIN_CHARS = 3;

  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  function effectiveQuery(value) {
    var query = normalize(value);
    return query.length >= MIN_CHARS ? query : '';
  }

  // Prefer class + attribute: author CSS (display:flex/grid) can override [hidden].
  function setHidden(el, hidden) {
    if (!el) return;
    el.hidden = !!hidden;
    el.classList.toggle('is-hidden', !!hidden);
  }

  function initListFilter(root) {
    var input = root.querySelector('[data-list-filter-input]');
    if (!input) return;

    var countEl = root.querySelector('[data-list-filter-count]');
    var emptyEl = root.querySelector('[data-list-filter-empty]');
    var listEl = root.querySelector('[data-list-filter-list]');
    var timer = null;
    var totalHint = Number(root.getAttribute('data-list-filter-total') || 0);

    function getItems() {
      return Array.prototype.slice.call(root.querySelectorAll('[data-list-filter-item]'));
    }

    function itemText(item) {
      return normalize(item.getAttribute('data-filter-text') || item.textContent || '');
    }

    function applyFilter(rawQuery) {
      var query = effectiveQuery(rawQuery);
      var items = getItems();
      var visible = 0;

      items.forEach(function (item) {
        var matches = !query || itemText(item).indexOf(query) !== -1;
        setHidden(item, !matches);
        if (matches) visible += 1;
      });

      if (countEl) {
        if (query) countEl.textContent = String(visible);
        else countEl.textContent = String(totalHint || items.length);
      }

      if (emptyEl) {
        setHidden(emptyEl, visible > 0 || items.length === 0);
      }

      if (listEl) {
        setHidden(listEl, visible === 0 && items.length > 0);
      }
    }

    function scheduleFilter() {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        applyFilter(input.value);
      }, DEBOUNCE_MS);
    }

    input.addEventListener('input', scheduleFilter);

    // Never intercept parent form submit (e.g. activity edit "Guardar").
    // Only stop Enter from submitting the outer form while filtering.
    input.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      window.clearTimeout(timer);
      applyFilter(input.value);
    });

    var dedicatedForm = input.closest('form[data-list-filter-form]');
    if (dedicatedForm) {
      dedicatedForm.addEventListener('submit', function (event) {
        event.preventDefault();
        window.clearTimeout(timer);
        applyFilter(input.value);
      });
    }

    root.addEventListener('listfilter:refresh', function () {
      applyFilter(input.value);
    });

    applyFilter(input.value);
  }

  document.querySelectorAll('[data-list-filter]').forEach(initListFilter);
})();
