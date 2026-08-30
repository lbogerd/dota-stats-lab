package lab.dota.parser;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import skadistats.clarity.model.CombatLogEntry;
import skadistats.clarity.model.Entity;
import skadistats.clarity.model.FieldPath;
import skadistats.clarity.processor.entities.OnEntityCreated;
import skadistats.clarity.processor.entities.OnEntityDeleted;
import skadistats.clarity.processor.entities.OnEntityUpdated;
import skadistats.clarity.processor.gameevents.OnCombatLogEntry;
import skadistats.clarity.processor.reader.OnMessage;
import skadistats.clarity.processor.reader.OnTickEnd;
import skadistats.clarity.processor.runner.Context;
import skadistats.clarity.wire.dota.s2.proto.DOTAS2GcMessagesCommon;
import skadistats.clarity.wire.dota.s2.proto.DOTAS2MatchMetadata;
import skadistats.clarity.wire.shared.common.proto.CommonNetworkBaseTypes;

import java.io.IOException;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/** Compact, analysis-oriented default extraction profile. */
final class ReplayExporter {
    static final String PROFILE = "match-analysis-v4";
    private static final Logger log = LoggerFactory.getLogger(ReplayExporter.class);

    private final String extractionId;
    private final NdjsonSet output;
    private final Instant deadline;
    private DOTAS2GcMessagesCommon.CMsgDOTAMatch match;
    private DOTAS2MatchMetadata.CDOTAMatchMetadataFile metadata;
    private int matchTick;
    private int metadataTick;
    private long timelineSequence;
    private long heroPositionSequence;
    private long winProbabilitySequence;
    private long entitySequence;
    private int demoTick;
    private final Map<Long, String> teamDataIds = new HashMap<>();
    private final GameClock gameClock = new GameClock();
    private final GoldTimeline goldTimeline = new GoldTimeline();
    private final HeroPositionTimeline heroPositionTimeline = new HeroPositionTimeline();
    private final WinProbabilityTimeline winProbabilityTimeline = new WinProbabilityTimeline();
    private final NeutralCampTimeline neutralCampTimeline = new NeutralCampTimeline();
    private boolean gameEnded;

    ReplayExporter(String extractionId, NdjsonSet output, ExportConfig config, Instant startedAt) {
        this.extractionId = extractionId;
        this.output = output;
        this.deadline = startedAt.plusSeconds(config.timeoutSeconds());
    }

    @OnMessage(DOTAS2GcMessagesCommon.CMsgDOTAMatch.class)
    public void onMatch(Context context, DOTAS2GcMessagesCommon.CMsgDOTAMatch message) {
        touch(context);
        match = message;
        matchTick = context.getTick();
        for (DOTAS2GcMessagesCommon.CMsgDOTAMatch.Player player : message.getPlayersList()) {
            if (!player.hasPlayerSlot() || !player.hasHeroId()) continue;
            int playerSlot = player.getPlayerSlot();
            if (playerSlot >= 0 && playerSlot <= 4) {
                heroPositionTimeline.observeRoster(playerSlot, player.getHeroId(), 2);
            } else if (playerSlot >= 128 && playerSlot <= 132) {
                heroPositionTimeline.observeRoster(5 + playerSlot - 128, player.getHeroId(), 3);
            }
        }
        if (message.hasDuration() && message.getDuration() > 0) {
            heroPositionTimeline.markGameEnded((double) message.getDuration());
            winProbabilityTimeline.observeMatchDuration(message.getDuration());
        }
    }

    @OnMessage(DOTAS2MatchMetadata.CDOTAMatchMetadataFile.class)
    public void onMetadata(Context context, DOTAS2MatchMetadata.CDOTAMatchMetadataFile message) {
        touch(context);
        metadata = message;
        metadataTick = context.getTick();
    }

