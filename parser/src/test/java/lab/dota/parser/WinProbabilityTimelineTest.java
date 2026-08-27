package lab.dota.parser;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class WinProbabilityTimelineTest {
    private static final String GRAPH_PREFIX =
            "m_pGraphManager.m_rgRadiantWinChance.";

    @Test void convertsConfirmedGraphScaleAndTimes() {
        WinProbabilityTimeline timeline = new WinProbabilityTimeline();
        timeline.observeGraphProperty(
                "m_pGraphManager.m_flTotalEarnedGoldStartTime", 859.0000610351562);
        timeline.observeGraphProperty(
                "m_pGraphManager.m_flTotalEarnedGoldEndTime", 2464.000244140625);
        timeline.observeMatchDuration(1515);
        timeline.observeGraphProperty(GRAPH_PREFIX + "0000", 60);
        timeline.observeGraphProperty(GRAPH_PREFIX + "0004", 55);
        timeline.observeGraphProperty(GRAPH_PREFIX + "0004", 56);
        timeline.observeGraphProperty(GRAPH_PREFIX + "0063", 99);

        List<WinProbabilityTimeline.Sample> samples = timeline.samples();

        assertEquals(2, samples.size());
        assertEquals(11.904590425037201, samples.get(0).gameTimeSeconds(), 0.000001);
        assertEquals(0.56, samples.get(0).radiantProbability());
        assertEquals(1515.0, samples.get(1).gameTimeSeconds(), 0.000001);
        assertEquals(0.99, samples.get(1).radiantProbability());
        assertEquals(WinProbabilityTimeline.GRAPH_HISTORY, samples.get(1).source());
    }

    @Test void removesNegativePregameGraphPositions() {
        WinProbabilityTimeline timeline = graphTimeline();
        timeline.observeMatchDuration(0.0);
        timeline.observeGraphProperty(GRAPH_PREFIX + "0000", 40);
        timeline.observeGraphProperty(GRAPH_PREFIX + "0063", 75);

        List<WinProbabilityTimeline.Sample> samples = timeline.samples();

        assertEquals(1, samples.size());
        assertEquals(0.0, samples.get(0).gameTimeSeconds());
        assertEquals(0.75, samples.get(0).radiantProbability());
        assertEquals(WinProbabilityTimeline.GRAPH_HISTORY, samples.get(0).source());
    }

    @Test void removesUnusedAndOutOfRangeGraphPositions() {
        WinProbabilityTimeline timeline = graphTimeline();
        timeline.observeGraphProperty(GRAPH_PREFIX + "0000", -1);
        timeline.observeGraphProperty(GRAPH_PREFIX + "0001", 101);
        timeline.observeGraphProperty(GRAPH_PREFIX + "0063", 75);
        timeline.observeGraphProperty(GRAPH_PREFIX + "0064", 50);

        assertEquals(List.of(new WinProbabilityTimeline.Sample(
                63.0, 0.75, WinProbabilityTimeline.GRAPH_HISTORY)), timeline.samples());
    }

    @Test void graphHistoryHasPriorityOverSpectatorUpdates() {
        WinProbabilityTimeline timeline = graphTimeline();
        timeline.observeGraphProperty(GRAPH_PREFIX + "0000", 40);
        timeline.observeSpectatorProperty("m_fRadiantWinProbability", 0.9);
        timeline.finishTick(5.0);

        assertEquals(List.of(new WinProbabilityTimeline.Sample(
                0.0, 0.4, WinProbabilityTimeline.GRAPH_HISTORY)), timeline.samples());
    }

    @Test void fallsBackToCurrentValueUpdatesAndKeepsTheLastDuplicateTime() {
        WinProbabilityTimeline timeline = new WinProbabilityTimeline();
        timeline.observeSpectatorProperty("m_fRadiantWinProbability", 0.4);
        timeline.finishTick(5.0);
        timeline.observeSpectatorProperty("m_fRadiantWinProbability", 0.6);
        timeline.finishTick(5.0);
        timeline.observeSpectatorProperty("m_fRadiantWinProbability", 0.7);
        timeline.finishTick(10.0);

        assertEquals(List.of(
                new WinProbabilityTimeline.Sample(
                        5.0, 0.6, WinProbabilityTimeline.SPECTATOR_UPDATES),
                new WinProbabilityTimeline.Sample(
                        10.0, 0.7, WinProbabilityTimeline.SPECTATOR_UPDATES)), timeline.samples());
    }

    @Test void ignoresCurrentValuesWithoutAValidNonnegativeGameTime() {
        WinProbabilityTimeline timeline = new WinProbabilityTimeline();
        timeline.observeSpectatorProperty("m_fRadiantWinProbability", 0.0);
        timeline.finishTick(null);
        timeline.observeSpectatorProperty("m_fRadiantWinProbability", 0.5);
        timeline.finishTick(-1.0);
        timeline.observeSpectatorProperty("m_fRadiantWinProbability", Double.NaN);
        timeline.finishTick(1.0);

        assertEquals(List.of(), timeline.samples());
    }

    @Test void fallsBackWhenGraphTimeRangeIsNotUsable() {
        WinProbabilityTimeline timeline = new WinProbabilityTimeline();
        timeline.observeGraphProperty(
                "m_pGraphManager.m_flTotalEarnedGoldStartTime", 0.0);
        timeline.observeGraphProperty(
                "m_pGraphManager.m_flTotalEarnedGoldEndTime", 0.0);
        timeline.observeGraphProperty(GRAPH_PREFIX + "0000", 0);
        timeline.observeSpectatorProperty("m_fRadiantWinProbability", 0.55);
        timeline.finishTick(1.0);

        assertEquals(List.of(new WinProbabilityTimeline.Sample(
                1.0, 0.55, WinProbabilityTimeline.SPECTATOR_UPDATES)), timeline.samples());
    }

    @Test void treatsAnAllZeroGraphAsUnused() {
        WinProbabilityTimeline timeline = graphTimeline();
        for (int index = 0; index < WinProbabilityTimeline.GRAPH_POSITION_COUNT; index++) {
            timeline.observeGraphProperty(GRAPH_PREFIX + "%04d".formatted(index), 0);
        }
        timeline.observeSpectatorProperty("m_fRadiantWinProbability", 0.65);
        timeline.finishTick(2.0);

        assertEquals(List.of(new WinProbabilityTimeline.Sample(
                2.0, 0.65, WinProbabilityTimeline.SPECTATOR_UPDATES)), timeline.samples());
    }

    private static WinProbabilityTimeline graphTimeline() {
        WinProbabilityTimeline timeline = new WinProbabilityTimeline();
        timeline.observeGraphProperty(
                "m_pGraphManager.m_flTotalEarnedGoldStartTime", 100.0);
        timeline.observeGraphProperty(
                "m_pGraphManager.m_flTotalEarnedGoldEndTime", 163.0);
        timeline.observeMatchDuration(63.0);
        return timeline;
    }
}
