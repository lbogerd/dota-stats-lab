package lab.dota.parser;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Targeted staging for replay-local neutral camp spawners and their creeps. */
final class NeutralCampTimeline {
    static final String SPAWNER_CLASS = "CDOTA_NeutralSpawner";
    static final String CREEP_CLASS = "CDOTA_BaseNPC_Creep_Neutral";
    static final long INVALID_SPAWNER_HANDLE = 16_777_215L;

    private final Map<Long, NeutralEntity> entities = new HashMap<>();
    private final Set<Long> observedSpawnerHandles = new java.util.HashSet<>();
    private final Map<Long, Long> observedCreepSpawnerHandles = new HashMap<>();
    private int spawnerCount;
    private int stagedCampCreepCount;

    List<Emission> onSpawnerCreated(EntityData entity, List<Property> properties) {
        spawnerCount++;
        observedSpawnerHandles.add(entity.handle());
        NeutralEntity state = new NeutralEntity(entity, true);
        entities.put(entity.uid(), state);
        properties.forEach(property -> observe(state, property));
        List<Emission> emissions = new ArrayList<>();
        emitIdentityAndCreation(state, emissions);
        emitSpawnerCheckpointWhenComplete(state, emissions);
        for (NeutralEntity pending : entities.values()) {
            if (!pending.spawner && !pending.staged && validCompleteCreep(pending)) {
                stageCreep(pending, emissions);
            }
        }
        return emissions;
    }

    List<Emission> onSpawnerUpdated(long uid, List<Property> properties) {
        NeutralEntity state = entities.get(uid);
        if (state == null || !state.spawner) return List.of();
        properties.forEach(property -> observe(state, property));
        List<Emission> emissions = new ArrayList<>();
        emitSpawnerCheckpointWhenComplete(state, emissions);
        return emissions;
    }

    List<Emission> onCreepCreated(EntityData entity, List<Property> properties) {
        NeutralEntity state = new NeutralEntity(entity, false);
        properties.forEach(property -> observe(state, property));
        state.creationComplete = hasAllProperties(state, CREEP_PROPERTIES);
        entities.put(entity.uid(), state);
        rememberCreepSpawnerHandle(state);
        if (!validCompleteCreep(state)) return List.of();
        List<Emission> emissions = new ArrayList<>();
        stageCreep(state, emissions);
        return emissions;
    }

    List<Emission> onCreepUpdated(long uid, int demoTick, Double gameTime,
                                  List<Property> properties) {
        NeutralEntity state = entities.get(uid);
        if (state == null || state.spawner || !state.creationComplete) return List.of();
        List<ObservedChange> changes = new ArrayList<>();
        for (Property property : properties) {
            if (!isHealthOrLifeState(property.path())) continue;
            Object previous = state.currentProperties.get(property.path());
            state.currentProperties.put(property.path(), property.value());
            changes.add(new ObservedChange(property, previous));
        }
        List<Emission> emissions = new ArrayList<>();
        for (ObservedChange change : changes) {
            Property property = change.property();
            Emission emission = new Emission("propertyUpdates", propertyUpdate(
                    state.data.instanceId(), demoTick, gameTime, property));
            if (state.staged) emissions.add(emission);
            else state.pendingEmissions.add(emission);
            if (state.deathGameTime == null
                    && isDeath(property.path(), change.previous(), property.value())) {
                state.deathGameTime = gameTime;
            }
        }
        return emissions;
    }

    List<Emission> onDeleted(long uid, int demoTick, Double gameTime) {
        NeutralEntity state = entities.get(uid);
        if (state == null) return List.of();
        Emission deletion = new Emission("entityEvents", entityEvent(
                state.data.instanceId(), "delete", demoTick, gameTime));
        if (state.staged) {
            entities.remove(uid);
            return List.of(deletion);
        }
        Long spawnerHandle = longValue(propertyValue(state, "m_hNeutralSpawner"));
        if (state.creationComplete && spawnerHandle != null
                && spawnerHandle != INVALID_SPAWNER_HANDLE) {
            state.pendingEmissions.add(deletion);
            return List.of();
        }
        entities.remove(uid);
        return List.of();
    }

    Double deathGameTime(long uid) {
        NeutralEntity state = entities.get(uid);
        return state == null ? null : state.deathGameTime;
    }

