-- Mode « Tendances » : benchmark d'une niche TikTok entière (inspiré de
-- Vervox), pas un compte ni une vidéo précise. Une analyse cherche ~50
-- vidéos qui cartonnent sur le mot-clé de la niche (fetch_general_search,
-- TikHub), les transcrit, puis en tire un rapport : vues/likes médians,
-- engagement, momentum (récent vs ancien), classement des créateurs,
-- registre de langage et patterns de rétention.
--
-- Trop lourd pour une seule requête serverless (télécharger + transcrire
-- ~50 vidéos dépasse largement les 60-300s dont dispose une fonction
-- Vercel) : le job avance PAR ÉTAPES. `POST /api/tendances` (action=lancer)
-- crée la ligne et collecte les vidéos candidates (pas encore transcrites).
-- Le navigateur appelle ensuite (action=avancer) en boucle, chaque appel
-- transcrivant un petit lot, jusqu'à ce que `statut` passe à 'termine'.
--
-- Accès verrouillé au service_role UNIQUEMENT (comme generations_series_rls.sql) :
-- cette table n'est jamais lue ni écrite directement par le client, toujours
-- via api/tendances.js avec SUPABASE_SERVICE_ROLE_KEY, jamais exposée au
-- rôle anon. Réservé au plan Pro, 1 analyse par mois (voir api/_lib/acces.js).
--
-- À exécuter une fois dans l'éditeur SQL de Supabase. Tant que la table
-- n'existe pas, le mode Tendances reste indisponible proprement (aucune
-- autre fonctionnalité de l'app n'en dépend).

create table if not exists tendances_niche (
  id            uuid primary key default gen_random_uuid(),
  cree_le       timestamptz default now(),
  maj_le        timestamptz default now(),
  code_acces    text,                        -- créateur propriétaire (retrouver son historique)
  niche         text,
  zone          text,                        -- zone géographique (facultative, ex. "Côte d'Ivoire", "Europe")
  statut        text default 'en_cours',     -- 'en_cours' | 'termine' | 'echec'
  videos        jsonb default '[]'::jsonb,   -- [{id, desc, createTime, author, stats, hashtags, urlsCandidates, transcript, transcriptEchec}]
  index_suivant int default 0,               -- prochaine vidéo (dans `videos`) à transcrire
  resultat      jsonb,                       -- rapport final une fois statut='termine'
  erreur        text
);

create index if not exists tendances_niche_code_idx on tendances_niche (code_acces);
create index if not exists tendances_niche_cree_le_idx on tendances_niche (cree_le desc);

-- Ajoutée après la création initiale de la table (zone géographique, retour
-- du propriétaire) : idempotent, sans effet si la colonne existe déjà, donc
-- sûr à rejouer même si la table a été créée par la version ci-dessus.
alter table tendances_niche add column if not exists zone text;

alter table tendances_niche enable row level security;
-- Aucune politique pour anon = accès refusé par défaut. Le service_role
-- (api/tendances.js) continue de tout voir, il ne passe jamais par RLS.
