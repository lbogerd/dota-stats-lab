package lab.dota.parser;

import com.google.protobuf.ByteString;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class ValueEncoderTest {
    @Test void routesBytesThroughBlobSinkWithNativePath() throws Exception {
        AtomicReference<String> path = new AtomicReference<>();
        Object value = ValueEncoder.encode(Map.of("data", ByteString.copyFromUtf8("abc")), "payload", (p, bytes) -> {
            path.set(p);
            assertArrayEquals(new byte[]{97, 98, 99}, bytes);
            return Map.of("blobId", "id");
        });
        assertEquals("payload.data", path.get());
        assertEquals(Map.of("data", Map.of("blobId", "id")), value);
    }
}
