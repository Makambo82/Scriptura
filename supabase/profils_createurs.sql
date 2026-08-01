-- Table du Profil Créateur (mémoire vivante par code utilisateur).
-- À exécuter une fois dans l'éditeur SQL de Supabase avant que la
-- fonctionnalité "Profil Créateur" (js/profil.js) ne puisse persister
-- quoi que ce soit. Tant que cette table n'existe pas, l'app continue
-- de fonctionner normalement, sans mémoire (dégradation silencieuse).

create table if not exists profils_createurs (
  code_acces text primary key,
  profil     jsonb not null default '{}'::jsonb,
  maj_le     timestamptz default now()
);

-- Active la RLS et autorise la clé publishable (déjà utilisée par le
-- reste de l'app) à lire/écrire, comme sur tes tables quotas/generations/
-- series existantes. Si tes autres tables utilisent une politique plus
-- fine (liée à un utilisateur authentifié par ex.), aligne celle-ci sur
-- la même politique plutôt que sur ce modèle par défaut.
alter table profils_createurs enable row level security;

create policy "profils_createurs anon read/write"
  on profils_createurs
  for all
  using (true)
  with check (true);
