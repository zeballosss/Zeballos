// Teste isolado; não conecta a uma conta Supabase real.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db = new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz, is_anonymous boolean default false, banned_until timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select current_user::text $$;
grant usage on schema auth,storage to anon,authenticated,service_role;
grant execute on function auth.uid(), auth.role() to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text references storage.buckets(id),name text,owner_id text,metadata jsonb default '{}',created_at timestamptz default now(),unique(bucket_id,name));
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
grant select,insert,update,delete on storage.objects to anon,authenticated;
create function storage.allow_only_operation(text) returns boolean language sql stable as $$ select coalesce(current_setting('storage.operation',true),'')=$1 $$;
grant select on storage.buckets to anon,authenticated;
insert into storage.buckets values('community-photos','community-photos',false,2097152,array['image/webp']);
`);
const sql = readFileSync(new URL('../schema.sql', import.meta.url),'utf8');
try { await db.exec(sql); } catch(e) { console.error('SCHEMA ERROR',e.message,e.code,e.where||''); process.exit(1); }
console.log('schema: OK');
await db.exec(sql); console.log('schema rerun: OK');

let checks=0;
const admin='10000000-0000-4000-8000-000000000001', user='20000000-0000-4000-8000-000000000002', other='30000000-0000-4000-8000-000000000003';
await db.query(`insert into auth.users(id,email_confirmed_at) values($1,now()),($2,now()),($3,null)`,[admin,user,other]);
await db.query('insert into public.community_admins(user_id) values($1)',[admin]);
async function run(role,uid,sql,params=[],operation='object.upload'){
 await db.exec('begin');
 try{await db.exec('set local role '+role);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid||'']);await db.query("select set_config('storage.operation',$1,true)",[operation]);const out=await db.query(sql,params);await db.exec('commit');return out.rows;}
 catch(e){await db.exec('rollback');throw e;}
}
function ok(value,label){if(!value)throw Error(label);checks++;console.log('PASS',label)}
async function denied(role,uid,sql,params,label){try{await run(role,uid,sql,params);throw Error('UNEXPECTED_SUCCESS');}catch(e){if(e.message==='UNEXPECTED_SUCCESS')throw Error(label);ok(true,label)}}
await denied('anon',null,"select * from public.reserve_community_photo('x','Nome')",[],'anon cannot reserve');
await denied('authenticated',other,"select * from public.reserve_community_photo('x','Nome')",[],'unconfirmed user cannot reserve');
await denied('authenticated',user,'insert into public.community_admins(user_id) values($1)',[user],'cannot promote self');
await denied('authenticated',user,'select * from public.admin_list_community_photos()',[],'non-admin cannot moderate');
const session=await run('authenticated',user,'select * from public.community_session_info()');ok(!session[0].is_admin,'session has no client-derived admin role');
const signReservation=(await run('authenticated',admin,"select * from public.reserve_community_photo('Teste','Admin')"))[0];
for(const op of ['object.sign_upload_url','object.upload_signed','object.copy','storage.s3.upload','']){
 try{await run('authenticated',admin,"insert into storage.objects(bucket_id,name,owner_id) values('community-photos',$1,$2)",[signReservation.object_path,admin],op);throw Error('UNEXPECTED_SUCCESS');}catch(e){if(e.message==='UNEXPECTED_SUCCESS')throw Error('operation bypass');ok(true,'blocked alternative write operation '+(op||'unset'));}
}
const a=(await run('authenticated',user,"select * from public.reserve_community_photo('Teste','Zeballos')"))[0];ok(a.object_path===`${user}/${a.id}.webp`,'reserved path owned by user');
await denied('authenticated',user,'select * from public.publish_community_photo($1)',[a.id],'cannot publish absent object');
await denied('authenticated',user,"insert into storage.objects(bucket_id,name,owner_id) values('community-photos',$1,$2)",[`${user}/unreserved.webp`,user],'cannot upload without reservation');
await run('authenticated',user,"insert into storage.objects(bucket_id,name,owner_id,metadata) values('community-photos',$1,$2,$3::jsonb)",[a.object_path,user,JSON.stringify({mimetype:'image/webp',size:9000})]);checks++;console.log('PASS reserved object insert');
ok((await run('anon',null,"select name from storage.objects where name=$1",[a.object_path])).length===0,'pending object hidden from public');
await denied('authenticated',admin,'select * from public.publish_community_photo($1)',[a.id],'cannot publish another user object');
await run('authenticated',user,'select * from public.publish_community_photo($1)',[a.id]);ok((await run('anon',null,'select * from public.list_community_photos()')).length===1,'photo appears immediately after publication');
ok((await run('anon',null,"select name from storage.objects where name=$1",[a.object_path])).length===1,'published object readable');
ok((await run('anon',null,'select id,caption from public.community_photos')).length===1,'public columns visible');
await denied('anon',null,'select owner_id from public.community_photos',[],'internal user identifiers not public table columns');
await denied('authenticated',user,'update public.community_profiles set is_banned=false where user_id=$1',[user],'cannot edit own ban');
await db.exec("create policy test_broad_update on storage.objects for update to authenticated using(true) with check(true); create policy test_broad_insert on storage.objects for insert to authenticated with check(true); create policy test_broad_delete on storage.objects for delete to authenticated using(true)");
ok((await run('authenticated',user,"update storage.objects set metadata='{}' where name=$1 returning id",[a.object_path])).length===0,'restrictive guard blocks overwrite despite broad policy');
await denied('authenticated',user,"insert into storage.objects(bucket_id,name,owner_id) values('community-photos',$1,$2)",[`${user}/no-reservation.webp`,user],'restrictive guard blocks unreserved upload despite broad policy');
ok((await run('authenticated',user,'delete from storage.objects where name=$1 returning id',[a.object_path])).length===0,'restrictive guard blocks non-admin deletion');
for(let i=0;i<2;i++){const r=(await run('authenticated',user,"select * from public.reserve_community_photo('x','Nome')"))[0];await run('authenticated',user,'select public.cancel_community_photo($1)',[r.id]);}
await denied('authenticated',user,"select * from public.reserve_community_photo('x','Nome')",[],'cancel does not refund hourly quota');
await run('authenticated',admin,'select * from public.community_session_info()');
await run('authenticated',admin,"select public.admin_set_community_ban($1,true,'spam')",[user]);
ok((await run('anon',null,'select * from public.list_community_photos()')).length===0,'ban hides all user photos');
ok((await run('anon',null,'select name from storage.objects where name=$1',[a.object_path])).length===0,'ban blocks new storage reads');
await denied('authenticated',user,'select * from public.publish_community_photo($1)',[a.id],'ban blocks stale-token write');
await denied('authenticated',admin,"select public.admin_set_community_ban($1,true,'x')",[admin],'admin cannot ban own account');
await run('authenticated',admin,"select public.admin_set_community_ban($1,false,'')",[user]);ok((await run('anon',null,'select * from public.list_community_photos()')).length===1,'unban restores non-removed photos');
await denied('authenticated',user,'select * from public.report_community_photo($1)',[a.id],'owner cannot report own photo');
await denied('anon',null,'select * from public.report_community_photo($1)',[a.id],'visitor cannot report');
await denied('authenticated',admin,'insert into public.community_photo_reports(photo_id,reporter_id) values($1,$2)',[a.id,admin],'report table cannot be written directly');
const voters=[admin,...Array.from({length:9},(_,i)=>`40000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`)];
for(const voter of voters.slice(1)) await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())',[voter]);
for(let i=0;i<9;i++) await run('authenticated',voters[i],'select * from public.report_community_photo($1)',[a.id]);
ok((await run('anon',null,'select * from public.list_community_photos()')).length===1,'nine accounts cannot hide photo');
await denied('authenticated',admin,'select * from public.report_community_photo($1)',[a.id],'duplicate account cannot vote twice');
const lastVote=(await run('authenticated',voters[9],'select * from public.report_community_photo($1)',[a.id]))[0];
ok(lastVote.hidden===true && lastVote.report_count===10,'tenth distinct report hides photo');
ok((await run('anon',null,'select * from public.list_community_photos()')).length===0,'hidden photo and object absent from public feed');
ok((await run('anon',null,'select name from storage.objects where name=$1',[a.object_path])).length===0,'hidden object cannot get new signed URL');
await denied('authenticated',user,'select public.admin_restore_community_photo($1)',[a.id],'only admin can restore hidden photo');
await run('authenticated',admin,'select public.admin_restore_community_photo($1)',[a.id]);
ok((await run('anon',null,'select * from public.list_community_photos()')).length===1,'admin restoration republishes without deleting file');
await run('authenticated',admin,'select * from public.admin_remove_community_photo($1)',[a.id]);
ok((await run('anon',null,'select * from public.list_community_photos()')).length===0,'removed photo absent from public feed');
ok((await run('authenticated',admin,'delete from storage.objects where name=$1 returning id',[a.object_path])).length===1,'admin cleanup permitted after removal');
console.log('Security assertions:',checks);
await db.close();

