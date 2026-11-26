(() => {
  'use strict';
  const memes = Array.isArray(window.MEMES_DATA) ? window.MEMES_DATA : [];
  const $ = selector => document.querySelector(selector);
  if (!$('#memes-grid')) return;
  let filter = 'todos';
  let current = 0;
  let modalSequence = [];
  let sillyTimer;
  let copyTimer;
  let changedWhileOpen = false;
  const dialog = $('#meme-dialog');
  const favoriteKey = 'zeballos-meme-saves';
  let saved = new Set();
  try { const ids = JSON.parse(localStorage.getItem(favoriteKey) || '[]'); if (Array.isArray(ids)) saved = new Set(ids.filter(id => memes.some(m => m.id === id))); } catch { /* Sem armazenamento, os botões continuam funcionando. */ }

  function status(message) { $('#memes-status').textContent = message; }
  function selection() { return memes.filter(m => filter === 'todos' || (filter === 'salvos' ? saved.has(m.id) : m.category === filter)); }
  function save(id) {
    saved.has(id) ? saved.delete(id) : saved.add(id);
    try { localStorage.setItem(favoriteKey, JSON.stringify([...saved])); } catch { /* A seleção dura nesta visita. */ }
    status(saved.has(id) ? 'Guardado no seu navegador. O grupo agradece.' : 'Tirado dos seus memes salvos.');
    if (dialog.open) changedWhileOpen = true;
    render();
    if (dialog.open) updateSaveButton();
  }
  function updateSaveButton() {
    const meme = modalSequence[current];
    if (!meme) return;
    $('#meme-save').setAttribute('aria-pressed', String(saved.has(meme.id)));
    $('#meme-save').textContent = saved.has(meme.id) ? 'Guardado ♥' : 'Guardar meme';
  }
  function updateModal() {
    const meme = modalSequence[current];
    if (!meme) return;
    $('#meme-image').src = meme.src;
    $('#meme-image').alt = meme.alt;
    $('#meme-modal-title').textContent = meme.title;
    $('#meme-caption').textContent = meme.caption;
    $('#meme-modal-credit').textContent = meme.credit;
    $('#meme-source').hidden = !meme.sourceUrl;
    if (meme.sourceUrl) $('#meme-source').href = meme.sourceUrl;
    $('#meme-download').href = meme.src;
    $('#meme-download').download = `${meme.id}.webp`;
    $('#meme-counter').textContent = `${current + 1} / ${modalSequence.length}`;
    $('#meme-previous').hidden = $('#meme-next').hidden = modalSequence.length < 2;
    $('#copy-caption').textContent = 'Copiar legenda';
    clearTimeout(copyTimer);
    updateSaveButton();
  }
  function open(id, list = memes) {
    if (!list.length) return;
    modalSequence = [...list];
    current = Math.max(0, list.findIndex(m => m.id === id));
    updateModal();
    if (!dialog.open) dialog.showModal();
  }
  function step(direction) {
    if (!modalSequence.length) return;
    current = (current + direction + modalSequence.length) % modalSequence.length;
    updateModal();
  }
  function card(meme) {
    const item = document.createElement('article');
    item.className = 'meme-card';
    const button = document.createElement('button');
    button.className = 'meme-open';
    button.setAttribute('aria-label', `Abrir meme ${meme.title}`);
    const image = document.createElement('img');
    image.src = meme.src;
    image.alt = meme.alt;
    image.loading = 'lazy';
    image.decoding = 'async';
    button.append(image);
    button.addEventListener('click', () => open(meme.id, selection()));
    const caption = document.createElement('p');
    caption.className = 'meme-card-caption';
    caption.textContent = meme.caption;
    const footer = document.createElement('div');
    footer.className = 'meme-card-footer';
    const title = document.createElement('h3');
    title.textContent = meme.title;
    const favorite = document.createElement('button');
    favorite.className = 'meme-heart';
    favorite.textContent = saved.has(meme.id) ? '♥' : '♡';
    favorite.setAttribute('aria-label', `Guardar ${meme.title}`);
    favorite.setAttribute('aria-pressed', String(saved.has(meme.id)));
    favorite.addEventListener('click', () => {
      const wasSavedFilter = filter === 'salvos';
      save(meme.id);
      if (wasSavedFilter) $('[data-meme-filter="salvos"]').focus({ preventScroll: true });
      else [...document.querySelectorAll('.meme-heart')].find(b => b.getAttribute('aria-label') === `Guardar ${meme.title}`)?.focus({ preventScroll: true });
    });
    footer.append(title, favorite);
    item.append(button, caption, footer);
    return item;
  }
  function render() {
    const list = selection();
    const fragment = document.createDocumentFragment();
    list.forEach(m => fragment.append(card(m)));
    $('#memes-grid').replaceChildren(fragment);
    $('#memes-empty').hidden = list.length > 0;
    $('#meme-total').textContent = memes.length;
    $('#memes-saved-count').textContent = saved.size;
  }
  document.querySelectorAll('[data-meme-filter]').forEach(button => button.addEventListener('click', () => {
    filter = button.dataset.memeFilter;
    document.querySelectorAll('[data-meme-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    render();
    status(filter === 'salvos' ? 'Essa coleção fica só neste navegador.' : 'Escolhe a imagem que explica a situação.');
  }));
  $('#random-meme').addEventListener('click', () => {
    const list = selection().length ? selection() : memes;
    if (list.length) open(list[Math.floor(Math.random() * list.length)].id, list);
  });
  $('#meme-close').addEventListener('click', () => dialog.close());
  $('#meme-previous').addEventListener('click', () => step(-1));
  $('#meme-next').addEventListener('click', () => step(1));
  $('#meme-save').addEventListener('click', () => { const meme = modalSequence[current]; if (meme) save(meme.id); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    if (changedWhileOpen) $(`[data-meme-filter="${filter}"]`)?.focus({ preventScroll: true });
    changedWhileOpen = false;
  });
  $('#copy-caption').addEventListener('click', async () => {
    const caption = modalSequence[current]?.caption;
    if (!caption) return;
    try {
      if (!navigator.clipboard) throw new Error('Sem clipboard');
      await navigator.clipboard.writeText(caption);
      $('#copy-caption').textContent = 'Copiada!';
    } catch {
      const range = document.createRange();
      range.selectNodeContents($('#meme-caption'));
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      $('#copy-caption').textContent = 'Legenda selecionada: copie';
    }
    copyTimer = setTimeout(() => { $('#copy-caption').textContent = 'Copiar legenda'; }, 3500);
  });

  const patrick = memes.find(m => /patrick/i.test(m.id + ' ' + m.title));
  const rainbow = memes.find(m => m.id === 'energia-do-intervalo') || memes[memes.length - 1];
  if (patrick) {
    $('#patrick-feature-image').src = patrick.src;
    $('#patrick-feature-image').alt = patrick.alt;
    $('#patrick-feature').addEventListener('click', () => open(patrick.id));
  } else $('#patrick-feature').hidden = true;
  if (rainbow) {
    $('#rainbow-feature-image').src = rainbow.src;
    $('#rainbow-feature-image').alt = rainbow.alt;
    $('#rainbow-feature').addEventListener('click', () => open(rainbow.id));
  } else $('#rainbow-feature').hidden = true;

  function setSilly(active) {
    clearTimeout(sillyTimer);
    document.body.classList.toggle('silly-mode', active);
    $('#silly-toggle').setAttribute('aria-pressed', String(active));
    $('#silly-toggle').textContent = active ? 'Voltar a ter juízo' : 'Ativar modo bobão';
    $('#silly-banner').hidden = !active;
    if (active) {
      status('O juízo saiu. Volta em 15 segundos. 🌈');
      sillyTimer = setTimeout(() => setSilly(false), 15000);
    }
  }
  $('#silly-toggle').addEventListener('click', () => setSilly(!document.body.classList.contains('silly-mode')));
  $('#silly-close').addEventListener('click', () => setSilly(false));
  $('#back-to-top').addEventListener('click', () => {
    $('#inicio').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    document.querySelector('.wordmark')?.focus({ preventScroll: true });
  });
  render();
})();
