export interface DotaAsset {
  name: string;
  imageUrl: string | null;
}

// Valve's public Steam CDN uses these stable dota_react asset paths. The ID
// maps are intentionally local so rendering an ingested match never depends on
// a second metadata request. Unknown IDs keep a text fallback instead of
// producing a broken image URL.
const CDN_ROOT = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react";

const HEROES: Record<number, readonly [name: string, slug: string]> = {
  1: ["Anti-Mage", "antimage"], 2: ["Axe", "axe"], 3: ["Bane", "bane"],
  4: ["Bloodseeker", "bloodseeker"], 5: ["Crystal Maiden", "crystal_maiden"],
  6: ["Drow Ranger", "drow_ranger"], 7: ["Earthshaker", "earthshaker"],
  8: ["Juggernaut", "juggernaut"], 9: ["Mirana", "mirana"], 10: ["Morphling", "morphling"],
  11: ["Shadow Fiend", "nevermore"], 12: ["Phantom Lancer", "phantom_lancer"],
  13: ["Puck", "puck"], 14: ["Pudge", "pudge"], 15: ["Razor", "razor"],
  16: ["Sand King", "sand_king"], 17: ["Storm Spirit", "storm_spirit"], 18: ["Sven", "sven"],
  19: ["Tiny", "tiny"], 20: ["Vengeful Spirit", "vengefulspirit"], 21: ["Windranger", "windrunner"],
  22: ["Zeus", "zuus"], 23: ["Kunkka", "kunkka"], 25: ["Lina", "lina"], 26: ["Lion", "lion"],
  27: ["Shadow Shaman", "shadow_shaman"], 28: ["Slardar", "slardar"], 29: ["Tidehunter", "tidehunter"],
  30: ["Witch Doctor", "witch_doctor"], 31: ["Lich", "lich"], 32: ["Riki", "riki"],
  33: ["Enigma", "enigma"], 34: ["Tinker", "tinker"], 35: ["Sniper", "sniper"],
  36: ["Necrophos", "necrolyte"], 37: ["Warlock", "warlock"], 38: ["Beastmaster", "beastmaster"],
  39: ["Queen of Pain", "queenofpain"], 40: ["Venomancer", "venomancer"],
  41: ["Faceless Void", "faceless_void"], 42: ["Wraith King", "skeleton_king"],
  43: ["Death Prophet", "death_prophet"], 44: ["Phantom Assassin", "phantom_assassin"],
  45: ["Pugna", "pugna"], 46: ["Templar Assassin", "templar_assassin"], 47: ["Viper", "viper"],
  48: ["Luna", "luna"], 49: ["Dragon Knight", "dragon_knight"], 50: ["Dazzle", "dazzle"],
  51: ["Clockwerk", "rattletrap"], 52: ["Leshrac", "leshrac"], 53: ["Nature's Prophet", "furion"],
  54: ["Lifestealer", "life_stealer"], 55: ["Dark Seer", "dark_seer"], 56: ["Clinkz", "clinkz"],
  57: ["Omniknight", "omniknight"], 58: ["Enchantress", "enchantress"], 59: ["Huskar", "huskar"],
  60: ["Night Stalker", "night_stalker"], 61: ["Broodmother", "broodmother"],
  62: ["Bounty Hunter", "bounty_hunter"], 63: ["Weaver", "weaver"], 64: ["Jakiro", "jakiro"],
  65: ["Batrider", "batrider"], 66: ["Chen", "chen"], 67: ["Spectre", "spectre"],
  68: ["Ancient Apparition", "ancient_apparition"], 69: ["Doom", "doom_bringer"], 70: ["Ursa", "ursa"],
  71: ["Spirit Breaker", "spirit_breaker"], 72: ["Gyrocopter", "gyrocopter"],
  73: ["Alchemist", "alchemist"], 74: ["Invoker", "invoker"], 75: ["Silencer", "silencer"],
  76: ["Outworld Devourer", "obsidian_destroyer"], 77: ["Lycan", "lycan"],
  78: ["Brewmaster", "brewmaster"], 79: ["Shadow Demon", "shadow_demon"],
  80: ["Lone Druid", "lone_druid"], 81: ["Chaos Knight", "chaos_knight"], 82: ["Meepo", "meepo"],
  83: ["Treant Protector", "treant"], 84: ["Ogre Magi", "ogre_magi"], 85: ["Undying", "undying"],
  86: ["Rubick", "rubick"], 87: ["Disruptor", "disruptor"], 88: ["Nyx Assassin", "nyx_assassin"],
  89: ["Naga Siren", "naga_siren"], 90: ["Keeper of the Light", "keeper_of_the_light"],
  91: ["Io", "wisp"], 92: ["Visage", "visage"], 93: ["Slark", "slark"], 94: ["Medusa", "medusa"],
  95: ["Troll Warlord", "troll_warlord"], 96: ["Centaur Warrunner", "centaur"],
  97: ["Magnus", "magnataur"], 98: ["Timbersaw", "shredder"], 99: ["Bristleback", "bristleback"],
  100: ["Tusk", "tusk"], 101: ["Skywrath Mage", "skywrath_mage"], 102: ["Abaddon", "abaddon"],
  103: ["Elder Titan", "elder_titan"], 104: ["Legion Commander", "legion_commander"],
  105: ["Techies", "techies"], 106: ["Ember Spirit", "ember_spirit"],
  107: ["Earth Spirit", "earth_spirit"], 108: ["Underlord", "abyssal_underlord"],
  109: ["Terrorblade", "terrorblade"], 110: ["Phoenix", "phoenix"], 111: ["Oracle", "oracle"],
  112: ["Winter Wyvern", "winter_wyvern"], 113: ["Arc Warden", "arc_warden"],
  114: ["Monkey King", "monkey_king"], 119: ["Dark Willow", "dark_willow"],
  120: ["Pangolier", "pangolier"], 121: ["Grimstroke", "grimstroke"], 123: ["Hoodwink", "hoodwink"],
  126: ["Void Spirit", "void_spirit"], 128: ["Snapfire", "snapfire"], 129: ["Mars", "mars"],
  131: ["Ringmaster", "ringmaster"], 135: ["Dawnbreaker", "dawnbreaker"], 136: ["Marci", "marci"],
  137: ["Primal Beast", "primal_beast"], 138: ["Muerta", "muerta"], 145: ["Kez", "kez"],
  155: ["Largo", "largo"],
};

