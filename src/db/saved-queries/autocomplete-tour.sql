-- Autocomplete knows the analysis, catalog, and raw schemas.
-- Try adding another SELECT item by typing "e." on a new line.
-- Try typing "analysis." after FROM to browse views and table macros.
SELECT
    e.match_id,
    e.status,
    e.parser_name,
    e.parser_version,
    e.started_at,
    e.completed_at
FROM catalog.extractions AS e
ORDER BY e.started_at DESC
LIMIT 100;
