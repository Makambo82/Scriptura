-- Table de suivi des vidéos générées (montage automatique depuis un storyboard).
-- À exécuter une fois dans l'éditeur SQL de Supabase.

create table if not exists videos (
  id          uuid primary key default gen_random_uuid(),
  code_acces  text not null,
  mode        text not null,              -- 'script' ou 'story'
  titre       text,
  statut      text not null default 'en_cours',  -- en_cours | pret | erreur
  url         text,                        -- URL publique du mp4 une fois prêt
  erreur      text,                        -- message d'erreur si statut = 'erreur'
  created_at  timestamptz not null default now()
);

alter table videos enable row level security;

create policy "videos anon read/write"
  on videos
  for all
  using (true)
  with check (true);

-- ═══════════════════════════════════════════════════════════
-- BUCKET DE STOCKAGE (à créer manuellement, pas par SQL) :
-- 1. Dans Supabase → Storage → "New bucket"
-- 2. Nom EXACT : videos
-- 3. Coche "Public bucket" (pour que les vidéos soient lisibles directement
--    par leur URL, comme n'importe quelle vidéo sur le web)
-- 4. Crée le bucket.
-- Sans ce bucket, la génération de vidéo échouera à l'étape finale
-- (l'image et la voix auront quand même été générées, mais le montage
-- ne pourra pas être sauvegardé).
--
-- Ensuite, exécute CETTE partie dans le SQL Editor (après avoir créé le
-- bucket) pour autoriser l'app à y déposer des fichiers — même politique
-- ouverte que le reste des tables de l'app :
-- ═══════════════════════════════════════════════════════════

create policy "videos bucket anon read/write"
  on storage.objects
  for all
  using (bucket_id = 'videos')
  with check (bucket_id = 'videos');