    /**
     * Retain the full useful combat history in typed, compact columns. This is
     * intentionally not the original protobuf JSON: names, amounts, teams,
     * locations, economy samples, durations and flags cover combat/economy/
     * objective analysis without presentation or transport noise.
     */
    @OnCombatLogEntry
    public void onCombatLog(CombatLogEntry event) throws IOException {
        touch();
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("extractionId", extractionId);
        row.put("sequence", ++timelineSequence);
        Float sourceTimestamp = event.hasTimestamp() ? event.getTimestamp() : null;
        Float rawTimestamp = event.hasTimestampRaw() ? event.getTimestampRaw() : null;
        CombatTimes combatTimes = combatTimes(gameClock.gameTime(), sourceTimestamp, rawTimestamp);
        row.put("gameTime", combatTimes.gameTime());
        row.put("rawTime", combatTimes.rawTime());
        row.put("eventType", event.hasType() ? event.getType().name() : null);
        row.put("targetName", event.hasTargetName() ? event.getTargetName() : null);
        row.put("targetSourceName", event.hasTargetSourceName() ? event.getTargetSourceName() : null);
        row.put("attackerName", event.hasAttackerName() ? event.getAttackerName() : null);
        row.put("damageSourceName", event.hasDamageSourceName() ? event.getDamageSourceName() : null);
        row.put("inflictorName", event.hasInflictorName() ? event.getInflictorName() : null);
        row.put("targetTeam", event.hasTargetTeam() ? event.getTargetTeam() : null);
        row.put("attackerTeam", event.hasAttackerTeam() ? event.getAttackerTeam() : null);
        row.put("value", event.hasValue() ? event.getValue() : null);
        row.put("valueName", event.hasValue() ? event.getValueName() : null);
        row.put("health", event.hasHealth() ? event.getHealth() : null);
        row.put("locationX", event.hasLocationX() ? event.getLocationX() : null);
        row.put("locationY", event.hasLocationY() ? event.getLocationY() : null);
        row.put("eventLocation", event.hasEventLocation() ? event.getEventLocation() : null);
        row.put("stunDuration", event.hasStunDuration() ? event.getStunDuration() : null);
        row.put("slowDuration", event.hasSlowDuration() ? event.getSlowDuration() : null);
        row.put("modifierDuration", event.hasModifierDuration() ? event.getModifierDuration() : null);
        row.put("modifierElapsedDuration", event.hasModifierElapsedDuration() ? event.getModifierElapsedDuration() : null);
        row.put("goldReason", event.hasGoldReason() ? event.getGoldReason() : null);
        row.put("xpReason", event.hasXpReason() ? event.getXpReason() : null);
        row.put("lastHits", event.hasLastHits() ? event.getLastHits() : null);
        row.put("netWorth", event.hasNetworth() ? event.getNetworth() : null);
        row.put("gpm", event.hasGpm() ? event.getGpm() : null);
        row.put("xpm", event.hasXpm() ? event.getXpm() : null);
        row.put("attackerHeroLevel", event.hasAttackerHeroLevel() ? event.getAttackerHeroLevel() : null);
        row.put("targetHeroLevel", event.hasTargetHeroLevel() ? event.getTargetHeroLevel() : null);
        row.put("damageType", event.hasDamageType() ? event.getDamageType() : null);
        row.put("damageCategory", event.hasDamageCategory() ? event.getDamageCategory() : null);
        row.put("runeType", event.hasRuneType() ? event.getRuneType() : null);
        row.put("stackCount", event.hasStackCount() ? event.getStackCount() : null);
        row.put("observerWardsPlaced", event.hasObsWardsPlaced() ? event.getObsWardsPlaced() : null);
        row.put("assistPlayers", event.hasAssistPlayers() ? event.getAssistPlayers() : java.util.List.of());
        row.put("abilityLevel", event.hasAbilityLevel() ? event.getAbilityLevel() : null);
        row.put("neutralCampType", event.hasNeutralCampType() ? event.getNeutralCampType() : null);
        row.put("buildingType", event.hasBuildingType() ? event.getBuildingType() : null);
        row.put("modifierPurgeAbility", event.hasModifierPurgeAbility() ? event.getModifierPurgeAbility() : null);
        row.put("modifierPurgeNpc", event.hasModifierPurgeNpc() ? event.getModifierPurgeNpc() : null);
        row.put("totalUnitDeathCount", event.hasTotalUnitDeathCount() ? event.getTotalUnitDeathCount() : null);
        row.put("modifierAbility", event.hasModifierAbility() ? event.getModifierAbility() : null);
        row.put("killEaterEvent", event.hasKillEaterEvent() ? event.getKillEaterEvent() : null);
        row.put("unitStatusLabel", event.hasUnitStatusLabel() ? event.getUnitStatusLabel() : null);
        row.put("neutralCampTeam", event.hasNeutralCampTeam() ? event.getNeutralCampTeam() : null);
        row.put("regeneratedHealth", event.hasRegeneratedHealth() ? event.getRegeneratedHealth() : null);
        row.put("trackedStatId", event.hasTrackedStatId() ? event.getTrackedStatId() : null);
        row.put("modifierPurgedDuration", event.hasModifierPurgedDuration() ? event.getModifierPurgedDuration() : null);
        row.put("attackerHero", event.hasAttackerHero() ? event.isAttackerHero() : null);
        row.put("targetHero", event.hasTargetHero() ? event.isTargetHero() : null);
        row.put("targetBuilding", event.hasTargetBuilding() ? event.isTargetBuilding() : null);
        row.put("attackerIllusion", event.hasAttackerIllusion() ? event.isAttackerIllusion() : null);
        row.put("targetIllusion", event.hasTargetIllusion() ? event.isTargetIllusion() : null);
        row.put("healSave", event.hasHealSave() ? event.isHealSave() : null);
        row.put("longRangeKill", event.hasLongRangeKill() ? event.isLongRangeKill() : null);
        row.put("visibleRadiant", event.hasVisibleRadiant() ? event.isVisibleRadiant() : null);
        row.put("visibleDire", event.hasVisibleDire() ? event.isVisibleDire() : null);
        row.put("abilityToggleOn", event.hasAbilityToggleOn() ? event.isAbilityToggleOn() : null);
        row.put("abilityToggleOff", event.hasAbilityToggleOff() ? event.isAbilityToggleOff() : null);
        row.put("hiddenModifier", event.hasHiddenModifier() ? event.getHiddenModifier() : null);
        row.put("ultimateAbility", event.hasUltimateAbility() ? event.isUltimateAbility() : null);
        row.put("targetSelf", event.hasTargetSelf() ? event.isTargetSelf() : null);
        row.put("invisibilityModifier", event.hasInvisibilityModifier() ? event.isInvisibilityModifier() : null);
        row.put("silenceModifier", event.hasSilenceModifier() ? event.isSilenceModifier() : null);
        row.put("healFromLifesteal", event.hasHealFromLifesteal() ? event.isHealFromLifesteal() : null);
        row.put("modifierPurged", event.hasModifierPurged() ? event.isModifierPurged() : null);
        row.put("spellEvaded", event.hasSpellEvaded() ? event.isSpellEvaded() : null);
        row.put("motionControllerModifier", event.hasMotionControllerModifier() ? event.isMotionControllerModifier() : null);
        row.put("rootModifier", event.hasRootModifier() ? event.isRootModifier() : null);
        row.put("auraModifier", event.hasAuraModifier() ? event.isAuraModifier() : null);
        row.put("armorDebuffModifier", event.hasArmorDebuffModifier() ? event.isArmorDebuffModifier() : null);
        row.put("noPhysicalDamageModifier", event.hasNoPhysicalDamageModifier() ? event.isNoPhysicalDamageModifier() : null);
        row.put("modifierHidden", event.hasModifierHidden() ? event.isModifierHidden() : null);
        row.put("inflictorIsStolenAbility", event.hasInflictorIsStolenAbility() ? event.isInflictorIsStolenAbility() : null);
        row.put("spellGeneratedAttack", event.hasSpellGeneratedAttack() ? event.isSpellGeneratedAttack() : null);
        row.put("atNightTime", event.hasAtNightTime() ? event.isAtNightTime() : null);
        row.put("attackerHasScepter", event.hasAttackerHasScepter() ? event.isAttackerHasScepter() : null);
        row.put("willReincarnate", event.hasWillReincarnate() ? event.isWillReincarnate() : null);
        row.put("usesCharges", event.hasUsesCharges() ? event.isUsesCharges() : null);
        row.put("healFromRegen", event.hasHealFromRegen() ? event.isHealFromRegen() : null);
        output.write("combatEvents", row);
    }

