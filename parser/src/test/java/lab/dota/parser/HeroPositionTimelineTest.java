package lab.dota.parser;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HeroPositionTimelineTest {
    @Test void reconstructsSourceTwoCoordinatesForAllAcceptedFieldAliases() {
        assertEquals(5528.0, HeroPositionTimeline.worldCoordinate(171, 24.0));
        assertEquals(5000.0, HeroPositionTimeline.worldCoordinate(167, 8.0));

        for (String prefix : List.of("CBodyComponent", "CBodyComponentBaseAnimating",
                "CBodyComponentBaseAnimatingOverlay", "m_pGameSceneNode.m_vecOrigin")) {
            HeroPositionTimeline timeline = new HeroPositionTimeline();
            addCompleteHero(timeline, 1L, 0, 74, 2, prefix, 128, 128, 12.5, 34.5);

            HeroPositionTimeline.PositionSample sample = timeline.finishTick(0.0, 7).get(0);

            assertEquals(12.5, sample.worldX());
            assertEquals(34.5, sample.worldY());
        }
    }

    @Test void keepsInclusiveVerifiedWorldBoundsAndRejectsValuesOutsideThem() {
        assertTrue(HeroPositionTimeline.validWorldCoordinate(-8288.0));
        assertTrue(HeroPositionTimeline.validWorldCoordinate(8288.0));
        assertFalse(HeroPositionTimeline.validWorldCoordinate(-8288.001));
        assertFalse(HeroPositionTimeline.validWorldCoordinate(8288.001));
        assertFalse(HeroPositionTimeline.validWorldCoordinate(Double.NaN));
        assertFalse(HeroPositionTimeline.validWorldCoordinate(Double.POSITIVE_INFINITY));
        assertNull(HeroPositionTimeline.worldCoordinate(128, Double.NaN));

        HeroPositionTimeline timeline = new HeroPositionTimeline();
        addCompleteHero(timeline, 1L, 0, 74, 2, "CBodyComponent", 63, 192, 32.0, 96.0);
        HeroPositionTimeline.PositionSample sample = timeline.finishTick(0.0, 1).get(0);
        assertEquals(-8288.0, sample.worldX());
        assertEquals(8288.0, sample.worldY());
    }

    @Test void emitsEveryReachedOneHundredMillisecondBoundaryOnce() {
        HeroPositionTimeline timeline = new HeroPositionTimeline();
        addCompleteHero(timeline, 1L, 0, 74, 2,
                "CBodyComponent", 128, 128, 1.0, 2.0);

        assertEquals(List.of(), timeline.finishTick(-0.5, 1));
        assertEquals(List.of(0L), times(timeline.finishTick(0.099, 2)));
        assertEquals(List.of(100L, 200L, 300L), times(timeline.finishTick(0.350, 3)));
        assertEquals(List.of(), timeline.finishTick(0.350, 4));
        assertEquals(List.of(400L), times(timeline.finishTick(0.400, 5)));
    }

    @Test void repeatedPauseTimeDoesNotMakeDuplicateSamples() {
        HeroPositionTimeline timeline = new HeroPositionTimeline();
        addCompleteHero(timeline, 1L, 0, 74, 2,
                "CBodyComponent", 128, 128, 1.0, 2.0);

        assertEquals(3, timeline.finishTick(0.250, 10).size());
        assertEquals(List.of(), timeline.finishTick(0.250, 11));
        assertEquals(List.of(), timeline.finishTick(0.299, 12));
        assertEquals(List.of(300L), times(timeline.finishTick(0.300, 13)));
    }

    @Test void emitsOnlyLivingMainHeroesWithCompleteValidFields() {
        HeroPositionTimeline timeline = new HeroPositionTimeline();
        addCompleteHero(timeline, 1L, 0, 74, 2,
                "CBodyComponent", 128, 128, 1.0, 2.0);
        addCompleteHero(timeline, 2L, 1, 75, 2,
                "CBodyComponent", 128, 128, 3.0, 4.0);
        timeline.observeHeroProperty(2L, "m_lifeState", 1);
        addCompleteHero(timeline, 3L, 2, 76, 2,
                "CBodyComponent", 128, 128, 5.0, 6.0);
        timeline.observeHeroProperty(3L, "m_bIsIllusion", true);
        addCompleteHero(timeline, 4L, 3, 77, 2,
                "CBodyComponent", 128, 128, 7.0, 8.0);
        timeline.observeHeroProperty(4L, "m_bIsClone", true);
        addCompleteHero(timeline, 5L, 4, 78, 2,
                "CBodyComponent", 128, 128, 9.0, 10.0);
        timeline.observeHeroProperty(5L, "m_hReplicatingOtherHeroModel", 1234);
        addCompleteHero(timeline, 6L, 5, 79, 3,
                "CBodyComponent", 128, 128, 11.0, 12.0);
        timeline.observeHeroProperty(6L, "m_bIsPhantom", true);

        List<HeroPositionTimeline.PositionSample> samples = timeline.finishTick(0.0, 20);

        assertEquals(1, samples.size());
        assertEquals(0, samples.get(0).gamePlayerId());
    }

    @Test void recognizesNullReplicationHandlesAsMainHeroes() {
        for (long nullHandle : List.of(-1L, 16_777_215L, 0xffff_ffffL)) {
            HeroPositionTimeline timeline = new HeroPositionTimeline();
            addCompleteHero(timeline, 1L, 0, 74, 2,
                    "CBodyComponent", 128, 128, 1.0, 2.0);
            timeline.observeHeroProperty(1L, "m_hReplicatingOtherHeroModel", nullHandle);
            assertEquals(1, timeline.finishTick(0.0, 1).size());
        }
    }

    @Test void usesPlayerResourceRosterAndRejectsEntityRosterMismatch() {
        HeroPositionTimeline timeline = new HeroPositionTimeline();
        addCompleteHero(timeline, 1L, 5, 99, 3,
                "CBodyComponent", 128, 128, 1.0, 2.0);
        timeline.observeRosterProperty("m_vecPlayerTeamData.0005.m_nSelectedHeroID", 100);
        timeline.observeRosterProperty("m_vecPlayerData.0005.m_iPlayerTeam", 3);

        assertEquals(List.of(), timeline.finishTick(0.0, 1));

        HeroPositionTimeline withoutEntityHeroId = new HeroPositionTimeline();
        addHeroWithoutHeroId(withoutEntityHeroId, 2L, 5, 3);
        withoutEntityHeroId.observeRosterProperty("m_vecPlayerTeamData.0005.m_nSelectedHeroID", 100);
        withoutEntityHeroId.observeRosterProperty("m_vecPlayerData.0005.m_iPlayerTeam", 3);
        HeroPositionTimeline.PositionSample sample = withoutEntityHeroId.finishTick(0.0, 2).get(0);
        assertEquals(100, sample.heroId());
        assertEquals(3, sample.teamId());
    }

    @Test void extractsTheHeroIdFromTheCurrentFacetKeyField() {
        HeroPositionTimeline timeline = new HeroPositionTimeline();
        addHeroWithoutHeroId(timeline, 1L, 0, 2);
        timeline.observeHeroProperty(1L, "m_iHeroFacetKey", (74L << 32) | 3L);

        assertEquals(74, timeline.finishTick(0.0, 1).get(0).heroId());
    }

    @Test void picksTheNewestEligibleReplacementAndEmitsOneSamplePerPlayer() {
        HeroPositionTimeline timeline = new HeroPositionTimeline();
        addCompleteHero(timeline, 1L, 0, 74, 2,
                "CBodyComponent", 128, 128, 1.0, 2.0);
        addCompleteHero(timeline, 2L, 0, 74, 2,
                "CBodyComponent", 128, 128, 3.0, 4.0);

        List<HeroPositionTimeline.PositionSample> samples = timeline.finishTick(0.0, 1);

        assertEquals(1, samples.size());
        assertEquals(3.0, samples.get(0).worldX());
        timeline.onHeroDeleted(2L);
        assertEquals(1.0, timeline.finishTick(0.1, 2).get(0).worldX());
    }

    @Test void selectedHeroHandleExcludesCopiesAndAssignsTheAuthoritativePlayer() {
        HeroPositionTimeline timeline = new HeroPositionTimeline();
        timeline.onHeroCreated(1L, 1001L);
        addFieldsToExistingHero(timeline, 1L, 9, 74, 2, 1.0);
        timeline.onHeroCreated(2L, 1002L);
        addFieldsToExistingHero(timeline, 2L, 0, 74, 2, 3.0);
        timeline.observeRosterProperty("m_vecPlayerTeamData.0000.m_hSelectedHero", 1001);
        timeline.observeRosterProperty("m_vecPlayerTeamData.0000.m_nSelectedHeroID", 74);
        timeline.observeRosterProperty("m_vecPlayerData.0000.m_iPlayerTeam", 2);

        List<HeroPositionTimeline.PositionSample> samples = timeline.finishTick(0.0, 1);

        assertEquals(1, samples.size());
        assertEquals(0, samples.get(0).gamePlayerId());
        assertEquals(1.0, samples.get(0).worldX());
    }

    @Test void failsClosedWhenSelectedHandleAndCopyClassificationAreUnknown() {
        HeroPositionTimeline unknownBoth = completeHeroWithoutCopyClassification();
        assertEquals(List.of(), unknownBoth.finishTick(0.0, 1));

        HeroPositionTimeline unknownClone = completeHeroWithoutCopyClassification();
        unknownClone.observeHeroProperty(1L, "m_hReplicatingOtherHeroModel", 16_777_215);
        assertEquals(List.of(), unknownClone.finishTick(0.0, 1));

        HeroPositionTimeline unknownReplication = completeHeroWithoutCopyClassification();
        unknownReplication.observeHeroProperty(1L, "m_bIsClone", false);
        assertEquals(List.of(), unknownReplication.finishTick(0.0, 1));

        HeroPositionTimeline explicitlyMain = completeHeroWithoutCopyClassification();
        explicitlyMain.observeHeroProperty(1L, "m_bIsIllusion", false);
        explicitlyMain.observeHeroProperty(1L, "m_bIsPhantom", false);
        explicitlyMain.observeHeroProperty(1L, "m_bIsClone", false);
        explicitlyMain.observeHeroProperty(1L, "m_hReplicatingOtherHeroModel", 16_777_215);
        assertEquals(1, explicitlyMain.finishTick(0.0, 1).size());
    }

    @Test void fallbackRequiresExplicitFalseIllusionAndPhantomFields() {
        HeroPositionTimeline unknownIllusion = completeHeroWithoutCopyClassification();
        unknownIllusion.observeHeroProperty(1L, "m_bIsPhantom", false);
        unknownIllusion.observeHeroProperty(1L, "m_bIsClone", false);
        unknownIllusion.observeHeroProperty(1L, "m_hReplicatingOtherHeroModel", 16_777_215);
        assertEquals(List.of(), unknownIllusion.finishTick(0.0, 1));

        HeroPositionTimeline unknownPhantom = completeHeroWithoutCopyClassification();
        unknownPhantom.observeHeroProperty(1L, "m_bIsIllusion", false);
        unknownPhantom.observeHeroProperty(1L, "m_bIsClone", false);
        unknownPhantom.observeHeroProperty(1L, "m_hReplicatingOtherHeroModel", 16_777_215);
        assertEquals(List.of(), unknownPhantom.finishTick(0.0, 1));
    }

    @Test void selectedHeroHandleIsSufficientWhenCopyClassificationIsUnknown() {
        HeroPositionTimeline timeline = completeHeroWithoutCopyClassification();
        timeline.observeRosterProperty("m_vecPlayerTeamData.0000.m_hSelectedHero", 1);
        timeline.observeRosterProperty("m_vecPlayerTeamData.0000.m_nSelectedHeroID", 74);
        timeline.observeRosterProperty("m_vecPlayerData.0000.m_iPlayerTeam", 2);

        assertEquals(1, timeline.finishTick(0.0, 1).size());
    }

    @Test void stopsAtTheLastBoundaryBeforeTheGameEndMarker() {
        HeroPositionTimeline timeline = new HeroPositionTimeline();
        addCompleteHero(timeline, 1L, 0, 74, 2,
                "CBodyComponent", 128, 128, 1.0, 2.0);
        timeline.markGameEnded(0.250);

        assertEquals(List.of(0L, 100L, 200L), times(timeline.finishTick(0.500, 1)));
        assertEquals(List.of(), timeline.finishTick(1.0, 2));
    }

    @Test void invalidPlayersTeamsAndNonfiniteCoordinatesDoNotEmit() {
        HeroPositionTimeline invalidPlayer = new HeroPositionTimeline();
        addCompleteHero(invalidPlayer, 1L, 10, 74, 2,
                "CBodyComponent", 128, 128, 1.0, 2.0);
        assertEquals(List.of(), invalidPlayer.finishTick(0.0, 1));

        HeroPositionTimeline invalidTeam = new HeroPositionTimeline();
        addCompleteHero(invalidTeam, 1L, 0, 74, 4,
                "CBodyComponent", 128, 128, 1.0, 2.0);
        assertEquals(List.of(), invalidTeam.finishTick(0.0, 1));

        HeroPositionTimeline nonfinite = new HeroPositionTimeline();
        addCompleteHero(nonfinite, 1L, 0, 74, 2,
                "CBodyComponent", 128, 128, 1.0, 2.0);
        nonfinite.observeHeroProperty(1L, "CBodyComponent.m_vecX", Double.NaN);
        assertEquals(List.of(), nonfinite.finishTick(0.0, 1));
    }

    private static List<Long> times(List<HeroPositionTimeline.PositionSample> samples) {
        return samples.stream().map(HeroPositionTimeline.PositionSample::gameTimeMilliseconds).toList();
    }

    private static void addHeroWithoutHeroId(HeroPositionTimeline timeline, long uid,
                                             int playerId, int teamId) {
        timeline.onHeroCreated(uid);
        timeline.observeHeroProperty(uid, "m_iPlayerID", playerId);
        timeline.observeHeroProperty(uid, "m_iTeamNum", teamId);
        timeline.observeHeroProperty(uid, "m_lifeState", 0);
        timeline.observeHeroProperty(uid, "m_bIsIllusion", false);
        timeline.observeHeroProperty(uid, "m_bIsPhantom", false);
        timeline.observeHeroProperty(uid, "m_bIsClone", false);
        timeline.observeHeroProperty(uid, "m_hReplicatingOtherHeroModel", 16_777_215);
        timeline.observeHeroProperty(uid, "CBodyComponent.m_cellX", 128);
        timeline.observeHeroProperty(uid, "CBodyComponent.m_cellY", 128);
        timeline.observeHeroProperty(uid, "CBodyComponent.m_vecX", 1.0);
        timeline.observeHeroProperty(uid, "CBodyComponent.m_vecY", 2.0);
    }

    private static HeroPositionTimeline completeHeroWithoutCopyClassification() {
        HeroPositionTimeline timeline = new HeroPositionTimeline();
        timeline.onHeroCreated(1L, 1L);
        timeline.observeHeroProperty(1L, "m_iPlayerID", 0);
        timeline.observeHeroProperty(1L, "m_iHeroID", 74);
        timeline.observeHeroProperty(1L, "m_iTeamNum", 2);
        timeline.observeHeroProperty(1L, "m_lifeState", 0);
        timeline.observeHeroProperty(1L, "CBodyComponent.m_cellX", 128);
        timeline.observeHeroProperty(1L, "CBodyComponent.m_cellY", 128);
        timeline.observeHeroProperty(1L, "CBodyComponent.m_vecX", 1.0);
        timeline.observeHeroProperty(1L, "CBodyComponent.m_vecY", 2.0);
        return timeline;
    }

    private static void addCompleteHero(HeroPositionTimeline timeline, long uid, int playerId,
                                        int heroId, int teamId, String prefix,
                                        int cellX, int cellY, double offsetX, double offsetY) {
        timeline.onHeroCreated(uid);
        timeline.observeHeroProperty(uid, "m_iPlayerID", playerId);
        timeline.observeHeroProperty(uid, "m_iHeroID", heroId);
        timeline.observeHeroProperty(uid, "m_iTeamNum", teamId);
        timeline.observeHeroProperty(uid, "m_lifeState", 0);
        timeline.observeHeroProperty(uid, "m_bIsIllusion", false);
        timeline.observeHeroProperty(uid, "m_bIsPhantom", false);
        timeline.observeHeroProperty(uid, "m_bIsClone", false);
        timeline.observeHeroProperty(uid, "m_hReplicatingOtherHeroModel", 16_777_215);
        timeline.observeHeroProperty(uid, prefix + ".m_cellX", cellX);
        timeline.observeHeroProperty(uid, prefix + ".m_cellY", cellY);
        timeline.observeHeroProperty(uid, prefix + ".m_vecX", offsetX);
        timeline.observeHeroProperty(uid, prefix + ".m_vecY", offsetY);
    }

    private static void addFieldsToExistingHero(HeroPositionTimeline timeline, long uid,
                                                int playerId, int heroId, int teamId,
                                                double worldX) {
        timeline.observeHeroProperty(uid, "m_iPlayerID", playerId);
        timeline.observeHeroProperty(uid, "m_iHeroID", heroId);
        timeline.observeHeroProperty(uid, "m_iTeamNum", teamId);
        timeline.observeHeroProperty(uid, "m_lifeState", 0);
        timeline.observeHeroProperty(uid, "m_bIsIllusion", false);
        timeline.observeHeroProperty(uid, "m_bIsPhantom", false);
        timeline.observeHeroProperty(uid, "m_bIsClone", false);
        timeline.observeHeroProperty(uid, "m_hReplicatingOtherHeroModel", 16_777_215);
        timeline.observeHeroProperty(uid, "CBodyComponent.m_cellX", 128);
        timeline.observeHeroProperty(uid, "CBodyComponent.m_cellY", 128);
        timeline.observeHeroProperty(uid, "CBodyComponent.m_vecX", worldX);
        timeline.observeHeroProperty(uid, "CBodyComponent.m_vecY", 2.0);
    }
}
