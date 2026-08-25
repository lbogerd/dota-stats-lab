package lab.dota.parser;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class GameClockTest {
    @Test void derivesNegativeAndZeroGameTimeFromTheGameRulesClock() {
        GameClock clock = new GameClock();
        clock.observeProperty("m_pGameRules.m_flGameStartTime", 100.0);
        clock.refresh();

        clock.observeTick(90, 1000.0);
        assertEquals(-10.0, clock.gameTime());

        clock.observeTick(100, 1000.0);
        assertEquals(0.0, clock.gameTime());
    }

    @Test void excludesPausedTicksFromGameTime() {
        GameClock clock = new GameClock();
        clock.observeProperty("m_pGameRules.m_flGameStartTime", 100.0);
        clock.refresh();
        clock.observeTick(110, 1000.0);
        assertEquals(10.0, clock.gameTime());

        clock.observeProperty("m_pGameRules.m_bGamePaused", true);
        clock.refresh();
        clock.observeTick(120, 1000.0);
        assertEquals(10.0, clock.gameTime());

        clock.observeProperty("m_pGameRules.m_nTotalPausedTicks", 10L);
        clock.observeProperty("m_pGameRules.m_bGamePaused", false);
        clock.refresh();
        assertEquals(10.0, clock.gameTime());

        clock.observeTick(125, 1000.0);
        assertEquals(15.0, clock.gameTime());
    }

    @Test void usesTheEntityGameTimeUntilDerivedInputsAreAvailable() {
        GameClock clock = new GameClock();
        clock.observeProperty("m_pGameRules.m_fGameTime", -8.5);
        clock.refresh();
        assertEquals(-8.5, clock.gameTime());
    }
}
