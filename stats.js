const cheerio = require('cheerio');
const { getParsedPage, normalizeName, SITE_URL } = require('./patchnotes');

const STATS_URL = `${SITE_URL}/rates/`;
const MAPS_CACHE_MS = 24 * 60 * 60 * 1000; // The map list only changes when a map is added
const ALL_MAPS = 'all-maps';
const TOP_COUNT = 3;

// The values the stats page uses in its URL for each option
const INPUTS = { pc: 'PC', controller: 'Console' };
const REGIONS = { europe: 'Europe', asia: 'Asia', americas: 'Americas' };
const MODES = { quickplay: '0', competitive: '2' };
const RANKS = {
    bronze: 'Bronze',
    silver: 'Silver',
    gold: 'Gold',
    platinum: 'Platinum',
    emerald: 'Emerald',
    diamond: 'Diamond',
    master: 'Master',
    grandmaster: 'Grandmaster'
};

const INPUT_NAMES = { pc: 'Mouse & Keyboard', controller: 'Controller' };
const REGION_NAMES = { europe: 'Europe', asia: 'Asia', americas: 'Americas' };
const MODE_NAMES = { quickplay: 'Quick Play', competitive: 'Competitive' };
const RANK_NAMES = { ...RANKS, grandmaster: 'Grandmaster and Champion' };

// Every map in the stats page's map filter, with the modes it has stats for
function parseMaps(html) {
    const $ = cheerio.load(html);
    return $('#filter-map-select option').toArray().map((optionEl) => {
        const option = $(optionEl);
        return {
            name: option.attr('data-title'),
            value: option.attr('value'),
            modes: (option.attr('data-rqs') ?? '').split(',').filter(Boolean)
        };
    }).filter((map) => map.value && map.value !== ALL_MAPS);
}

// Read from the stats page so new maps show up without a code change
async function getMaps() {
    return getParsedPage(STATS_URL, parseMaps, MAPS_CACHE_MS);
}

// Finds a map by its name or its URL value, so both a picked suggestion and a typed name work
async function findMap(typed) {
    const maps = await getMaps();
    return maps.find((map) => normalizeName(map.value) === normalizeName(typed) || normalizeName(map.name) === normalizeName(typed)) ?? null;
}

// Ranks only exist in Competitive, so the stats page ignores them in Quick Play
function statsParams({ input, region, mode, map, rank }) {
    return new URLSearchParams({
        input: INPUTS[input],
        map: map?.value ?? ALL_MAPS,
        region: REGIONS[region],
        role: 'All',
        rq: MODES[mode],
        tier: RANKS[rank] ?? 'All'
    });
}

// The stats page with the same filters picked, for the "Open hero stats" button
function statsPageUrl(filters) {
    return `${STATS_URL}?${statsParams(filters)}`;
}

// Every hero's win, pick and ban rates for the filters
async function getStats(filters) {
    const data = await getParsedPage(`${STATS_URL}data/?${statsParams(filters)}`, JSON.parse);
    return data.rates.rates.map((row) => ({
        name: row.cells.name,
        role: row.hero.role.toLowerCase(),
        portrait: row.hero.portrait,
        winrate: row.cells.winrate,
        pickrate: row.cells.pickrate,
        banrate: row.cells.banrate
    }));
}

// The role's heroes with the highest win, pick or ban rates
async function getTopHeroes(filters, role, sort) {
    return (await getStats(filters))
        .filter((hero) => hero.role === role)
        .sort((a, b) => b[sort] - a[sort])
        .slice(0, TOP_COUNT);
}

async function getHeroStats(filters, name) {
    const stats = await getStats(filters);
    return stats.find((row) => normalizeName(row.name) === normalizeName(name)) ?? null;
}

module.exports = { getMaps, findMap, getTopHeroes, getHeroStats, statsPageUrl, MODES, INPUT_NAMES, REGION_NAMES, MODE_NAMES, RANK_NAMES };
