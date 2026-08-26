package lab.dota.parser;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Tracks main hero entities and makes pause-safe position samples.
 *
 * <p>Source 2 stores each coordinate as a cell and an offset in that cell.
 * The world coordinate is {@code cell * 128 - 16384 + offset}. Field aliases
 * are kept here so that the staged data contract does not depend on Clarity
 * send-table names.</p>
 */
final class HeroPositionTimeline {
    static final long SAMPLE_INTERVAL_MILLISECONDS = 100L;
    static final double MIN_WORLD_COORDINATE = -8288.0;
    static final double MAX_WORLD_COORDINATE = 8288.0;

    private static final double CELL_SIZE = 128.0;
    private static final double WORLD_ORIGIN_OFFSET = 16384.0;
    private static final long SOURCE_NULL_HANDLE = 16_777_215L;
    private static final Pattern PLAYER_HERO_PATH = Pattern.compile(
            "^m_vecPlayerTeamData\\.(\\d+)\\.m_nSelectedHeroID$");
    private static final Pattern PLAYER_TEAM_PATH = Pattern.compile(
            "^m_vecPlayerData\\.(\\d+)\\.m_iPlayerTeam$");
    private static final Pattern PLAYER_HERO_HANDLE_PATH = Pattern.compile(
            "^m_vecPlayerTeamData\\.(\\d+)\\.m_hSelectedHero$");
    private static final List<String> POSITION_PREFIXES = List.of(
            "CBodyComponent",
            "CBodyComponentBaseAnimating",
            "CBodyComponentBaseAnimatingOverlay",
            "m_pGameSceneNode.m_vecOrigin");

    private final Map<Long, HeroState> heroes = new LinkedHashMap<>();
    private final Map<Integer, RosterState> roster = new HashMap<>();
    private long nextSampleMilliseconds;
    private long generation;
    private Long gameEndMilliseconds;

    void onHeroCreated(long entityUid) {
        onHeroCreated(entityUid, entityUid);
    }

    void onHeroCreated(long entityUid, long entityHandle) {
        heroes.put(entityUid, new HeroState(++generation, entityHandle));
    }

    void onHeroDeleted(long entityUid) {
        heroes.remove(entityUid);
    }

    void observeHeroProperty(long entityUid, String path, Object value) {
        HeroState hero = heroes.computeIfAbsent(
                entityUid, ignored -> new HeroState(++generation, entityUid));
        if (isProperty(path, "m_iPlayerID") || isProperty(path, "m_nPlayerID")) {
            hero.gamePlayerId = integer(value);
        } else if (isProperty(path, "m_iHeroID") || isProperty(path, "m_nHeroID")
                || isProperty(path, "m_nSelectedHeroID")) {
            hero.heroId = positiveInteger(value);
        } else if (isProperty(path, "m_iHeroFacetKey")) {
            hero.heroId = heroIdFromFacetKey(value);
        } else if (isProperty(path, "m_iTeamNum") || isProperty(path, "m_iTeamNumber")) {
            hero.teamId = integer(value);
        } else if (isProperty(path, "m_lifeState")) {
            hero.lifeState = integer(value);
        } else if (isProperty(path, "m_bIsIllusion")) {
            hero.illusion = bool(value);
        } else if (isProperty(path, "m_bIsClone")) {
            hero.clone = bool(value);
        } else if (isProperty(path, "m_bIsPhantom")) {
            hero.phantom = bool(value);
        } else if (isProperty(path, "m_hReplicatingOtherHeroModel")) {
            hero.replicatingHandle = longInteger(value);
        } else if (isPositionProperty(path, "m_cellX")) {
            hero.cellX = longInteger(value);
        } else if (isPositionProperty(path, "m_cellY")) {
            hero.cellY = longInteger(value);
        } else if (isPositionProperty(path, "m_vecX")) {
            hero.offsetX = finiteDouble(value);
        } else if (isPositionProperty(path, "m_vecY")) {
            hero.offsetY = finiteDouble(value);
        }
    }

    /** Observe the two player-resource fields used as the authoritative roster. */
    void observeRosterProperty(String path, Object value) {
        Matcher heroMatch = PLAYER_HERO_PATH.matcher(path);
        if (heroMatch.matches()) {
            int gamePlayerId = Integer.parseInt(heroMatch.group(1));
            if (validGamePlayerId(gamePlayerId)) {
                roster.computeIfAbsent(gamePlayerId, ignored -> new RosterState()).heroId = positiveInteger(value);
            }
            return;
        }
        Matcher handleMatch = PLAYER_HERO_HANDLE_PATH.matcher(path);
        if (handleMatch.matches()) {
            int gamePlayerId = Integer.parseInt(handleMatch.group(1));
            if (validGamePlayerId(gamePlayerId)) {
                roster.computeIfAbsent(gamePlayerId, ignored -> new RosterState())
                        .selectedHeroHandle = longInteger(value);
            }
            return;
        }
        Matcher teamMatch = PLAYER_TEAM_PATH.matcher(path);
        if (teamMatch.matches()) {
            int gamePlayerId = Integer.parseInt(teamMatch.group(1));
            if (validGamePlayerId(gamePlayerId)) {
                roster.computeIfAbsent(gamePlayerId, ignored -> new RosterState()).teamId = integer(value);
            }
        }
    }

