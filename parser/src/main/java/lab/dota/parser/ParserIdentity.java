package lab.dota.parser;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.util.Map;

record ParserIdentity(
        String parserName,
        String clarityUpstreamRelease,
        String clarityForkRevision,
        String exportFormatVersion
) {
    private static final String RESOURCE = "/parser-identity.json";

    static ParserIdentity load() {
        try (InputStream input = ParserIdentity.class.getResourceAsStream(RESOURCE)) {
            if (input == null) throw new IllegalStateException("missing " + RESOURCE);
            ParserIdentity identity = new ObjectMapper().readValue(input, ParserIdentity.class);
            identity.validate();
            return identity;
        } catch (IOException e) {
            throw new IllegalStateException("invalid " + RESOURCE, e);
        }
    }

    String parserVersion() {
        return clarityForkRevision;
    }

    Map<String, String> manifestParser() {
        return Map.of(
                "name", parserName,
                "version", parserVersion(),
                "upstreamRelease", clarityUpstreamRelease,
                "forkRevision", clarityForkRevision);
    }

    private void validate() {
        requireNonBlank("parserName", parserName);
        requireNonBlank("clarityUpstreamRelease", clarityUpstreamRelease);
        requireNonBlank("exportFormatVersion", exportFormatVersion);
        if (clarityForkRevision == null || !clarityForkRevision.matches("[a-f0-9]{40}")) {
            throw new IllegalStateException("clarityForkRevision must be a full lowercase Git commit");
        }
    }

    private static void requireNonBlank(String name, String value) {
        if (value == null || value.isBlank()) throw new IllegalStateException(name + " must be non-empty");
    }
}
