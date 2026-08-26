-- Audit metadata for replay jobs chosen by the ranked-match sampler.

CREATE TABLE catalog.match_selections (
    selection_id UUID PRIMARY KEY DEFAULT uuid(),
    match_id UBIGINT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    selection_group VARCHAR NOT NULL CHECK (selection_group IN ('priority', 'control', 'fill')),
    avg_rank_tier USMALLINT,
    source VARCHAR NOT NULL,
    sampling_version VARCHAR NOT NULL,
    extraction_id VARCHAR NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT current_timestamp,
    UNIQUE (match_id, sampling_version)
);

CREATE INDEX match_selections_window_idx
    ON catalog.match_selections (window_start, selection_group);
