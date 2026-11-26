(() => {
  'use strict';
  const notes = [...document.querySelectorAll('[data-inside-joke]')];
  if (!notes.length) return;
  const bubble = document.createElement('aside');
  bubble.className = 'inside-reveal';
  bubble.hidden = true;
  const message = document.createElement('p');
  message.className = 'inside-reveal-message';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  const symbol = document.createElement('span');
  symbol.className = 'inside-reveal-symbol';
  symbol.setAttribute('aria-hidden', 'true');
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Fechar anotação');
  bubble.append(symbol, message, close);
  document.body.append(bubble);
  let timer;
  let typingTimer;
  let buffer = '';
  let anchor;
  function hide() {
    clearTimeout(timer);
    bubble.hidden = true;
    anchor?.setAttribute('aria-expanded', 'false');
    anchor = null;
  }
  function reveal(note, fromKeyboard = false) {
    hide();
    anchor = note;
    symbol.textContent = note.dataset.jokeSymbol || '✳';
    message.textContent = note.dataset.insideJoke;
    bubble.dataset.tone = note.dataset.jokeTone || 'lime';
    bubble.hidden = false;
    note.setAttribute('aria-expanded', 'true');
    // O bilhete aparece perto de onde foi descoberto, sem tirar o foco da página.
    const rect = note.getBoundingClientRect();
    const width = bubble.getBoundingClientRect().width;
    const height = bubble.getBoundingClientRect().height;
    const visible = !fromKeyboard && rect.top >= 0 && rect.bottom < innerHeight;
    const left = visible ? rect.left + rect.width / 2 - width / 2 : (innerWidth - width) / 2;
    const top = visible ? (rect.bottom + height + 20 < innerHeight ? rect.bottom + 10 : rect.top - height - 10) : innerHeight - height - 24;
    bubble.style.left = `${Math.max(12, Math.min(left, innerWidth - width - 12))}px`;
    bubble.style.top = `${Math.max(12, Math.min(top, innerHeight - height - 12))}px`;
    timer = setTimeout(hide, 6500);
  }
  notes.forEach(note => {
    note.setAttribute('aria-expanded', 'false');
    note.addEventListener('click', () => {
      if (anchor === note && !bubble.hidden) hide();
      else reveal(note);
    });
  });
  close.addEventListener('click', () => {
    const previous = anchor;
    hide();
    if (previous && previous.getClientRects().length) previous.focus({ preventScroll: true });
  });
  document.addEventListener('click', event => {
    if (!bubble.hidden && !bubble.contains(event.target) && !event.target.closest('[data-inside-joke]')) hide();
  });
  window.addEventListener('resize', hide);
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  document.addEventListener('keydown', event => {
    const editing = event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
    if (editing || document.querySelector('dialog[open]') || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (event.key === 'Escape') { hide(); return; }
    if (event.key.length !== 1) return;
    clearTimeout(typingTimer);
    buffer = (buffer + normalize(event.key)).slice(-80);
    const note = notes.find(item => buffer.endsWith(normalize(item.dataset.insideJoke)));
    if (note) { reveal(note, true); buffer = ''; }
    typingTimer = setTimeout(() => { buffer = ''; }, 3000);
  });
})();
