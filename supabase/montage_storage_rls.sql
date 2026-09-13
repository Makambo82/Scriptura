-- Ferme le bucket `montages` à l'anon (lecture ET écriture) et le passe en
-- privé. À exécuter APRÈS le déploiement du commit qui fait passer
-- js/montage.js et js/montage-manuel.js par les nouvelles actions
-- serveur `montage-storage` (resource=montage-storage, action=upload-url /
-- read-url, voir api/data.js) au lieu d'appeler supabaseClient.storage
-- directement.
--
-- AUDIT A3 : supabase/montage_storage.sql créait ce bucket en `public: true`
-- avec deux policies grandes ouvertes :
--   - "montages public read"  : select using(true)       -- lecture anonyme
--   - "montages anon upload"  : insert with check(true)   -- écriture anonyme
-- N'importe qui, avec la seule clé publique déjà présente dans le JS servi,
-- pouvait donc déposer des fichiers arbitraires dans ce bucket (coût de
-- stockage, contenu illégitime servi depuis le domaine Supabase du projet)
-- ou lire n'importe quel objet dont il devinait/trouvait le chemin, sans
-- jamais passer par verifierAccesMontage (réservé aux abonnés Creator/Pro,
-- voir api/_lib/acces.js). Scriptura n'utilise jamais de vraie session
-- Supabase (l'authentification se fait par code d'accès, jamais par
-- supabase.auth) : la RLS ne peut donc pas distinguer un abonné d'un
-- visiteur quelconque, la seule vérification possible passe par le serveur,
-- avec la clé service_role (voir handleMontageStorage, api/data.js).
--
-- IMPORTANT : ne supprime AUCUN objet déjà stocké, seulement l'ACCÈS anon.
-- Les fichiers existants (uploads en cours, anciens rendus) restent en
-- place, lisibles uniquement par le service_role désormais (donc par les
-- routes serveur, jamais plus directement par le navigateur).

drop policy if exists "montages public read" on storage.objects;
drop policy if exists "montages anon upload" on storage.objects;

update storage.buckets set public = false where id = 'montages';

-- Aucune policy pour anon = accès refusé par défaut, lecture et écriture.
-- Le service_role (api/data.js, render-service/server.js pour la lecture
-- lors du rendu et le ré-upload du rendu final) continue de tout voir, il
-- ne passe jamais par RLS.
