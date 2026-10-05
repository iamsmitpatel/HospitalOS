-- Creates a separate database for running e2e tests, isolated from the dev database.
SELECT 'CREATE DATABASE hospitalos_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'hospitalos_test')
\gexec
