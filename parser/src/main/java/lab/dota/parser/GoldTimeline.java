package lab.dota.parser;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalInt;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Tick-level coalescing and de-duplication for team-local player cumulative gold. */
final class GoldTimeline {
    private static final Pattern TOTAL_GOLD_PATH = Pattern.compile(
            "^m_vecDataTeam\\.(\\d+)\\.m_iTotalEarnedGold$");

    private final Map<PlayerKey, PendingGold> untimedBaselineByPlayer = new LinkedHashMap<>();
    private final Map<PlayerKey, PendingGold> pendingByPlayer = new LinkedHashMap<>();
    private final Map<PlayerKey, Long> lastGoldByPlayer = new LinkedHashMap<>();
    private boolean clockStarted;

    static OptionalInt teamSlot(String propertyPath) {
        Matcher matcher = TOTAL_GOLD_PATH.matcher(propertyPath);
        if (!matcher.matches()) return OptionalInt.empty();
        try {
            return OptionalInt.of(Integer.parseInt(matcher.group(1)));
        } catch (NumberFormatException ignored) {
            return OptionalInt.empty();
        }
    }

    void observe(String entityInstanceId, String propertyPath, Object value) {
        OptionalInt teamSlot = teamSlot(propertyPath);
        if (teamSlot.isEmpty() || !(value instanceof Number number)) return;
        long totalGold = number.longValue();
        if (totalGold < 0) return;
        PlayerKey key = new PlayerKey(entityInstanceId, teamSlot.getAsInt());
        PendingGold pending = new PendingGold(
                entityInstanceId, teamSlot.getAsInt(), propertyPath, totalGold);
        pendingByPlayer.put(key, pending);
    }

    List<GoldUpdate> finishTick(Double gameTime) {
        if (gameTime == null || !Double.isFinite(gameTime)) {
            untimedBaselineByPlayer.putAll(pendingByPlayer);
            pendingByPlayer.clear();
            return List.of();
        }
        List<GoldUpdate> result = new ArrayList<>(pendingByPlayer.size());
        if (!clockStarted) {
            clockStarted = true;
            Map<PlayerKey, PendingGold> baselines = new LinkedHashMap<>(untimedBaselineByPlayer);
            pendingByPlayer.forEach(baselines::putIfAbsent);
            for (var entry : baselines.entrySet()) {
                PendingGold baseline = entry.getValue();
                result.add(new GoldUpdate(baseline.entityInstanceId(), baseline.teamSlot(),
                        baseline.propertyPath(), baseline.totalGold(), Math.min(gameTime, 0.0)));
                lastGoldByPlayer.put(entry.getKey(), baseline.totalGold());
            }
            untimedBaselineByPlayer.clear();
            pendingByPlayer.entrySet().removeIf(entry -> {
                Long baseline = lastGoldByPlayer.get(entry.getKey());
                return baseline != null && baseline == entry.getValue().totalGold();
            });
            return result;
        }
        var iterator = pendingByPlayer.entrySet().iterator();
        while (iterator.hasNext()) {
            var entry = iterator.next();
            PlayerKey key = entry.getKey();
            PendingGold pending = entry.getValue();
            Long lastGold = lastGoldByPlayer.get(key);
            if (lastGold != null && lastGold == pending.totalGold()) {
                iterator.remove();
                continue;
            }
            result.add(new GoldUpdate(pending.entityInstanceId(), pending.teamSlot(),
                    pending.propertyPath(), pending.totalGold(), gameTime));
            lastGoldByPlayer.put(key, pending.totalGold());
            iterator.remove();
        }
        return result;
    }

    record GoldUpdate(String entityInstanceId, int teamSlot, String propertyPath,
                      long totalGold, double gameTime) {}

    private record PlayerKey(String entityInstanceId, int teamSlot) {}

    private record PendingGold(String entityInstanceId, int teamSlot,
                               String propertyPath, long totalGold) {}
}
