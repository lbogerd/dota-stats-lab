package lab.dota.parser;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import skadistats.clarity.model.CombatLogEntry;
import skadistats.clarity.processor.gameevents.OnCombatLogEntry;
import skadistats.clarity.processor.reader.OnMessage;
import skadistats.clarity.processor.runner.Context;
import skadistats.clarity.wire.dota.s2.proto.DOTAS2GcMessagesCommon;
import skadistats.clarity.wire.dota.s2.proto.DOTAS2MatchMetadata;

import java.io.IOException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/** Compact, analysis-oriented default extraction profile. */
final class ReplayExporter {
    static final String PROFILE = "match-analysis-v1";
    private static final Logger log = LoggerFactory.getLogger(ReplayExporter.class);

    private final String extractionId;
    private final NdjsonSet output;
    private final Instant deadline;
    private DOTAS2GcMessagesCommon.CMsgDOTAMatch match;
    private DOTAS2MatchMetadata.CDOTAMatchMetadataFile metadata;
    private int matchTick;
    private int metadataTick;
    private long combatSequence;

    ReplayExporter(String extractionId, NdjsonSet output, ExportConfig config, Instant startedAt) {
        this.extractionId = extractionId;
        this.output = output;
        this.deadline = startedAt.plusSeconds(config.timeoutSeconds());
    }

    @OnMessage(DOTAS2GcMessagesCommon.CMsgDOTAMatch.class)
    public void onMatch(Context context, DOTAS2GcMessagesCommon.CMsgDOTAMatch message) {
        touch();
        match = message;
        matchTick = context.getTick();
    }

    @OnMessage(DOTAS2MatchMetadata.CDOTAMatchMetadataFile.class)
    public void onMetadata(Context context, DOTAS2MatchMetadata.CDOTAMatchMetadataFile message) {
        touch();
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
        row.put("sequence", ++combatSequence);
        row.put("gameTime", event.hasTimestamp() ? event.getTimestamp() : null);
        row.put("rawTime", event.hasTimestampRaw() ? event.getTimestampRaw() : null);
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

    void finish() throws Exception {
        if (match == null) throw new IOException("replay does not contain CMsgDOTAMatch");
        if (metadata == null) throw new IOException("replay does not contain CDOTAMatchMetadataFile");
        writeRecord(1, matchTick, "match_overview", match);
        writeRecord(2, metadataTick, "match_metadata", metadata);
        log.info("profile={} exported 2 match documents and {} typed combat events",
                PROFILE, combatSequence);
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
            long blobSequence = 2 + combatSequence + output.totalRecords();
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
}
