-- Comunidade Zeballos. Rodar no SQL Editor, como postgres, depois de criar o bucket pelo painel/API.
-- Reexecutável nesta mesma estrutura; não remove contas, reservas, fotos nem administradores.
begin;

do $preflight$
begin
  if not exists (
    select 1 from storage.buckets b
    where b.id = 'community-photos' and b.name = 'community-photos'
      and b.public = false and b.file_size_limit = 2097152
      and b.allowed_mime_types = array['image/webp']::text[]
  ) then
    raise exception 'Crie/configure community-photos pela Storage API/painel: privado, 2097152 bytes, somente image/webp. Consulte community/SETUP.md.';
  end if;
  if pg_catalog.to_regprocedure('storage.allow_only_operation(text)') is null then
    raise exception 'Storage precisa suportar allow_only_operation(text). Atualize o serviço antes de ativar uploads.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'storage.objects precisa estar com RLS ativo.';
  end if;
end
$preflight$;

create schema if not exists community_private;
revoke all on schema community_private from public, anon, authenticated;
grant usage on schema community_private to anon, authenticated;

create table if not exists public.community_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Alguém do intervalo',
  is_banned boolean not null default false,
  ban_reason text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint community_profile_name_length check (pg_catalog.char_length(display_name) between 2 and 40),
  constraint community_profile_ban_reason_length check (ban_reason is null or pg_catalog.char_length(ban_reason) <= 180)
);

create table if not exists public.community_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

create table if not exists public.community_photos (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references public.community_profiles(user_id) on delete cascade,
  object_path text not null unique,
  caption text not null default '',
  display_name text not null,
  status text not null default 'pending',
  report_baseline integer not null default 0,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  reservation_expires_at timestamptz not null,
  published_at timestamptz,
  removed_at timestamptz,
  size_bytes bigint,
  mime_type text,
  constraint community_photo_path_owner check (object_path = owner_id::text || '/' || id::text || '.webp'),
  constraint community_photo_caption_length check (pg_catalog.char_length(caption) <= 140),
  constraint community_photo_name_length check (pg_catalog.char_length(display_name) between 2 and 40),
  constraint community_photo_status check (status in ('pending', 'published', 'hidden', 'removed')),
  constraint community_photo_expiry check (reservation_expires_at = created_at + interval '15 minutes'),
  constraint community_photo_publish_time check (published_at is null or (published_at >= created_at and published_at <= reservation_expires_at)),
  constraint community_photo_remove_time check (removed_at is null or removed_at >= created_at),
  constraint community_photo_public_metadata check (
    status not in ('published', 'hidden') or (
      published_at is not null and size_bytes is not null and size_bytes between 1 and 2097152
      and mime_type = 'image/webp' and removed_at is null
    )
  ),
  constraint community_photo_pending_metadata check (status <> 'pending' or (published_at is null and removed_at is null)),
  constraint community_photo_removed_metadata check (status <> 'removed' or removed_at is not null)
);

-- Projetos já configurados com a versão anterior preservam suas fotos.
alter table public.community_photos add column if not exists report_baseline integer not null default 0;
alter table public.community_photos drop constraint if exists community_photo_status;
alter table public.community_photos add constraint community_photo_status check (status in ('pending', 'published', 'hidden', 'removed'));
alter table public.community_photos drop constraint if exists community_photo_public_metadata;
alter table public.community_photos add constraint community_photo_public_metadata check (
  status not in ('published', 'hidden') or (
    published_at is not null and size_bytes is not null and size_bytes between 1 and 2097152
    and mime_type = 'image/webp' and removed_at is null
  )
);

