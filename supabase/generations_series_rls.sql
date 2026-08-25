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
-- IMPORTANT : à exécuter SEULEMENT après le déploiement du commit qui fait
-- passer js/historique.js / js/serie.js / js/diagnostic-sommaire.js /
-- js/diagnostic-fusion.js / js/admin.js par api/data.js (resource:
-- 'generations'/'series', handleGenerations/handleSeries) au lieu d'un
-- accès Supabase direct. Sans ça, tout l'historique cesserait de se
-- charger/sauvegarder (dégradation déjà gérée côté client dans la plupart
-- des cas, mais autant éviter la fenêtre).
--
-- CORRECTIF (vérifié en prod) : les noms de politiques ci-dessous étaient
-- supposés, comme pour abonnes_rls.sql au départ, et ne correspondaient à
-- rien en réalité. RLS s'était donc bien activée mais les vraies
-- politiques ouvertes ("acces_public_lecture/ecriture/suppression",
-- "generations_select/update", "acces_series") étaient restées actives,
-- sans effet réel sur l'exposition des deux tables. Corrigé ci-dessous
-- avec les vrais noms.

drop policy if exists "generations anon read/write" on generations;
drop policy if exists "acces_public_lecture" on generations;
drop policy if exists "acces_public_ecriture" on generations;
drop policy if exists "acces_public_suppression" on generations;
drop policy if exists "generations_select" on generations;
drop policy if exists "generations_update" on generations;
drop policy if exists "series anon read/write" on series;
drop policy if exists "acces_series" on series;

alter table generations enable row level security;
alter table series enable row level security;

-- Aucune politique pour anon = accès refusé par défaut, lecture et
-- écriture, sur les deux tables. Le service_role (api/data.js) continue
-- de tout voir, il ne passe jamais par RLS.
