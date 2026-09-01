-- Table de présence (pour le statut "en ligne" du Tableau de bord).
-- À exécuter une fois dans l'éditeur SQL de Supabase. Chaque visiteur
-- (abonné ou non) envoie un signal "je suis encore là" toutes les minutes
-- tant que l'app est ouverte et visible à l'écran (voir envoyerPresence,
-- js/app.js). Tant que cette table n'existe pas, l'app continue de
-- fonctionner normalement (le signal échoue silencieusement).

create table if not exists presence (
  ref                text primary key,
  derniere_activite  timestamptz not null default now(),
  abonne             boolean not null default false,
  pays               text,
  navigateur         text
);

-- pays/navigateur (retour propriétaire : voir qui sont les non-abonnés en
-- ligne) : ajoutés après coup, idempotent pour une table déjà existante.
-- Renseignés côté serveur (api/data.js, resource=presence) à partir des
-- en-têtes de la requête (x-vercel-ip-country, user-agent), jamais
-- fournis tels quels par le client, jamais d'IP stockée (décision
-- propriétaire, donnée personnelle identifiante hors de propos ici).
alter table presence add column if not exists pays text;
alter table presence add column if not exists navigateur text;

-- Même politique que profils_createurs/quotas/generations/series :
-- lecture/écriture ouverte à la clé publishable déjà utilisée par l'app.
alter table presence enable row level security;

create policy "presence anon read/write"
  on presence
  for all
  using (true)
  with check (true);
