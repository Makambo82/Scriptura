-- Montage vidéo (fondateur uniquement) : bucket de stockage pour les images
-- et l'audio uploadés le temps d'un rendu JSON2Video. À exécuter UNE fois
-- dans Supabase (SQL Editor). "on conflict do nothing" évite toute erreur
-- si le bucket existe déjà.

insert into storage.buckets (id, name, public)
values ('montages', 'montages', true)
on conflict (id) do nothing;

create policy "montages public read"
on storage.objects for select
using (bucket_id = 'montages');

create policy "montages anon upload"
on storage.objects for insert
with check (bucket_id = 'montages');
