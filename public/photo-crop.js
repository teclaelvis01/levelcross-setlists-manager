(function () {
  const OUTPUT_SIZE = 150;

  const root = document.querySelector('[data-photo-upload]');
  if (!root) return;

  const input = root.querySelector('[data-photo-input]');
  const preview = root.querySelector('[data-photo-preview]');
  const remove = root.querySelector('[data-photo-remove]');
  const kept = root.querySelector('[data-kept-photo]');
  const clearBtn = root.querySelector('[data-photo-clear]');
  const filenameEl = root.querySelector('[data-photo-filename]');
  const triggers = root.querySelectorAll('[data-photo-trigger]');
  const triggerLabel = root.querySelector('[data-photo-trigger-label]');
  const modal = document.querySelector('[data-photo-crop-modal]');
  const viewportEl = modal && modal.querySelector('.photo-crop-viewport');
  const cropImage = modal && modal.querySelector('[data-crop-image]');
  const zoomInput = modal && modal.querySelector('[data-crop-zoom]');
  const applyBtn = modal && modal.querySelector('[data-crop-apply]');
  const cancelBtn = modal && modal.querySelector('[data-crop-cancel]');
  const backdrop = modal && modal.querySelector('[data-crop-backdrop]');

  if (!input || !preview || !modal || !viewportEl || !cropImage || !zoomInput || !applyBtn || !cancelBtn) return;

  let previewUrl = null;
  let sourceUrl = null;
  let naturalW = 0;
  let naturalH = 0;
  let baseScale = 1;
  let zoom = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let originX = 0;
  let originY = 0;

  function viewportSize() {
    return Math.round(viewportEl.getBoundingClientRect().width) || 280;
  }

  function setPreview(html) {
    preview.innerHTML = html;
  }

  function setEmpty() {
    setPreview('<span class="photo-upload__placeholder" aria-hidden="true">+</span>');
    if (filenameEl) filenameEl.textContent = '';
    if (triggerLabel) triggerLabel.textContent = 'Elegir foto';
    if (clearBtn) clearBtn.classList.add('is-hidden');
    if (kept) kept.value = '';
    root.removeAttribute('data-has-photo');
  }

  function setFilled(src, name) {
    setPreview('<img src="' + src + '" alt="" class="photo-upload__img">');
    if (filenameEl) filenameEl.textContent = name || 'Foto 150×150';
    if (triggerLabel) triggerLabel.textContent = 'Cambiar foto';
    if (clearBtn) clearBtn.classList.remove('is-hidden');
    root.setAttribute('data-has-photo', '');
  }

  function currentScale() {
    return baseScale * zoom;
  }

  function clampOffsets() {
    const size = viewportSize();
    const scale = currentScale();
    const displayW = naturalW * scale;
    const displayH = naturalH * scale;
    const minX = Math.min(0, size - displayW);
    const minY = Math.min(0, size - displayH);
    offsetX = Math.min(0, Math.max(minX, offsetX));
    offsetY = Math.min(0, Math.max(minY, offsetY));
  }

  function applyTransform() {
    const scale = currentScale();
    cropImage.style.width = naturalW * scale + 'px';
    cropImage.style.height = naturalH * scale + 'px';
    cropImage.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px)';
  }

  function openModal(file) {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = URL.createObjectURL(file);

    const img = new Image();
    img.onload = function () {
      naturalW = img.naturalWidth;
      naturalH = img.naturalHeight;
      modal.hidden = false;
      document.body.classList.add('photo-crop-open');

      const size = viewportSize();
      baseScale = size / Math.min(naturalW, naturalH);
      zoom = 1;
      zoomInput.value = '1';
      offsetX = (size - naturalW * baseScale) / 2;
      offsetY = (size - naturalH * baseScale) / 2;
      cropImage.src = sourceUrl;
      clampOffsets();
      applyTransform();
    };
    img.onerror = function () {
      alert('No se pudo leer la imagen seleccionada.');
      input.value = '';
    };
    img.src = sourceUrl;
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('photo-crop-open');
    if (sourceUrl) {
      URL.revokeObjectURL(sourceUrl);
      sourceUrl = null;
    }
    cropImage.removeAttribute('src');
  }

  function assignCroppedFile(file) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    if (remove) remove.value = '0';
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    setFilled(previewUrl, file.name);
  }

  function exportCrop() {
    const size = viewportSize();
    const scale = currentScale();
    const sx = -offsetX / scale;
    const sy = -offsetY / scale;
    const sSize = size / scale;

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cropImage, sx, sy, sSize, sSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    canvas.toBlob(
      function (blob) {
        if (!blob) {
          alert('No se pudo generar la foto recortada.');
          return;
        }
        const file = new File([blob], 'avatar-150x150.jpg', { type: 'image/jpeg' });
        assignCroppedFile(file);
        closeModal();
      },
      'image/jpeg',
      0.92
    );
  }

  triggers.forEach(function (btn) {
    btn.addEventListener('click', function () {
      input.click();
    });
  });

  input.addEventListener('change', function () {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Selecciona una imagen válida.');
      input.value = '';
      return;
    }
    openModal(file);
    input.value = '';
  });

  zoomInput.addEventListener('input', function () {
    const size = viewportSize();
    const prevScale = currentScale();
    const centerX = size / 2;
    const centerY = size / 2;
    const imgX = (centerX - offsetX) / prevScale;
    const imgY = (centerY - offsetY) / prevScale;
    zoom = Number(zoomInput.value) || 1;
    const nextScale = currentScale();
    offsetX = centerX - imgX * nextScale;
    offsetY = centerY - imgY * nextScale;
    clampOffsets();
    applyTransform();
  });

  cropImage.addEventListener('pointerdown', function (event) {
    dragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    originX = offsetX;
    originY = offsetY;
    cropImage.setPointerCapture(event.pointerId);
  });

  cropImage.addEventListener('pointermove', function (event) {
    if (!dragging) return;
    offsetX = originX + (event.clientX - dragStartX);
    offsetY = originY + (event.clientY - dragStartY);
    clampOffsets();
    applyTransform();
  });

  function endDrag(event) {
    if (!dragging) return;
    dragging = false;
    try {
      cropImage.releasePointerCapture(event.pointerId);
    } catch (_) {}
  }

  cropImage.addEventListener('pointerup', endDrag);
  cropImage.addEventListener('pointercancel', endDrag);

  applyBtn.addEventListener('click', exportCrop);
  cancelBtn.addEventListener('click', closeModal);
  if (backdrop) backdrop.addEventListener('click', closeModal);

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !modal.hidden) closeModal();
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      input.value = '';
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }
      if (kept) kept.value = '';
      if (remove) remove.value = '1';
      setEmpty();
    });
  }
})();