    Stats stats() {
        long invalid = observedCreepSpawnerHandles.values().stream()
                .filter(handle -> handle == INVALID_SPAWNER_HANDLE).count();
        long unresolved = observedCreepSpawnerHandles.values().stream()
                .filter(handle -> handle != INVALID_SPAWNER_HANDLE)
                .filter(handle -> !observedSpawnerHandles.contains(handle)).count();
        return new Stats(spawnerCount, stagedCampCreepCount, invalid, unresolved);
    }

    static Double worldCoordinate(Number cell, Number offset) {
        return HeroPositionTimeline.worldCoordinate(cell, offset);
    }

    private boolean validResolvedSpawner(NeutralEntity creep) {
        Long handle = longValue(propertyValue(creep, "m_hNeutralSpawner"));
        return handle != null && handle != INVALID_SPAWNER_HANDLE
                && observedSpawnerHandles.contains(handle);
    }

    private boolean validCompleteCreep(NeutralEntity creep) {
        return creep.creationComplete && validResolvedSpawner(creep);
    }

    private void stageCreep(NeutralEntity state, List<Emission> emissions) {
        state.staged = true;
        stagedCampCreepCount++;
        emitIdentityAndCreation(state, emissions);
        emitCreationCheckpoint(state, CREEP_PROPERTIES, emissions);
        emissions.addAll(state.pendingEmissions);
        state.pendingEmissions.clear();
    }

    private void rememberCreepSpawnerHandle(NeutralEntity creep) {
        Long handle = longValue(propertyValue(creep, "m_hNeutralSpawner"));
        if (handle != null) observedCreepSpawnerHandles.put(creep.data.uid(), handle);
    }

    private static void emitIdentityAndCreation(NeutralEntity state, List<Emission> emissions) {
        EntityData entity = state.data;
        Map<String, Object> identity = new LinkedHashMap<>();
        identity.put("entityInstanceId", Long.toString(entity.instanceId()));
        identity.put("entityIndex", entity.entityIndex());
        identity.put("serial", entity.serial());
        identity.put("handle", entity.handle());
        identity.put("classId", entity.classId());
        identity.put("className", entity.className());
        identity.put("demoTick", entity.demoTick());
        identity.put("netTick", null);
        identity.put("gameTime", entity.gameTime());
        emissions.add(new Emission("entityInstances", identity));
        emissions.add(new Emission("entityEvents", entityEvent(
                entity.instanceId(), "create", entity.demoTick(), entity.gameTime())));
    }