// Finished and commonly retained inventory items. IDs outside this map still
// render as an explicit Item #ID fallback, including newly released items.
const ITEMS: Record<number, readonly [name: string, slug: string]> = {
  1: ["Blink Dagger", "blink"], 29: ["Boots of Speed", "boots"], 30: ["Gem of True Sight", "gem"],
  36: ["Magic Wand", "magic_wand"], 37: ["Ghost Scepter", "ghost"], 41: ["Bottle", "bottle"],
  42: ["Observer Ward", "ward_observer"], 43: ["Sentry Ward", "ward_sentry"],
  46: ["Town Portal Scroll", "tpscroll"], 48: ["Boots of Travel", "travel_boots"],
  50: ["Phase Boots", "phase_boots"], 63: ["Power Treads", "power_treads"],
  65: ["Hand of Midas", "hand_of_midas"], 73: ["Bracer", "bracer"],
  75: ["Wraith Band", "wraith_band"], 77: ["Null Talisman", "null_talisman"],
  79: ["Mekansm", "mekansm"], 81: ["Vladmir's Offering", "vladmir"], 86: ["Buckler", "buckler"],
  88: ["Ring of Basilius", "ring_of_basilius"], 90: ["Pipe of Insight", "pipe"],
  92: ["Urn of Shadows", "urn_of_shadows"], 94: ["Headdress", "headdress"],
  96: ["Scythe of Vyse", "sheepstick"], 98: ["Orchid Malevolence", "orchid"],
  100: ["Eul's Scepter of Divinity", "cyclone"], 102: ["Force Staff", "force_staff"],
  104: ["Dagon", "dagon"], 108: ["Aghanim's Scepter", "ultimate_scepter"],
  110: ["Refresher Orb", "refresher"], 112: ["Assault Cuirass", "assault"],
  114: ["Heart of Tarrasque", "heart"], 116: ["Black King Bar", "black_king_bar"],
  117: ["Aegis of the Immortal", "aegis"], 119: ["Shiva's Guard", "shivas_guard"],
  121: ["Bloodstone", "bloodstone"], 123: ["Linken's Sphere", "sphere"],
  125: ["Vanguard", "vanguard"], 127: ["Blade Mail", "blade_mail"],
  131: ["Hood of Defiance", "hood_of_defiance"], 133: ["Divine Rapier", "rapier"],
  135: ["Monkey King Bar", "monkey_king_bar"], 137: ["Radiance", "radiance"],
  139: ["Butterfly", "butterfly"], 141: ["Daedalus", "greater_crit"],
  143: ["Skull Basher", "basher"], 145: ["Battle Fury", "bfury"], 147: ["Manta Style", "manta"],
  149: ["Crystalys", "lesser_crit"], 151: ["Armlet of Mordiggian", "armlet"],
  152: ["Shadow Blade", "invis_sword"], 154: ["Sange and Yasha", "sange_and_yasha"],
  156: ["Satanic", "satanic"], 158: ["Mjollnir", "mjollnir"], 160: ["Eye of Skadi", "skadi"],
  162: ["Sange", "sange"], 164: ["Helm of the Dominator", "helm_of_the_dominator"],
  166: ["Maelstrom", "maelstrom"], 168: ["Desolator", "desolator"], 170: ["Yasha", "yasha"],
  172: ["Mask of Madness", "mask_of_madness"], 174: ["Diffusal Blade", "diffusal_blade"],
  176: ["Ethereal Blade", "ethereal_blade"], 178: ["Soul Ring", "soul_ring"],
  180: ["Arcane Boots", "arcane_boots"], 185: ["Drum of Endurance", "ancient_janggo"],
  187: ["Medallion of Courage", "medallion_of_courage"], 190: ["Veil of Discord", "veil_of_discord"],
  206: ["Rod of Atos", "rod_of_atos"], 208: ["Abyssal Blade", "abyssal_blade"],
  210: ["Heaven's Halberd", "heavens_halberd"], 214: ["Tranquil Boots", "tranquil_boots"],
  220: ["Boots of Travel 2", "travel_boots_2"], 223: ["Meteor Hammer", "meteor_hammer"],
  225: ["Nullifier", "nullifier"], 226: ["Lotus Orb", "lotus_orb"], 229: ["Solar Crest", "solar_crest"],
  231: ["Guardian Greaves", "guardian_greaves"], 232: ["Aether Lens", "aether_lens"],
  235: ["Octarine Core", "octarine_core"], 236: ["Dragon Lance", "dragon_lance"],
  242: ["Crimson Guard", "crimson_guard"], 247: ["Moon Shard", "moon_shard"],
  249: ["Silver Edge", "silver_edge"], 250: ["Bloodthorn", "bloodthorn"],
  252: ["Echo Sabre", "echo_sabre"], 254: ["Glimmer Cape", "glimmer_cape"], 256: ["Aeon Disk", "aeon_disk"],
  259: ["Kaya", "kaya"], 260: ["Refresher Shard", "refresher_shard"],
  263: ["Hurricane Pike", "hurricane_pike"], 267: ["Spirit Vessel", "spirit_vessel"],
  269: ["Holy Locket", "holy_locket"], 271: ["Aghanim's Blessing", "ultimate_scepter_2"],
  273: ["Kaya and Sange", "kaya_and_sange"], 277: ["Yasha and Kaya", "yasha_and_kaya"],
  534: ["Witch Blade", "witch_blade"], 569: ["Orb of Corrosion", "orb_of_corrosion"],
  596: ["Falcon Blade", "falcon_blade"], 598: ["Mage Slayer", "mage_slayer"],
  600: ["Overwhelming Blink", "overwhelming_blink"], 603: ["Swift Blink", "swift_blink"],
  604: ["Arcane Blink", "arcane_blink"], 609: ["Aghanim's Shard", "aghanims_shard"],
  610: ["Wind Waker", "wind_waker"], 635: ["Helm of the Overlord", "helm_of_the_overlord"],
  692: ["Eternal Shroud", "eternal_shroud"], 911: ["Revenant's Brooch", "revenants_brooch"],
  931: ["Boots of Bearing", "boots_of_bearing"], 939: ["Harpoon", "harpoon"],
  1097: ["Disperser", "disperser"], 1107: ["Phylactery", "phylactery"],
  1128: ["Pavise", "pavise"], 1466: ["Gleipnir", "gungir"],
  1806: ["Parasma", "devastator"], 1808: ["Khanda", "angels_demise"],
};

export function heroAsset(heroId: number | null): DotaAsset {
  if (heroId === null || HEROES[heroId] === undefined) {
    return { name: heroId === null ? "Unknown hero" : `Hero #${heroId}`, imageUrl: null };
  }
  const [name, slug] = HEROES[heroId];
  return { name, imageUrl: `${CDN_ROOT}/heroes/${slug}.png` };
}

export function itemAsset(itemId: number | null): DotaAsset {
  if (itemId === null || ITEMS[itemId] === undefined) {
    return { name: itemId === null ? "Unknown item" : `Item #${itemId}`, imageUrl: null };
  }
  const [name, slug] = ITEMS[itemId];
  return { name, imageUrl: `${CDN_ROOT}/items/${slug}.png` };
}
