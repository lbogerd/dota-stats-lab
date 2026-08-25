package lab.dota.parser;

/**
 * Tracks pause-adjusted Dota game time from the game-rules entity and network
 * ticks. The derived clock is preferred once all of its inputs are known;
 * {@code m_fGameTime} is retained as the early-replay fallback.
 */
final class GameClock {
    private Integer netTick;
    private double millisPerTick;
    private Double gameStartTime;
    private long totalPausedTicks;
    private boolean paused;
    private Double directGameTime;
    private Double gameTime;

    void observeTick(int observedNetTick, double observedMillisPerTick) {
        netTick = observedNetTick;
        if (Double.isFinite(observedMillisPerTick) && observedMillisPerTick > 0) {
            millisPerTick = observedMillisPerTick;
        }
        refresh();
    }

    void observeProperty(String path, Object value) {
        if (value instanceof Number number) {
            double observed = number.doubleValue();
            if (isPath(path, "m_fGameTime") && Double.isFinite(observed)) {
                directGameTime = observed;
            } else if (isPath(path, "m_flGameStartTime")
                    && Double.isFinite(observed) && observed > 0) {
                gameStartTime = observed;
            } else if (isPath(path, "m_nTotalPausedTicks")) {
                totalPausedTicks = Math.max(0, number.longValue());
            }
        } else if (value instanceof Boolean observed && isPath(path, "m_bGamePaused")) {
            paused = observed;
        }
    }

    /** Apply a complete batch of game-rules changes without depending on field order. */
    void refresh() {
        if (paused) {
            if (gameTime == null && directGameTime != null) gameTime = directGameTime;
            return;
        }
        if (netTick != null && gameStartTime != null && millisPerTick > 0) {
            setGameTime(netTick * millisPerTick / 1000.0 - gameStartTime
                    - totalPausedTicks * millisPerTick / 1000.0);
        } else if (directGameTime != null) {
            setGameTime(directGameTime);
        }
    }

    Double gameTime() {
        return gameTime;
    }

    private void setGameTime(double observed) {
        if (Double.isFinite(observed)) gameTime = observed;
    }

    private static boolean isPath(String path, String property) {
        return path.equals(property) || path.endsWith("." + property);
    }
}
