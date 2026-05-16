-- Runs once when the postgres container is first initialised. Creates the
-- separate test database so `npm test` can wipe state without touching the
-- dev/app database.
CREATE DATABASE yeet_test;
