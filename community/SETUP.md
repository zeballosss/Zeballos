# Ativar os envios da comunidade

O site publica os envios **imediatamente**. Você remove fotos e bane contas pelo painel de administrador. A galeria original continua funcionando sem esta conexão.

## Configuração

1. Escolha o projeto Supabase que vai usar. Em **Storage**, crie `community-photos`: **privado**, limite **2097152 bytes (2 MiB)** e MIME permitido **somente `image/webp`**. Não ative versionamento. Use o painel ou a Storage API para configurar o bucket, sem editar `storage.buckets` por SQL.
2. Rode o conteúdo completo de `schema.sql` no **SQL Editor**, como `postgres`. Ele confere o bucket antes de aplicar e pode ser executado novamente. Se faltar o helper oficial `storage.allow_only_operation(text)`, é preciso alinhar a versão do Storage; não remova essa proteção.
3. Em **Authentication → URL Configuration**, coloque o endereço HTTPS definitivo da Vercel em **Site URL** e nos redirecionamentos permitidos. Em produção, use o endereço exato do seu site.
4. Ative o login por e-mail e configure **SMTP próprio** no Supabase para enviar códigos a todos os colegas. Em **Authentication → Email Templates → Magic Link**, substitua o link pelo código `{{ .Token }}` (seis dígitos). Deixe a confirmação de e-mail ativa. O site envia o código com `signInWithOtp` e confirma com `verifyOtp`; sem o código, não há sessão para publicar. O SMTP padrão restringe destinatários e serve apenas para testes. Opcionalmente, configure Google OAuth.
5. Preencha `community/config.js` seguindo `config.example.js`: URL do projeto e **publishable key** pública (ou chave legada `anon`). Nunca coloque `service_role`, secret key, senha de banco, SMTP ou segredo do Google no site/GitHub. Deixe `allowGoogle` falso até concluir e testar Google OAuth. A tela usa código por e-mail e não pede senha.
6. Mantenha `community_private` e `storage` fora dos schemas expostos pela Data API. Confira os limites de uso do projeto; a quota daqui é por conta, não substitui os limites de Auth/Storage.

## Liberar seu administrador

Entre no site com o código enviado ao seu e-mail. Em **Authentication → Users**, copie e confira o **UID da sua própria conta**. Só depois, no SQL Editor, substitua o texto abaixo pelo UID confirmado:

```sql
insert into public.community_admins(user_id)
select id from auth.users
where id = 'COLE_AQUI_SEU_UID_CONFIRMADO'::uuid
  and email_confirmed_at is not null
on conflict (user_id) do nothing;
```

Saia e entre novamente. Nenhuma primeira conta vira admin automaticamente. Email, apelido e `user_metadata` não concedem esse papel.

## Contrato com o site

As chamadas usam `supabase.rpc(nome, argumentos)`. Retornos tabulares são arrays; pegue `[0]` nas chamadas de uma linha.

| RPC | Argumentos | Retorno |
| --- | --- | --- |
| `community_session_info` | nenhum | `uid, is_admin, is_banned, display_name` |
| `reserve_community_photo` | `p_caption, p_display_name` | `id, object_path, reservation_expires_at` |
| `publish_community_photo` | `p_photo_id` | foto pública |
| `cancel_community_photo` | `p_photo_id` | vazio; cancela somente sua reserva pendente |
| `list_community_photos` | `p_limit=24, p_before=null, p_before_id=null` | fotos públicas |
| `admin_list_community_photos` | `p_limit=50, p_before=null, p_before_id=null` | fotos e dados de moderação |
| `admin_remove_community_photo` | `p_photo_id` | `id, object_path` |
| `admin_set_community_ban` | `p_user_id, p_banned, p_reason=''` | vazio |

Foto pública: `id, object_path, caption, display_name, published_at`. A listagem admin acrescenta `owner_id, status, created_at, reservation_expires_at, removed_at, size_bytes, mime_type, is_banned`. Paginação: use o último `published_at` + `id` no feed; `created_at` + `id` no admin. Sempre envie os dois campos do cursor juntos.

Fluxo: reservar → `storage.from('community-photos').upload(object_path, blobWebp, {contentType:'image/webp', upsert:false})` → publicar. Há 15 minutos para concluir. Apelido: 2–40 caracteres; legenda: até 140. Para exibir, solicite `createSignedUrl(path, 60)` ou o equivalente em lote.

## Moderação e limites

- Antes de excluir o arquivo, chame `admin_remove_community_photo`; depois use `storage.remove([object_path])`. Só admin pode excluir, e apenas após marcar a foto removida. Repita a exclusão se a rede falhar. Pendências vencidas podem ser removidas da mesma forma.
- Banir esconde as fotos da conta nas próximas consultas e bloqueia novos envios, inclusive com JWT antigo. Desbanir permite novamente as fotos publicadas que não foram removidas. Não é permitido banir a própria conta.
- A quota é **3 reservas por hora e 10 por 24 horas**, em janelas rolantes. Canceladas e removidas continuam contando. Preserve essas linhas; não apague reservas para “liberar espaço”.
- Não apague linhas de `storage.objects` por SQL. O arquivo real precisa ser removido pela API. O sistema não guarda IP, email ou senha nas tabelas da comunidade; Supabase Auth gerencia as contas.

O cliente pede URLs de 60 segundos, mas RLS não impõe esse teto: um cliente modificado pode pedir prazo maior. URLs já emitidas e cópias baixadas não são revogadas por um ban. Para impor 60 segundos no servidor, é necessário um serviço de assinatura próprio. Upload por URL assinada foi bloqueado para não contornar o prazo da reserva ou o ban.

Storage limita tamanho/MIME e o SQL confere seus metadados. Isso não verifica o conteúdo visual nem prova que bytes enviados por um cliente modificado são uma imagem válida; revalidação/regravação no servidor exigiria um processamento adicional.

## Teste antes de divulgar

Use uma conta comum e a sua conta admin: confirmar login, enviar, abrir em janela anônima, atingir a quota, remover, banir e tentar enviar com a sessão antiga. Confira também upload com reserva vencida e tentativa de sobrescrever arquivo. Não existe etapa de aprovação prévia.

## Documentação oficial

- [RLS e Storage](https://supabase.com/docs/guides/storage/security/access-control) · [helpers por operação](https://supabase.com/docs/guides/storage/schema/helper-functions).
- [Funções e permissões](https://supabase.com/docs/guides/database/functions) · [schema do Storage](https://supabase.com/docs/guides/storage/schema/design).
- [URLs assinadas](https://supabase.com/docs/reference/javascript/file-buckets-createsignedurl).
- [SMTP](https://supabase.com/docs/guides/auth/auth-smtp) · [Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) · [redirecionamentos](https://supabase.com/docs/guides/auth/redirect-urls).

## Testes locais automatizados

Na pasta `community/tests`, execute `npm install` e `npm test`. São 32 verificações de banco PostgreSQL em PGlite e 18 de interface em JSDOM. Auth e Storage são simulados; nenhum teste usa credenciais ou altera um projeto real. Os testes cobrem publicação direta, acesso, limites, bloqueio com sessão antiga, remoção, falhas e texto enviado por usuários.

A integração real com Supabase e a conferência visual no navegador ainda precisam ser feitas após a configuração acima.

A confirmação prova que a pessoa tem acesso àquela caixa de entrada naquele momento. Não prova nome verdadeiro nem impede todos os serviços de e-mail temporário; se isso for obrigatório, é preciso uma regra adicional no servidor para domínios aceitos e moderação de contas. O apelido de quem enviou aparece na foto, sem mostrar o e-mail publicamente.
