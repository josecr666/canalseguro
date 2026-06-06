(function () {
  'use strict';

  var MAX_SIZE = 25 * 1024 * 1024;   // 25 MB por archivo
  var MIN_RELATO = 20;               // mínimo de caracteres del relato
  var FORM_PAGES = ['paso1', 'paso2', 'paso3', 'confirmacion'];
  var CATEGORY_LABELS = {
    corrupcion: 'Corrupción administrativa',
    mineria: 'Minería ilegal y delitos ambientales',
    crimen: 'Crimen organizado',
    abuso: 'Abuso de autoridad',
    otro: 'Otro'
  };
  var state = { category: '', categoryLabel: '', relato: '', fecha: '', lugar: '', files: [], code: '' };

  // ---------- errores inline ----------
  function showError(id, msg) {
    var el = document.getElementById(id);
    if (!el) return;
    if (msg) el.textContent = msg;
    el.classList.add('show');
  }
  function clearError(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('show');
  }

  // ---------- enrutamiento por hash (botón Atrás + URLs compartibles) ----------
  function renderPage(name) {
    var page = document.getElementById('page-' + name);
    if (!page) { name = 'home'; page = document.getElementById('page-home'); }
    var pages = document.querySelectorAll('.page');
    for (var i = 0; i < pages.length; i++) { pages[i].classList.remove('active'); }
    page.classList.add('active');
    var inForm = FORM_PAGES.indexOf(name) !== -1;
    document.getElementById('navNormal').style.display = inForm ? 'none' : 'block';
    document.getElementById('navForm').style.display = inForm ? 'block' : 'none';
    window.scrollTo(0, 0);
    page.focus({ preventScroll: true });   // anuncio para lectores de pantalla
  }
  function handleRoute() {
    var name = (location.hash || '#home').slice(1);
    if (!document.getElementById('page-' + name)) name = 'home';
    if ((name === 'paso2' || name === 'paso3' || name === 'confirmacion') && !state.category) name = 'paso1';
    if (name === 'confirmacion' && !state.code) name = 'paso1';
    renderPage(name);
  }
  function showPage(name) {
    if (('#' + name) === location.hash) { handleRoute(); }
    else { location.hash = name; }
  }

  // ---------- categoría (paso 1) ----------
  function applyCategory(val) {
    var cards = document.querySelectorAll('.card--radio');
    for (var i = 0; i < cards.length; i++) {
      var r = cards[i].querySelector('input[type=radio]');
      var on = r && r.value === val;
      cards[i].classList.toggle('selected', on);
      if (r) r.checked = on;
      cards[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
    state.category = val;
    state.categoryLabel = CATEGORY_LABELS[val] || val;
    clearError('catError');
  }
  function goToPaso2() {
    if (!state.category) { showError('catError'); return; }
    showPage('paso2');
  }

  // ---------- archivos (paso 2) ----------
  function fmtSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }
  function renderFiles() {
    var list = document.getElementById('fileList');
    list.innerHTML = '';
    state.files.forEach(function (item, idx) {
      var f = item.file;
      var chip = document.createElement('div');
      chip.className = 'file-chip';

      var main = document.createElement('div');
      main.className = 'file-chip__main';
      var nm = document.createElement('span');
      nm.className = 'file-chip__name';
      nm.textContent = f.name + ' · ' + fmtSize(f.size);
      var badge = document.createElement('span');
      if (item.cleaned) {
        badge.className = 'file-chip__badge file-chip__badge--ok';
        badge.textContent = 'metadatos eliminados';
      } else {
        badge.className = 'file-chip__badge file-chip__badge--warn';
        badge.textContent = 'revisar metadatos';
        badge.title = 'Este formato no se limpia en el navegador. Elimina sus metadatos antes de subirlo.';
      }
      main.appendChild(nm);
      main.appendChild(badge);

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'file-chip__remove';
      btn.setAttribute('aria-label', 'Quitar ' + f.name);
      btn.textContent = '✕';
      btn.addEventListener('click', function () { state.files.splice(idx, 1); renderFiles(); });

      chip.appendChild(main);
      chip.appendChild(btn);
      list.appendChild(chip);
    });
  }
  var IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  // Reescribe la imagen en un canvas: el resultado solo contiene pixeles,
  // por lo que se descartan EXIF, GPS, miniatura y notas del fabricante.
  // El archivo original nunca sale del equipo del usuario.
  function stripImageMetadata(file) {
    return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bitmap) {
      var canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      if (bitmap.close) bitmap.close();
      var outType = (file.type === 'image/png') ? 'image/png' : 'image/jpeg';
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error('toBlob nulo')); return; }
          var base = file.name.replace(/\.[^.]+$/, '');
          var ext = (outType === 'image/png') ? '.png' : '.jpg';
          resolve(new File([blob], base + ext, { type: outType, lastModified: Date.now() }));
        }, outType, 0.92);
      });
    });
  }

  function setFileStatus(msg) {
    var s = document.getElementById('fileStatus');
    if (!s) return;
    s.textContent = msg || '';
    s.style.display = msg ? 'block' : 'none';
  }

  function addFiles(arr) {
    clearError('fileError');
    var rejected = [];
    var queue = [];
    arr.forEach(function (f) {
      if (f.size > MAX_SIZE) { rejected.push(f.name); }
      else { queue.push(f); }
    });
    if (rejected.length) {
      showError('fileError', 'Rechazado(s) por superar 25 MB: ' + rejected.join(', '));
    }
    if (!queue.length) { return; }

    setFileStatus('Limpiando metadatos…');
    // En secuencia para no saturar memoria con imagenes grandes.
    var chain = Promise.resolve();
    queue.forEach(function (f) {
      chain = chain.then(function () {
        if (IMAGE_TYPES.indexOf(f.type) !== -1) {
          return stripImageMetadata(f).then(function (clean) {
            state.files.push({ file: clean, cleaned: true });
          }).catch(function () {
            // si el navegador no pudo reencodear, conserva el original y avisa
            state.files.push({ file: f, cleaned: false });
          });
        }
        state.files.push({ file: f, cleaned: false });
        return null;
      }).then(renderFiles);
    });
    chain.then(function () { setFileStatus(''); });
  }
  function handleFiles(input) {
    addFiles(Array.prototype.slice.call(input.files));
    input.value = '';   // permite volver a elegir el mismo archivo
  }

  function goToPaso3() {
    var ta = document.getElementById('relato');
    var relato = ta.value.trim();
    if (relato.length < MIN_RELATO) {
      ta.classList.add('invalid');
      showError('relatoError');
      ta.focus();
      return;
    }
    ta.classList.remove('invalid');
    clearError('relatoError');
    state.relato = relato;
    state.fecha = document.getElementById('fecha').value || '—';
    state.lugar = document.getElementById('lugar').value.trim() || '—';
    document.getElementById('rev-cat').textContent = state.categoryLabel;
    document.getElementById('rev-fecha').textContent = state.fecha;
    document.getElementById('rev-lugar').textContent = state.lugar;
    document.getElementById('rev-relato').textContent = state.relato.length > 120 ? state.relato.slice(0, 120) + '… [vista previa truncada]' : state.relato;
    var nLimpios = state.files.filter(function (x) { return x.cleaned; }).length;
    document.getElementById('rev-evidencia').textContent = state.files.length
      ? state.files.length + ' archivo(s)' + (nLimpios ? ' · ' + nLimpios + ' con metadatos eliminados' : '')
      : 'Ningún archivo adjunto';
    showPage('paso3');
  }

  // ---------- envío (paso 3) ----------
  function generateCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 32 símbolos, sin I/O/0/1
    var bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);                     // CSPRNG, no Math.random()
    var out = '';
    for (var i = 0; i < 12; i++) { out += chars[bytes[i] & 31]; }   // & 31 = mod 32, sin sesgo
    return 'CS-' + out.slice(0, 4) + '-' + out.slice(4, 8) + '-' + out.slice(8, 12);
  }
  function enviarDenuncia() {
    if (!document.getElementById('acceptTerms').checked) { showError('termsError'); return; }
    clearError('termsError');
    state.code = generateCode();
    document.getElementById('genCode').textContent = state.code;
    showPage('confirmacion');
  }
  function copiarCodigo() {
    var code = document.getElementById('genCode').textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () { alert('Código copiado: ' + code); });
    } else {
      window.prompt('Copia este código:', code);
    }
  }

  // ---------- consulta de caso ----------
  function consultarCaso() {
    var input = document.getElementById('consultaCodigo').value.trim().toUpperCase();
    document.getElementById('casoResult').style.display = 'none';
    document.getElementById('casoError').style.display = 'none';
    if (!input) { document.getElementById('consultaCodigo').focus(); return; }
    if ([state.code, 'CS-7KQ3-9XPM-L2FN'].indexOf(input) !== -1) {
      document.getElementById('casoId').textContent = 'Caso ' + input;
      document.getElementById('casoResult').style.display = 'block';
    } else {
      document.getElementById('casoError').style.display = 'block';
    }
  }

  // ---------- FAQ acordeón ----------
  function toggleFaq(el) {
    var answer = el.nextElementSibling;
    var isOpen = el.classList.contains('open');
    var qs = document.querySelectorAll('.faq-item__q');
    for (var i = 0; i < qs.length; i++) {
      qs[i].classList.remove('open');
      qs[i].setAttribute('aria-expanded', 'false');
      if (qs[i].nextElementSibling) qs[i].nextElementSibling.classList.remove('open');
    }
    if (!isOpen) {
      el.classList.add('open');
      el.setAttribute('aria-expanded', 'true');
      if (answer) answer.classList.add('open');
    }
  }

  // ---------- mapa de acciones de botones ----------
  var ACTIONS = {
    paso2: goToPaso2,
    paso3: goToPaso3,
    enviar: enviarDenuncia,
    copiar: copiarCodigo,
    consultar: consultarCaso
  };

  // ---------- inicialización ----------
  function init() {
    var pages = document.querySelectorAll('.page');
    for (var i = 0; i < pages.length; i++) { pages[i].setAttribute('tabindex', '-1'); }

    handleRoute();
    window.addEventListener('hashchange', handleRoute);

    // navegación accesible para [data-nav]
    document.querySelectorAll('[data-nav]').forEach(function (el) {
      var tag = el.tagName.toLowerCase();
      var target = el.getAttribute('data-nav');
      if (tag === 'a') { if (!el.getAttribute('href')) el.setAttribute('href', '#' + target); return; }
      el.addEventListener('click', function () { showPage(target); });
      if (tag !== 'button') {
        if (!el.hasAttribute('role')) el.setAttribute('role', 'link');
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showPage(target); }
        });
      }
    });

    // botones con acción [data-action]
    document.querySelectorAll('[data-action]').forEach(function (el) {
      el.addEventListener('click', function () {
        var fn = ACTIONS[el.getAttribute('data-action')];
        if (fn) fn();
      });
    });

    // categoría: roles ARIA + clic en tarjeta + teclado nativo de los radios
    document.querySelectorAll('.card--radio').forEach(function (c) {
      c.setAttribute('role', 'radio');
      c.setAttribute('aria-checked', 'false');
      c.addEventListener('click', function () { if (c.dataset.val) applyCategory(c.dataset.val); });
    });
    document.querySelectorAll('#categoryOptions input[type=radio]').forEach(function (r) {
      r.addEventListener('change', function () { applyCategory(r.value); });
    });

    // archivos: input + dropzone
    var fi = document.getElementById('fileInput');
    if (fi) { fi.addEventListener('change', function () { handleFiles(fi); }); }
    var dz = document.getElementById('dropzone');
    if (dz) {
      dz.addEventListener('click', function () { if (fi) fi.click(); });
      dz.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (fi) fi.click(); }
      });
      dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.style.borderColor = 'var(--primary)'; });
      dz.addEventListener('dragleave', function () { dz.style.borderColor = ''; });
      dz.addEventListener('drop', function (e) {
        e.preventDefault(); dz.style.borderColor = '';
        addFiles(Array.prototype.slice.call(e.dataTransfer.files));
      });
    }

    // FAQ: ARIA + clic + teclado
    document.querySelectorAll('.faq-item__q').forEach(function (q, idx) {
      q.setAttribute('role', 'button');
      q.setAttribute('tabindex', '0');
      q.setAttribute('aria-expanded', 'false');
      var a = q.nextElementSibling;
      if (a) { var aid = 'faq-a-' + idx; a.id = aid; q.setAttribute('aria-controls', aid); a.setAttribute('role', 'region'); }
      q.addEventListener('click', function () { toggleFaq(q); });
      q.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFaq(q); }
      });
    });

    // contador de caracteres del relato
    var relato = document.getElementById('relato');
    var count = document.getElementById('relatoCount');
    if (relato && count) {
      relato.addEventListener('input', function () {
        var n = relato.value.trim().length;
        count.textContent = n;
        count.classList.toggle('warn', n > 0 && n < MIN_RELATO);
        if (n >= MIN_RELATO) { relato.classList.remove('invalid'); clearError('relatoError'); }
      });
    }

    // fecha: no permitir fechas futuras
    var fecha = document.getElementById('fecha');
    if (fecha) { fecha.max = new Date().toISOString().split('T')[0]; }

    // Enter en la consulta de caso
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var cp = document.getElementById('page-consultar');
      if (cp && cp.classList.contains('active') && document.activeElement === document.getElementById('consultaCodigo')) {
        consultarCaso();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();