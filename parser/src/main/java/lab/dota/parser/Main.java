package lab.dota.parser;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream;
import skadistats.clarity.processor.runner.SimpleRunner;
import skadistats.clarity.source.MappedFileSource;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

public final class Main {
    static final String PARSER_NAME = "clarity";
    static final String PARSER_VERSION = "4.0.1";
    static final String EXPORTER_VERSION = "0.1.0";
    private static final BigInteger UINT64_MAX = BigInteger.ONE.shiftLeft(64).subtract(BigInteger.ONE);
    private static final ObjectMapper JSON = new ObjectMapper()
            .configure(MapperFeature.SORT_PROPERTIES_ALPHABETICALLY, true)
            .configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);

    private Main() {}

    public static void main(String[] args) {
        try {
            Result result = run(Arguments.parse(args, System.getenv()), System.getenv());
            System.out.println(JSON.writeValueAsString(Map.of(
                    "status", result.skipped() ? "already_extracted" : "extracted",
                    "extractionId", result.extractionId(),
                    "directory", result.directory().toString())));
        } catch (Exception e) {
            System.err.println("parser failed: " + rootMessage(e));
            System.exit(1);
        }
    }

    static Result run(Arguments args, Map<String, String> env) throws Exception {
        ExportConfig config = ExportConfig.fromEnvironment(env);
        Path replay = args.replay() != null ? args.replay() : defaultReplay(args.matchId());
        if (!Files.isRegularFile(replay)) throw new IOException("replay not found: " + replay);
        long inputSize = Files.size(replay);
        if (inputSize > config.maxInputBytes()) {
            throw new ExportLimitException("input limit exceeded: " + inputSize + " > " + config.maxInputBytes());
        }

        String actualSha = Hashing.sha256(replay);
        String expectedSha = args.replaySha256() != null ? args.replaySha256() : acquisitionSha(replay.getParent());
        if (expectedSha != null && !actualSha.equalsIgnoreCase(expectedSha)) {
            throw new IOException("replay SHA-256 mismatch: expected " + expectedSha + ", got " + actualSha);
        }

        byte[] canonicalConfig = JSON.writeValueAsBytes(config.asMap());
        String identityMaterial = actualSha + "\n" + PARSER_NAME + "\n" + PARSER_VERSION + "\n"
                + EXPORTER_VERSION + "\n" + new String(canonicalConfig, java.nio.charset.StandardCharsets.UTF_8);
        String extractionId = Hashing.sha256(identityMaterial.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        Path finalDirectory = args.stagingRoot().resolve(args.matchId()).resolve(extractionId);
        if (Files.isRegularFile(finalDirectory.resolve("manifest.json"))) {
            return new Result(extractionId, finalDirectory, true);
        }

        Path matchDirectory = finalDirectory.getParent();
        Files.createDirectories(matchDirectory);
        Path partial = matchDirectory.resolve("." + extractionId + ".partial-" + UUID.randomUUID());
        Files.createDirectories(partial);
        Instant started = Instant.now();
        Path decompressed = null;
        try {
            Path clarityInput = replay;
            if (replay.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".bz2")) {
                decompressed = Files.createTempFile("dota-replay-", ".dem");
                decompress(replay, decompressed, config.maxInputBytes());
                clarityInput = decompressed;
            }

            NdjsonSet files = new NdjsonSet(partial, JSON, config.maxOutputBytes(), config.maxRecords());
            ReplayExporter exporter = new ReplayExporter(extractionId, files, config, started);
            try (files; MappedFileSource source = new MappedFileSource(clarityInput.toString())) {
                new SimpleRunner(source).runWith(exporter);
                exporter.finish();
            }

            Instant completed = Instant.now();
            Map<String, Object> manifest = new LinkedHashMap<>();
            manifest.put("schemaVersion", 1);
            manifest.put("extractionId", extractionId);
            manifest.put("matchId", args.matchId());
            manifest.put("replaySha256", actualSha);
            manifest.put("parser", Map.of("name", PARSER_NAME, "version", PARSER_VERSION));
            manifest.put("exporterVersion", EXPORTER_VERSION);
            manifest.put("config", config.asMap());
            manifest.put("startedAt", DateTimeFormatter.ISO_INSTANT.format(started));
            manifest.put("completedAt", DateTimeFormatter.ISO_INSTANT.format(completed));
            manifest.put("elapsedMs", java.time.Duration.between(started, completed).toMillis());
            manifest.put("files", files.manifestFiles());
            manifest.put("counts", files.counts());
            Map<String, Object> acquisition = acquisitionData(replay.getParent());
            if (acquisition != null) manifest.put("acquisition", acquisition);
            long manifestBytes = JSON.writeValueAsBytes(manifest).length;
            if (files.totalBytes() + manifestBytes > config.maxOutputBytes()) {
                throw new ExportLimitException("output limit exceeded including manifest: " + config.maxOutputBytes() + " bytes");
            }
            writeJsonAtomically(partial.resolve("manifest.json"), manifest);
            publish(partial, finalDirectory);
            return new Result(extractionId, finalDirectory, false);
        } catch (Exception e) {
            Path failed = matchDirectory.resolve(extractionId + ".failed-" + Instant.now().toEpochMilli());
            try {
                writeJsonAtomically(partial.resolve("failure.json"), Map.of(
                        "extractionId", extractionId,
                        "failedAt", DateTimeFormatter.ISO_INSTANT.format(Instant.now()),
                        "error", rootMessage(e)));
                publish(partial, failed);
            } catch (Exception retainedFailure) {
                e.addSuppressed(retainedFailure);
            }
            throw e;
        } finally {
            if (decompressed != null) Files.deleteIfExists(decompressed);
        }
    }

    private static Path defaultReplay(String matchId) {
        Path directory = Path.of("/data/replays", matchId);
        Path compressed = directory.resolve("replay.dem.bz2");
        return Files.exists(compressed) ? compressed : directory.resolve("replay.dem");
    }

    private static String acquisitionSha(Path replayDirectory) {
        Map<String, Object> data = acquisitionData(replayDirectory);
        if (data == null) return null;
        for (String key : new String[]{"replaySha256", "sha256", "checksumSha256"}) {
            Object value = data.get(key);
            if (value instanceof String s && s.matches("(?i)[0-9a-f]{64}")) return s;
        }
        return null;
    }

    private static Map<String, Object> acquisitionData(Path replayDirectory) {
        if (replayDirectory == null) return null;
        Path acquisition = replayDirectory.resolve("acquisition.json");
        if (!Files.isRegularFile(acquisition)) return null;
        try {
            return JSON.readValue(acquisition.toFile(), new TypeReference<>() {});
        } catch (IOException e) {
            throw new IllegalArgumentException("invalid acquisition.json: " + acquisition, e);
        }
    }

    private static void decompress(Path source, Path target, long maxBytes) throws IOException {
        long written = 0;
        try (InputStream raw = Files.newInputStream(source);
             InputStream in = new BZip2CompressorInputStream(raw, true);
             OutputStream out = Files.newOutputStream(target)) {
            byte[] buffer = new byte[1024 * 1024];
            int read;
            while ((read = in.read(buffer)) >= 0) {
                written += read;
                if (written > maxBytes) throw new ExportLimitException("decompressed input limit exceeded: " + maxBytes);
                out.write(buffer, 0, read);
            }
        }
    }

    private static void writeJsonAtomically(Path target, Object value) throws IOException {
        Path temp = target.resolveSibling(target.getFileName() + ".tmp");
        JSON.writeValue(temp.toFile(), value);
        try {
            Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(temp, target);
        }
    }

    private static void publish(Path partial, Path target) throws IOException {
        try {
            Files.move(partial, target, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(partial, target);
        }
    }

    private static String rootMessage(Throwable error) {
        Throwable current = error;
        while (current.getCause() != null) current = current.getCause();
        return current.getClass().getSimpleName() + ": " + String.valueOf(current.getMessage());
    }

    record Result(String extractionId, Path directory, boolean skipped) {}

    record Arguments(String matchId, Path replay, Path stagingRoot, String replaySha256) {
        static Arguments parse(String[] args, Map<String, String> env) {
            int index = 0;
            String matchId = null;
            if (args.length > 0 && !args[0].startsWith("--")) matchId = args[index++];
            if (matchId == null || matchId.isBlank()) matchId = env.get("MATCH_ID");
            if (matchId == null || matchId.isBlank()) throw new IllegalArgumentException("MATCH_ID is required");
            validateMatchId(matchId);
            Path replay = null;
            Path staging = Path.of("/work/staging");
            String sha = null;
            while (index < args.length) {
                String option = args[index++];
                if (index >= args.length) throw new IllegalArgumentException("missing value for " + option);
                String value = args[index++];
                switch (option) {
                    case "--replay" -> replay = Path.of(value);
                    case "--staging-root" -> staging = Path.of(value);
                    case "--replay-sha256" -> {
                        if (!value.matches("(?i)[0-9a-f]{64}")) throw new IllegalArgumentException("invalid replay SHA-256");
                        sha = value.toLowerCase(Locale.ROOT);
                    }
                    default -> throw new IllegalArgumentException("unknown option: " + option);
                }
            }
            return new Arguments(matchId, replay, staging, sha);
        }

        private static void validateMatchId(String value) {
            if (!value.matches("[0-9]+")) throw new IllegalArgumentException("match ID must contain only decimal digits");
            BigInteger number = new BigInteger(value);
            if (number.signum() < 0 || number.compareTo(UINT64_MAX) > 0) throw new IllegalArgumentException("match ID is outside UBIGINT range");
        }
    }
}
