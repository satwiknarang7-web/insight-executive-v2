-- More kinds of database can be saved as a connection.
--
-- `public.connections.source` carries a CHECK naming the sources the app can
-- drive. Flavours of an existing driver (Redshift over Postgres, MariaDB over
-- MySQL, Azure SQL over SQL Server) store under the base source and need no
-- change here. These five have drivers of their own — ClickHouse, Databricks
-- and Trino over their REST protocols, MongoDB through its driver, Airtable
-- through its API — so the constraint has to name them.
--
-- The constraint is dropped and re-added rather than altered in place because
-- Postgres has no ALTER CHECK. Nothing else about the table changes.

alter table public.connections
  drop constraint if exists connections_source_check;

alter table public.connections
  add constraint connections_source_check check (source in (
    'postgres', 'supabase', 'mysql', 'sqlserver',
    'oracle', 'snowflake', 'fabric', 'tableau',
    'clickhouse', 'databricks', 'trino', 'mongodb', 'airtable'));
