# Ativar o banco de dados (Supabase) — ~10 minutos

Sem estes passos o site funciona em **modo local** (agendamentos ficam só no celular da cliente).

## 1. Criar o projeto
1. Entre em https://supabase.com e crie uma conta (grátis).
2. **New project** → nome `studio-ieda-carlos`, região **South America (São Paulo)**, defina uma senha do banco e guarde.

## 2. Criar as tabelas
1. Menu **SQL Editor** → **New query**.
2. Cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**.

## 3. Criar o login da Iêda
1. Menu **Authentication → Users → Add user → Create new user**.
2. E-mail e senha da Iêda, marque **Auto Confirm User**.
3. Volte ao **SQL Editor** e rode (trocando o e-mail):
   ```sql
   insert into public.admins (user_id)
     select id from auth.users where email = 'EMAIL-DA-IEDA';
   ```
4. **Authentication → Sign In / Providers → Email**: desligue **Allow new users to sign up**
   (ninguém além da Iêda precisa criar conta).

## 4. Ligar o site ao banco
1. **Project Settings → API** (ou **Data API**): copie a **Project URL** e a **anon public key**.
2. Cole em `config.js`:
   ```js
   window.STUDIO_CONFIG = {
     supabaseUrl: 'https://xxxx.supabase.co',
     supabaseAnonKey: 'eyJ...'
   };
   ```
   A chave *anon* é pública por natureza; quem protege os dados são as regras (RLS) do `schema.sql`.
   **Nunca** coloque aqui a chave `service_role`.
3. Publique (commit + push). Pronto:
   - Site das clientes: `https://wesleymarz01.github.io/studio-ieda-carlos/`
   - Painel da Iêda: `https://wesleymarz01.github.io/studio-ieda-carlos/admin.html`

## Segurança (testada com 28 testes automáticos)
- Clientes só conseguem **criar** e **cancelar o próprio** agendamento (com o mesmo WhatsApp).
- O site público vê apenas quais horários estão ocupados, **sem nome nem telefone**.
- O banco impede dois agendamentos no mesmo dia/horário e limita 3 horários futuros por WhatsApp.
- Só usuários cadastrados na tabela `admins` acessam o painel.

## Observação
O plano grátis do Supabase pausa o projeto após 7 dias **sem nenhum acesso**. Com agendamentos
acontecendo isso não ocorre; se pausar, é só clicar em **Restore** no painel do Supabase.
