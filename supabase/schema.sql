-- =====================================================================
-- Studio Iêda Carlos — banco de agendamentos (Supabase / Postgres)
-- Rodar uma vez no Supabase: SQL Editor > New query > colar tudo > Run
-- =====================================================================

-- ---------- Tabelas ----------

-- Quem pode entrar no painel (só usuários listados aqui são administradores)
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.services (
  id           text primary key,
  name         text not null check (length(name) between 2 and 60),
  duration_min int  not null default 60 check (duration_min between 5 and 480),
  price        numeric(10,2) not null check (price >= 0),
  active       boolean not null default true,
  sort         int not null default 0
);

-- Horários de atendimento por dia da semana (0 = domingo ... 6 = sábado)
create table if not exists public.weekday_slots (
  weekday smallint primary key check (weekday between 0 and 6),
  slots   text[] not null default '{}'
);

-- Bloqueios: dia inteiro (hour nulo) ou horário específico
create table if not exists public.blocks (
  id     bigint generated always as identity primary key,
  date   date not null,
  hour   text check (hour ~ '^\d{2}:\d{2}$'),
  reason text check (length(reason) <= 120)
);

create table if not exists public.bookings (
  id           uuid primary key default gen_random_uuid(),
  service_id   text references public.services(id) on update cascade on delete set null,
  service_name text not null,
  price        numeric(10,2) not null,
  date         date not null,
  hour         text not null check (hour ~ '^\d{2}:\d{2}$'),
  client_name  text not null check (length(client_name) between 2 and 80),
  client_phone text not null check (length(regexp_replace(client_phone, '\D', '', 'g')) between 10 and 13),
  note         text check (length(note) <= 300),
  status       text not null default 'pendente'
               check (status in ('pendente', 'confirmado', 'concluido', 'cancelado')),
  source       text not null default 'site' check (source in ('site', 'painel')),
  created_at   timestamptz not null default now()
);

-- Impede dois agendamentos ativos no mesmo dia/horário
create unique index if not exists bookings_slot_unique
  on public.bookings (date, hour) where status <> 'cancelado';
create index if not exists bookings_date_idx on public.bookings (date);

-- ---------- Funções ----------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Horários ocupados (sem dados pessoais) para o site público.
-- hour = '*' significa dia inteiro bloqueado.
create or replace function public.public_busy(d_from date, d_to date)
returns table (date date, hour text)
language sql stable security definer set search_path = public as $$
  select b.date, b.hour from public.bookings b
   where b.date between d_from and d_to and b.status <> 'cancelado'
  union
  select k.date, coalesce(k.hour, '*') from public.blocks k
   where k.date between d_from and d_to;
$$;

-- Cria agendamento pelo site, com todas as validações no servidor
create or replace function public.create_booking(
  p_service text, p_date date, p_time text,
  p_name text, p_phone text, p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_srv    public.services%rowtype;
  v_slots  text[];
  v_id     uuid;
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  select * into v_srv from public.services where id = p_service and active;
  if not found then raise exception 'SERVICO_INVALIDO'; end if;

  select slots into v_slots from public.weekday_slots where weekday = extract(dow from p_date);
  if v_slots is null or not (p_time = any (v_slots)) then raise exception 'HORARIO_INVALIDO'; end if;

  if ((p_date + p_time::time) at time zone 'America/Sao_Paulo') < now() + interval '1 hour'
     or p_date > current_date + 90 then
    raise exception 'HORARIO_INVALIDO';
  end if;

  if exists (select 1 from public.blocks
              where date = p_date and (hour is null or hour = p_time)) then
    raise exception 'HORARIO_OCUPADO';
  end if;

  -- anti-spam: no máximo 3 agendamentos futuros ativos por telefone
  if (select count(*) from public.bookings
       where regexp_replace(client_phone, '\D', '', 'g') = v_digits
         and status in ('pendente', 'confirmado') and date >= current_date) >= 3 then
    raise exception 'LIMITE_TELEFONE';
  end if;

  begin
    insert into public.bookings (service_id, service_name, price, date, hour,
                                 client_name, client_phone, note, source)
    values (v_srv.id, v_srv.name, v_srv.price, p_date, p_time,
            trim(p_name), trim(p_phone), nullif(trim(coalesce(p_note, '')), ''), 'site')
    returning id into v_id;
  exception when unique_violation then
    raise exception 'HORARIO_OCUPADO';
  end;
  return v_id;
end;
$$;

-- Cliente cancela o próprio agendamento (precisa do id + telefone usado)
create or replace function public.cancel_booking(p_id uuid, p_phone text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.bookings set status = 'cancelado'
   where id = p_id
     and regexp_replace(client_phone, '\D', '', 'g') = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
     and status in ('pendente', 'confirmado')
     and date >= current_date;
  return found;
end;
$$;

revoke all on function public.public_busy(date, date) from public;
revoke all on function public.create_booking(text, date, text, text, text, text) from public;
revoke all on function public.cancel_booking(uuid, text) from public;
revoke all on function public.is_admin() from public;
grant execute on function public.public_busy(date, date) to anon, authenticated;
grant execute on function public.create_booking(text, date, text, text, text, text) to anon, authenticated;
grant execute on function public.cancel_booking(uuid, text) to anon, authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------- Segurança (RLS) ----------
alter table public.admins        enable row level security;
alter table public.services      enable row level security;
alter table public.weekday_slots enable row level security;
alter table public.blocks        enable row level security;
alter table public.bookings      enable row level security;

drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins for select to authenticated using (user_id = auth.uid());

drop policy if exists services_read on public.services;
create policy services_read on public.services for select to anon, authenticated using (true);
drop policy if exists services_admin on public.services;
create policy services_admin on public.services for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists slots_read on public.weekday_slots;
create policy slots_read on public.weekday_slots for select to anon, authenticated using (true);
drop policy if exists slots_admin on public.weekday_slots;
create policy slots_admin on public.weekday_slots for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists blocks_admin on public.blocks;
create policy blocks_admin on public.blocks for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists bookings_admin on public.bookings;
create policy bookings_admin on public.bookings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- Dados iniciais ----------
insert into public.services (id, name, duration_min, price, sort) values
  ('design',     'Design Personalizado', 40,  40, 1),
  ('henna',      'Design com Henna',     50,  60, 2),
  ('lamination', 'Brow Lamination',      60, 100, 3),
  ('cilios',     'Extensão de Cílios',   90, 140, 4)
on conflict (id) do nothing;

insert into public.weekday_slots (weekday, slots) values
  (0, '{}'),
  (1, '{09:00,10:30,13:30,15:00,16:30,18:00}'),
  (2, '{09:00,10:30,13:30,15:00,16:30,18:00}'),
  (3, '{09:00,10:30,13:30,15:00,16:30,18:00}'),
  (4, '{09:00,10:30,13:30,15:00,16:30,18:00}'),
  (5, '{09:00,10:30,13:30,15:00,16:30,18:00}'),
  (6, '{08:00,09:30,11:00,13:30}')
on conflict (weekday) do nothing;

-- ---------- Depois de criar o usuário da Iêda (Authentication > Users > Add user) ----------
-- insert into public.admins (user_id)
--   select id from auth.users where email = 'EMAIL-DA-IEDA@exemplo.com';
