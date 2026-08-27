package lab.dota.parser;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class ExportConfigTest {
    @Test void readsLimits() {
        ExportConfig config = ExportConfig.fromEnvironment(Map.of(
                "PARSER_MAX_INPUT_BYTES", "10",
                "PARSER_MAX_OUTPUT_BYTES", "20",
                "PARSER_MAX_RECORDS", "30",
                "PARSER_TIMEOUT_SECONDS", "40",
                "CHECKPOINT_INTERVAL_SECONDS", "2.5"));
        assertEquals(10, config.maxInputBytes());
        assertEquals(20, config.maxOutputBytes());
        assertEquals(30, config.maxRecords());
        assertEquals(40, config.timeoutSeconds());
        assertEquals(2.5, config.checkpointIntervalSeconds());
    }

    @Test void rejectsNonPositiveLimits() {
        assertThrows(IllegalArgumentException.class,
                () -> ExportConfig.fromEnvironment(Map.of("PARSER_MAX_RECORDS", "0")));
    }

    @Test void describesOnlyTheExplicitEntityClassesUsedByTheProfile() {
        ExportConfig config = ExportConfig.fromEnvironment(Map.of());
        assertEquals(java.util.List.of("CDOTA_DataRadiant", "CDOTA_DataDire", "CDOTAGamerulesProxy",
                        "CDOTA_PlayerResource", "CDOTA_Unit_Hero_.*", "CDOTA_DataSpectator",
                        "CDOTASpectatorGraphManagerProxy"),
                config.asMap().get("entityClassPatterns"));
        assertEquals(100L, config.asMap().get("positionSampleIntervalMilliseconds"));
        assertEquals("match-analysis-v3", config.asMap().get("profile"));
    }
}
