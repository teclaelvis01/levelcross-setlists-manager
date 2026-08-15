(function () {
  var modal = null;
  var pendingForm = null;
  var expectedName = '';
  var lastFocus = null;

  function qs(root, selector) {
    return root.querySelector(selector);
  }

  function ensureModal() {
    if (modal) return modal;

    modal = document.createElement('div');
    modal.className = 'confirm-delete-modal';
    modal.hidden = true;
    modal.innerHTML =
      '<div class="confirm-delete-modal__backdrop" data-confirm-backdrop></div>' +
      '<div class="confirm-delete-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-delete-title">' +
        '<div class="confirm-delete-modal__header">' +
          '<h2 id="confirm-delete-title" data-confirm-title></h2>' +
          '<p data-confirm-message></p>' +
        '</div>' +
        '<div class="confirm-delete-modal__body">' +
          '<label for="confirm-delete-input" data-confirm-prompt></label>' +
          '<input type="text" id="confirm-delete-input" data-confirm-input autocomplete="off" spellcheck="false">' +
        '</div>' +
        '<div class="confirm-delete-modal__actions">' +
          '<button type="button" class="btn btn-secondary" data-confirm-cancel>Cancelar</button>' +
          '<button type="button" class="btn btn-danger-solid" data-confirm-submit disabled></button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    qs(modal, '[data-confirm-backdrop]').addEventListener('click', close);
    qs(modal, '[data-confirm-cancel]').addEventListener('click', close);
    qs(modal, '[data-confirm-submit]').addEventListener('click', submitPending);
    qs(modal, '[data-confirm-input]').addEventListener('input', syncSubmitState);
    qs(modal, '[data-confirm-input]').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!qs(modal, '[data-confirm-submit]').disabled) submitPending();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && modal && !modal.hidden) {
        event.preventDefault();
        close();
      }
    });

    return modal;
  }

  function setPrompt(name) {
    var prompt = qs(modal, '[data-confirm-prompt]');
    prompt.textContent = '';
    prompt.appendChild(document.createTextNode('Escribe '));
    var code = document.createElement('strong');
    code.className = 'confirm-delete-modal__name';
    code.textContent = name;
    prompt.appendChild(code);
    prompt.appendChild(document.createTextNode(' para confirmar.'));
  }

  function syncSubmitState() {
    var input = qs(modal, '[data-confirm-input]');
    var submit = qs(modal, '[data-confirm-submit]');
    var matches = input.value === expectedName;
    submit.disabled = !matches;
  }

  function open(form) {
    ensureModal();
    pendingForm = form;
    expectedName = form.getAttribute('data-confirm-name') || '';
    lastFocus = document.activeElement;

    var title = form.getAttribute('data-confirm-title') || 'Confirmar eliminación';
    var message = form.getAttribute('data-confirm-message') || 'Esta acción no se puede deshacer.';
    var submitLabel = form.getAttribute('data-confirm-submit-label') || 'Eliminar';

    qs(modal, '[data-confirm-title]').textContent = title;
    qs(modal, '[data-confirm-message]').textContent = message;
    qs(modal, '[data-confirm-submit]').textContent = submitLabel;
    setPrompt(expectedName);

    var input = qs(modal, '[data-confirm-input]');
    input.value = '';
    syncSubmitState();

    modal.hidden = false;
    document.body.classList.add('confirm-delete-open');
    window.setTimeout(function () {
      input.focus();
    }, 0);
  }

  function close() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('confirm-delete-open');
    pendingForm = null;
    expectedName = '';
    if (lastFocus && typeof lastFocus.focus === 'function') {
      lastFocus.focus();
    }
    lastFocus = null;
  }

  function submitPending() {
    if (!pendingForm) return;
    if (qs(modal, '[data-confirm-input]').value !== expectedName) return;

    var form = pendingForm;
    close();
    // Allow the real submit after confirmation (skip the interceptor once).
    form.setAttribute('data-confirm-skip', '1');
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    } else {
      form.submit();
    }
  }

  document.addEventListener(
    'submit',
    function (event) {
      var form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!form.hasAttribute('data-confirm-delete')) return;

      if (form.getAttribute('data-confirm-skip') === '1') {
        form.removeAttribute('data-confirm-skip');
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      open(form);
    },
    true
  );
})();
