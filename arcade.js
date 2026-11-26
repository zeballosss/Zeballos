(() => {
  'use strict';
  const section = document.querySelector('#recreio');
  if (!section) return;
  const $ = selector => section.querySelector(selector);
  const $$ = selector => [...section.querySelectorAll(selector)];
  const store = {
    read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Jogar continua possível sem armazenamento. */ } }
  };
  function shuffle(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  const tabs = $$('.arcade-tab');
  const panels = $$('.arcade-panel');
  function activateTab(tab, focus = false) {
    tabs.forEach(item => {
      item.setAttribute('aria-selected', String(item === tab));
      item.tabIndex = item === tab ? 0 : -1;
    });
    panels.forEach(panel => { panel.hidden = panel.id !== tab.getAttribute('aria-controls'); });
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', event => {
      let target;
      if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') target = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') target = 0;
      if (event.key === 'End') target = tabs.length - 1;
      if (target === undefined) return;
      event.preventDefault();
      activateTab(tabs[target], true);
    });
  });

  const bingoKey = 'zeballos-arcade-bingo-v1';
  const bingoScenes = [
    'O sinal tocou', 'O PC travou', 'Cadê o cabo?', 'Faltou salvar',
    'A sala riu', 'Acabou a tinta', 'A aba tinha som', 'Esqueceu a senha',
    'O mouse sumiu', 'Tá em qual sala?', 'Era pra hoje?', 'Abriu 20 abas',
    'O slide não abriu', 'O código rodou', 'O código parou', 'Bateu o sono',
    'Deu tela azul', 'Mudou o lugar', 'Cadê o arquivo?', 'Pediram silêncio',
    'A fila andou', 'Foi sem querer', 'Deu erro de novo', 'Chegou no sinal',
    'O grupo acordou', 'Alguém fez meme', 'O áudio vazou', 'Sumiu o pen drive',
    'Sem cabo HDMI', 'Riu sem motivo', 'Faltou o estojo', 'O intervalo voou'
  ];
  const bingoLines = [
    [0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15],
    [0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15],
    [0, 5, 10, 15], [3, 6, 9, 12]
  ];
  const persistedBingo = store.read(bingoKey, null);
  const validDeck = Array.isArray(persistedBingo?.deck) && persistedBingo.deck.length === 16 && new Set(persistedBingo.deck).size === 16 && persistedBingo.deck.every(id => Number.isInteger(id) && id >= 0 && id < bingoScenes.length);
  let bingoDeck = validDeck ? persistedBingo.deck : shuffle(bingoScenes.map((_, index) => index)).slice(0, 16);
  let bingoMarks = new Set(validDeck && Array.isArray(persistedBingo.marks) ? persistedBingo.marks.filter(id => bingoDeck.includes(id)) : []);
  function saveBingo() { store.write(bingoKey, { deck: bingoDeck, marks: [...bingoMarks] }); }
  function updateBingo(message = '') {
    const lines = bingoLines.filter(line => line.every(index => bingoMarks.has(bingoDeck[index])));
    const winningPositions = new Set(lines.flat());
    $$('.bingo-square').forEach((button, index) => {
      const marked = bingoMarks.has(bingoDeck[index]);
      button.setAttribute('aria-pressed', String(marked));
      button.classList.toggle('bingo-winning', winningPositions.has(index));
    });
    const status = $('#bingo-status');
    status.classList.toggle('is-success', lines.length > 0);
    status.textContent = lines.length > 0 ? `BINGO! ${lines.length === 1 ? 'Uma sequência fechada' : `${lines.length} sequências fechadas`}. A sala entregou tudo.` : `${message ? `${message} ` : ''}${bingoMarks.size} de 16 marcados. Falta a sala colaborar.`;
    saveBingo();
  }
  function drawBingo(message = '') {
    const fragment = document.createDocumentFragment();
    bingoDeck.forEach((id, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bingo-square';
      button.textContent = bingoScenes[id];
      button.setAttribute('aria-label', `Linha ${Math.floor(index / 4) + 1}, coluna ${index % 4 + 1}: ${bingoScenes[id]}`);
      button.addEventListener('click', () => {
        if (bingoMarks.has(id)) bingoMarks.delete(id);
        else bingoMarks.add(id);
        updateBingo();
      });
      fragment.append(button);
    });
    $('#bingo-board').replaceChildren(fragment);
    updateBingo(message);
  }
  $('#bingo-clear').addEventListener('click', () => { bingoMarks.clear(); updateBingo('Marcações limpas.'); });
  $('#bingo-new').addEventListener('click', () => {
    bingoDeck = shuffle(bingoScenes.map((_, index) => index)).slice(0, 16);
    bingoMarks = new Set();
    drawBingo('Cartela nova na mesa.');
  });
  drawBingo();

  const memoryKey = 'zeballos-arcade-memory-best-v1';
  const memorySymbols = [
    { emoji: '🦞', name: 'lagosta' }, { emoji: '🎮', name: 'controle de videogame' },
    { emoji: '🍕', name: 'pizza' }, { emoji: '🚀', name: 'foguete' },
    { emoji: '⚡', name: 'raio' }, { emoji: '☕', name: 'café' },
    { emoji: '🌴', name: 'palmeira' }, { emoji: '👽', name: 'alienígena' }
  ];
  const savedBest = store.read(memoryKey, null);
  let memoryBest = Number.isInteger(savedBest) && savedBest >= 8 && savedBest <= 999999 ? savedBest : null;
  let memoryDeck = [];
  let memoryOpen = [];
  let memoryMatched = new Set();
  let memoryMoves = 0;
  let memoryLocked = false;
  let memoryTimer;
  let memoryRound = 0;
  function updateMemory() {
    [...$('#memory-board').children].forEach((button, index) => {
      const matched = memoryMatched.has(index);
      const faceUp = matched || memoryOpen.includes(index);
      const symbol = memorySymbols[memoryDeck[index]];
      button.classList.toggle('is-open', faceUp);
      button.classList.toggle('is-match', matched);
      button.setAttribute('aria-disabled', String(matched || faceUp || memoryLocked));
      button.tabIndex = matched ? -1 : 0;
      button.setAttribute('aria-label', `Carta ${index + 1}: ${matched ? `par de ${symbol.name} encontrado` : faceUp ? symbol.name : 'fechada'}`);
      button.firstElementChild.textContent = faceUp ? symbol.emoji : '✳';
    });
    $('#memory-moves').textContent = memoryMoves;
    $('#memory-pairs').textContent = `${memoryMatched.size / 2} / 8`;
    $('#memory-best').textContent = memoryBest === null ? '—' : `${memoryBest} jogadas`;
  }
  function flipMemory(index) {
    if (memoryLocked || memoryMatched.has(index) || memoryOpen.includes(index)) return;
    memoryOpen.push(index);
    updateMemory();
    if (memoryOpen.length === 1) {
      $('#memory-status').textContent = `Abriu ${memorySymbols[memoryDeck[index]].name}. Cadê o par?`;
      return;
    }
    memoryMoves += 1;
    const [first, second] = memoryOpen;
    if (memoryDeck[first] === memoryDeck[second]) {
      memoryMatched.add(first);
      memoryMatched.add(second);
      memoryOpen = [];
      if (memoryMatched.size === 16) {
        const improved = memoryBest === null || memoryMoves < memoryBest;
        if (improved) { memoryBest = memoryMoves; store.write(memoryKey, memoryBest); }
        $('#memory-status').textContent = `Fechou os oito pares em ${memoryMoves} jogadas.${improved ? ' Novo recorde neste navegador!' : ' A memória tá em dia.'}`;
        $('#memory-status').classList.add('is-success');
      } else $('#memory-status').textContent = `Par encontrado. ${memoryMatched.size / 2} de 8 na conta.`;
      updateMemory();
      return;
    }
    memoryLocked = true;
    $('#memory-status').textContent = 'Não foi esse par. Guarda onde estavam.';
    updateMemory();
    const scheduledRound = memoryRound;
    memoryTimer = setTimeout(() => {
      if (scheduledRound !== memoryRound) return;
      memoryOpen = [];
      memoryLocked = false;
      updateMemory();
      $('#memory-status').textContent = 'Pode escolher mais duas.';
    }, 850);
  }
  function resetMemory(announce = false) {
    clearTimeout(memoryTimer);
    memoryRound += 1;
    memoryDeck = shuffle(memorySymbols.flatMap((_, index) => [index, index]));
    memoryOpen = [];
    memoryMatched = new Set();
    memoryMoves = 0;
    memoryLocked = false;
    const fragment = document.createDocumentFragment();
    memoryDeck.forEach((_, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'memory-card';
      const symbol = document.createElement('span');
      symbol.className = 'memory-symbol';
      symbol.setAttribute('aria-hidden', 'true');
      button.append(symbol);
      button.addEventListener('click', () => flipMemory(index));
      fragment.append(button);
    });
    $('#memory-board').replaceChildren(fragment);
    $('#memory-status').classList.remove('is-success');
    $('#memory-status').textContent = announce ? 'Cartas misturadas. Agora vai.' : 'Escolha uma carta pra começar.';
    updateMemory();
  }
  $('#memory-reset').addEventListener('click', () => resetMemory(true));
  resetMemory();

  const quizQuestions = [
    { text: 'O trabalho é pra amanhã. Você abre a pasta e…', answers: [
      ['doge', 'Manda um “vai dar bom” e começa.'],
      ['patrick', 'Abre o arquivo errado antes de achar o certo.'],
      ['stonks', 'Divide em etapas e faz uma lista.'],
      ['fine', 'Faz um café. A noite promete.']
    ] },
    { text: 'O intervalo começou. Qual é a primeira missão?', answers: [
      ['patrick', 'Descobrir por que todo mundo já saiu.'],
      ['stonks', 'Calcular o melhor lanche pelo preço.'],
      ['fine', 'Sentar dois minutos. Só dois.'],
      ['doge', 'Encontrar a galera e ver no que dá.']
    ] },
    { text: 'Você acabou de mandar uma figurinha no grupo.', answers: [
      ['stonks', 'Foi na hora certa. Investimento aprovado.'],
      ['fine', 'Agora é torcer pra terem entendido.'],
      ['doge', 'Já tá rindo antes de alguém responder.'],
      ['patrick', 'Era outro grupo. Acontece.']
    ] },
    { text: 'O código rodou de primeira. Sua reação?', answers: [
      ['fine', 'Não toca em nada. Só salva.'],
      ['doge', 'Pequena comemoração no lugar.'],
      ['patrick', 'Confere se abriu o projeto certo.'],
      ['stonks', 'Print, backup e próximo objetivo.']
    ] },
    { text: 'A foto da turma saiu tremida. E agora?', answers: [
      ['doge', 'Essa mesmo. Ficou com a nossa cara.'],
      ['fine', 'Pelo menos todo mundo apareceu.'],
      ['stonks', 'Recorta, enquadra e chama de estilo.'],
      ['patrick', 'Eu tava olhando pra câmera errada.']
    ] }
  ];
  const quizResults = {
    doge: { icon: '🐕', title: 'Doge', description: 'Muito entusiasmo. Pouco contexto. Seu meme chegou com um “vai dar bom” e puxou uma cadeira pra todo mundo.' },
    patrick: { icon: '⭐', title: 'Patrick', description: 'O pensamento fez um caminho alternativo e chegou com uma boa história. Talvez a pergunta fosse outra, mas a resposta ficou ótima.' },
    stonks: { icon: '📈', title: 'Stonks', description: 'Até o lanche virou uma operação estratégica. Seu meme trouxe uma planilha imaginária e saiu achando que fez um grande negócio.' },
    fine: { icon: '☕', title: 'This Is Fine', description: 'O prazo aperta, a aba trava, e o café segue firme. Seu meme respirou fundo e decidiu resolver uma coisa de cada vez.' }
  };
  let quizIndex = 0;
  let quizChoices = Array(quizQuestions.length).fill(null);
  function renderQuiz(focus = false) {
    const question = quizQuestions[quizIndex];
    $('#quiz-step').textContent = `Pergunta ${quizIndex + 1} de ${quizQuestions.length}`;
    $('#quiz-progress').value = quizChoices.filter(Boolean).length;
    $('#quiz-question').textContent = question.text;
    const fragment = document.createDocumentFragment();
    question.answers.forEach(([key, text]) => {
      const label = document.createElement('label');
      label.className = 'quiz-answer';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'arcade-meme-answer';
      input.value = key;
      input.checked = quizChoices[quizIndex] === key;
      const copy = document.createElement('span');
      copy.textContent = text;
      input.addEventListener('change', () => {
        quizChoices[quizIndex] = key;
        $('#quiz-next').disabled = false;
        $('#quiz-progress').value = quizChoices.filter(Boolean).length;
      });
      label.append(input, copy);
      fragment.append(label);
    });
    $('#quiz-answers').replaceChildren(fragment);
    $('#quiz-back').disabled = quizIndex === 0;
    $('#quiz-next').disabled = quizChoices[quizIndex] === null;
    $('#quiz-next').textContent = quizIndex === quizQuestions.length - 1 ? 'Ver meu meme' : 'Próxima pergunta';
    if (focus) $('#quiz-question').focus({ preventScroll: true });
  }
  function showQuizResult() {
    if (quizChoices.some(choice => !choice)) return;
    const scores = { doge: 0, patrick: 0, stonks: 0, fine: 0 };
    quizChoices.forEach(key => { scores[key] += 1; });
    const highest = Math.max(...Object.values(scores));
    // Num empate, a resposta mais recente entre os memes empatados decide.
    const resultKey = [...quizChoices].reverse().find(key => scores[key] === highest);
    const result = quizResults[resultKey];
    $('#quiz-result-icon').textContent = result.icon;
    const memeId = resultKey === 'fine' ? 'this-is-fine' : resultKey;
    const meme = (window.MEMES_DATA || []).find(item => item.id === memeId);
    $('#quiz-result-icon').classList.toggle('has-meme', Boolean(meme));
    if (meme) {
      const image = document.createElement('img');
      image.src = meme.src;
      image.alt = '';
      $('#quiz-result-icon').replaceChildren(image);
    }
    $('#quiz-result-title').textContent = result.title;
    $('#quiz-result-description').textContent = result.description;
    $('#quiz-play').hidden = true;
    $('#quiz-result').hidden = false;
    $('#quiz-result-title').focus({ preventScroll: true });
  }
  $('#quiz-back').addEventListener('click', () => { if (quizIndex > 0) { quizIndex -= 1; renderQuiz(true); } });
  $('#quiz-next').addEventListener('click', () => {
    if (quizChoices[quizIndex] === null) return;
    if (quizIndex < quizQuestions.length - 1) { quizIndex += 1; renderQuiz(true); }
    else showQuizResult();
  });
  $('#quiz-review').addEventListener('click', () => {
    $('#quiz-result').hidden = true;
    $('#quiz-play').hidden = false;
    quizIndex = quizQuestions.length - 1;
    renderQuiz(true);
  });
  $('#quiz-restart').addEventListener('click', () => {
    quizChoices = Array(quizQuestions.length).fill(null);
    quizIndex = 0;
    $('#quiz-result').hidden = true;
    $('#quiz-play').hidden = false;
    renderQuiz(true);
  });
  renderQuiz();
})();
