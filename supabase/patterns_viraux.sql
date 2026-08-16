-- Mémoire partagée des recettes virales (cerveau commun de Scriptura).
-- Chaque vidéo analysée dans le mode « Analyser une vidéo virale » qui passe
-- le GARDE-FOU (score de recette >= 90 ET performance réelle forte, c.-à-d.
-- portée au-delà de l'audience, pas un coup de chance) dépose ici une version
-- DISTILLÉE et ANONYMISÉE de sa recette : jamais le transcript, jamais le
-- pseudo de l'auteur. Uniquement des leviers transposables. Ces patterns
-- nourrissent ensuite les générations (script, récit, idées) de TOUS les
-- utilisateurs, la niche de la génération en cours étant servie en priorité.
--
-- À exécuter une fois dans l'éditeur SQL de Supabase. Tant que la table
-- n'existe pas, l'app continue de fonctionner normalement, sans mémoire
-- partagée (dégradation silencieuse, ni écriture ni lecture ne cassent).

create table if not exists patterns_viraux (
  id            uuid primary key default gen_random_uuid(),
  cree_le       timestamptz default now(),
  niche         text,                    -- thème/domaine (ex. « finance perso »)
  hook_technique text,                   -- nom court de la technique d'accroche
  leviers       jsonb default '[]'::jsonb, -- signaux viraux réellement présents
  principes     jsonb default '[]'::jsonb, -- [{titre, detail}] transposables
  squelette     jsonb default '[]'::jsonb, -- [{temps, titre}] déroulé sans verbatim
  score         int,                     -- score de recette (>= 90 pour entrer)
  portee        numeric,                 -- vues / abonnés de l'auteur
  engagement    numeric,                 -- % d'engagement réel
  langue        text
);

-- Lecture ciblée par niche + tri par fraîcheur.
create index if not exists patterns_viraux_niche_idx on patterns_viraux (niche);
create index if not exists patterns_viraux_cree_le_idx on patterns_viraux (cree_le desc);

-- Même politique que les autres tables de l'app : la clé publishable (anon)
-- lit/écrit. Si tes autres tables ont une politique plus fine, aligne-toi.
alter table patterns_viraux enable row level security;

create policy "patterns_viraux anon read/write"
  on patterns_viraux
  for all
  using (true)
  with check (true);
