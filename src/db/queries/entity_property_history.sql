-- Bind: extraction_id (VARCHAR), instance_id (UBIGINT), property_path (VARCHAR).
SELECT *
FROM analysis.entity_property_history(?::VARCHAR, ?::UBIGINT, ?::VARCHAR);