    @OnMessage(CommonNetworkBaseTypes.CNETMsg_Tick.class)
    public void onNetworkTick(Context context, CommonNetworkBaseTypes.CNETMsg_Tick message) {
        touch(context);
        gameClock.observeTick(message.getTick(), context.getMillisPerTick());
    }

    @OnEntityCreated(classPattern = "CDOTAGamerulesProxy")
    public void onGameRulesCreated(Context context, Entity entity) {
        touch(context);
        observeGameRulesState(entity);
    }

    @OnEntityUpdated(classPattern = "CDOTAGamerulesProxy")
    public void onGameRulesUpdated(Context context, Entity entity, FieldPath[] paths, int count) {
        touch(context);
        for (int i = 0; i < count; i++) observeGameRulesProperty(entity, paths[i]);
        gameClock.refresh();
        if (gameEnded) heroPositionTimeline.markGameEnded(gameClock.gameTime());
    }

    @OnEntityCreated(classPattern = "CDOTA_DataRadiant|CDOTA_DataDire")
    public void onTeamDataCreated(Context context, Entity entity) throws IOException {
        touch(context);
        String instanceId = ensureTeamData(entity);
        observeTeamDataState(instanceId, entity);
    }

    @OnEntityUpdated(classPattern = "CDOTA_DataRadiant|CDOTA_DataDire")
    public void onTeamDataUpdated(Context context, Entity entity, FieldPath[] paths, int count)
            throws IOException {
        touch(context);
        String instanceId = ensureTeamData(entity);
        for (int i = 0; i < count; i++) {
            String path = entity.getDtClass().getNameForFieldPath(paths[i]);
            goldTimeline.observe(instanceId, path, entity.getPropertyForFieldPath(paths[i]));
        }
    }

