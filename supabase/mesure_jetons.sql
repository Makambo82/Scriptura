-- ═══════════════════════════════════════════════════════════
--  MESURER CE QU'UNE GÉNÉRATION COÛTE VRAIMENT
--
--  À LANCER UNE FOIS dans l'éditeur SQL de Supabase.
--
--  Pourquoi : le tableau de bord dit que 8 générations ont vidé 5 € de crédit
--  Anthropic, et personne ne pouvait répondre à « les 40 générations du plan
--  Creator me coûteront combien ? » autrement qu'en estimant. L'app jetait
--  pourtant les chiffres que le fournisseur lui envoyait à chaque appel.
--
--  Ces colonnes les gardent. Aucune donnée de contenu : des entiers, un
--  verdict d'un mot, rien qui permette de reconstituer un script.
--
--  TANT QUE CE FICHIER N'EST PAS LANCÉ, RIEN NE CASSE : api/data.js réessaie
--  l'insertion sans ces colonnes, donc la mesure des passes (qui marche déjà)
--  continue, et seule la mesure des jetons manque à l'appel.
-- ═══════════════════════════════════════════════════════════

alter table public.passes_generation
  -- Jetons réellement facturés par Anthropic pour TOUTE la génération,
  -- toutes passes confondues (brief, écriture, critique, révision,
  -- correction de durée, juge, prompts visuels).
  add column if not exists jetons_entree       integer default 0,
  add column if not exists jetons_sortie       integer default 0,
  -- Mise en cache des prompts : à zéro aujourd'hui, l'app n'en fait pas.
  -- Ces deux colonnes existent pour pouvoir MESURER un éventuel passage au
  -- cache au lieu d'en discuter (Haiku 4.5 exige un préfixe d'au moins 4096
  -- jetons, ce qui n'est pas acquis ici : voir le commentaire dans js/api.js).
  add column if not exists jetons_cache_lu     integer default 0,
  add column if not exists jetons_cache_ecrit  integer default 0,
  -- Nombre d'appels IA réels de la génération. Croisé avec les jetons, il dit
  -- si le coût vient du nombre d'allers-retours ou de leur taille.
  add column if not exists appels_ia           integer default 0,

  -- Ce que le PREMIER critique a déclaré. Le second brouillon complet part
  -- dans 85 % des générations : ces colonnes disent si c'est parce que les
  -- premiers jets sont vraiment faibles, ou parce que le déclencheur est mal
  -- posé (« raisons_de_scroll » non vide suffit à lancer la révision, et le
  -- formulaire imposé au critique en montre déjà deux en exemple).
  add column if not exists critique_verdict         text,
  add column if not exists critique_ia_generique    boolean,
  add column if not exists critique_raisons_scroll  integer default 0,
  add column if not exists critique_viralite        numeric(4,1);

-- Lecture réservée au service_role, comme le reste de cette table : ces
-- chiffres disent le coût d'exploitation, ils ne regardent pas les abonnés.
