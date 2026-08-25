package lab.dota.parser;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class GoldTimelineTest {
    private static final String PLAYER_ZERO =
            "m_vecDataTeam.0000.m_iTotalEarnedGold";
    private static final String PLAYER_ONE =
            "m_vecDataTeam.0001.m_iTotalEarnedGold";

    @Test void extractsTeamSlotOnlyFromTheExactGoldPath() {
        assertEquals(0, GoldTimeline.teamSlot(PLAYER_ZERO).orElseThrow());
        assertEquals(17, GoldTimeline.teamSlot(
                "m_vecDataTeam.0017.m_iTotalEarnedGold").orElseThrow());
        assertFalse(GoldTimeline.teamSlot(
                "m_vecPlayerData.0000.m_iTotalEarnedGold").isPresent());
        assertFalse(GoldTimeline.teamSlot(
                "prefix.m_vecDataTeam.0000.m_iTotalEarnedGold").isPresent());
        assertFalse(GoldTimeline.teamSlot(
                "m_vecDataTeam.0000.m_iReliableGold").isPresent());
    }

    @Test void emitsAtMostOneFinalValuePerPlayerPerTickInObservationOrder() {
        GoldTimeline timeline = new GoldTimeline();
        timeline.observe("resource", PLAYER_ZERO, 50L);
        timeline.observe("resource", PLAYER_ONE, 50L);
        assertEquals(2, timeline.finishTick(-1.0).size());
        timeline.observe("resource", PLAYER_ZERO, 100L);
        timeline.observe("resource", PLAYER_ZERO, 125L);
        timeline.observe("resource", PLAYER_ONE, 80L);

        List<GoldTimeline.GoldUpdate> updates = timeline.finishTick(12.5);

        assertEquals(2, updates.size());
        assertEquals(0, updates.get(0).teamSlot());
        assertEquals(125L, updates.get(0).totalGold());
        assertEquals(1, updates.get(1).teamSlot());
        assertEquals(80L, updates.get(1).totalGold());
    }

    @Test void removesValuesThatAreUnchangedFromTheLastEmittedTick() {
        GoldTimeline timeline = new GoldTimeline();
        timeline.observe("resource", PLAYER_ZERO, 100L);
        assertEquals(1, timeline.finishTick(0.0).size());

        timeline.observe("resource", PLAYER_ZERO, 100L);
        assertEquals(List.of(), timeline.finishTick(1.0));

        timeline.observe("resource", PLAYER_ZERO, 101L);
        assertEquals(1, timeline.finishTick(2.0).size());
    }

    @Test void keepsZeroAndNegativeGameTimes() {
        GoldTimeline timeline = new GoldTimeline();
        timeline.observe("resource", PLAYER_ZERO, 90L);
        assertEquals(-4.25, timeline.finishTick(-4.25).get(0).gameTime());

        timeline.observe("resource", PLAYER_ZERO, 100L);
        assertEquals(0.0, timeline.finishTick(0.0).get(0).gameTime());
    }

    @Test void retainsPendingValuesUntilTheClockIsAvailable() {
        GoldTimeline timeline = new GoldTimeline();
        timeline.observe("resource", PLAYER_ZERO, 90L);

        assertEquals(List.of(), timeline.finishTick(null));
        assertEquals(1, timeline.finishTick(-10.0).size());
    }

    @Test void ignoresNegativeCumulativeGoldAndUnrelatedProperties() {
        GoldTimeline timeline = new GoldTimeline();
        timeline.observe("resource", PLAYER_ZERO, -1L);
        timeline.observe("resource", "m_vecDataTeam.0000.m_iKills", 3L);
        assertEquals(List.of(), timeline.finishTick(1.0));
    }

    @Test void keepsTheSameTeamSlotFromDifferentTeamEntitiesSeparate() {
        GoldTimeline timeline = new GoldTimeline();
        timeline.observe("radiant", PLAYER_ZERO, 100L);
        timeline.observe("dire", PLAYER_ZERO, 200L);

        List<GoldTimeline.GoldUpdate> updates = timeline.finishTick(1.0);

        assertEquals(2, updates.size());
        assertEquals("radiant", updates.get(0).entityInstanceId());
        assertEquals("dire", updates.get(1).entityInstanceId());
    }

    @Test void preservesTheLastUntimedValueAsTheTimeZeroBaselineWhenTheClockStartsLate() {
        GoldTimeline timeline = new GoldTimeline();
        timeline.observe("resource", PLAYER_ZERO, 0L);
        assertEquals(List.of(), timeline.finishTick(null));
        timeline.observe("resource", PLAYER_ZERO, 25L);
        assertEquals(List.of(), timeline.finishTick(null));
        timeline.observe("resource", PLAYER_ZERO, 26L);

        List<GoldTimeline.GoldUpdate> baseline = timeline.finishTick(0.03);
        List<GoldTimeline.GoldUpdate> firstChange = timeline.finishTick(0.06);

        assertEquals(1, baseline.size());
        assertEquals(25L, baseline.get(0).totalGold());
        assertEquals(0.0, baseline.get(0).gameTime());
        assertEquals(1, firstChange.size());
        assertEquals(26L, firstChange.get(0).totalGold());
        assertEquals(0.06, firstChange.get(0).gameTime());
    }
}
