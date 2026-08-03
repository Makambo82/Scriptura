-- Favoris dans « Mes générations »
-- Ajoute une colonne booléenne "favori" aux générations et aux séries.
-- À exécuter UNE fois dans Supabase (SQL Editor). Sans risque : "if not exists"
-- évite toute erreur si la colonne existe déjà, et la valeur par défaut (false)
-- garde toutes les lignes existantes non favorites.

alter table generations add column if not exists favori boolean not null default false;
alter table series      add column if not exists favori boolean not null default false;
