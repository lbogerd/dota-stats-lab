package lab.dota.parser;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Selects and normalizes Valve win-probability samples from replay entities. */
final class WinProbabilityTimeline {
    static final String GRAPH_HISTORY = "graph_history";
    static final String SPECTATOR_UPDATES = "spectator_updates";
    static final int GRAPH_POSITION_COUNT = 64;

    private static final double GRAPH_SCALE = 100.0;
    private static final Pattern GRAPH_VALUE_PATH = Pattern.compile(
            "^m_pGraphManager\\.m_rgRadiantWinChance\\.(\\d{4})$");

    private final Map<Integer, Integer> graphValues = new TreeMap<>();
    private final Map<Double, Double> spectatorValues = new TreeMap<>();
    private Double graphStartTime;
    private Double graphEndTime;
    private Double matchDuration;
    private Double pendingSpectatorValue;

    void observeMatchDuration(Object value) {
        Double observed = finiteDouble(value);
        matchDuration = observed != null && observed >= 0 ? observed : null;
    }

    void observeGraphProperty(String path, Object value) {
        if (isProperty(path, "m_flTotalEarnedGoldStartTime")) {
            graphStartTime = finiteDouble(value);
            return;
        }
        if (isProperty(path, "m_flTotalEarnedGoldEndTime")) {
            graphEndTime = finiteDouble(value);
            return;
        }
        Matcher matcher = GRAPH_VALUE_PATH.matcher(path);
        if (!matcher.matches() || !(value instanceof Number number)) return;
        int index = Integer.parseInt(matcher.group(1));
        if (index < 0 || index >= GRAPH_POSITION_COUNT) return;
        long observed = number.longValue();
        if (observed < 0 || observed > 100) {
            graphValues.remove(index);
            return;
        }
        graphValues.put(index, (int) observed);
    }

    void observeSpectatorProperty(String path, Object value) {
        if (!isProperty(path, "m_fRadiantWinProbability")) return;
        Double probability = finiteDouble(value);
        pendingSpectatorValue = validProbability(probability) ? probability : null;
    }

    /** Store the last current-value update for this pause-safe game time. */
    void finishTick(Double gameTimeSeconds) {
        if (pendingSpectatorValue == null) return;
        if (gameTimeSeconds != null && Double.isFinite(gameTimeSeconds) && gameTimeSeconds >= 0) {
            spectatorValues.put(gameTimeSeconds, pendingSpectatorValue);
        }
        pendingSpectatorValue = null;
    }

    List<Sample> samples() {
        List<Sample> graph = graphSamples();
        if (!graph.isEmpty()) return graph;
        return spectatorValues.entrySet().stream()
                .map(entry -> new Sample(entry.getKey(), entry.getValue(), SPECTATOR_UPDATES))
                .toList();
    }

    private List<Sample> graphSamples() {
        if (graphStartTime == null || graphEndTime == null || matchDuration == null
                || !Double.isFinite(graphStartTime) || !Double.isFinite(graphEndTime)
                || graphEndTime <= graphStartTime
                || graphValues.values().stream().noneMatch(value -> value != 0)) {
            return List.of();
        }
        double duration = graphEndTime - graphStartTime;
        double startGameTime = matchDuration - duration;
        Map<Double, Sample> byTime = new TreeMap<>();
        for (Map.Entry<Integer, Integer> entry : graphValues.entrySet()) {
            double gameTime = startGameTime
                    + duration * entry.getKey() / (GRAPH_POSITION_COUNT - 1.0);
            if (!Double.isFinite(gameTime) || gameTime < 0) continue;
            double probability = entry.getValue() / GRAPH_SCALE;
            if (!validProbability(probability)) continue;
            byTime.put(gameTime, new Sample(gameTime, probability, GRAPH_HISTORY));
        }
        return new ArrayList<>(byTime.values());
    }

    private static boolean validProbability(Double value) {
        return value != null && Double.isFinite(value) && value >= 0.0 && value <= 1.0;
    }

    private static Double finiteDouble(Object value) {
        if (!(value instanceof Number number)) return null;
        double observed = number.doubleValue();
        return Double.isFinite(observed) ? observed : null;
    }

    private static boolean isProperty(String path, String property) {
        return path.equals(property) || path.endsWith("." + property);
    }

    record Sample(double gameTimeSeconds, double radiantProbability, String source) {}
}
