package lab.dota.parser;

import com.google.protobuf.GeneratedMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import skadistats.clarity.model.Entity;
import skadistats.clarity.model.FieldPath;
import skadistats.clarity.processor.entities.OnEntityCreated;
import skadistats.clarity.processor.entities.OnEntityDeleted;
import skadistats.clarity.processor.entities.OnEntityUpdated;
import skadistats.clarity.processor.entities.UsesEntities;
import skadistats.clarity.processor.reader.OnMessage;
import skadistats.clarity.processor.reader.OnTickEnd;
import skadistats.clarity.processor.runner.Context;
import skadistats.clarity.wire.shared.common.proto.CommonNetworkBaseTypes;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@UsesEntities
final class ReplayExporter {
    private static final Logger log = LoggerFactory.getLogger(ReplayExporter.class);
    private final String extractionId;
    private final NdjsonSet output;
    private final ExportConfig config;
    private final Instant deadline;
    private final Map<Integer, ActiveEntity> active = new HashMap<>();
    private long sequence;
    private long entityInstanceSequence;
    private Integer netTick;
    private Double gameTime;
    private double nextCheckpoint;
    private boolean clockInitialized;
    private int demoTick;

    ReplayExporter(String extractionId, NdjsonSet output, ExportConfig config, Instant startedAt) {
        this.extractionId = extractionId;
        this.output = output;
        this.config = config;
        this.deadline = startedAt.plusSeconds(config.timeoutSeconds());
    }

    @OnMessage
    public void onMessage(Context context, GeneratedMessage message) throws Exception {
        touch(context);
        long ownerSequence = nextSequence();
        Map<String, Object> payload = ValueEncoder.encodeMessage(message, "", (path, bytes) -> blob(ownerSequence, path, bytes));
        Map<String, Object> row = common(ownerSequence);
        row.put("category", "message");
        row.put("recordType", message.getDescriptorForType().getFullName());
        row.put("payload", payload);
        output.write("records", row);
    }

    @OnMessage(CommonNetworkBaseTypes.CNETMsg_Tick.class)
    public void onNetTick(Context context, CommonNetworkBaseTypes.CNETMsg_Tick message) {
        touch(context);
        netTick = message.getTick();
    }

    @OnEntityCreated
    public void onCreated(Context context, Entity entity) throws Exception {
        touch(context);
        ActiveEntity previous = active.remove(entity.getIndex());
        if (previous != null) emitEvent(previous, "delete", List.of(), true);

        ActiveEntity current = new ActiveEntity(Long.toString(++entityInstanceSequence), entity);
        active.put(entity.getIndex(), current);
        List<Property> properties = properties(entity);
        observeClock(properties);
        long seq = nextSequence();
        Map<String, Object> instance = common(seq);
        instance.put("entityInstanceId", current.id());
        putIdentity(instance, entity);
        output.write("entityInstances", instance);
        emitEvent(current, "create", List.of(), false);

        for (Property property : properties) emitProperty(current, property);
        emitCheckpoint(current, "creation", properties);
    }