    /** Add final match data as a second authoritative roster source. */
    void observeRoster(int gamePlayerId, int heroId, int teamId) {
        if (!validGamePlayerId(gamePlayerId)) return;
        RosterState state = roster.computeIfAbsent(gamePlayerId, ignored -> new RosterState());
        if (heroId > 0) state.heroId = heroId;
        if (teamId == 2 || teamId == 3) state.teamId = teamId;
    }

    /** Stop sampling at the last 100 ms boundary at or before the end marker. */
    void markGameEnded(Double gameTimeSeconds) {
        Long observed = gameTimeMilliseconds(gameTimeSeconds);
        if (observed != null && observed >= 0) {
            gameEndMilliseconds = gameEndMilliseconds == null
                    ? observed : Math.min(gameEndMilliseconds, observed);
        }
    }

    List<PositionSample> finishTick(Double gameTimeSeconds, int demoTick) {
        Long reachedMilliseconds = gameTimeMilliseconds(gameTimeSeconds);
        if (reachedMilliseconds == null || reachedMilliseconds < 0) return List.of();
        long upperBound = gameEndMilliseconds == null
                ? reachedMilliseconds : Math.min(reachedMilliseconds, gameEndMilliseconds);
        if (nextSampleMilliseconds > upperBound) return List.of();

        List<PositionSample> result = new ArrayList<>();
        while (nextSampleMilliseconds <= upperBound) {
            for (EligibleHero hero : eligibleHeroes()) {
                result.add(new PositionSample(demoTick, nextSampleMilliseconds,
                        hero.gamePlayerId(), hero.heroId(), hero.teamId(), hero.worldX(), hero.worldY()));
            }
            nextSampleMilliseconds += SAMPLE_INTERVAL_MILLISECONDS;
        }
        return result;
    }

    private List<EligibleHero> eligibleHeroes() {
        Map<Integer, EligibleHero> byPlayer = new HashMap<>();
        for (HeroState state : heroes.values()) {
            EligibleHero candidate = eligible(state);
            if (candidate == null) continue;
            EligibleHero current = byPlayer.get(candidate.gamePlayerId());
            if (current == null || candidate.generation() > current.generation()) {
                byPlayer.put(candidate.gamePlayerId(), candidate);
            }
        }
        return byPlayer.values().stream()
                .sorted(Comparator.comparingInt(EligibleHero::gamePlayerId))
                .toList();
    }

    private EligibleHero eligible(HeroState hero) {
        Integer selectedPlayerId = playerForSelectedHandle(hero.entityHandle);
        Integer gamePlayerId = selectedPlayerId != null ? selectedPlayerId : hero.gamePlayerId;
        if (gamePlayerId == null || !validGamePlayerId(gamePlayerId)) return null;
        RosterState directRoster = roster.get(gamePlayerId);
        if (selectedPlayerId == null && directRoster != null
                && directRoster.selectedHeroHandle != null
                && !isNullHandle(directRoster.selectedHeroHandle)
                && directRoster.selectedHeroHandle != hero.entityHandle) return null;
        if (selectedPlayerId == null && !hasExplicitMainHeroClassification(hero)) return null;
        if (hero.lifeState == null || hero.lifeState != 0) return null;
        if (Boolean.TRUE.equals(hero.illusion) || Boolean.TRUE.equals(hero.clone)
                || Boolean.TRUE.equals(hero.phantom)) return null;
        if (hero.replicatingHandle != null && !isNullHandle(hero.replicatingHandle)) return null;

        RosterState expected = roster.get(gamePlayerId);
        Integer heroId = expected != null && expected.heroId != null ? expected.heroId : hero.heroId;
        Integer teamId = expected != null && expected.teamId != null ? expected.teamId : hero.teamId;
        if (heroId == null || heroId <= 0 || teamId == null || (teamId != 2 && teamId != 3)) return null;
        if (expected != null && expected.heroId != null && hero.heroId != null
                && !expected.heroId.equals(hero.heroId)) return null;
        if (expected != null && expected.teamId != null && hero.teamId != null
                && !expected.teamId.equals(hero.teamId)) return null;

        Double worldX = worldCoordinate(hero.cellX, hero.offsetX);
        Double worldY = worldCoordinate(hero.cellY, hero.offsetY);
        if (!validWorldCoordinate(worldX) || !validWorldCoordinate(worldY)) return null;
        return new EligibleHero(hero.generation, gamePlayerId, heroId, teamId, worldX, worldY);
    }