    private static Map<String, Object> entityEvent(long instanceId, String eventType,
                                                   int demoTick, Double gameTime) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("entityInstanceId", Long.toString(instanceId));
        row.put("eventType", eventType);
        row.put("demoTick", demoTick);
        row.put("netTick", null);
        row.put("gameTime", gameTime);
        row.put("synthetic", false);
        return row;
    }

    private static Map<String, Object> propertyUpdate(long instanceId, int demoTick,
                                                      Double gameTime, Property property) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("entityInstanceId", Long.toString(instanceId));
        row.put("propertyPath", property.path());
        row.put("valueType", ValueEncoder.valueType(property.value()));
        row.put("value", property.value());
        row.put("demoTick", demoTick);
        row.put("netTick", null);
        row.put("gameTime", gameTime);
        return row;
    }

    private static void emitSpawnerCheckpointWhenComplete(NeutralEntity state,
                                                           List<Emission> emissions) {
        if (state.checkpointWritten || !hasAllProperties(state, SPAWNER_PROPERTIES)) return;
        Number cellX = numberValue(propertyValue(state, "CBodyComponent.m_cellX"));
        Number cellY = numberValue(propertyValue(state, "CBodyComponent.m_cellY"));
        Number offsetX = numberValue(propertyValue(state, "CBodyComponent.m_vecX"));
        Number offsetY = numberValue(propertyValue(state, "CBodyComponent.m_vecY"));
        if (worldCoordinate(cellX, offsetX) == null || worldCoordinate(cellY, offsetY) == null) return;
        emitCreationCheckpointProperties(state, List.of(
                new Property("m_Type", propertyValue(state, "m_Type")),
                new Property("worldX", worldCoordinate(cellX, offsetX)),
                new Property("worldY", worldCoordinate(cellY, offsetY))), emissions);
    }

    private static void emitCreationCheckpoint(NeutralEntity state, List<String> selected,
                                               List<Emission> emissions) {
        List<Map<String, Object>> properties = new ArrayList<>();
        for (String path : selected) {
            Map<String, Object> property = new LinkedHashMap<>();
            Object value = state.properties.get(path);
            property.put("propertyPath", path);
            property.put("valueType", ValueEncoder.valueType(value));
            property.put("value", value);
            properties.add(property);
        }
        writeCreationCheckpoint(state, properties, emissions);
    }

    private static void emitCreationCheckpointProperties(NeutralEntity state,
                                                         List<Property> selected,
                                                         List<Emission> emissions) {
        List<Map<String, Object>> properties = new ArrayList<>();
        for (Property selectedProperty : selected) {
            Map<String, Object> property = new LinkedHashMap<>();
            property.put("propertyPath", selectedProperty.path());
            property.put("valueType", ValueEncoder.valueType(selectedProperty.value()));
            property.put("value", selectedProperty.value());
            properties.add(property);
        }
        writeCreationCheckpoint(state, properties, emissions);
    }

    private static void writeCreationCheckpoint(NeutralEntity state,
                                                List<Map<String, Object>> properties,
                                                List<Emission> emissions) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("entityInstanceId", Long.toString(state.data.instanceId()));
        row.put("checkpointKind", "creation");
        row.put("demoTick", state.data.demoTick());
        row.put("netTick", null);
        row.put("gameTime", state.data.gameTime());
        row.put("checkpointGameTime", state.data.gameTime());
        row.put("properties", properties);
        emissions.add(new Emission("checkpoints", row));
        state.checkpointWritten = true;
    }

    private static void observe(NeutralEntity state, Property property) {
        if (isSelected(state.spawner, property.path())) {
            if (state.spawner && property.path().equals("m_Type")) {
                state.properties.putIfAbsent(property.path(), property.value());
            } else if (!state.spawner || !state.checkpointWritten) {
                state.properties.put(property.path(), property.value());
                if (!state.spawner) state.currentProperties.put(property.path(), property.value());
            }
        }
    }

    private static boolean isSelected(boolean spawner, String path) {
        List<String> selected = spawner ? SPAWNER_PROPERTIES : CREEP_PROPERTIES;
        return selected.contains(path);
    }

    private static boolean hasAllProperties(NeutralEntity state, List<String> selected) {
        return selected.stream().allMatch(property -> state.properties.get(property) != null);
    }

    private static Object propertyValue(NeutralEntity state, String property) {
        return state.properties.get(property);
    }

    private static boolean isHealthOrLifeState(String path) {
        return path.equals("m_iHealth") || path.equals("m_lifeState");
    }

    private static boolean isDeath(String path, Object previous, Object current) {
        if (!(current instanceof Number number)) return false;
        if (path.equals("m_iHealth")) {
            return previous instanceof Number health
                    && health.longValue() != 0 && number.longValue() == 0;
        }
        return path.equals("m_lifeState") && previous instanceof Number alive
                && alive.longValue() == 0 && number.longValue() != 0;
    }

    private static Number numberValue(Object value) {
        return value instanceof Number number ? number : null;
    }

    private static Long longValue(Object value) {
        return value instanceof Number number ? number.longValue() : null;
    }

    private static final List<String> SPAWNER_PROPERTIES = List.of(
            "CBodyComponent.m_cellX", "CBodyComponent.m_cellY",
            "CBodyComponent.m_vecX", "CBodyComponent.m_vecY", "m_Type");
    private static final List<String> CREEP_PROPERTIES = List.of(
            "m_hNeutralSpawner", "m_lifeState", "m_iHealth", "m_iTeamNum", "m_bIsSummoned");

    record EntityData(long uid, long instanceId, int entityIndex, int serial, long handle,
                      int classId, String className, int demoTick, Double gameTime) {}
    record Property(String path, Object value) {}
    record Emission(String logicalFile, Map<String, Object> row) {}
    record Stats(int spawners, int stagedCampCreeps, long invalidHandleNeutralCreeps,
                 long unresolvedNonInvalidLinks) {}
    private record ObservedChange(Property property, Object previous) {}

    private static final class NeutralEntity {
        final EntityData data;
        final boolean spawner;
        final Map<String, Object> properties = new LinkedHashMap<>();
        final Map<String, Object> currentProperties = new HashMap<>();
        final List<Emission> pendingEmissions = new ArrayList<>();
        boolean creationComplete;
        boolean staged;
        boolean checkpointWritten;
        Double deathGameTime;

        NeutralEntity(EntityData data, boolean spawner) {
            this.data = data;
            this.spawner = spawner;
            this.staged = spawner;
        }
    }
}
