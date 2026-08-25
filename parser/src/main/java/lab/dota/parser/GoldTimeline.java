package lab.dota.parser;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalInt;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Tick-level coalescing and de-duplication for player cumulative gold. */
final class GoldTimeline {
    private static final Pattern TOTAL_GOLD_PATH = Pattern.compile(
            "^m_vecPlayerTeamData\\.(\\d+)\\.m_iTotalEarnedGold$");

    private final Map<Integer, PendingGold> pendingByPlayer = new LinkedHashMap<>();
    private final Map<Integer, Long> lastGoldByPlayer = new LinkedHashMap<>();

    static OptionalInt gamePlayerId(String propertyPath) {
        Matcher matcher = TOTAL_GOLD_PATH.matcher(propertyPath);
        if (!matcher.matches()) return OptionalInt.empty();
        try {
            return OptionalInt.of(Integer.parseInt(matcher.group(1)));
        } catch (NumberFormatException ignored) {
            return OptionalInt.empty();
        }
    }

    void observe(String entityInstanceId, String propertyPath, Object value) {
        OptionalInt gamePlayerId = gamePlayerId(propertyPath);
        if (gamePlayerId.isEmpty() || !(value instanceof Number number)) return;
        long totalGold = number.longValue();
        if (totalGold < 0) return;
        pendingByPlayer.put(gamePlayerId.getAsInt(), new PendingGold(
                entityInstanceId, gamePlayerId.getAsInt(), propertyPath, totalGold));
    }

    List<GoldUpdate> finishTick(Double gameTime) {
        if (gameTime == null || !Double.isFinite(gameTime)) return List.of();
        List<GoldUpdate> result = new ArrayList<>(pendingByPlayer.size());
        for (PendingGold pending : pendingByPlayer.values()) {
            Long lastGold = lastGoldByPlayer.get(pending.gamePlayerId());
            if (lastGold != null && lastGold == pending.totalGold()) continue;
            result.add(new GoldUpdate(pending.entityInstanceId(), pending.gamePlayerId(),
                    pending.propertyPath(), pending.totalGold(), gameTime));
            lastGoldByPlayer.put(pending.gamePlayerId(), pending.totalGold());
        }
        pendingByPlayer.clear();
        return result;
    }

    record GoldUpdate(String entityInstanceId, int gamePlayerId, String propertyPath,
                      long totalGold, double gameTime) {}

    private record PendingGold(String entityInstanceId, int gamePlayerId,
                               String propertyPath, long totalGold) {}
}
