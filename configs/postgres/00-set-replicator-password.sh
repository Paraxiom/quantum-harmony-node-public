#!/bin/bash
set -euo pipefail

# Create replicator role using password from environment variable.
# Runs as a docker-entrypoint-initdb.d script before 01-init.sql.

if [ -z "${REPLICATOR_PASSWORD:-}" ]; then
    echo "ERROR: REPLICATOR_PASSWORD is not set" >&2
    exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'replicator') THEN
            CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '${REPLICATOR_PASSWORD}';
        END IF;
    END
    \$\$;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO replicator;
EOSQL