create table if not exists public.community_photo_reports (
  photo_id uuid not null references public.community_photos(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (photo_id, reporter_id)
);
create index if not exists community_reports_reporter_time_idx on public.community_photo_reports(reporter_id, created_at desc);

create index if not exists community_photos_owner_created_idx on public.community_photos(owner_id, created_at desc);
create index if not exists community_photos_public_cursor_idx on public.community_photos(published_at desc, id desc) where status = 'published';
create index if not exists community_photos_admin_cursor_idx on public.community_photos(created_at desc, id desc);

alter table public.community_profiles enable row level security;
alter table public.community_admins enable row level security;
alter table public.community_photos enable row level security;
alter table public.community_photo_reports enable row level security;
revoke all privileges on public.community_profiles, public.community_admins, public.community_photos, public.community_photo_reports from public, anon, authenticated;

-- Helpers não ficam no schema exposto pela Data API. Nenhum usa user_metadata para papéis.
create or replace function community_private.is_active_user()
returns boolean language sql stable security definer set search_path = ''
as $fn$
  select exists (
    select 1 from auth.users u
    where u.id = (select auth.uid()) and u.email_confirmed_at is not null
      and coalesce(u.is_anonymous, false) = false
      and (u.banned_until is null or u.banned_until <= pg_catalog.now())
      and not exists (select 1 from public.community_profiles p where p.user_id = u.id and p.is_banned)
  );
$fn$;

create or replace function community_private.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $fn$
  select community_private.is_active_user() and exists (
    select 1 from public.community_admins a where a.user_id = (select auth.uid())
  );
$fn$;

create or replace function community_private.lock_user(p_user_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $fn$
begin
  if p_user_id is null then
    raise exception using errcode = '42501', message = 'COMMUNITY_AUTH_REQUIRED';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('zeballos-community:' || p_user_id::text, 0)) then
    raise exception using errcode = '55P03', message = 'COMMUNITY_BUSY_TRY_AGAIN';
  end if;
end
$fn$;

create or replace function community_private.assert_active_user()
returns uuid language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_uid uuid := auth.uid();
begin
  perform community_private.lock_user(v_uid);
  if not community_private.is_active_user() then
    raise exception using errcode = '42501', message = 'COMMUNITY_WRITE_FORBIDDEN';
  end if;
  return v_uid;
end
$fn$;

create or replace function community_private.photo_is_public(p_object_path text)
returns boolean language sql stable security definer set search_path = ''
as $fn$
  select exists (
    select 1 from public.community_photos f join public.community_profiles p on p.user_id = f.owner_id
    where f.object_path = p_object_path and f.status = 'published' and not p.is_banned
  );
$fn$;

create or replace function community_private.can_read_object(p_object_path text)
returns boolean language sql stable security definer set search_path = ''
as $fn$
  select community_private.is_admin() or exists (
    select 1 from public.community_photos f join public.community_profiles p on p.user_id = f.owner_id
    where f.object_path = p_object_path and not p.is_banned and (
      f.status = 'published' or (f.owner_id = (select auth.uid()) and f.status = 'pending')
    )
  );
$fn$;

create or replace function community_private.can_insert_object(p_object_path text, p_owner_id text)
returns boolean language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or p_owner_id is distinct from v_uid::text then return false; end if;
  -- Não emite signed-upload URLs: elas sobreviveriam ao prazo/ban do autor.
  if not storage.allow_only_operation('object.upload') then return false; end if;
  -- Mesmo lock das reservas/publicação/ban. Uma requisição concorrente tenta de novo.
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('zeballos-community:' || v_uid::text, 0)) then return false; end if;
  if not community_private.is_active_user() then return false; end if;
  return exists (
    select 1 from public.community_photos f
    where f.object_path = p_object_path and f.owner_id = v_uid and f.status = 'pending'
      and f.created_at <= pg_catalog.clock_timestamp() and f.reservation_expires_at > pg_catalog.clock_timestamp()
  );
end
$fn$;

create or replace function community_private.can_delete_object(p_object_path text)
returns boolean language sql stable security definer set search_path = ''
as $fn$
  select community_private.is_admin() and exists (
    select 1 from public.community_photos f where f.object_path = p_object_path and f.status = 'removed'
  );
$fn$;

