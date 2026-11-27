/* Contrato: community/schema.sql e community/SETUP.md.
 * O navegador usa apenas a chave pública. Permissões e limites são do servidor.
 * SDK fixado na versão 2.119.2; sem configuração não há SDK, login ou envio falso.
 */
(async () => {
  'use strict';
  const section = document.getElementById('comunidade');
  const app = document.getElementById('community-app');
  const notice = document.getElementById('community-notice');
  if (!section || !app || !notice) return;
  const config = window.COMMUNITY_CONFIG;
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm';
  const BUCKET = 'community-photos';
  const PAGE_SIZE = 24;
  const MAX_INPUT = 10 * 1024 * 1024;
  const MAX_OUTPUT = 2 * 1024 * 1024;
  const MAX_PIXELS = 25000000;
  const state = { client: null, user: null, profile: null, mode: 'public', rows: new Map(), cursor: null, more: false,
    feedBusy: false, feedEpoch: 0, identityEpoch: 0, selectionEpoch: 0, prepared: null, previewUrl: null,
    preparing: false, uploading: false, authBusy: false, nicknameUser: null };

  function message(node, text, tone = '') {
    node.textContent = text;
    node.dataset.tone = tone;
  }
  function validConfig(value) {
    if (!value || typeof value.url !== 'string' || typeof value.publishableKey !== 'string') return false;
    try {
      const url = new URL(value.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return false;
      const key = value.publishableKey.trim();
      if (key.startsWith('sb_publishable_') && key.length > 30) return true;
      const payload = key.split('.')[1];
      if (!payload) return false;
      return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon';
    } catch { return false; }
  }
  if (!validConfig(config)) {
    message(notice, 'O envio de fotos ainda está sendo preparado. Por enquanto, aproveita a galeria da Etec.');
    return;
  }

  let createClient;
  try {
    ({ createClient } = await import(SDK_URL));
    state.client = createClient(config.url.trim(), config.publishableKey.trim(), {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
    });
  } catch {
    message(notice, 'A comunidade não conseguiu conectar agora. Recarregue a página para tentar de novo.', 'error');
    return;
  }
  const client = state.client;
  app.innerHTML = `
    <div class="cm-account">
      <div class="cm-account-copy"><strong id="cm-account-title">Sua câmera também conta essa história.</strong><p id="cm-account-note">Entre para publicar. Ver as fotos é livre.</p></div>
      <div class="cm-actions"><button type="button" class="cm-button cm-button-filled" id="cm-login">Entrar / criar conta</button><button type="button" class="cm-button" id="cm-admin-toggle" aria-pressed="false" hidden>Administrar</button><button type="button" class="cm-button" id="cm-logout" hidden>Sair</button></div>
    </div>
    <form class="cm-upload" id="cm-upload" hidden>
      <h3>Mais uma pro álbum.</h3><p class="cm-note">Sua foto aparece no mural assim que o envio termina.</p>
      <div class="cm-upload-grid"><div>
        <label class="cm-field" for="cm-file">Escolha uma foto<input id="cm-file" name="photo" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="cm-file-help"></label>
        <p class="cm-file-help" id="cm-file-help">JPG, PNG ou WebP · até 10 MB. A foto será reduzida antes do envio.</p>
        <label class="cm-field" for="cm-nickname">Seu nome no mural<input id="cm-nickname" name="nickname" type="text" minlength="2" maxlength="40" autocomplete="nickname" required></label>
        <label class="cm-field" for="cm-caption">Descrição (opcional)<textarea id="cm-caption" name="caption" maxlength="140" rows="3" placeholder="o contexto a gente perdeu"></textarea></label>
        <p class="cm-upload-count" id="cm-caption-count">0 / 140</p>
      </div><div class="cm-preview"><img id="cm-preview" alt="Prévia da foto que você escolheu; ainda não publicada" hidden><span class="cm-preview-empty" id="cm-preview-empty">Sua foto aparece aqui antes de publicar.</span></div></div>
      <div class="cm-rules"><p>Compartilhe só fotos que você pode publicar, com autorização de quem aparece. Sem dados pessoais, intimidade ou ataques.</p><p>Spam, fotos repetidas ou envios feitos só para lotar a galeria podem resultar em bloqueio da conta.</p><p class="cm-note">Limite de 3 envios por hora e 10 por dia.</p></div>
      <label class="cm-consent"><input id="cm-consent" type="checkbox" required><span>Tenho autorização para publicar esta foto e aceito as regras do mural.</span></label>
      <div class="cm-actions"><button class="cm-button cm-button-filled" id="cm-publish" type="submit" disabled>Publicar foto</button><button class="cm-button" id="cm-clear" type="button">Limpar seleção</button></div>
      <p class="cm-status" id="cm-upload-status" role="status" aria-live="polite"></p>
    </form>
    <div class="cm-feed-tools"><h3 id="cm-feed-title">O mural da galera</h3><button class="cm-button" type="button" id="cm-refresh">Atualizar fotos</button></div>
    <p class="cm-status" id="cm-feed-status" role="status" aria-live="polite"></p>
    <div class="cm-feed-grid" id="cm-feed" aria-busy="true"></div>
    <div class="cm-feed-footer"><button type="button" class="cm-button" id="cm-more" hidden>Ver mais fotos</button></div>
    <dialog class="cm-dialog" id="cm-auth-dialog" aria-labelledby="cm-auth-title">
      <div class="cm-dialog-top"><div><h3 id="cm-auth-title">Entre com Google.</h3><p class="cm-note">Seu e-mail não aparece no mural. Só o nome que você escolher.</p></div><button class="cm-dialog-close" type="button" data-cm-close aria-label="Fechar login">×</button></div>
      <button class="cm-button cm-google" id="cm-google" type="button">Continuar com Google</button>
      <p class="cm-status" id="cm-auth-status" role="status" aria-live="polite"></p>
    </dialog>
    <dialog class="cm-dialog cm-viewer" id="cm-viewer" aria-labelledby="cm-viewer-title">
      <div class="cm-dialog-top"><h3 id="cm-viewer-title">Uma foto do mural.</h3><button class="cm-dialog-close" type="button" data-cm-close aria-label="Fechar foto">×</button></div>
      <p class="cm-status" id="cm-viewer-status" role="status"></p><img id="cm-viewer-image" alt="" hidden><p class="cm-viewer-caption" id="cm-viewer-caption"></p><p class="cm-viewer-author" id="cm-viewer-author"></p><button class="cm-button" type="button" id="cm-report" hidden>Denunciar foto</button><p class="cm-note" id="cm-report-note" hidden>10 denúncias de contas diferentes ocultam a foto até revisão.</p>
    </dialog>
    <dialog class="cm-dialog" id="cm-confirm-dialog" aria-labelledby="cm-confirm-title">
      <div class="cm-dialog-top"><h3 id="cm-confirm-title">Confirmar ação</h3><button class="cm-dialog-close" type="button" data-cm-close aria-label="Cancelar ação">×</button></div>
      <form id="cm-confirm-form"><p id="cm-confirm-copy"></p><label class="cm-field" for="cm-confirm-reason" id="cm-confirm-reason-field">Motivo<input id="cm-confirm-reason" type="text" maxlength="180"></label><div class="cm-actions"><button class="cm-button" type="button" id="cm-confirm-cancel">Cancelar</button><button class="cm-button cm-button-danger" type="submit" id="cm-confirm-action">Confirmar</button></div></form>
    </dialog>`;
  const $ = id => document.getElementById(id);
  const ui = Object.fromEntries(['account-title','account-note','login','logout','admin-toggle','upload','file','nickname','caption','caption-count','preview','preview-empty','consent','publish','clear','upload-status','feed-title','refresh','feed-status','feed','more','auth-dialog','auth-title','auth-status','google','viewer','viewer-status','viewer-image','viewer-caption','viewer-author','report','report-note','confirm-dialog','confirm-title','confirm-copy','confirm-reason-field','confirm-reason','confirm-form','confirm-cancel','confirm-action'].map(id => [id, $('cm-' + id)]));
  const redirectUrl = () => location.origin + location.pathname + '#comunidade';
  const isAdmin = () => state.profile?.is_admin === true;
  const mayUpload = () => Boolean(state.user && state.profile && !state.profile.is_banned);
  const one = data => Array.isArray(data) ? data[0] : data;
  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }
  function friendlyError(error, fallback = 'Não deu certo agora. Confira a conexão e tente novamente.') {
    const code = String(error?.code || '').toLowerCase();
    const detail = String(error?.message || '').toLowerCase();
    const communityErrors = {
      community_auth_required: 'Entre na sua conta para continuar.',
      community_write_forbidden: 'Esta conta não pode enviar agora. Confira a confirmação do e-mail ou um possível bloqueio.',
      community_busy_try_again: 'Já tem uma ação desta conta em andamento. Aguarde um instante e tente novamente.',
      community_invalid_text: 'Confira o nome e a legenda. Retire caracteres invisíveis e respeite os limites.',
      community_hourly_limit: 'Você já fez 3 envios nesta hora. Tente mais tarde.',
      community_daily_limit: 'Você já fez 10 envios nas últimas 24 horas. Tente mais tarde.',
      community_reservation_expired_or_removed: 'Este envio expirou ou foi removido. Escolha a foto de novo.',
      community_upload_not_found: 'O arquivo não terminou de chegar. Confira a conexão antes de tentar novamente.',
      community_invalid_upload: 'O arquivo não foi aceito. Escolha um JPG, PNG ou WebP válido e tente de novo.',
      community_invalid_upload_size: 'O arquivo ficou maior que o limite. Escolha uma versão menor.',
      community_admin_required: 'Só o administrador pode fazer essa alteração.',
      community_cannot_ban_self: 'Você não pode bloquear a própria conta por aqui.'
      ,community_cannot_report_self: 'Você não pode denunciar sua própria foto.'
      ,community_already_reported: 'Você já denunciou esta foto.'
      ,community_report_limit: 'Limite de 5 denúncias em 24 horas. Tente mais tarde.'
    };
    if (communityErrors[detail]) return communityErrors[detail];
    if (code === 'invalid_credentials') return 'E-mail ou senha não conferem.';
    if (code === 'email_not_confirmed' || detail.includes('email_not_confirmed')) return 'Confirme seu e-mail antes de enviar fotos.';
    if (code.includes('rate_limit') || detail.includes('quota') || detail.includes('rate limit') || detail.includes('upload_limit')) return 'O limite de envios foi atingido. Tente mais tarde.';
    if (detail.includes('banned') || detail.includes('banido') || detail.includes('bloquead')) return 'Esta conta está bloqueada para enviar fotos.';
    if (code === 'weak_password') return 'Escolha uma senha mais forte, com pelo menos 8 caracteres.';
    if (code === 'signup_disabled') return 'Novos cadastros estão indisponíveis no momento.';
    return fallback;
  }
  function showDialog(dialog) { if (!dialog.open) dialog.showModal(); }
  function renderIdentity() {
    ui.login.hidden = Boolean(state.user) || config.allowGoogle !== true;
    ui.logout.hidden = !state.user;
    ui['admin-toggle'].hidden = !isAdmin();
    ui.upload.hidden = !mayUpload();
    ui['account-title'].textContent = !state.user ? 'Sua câmera também conta essa história.' : !state.profile ? 'Conferindo sua conta…' : state.profile.is_banned ? 'Sua conta não pode enviar fotos.' : `Chegou, ${state.profile.display_name || 'alguém do intervalo'}.`;
    ui['account-note'].textContent = !state.user ? config.allowGoogle === true ? 'Entre com Google para publicar. Ver as fotos é livre.' : 'O envio está sendo preparado. Ver as fotos é livre.' : !state.profile ? 'A publicação depende da verificação da sua conta.' : state.profile.is_banned ? 'O envio está bloqueado. Você ainda pode sair da conta.' : isAdmin() ? 'Você também pode administrar os envios do mural.' : 'Escolha uma foto. A publicação aparece direto no mural.';
    if (state.user && state.nicknameUser !== state.user.id && state.profile) {
      ui.nickname.value = state.profile.display_name || '';
      state.nicknameUser = state.user.id;
    }
    updatePublishButton();
  }
  async function refreshIdentity() {
    const epoch = ++state.identityEpoch;
    const userId = state.user?.id;
    state.profile = null;
    renderIdentity();
    if (userId) {
      try {
        const profile = one(await rpc('community_session_info'));
        if (epoch !== state.identityEpoch || state.user?.id !== userId) return;
        if (!profile || profile.uid !== userId) throw new Error('invalid_profile');
        state.profile = profile;
      } catch {
        if (epoch !== state.identityEpoch) return;
        message(notice, 'Não foi possível verificar sua conta. Use Atualizar fotos para tentar novamente.', 'error');
      }
    } else clearSelection();
    if (epoch !== state.identityEpoch) return;
    if (!isAdmin() && state.mode === 'admin') state.mode = 'public';
    renderIdentity();
    await loadFeed(true);
  }

  ui.login.addEventListener('click', () => { message(ui['auth-status'], ''); showDialog(ui['auth-dialog']); });
  app.querySelectorAll('[data-cm-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  ui.google.addEventListener('click', async () => {
    if (config.allowGoogle !== true || state.authBusy) return;
    state.authBusy = true; ui.google.disabled = true;
    try { const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectUrl() } }); if (error) throw error; }
    catch (error) { message(ui['auth-status'], friendlyError(error, 'Não foi possível abrir o Google agora.'), 'error'); }
    finally { state.authBusy = false; ui.google.disabled = false; }
  });
  ui.logout.addEventListener('click', async () => {
    ui.logout.disabled = true;
    try { const { error } = await client.auth.signOut(); if (error) throw error; message(notice, 'Você saiu da conta.'); }
    catch { message(notice, 'Não foi possível sair agora. Tente novamente.', 'error'); }
    finally { ui.logout.disabled = false; }
  });

  function imageHeader(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const chars = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
    if (bytes.length >= 24 && bytes[0] === 137 && chars(1, 3) === 'PNG' && chars(12, 4) === 'IHDR') return { type: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
    if (bytes.length >= 30 && chars(0, 4) === 'RIFF' && chars(8, 4) === 'WEBP') {
      const kind = chars(12, 4);
      if (kind === 'VP8X') {
        if (bytes[20] & 2) throw new Error('Use uma foto parada; WebP animado não entra no mural.');
        return { type: 'image/webp', width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
      }
      if (kind === 'VP8L' && bytes[20] === 47) { const bits = view.getUint32(21, true); return { type: 'image/webp', width: (bits & 16383) + 1, height: ((bits >>> 14) & 16383) + 1 }; }
      if (kind === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) return { type: 'image/webp', width: view.getUint16(26, true) & 16383, height: view.getUint16(28, true) & 16383 };
    }
    if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) {
      let offset = 2;
      while (offset + 8 < bytes.length) {
        if (bytes[offset++] !== 255) break;
        while (bytes[offset] === 255) offset++;
        const marker = bytes[offset++];
        if (marker === 217 || marker === 218) break;
        if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
        if (offset + 2 > bytes.length) break;
        const length = view.getUint16(offset);
        if (length < 2 || offset + length > bytes.length) break;
        if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) return { type: 'image/jpeg', width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
        offset += length;
      }
    }
    throw new Error('Não consegui ler essa imagem. Use um JPG, PNG ou WebP válido.');
  }
  async function prepareImage(file) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Use JPG, PNG ou WebP. SVG, GIF e HEIC não são aceitos.');
    if (!file.size || file.size > MAX_INPUT) throw new Error('Escolha uma foto de até 10 MB.');
    const header = imageHeader(new Uint8Array(await file.arrayBuffer()));
    if (header.type !== file.type) throw new Error('O formato do arquivo não confere. Exporte a foto como JPG, PNG ou WebP.');
    if (!header.width || !header.height || header.width * header.height > MAX_PIXELS) throw new Error('Essa imagem é grande demais. Exporte com até 25 megapixels.');
    let image; let sourceUrl;
    try {
      if ('createImageBitmap' in window) image = await createImageBitmap(file, { imageOrientation: 'from-image' });
      else {
        sourceUrl = URL.createObjectURL(file);
        image = new Image(); image.src = sourceUrl;
        await image.decode();
      }
      const width = image.width || image.naturalWidth;
      const height = image.height || image.naturalHeight;
      if (!width || !height || width * height > MAX_PIXELS) throw new Error('Essa imagem é grande demais. Exporte com até 25 megapixels.');
      let maxSide = 1600;
      for (let attempt = 0; attempt < 4; attempt++) {
        const scale = Math.min(1, maxSide / Math.max(width, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Este navegador não conseguiu preparar a foto.');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .82));
        canvas.width = canvas.height = 1;
        if (!blob || blob.type !== 'image/webp') throw new Error('Seu navegador não conseguiu converter a foto. Tente um navegador atualizado.');
        if (blob.size <= MAX_OUTPUT) return blob;
        maxSide = Math.round(maxSide * .75);
      }
      throw new Error('A foto ainda ficou muito pesada. Escolha uma versão menor.');
    } finally { if (image?.close) image.close(); if (sourceUrl) URL.revokeObjectURL(sourceUrl); }
  }
  function updatePublishButton() {
    ui.publish.disabled = !mayUpload() || !state.prepared || !ui.consent.checked || state.preparing || state.uploading;
    ui.file.disabled = state.uploading;
    ui.clear.disabled = state.uploading;
    ui.publish.textContent = state.uploading ? 'Publicando…' : state.preparing ? 'Preparando a foto…' : 'Publicar foto';
  }
  function clearSelection(keepFile = false) {
    ++state.selectionEpoch;
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null; state.prepared = null; state.preparing = false;
    if (!keepFile) ui.file.value = '';
    ui.preview.removeAttribute('src'); ui.preview.hidden = true; ui['preview-empty'].hidden = false;
    ui.consent.checked = false;
    updatePublishButton();
  }
  ui.file.addEventListener('change', async () => {
    const file = ui.file.files?.[0];
    clearSelection(true);
    if (!file) return;
    const epoch = ++state.selectionEpoch;
    state.preparing = true; updatePublishButton();
    message(ui['upload-status'], 'Preparando sua foto. Ela ainda não foi enviada.');
    try {
      const blob = await prepareImage(file);
      if (epoch !== state.selectionEpoch) return;
      state.prepared = blob; state.previewUrl = URL.createObjectURL(blob);
      ui.preview.src = state.previewUrl; ui.preview.hidden = false; ui['preview-empty'].hidden = true;
      message(ui['upload-status'], 'Prévia pronta. Confira a foto antes de publicar.');
    } catch (error) { if (epoch === state.selectionEpoch) message(ui['upload-status'], error.message || 'Não consegui preparar essa foto.', 'error'); }
    finally { if (epoch === state.selectionEpoch) { state.preparing = false; updatePublishButton(); } }
  });
  ui.clear.addEventListener('click', () => { clearSelection(); message(ui['upload-status'], 'Seleção limpa.'); });
  ui.consent.addEventListener('change', updatePublishButton);
  ui.caption.addEventListener('input', () => { ui['caption-count'].textContent = `${ui.caption.value.length} / 140`; });
  ui.upload.addEventListener('submit', async event => {
    event.preventDefault();
    if (!mayUpload() || !state.prepared || !ui.consent.checked || state.uploading || state.preparing) return;
    // O arquivo já foi validado e convertido. As permissões são conferidas de novo no servidor.
    if (!ui.nickname.reportValidity() || !ui.caption.reportValidity() || !ui.consent.reportValidity()) return;
    const nickname = ui.nickname.value.replace(/\s+/gu, ' ').trim();
    const caption = ui.caption.value.replace(/\s+/gu, ' ').trim();
    if (nickname.length < 2 || nickname.length > 40 || caption.length > 140) { message(ui['upload-status'], 'Use um nome de 2 a 40 caracteres e uma legenda de até 140.', 'error'); return; }
    if (/[\u0000-\u001f\u007f-\u009f]/u.test(nickname + caption)) { message(ui['upload-status'], 'Retire os caracteres invisíveis do nome ou da legenda.', 'error'); return; }
    const userId = state.user.id; const blob = state.prepared;
    let reservation; let publishing = false;
    state.uploading = true; updatePublishButton(); message(ui['upload-status'], 'Enviando a foto…');
    try {
      const profile = one(await rpc('community_session_info'));
      if (!profile || profile.uid !== userId || state.user?.id !== userId) throw new Error('session_changed');
      state.profile = profile;
      if (profile.is_banned) throw new Error('banned');
      reservation = one(await rpc('reserve_community_photo', { p_caption: caption, p_display_name: nickname }));
      if (!reservation?.id || reservation.object_path !== `${userId}/${reservation.id}.webp`) throw new Error('invalid_reservation');
      if (state.user?.id !== userId) throw new Error('session_changed');
      const { error } = await client.storage.from(BUCKET).upload(reservation.object_path, blob, { contentType: 'image/webp', cacheControl: '60', upsert: false });
      if (error) throw error;
      if (state.user?.id !== userId) throw new Error('session_changed');
      publishing = true;
      const published = one(await rpc('publish_community_photo', { p_photo_id: reservation.id }));
      if (!published?.id) throw new Error('publication_not_confirmed');
      clearSelection(); ui.caption.value = ''; ui['caption-count'].textContent = '0 / 140';
      if (state.profile && state.user?.id === userId) state.profile.display_name = nickname;
      message(ui['upload-status'], 'Foi pro mural. Mais uma pro álbum!');
      await loadFeed(true);
    } catch (error) {
      if (reservation?.id) { try { await rpc('cancel_community_photo', { p_photo_id: reservation.id }); } catch { /* A reserva pode já estar publicada ou expirada. */ } }
      const fallback = publishing ? 'Não foi possível confirmar a publicação. Atualize o mural antes de tentar de novo.' : 'Não foi possível enviar a foto. Confira a conexão e tente novamente.';
      message(ui['upload-status'], friendlyError(error, fallback), 'error');
      if (String(error?.message || '').includes('banned')) await refreshIdentity();
    } finally { state.uploading = false; renderIdentity(); }
  });

  function dateLabel(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(date);
  }
  async function signedUrl(path) {
    const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 60);
    if (error || !data?.signedUrl) throw error || new Error('image_unavailable');
    return data.signedUrl;
  }
  function cardFor(row, url) {
    const card = document.createElement('article'); card.className = 'cm-card';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'cm-card-image';
    button.setAttribute('aria-label', `Ampliar foto de ${row.display_name || 'alguém da galera'}`);
    if (url) {
      const image = document.createElement('img'); image.src = url; image.alt = row.caption || `Foto enviada por ${row.display_name || 'alguém da galera'}`; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', async () => {
        try { image.src = await signedUrl(row.object_path); }
        catch { image.remove(); const hint = document.createElement('span'); hint.textContent = 'Imagem indisponível. Atualize o mural.'; button.append(hint); }
      }, { once: true });
      button.append(image);
    } else { const hint = document.createElement('span'); hint.textContent = 'Imagem indisponível. Tente atualizar.'; button.append(hint); }
    button.addEventListener('click', () => openPhoto(row));
    const copy = document.createElement('div'); copy.className = 'cm-card-copy';
    const meta = document.createElement('div'); meta.className = 'cm-card-meta';
    const name = document.createElement('strong'); name.textContent = `Enviada por ${row.display_name || 'alguém do intervalo'}`;
    const time = document.createElement('time'); const stamp = row.published_at || row.created_at; if (stamp) time.dateTime = stamp; time.textContent = dateLabel(stamp);
    meta.append(name, time); copy.append(meta);
    if (row.caption) { const caption = document.createElement('p'); caption.textContent = row.caption; copy.append(caption); }
    card.append(button, copy);
    if (state.mode === 'admin' && isAdmin()) {
      const status = document.createElement('span'); status.className = 'cm-admin-status';
      status.textContent = `${({ pending: 'Envio incompleto', published: 'Publicada', hidden: 'Oculta por denúncias', removed: 'Removida' })[row.status] || 'Envio'}${row.is_banned ? ' · conta bloqueada' : ''}`; copy.append(status);
      const actions = document.createElement('div'); actions.className = 'cm-card-admin';
      if (row.status === 'hidden') {
        const restore = document.createElement('button'); restore.type = 'button'; restore.className = 'cm-button'; restore.textContent = 'Restaurar foto'; restore.addEventListener('click', () => restorePhoto(row)); actions.append(restore);
      }
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'cm-button cm-button-danger'; remove.textContent = row.status === 'removed' ? 'Limpar arquivo' : 'Remover foto'; remove.addEventListener('click', () => removePhoto(row)); actions.append(remove);
      if (row.owner_id && row.owner_id !== state.user?.id) {
        const ban = document.createElement('button'); ban.type = 'button'; ban.className = 'cm-button'; ban.textContent = row.is_banned ? 'Desbloquear conta' : 'Bloquear conta'; ban.addEventListener('click', () => changeBan(row)); actions.append(ban);
      }
      card.append(actions);
    }
    return card;
  }
  async function loadFeed(reset = false) {
    if (state.feedBusy && !reset) return;
    const epoch = ++state.feedEpoch;
    state.feedBusy = true; ui.feed.setAttribute('aria-busy', 'true'); ui.more.disabled = true;
    ui['admin-toggle'].setAttribute('aria-pressed', String(state.mode === 'admin'));
    ui['admin-toggle'].textContent = state.mode === 'admin' ? 'Voltar ao mural' : 'Administrar';
    ui['feed-title'].textContent = state.mode === 'admin' ? 'Administração do mural' : 'O mural da galera';
    if (reset) { state.cursor = null; state.rows.clear(); ui.feed.replaceChildren(); ui.more.hidden = true; }
    message(ui['feed-status'], 'Carregando fotos…');
    try {
      const admin = state.mode === 'admin' && isAdmin();
      const rows = await rpc(admin ? 'admin_list_community_photos' : 'list_community_photos', {
        p_limit: PAGE_SIZE, p_before: state.cursor?.date || null, p_before_id: state.cursor?.id || null
      });
      if (epoch !== state.feedEpoch) return;
      if (!Array.isArray(rows)) throw new Error('invalid_feed');
      let urls = new Map(); let signedError = false;
      if (rows.length) {
        const { data, error } = await client.storage.from(BUCKET).createSignedUrls(rows.map(row => row.object_path), 60);
        if (epoch !== state.feedEpoch) return;
        signedError = Boolean(error);
        if (!error && data) urls = new Map(data.filter(item => item.signedUrl && !item.error).map(item => [item.path, item.signedUrl]));
      }
      if (epoch !== state.feedEpoch) return;
      rows.forEach(row => { if (!state.rows.has(row.id)) { state.rows.set(row.id, row); ui.feed.append(cardFor(row, urls.get(row.object_path))); } });
      const last = rows.at(-1);
      if (last) state.cursor = { date: admin ? last.created_at : last.published_at, id: last.id };
      state.more = rows.length === PAGE_SIZE; ui.more.hidden = !state.more;
      if (!state.rows.size) {
        const empty = document.createElement('p'); empty.className = 'cm-empty'; empty.textContent = admin ? 'Nenhum envio registrado por enquanto.' : 'O mural está esperando a primeira foto da galera.'; ui.feed.append(empty);
      }
      message(ui['feed-status'], signedError ? 'As fotos foram encontradas, mas as imagens não abriram. Tente atualizar.' : state.rows.size ? `${state.rows.size} ${state.rows.size === 1 ? 'foto no mural' : 'fotos no mural'}${admin ? ' · visão de administrador' : ''}.` : '', signedError ? 'error' : '');
    } catch (error) {
      if (epoch === state.feedEpoch) message(ui['feed-status'], friendlyError(error, 'Não consegui carregar o mural. Use Atualizar fotos para tentar de novo.'), 'error');
    } finally {
      if (epoch === state.feedEpoch) { state.feedBusy = false; ui.feed.setAttribute('aria-busy', 'false'); ui.more.disabled = false; }
    }
  }
  ui.more.addEventListener('click', () => loadFeed(false));
  ui.refresh.addEventListener('click', async () => { if (state.user) await refreshIdentity(); else await loadFeed(true); });
  ui['admin-toggle'].addEventListener('click', () => { if (!isAdmin()) return; state.mode = state.mode === 'admin' ? 'public' : 'admin'; loadFeed(true); });
  let viewerEpoch = 0;
  let viewedPhoto = null;
  async function openPhoto(row) {
    const epoch = ++viewerEpoch;
    viewedPhoto = row;
    ui.report.hidden = !state.user || row.status !== 'published';
    ui['report-note'].hidden = ui.report.hidden;
    ui.report.disabled = false;
    ui['viewer-image'].hidden = true; ui['viewer-image'].removeAttribute('src');
    ui['viewer-caption'].textContent = row.caption || '';
    ui['viewer-author'].textContent = `Enviada por ${row.display_name || 'alguém do intervalo'}.`;
    message(ui['viewer-status'], 'Abrindo foto…'); showDialog(ui.viewer);
    try {
      const url = await signedUrl(row.object_path);
      if (epoch !== viewerEpoch || !ui.viewer.open) return;
      ui['viewer-image'].alt = row.caption || `Foto enviada por ${row.display_name || 'alguém do intervalo'}`;
      ui['viewer-image'].src = url; ui['viewer-image'].hidden = false; message(ui['viewer-status'], '');
    } catch { if (epoch === viewerEpoch) message(ui['viewer-status'], 'Essa foto não está disponível agora. Atualize o mural.', 'error'); }
  }
  ui.viewer.addEventListener('close', () => { viewerEpoch++; viewedPhoto = null; ui['viewer-image'].removeAttribute('src'); });
  ui.report.addEventListener('click', async () => {
    const row = viewedPhoto;
    if (!row || !state.user || ui.report.disabled) return;
    const accepted = await askConfirmation({ title: 'Denunciar esta foto?', text: 'Use apenas se ela violar as regras do mural. Uma denúncia por conta; 10 contas diferentes ocultam a foto para revisão.', label: 'Denunciar' });
    if (accepted === null || viewedPhoto?.id !== row.id) return;
    ui.report.disabled = true;
    try {
      const result = one(await rpc('report_community_photo', { p_photo_id: row.id }));
      message(notice, result?.hidden ? 'A foto foi ocultada para revisão.' : 'Denúncia registrada. Obrigado por avisar.');
      ui.viewer.close();
      if (result?.hidden) await loadFeed(true);
    } catch (error) {
      message(ui['viewer-status'], friendlyError(error, 'Não foi possível registrar a denúncia.'), 'error');
      ui.report.disabled = false;
    }
  });
  function askConfirmation({ title, text, label, reason = false, reasonRequired = false }) {
    ui['confirm-title'].textContent = title; ui['confirm-copy'].textContent = text;
    ui['confirm-action'].textContent = label; ui['confirm-reason-field'].hidden = !reason;
    ui['confirm-reason'].value = ''; ui['confirm-reason'].required = reasonRequired;
    showDialog(ui['confirm-dialog']);
    return new Promise(resolve => {
      let value = null;
      const submit = event => { event.preventDefault(); if (!ui['confirm-form'].reportValidity()) return; value = ui['confirm-reason'].value.trim(); ui['confirm-dialog'].close(); };
      const close = () => { ui['confirm-form'].removeEventListener('submit', submit); resolve(value); };
      ui['confirm-form'].addEventListener('submit', submit); ui['confirm-dialog'].addEventListener('close', close, { once: true });
    });
  }
  ui['confirm-cancel'].addEventListener('click', () => ui['confirm-dialog'].close());
  let adminBusy = false;
  async function restorePhoto(row) {
    if (!isAdmin() || adminBusy || row.status !== 'hidden') return;
    adminBusy = true;
    try {
      const accepted = await askConfirmation({ title: 'Restaurar esta foto?', text: 'A foto volta ao mural. Confira se as denúncias não indicam uma violação das regras.', label: 'Restaurar foto' });
      if (accepted === null) return;
      await rpc('admin_restore_community_photo', { p_photo_id: row.id });
      message(notice, 'Foto restaurada no mural.'); await loadFeed(true);
    } catch (error) { message(notice, friendlyError(error, 'Não foi possível restaurar a foto.'), 'error'); }
    finally { adminBusy = false; }
  }
  async function removePhoto(row) {
    if (!isAdmin() || adminBusy) return;
    adminBusy = true;
    try {
      const accepted = await askConfirmation({ title: 'Remover esta foto?', text: 'Ela deixa de aparecer no mural. Esta ação não pode ser desfeita pelo site.', label: 'Remover foto' });
      if (accepted === null) return;
      const removed = one(await rpc('admin_remove_community_photo', { p_photo_id: row.id }));
      if (!removed?.object_path) throw new Error('invalid_removal');
      let storageError = false;
      try { const { error } = await client.storage.from(BUCKET).remove([removed.object_path]); storageError = Boolean(error); } catch { storageError = true; }
      message(notice, storageError ? 'Foto removida da galeria; arquivo aguarda limpeza.' : 'Foto removida da galeria.');
      await loadFeed(true);
    } catch (error) { message(notice, friendlyError(error, 'Não foi possível remover a foto. Sua permissão será conferida pelo servidor.'), 'error'); }
    finally { adminBusy = false; }
  }
  async function changeBan(row) {
    if (!isAdmin() || adminBusy || !row.owner_id || row.owner_id === state.user?.id) return;
    adminBusy = true;
    const banned = !row.is_banned;
    try {
      const reason = await askConfirmation({ title: banned ? 'Bloquear esta conta?' : 'Desbloquear esta conta?', text: banned ? 'Esta conta fica impedida de enviar fotos. Os controles são aplicados pelo servidor.' : 'Esta conta poderá voltar a enviar fotos, respeitando as regras do mural.', label: banned ? 'Bloquear conta' : 'Desbloquear conta', reason: true, reasonRequired: banned });
      if (reason === null) return;
      await rpc('admin_set_community_ban', { p_user_id: row.owner_id, p_banned: banned, p_reason: reason });
      message(notice, banned ? 'Conta bloqueada para novos envios.' : 'Conta desbloqueada.');
      await loadFeed(true);
    } catch (error) { message(notice, friendlyError(error, 'Não foi possível alterar esta conta. Sua permissão será conferida pelo servidor.'), 'error'); }
    finally { adminBusy = false; }
  }
  window.addEventListener('pagehide', () => { if (state.previewUrl) URL.revokeObjectURL(state.previewUrl); });
  // Não aguarde chamadas do Supabase dentro deste callback: a biblioteca segura
  // o lock de autenticação enquanto entrega o evento. A atualização roda depois.
  client.auth.onAuthStateChange((event, session) => {
    state.user = session?.user || null;
    setTimeout(() => { refreshIdentity(); }, 0);
  });
  message(notice, '');
  try {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    state.user = data.session?.user || null;
    await refreshIdentity();
  } catch { message(notice, 'Não foi possível conectar sua sessão. Recarregue a página para tentar de novo.', 'error'); await loadFeed(true); }
})();
