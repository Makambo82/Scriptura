-- Compteur d'usage serveur, INFALSIFIABLE par le client, pour les quotas et
-- le filet anonyme. À exécuter UNE fois dans l'éditeur SQL de Supabase.
--
-- POURQUOI une nouvelle table plutôt que de compter les lignes `generations` :
-- jusqu'ici, api/_lib/acces.js comptait les lignes `generations` du code pour
-- décider si le quota mensuel/à vie était atteint. Mais `generations` reste
-- en lecture/écriture ouverte au rôle anon (voir historique.js deleteGenerations,
-- utilisé par "Mes générations" pour la suppression normale) : un utilisateur
-- pouvait donc supprimer ses propres lignes pour faire "réapparaître" du
-- quota à volonté, indéfiniment. Cette table est séparée, jamais exposée au
-- client (RLS fermée dès sa création, aucune policy anon), donc aucune
-- suppression/manipulation cliente ne peut plus influencer le comptage.
--
-- POURQUOI des fonctions (RPC) plutôt qu'un simple SELECT puis UPDATE :
-- un lire-puis-écrire depuis le code Node n'est pas atomique, deux requêtes
-- strictement simultanées peuvent toutes les deux lire "encore un jeton/slot
-- disponible" avant que l'une ou l'autre n'écrive, et consommer la même
-- ressource deux fois. Ces fonctions font l'incrémentation/décrémentation
-- ET la vérification du plafond en UNE seule instruction SQL, atomique par
-- construction (verrouillage de ligne géré par Postgres lui-même).

create table if not exists usage_serveur (
  ref     text primary key,
  used    int not null default 0,
  maj_le  timestamptz not null default now()
);

alter table usage_serveur enable row level security;
-- Aucune politique pour le rôle anon = accès refusé par défaut. Seul le
-- service_role (api/_lib/acces.js) lit/écrit cette table, il ne passe
-- jamais par RLS.

-- Incrémente `ref` de `p_increment` (1 par défaut) SI le compteur reste sous
-- `p_plafond` une fois l'incrément appliqué, sinon ne fait rien. Renvoie true
-- si l'incrémentation a eu lieu (donc si le créateur peut consommer ce/ces
-- slot(s)), false si le plafond serait dépassé. p_increment>1 sert au quota
-- d'images de montage (retour propriétaire : une vidéo de 10 images et une
-- de 30 ne coûtent pas pareil, le quota se compte donc en images générées,
-- pas en nombre de montages, décomptées en un seul appel atomique par lot).
create or replace function consommer_usage(p_ref text, p_plafond int, p_increment int default 1)
returns boolean
language plpgsql
as $$
declare
  v_used int;
begin
  -- La ligne SELECT (au lieu de VALUES) filtre aussi la toute première
  -- insertion : sans elle, un p_increment supérieur à p_plafond dès la
  -- première consommation de ce ref passerait sans jamais être comparé au
  -- plafond (seul le cas "ref déjà existant" était protégé par le WHERE
  -- du ON CONFLICT).
  insert into usage_serveur (ref, used, maj_le)
  select p_ref, p_increment, now()
  where p_increment <= p_plafond
  on conflict (ref) do update
    set used = usage_serveur.used + p_increment, maj_le = now()
    where usage_serveur.used + p_increment <= p_plafond
  returning used into v_used;
  return v_used is not null;
end;
$$;

-- Décompte 1 jeton (`abonnes.jetons_audit`) pour ce code SI le solde est
-- encore positif, sinon ne fait rien. Renvoie true si décompté.
create or replace function decrementer_jeton(p_code text)
returns boolean
language plpgsql
as $$
declare
  v_restant int;
begin
  update abonnes
  set jetons_audit = jetons_audit - 1
  where code = p_code and jetons_audit > 0
  returning jetons_audit into v_restant;
  return v_restant is not null;
end;
$$;