    @OnEntityCreated(classPattern = "CDOTA_PlayerResource")
    public void onPlayerResourceCreated(Context context, Entity entity) {
        touch(context);
        observePlayerResourceState(entity);
    }

    @OnEntityUpdated(classPattern = "CDOTA_PlayerResource")
    public void onPlayerResourceUpdated(Context context, Entity entity, FieldPath[] paths, int count) {
        touch(context);
        for (int i = 0; i < count; i++) observePlayerResourceProperty(entity, paths[i]);
    }

    @OnEntityCreated(classPattern = "CDOTA_DataSpectator")
    public void onSpectatorDataCreated(Context context, Entity entity) {
        touch(context);
        observeSpectatorDataState(entity);
    }

    @OnEntityUpdated(classPattern = "CDOTA_DataSpectator")
    public void onSpectatorDataUpdated(Context context, Entity entity, FieldPath[] paths, int count) {
        touch(context);
        for (int i = 0; i < count; i++) observeSpectatorDataProperty(entity, paths[i]);
    }

    @OnEntityCreated(classPattern = "CDOTASpectatorGraphManagerProxy")
    public void onSpectatorGraphCreated(Context context, Entity entity) {
        touch(context);
        observeSpectatorGraphState(entity);
    }

    @OnEntityUpdated(classPattern = "CDOTASpectatorGraphManagerProxy")
    public void onSpectatorGraphUpdated(Context context, Entity entity, FieldPath[] paths, int count) {
        touch(context);
        for (int i = 0; i < count; i++) observeSpectatorGraphProperty(entity, paths[i]);
    }

    @OnEntityCreated(classPattern = "CDOTA_Unit_Hero_.*")
    public void onHeroCreated(Context context, Entity entity) {
        touch(context);
        heroPositionTimeline.onHeroCreated(entity.getUid(), entity.getHandle());
        observeHeroState(entity);
    }

    @OnEntityUpdated(classPattern = "CDOTA_Unit_Hero_.*")
    public void onHeroUpdated(Context context, Entity entity, FieldPath[] paths, int count) {
        touch(context);
        for (int i = 0; i < count; i++) observeHeroProperty(entity, paths[i]);
    }

    @OnEntityDeleted(classPattern = "CDOTA_Unit_Hero_.*")
    public void onHeroDeleted(Context context, Entity entity) {
        touch(context);
        heroPositionTimeline.onHeroDeleted(entity.getUid());
    }

    @OnEntityCreated(classPattern = "CDOTA_NeutralSpawner")
    public void onNeutralSpawnerCreated(Context context, Entity entity) throws IOException {
        touch(context);
        writeNeutral(neutralCampTimeline.onSpawnerCreated(
                neutralEntityData(entity), entityProperties(entity)));
    }

