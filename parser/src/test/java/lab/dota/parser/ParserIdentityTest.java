package lab.dota.parser;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ParserIdentityTest {
    @Test void loadsVersionedIdentityFromTheSharedResource() {
        ParserIdentity identity = ParserIdentity.load();

        assertFalse(identity.parserName().isBlank());
        assertFalse(identity.clarityUpstreamRelease().isBlank());
        assertTrue(identity.clarityForkRevision().matches("[a-f0-9]{40}"));
        assertFalse(identity.exportFormatVersion().isBlank());
        assertEquals(identity.clarityForkRevision(), identity.parserVersion());
        assertEquals(identity.clarityForkRevision(), identity.manifestParser().get("version"));
        assertEquals(identity.clarityUpstreamRelease(), identity.manifestParser().get("upstreamRelease"));
        assertEquals("2.0.0", identity.exportFormatVersion());
    }
}
