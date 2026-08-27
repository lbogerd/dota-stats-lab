-- Store the server win probability from each replay. The source is one
-- selected replay series. It is not an application estimate.

CREATE TABLE analysis.win_probability_samples (
    extraction_id VARCHAR NOT NULL,
    sample_index UINTEGER NOT NULL,
    game_time_seconds DOUBLE NOT NULL
        CHECK (isfinite(game_time_seconds) AND game_time_seconds >= 0),
    radiant_probability DOUBLE NOT NULL
        CHECK (
            isfinite(radiant_probability)
            AND radiant_probability >= 0.0
            AND radiant_probability <= 1.0
        ),
    source VARCHAR NOT NULL
        CHECK (source IN ('graph_history', 'spectator_updates')),
    PRIMARY KEY (extraction_id, sample_index),
    UNIQUE (extraction_id, game_time_seconds)
);

CREATE OR REPLACE MACRO analysis.match_win_probability(requested_match_id) AS TABLE
SELECT
    sample.extraction_id,
    sample.sample_index,
    sample.game_time_seconds,
    sample.radiant_probability,
    sample.source
FROM analysis.win_probability_samples AS sample
JOIN analysis.latest_successful_extractions AS latest
  ON latest.extraction_id = sample.extraction_id
WHERE latest.match_id = requested_match_id
ORDER BY sample.game_time_seconds, sample.sample_index;
