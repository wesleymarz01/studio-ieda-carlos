// =====================================================================
// MODO DEMONSTRAÇÃO — ativado com ?demo na URL (admin.html?demo / index.html?demo)
// Substitui o Supabase por um banco simulado no navegador, com dados fictícios.
// Nada é enviado para servidor nenhum.
// =====================================================================
(function () {
  const KEY = 'studio_ic_demo_db';
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const day = (offset) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    if (d.getDay() === 0) d.setDate(d.getDate() + (offset < 0 ? -1 : 1)); // pula domingo
    return iso(d);
  };

  function seed() {
    const S = { design: ['Design Personalizado', 40], henna: ['Design com Henna', 60], lamination: ['Brow Lamination', 100], cilios: ['Extensão de Cílios', 140] };
    let n = 0;
    const bk = (offset, hour, srv, name, phone, status, extra = {}) => ({
      id: 'd' + (++n), service_id: srv, service_name: S[srv][0], price: S[srv][1], date: day(offset), hour,
      client_name: name, client_phone: phone, note: null, status, source: 'site', ...extra
    });
    const WEEK = ['09:00', '10:30', '13:30', '15:00', '16:30', '18:00'];
    return {
      session: null, seq: 100,
      services: Object.entries(S).map(([id, [name, price]], i) => ({ id, name, price, duration_min: [40, 50, 60, 90][i], active: true, sort: i + 1 })),
      weekday_slots: [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, slots: w === 0 ? [] : w === 6 ? ['08:00', '09:30', '11:00', '13:30'] : WEEK })),
      blocks: [{ id: 'k1', date: day(5), hour: null, reason: 'Curso de atualização' }],
      bookings: [
        bk(-3, '10:30', 'cilios', 'Larissa Moura', '(62) 98101-2020', 'concluido'),
        bk(-2, '13:30', 'lamination', 'Bianca Rocha', '(62) 99202-3030', 'concluido'),
        bk(-2, '16:30', 'henna', 'Tatiane Freitas', '(62) 98303-4040', 'concluido', { source: 'painel' }),
        bk(-1, '09:00', 'design', 'Renata Alves', '(62) 99404-5050', 'concluido'),
        bk(0, '09:00', 'henna', 'Carla Mendes', '(62) 98333-4455', 'concluido', { source: 'painel' }),
        bk(0, '13:30', 'cilios', 'Ana Paula Ribeiro', '(62) 98111-2233', 'confirmado', { note: 'Manutenção — volume russo' }),
        bk(0, '16:30', 'design', 'Juliana Costa', '(62) 99222-3344', 'pendente'),
        bk(1, '10:30', 'lamination', 'Fernanda Lima', '(62) 99444-5566', 'pendente', { note: 'Primeira vez no studio' }),
        bk(1, '15:00', 'cilios', 'Mariana Souza', '(62) 98555-6677', 'confirmado'),
        bk(2, '09:00', 'design', 'Patrícia Gomes', '(62) 97700-1122', 'pendente'),
        bk(3, '18:00', 'henna', 'Camila Duarte', '(62) 98666-7788', 'confirmado', { source: 'painel' })
      ]
    };
  }

  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { return seed(); } };
  const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* modo privado */ } };
  const pk = { services: 'id', weekday_slots: 'weekday', blocks: 'id', bookings: 'id' };
  const dup = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };

  function builder(table) {
    let op = 'select', payload = null;
    const filters = [], orders = [];
    const b = {
      select() { return b; },
      eq(c, v) { filters.push((r) => r[c] === v); return b; },
      gte(c, v) { filters.push((r) => r[c] >= v); return b; },
      lte(c, v) { filters.push((r) => r[c] <= v); return b; },
      order(c) { orders.push(c); return b; },
      insert(p) { op = 'insert'; payload = p; return b; },
      update(p) { op = 'update'; payload = p; return b; },
      delete() { op = 'delete'; return b; },
      upsert(p) { op = 'upsert'; payload = p; return b; },
      then(res, rej) { return new Promise((r) => setTimeout(r, 120)).then(run).then(res, rej); }
    };
    const slotFree = (s, row) => table !== 'bookings' || row.status === 'cancelado' ||
      !s.bookings.some((x) => x.id !== row.id && x.status !== 'cancelado' && x.date === row.date && x.hour === row.hour);

    function run() {
      const s = load();
      const publicRead = op === 'select' && (table === 'services' || table === 'weekday_slots');
      if (!s.session && !publicRead) return { data: [], error: null };
      const match = (r) => filters.every((f) => f(r));
      if (op === 'select') {
        const out = s[table].filter(match);
        orders.slice().reverse().forEach((c) => out.sort((a, z) => String(a[c] ?? '').localeCompare(String(z[c] ?? ''))));
        return { data: JSON.parse(JSON.stringify(out)), error: null };
      }
      if (op === 'insert') {
        for (const p of [].concat(payload)) {
          const row = table === 'bookings' ? { status: 'pendente', source: 'site', ...p } : { ...p };
          if (row[pk[table]] == null) row[pk[table]] = 'n' + (s.seq++);
          if (s[table].some((r) => r[pk[table]] === row[pk[table]]) || !slotFree(s, row)) return dup;
          s[table].push(row);
        }
      } else if (op === 'update') {
        for (const r of s[table].filter(match)) {
          if (!slotFree(s, { ...r, ...payload })) return dup;
          Object.assign(r, payload);
        }
      } else if (op === 'delete') {
        s[table] = s[table].filter((r) => !match(r));
      } else if (op === 'upsert') {
        for (const p of payload) {
          const i = s[table].findIndex((r) => r[pk[table]] === p[pk[table]]);
          if (i >= 0) Object.assign(s[table][i], p); else s[table].push(p);
        }
      }
      save(s);
      return { data: null, error: null };
    }
    return b;
  }

  function rpc(name, a) {
    const s = load();
    const err = (m) => ({ data: null, error: { message: m } });
    if (name === 'is_admin') return { data: !!s.session, error: null };
    if (name === 'public_busy') {
      const out = s.bookings.filter((b) => b.status !== 'cancelado' && b.date >= a.d_from && b.date <= a.d_to).map((b) => ({ date: b.date, hour: b.hour }));
      s.blocks.filter((k) => k.date >= a.d_from && k.date <= a.d_to).forEach((k) => out.push({ date: k.date, hour: k.hour || '*' }));
      return { data: out, error: null };
    }
    if (name === 'create_booking') {
      const srv = s.services.find((x) => x.id === a.p_service && x.active);
      if (!srv) return err('SERVICO_INVALIDO');
      const [y, m, d] = a.p_date.split('-').map(Number);
      const wd = new Date(y, m - 1, d).getDay();
      if (!(s.weekday_slots.find((w) => w.weekday === wd)?.slots || []).includes(a.p_time)) return err('HORARIO_INVALIDO');
      if (s.blocks.some((k) => k.date === a.p_date && (!k.hour || k.hour === a.p_time))) return err('HORARIO_OCUPADO');
      if (s.bookings.some((b) => b.status !== 'cancelado' && b.date === a.p_date && b.hour === a.p_time)) return err('HORARIO_OCUPADO');
      const id = 'n' + (s.seq++);
      s.bookings.push({ id, service_id: srv.id, service_name: srv.name, price: srv.price, date: a.p_date, hour: a.p_time,
        client_name: a.p_name, client_phone: a.p_phone, note: a.p_note, status: 'pendente', source: 'site' });
      save(s);
      return { data: id, error: null };
    }
    if (name === 'cancel_booking') {
      const b = s.bookings.find((x) => x.id === a.p_id && x.client_phone.replace(/\D/g, '') === (a.p_phone || '').replace(/\D/g, ''));
      if (b) { b.status = 'cancelado'; save(s); }
      return { data: !!b, error: null };
    }
    return err('rpc desconhecida');
  }

  const DEMO_EMAIL = 'iedacarlos@demo.com';
  const DEMO_PASS = 'demo123';

  window.STUDIO_DEMO = true;
  window.STUDIO_CONFIG = { supabaseUrl: 'https://demo.local', supabaseAnonKey: 'demo' };
  window.supabase = {
    createClient: () => ({
      from: builder,
      rpc: (n, a) => new Promise((r) => setTimeout(() => r(rpc(n, a)), 120)),
      auth: {
        getSession: async () => ({ data: { session: load().session } }),
        signInWithPassword: async ({ email, password }) => {
          if (email !== DEMO_EMAIL || password !== DEMO_PASS) return { error: { message: 'Invalid login' } };
          const s = load(); s.session = { user: { email } }; save(s);
          return { error: null };
        },
        signOut: async () => { const s = load(); s.session = null; save(s); return { error: null }; }
      }
    })
  };

  // ---------- Faixa "modo demonstração" ----------
  document.addEventListener('DOMContentLoaded', () => {
    const isAdmin = /admin\.html$/.test(location.pathname);
    const bar = document.createElement('div');
    bar.setAttribute('role', 'note');
    bar.style.cssText = 'position:relative;z-index:100;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;justify-content:center;' +
      'padding:8px 12px;background:#b8915c;color:#fff;font:500 .78rem/1.3 Jost,system-ui,sans-serif;letter-spacing:.04em;text-align:center';
    const link = 'color:#fff;text-decoration:underline;cursor:pointer;background:none;border:0;font:inherit;padding:0';
    bar.innerHTML =
      '<span>✨ Modo demonstração — dados fictícios, nada é enviado</span>' +
      (isAdmin ? '<a href="index.html?demo" style="' + link + '">Ver site da cliente</a>'
               : '<a href="admin.html?demo" style="' + link + '">Ver painel da Iêda</a>') +
      '<button type="button" id="demoReset" style="' + link + '">Recomeçar demo</button>';
    document.body.prepend(bar);
    document.getElementById('demoReset').addEventListener('click', () => {
      if (!confirm('Apagar as alterações e voltar aos dados de exemplo?')) return;
      try { localStorage.removeItem(KEY); localStorage.removeItem('studio_ic_demo_mine'); } catch { /* ignore */ }
      location.reload();
    });

    // login já preenchido no painel
    const email = document.getElementById('email');
    const pass = document.getElementById('password');
    if (email && pass) {
      email.value = DEMO_EMAIL;
      pass.value = DEMO_PASS;
      const hint = document.querySelector('.login-card p');
      if (hint) hint.textContent = 'Demonstração: o acesso já está preenchido, é só tocar em Entrar.';
    }
  });
})();