    /**
     * A player ID alone does not distinguish a main hero from a copy. If the
     * selected-hero handle is unavailable, require the two copy fields that
     * are present on current main hero entities to explicitly identify the
     * entity as the original.
     */
    private static boolean hasExplicitMainHeroClassification(HeroState hero) {
        return Boolean.FALSE.equals(hero.illusion)
                && Boolean.FALSE.equals(hero.phantom)
                && Boolean.FALSE.equals(hero.clone)
                && hero.replicatingHandle != null
                && isNullHandle(hero.replicatingHandle);
    }

    private Integer playerForSelectedHandle(long entityHandle) {
        for (Map.Entry<Integer, RosterState> entry : roster.entrySet()) {
            Long selected = entry.getValue().selectedHeroHandle;
            if (selected != null && !isNullHandle(selected) && selected == entityHandle) {
                return entry.getKey();
            }
        }
        return null;
    }

    static Double worldCoordinate(Number cell, Number offset) {
        if (cell == null || offset == null) return null;
        double cellValue = cell.doubleValue();
        double offsetValue = offset.doubleValue();
        if (!Double.isFinite(cellValue) || !Double.isFinite(offsetValue)) return null;
        double coordinate = cellValue * CELL_SIZE - WORLD_ORIGIN_OFFSET + offsetValue;
        return Double.isFinite(coordinate) ? coordinate : null;
    }

    static boolean validWorldCoordinate(Double coordinate) {
        return coordinate != null && Double.isFinite(coordinate)
                && coordinate >= MIN_WORLD_COORDINATE && coordinate <= MAX_WORLD_COORDINATE;
    }

    private static Long gameTimeMilliseconds(Double seconds) {
        if (seconds == null || !Double.isFinite(seconds)) return null;
        return (long) Math.floor(seconds * 1000.0 + 0.000001);
    }

    private static boolean validGamePlayerId(int gamePlayerId) {
        return gamePlayerId >= 0 && gamePlayerId <= 9;
    }

    private static boolean isNullHandle(long value) {
        return value == -1L || value == SOURCE_NULL_HANDLE || value == 0xffff_ffffL;
    }

    private static boolean isProperty(String path, String property) {
        return path.equals(property) || path.endsWith("." + property);
    }

    private static boolean isPositionProperty(String path, String property) {
        for (String prefix : POSITION_PREFIXES) {
            if (path.equals(prefix + "." + property)) return true;
        }
        return false;
    }

    private static Integer integer(Object value) {
        if (!(value instanceof Number number)) return null;
        long observed = number.longValue();
        return observed >= Integer.MIN_VALUE && observed <= Integer.MAX_VALUE ? (int) observed : null;
    }

    private static Integer positiveInteger(Object value) {
        Integer observed = integer(value);
        return observed != null && observed > 0 ? observed : null;
    }

    private static Long longInteger(Object value) {
        return value instanceof Number number ? number.longValue() : null;
    }

    private static Double finiteDouble(Object value) {
        if (!(value instanceof Number number)) return null;
        double observed = number.doubleValue();
        return Double.isFinite(observed) ? observed : null;
    }

    private static Boolean bool(Object value) {
        return value instanceof Boolean observed ? observed : null;
    }

    private static Integer heroIdFromFacetKey(Object value) {
        if (!(value instanceof Number number)) return null;
        long key = number.longValue();
        long observed = key >>> 32;
        return observed > 0 && observed <= Integer.MAX_VALUE ? (int) observed : null;
    }

    record PositionSample(int demoTick, long gameTimeMilliseconds, int gamePlayerId,
                          int heroId, int teamId, double worldX, double worldY) {}

    private static final class HeroState {
        final long generation;
        final long entityHandle;
        Integer gamePlayerId;
        Integer heroId;
        Integer teamId;
        Integer lifeState;
        Boolean illusion;
        Boolean clone;
        Boolean phantom;
        Long replicatingHandle;
        Long cellX;
        Long cellY;
        Double offsetX;
        Double offsetY;

        HeroState(long generation, long entityHandle) {
            this.generation = generation;
            this.entityHandle = entityHandle;
        }
    }

    private static final class RosterState {
        Integer heroId;
        Integer teamId;
        Long selectedHeroHandle;
    }

    private record EligibleHero(long generation, int gamePlayerId, int heroId,
                                int teamId, double worldX, double worldY) {}
}
