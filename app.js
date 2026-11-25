(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const storage = {
    read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* O site também funciona sem armazenamento. */ } }
  };
  const data = window.SITE_DATA || { photos: [], people: [] };
  const names = { joaquim: 'Joaquim', 'Mateus e vitor pupim': 'Mateus e Vitor Pupim' };
  const people = data.people.map((person, index) => ({ ...person, name: names[person.name] || person.name, id: `pessoa-${String(index + 1).padStart(3, '0')}`, thumb: person.src, category: 'people' }));
  const highlights = ['foto-012', 'foto-006', 'foto-020', 'foto-003', 'foto-035', 'foto-046', 'foto-025', 'foto-028', 'foto-021', 'foto-017', 'foto-027', 'foto-008'];
  const orderedPhotos = [...highlights.map(id => data.photos.find(photo => photo.id === id)).filter(Boolean), ...data.photos.filter(photo => !highlights.includes(photo.id))];
  const allPhotos = [...orderedPhotos, ...people];
  const webPhotos = window.WEB_GALLERY || [];
  const byId = new Map([...allPhotos, ...webPhotos].map(photo => [photo.id, photo]));
  const savedIds = storage.read('zeballos-favorites', []);
  const favorites = new Set(Array.isArray(savedIds) ? savedIds.filter(id => byId.has(id)) : []);
  let activeFilter = 'all';
  let search = '';
  let shown = 12;
  let filtered = [];
  let sequence = [];
  let currentIndex = 0;
  let toastTimer;
  let henriClicks = 0;
  let henriReset;
  let brandClicks = 0;
  let brandReset;
  let previousTheme = 'light';
  let hintIndex = 0;
  const lightbox = $('#lightbox');
  const study = $('#study-dialog');

  function icon(name) {
    return `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  }
  function notify(message) {
    clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').classList.add('visible');
    toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3600);
  }
  function normalize(text) {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }
  function titleFor(photo) {
    return photo.name || `Arquivo ${photo.id.replace('foto-', '')} · 2º Infonet`;
  }

  function applyTheme(theme, announce = false) {
    const before = document.documentElement.dataset.theme;
    if (theme === 'leonida' && before !== 'leonida') previousTheme = before || 'light';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('zeballos-theme', theme); } catch { /* Tema continua disponível nesta visita. */ }
    $$('[data-theme-set]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeSet === theme)));
    $$('[data-leonida]').forEach(button => button.setAttribute('aria-pressed', String(theme === 'leonida')));
    $$('[data-leonida-label]').forEach(label => { label.textContent = theme === 'leonida' ? 'Voltar pro interior' : 'Partiu Leonida'; });
    $('meta[name="theme-color"]').content = { light: '#f7f7f4', dark: '#171916', leonida: '#161528' }[theme];
    if (announce) notify(theme === 'leonida' ? 'Bem-vindo a Leonida. A Etec ficou pra trás. 🌴' : theme === 'dark' ? 'Apagaram a luz da sala.' : 'Acenderam a luz da sala.');
  }
  $$('[data-theme-set]').forEach(button => button.addEventListener('click', () => applyTheme(button.dataset.themeSet, true)));
  $$('[data-leonida]').forEach(button => button.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'leonida' ? previousTheme : 'leonida', true)));
  applyTheme(document.documentElement.dataset.theme || 'light');

  function favoriteButton(photo) {
    const button = document.createElement('button');
    button.className = 'favorite-button';
    button.dataset.favorite = photo.id;
    button.setAttribute('aria-label', `Salvar ${titleFor(photo)}`);
    button.setAttribute('aria-pressed', String(favorites.has(photo.id)));
    button.innerHTML = icon('heart');
    button.addEventListener('click', () => toggleFavorite(photo.id));
    return button;
  }
  function createPhotoCard(photo) {
    const card = document.createElement('article');
    card.className = 'photo-card';
    const open = document.createElement('button');
    open.className = 'photo-open';
    open.setAttribute('aria-label', `Ampliar ${titleFor(photo)}`);
    const image = document.createElement('img');
    image.src = photo.thumb;
    image.alt = photo.name ? `Foto de ${photo.name}` : `Registro da turma, arquivo ${photo.id.replace('foto-', '')}`;
    image.loading = 'lazy';
    image.decoding = 'async';
    if (photo.width) { image.width = photo.width; image.height = photo.height; }
    open.append(image);
    open.addEventListener('click', () => openPhoto(photo.id, filtered));
    const caption = document.createElement('div');
    caption.className = 'photo-caption';
    const text = document.createElement('span');
    text.textContent = titleFor(photo);
    caption.append(text, favoriteButton(photo));
    card.append(open, caption);
    return card;
  }
  function renderGallery(append = false) {
    const previousCount = append ? $('#gallery-grid').children.length : 0;
    filtered = allPhotos.filter(photo => {
      const matchesFilter = activeFilter === 'all' || (activeFilter === 'favorites' ? favorites.has(photo.id) : photo.category === activeFilter);
      return matchesFilter && (!search || normalize(`${photo.name || ''} ${photo.originalName} ${photo.id}`).includes(search));
    });
    const fragment = document.createDocumentFragment();
    filtered.slice(previousCount, shown).forEach(photo => fragment.append(createPhotoCard(photo)));
    if (!append) $('#gallery-grid').replaceChildren();
    $('#gallery-grid').append(fragment);
    $('#empty-state').hidden = filtered.length > 0;
    $('#load-more').hidden = shown >= filtered.length;
    $('#gallery-progress').textContent = `${Math.min(shown, filtered.length)} de ${filtered.length} fotos`;
    $('#favorite-count').textContent = favorites.size;
    $('#all-count').textContent = allPhotos.length;
  }
  function toggleFavorite(id) {
    if (favorites.has(id)) { favorites.delete(id); notify('Foto tirada das salvas.'); }
    else { favorites.add(id); notify('Foto salva neste navegador. Boa escolha.'); }
    storage.write('zeballos-favorites', [...favorites]);
    $$('[data-favorite]').forEach(button => button.setAttribute('aria-pressed', String(favorites.has(button.dataset.favorite))));
    $('#favorite-count').textContent = favorites.size;
    if (lightbox.open) updateModalFavorite();
    if (activeFilter === 'favorites') renderGallery();
  }
  $$('.filter').forEach(button => button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    shown = 12;
    $$('.filter').forEach(filter => { const active = filter === button; filter.classList.toggle('active', active); filter.setAttribute('aria-pressed', String(active)); });
    renderGallery();
  }));
  $('#photo-search').addEventListener('input', event => { search = normalize(event.target.value.trim()); shown = 12; renderGallery(); });
  $('#load-more').addEventListener('click', () => {
    const previousCount = $('#gallery-grid').children.length;
    shown += 24;
    renderGallery(true);
    $('#gallery-grid').children[previousCount]?.querySelector('button')?.focus({ preventScroll: true });
  });

  function openPhoto(id, requestedSequence = allPhotos) {
    if (!byId.has(id)) return;
    sequence = requestedSequence.some(photo => photo.id === id) ? [...requestedSequence] : [...allPhotos];
    currentIndex = sequence.findIndex(photo => photo.id === id);
    renderModalPhoto();
    if (!lightbox.open) lightbox.showModal();
  }
  function updateModalFavorite() {
    const photo = sequence[currentIndex];
    $('#lightbox-favorite').hidden = Boolean(photo.credit);
    $('#lightbox-favorite').setAttribute('aria-pressed', String(favorites.has(photo.id)));
    $('#lightbox-favorite').setAttribute('aria-label', `${favorites.has(photo.id) ? 'Remover das salvas' : 'Salvar foto'}: ${titleFor(photo)}`);
  }
  function renderModalPhoto() {
    const photo = sequence[currentIndex];
    $('#lightbox-image').src = photo.src;
    $('#lightbox-image').alt = photo.alt || (photo.name ? `Foto de ${photo.name}` : `Registro da turma, arquivo ${photo.id.replace('foto-', '')}`);
    $('#lightbox-title').textContent = titleFor(photo);
    $('#lightbox-file').textContent = photo.credit || photo.originalName;
    $('#lightbox-source').hidden = !photo.sourceUrl;
    if (photo.sourceUrl) $('#lightbox-source').href = photo.sourceUrl;
    $('#lightbox-counter').textContent = `${currentIndex + 1} / ${sequence.length}`;
    $('#download-photo').href = photo.src;
    $('#download-photo').download = `${photo.id}.webp`;
    $('#previous-photo').hidden = $('#next-photo').hidden = sequence.length < 2;
    updateModalFavorite();
  }
  function stepPhoto(direction) {
    if (!sequence.length) return;
    currentIndex = (currentIndex + direction + sequence.length) % sequence.length;
    renderModalPhoto();
  }
  $('#lightbox-close').addEventListener('click', () => lightbox.close());
  $('#previous-photo').addEventListener('click', () => stepPhoto(-1));
  $('#next-photo').addEventListener('click', () => stepPhoto(1));
  $('#lightbox-favorite').addEventListener('click', () => toggleFavorite(sequence[currentIndex].id));
  lightbox.addEventListener('click', event => { if (event.target === lightbox) lightbox.close(); });
  let touchStart;
  $('#lightbox-image').addEventListener('touchstart', event => { touchStart = event.changedTouches[0].clientX; }, { passive: true });
  $('#lightbox-image').addEventListener('touchend', event => {
    const distance = event.changedTouches[0].clientX - touchStart;
    if (Math.abs(distance) > 60) stepPhoto(distance > 0 ? -1 : 1);
  }, { passive: true });
  $$('[data-open-photo]').forEach(button => button.addEventListener('click', () => openPhoto(button.dataset.openPhoto)));
  $$('[data-random]').forEach(button => button.addEventListener('click', () => {
    if (!allPhotos.length) return;
    openPhoto(allPhotos[Math.floor(Math.random() * allPhotos.length)].id);
  }));

  function lobsterRain() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { notify('🦞 Henri Lagosta entrou no servidor.'); return; }
    const layer = $('#confetti-layer');
    layer.replaceChildren();
    for (let i = 0; i < 26; i++) {
      const lobster = document.createElement('span');
      lobster.className = 'lobster-confetti';
      lobster.textContent = '🦞';
      lobster.style.left = `${Math.random() * 95}%`;
      lobster.style.animationDelay = `${Math.random() * 1.2}s`;
      lobster.style.fontSize = `${23 + Math.random() * 30}px`;
      layer.append(lobster);
    }
    setTimeout(() => layer.replaceChildren(), 5000);
    notify('O Henri tomou conta do site. 🦞');
  }
  function trackHenri() {
    clearTimeout(henriReset);
    henriClicks += 1;
    henriReset = setTimeout(() => { henriClicks = 0; }, 4500);
    if (henriClicks >= 3) { henriClicks = 0; lobsterRain(); }
  }
  $('#henri-hero').addEventListener('click', () => { trackHenri(); openPhoto(people[0]?.id); });
  const crewFragment = document.createDocumentFragment();
  people.forEach((person, index) => {
    const button = document.createElement('button');
    button.className = 'crew-card';
    button.setAttribute('aria-label', `Ver foto de ${person.name}`);
    const frame = document.createElement('div');
    frame.className = 'crew-image';
    const image = document.createElement('img');
    image.src = person.src;
    image.alt = person.name;
    image.loading = 'lazy';
    image.decoding = 'async';
    frame.append(image);
    if (index === 0) { const tag = document.createElement('span'); tag.className = 'lobster-tag'; tag.textContent = '🦞'; tag.setAttribute('aria-hidden', 'true'); frame.append(tag); }
    const name = document.createElement('h3');
    name.textContent = person.name;
    const subtitle = document.createElement('span');
    subtitle.className = 'crew-subtitle';
    subtitle.textContent = index === 0 ? 'sim, o Lagosta.' : index === 3 ? 'a dupla da foto.' : 'parte da história.';
    button.append(frame, name, subtitle);
    button.addEventListener('click', () => { if (index === 0) trackHenri(); openPhoto(person.id, people); });
    crewFragment.append(button);
  });
  $('#crew-grid').append(crewFragment);
  people.slice(0, 5).forEach(person => { const image = document.createElement('img'); image.src = person.src; image.alt = ''; image.width = 33; image.height = 33; $('#avatar-stack').append(image); });

  webPhotos.forEach(photo => {
    const card = document.createElement('article');
    card.className = photo.category === 'gta' ? 'web-photo-card' : 'album-card';
    const open = document.createElement('button');
    open.className = 'web-photo-open';
    open.setAttribute('aria-label', `Ampliar ${photo.name}`);
    const image = document.createElement('img');
    image.src = photo.src;
    image.alt = photo.alt;
    image.loading = 'lazy';
    image.decoding = 'async';
    open.append(image);
    open.addEventListener('click', () => openPhoto(photo.id, webPhotos.filter(item => item.category === photo.category)));
    const caption = document.createElement('div');
    caption.className = 'web-photo-caption';
    const title = document.createElement('h4');
    title.textContent = photo.name;
    const credit = document.createElement('span');
    credit.textContent = photo.artists || 'Rockstar Games';
    caption.append(title, credit);
    if (photo.category === 'cover') {
      const source = document.createElement('a');
      source.href = photo.sourceUrl;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      source.textContent = 'Ver o lançamento';
      source.className = 'album-source';
      caption.append(source);
    }
    card.append(open, caption);
    $(photo.category === 'gta' ? '#gta-gallery' : '#cover-grid').append(card);
  });
  let rentAttempts = 0;
  const rentMessages = ['Objetivo atualizado: esperar o Pix cair.', 'O Pix não caiu. A esperança também não.', 'Plano B: mandar “e aí, tudo certo?” de novo.', 'Missão alternativa: cobrar a parte do trabalho do grupo.'];
  $('#rent-button').addEventListener('click', () => {
    $('#rent-status').textContent = rentMessages[rentAttempts % rentMessages.length];
    rentAttempts += 1;
    if (rentAttempts === 4) notify('Cobrança nível 4. A resenha continua.');
  });

  function toggleStudy() {
    if (study.open) { study.close(); return; }
    if (lightbox.open) lightbox.close();
    if (radioPlaying) stopRadio();
    study.showModal();
  }
  $('#study-button').addEventListener('click', toggleStudy);
  $('#study-close').addEventListener('click', () => study.close());
  $$('.wordmark').forEach(mark => mark.addEventListener('click', () => {
    clearTimeout(brandReset);
    brandClicks += 1;
    brandReset = setTimeout(() => { brandClicks = 0; }, 3500);
    if (brandClicks >= 5) {
      brandClicks = 0;
      $('.wanted-toast')?.remove();
      const wanted = document.createElement('div');
      wanted.className = 'wanted-toast';
      wanted.innerHTML = '<b>★★★★★</b><span>Procurado por abrir o site durante a aula.</span>';
      document.body.append(wanted);
      setTimeout(() => wanted.remove(), 4800);
    }
  }));
  const hints = ['Tenta escrever LEONIDA, sem clicar em nada.', 'A logo não gosta que cliquem nela 5 vezes.', 'Henri em dose tripla: abre, fecha, abre…', 'A tecla P leva os estudos muito a sério.'];
  $('#secret-hint').addEventListener('click', () => { notify(hints[hintIndex % hints.length]); hintIndex += 1; });
  let typed = '';
  document.addEventListener('keydown', event => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable;
    if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLowerCase() === 'p') { event.preventDefault(); toggleStudy(); return; }
    if (study.open) return;
    if (lightbox.open) {
      if (event.key === 'ArrowRight') { event.preventDefault(); stepPhoto(1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); stepPhoto(-1); }
      return;
    }
    if (event.key.length === 1) {
      typed = (typed + event.key.toLowerCase()).slice(-12);
      if (typed.endsWith('leonida')) { applyTheme('leonida', true); typed = ''; }
      if (typed.endsWith('lagosta')) { lobsterRain(); typed = ''; }
    }
  });

  // Beat original, sintetizado no próprio navegador; só começa após um clique.
  let audioContext;
  let radioPlaying = false;
  let radioStarting = false;
  let radioTimer;
  let audioMaster;
  let step = 0;
  let nextNote = 0;
  const activeVoices = new Set();
  const midiHz = note => 440 * Math.pow(2, (note - 69) / 12);
  function tone(frequency, time, duration, volume, type = 'sine') {
    const oscillator = audioContext.createOscillator();
    const envelope = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(volume, time + 0.015);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(envelope);
    envelope.connect(audioMaster);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.01);
    activeVoices.add(oscillator);
    oscillator.onended = () => { activeVoices.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); };
  }
  function scheduleRadio() {
    if (!radioPlaying) return;
    const chords = [[48, 51, 55], [44, 48, 51], [51, 55, 58], [46, 50, 53]];
    while (nextNote < audioContext.currentTime + 0.15) {
      const chord = chords[Math.floor(step / 16) % 4];
      const local = step % 16;
      if (local % 2 === 0) tone(midiHz(chord[(local / 2) % 3] + 12), nextNote, 0.24, 0.075, 'triangle');
      if (local % 4 === 0) { tone(midiHz(chord[0] - 12), nextNote, 0.35, 0.17, 'sine'); tone(65, nextNote, 0.11, 0.11, 'sine'); }
      if (local === 0) chord.forEach(note => tone(midiHz(note + 12), nextNote, 1.8, 0.022, 'triangle'));
      if (local % 4 === 2) tone(620, nextNote, 0.035, 0.017, 'triangle');
      nextNote += 60 / 108 / 2;
      step += 1;
    }
    radioTimer = setTimeout(scheduleRadio, 30);
  }
  function updateRadioUi() {
    document.body.classList.toggle('radio-on', radioPlaying);
    $('#radio-toggle').setAttribute('aria-pressed', String(radioPlaying));
    $('#radio-toggle').innerHTML = `${icon(radioPlaying ? 'pause' : 'play')}<span>${radioPlaying ? 'Pausar som' : 'Ligar o som'}</span>`;
    $('#radio-status').textContent = radioPlaying ? 'agora tocando: intervalo em Leonida' : 'um synth pra acompanhar o scroll';
  }
  function stopRadio() {
    radioPlaying = false;
    clearTimeout(radioTimer);
    activeVoices.forEach(voice => { try { voice.stop(); } catch { /* Já terminou. */ } });
    activeVoices.clear();
    updateRadioUi();
  }
  $('#radio-toggle').addEventListener('click', async () => {
    if (radioPlaying) { stopRadio(); return; }
    if (radioStarting) return;
    radioStarting = true;
    $('#radio-toggle').disabled = true;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error('Audio indisponível');
      if (!audioContext) { audioContext = new Context(); audioMaster = audioContext.createGain(); audioMaster.gain.value = 0.38; audioMaster.connect(audioContext.destination); }
      await audioContext.resume();
      if (document.hidden) return;
      radioPlaying = true;
      step = 0;
      nextNote = audioContext.currentTime + 0.04;
      updateRadioUi();
      scheduleRadio();
    } catch { notify('O navegador não liberou o som. Tenta de novo.'); }
    finally { radioStarting = false; $('#radio-toggle').disabled = false; }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && radioPlaying) stopRadio(); });
  renderGallery();
})();