    @OnEntityUpdated(classPattern = "CDOTA_NeutralSpawner")
    public void onNeutralSpawnerUpdated(Context context, Entity entity, FieldPath[] paths, int count)
            throws IOException {
        touch(context);
        writeNeutral(neutralCampTimeline.onSpawnerUpdated(
                entity.getUid(), entityProperties(entity, paths, count)));
    }

    @OnEntityDeleted(classPattern = "CDOTA_NeutralSpawner")
    public void onNeutralSpawnerDeleted(Context context, Entity entity) throws IOException {
        touch(context);
        writeNeutral(neutralCampTimeline.onDeleted(entity.getUid(), demoTick, gameClock.gameTime()));
    }

    @OnEntityCreated(classPattern = "CDOTA_BaseNPC_Creep_Neutral")
    public void onNeutralCreepCreated(Context context, Entity entity) throws IOException {
        touch(context);
        writeNeutral(neutralCampTimeline.onCreepCreated(
                neutralEntityData(entity), entityProperties(entity)));
    }

    @OnEntityUpdated(classPattern = "CDOTA_BaseNPC_Creep_Neutral")
    public void onNeutralCreepUpdated(Context context, Entity entity, FieldPath[] paths, int count)
            throws IOException {
        touch(context);
        writeNeutral(neutralCampTimeline.onCreepUpdated(
                entity.getUid(), demoTick, gameClock.gameTime(), entityProperties(entity, paths, count)));
    }

    @OnEntityDeleted(classPattern = "CDOTA_BaseNPC_Creep_Neutral")
    public void onNeutralCreepDeleted(Context context, Entity entity) throws IOException {
        touch(context);
        writeNeutral(neutralCampTimeline.onDeleted(entity.getUid(), demoTick, gameClock.gameTime()));
    }

