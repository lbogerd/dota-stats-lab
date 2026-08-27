package lab.dota.parser;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.BufferedOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.DigestOutputStream;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;

final class NdjsonSet implements Closeable {
    static final Map<String, String> FILES = Map.of(
            "records", "records.ndjson",
            "combatEvents", "combat_events.ndjson",
            "blobs", "blobs.ndjson",
            "entityInstances", "entity_instances.ndjson",
            "entityEvents", "entity_events.ndjson",
            "propertyUpdates", "property_updates.ndjson",
            "heroPositions", "hero_positions.ndjson",
            "winProbability", "win_probability.ndjson",
            "checkpoints", "checkpoints.ndjson");

    private final ObjectMapper mapper;
    private final long maxBytes;
    private final long maxRecords;
    private final Map<String, Writer> writers = new LinkedHashMap<>();
    private long totalBytes;
    private long totalRecords;

    NdjsonSet(Path directory, ObjectMapper mapper, long maxBytes, long maxRecords) throws IOException {
        this.mapper = mapper;
        this.maxBytes = maxBytes;
        this.maxRecords = maxRecords;
        Files.createDirectories(directory);
        for (Map.Entry<String, String> entry : FILES.entrySet()) {
            writers.put(entry.getKey(), new Writer(directory.resolve(entry.getValue())));
        }
    }

    void write(String logical, Object row) throws IOException {
        byte[] json = mapper.writeValueAsBytes(row);
        long added = json.length + 1L;
        if (totalRecords + 1 > maxRecords) throw new ExportLimitException("record limit exceeded: " + maxRecords);
        if (totalBytes + added > maxBytes) throw new ExportLimitException("output limit exceeded: " + maxBytes + " bytes");
        Writer writer = writers.get(logical);
        if (writer == null) throw new IllegalArgumentException("unknown output file: " + logical);
        writer.out.write(json);
        writer.out.write('\n');
        writer.bytes += added;
        writer.records++;
        totalBytes += added;
        totalRecords++;
    }

    long totalRecords() { return totalRecords; }
    long totalBytes() { return totalBytes; }

    Map<String, Object> manifestFiles() {
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<String, Writer> entry : writers.entrySet()) {
            Writer w = entry.getValue();
            result.put(entry.getKey(), Map.of(
                    "path", FILES.get(entry.getKey()),
                    "sha256", w.sha256,
                    "bytes", w.bytes,
                    "records", w.records));
        }
        return result;
    }

    Map<String, Long> counts() {
        Map<String, Long> result = new LinkedHashMap<>();
        writers.forEach((name, writer) -> result.put(name, writer.records));
        result.put("total", totalRecords);
        return result;
    }

    @Override public void close() throws IOException {
        IOException failure = null;
        for (Writer writer : writers.values()) {
            try { writer.close(); } catch (IOException e) { if (failure == null) failure = e; }
        }
        if (failure != null) throw failure;
    }

    private static final class Writer implements Closeable {
        final MessageDigest digest = Hashing.sha256Digest();
        final OutputStream out;
        long bytes;
        long records;
        String sha256;

        Writer(Path path) throws IOException {
            out = new BufferedOutputStream(new DigestOutputStream(Files.newOutputStream(path), digest), 256 * 1024);
        }

        @Override public void close() throws IOException {
            if (sha256 != null) return;
            out.close();
            sha256 = Hashing.hex(digest.digest());
        }
    }
}