    @OnEntityUpdated
    public void onUpdated(Context context, Entity entity, FieldPath[] fieldPaths, int count) throws Exception {
        touch(context);
        ActiveEntity current = active.get(entity.getIndex());
        if (current == null) {
            // Defensive support for damaged/older demos where Clarity can expose
            // an update without a visible create callback.
            onCreated(context, entity);
            current = active.get(entity.getIndex());
        }
        List<Property> changed = new ArrayList<>(count);
        List<String> paths = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            String path = entity.getDtClass().getNameForFieldPath(fieldPaths[i]);
            Object value = entity.getPropertyForFieldPath(fieldPaths[i]);
            changed.add(new Property(path, value));
            paths.add(path);
        }
        observeClock(changed);
        emitEvent(current, "update", paths, false);
        for (Property property : changed) emitProperty(current, property);
    }

    @OnEntityDeleted
    public void onDeleted(Context context, Entity entity) throws Exception {
        touch(context);
        ActiveEntity current = active.remove(entity.getIndex());
        if (current != null) emitEvent(current, "delete", List.of(), false);
    }

    @OnTickEnd
    public void onTickEnd(Context context, boolean synthetic) throws Exception {
        touch(context);
        if (gameTime == null) return;
        while (gameTime >= nextCheckpoint) {
            checkpointAll("interval");
            nextCheckpoint += config.checkpointIntervalSeconds();
        }
    }

    void finish() throws Exception {
        checkpointAll("completion");
        log.info("exported {} records across {} entity instances", output.totalRecords(), entityInstanceSequence);
    }

    private void checkpointAll(String kind) throws Exception {
        // Clarity only calls us as state advances; if game time is paused it is
        // unchanged, so the interval boundary cannot advance.
        for (ActiveEntity entity : List.copyOf(active.values())) {
            emitCheckpoint(entity, kind, properties(entity.entity()));
        }
    }

    private void emitEvent(ActiveEntity current, String type, List<String> paths, boolean synthetic) throws IOException {
        long seq = nextSequence();
        Map<String, Object> row = common(seq);
        row.put("entityInstanceId", current.id());
        row.put("eventType", type);
        row.put("changedPropertyPaths", paths);
        row.put("synthetic", synthetic);
        output.write("entityEvents", row);
    }

    private void emitProperty(ActiveEntity current, Property property) throws Exception {
        long ownerSequence = nextSequence();
        Object encoded = ValueEncoder.encode(property.value(), property.path(),
                (path, bytes) -> blob(ownerSequence, path, bytes));
        Map<String, Object> row = common(ownerSequence);
        row.put("entityInstanceId", current.id());
        row.put("propertyPath", property.path());
        row.put("valueType", ValueEncoder.valueType(property.value()));
        row.put("value", encoded);
        output.write("propertyUpdates", row);
    }

    private void emitCheckpoint(ActiveEntity current, String kind, List<Property> properties) throws Exception {
        long ownerSequence = nextSequence();
        List<Map<String, Object>> values = new ArrayList<>(properties.size());
        for (Property property : properties) {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("propertyPath", property.path());
            value.put("valueType", ValueEncoder.valueType(property.value()));
            value.put("value", ValueEncoder.encode(property.value(), property.path(),
                    (path, bytes) -> blob(ownerSequence, path, bytes)));
            values.add(value);
        }
        Map<String, Object> row = common(ownerSequence);
        row.put("entityInstanceId", current.id());
        row.put("checkpointKind", kind);
        row.put("checkpointGameTime", gameTime);
        row.put("properties", values);
        output.write("checkpoints", row);
    }

    private Map<String, Object> blob(long ownerSequence, String path, byte[] bytes) throws IOException {
        long seq = nextSequence();
        String id = Hashing.sha256(bytes);
        Map<String, Object> row = common(seq);
        row.put("blobId", id);
        row.put("recordSequence", ownerSequence);
        row.put("fieldPath", path);
        row.put("valueBase64", java.util.Base64.getEncoder().encodeToString(bytes));
        output.write("blobs", row);
        return Map.of("blobId", id);
    }

    private List<Property> properties(Entity entity) {
        List<Property> result = new ArrayList<>();
        Iterator<FieldPath> iterator = entity.getState().fieldPathIterator();
        while (iterator.hasNext()) {
            FieldPath fp = iterator.next();
            result.add(new Property(entity.getDtClass().getNameForFieldPath(fp), entity.getPropertyForFieldPath(fp)));
        }
        return result;
    }

    private void observeClock(List<Property> properties) {
        for (Property property : properties) {
            if (property.value() instanceof Number number &&
                    (property.path().equals("m_fGameTime") || property.path().endsWith(".m_fGameTime"))) {
                double observed = number.doubleValue();
                if (Double.isFinite(observed)) {
                    gameTime = observed;
                    if (!clockInitialized) {
                        double interval = config.checkpointIntervalSeconds();
                        nextCheckpoint = (Math.floor(observed / interval) + 1.0) * interval;
                        clockInitialized = true;
                    }
                }
            }
        }
    }

    private void touch(Context context) {
        demoTick = context.getTick();
        if (Instant.now().isAfter(deadline)) throw new ExportLimitException("parser timeout exceeded: " + config.timeoutSeconds() + " seconds");
    }

    private long nextSequence() { return ++sequence; }

    private Map<String, Object> common(long seq) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("extractionId", extractionId);
        row.put("sequence", seq);
        row.put("demoTick", demoTick);
        row.put("netTick", netTick);
        row.put("gameTime", gameTime);
        return row;
    }

    private static void putIdentity(Map<String, Object> row, Entity entity) {
        row.put("entityIndex", entity.getIndex());
        row.put("serial", entity.getSerial());
        row.put("handle", entity.getHandle());
        row.put("classId", entity.getDtClass().getClassId());
        row.put("className", entity.getDtClass().getDtName());
    }

    private record ActiveEntity(String id, Entity entity) {}
    private record Property(String path, Object value) {}
}
