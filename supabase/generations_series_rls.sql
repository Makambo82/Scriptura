-- Verrouille `generations` et `series` complètement pour le rôle anon.
-- C'est le cœur de l'app : tout l'historique, les favoris, les séries.
--
-- Jusqu'ici, ces deux tables étaient grandes ouvertes (using(true) with
-- check(true)) : un appel direct à Supabase, sans passer par l'interface,
-- pouvait lire l'historique de N'IMPORTE QUEL code d'accès, le modifier,
-- ou le supprimer (les fonctions de suppression/favoris en masse du client
-- ne vérifiaient même pas côté client que les ids visés appartenaient bien
-- à l'utilisateur courant, elles faisaient confiance à l'interface).
--
-- IMPORTANT : à exécuter SEULEMENT après le déploiement du commit qui
-- ajoute api/generations.js et api/series.js, et fait passer
-- js/historique.js / js/serie.js / js/diagnostic-sommaire.js /
-- js/diagnostic-fusion.js / js/admin.js par ces routes au lieu d'un accès
-- Supabase direct. Sans ça, tout l'historique cesserait de se charger/
-- sauvegarder (dégradation déjà gérée côté client dans la plupart des cas,
-- mais autant éviter la fenêtre).

drop policy if exists "generations anon read/write" on generations;
drop policy if exists "series anon read/write" on series;

alter table generations enable row level security;
alter table series enable row level security;

-- Aucune politique pour anon = accès refusé par défaut, lecture et
-- écriture, sur les deux tables. Le service_role (api/generations.js,
-- api/series.js, api/admin-stats.js) continue de tout voir, il ne passe
-- jamais par RLS.
