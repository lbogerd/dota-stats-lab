package lab.dota.parser;

import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class ArgumentsTest {
    @Test void acceptsEnvironmentMatchId() {
        Main.Arguments args = Main.Arguments.parse(new String[0], Map.of("MATCH_ID", "18446744073709551615"));
        assertEquals("18446744073709551615", args.matchId());
    }

    @Test void parsesExplicitPaths() {
        Main.Arguments args = Main.Arguments.parse(new String[]{"42", "--replay", "/r.dem", "--staging-root", "/s"}, Map.of());
        assertEquals(Path.of("/r.dem"), args.replay());
        assertEquals(Path.of("/s"), args.stagingRoot());
    }

    @Test void rejectsOutOfRangeAndNonDecimalIds() {
        assertThrows(IllegalArgumentException.class,
                () -> Main.Arguments.parse(new String[]{"18446744073709551616"}, Map.of()));
        assertThrows(IllegalArgumentException.class,
                () -> Main.Arguments.parse(new String[]{"12x"}, Map.of()));
    }
}
