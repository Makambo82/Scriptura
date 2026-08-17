-- Verrouille l'ÉCRITURE de `patterns_viraux` (mémoire virale partagée) pour
-- le rôle anon, garde la LECTURE publique (donnée déjà anonymisée/distillée,
-- faite pour inspirer les générations de tous les créateurs).
--
-- Jusqu'ici, la table était grande ouverte en lecture ET écriture
-- (`patterns_viraux anon read/write`, using(true) with check(true)) : un
-- appel direct à Supabase (sans passer par api/patterns.js) pouvait déposer
-- n'importe quel contenu, sans repasser par le garde-fou (score >= 85 ET
-- performance réelle) que /api/patterns.js revérifie pourtant déjà.
--
-- IMPORTANT : à exécuter SEULEMENT après le déploiement du commit qui fait
-- passer api/patterns.js sur SUPABASE_SERVICE_ROLE_KEY (au lieu de la clé
-- anon) pour écrire. Sans cette clé configurée sur Vercel, l'endpoint
-- continuera de fonctionner en lecture, mais plus personne ne pourra écrire
-- de nouveau pattern (dégradation silencieuse, ok:false, rien ne casse).

drop policy if exists "patterns_viraux anon read/write" on patterns_viraux;

create policy "patterns_viraux anon read"
  on patterns_viraux
  for select
  using (true);

-- Aucune politique insert/update/delete pour anon = refusé par défaut.
-- Le service_role (api/patterns.js) continue de tout pouvoir, il ne passe
-- jamais par RLS.
