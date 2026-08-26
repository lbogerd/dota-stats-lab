package lab.dota.parser;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class NdjsonSetTest {
    @TempDir Path directory;

    @Test void writesAndHashesEveryDeclaredFile() throws Exception {
        NdjsonSet set = new NdjsonSet(directory, new ObjectMapper(), 10_000, 10);
        set.write("records", Map.of("sequence", 1));
        set.close();
        Map<String, Object> files = set.manifestFiles();
        assertEquals(NdjsonSet.FILES.keySet(), files.keySet());
        for (String file : NdjsonSet.FILES.values()) assertTrue(Files.isRegularFile(directory.resolve(file)));
        assertEquals(1L, set.counts().get("records"));
        assertEquals(0L, set.counts().get("heroPositions"));
        assertEquals(1L, set.counts().get("total"));
    }

    @Test void enforcesRecordAndByteLimitsBeforeWritingRow() throws Exception {
        try (NdjsonSet set = new NdjsonSet(directory, new ObjectMapper(), 1, 1)) {
            assertThrows(ExportLimitException.class, () -> set.write("records", Map.of("x", "too large")));
        }
        assertEquals(0, Files.size(directory.resolve("records.ndjson")));
    }
}
