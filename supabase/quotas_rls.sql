-- Verrouille `quotas` complètement pour le rôle anon.
--
-- Cette table servait à l'origine de compteur de générations gratuites,
-- écrit EN DIRECT par le navigateur (fetchServerQuota/bumpServerQuota,
-- js/api.js) : purement déclaratif, un utilisateur pouvait donc réécrire
-- son propre compteur à zéro. Depuis la passe précédente, la vraie limite
-- des générations gratuites est vérifiée côté serveur via `usage_serveur`
-- (jamais exposée au client) : `quotas` ne sert plus qu'à un affichage de
-- confort (synchroniser le compteur "générations gratuites" entre les
-- appareils d'un même visiteur), qui n'a plus aucun rôle de sécurité.
--
-- Verrouiller cette table arrête cette synchronisation d'affichage entre
-- appareils (fetchServerQuota renvoie alors null, déjà géré : l'app retombe
-- sur le compteur local de l'appareil, sans erreur ni blocage). Rien
-- d'autre n'en dépend.

-- CORRECTIF (vérifié en prod) : le nom ci-dessus était supposé, comme pour
-- abonnes_rls.sql au départ, et ne correspondait à rien en réalité. RLS
-- s'était donc bien activée mais les vraies politiques ouvertes
-- ("quotas_insert", "quotas_select", "quotas_update") étaient restées
-- actives, sans effet réel. Corrigé ci-dessous avec les vrais noms.
drop policy if exists "quotas anon read/write" on quotas;
drop policy if exists "quotas_insert" on quotas;
drop policy if exists "quotas_select" on quotas;
drop policy if exists "quotas_update" on quotas;

alter table quotas enable row level security;

-- Aucune politique pour anon = accès refusé par défaut, lecture et
-- écriture. Le service_role continue de tout voir, il ne passe jamais par
-- RLS (aucune route serveur n'utilise plus cette table aujourd'hui).
