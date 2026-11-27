# Mural de fotos — ativação

O site usa um projeto Supabase para guardar fotos e contas. A galeria antiga permanece no site. Os arquivos enviados ficam em um bucket privado `community-photos` (2 MiB, só `image/webp`). A chave em `config.js` é pública; nunca coloque chave `service_role` ou Client Secret no GitHub.

## Para ativar

1. No Google Auth Platform, crie um cliente OAuth do tipo Web. Configure a tela de consentimento para usuários externos e publique o app para que colegas consigam entrar. Cadastre o callback indicado pelo painel do Supabase no cliente OAuth. Siga a [documentação oficial](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).
2. No Supabase, em Authentication → Sign In / Providers → Google, informe Client ID e Client Secret. O segredo fica **apenas no painel do Supabase**. Em URL Configuration, use `https://zeballosetec.vercel.app` como Site URL e Redirect URL.
3. Confira que `community-photos` é privado e limitado a 2 MiB e `image/webp`. Aplique `schema.sql` como migração: ele pode ser executado novamente e preserva fotos existentes. Se estiver atualizando de uma versão anterior, isto acrescenta a tabela de denúncias e o estado `hidden`.
4. Depois de testar o Google OAuth com uma conta comum, altere somente `allowGoogle` para `true` em `config.js` e publique a branch. Sem isso, visitantes podem ver o mural, mas o botão de login fica oculto.
5. Entre com sua conta Google, localize seu UID confirmado em Authentication → Users e cadastre manualmente o administrador:

```sql
insert into public.community_admins(user_id)
select id from auth.users
where id = 'COLE_SEU_UID_AQUI'::uuid and email_confirmed_at is not null
on conflict (user_id) do nothing;
```

Não conceda admin automaticamente ao primeiro usuário, por apelido ou por e-mail digitado no navegador.

## Funcionamento

Quem entra com Google escolhe um nome visível e pode subir fotos com descrição opcional, que aparecem imediatamente. O endereço de e-mail não aparece na foto. Limites: 3 reservas por hora, 10 por 24 horas, 2 MiB por foto. O dono precisa ter autorização das pessoas que aparecem.

Cada conta Google ativa pode denunciar uma foto uma vez, até 5 denúncias por 24 horas, e não pode denunciar a própria. A 10ª denúncia de contas diferentes oculta a foto e impede novas URLs assinadas. **Não apaga o arquivo**. O admin pode restaurar ou remover a foto, e bloquear contas abusivas. Depois de restaurar, uma nova rodada exige outras 10 denúncias. Múltiplas contas Google ainda podem manipular votos; revise fotos ocultadas e mantenha a moderação.

RPCs novas: `report_community_photo(p_photo_id)` retorna `report_count, hidden`; `admin_restore_community_photo(p_photo_id)` restaura uma foto oculta. As funções validam identidade e permissões no banco. `community_photo_reports` não é acessível diretamente ao navegador.

Teste em janela anônima com conta comum, outra conta e a sua conta admin: login, upload, descrição vazia, 10 denúncias únicas, bloqueio de repetição, foto oculta, restauração, remoção e ban. Antes do OAuth estar configurado, não publique o botão como ativo.

Para os testes locais: `cd community/tests && npm install && npm test`. Eles simulam Auth e Storage, portanto ainda é necessário conferir a integração real no Supabase.
