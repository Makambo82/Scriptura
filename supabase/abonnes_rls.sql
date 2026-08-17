-- Verrouille la table `abonnes` (codes d'accès, plan, jetons, statut) : c'est
-- la table qui donne des DROITS (Pro, jetons, admin). Jusqu'ici, comme les
-- autres tables de l'app, elle a la politique "anon lit/écrit tout" (voir
-- presence.sql / patterns_viraux.sql / profils_createurs.sql qui la citent
-- comme référence commune) : n'importe qui, depuis la console du navigateur,
-- pouvait lire OU modifier n'importe quelle ligne avec la clé publique déjà
-- présente dans le JS servi (se donner Pro + jetons illimités, lire le code
-- d'accès de n'importe qui...).
--
-- À exécuter UNE fois dans l'éditeur SQL de Supabase.
--
-- IMPORTANT : à exécuter SEULEMENT après avoir ajouté SUPABASE_SERVICE_ROLE_KEY
-- dans les variables d'environnement Vercel (Réglages du projet Supabase >
-- API > "service_role"). Sans cette clé côté serveur, plus personne ne
-- pourrait se connecter (le serveur ne pourrait plus lire `abonnes` non plus).
--
-- CORRECTIF (vérifié en prod) : la première version de ce
-- fichier tentait de retirer une politique nommée "abonnes anon read/write",
-- un nom supposé mais qui ne correspondait à rien en réalité. La véritable
-- politique ouverte en prod s'appelle "lecture_publique_abonnes" (SELECT,
-- using(true), rôle public) : le premier passage de ce script avait donc
-- bien activé la RLS mais laissé cette politique active, sans effet réel
-- sur l'exposition de la table. Corrigé ci-dessous avec le vrai nom.

-- Retire la politique de lecture publique réellement en place.
drop policy if exists "lecture_publique_abonnes" on abonnes;
-- Gardé au cas où une autre politique aurait existé sous ce nom ailleurs.
drop policy if exists "abonnes anon read/write" on abonnes;

alter table abonnes enable row level security;

-- Aucune politique pour le rôle anon = accès refusé par défaut à ce rôle,
-- lecture et écriture. Le service_role (utilisé uniquement côté serveur,
-- api/_lib/acces.js) continue de tout voir : il ne passe jamais par RLS.