    @OnTickEnd
    public void onTickEnd(Context context, boolean synthetic) throws IOException {
        touch(context);
        winProbabilityTimeline.finishTick(gameClock.gameTime());
        for (GoldTimeline.GoldUpdate update : goldTimeline.finishTick(gameClock.gameTime())) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("extractionId", extractionId);
            row.put("sequence", ++timelineSequence);
            row.put("entityInstanceId", update.entityInstanceId());
            row.put("propertyPath", update.propertyPath());
            row.put("valueType", "Long");
            row.put("value", update.totalGold());
            row.put("demoTick", demoTick);
            row.put("netTick", null);
            row.put("gameTime", update.gameTime());
            output.write("propertyUpdates", row);
        }
        for (HeroPositionTimeline.PositionSample sample
                : heroPositionTimeline.finishTick(gameClock.gameTime(), demoTick)) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("extractionId", extractionId);
            row.put("sequence", ++heroPositionSequence);
            row.put("demoTick", sample.demoTick());
            row.put("gameTimeMilliseconds", sample.gameTimeMilliseconds());
            row.put("gamePlayerId", sample.gamePlayerId());
            row.put("heroId", sample.heroId());
            row.put("teamId", sample.teamId());
            row.put("worldX", sample.worldX());
            row.put("worldY", sample.worldY());
            output.write("heroPositions", row);
        }
    }

    private void observeGameRulesState(Entity entity) {
        if (entity.getState() == null) return;
        var iterator = entity.getState().fieldPathIterator();
        while (iterator.hasNext()) observeGameRulesProperty(entity, iterator.next());
        gameClock.refresh();
        if (gameEnded) heroPositionTimeline.markGameEnded(gameClock.gameTime());
    }

    private void observeGameRulesProperty(Entity entity, FieldPath fieldPath) {
        String path = entity.getDtClass().getNameForFieldPath(fieldPath);
        gameClock.observeProperty(path, entity.getPropertyForFieldPath(fieldPath));
        if ((path.equals("m_nGameState") || path.endsWith(".m_nGameState"))
                && entity.getPropertyForFieldPath(fieldPath) instanceof Number state
                && state.intValue() == 6) {
            gameEnded = true;
        }
    }

    private void observePlayerResourceState(Entity entity) {
        if (entity.getState() == null) return;
        var iterator = entity.getState().fieldPathIterator();
        while (iterator.hasNext()) observePlayerResourceProperty(entity, iterator.next());
    }

    private void observePlayerResourceProperty(Entity entity, FieldPath fieldPath) {
        String path = entity.getDtClass().getNameForFieldPath(fieldPath);
        heroPositionTimeline.observeRosterProperty(path, entity.getPropertyForFieldPath(fieldPath));
    }

    private void observeHeroState(Entity entity) {
        if (entity.getState() == null) return;
        var iterator = entity.getState().fieldPathIterator();
        while (iterator.hasNext()) observeHeroProperty(entity, iterator.next());
    }

    private void observeHeroProperty(Entity entity, FieldPath fieldPath) {
        String path = entity.getDtClass().getNameForFieldPath(fieldPath);
        heroPositionTimeline.observeHeroProperty(
                entity.getUid(), path, entity.getPropertyForFieldPath(fieldPath));
    }

    private void observeSpectatorDataState(Entity entity) {
        if (entity.getState() == null) return;
        var iterator = entity.getState().fieldPathIterator();
        while (iterator.hasNext()) observeSpectatorDataProperty(entity, iterator.next());
    }

    private void observeSpectatorDataProperty(Entity entity, FieldPath fieldPath) {
        String path = entity.getDtClass().getNameForFieldPath(fieldPath);
        winProbabilityTimeline.observeSpectatorProperty(
                path, entity.getPropertyForFieldPath(fieldPath));
    }

    private void observeSpectatorGraphState(Entity entity) {
        if (entity.getState() == null) return;
        var iterator = entity.getState().fieldPathIterator();
        while (iterator.hasNext()) observeSpectatorGraphProperty(entity, iterator.next());
    }

    private void observeSpectatorGraphProperty(Entity entity, FieldPath fieldPath) {
        String path = entity.getDtClass().getNameForFieldPath(fieldPath);
        winProbabilityTimeline.observeGraphProperty(
                path, entity.getPropertyForFieldPath(fieldPath));
    }

    private void observeTeamDataState(String instanceId, Entity entity) {
        if (entity.getState() == null) return;
        var iterator = entity.getState().fieldPathIterator();
        while (iterator.hasNext()) {
            FieldPath fieldPath = iterator.next();
            String path = entity.getDtClass().getNameForFieldPath(fieldPath);
            goldTimeline.observe(instanceId, path, entity.getPropertyForFieldPath(fieldPath));
        }
    }

    private String ensureTeamData(Entity entity) throws IOException {
        String existing = teamDataIds.get(entity.getUid());
        if (existing != null) return existing;
        String instanceId = Long.toString(++entitySequence);
        teamDataIds.put(entity.getUid(), instanceId);
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("extractionId", extractionId);
        row.put("sequence", entitySequence);
        row.put("entityInstanceId", instanceId);
        row.put("entityIndex", entity.getIndex());
        row.put("serial", entity.getSerial());
        row.put("handle", entity.getHandle());
        row.put("classId", entity.getDtClass().getClassId());
        row.put("className", entity.getDtClass().getDtName());
        row.put("demoTick", demoTick);
        row.put("netTick", null);
        row.put("gameTime", gameClock.gameTime());
        output.write("entityInstances", row);
        return instanceId;
    }

    private NeutralCampTimeline.EntityData neutralEntityData(Entity entity) {
        long instanceId = ++entitySequence;
        return new NeutralCampTimeline.EntityData(
                entity.getUid(), instanceId, entity.getIndex(), entity.getSerial(), entity.getHandle(),
                entity.getDtClass().getClassId(), entity.getDtClass().getDtName(), demoTick,
                gameClock.gameTime());
    }

    private static java.util.List<NeutralCampTimeline.Property> entityProperties(Entity entity) {
        if (entity.getState() == null) return java.util.List.of();
        java.util.List<NeutralCampTimeline.Property> properties = new java.util.ArrayList<>();
        var iterator = entity.getState().fieldPathIterator();
        while (iterator.hasNext()) {
            FieldPath fieldPath = iterator.next();
            properties.add(new NeutralCampTimeline.Property(
                    entity.getDtClass().getNameForFieldPath(fieldPath),
                    entity.getPropertyForFieldPath(fieldPath)));
        }
        return properties;
    }

    private static java.util.List<NeutralCampTimeline.Property> entityProperties(
            Entity entity, FieldPath[] paths, int count) {
        java.util.List<NeutralCampTimeline.Property> properties = new java.util.ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            properties.add(new NeutralCampTimeline.Property(
                    entity.getDtClass().getNameForFieldPath(paths[i]),
                    entity.getPropertyForFieldPath(paths[i])));
        }
        return properties;
    }

    private void writeNeutral(java.util.List<NeutralCampTimeline.Emission> emissions)
            throws IOException {
        for (NeutralCampTimeline.Emission emission : emissions) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("extractionId", extractionId);
            if (emission.logicalFile().equals("entityInstances")) {
                row.put("sequence", Long.parseLong((String) emission.row().get("entityInstanceId")));
            } else {
                row.put("sequence", ++timelineSequence);
            }
            row.putAll(emission.row());
            output.write(emission.logicalFile(), row);
        }
    }

    static CombatTimes combatTimes(Double currentGameTime, Float sourceTimestamp,
                                   Float rawTimestamp) {
        Double gameTime = null;
        if (currentGameTime != null && Double.isFinite(currentGameTime)) {
            gameTime = currentGameTime;
        }
        Double rawTime = null;
        if (rawTimestamp != null && Float.isFinite(rawTimestamp)) {
            rawTime = Double.valueOf(rawTimestamp);
        } else if (sourceTimestamp != null && Float.isFinite(sourceTimestamp)) {
            rawTime = Double.valueOf(sourceTimestamp);
        }
        return new CombatTimes(gameTime, rawTime);
    }

    record CombatTimes(Double gameTime, Double rawTime) {}

    void finish() throws Exception {
        if (match == null) throw new IOException("replay does not contain CMsgDOTAMatch");
        if (metadata == null) throw new IOException("replay does not contain CDOTAMatchMetadataFile");
        writeRecord(1, matchTick, "match_overview", match);
        writeRecord(2, metadataTick, "match_metadata", metadata);
        for (WinProbabilityTimeline.Sample sample : winProbabilityTimeline.samples()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("extractionId", extractionId);
            row.put("sampleIndex", winProbabilitySequence++);
            row.put("gameTimeSeconds", sample.gameTimeSeconds());
            row.put("radiantProbability", sample.radiantProbability());
            row.put("source", sample.source());
            output.write("winProbability", row);
        }
        log.info("profile={} exported 2 match documents, {} timeline events, {} hero positions, and {} win-probability samples",
                PROFILE, timelineSequence, heroPositionSequence, winProbabilitySequence);
        NeutralCampTimeline.Stats neutralStats = neutralCampTimeline.stats();
        log.info("profile={} neutral_spawners={} valid_camp_creeps={} invalid_handle_neutral_creeps={} unresolved_non_invalid_links={}",
                PROFILE, neutralStats.spawners(), neutralStats.stagedCampCreeps(),
                neutralStats.invalidHandleNeutralCreeps(), neutralStats.unresolvedNonInvalidLinks());
    }

    private void writeRecord(long sequence, int tick, String category,
                             com.google.protobuf.GeneratedMessage message) throws Exception {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("extractionId", extractionId);
        row.put("sequence", sequence);
        row.put("demoTick", tick);
        row.put("netTick", null);
        row.put("gameTime", match.hasDuration() ? match.getDuration() : null);
        row.put("category", category);
        row.put("recordType", message.getDescriptorForType().getName());
        row.put("payload", ValueEncoder.encodeMessage(message, "", (path, bytes) -> {
            long blobSequence = 2 + timelineSequence + output.totalRecords();
            Map<String, Object> blob = new LinkedHashMap<>();
            blob.put("extractionId", extractionId);
            blob.put("sequence", blobSequence);
            blob.put("demoTick", tick);
            blob.put("netTick", null);
            blob.put("gameTime", null);
            blob.put("blobId", Hashing.sha256(bytes));
            blob.put("recordSequence", sequence);
            blob.put("fieldPath", path);
            blob.put("valueBase64", java.util.Base64.getEncoder().encodeToString(bytes));
            output.write("blobs", blob);
            return Map.of("blobId", Hashing.sha256(bytes));
        }));
        output.write("records", row);
    }

    private void touch() {
        if (Instant.now().isAfter(deadline)) throw new ExportLimitException("parser timeout exceeded");
    }

    private void touch(Context context) {
        demoTick = context.getTick();
        touch();
    }
}
