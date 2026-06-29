-- ═══════════════════════════════════════════════════════════════
-- Database Cleanup — Run with psql
-- ═══════════════════════════════════════════════════════════════
--
-- Cleans ALL data from both databases.
-- Run once for each database.
--
-- Usage:
--   1. Connect to API DB:
--        psql "<your-connection-string-for-ninbus-api-db>"
--      Then paste Part 1 below.
--
--   2. Connect to hawkBit DB:
--        psql "<your-connection-string-for-hawkbit-db>"
--      Then paste Part 2 below.
-- ═══════════════════════════════════════════════════════════════


-- ═══ PART 1: Ninbus API Database ═══

BEGIN;

TRUNCATE TABLE
    device_category_assignments,
    devices,
    company_members,
    companies,
    categories,
    posts,
    session,
    account,
    verification,
    "user"
CASCADE;

COMMIT;

-- Verify:
SELECT 'user' AS tbl, COUNT(*) FROM "user"
UNION ALL SELECT 'session', COUNT(*) FROM session
UNION ALL SELECT 'companies', COUNT(*) FROM companies
UNION ALL SELECT 'devices', COUNT(*) FROM devices
UNION ALL SELECT 'posts', COUNT(*) FROM posts;


-- ═══ PART 2: hawkBit Database ═══

BEGIN;

TRUNCATE TABLE
    sp_action_status,
    sp_action,
    sp_target_status,
    sp_target_update_status,
    sp_target_security_token,
    sp_target_filter_query,
    sp_target_tag,
    sp_software_module_tag,
    sp_distribution_set_tag,
    sp_distribution_set,
    sp_software_module,
    sp_artifact,
    sp_target,
    sp_target_attributes,
    sp_tag
CASCADE;

-- Restore required default DS type (hawkBit crashes without it)
INSERT INTO sp_distribution_set_type (id, created_at, last_modified_at, name, key, deleted)
VALUES (nextval('sp_distribution_set_type_seq'), now(), now(), 'os', 'os', false)
ON CONFLICT DO NOTHING;

COMMIT;

-- Verify:
SELECT 'targets', COUNT(*) FROM sp_target
UNION ALL SELECT 'ds', COUNT(*) FROM sp_distribution_set
UNION ALL SELECT 'sm', COUNT(*) FROM sp_software_module
UNION ALL SELECT 'artifacts', COUNT(*) FROM sp_artifact
UNION ALL SELECT 'actions', COUNT(*) FROM sp_action;
