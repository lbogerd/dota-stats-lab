package lab.dota.parser;

import java.util.LinkedHashMap;
import java.util.Map;

record ExportConfig(long maxInputBytes, long maxOutputBytes, long maxRecords,
                    long timeoutSeconds, double checkpointIntervalSeconds) {
    static ExportConfig fromEnvironment(Map<String, String> env) {
        return new ExportConfig(
                positiveLong(env, "PARSER_MAX_INPUT_BYTES", 2L * 1024 * 1024 * 1024),
                positiveLong(env, "PARSER_MAX_OUTPUT_BYTES", 1024L * 1024 * 1024),
                positiveLong(env, "PARSER_MAX_RECORDS", 2_000_000L),
                positiveLong(env, "PARSER_TIMEOUT_SECONDS", 180L),
                positiveDouble(env, "CHECKPOINT_INTERVAL_SECONDS", 30.0));
    }

    Map<String, Object> asMap() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("profile", ReplayExporter.PROFILE);
        result.put("maxInputBytes", maxInputBytes);
        result.put("maxOutputBytes", maxOutputBytes);
        result.put("maxRecords", maxRecords);
        result.put("timeoutSeconds", timeoutSeconds);
        result.put("checkpointIntervalSeconds", checkpointIntervalSeconds);
        result.put("messageTypes", java.util.List.of(
                "CMsgDOTAMatch", "CDOTAMatchMetadataFile", "CMsgDOTACombatLogEntry"));
        result.put("entityClassPatterns", java.util.List.of());
        return result;
    }

    private static long positiveLong(Map<String, String> env, String name, long fallback) {
        String raw = env.get(name);
        if (raw == null || raw.isBlank()) return fallback;
        try {
            long value = Long.parseLong(raw);
            if (value <= 0) throw new IllegalArgumentException(name + " must be positive");
            return value;
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(name + " must be an integer", e);
        }
    }

    private static double positiveDouble(Map<String, String> env, String name, double fallback) {
        String raw = env.get(name);
        if (raw == null || raw.isBlank()) return fallback;
        try {
            double value = Double.parseDouble(raw);
            if (!Double.isFinite(value) || value <= 0) throw new IllegalArgumentException(name + " must be positive");
            return value;
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(name + " must be a number", e);
        }
    }
}