create or replace function public.community_session_info()
returns table(uid uuid, is_admin boolean, is_banned boolean, display_name text)
language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from auth.users u where u.id = v_uid) then
    raise exception using errcode = '42501', message = 'COMMUNITY_AUTH_REQUIRED';
  end if;
  insert into public.community_profiles(user_id) values (v_uid) on conflict (user_id) do nothing;
  return query select v_uid, community_private.is_admin(), p.is_banned, p.display_name
    from public.community_profiles p where p.user_id = v_uid;
end
$fn$;

create or replace function public.reserve_community_photo(p_caption text, p_display_name text)
returns table(id uuid, object_path text, reservation_expires_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_uid uuid;
  v_id uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz;
  v_name text := pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_display_name, '')), '[[:space:]]+', ' ', 'g');
  v_caption text := pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_caption, '')), '[[:space:]]+', ' ', 'g');
  v_hour bigint;
  v_day bigint;
begin
  if pg_catalog.char_length(v_name) not between 2 and 40 or pg_catalog.char_length(v_caption) > 140
     or v_name ~ '[[:cntrl:]]' or v_caption ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'COMMUNITY_INVALID_TEXT';
  end if;
  v_uid := community_private.assert_active_user();
  v_now := pg_catalog.clock_timestamp();
  select count(*) filter (where f.created_at >= v_now - interval '1 hour'), count(*)
    into v_hour, v_day from public.community_photos f
    where f.owner_id = v_uid and f.created_at >= v_now - interval '24 hours';
  if v_hour >= 3 then raise exception using errcode = 'P0001', message = 'COMMUNITY_HOURLY_LIMIT'; end if;
  if v_day >= 10 then raise exception using errcode = 'P0001', message = 'COMMUNITY_DAILY_LIMIT'; end if;
  insert into public.community_profiles as profile(user_id, display_name, updated_at)
    values (v_uid, v_name, v_now)
    on conflict (user_id) do update set display_name = excluded.display_name, updated_at = excluded.updated_at;
  insert into public.community_photos(id, owner_id, object_path, caption, display_name, created_at, reservation_expires_at)
    values (v_id, v_uid, v_uid::text || '/' || v_id::text || '.webp', v_caption, v_name, v_now, v_now + interval '15 minutes');
  return query select f.id, f.object_path, f.reservation_expires_at from public.community_photos f where f.id = v_id;
end
$fn$;

