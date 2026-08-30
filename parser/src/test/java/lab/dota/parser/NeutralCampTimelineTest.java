package lab.dota.parser;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class NeutralCampTimelineTest {
    @Test void validSpawnerHandleStagesCampCreepIdentityEventAndCheckpoint() {
        NeutralCampTimeline timeline = timelineWithSpawner();

        List<NeutralCampTimeline.Emission> rows = timeline.onCreepCreated(
                entity(2, 22, NeutralCampTimeline.CREEP_CLASS, 1.0), creepProperties(101, 300));

        assertEquals(List.of("entityInstances", "entityEvents", "checkpoints"), logicalFiles(rows));
        assertEquals(List.of("m_hNeutralSpawner", "m_lifeState", "m_iHealth",
                        "m_iTeamNum", "m_bIsSummoned"),
                checkpointPaths(rows.get(2)));
    }

    @Test void invalidAndUnresolvedSpawnerHandlesDoNotStageNeutralCreeps() {
        NeutralCampTimeline timeline = timelineWithSpawner();
        assertEquals(List.of(), timeline.onCreepCreated(
                entity(2, 22, NeutralCampTimeline.CREEP_CLASS, 1.0),
                creepProperties(NeutralCampTimeline.INVALID_SPAWNER_HANDLE, 300)));
        assertEquals(List.of(), timeline.onCreepCreated(
                entity(3, 23, NeutralCampTimeline.CREEP_CLASS, 1.0), creepProperties(999, 300)));
    }

    @Test void aSpawnerObservedEarlierInTheExtractionStillResolvesAfterDeletion() {
        NeutralCampTimeline timeline = timelineWithSpawner();
        timeline.onDeleted(1, 12, 0.5);

        assertEquals(List.of("entityInstances", "entityEvents", "checkpoints"), logicalFiles(
                timeline.onCreepCreated(entity(2, 22, NeutralCampTimeline.CREEP_CLASS, 1.0),
                        creepProperties(101, 300))));
    }

    @Test void updatesAreBufferedUntilALaterSpawnerResolvesTheCreationHandle() {
        NeutralCampTimeline timeline = new NeutralCampTimeline();
        assertEquals(List.of(), timeline.onCreepCreated(
                entity(2, 22, NeutralCampTimeline.CREEP_CLASS, 1.0), creepProperties(101, 300)));
        assertEquals(List.of(), timeline.onCreepUpdated(2, 20, 2.0,
                List.of(new NeutralCampTimeline.Property("m_iHealth", 0))));

        List<NeutralCampTimeline.Emission> rows = timeline.onSpawnerCreated(
                entity(1, 101, NeutralCampTimeline.SPAWNER_CLASS, null), spawnerProperties());
        assertEquals(List.of("entityInstances", "entityEvents", "checkpoints",
                "entityInstances", "entityEvents", "checkpoints", "propertyUpdates"),
                logicalFiles(rows));
        assertEquals(300, checkpointValue(rows.get(5), "m_iHealth"));
        assertEquals(2.0, timeline.deathGameTime(2));
    }

    @Test void aCreepMissingAnySelectedInitialFieldIsNeverBackfilledFromAnUpdate() {
        NeutralCampTimeline timeline = timelineWithSpawner();
        List<NeutralCampTimeline.Property> incomplete = creepProperties(101, 300).stream()
                .filter(property -> !property.path().equals("m_bIsSummoned"))
                .toList();
        assertEquals(List.of(), timeline.onCreepCreated(
                entity(2, 22, NeutralCampTimeline.CREEP_CLASS, 1.0), incomplete));
        assertEquals(List.of(), timeline.onCreepUpdated(2, 11, 1.1,
                List.of(new NeutralCampTimeline.Property("m_bIsSummoned", false))));
    }

    @Test void completeSpawnerCreationWritesOnlySelectedInitialProperties() {
        NeutralCampTimeline timeline = new NeutralCampTimeline();
        List<NeutralCampTimeline.Emission> rows = timeline.onSpawnerCreated(
                entity(1, 101, NeutralCampTimeline.SPAWNER_CLASS, null), spawnerProperties());

        assertEquals(List.of("entityInstances", "entityEvents", "checkpoints"), logicalFiles(rows));
        assertEquals(List.of("m_Type", "worldX", "worldY"),
                checkpointPaths(rows.get(2)));
        assertEquals(-852.0, checkpointValue(rows.get(2), "worldX"));
        assertEquals(4940.0, checkpointValue(rows.get(2), "worldY"));
        assertNull(rows.get(2).row().get("checkpointGameTime"));
    }

    @Test void firstCompleteSpawnerPositionProducesTheCreationCheckpointOnce() {
        NeutralCampTimeline timeline = new NeutralCampTimeline();
        List<NeutralCampTimeline.Property> incomplete = spawnerProperties().stream()
                .filter(property -> !property.path().endsWith("m_vecY"))
                .toList();
        assertEquals(List.of("entityInstances", "entityEvents"), logicalFiles(
                timeline.onSpawnerCreated(entity(1, 101, NeutralCampTimeline.SPAWNER_CLASS, null), incomplete)));

        List<NeutralCampTimeline.Emission> completed = timeline.onSpawnerUpdated(
                1, List.of(
                        new NeutralCampTimeline.Property("CBodyComponent.m_cellX", 121),
                        new NeutralCampTimeline.Property("CBodyComponent.m_vecY", 76.0)));
        assertEquals(List.of("checkpoints"), logicalFiles(completed));
        assertEquals(-724.0, checkpointValue(completed.get(0), "worldX"));
        assertEquals(List.of(), timeline.onSpawnerUpdated(
                1, List.of(new NeutralCampTimeline.Property("CBodyComponent.m_vecY", 80.0))));
    }

    @Test void creationCheckpointKeepsTheInitialCampType() {
        NeutralCampTimeline timeline = new NeutralCampTimeline();
        List<NeutralCampTimeline.Property> incomplete = spawnerProperties().stream()
                .filter(property -> !property.path().endsWith("m_vecY"))
                .toList();
        timeline.onSpawnerCreated(
                entity(1, 101, NeutralCampTimeline.SPAWNER_CLASS, null), incomplete);

        List<NeutralCampTimeline.Emission> rows = timeline.onSpawnerUpdated(1, List.of(
                new NeutralCampTimeline.Property("m_Type", 3),
                new NeutralCampTimeline.Property("CBodyComponent.m_vecY", 76.0)));

        assertEquals(1, checkpointValue(rows.get(0), "m_Type"));
    }

    @Test void missingCreationCampTypeIsNeverBackfilledFromAnUpdate() {
        NeutralCampTimeline timeline = new NeutralCampTimeline();
        List<NeutralCampTimeline.Property> missingType = spawnerProperties().stream()
                .filter(property -> !property.path().equals("m_Type"))
                .toList();
        assertEquals(List.of("entityInstances", "entityEvents"), logicalFiles(
                timeline.onSpawnerCreated(
                        entity(1, 101, NeutralCampTimeline.SPAWNER_CLASS, null), missingType)));

        assertEquals(List.of(), timeline.onSpawnerUpdated(
                1, List.of(new NeutralCampTimeline.Property("m_Type", 3))));
    }

    @Test void healthChangeToZeroStagesOnlyHealthAndRecordsFirstDeath() {
        NeutralCampTimeline timeline = timelineWithCreep();
        List<NeutralCampTimeline.Emission> rows = timeline.onCreepUpdated(2, 20, 3.5,
                List.of(new NeutralCampTimeline.Property("m_iHealth", 0),
                        new NeutralCampTimeline.Property("m_flMana", 50)));

        assertEquals(List.of("propertyUpdates"), logicalFiles(rows));
        assertEquals("m_iHealth", rows.get(0).row().get("propertyPath"));
        assertEquals(3.5, timeline.deathGameTime(2));
    }

    @Test void lifeStateChangeFromAliveStagesUpdateAndRecordsDeath() {
        NeutralCampTimeline timeline = timelineWithCreep();
        List<NeutralCampTimeline.Emission> rows = timeline.onCreepUpdated(2, 20, 4.0,
                List.of(new NeutralCampTimeline.Property("m_lifeState", 1)));

        assertEquals(List.of("propertyUpdates"), logicalFiles(rows));
        assertEquals(4.0, timeline.deathGameTime(2));
        timeline.onCreepUpdated(2, 21, 4.1,
                List.of(new NeutralCampTimeline.Property("m_iHealth", 0)));
        assertEquals(4.0, timeline.deathGameTime(2));
    }

    @Test void aNonAliveToNonAliveLifeChangeDoesNotInventADeath() {
        NeutralCampTimeline timeline = timelineWithSpawner();
        List<NeutralCampTimeline.Property> initiallyDead = creepProperties(101, 300).stream()
                .map(property -> property.path().equals("m_lifeState")
                        ? new NeutralCampTimeline.Property("m_lifeState", 1)
                        : property)
                .toList();
        timeline.onCreepCreated(entity(2, 22, NeutralCampTimeline.CREEP_CLASS, 1.0), initiallyDead);

        assertEquals(List.of("propertyUpdates"), logicalFiles(timeline.onCreepUpdated(2, 20, 4.0,
                List.of(new NeutralCampTimeline.Property("m_lifeState", 2)))));
        assertNull(timeline.deathGameTime(2));
    }

    @Test void deletionWithoutKnownDeathStagesDeletionButDoesNotInventDeath() {
        NeutralCampTimeline timeline = timelineWithCreep();
        assertNull(timeline.deathGameTime(2));
        List<NeutralCampTimeline.Emission> rows = timeline.onDeleted(2, 30, 5.0);
        assertEquals(List.of("entityEvents"), logicalFiles(rows));
        assertEquals("delete", rows.get(0).row().get("eventType"));
    }

    @Test void usesTheHeroSamplerWorldCoordinateConversion() {
        assertEquals(-852.0, NeutralCampTimeline.worldCoordinate(120, 172.0));
        assertEquals(4940.0, NeutralCampTimeline.worldCoordinate(166, 76.0));
    }

    @Test void unrelatedPropertiesNeverEnterCheckpointsOrUpdates() {
        NeutralCampTimeline timeline = timelineWithSpawner();
        List<NeutralCampTimeline.Property> properties = new java.util.ArrayList<>(creepProperties(101, 300));
        properties.add(new NeutralCampTimeline.Property("m_flMana", 10));
        List<NeutralCampTimeline.Emission> created = timeline.onCreepCreated(
                entity(2, 22, NeutralCampTimeline.CREEP_CLASS, 1.0), properties);
        assertEquals(false, checkpointPaths(created.get(2)).contains("m_flMana"));
        assertEquals(List.of(), timeline.onCreepUpdated(2, 4, 2.0,
                List.of(new NeutralCampTimeline.Property("m_flMana", 9),
                        new NeutralCampTimeline.Property("Wrapper.m_iHealth", 0))));
    }

    @Test void combatRowsUseOnlyThePauseSafeGameClockAndPreserveTheSourceTimestamp() {
        assertEquals(new ReplayExporter.CombatTimes(63.06669098663326, (double) 1012.10004f),
                ReplayExporter.combatTimes(63.06669098663326, 1012.10004f, 1012.10004f));
        assertEquals(new ReplayExporter.CombatTimes(null, (double) 1012.10004f),
                ReplayExporter.combatTimes(null, 1012.10004f, null));
        assertEquals(new ReplayExporter.CombatTimes(null, null),
                ReplayExporter.combatTimes(null, Float.NaN, Float.NaN));
    }

    private static NeutralCampTimeline timelineWithSpawner() {
        NeutralCampTimeline timeline = new NeutralCampTimeline();
        timeline.onSpawnerCreated(entity(1, 101, NeutralCampTimeline.SPAWNER_CLASS, null), spawnerProperties());
        return timeline;
    }

    private static NeutralCampTimeline timelineWithCreep() {
        NeutralCampTimeline timeline = timelineWithSpawner();
        timeline.onCreepCreated(entity(2, 22, NeutralCampTimeline.CREEP_CLASS, 1.0),
                creepProperties(101, 300));
        return timeline;
    }

    private static NeutralCampTimeline.EntityData entity(
            long uid, long handle, String className, Double gameTime) {
        return new NeutralCampTimeline.EntityData(
                uid, uid, (int) uid, 1, handle, 7, className, 10, gameTime);
    }

    private static List<NeutralCampTimeline.Property> spawnerProperties() {
        return List.of(
                new NeutralCampTimeline.Property("CBodyComponent.m_cellX", 120),
                new NeutralCampTimeline.Property("CBodyComponent.m_cellY", 166),
                new NeutralCampTimeline.Property("CBodyComponent.m_vecX", 172.0),
                new NeutralCampTimeline.Property("CBodyComponent.m_vecY", 76.0),
                new NeutralCampTimeline.Property("m_Type", 1),
                new NeutralCampTimeline.Property("m_iTeamNum", 0));
    }

    private static List<NeutralCampTimeline.Property> creepProperties(long spawnerHandle, int health) {
        return List.of(
                new NeutralCampTimeline.Property("m_hNeutralSpawner", spawnerHandle),
                new NeutralCampTimeline.Property("m_lifeState", 0),
                new NeutralCampTimeline.Property("m_iHealth", health),
                new NeutralCampTimeline.Property("m_iTeamNum", 4),
                new NeutralCampTimeline.Property("m_bIsSummoned", false));
    }

    private static List<String> logicalFiles(List<NeutralCampTimeline.Emission> emissions) {
        return emissions.stream().map(NeutralCampTimeline.Emission::logicalFile).toList();
    }

    @SuppressWarnings("unchecked")
    private static List<String> checkpointPaths(NeutralCampTimeline.Emission emission) {
        return ((List<Map<String, Object>>) emission.row().get("properties")).stream()
                .map(property -> (String) property.get("propertyPath"))
                .toList();
    }

    @SuppressWarnings("unchecked")
    private static Object checkpointValue(NeutralCampTimeline.Emission emission, String path) {
        return ((List<Map<String, Object>>) emission.row().get("properties")).stream()
                .filter(property -> path.equals(property.get("propertyPath")))
                .findFirst()
                .orElseThrow()
                .get("value");
    }
}
