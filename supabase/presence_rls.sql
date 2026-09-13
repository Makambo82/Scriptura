-- Verrouille `presence` complètement pour le rôle anon (lecture ET écriture).
--
-- AUDIT A19 : cette table était restée grande ouverte (`presence anon
-- read/write`, using(true) with check(true), voir supabase/presence.sql)
-- alors que toutes les autres tables sensibles du projet (abonnes,
-- generations, series, profils_createurs, quotas, patterns_viraux) avaient
-- déjà reçu ce même traitement. `ref` vaut le CODE D'ACCÈS de l'abonné
-- connecté (voir getUserRef, js/api.js, et envoyerPresence, js/app.js) :
-- n'importe qui, sans le moindre compte, pouvait donc lire directement
-- Supabase avec la clé publique déjà présente dans le JS servi et obtenir
-- la liste des codes d'accès actuellement en ligne (`abonne=true`), soit
-- une usurpation de compte payant en une seule requête, sans mot de passe.
--
-- IMPORTANT : à exécuter SEULEMENT après le déploiement du commit qui fait
-- passer :
--   - l'écriture de présence (handlePresence, api/data.js) sur
--     SUPABASE_SERVICE_ROLE_KEY (au lieu de la clé publique) ;
--   - la lecture du statut en ligne côté Tableau de bord (chargerPresenceAdmin
--     / compterNonAbonnesEnLigne / chargerDetailNonAbonnesAdmin, js/admin.js)
--     sur la nouvelle route serveur authentifiée (resource: 'presence-admin',
--     api/data.js), qui ne renvoie jamais `ref` en clair.
-- Sans ce déploiement préalable, le signal de présence et le statut en ligne
-- du Tableau de bord cesseraient de fonctionner (dégradation déjà gérée côté
-- client dans les deux cas, rien ne casse, mais plus aucune donnée ne
-- remonterait).

drop policy if exists "presence anon read/write" on presence;

alter table presence enable row level security;

-- Aucune politique pour anon = accès refusé par défaut, lecture et
-- écriture. Le service_role (api/data.js) continue de tout voir, il ne
-- passe jamais par RLS.
