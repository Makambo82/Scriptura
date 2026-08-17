-- Verrouille `profils_createurs` (mémoire vivante par code : niches,
-- thèmes à éviter, hooks récents, dernier score d'audit...) complètement
-- pour le rôle anon. C'est une donnée PRIVÉE par utilisateur : la
-- politique ouverte d'origine (`profils_createurs anon read/write`,
-- using(true) with check(true)) permettait à quiconque de lire ou modifier
-- le profil de n'importe quel autre code d'accès.
--
-- IMPORTANT : à exécuter SEULEMENT après le déploiement du commit qui
-- ajoute api/profil-createur.js et fait passer js/profil.js par cette
-- route au lieu d'un accès Supabase direct. Sans ça, la mémoire créateur
-- cesserait de se charger/sauvegarder (dégradation silencieuse déjà
-- gérée côté client, rien ne casse, mais plus aucune mémoire ne persiste).

drop policy if exists "profils_createurs anon read/write" on profils_createurs;

alter table profils_createurs enable row level security;

-- Aucune politique pour anon = accès refusé par défaut. Seul le
-- service_role (api/profil-createur.js) lit/écrit cette table.
