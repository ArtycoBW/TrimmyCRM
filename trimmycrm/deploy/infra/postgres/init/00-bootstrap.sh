#!/bin/sh
set -eu

psql --set ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_user="$POSTGRES_APP_USER" \
  --set=app_password="$POSTGRES_APP_PASSWORD" \
  --set=api_admin_user="$POSTGRES_API_ADMIN_USER" \
  --set=api_admin_password="$POSTGRES_API_ADMIN_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'app_user', :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'app_user', :'app_password'
)
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_user')
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_user')
\gexec

SELECT format('ALTER ROLE %I SET statement_timeout = %L', :'app_user', '15s')
\gexec
SELECT format('ALTER ROLE %I SET lock_timeout = %L', :'app_user', '5s')
\gexec
SELECT format('ALTER ROLE %I SET idle_in_transaction_session_timeout = %L', :'app_user', '30s')
\gexec

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'api_admin_user', :'api_admin_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'api_admin_user')
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'api_admin_user', :'api_admin_password'
)
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'api_admin_user')
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'api_admin_user')
\gexec
SELECT format('ALTER ROLE %I SET statement_timeout = %L', :'api_admin_user', '30s')
\gexec
SELECT format('ALTER ROLE %I SET lock_timeout = %L', :'api_admin_user', '5s')
\gexec
SELECT format(
  'ALTER ROLE %I SET idle_in_transaction_session_timeout = %L',
  :'api_admin_user', '30s'
)
\gexec
SQL