create or replace function public.publish_community_photo(p_photo_id uuid)
returns table(id uuid, object_path text, caption text, display_name text, published_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_uid uuid;
  v_photo public.community_photos%rowtype;
  v_mime text;
  v_size_text text;
  v_owner text;
  v_size bigint;
  v_now timestamptz;
begin
  v_uid := community_private.assert_active_user();
  select f.* into v_photo from public.community_photos f where f.id = p_photo_id and f.owner_id = v_uid for update;
  if not found then raise exception using errcode = '42501', message = 'COMMUNITY_PHOTO_NOT_FOUND'; end if;
  if v_photo.status = 'published' then
    return query select f.id, f.object_path, f.caption, f.display_name, f.published_at from public.community_photos f where f.id = p_photo_id;
    return;
  end if;
  v_now := pg_catalog.clock_timestamp();
  if v_photo.status <> 'pending' or v_photo.reservation_expires_at <= v_now then
    raise exception using errcode = '22023', message = 'COMMUNITY_RESERVATION_EXPIRED_OR_REMOVED';
  end if;
  select o.metadata->>'mimetype', o.metadata->>'size', o.owner_id
    into v_mime, v_size_text, v_owner from storage.objects o
    where o.bucket_id = 'community-photos' and o.name = v_photo.object_path for share;
  if not found then raise exception using errcode = '22023', message = 'COMMUNITY_UPLOAD_NOT_FOUND'; end if;
  if v_owner is distinct from v_uid::text or v_mime is distinct from 'image/webp'
      or not coalesce(v_size_text ~ '^[0-9]{1,10}$', false) then
    raise exception using errcode = '22023', message = 'COMMUNITY_INVALID_UPLOAD';
  end if;
  v_size := v_size_text::bigint;
  if v_size < 1 or v_size > 2097152 then raise exception using errcode = '22023', message = 'COMMUNITY_INVALID_UPLOAD_SIZE'; end if;
  -- Confere de novo após a leitura/lock do objeto para não publicar uma reserva vencida.
  v_now := pg_catalog.clock_timestamp();
  if v_now >= v_photo.reservation_expires_at then raise exception using errcode = '22023', message = 'COMMUNITY_RESERVATION_EXPIRED_OR_REMOVED'; end if;
  update public.community_photos f set status = 'published', published_at = v_now, size_bytes = v_size, mime_type = v_mime where f.id = p_photo_id;
  return query select f.id, f.object_path, f.caption, f.display_name, f.published_at from public.community_photos f where f.id = p_photo_id;
end
$fn$;

create or replace function public.cancel_community_photo(p_photo_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_uid uuid;
begin
  v_uid := community_private.assert_active_user();
  update public.community_photos f set status = 'removed', removed_at = pg_catalog.clock_timestamp()
    where f.id = p_photo_id and f.owner_id = v_uid and f.status = 'pending';
  -- Não apaga a linha: cancelamentos/erros continuam contando na quota.
end
$fn$;

create or replace function public.list_community_photos(p_limit integer default 24, p_before timestamptz default null, p_before_id uuid default null)
returns table(id uuid, object_path text, caption text, display_name text, published_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $fn$
begin
  if (p_before is null) <> (p_before_id is null) then raise exception using errcode = '22023', message = 'COMMUNITY_INVALID_CURSOR'; end if;
  return query select f.id, f.object_path, f.caption, f.display_name, f.published_at
    from public.community_photos f join public.community_profiles p on p.user_id = f.owner_id
    where f.status = 'published' and not p.is_banned
      and (p_before is null or (f.published_at, f.id) < (p_before, p_before_id))
    order by f.published_at desc, f.id desc limit greatest(1, least(coalesce(p_limit, 24), 50));
end
$fn$;

create or replace function public.admin_list_community_photos(p_limit integer default 50, p_before timestamptz default null, p_before_id uuid default null)
returns table(id uuid, owner_id uuid, object_path text, caption text, display_name text, status text,
  created_at timestamptz, reservation_expires_at timestamptz, published_at timestamptz, removed_at timestamptz,
  size_bytes bigint, mime_type text, is_banned boolean)
language plpgsql stable security definer set search_path = ''
as $fn$
begin
  if not community_private.is_admin() then raise exception using errcode = '42501', message = 'COMMUNITY_ADMIN_REQUIRED'; end if;
  if (p_before is null) <> (p_before_id is null) then raise exception using errcode = '22023', message = 'COMMUNITY_INVALID_CURSOR'; end if;
  return query select f.id, f.owner_id, f.object_path, f.caption, f.display_name, f.status, f.created_at,
    f.reservation_expires_at, f.published_at, f.removed_at, f.size_bytes, f.mime_type, p.is_banned
    from public.community_photos f join public.community_profiles p on p.user_id = f.owner_id
    where p_before is null or (f.created_at, f.id) < (p_before, p_before_id)
    order by f.created_at desc, f.id desc limit greatest(1, least(coalesce(p_limit, 50), 100));
end
$fn$;

create or replace function public.admin_remove_community_photo(p_photo_id uuid)
returns table(id uuid, object_path text)
language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_owner uuid;
begin
  if not community_private.is_admin() then raise exception using errcode = '42501', message = 'COMMUNITY_ADMIN_REQUIRED'; end if;
  select f.owner_id into v_owner from public.community_photos f where f.id = p_photo_id;
  if not found then raise exception using errcode = '22023', message = 'COMMUNITY_PHOTO_NOT_FOUND'; end if;
  perform community_private.lock_user(v_owner);
  if not community_private.is_admin() then raise exception using errcode = '42501', message = 'COMMUNITY_ADMIN_REQUIRED'; end if;
  update public.community_photos f set status = 'removed', removed_at = coalesce(f.removed_at, pg_catalog.clock_timestamp()) where f.id = p_photo_id;
  return query select f.id, f.object_path from public.community_photos f where f.id = p_photo_id;
end
$fn$;

-- Denúncias não apagam arquivos. Dez contas distintas ocultam a foto até revisão.
create or replace function public.report_community_photo(p_photo_id uuid)
returns table(report_count integer, hidden boolean)
language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_uid uuid := auth.uid(); v_photo public.community_photos%rowtype; v_count integer;
begin
  if not community_private.is_active_user() then
    raise exception using errcode = '42501', message = 'COMMUNITY_AUTH_REQUIRED';
  end if;
  if p_photo_id is null then raise exception using errcode = '22023', message = 'COMMUNITY_PHOTO_NOT_FOUND'; end if;
  select * into v_photo from public.community_photos f where f.id = p_photo_id for update;
  if not found or v_photo.status <> 'published' then
    raise exception using errcode = '22023', message = 'COMMUNITY_PHOTO_NOT_FOUND';
  end if;
  if v_photo.owner_id = v_uid then
    raise exception using errcode = '42501', message = 'COMMUNITY_CANNOT_REPORT_SELF';
  end if;
  if exists (select 1 from public.community_photo_reports r where r.photo_id = p_photo_id and r.reporter_id = v_uid) then
    raise exception using errcode = '23505', message = 'COMMUNITY_ALREADY_REPORTED';
  end if;
  if (select count(*) from public.community_photo_reports r
      where r.reporter_id = v_uid and r.created_at > pg_catalog.clock_timestamp() - interval '24 hours') >= 5 then
    raise exception using errcode = '42901', message = 'COMMUNITY_REPORT_LIMIT';
  end if;
  insert into public.community_photo_reports(photo_id, reporter_id) values (p_photo_id, v_uid);
  select count(*)::integer into v_count from public.community_photo_reports r where r.photo_id = p_photo_id;
  if v_count - v_photo.report_baseline >= 10 then
    update public.community_photos f set status = 'hidden' where f.id = p_photo_id;
  end if;
  return query select v_count - v_photo.report_baseline, v_count - v_photo.report_baseline >= 10;
end
$fn$;

create or replace function public.admin_restore_community_photo(p_photo_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $fn$
begin
  if not community_private.is_admin() then
    raise exception using errcode = '42501', message = 'COMMUNITY_ADMIN_REQUIRED';
  end if;
  update public.community_photos f set status = 'published',
    report_baseline = (select count(*)::integer from public.community_photo_reports r where r.photo_id = p_photo_id)
    where f.id = p_photo_id and f.status = 'hidden';
  if not found then raise exception using errcode = '22023', message = 'COMMUNITY_PHOTO_NOT_FOUND'; end if;
end
$fn$;

create or replace function public.admin_set_community_ban(p_user_id uuid, p_banned boolean, p_reason text default '')
returns void language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
begin
  if not community_private.is_admin() then raise exception using errcode = '42501', message = 'COMMUNITY_ADMIN_REQUIRED'; end if;
  if p_user_id is null or p_banned is null or pg_catalog.char_length(v_reason) > 180 or v_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'COMMUNITY_INVALID_BAN';
  end if;
  if p_user_id = auth.uid() then raise exception using errcode = '42501', message = 'COMMUNITY_CANNOT_BAN_SELF'; end if;
  perform community_private.lock_user(p_user_id);
  if not community_private.is_admin() then raise exception using errcode = '42501', message = 'COMMUNITY_ADMIN_REQUIRED'; end if;
  update public.community_profiles p set is_banned = p_banned,
    ban_reason = case when p_banned then nullif(v_reason, '') else null end,
    updated_at = pg_catalog.clock_timestamp() where p.user_id = p_user_id;
  if not found then raise exception using errcode = '22023', message = 'COMMUNITY_USER_NOT_FOUND'; end if;
end
$fn$;

-- Só o RPC de feed é público. Todas as alterações passam por validação dentro de funções.
revoke all on function public.community_session_info() from public, anon, authenticated;
revoke all on function public.reserve_community_photo(text, text) from public, anon, authenticated;
revoke all on function public.publish_community_photo(uuid) from public, anon, authenticated;
revoke all on function public.cancel_community_photo(uuid) from public, anon, authenticated;
revoke all on function public.list_community_photos(integer, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.admin_list_community_photos(integer, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.admin_remove_community_photo(uuid) from public, anon, authenticated;
revoke all on function public.report_community_photo(uuid) from public, anon, authenticated;
revoke all on function public.admin_restore_community_photo(uuid) from public, anon, authenticated;
revoke all on function public.admin_set_community_ban(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.list_community_photos(integer, timestamptz, uuid) to anon, authenticated;
grant execute on function public.community_session_info(), public.reserve_community_photo(text, text),
  public.publish_community_photo(uuid), public.cancel_community_photo(uuid),
  public.admin_list_community_photos(integer, timestamptz, uuid), public.admin_remove_community_photo(uuid),
  public.admin_set_community_ban(uuid, boolean, text), public.report_community_photo(uuid),
  public.admin_restore_community_photo(uuid) to authenticated;

revoke all on all functions in schema community_private from public, anon, authenticated;
grant execute on function community_private.photo_is_public(text), community_private.can_read_object(text),
  community_private.can_insert_object(text, text), community_private.can_delete_object(text) to anon, authenticated;

-- Perfil/admin não têm SELECT nem escrita direta; session_info/RPCs retornam só o necessário.
drop policy if exists community_feed_select on public.community_photos;
create policy community_feed_select on public.community_photos for select to anon, authenticated
  using (community_private.photo_is_public(object_path));
drop policy if exists community_feed_select_guard on public.community_photos;
create policy community_feed_select_guard on public.community_photos as restrictive for select to anon, authenticated
  using (community_private.photo_is_public(object_path));
grant select (id, object_path, caption, display_name, published_at) on public.community_photos to anon, authenticated;

-- Guards restritivos impedem que permissões amplas preexistentes liberem este bucket.
-- Buckets alheios não têm seu comportamento alterado. Não há UPDATE/upsert deste bucket.
drop policy if exists community_object_read on storage.objects;
create policy community_object_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'community-photos' and community_private.can_read_object(name));
drop policy if exists community_object_read_guard on storage.objects;
create policy community_object_read_guard on storage.objects as restrictive for select to anon, authenticated
  using (case when bucket_id = 'community-photos' then community_private.can_read_object(name) else true end);

drop policy if exists community_object_insert on storage.objects;
create policy community_object_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'community-photos' and community_private.can_insert_object(name, owner_id));
drop policy if exists community_object_insert_guard on storage.objects;
create policy community_object_insert_guard on storage.objects as restrictive for insert to anon, authenticated
  with check (case when bucket_id = 'community-photos' then community_private.can_insert_object(name, owner_id) else true end);

drop policy if exists community_object_no_update on storage.objects;
create policy community_object_no_update on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id <> 'community-photos') with check (bucket_id <> 'community-photos');

drop policy if exists community_object_delete on storage.objects;
create policy community_object_delete on storage.objects for delete to authenticated
  using (bucket_id = 'community-photos' and community_private.can_delete_object(name));
drop policy if exists community_object_delete_guard on storage.objects;
create policy community_object_delete_guard on storage.objects as restrictive for delete to anon, authenticated
  using (case when bucket_id = 'community-photos' then community_private.can_delete_object(name) else true end);

-- Nenhum administrador é inserido automaticamente. Bootstrap manual está em SETUP.md.
notify pgrst, 'reload schema';
commit;
