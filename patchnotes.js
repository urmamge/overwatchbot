const cheerio = require('cheerio');

const SITE_URL = 'https://overwatch.blizzard.com/en-us';
const PATCH_NOTES_URL = `${SITE_URL}/news/patch-notes/`;
const HEROES_URL = `${SITE_URL}/heroes/`;
const CACHE_MS = 15 * 60 * 1000; // Download each patch notes page at most once every 15 minutes
const HEROES_CACHE_MS = 24 * 60 * 60 * 1000; // The hero list rarely changes
const MONTHS_TO_SEARCH = 6; // How far back to look for something that hasn't changed recently

const ROLES = ['tank', 'damage', 'support'];
const LIST_TAGS = new Set(['ul', 'ol']);
const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']);
const INTRO_PATTERN = /^(hotfix|bug fix update|client update)/i; // Sections that only say what kind of patch it is

// Which entries each /patchnotes type shows
const TYPE_FILTERS = {
    heroes: (entry) => entry.group === 'core' && entry.kind === 'hero',
    stadium: (entry) => entry.group === 'stadium',
    hotfix: (entry, patch) => patch.isHotfix,
    bugfixes: (entry) => entry.group === 'bugfix',
    general: (entry) => entry.group === 'core' && (entry.kind === 'update' || entry.kind === 'section') && !entry.intro,
    maps: (entry) => entry.kind === 'map'
};

const cache = new Map();

// Reuses recent downloads so lots of servers using the bot don't flood Blizzard's website
async function getParsedPage(url, parse, maxAge = CACHE_MS) {
    const cached = cache.get(url);
    if (cached && Date.now() - cached.at < maxAge) return cached.value;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);

    const value = parse(await response.text());
    cache.set(url, { value, at: Date.now() });
    return value;
}

// Lowercase without accents or punctuation, so "lucio" matches "Lúcio" and "soldier 76" matches "Soldier: 76"
function normalizeName(name) {
    return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Stops characters like * and _ in the patch notes from turning into Discord formatting
function escapeMarkdown(text) {
    return text.replace(/([*_~`|\\])/g, '\\$1');
}

// Wraps text in a markdown marker while keeping its surrounding spaces outside the marker
function wrap(text, marker) {
    const [, before, inner, after] = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return inner ? `${before}${marker}${inner}${marker}${after}` : text;
}

function inlineMarkdown(nodes) {
    let text = '';
    for (const node of nodes) {
        if (node.type === 'text') text += escapeMarkdown(node.data.replace(/\s+/g, ' '));
        if (node.type !== 'tag') continue;

        const inner = inlineMarkdown(node.children);
        if (node.name === 'br') text += '\n';
        else if (node.name === 'strong' || node.name === 'b') text += wrap(inner, '**');
        else if (node.name === 'em' || node.name === 'i') text += wrap(inner, '*');
        else if (node.name === 'a' && node.attribs.href) text += `[${inner.trim()}](${new URL(node.attribs.href, SITE_URL).href})`;
        else text += inner;
    }
    return text;
}

function blockLines(nodes, depth = 0) {
    const lines = [];
    let inline = [];
    const flush = () => {
        for (const line of inlineMarkdown(inline).split('\n')) {
            if (line.trim()) lines.push(line.trim());
        }
        inline = [];
    };

    for (const node of nodes) {
        if (node.type === 'tag' && LIST_TAGS.has(node.name)) {
            flush();
            lines.push(...listLines(node, depth));
        } else if (node.type === 'tag' && BLOCK_TAGS.has(node.name)) {
            flush();
            lines.push(...blockLines(node.children, depth));
        } else {
            inline.push(node);
        }
    }
    flush();
    return lines;
}

function listLines(list, depth) {
    const lines = [];
    for (const item of list.children.filter((node) => node.name === 'li')) {
        const nested = item.children.filter((node) => LIST_TAGS.has(node.name));
        const text = blockLines(item.children.filter((node) => !nested.includes(node))).join(' ');

        if (text) lines.push(`${'  '.repeat(depth)}- ${text}`);
        for (const sublist of nested) lines.push(...listLines(sublist, depth + 1));
    }
    return lines;
}

// Converts patch notes HTML into Discord markdown, with a gap between a list and the paragraph after it
function toMarkdown(nodes) {
    const lines = blockLines(nodes);
    return lines
        .map((line, i) => (i > 0 && !/^\s*- /.test(line) && /^\s*- /.test(lines[i - 1]) ? `\n${line}` : line))
        .join('\n');
}

// Developer comments are shown as a quote, like the indented box on the website
function devMarkdown($, el) {
    const text = el.toArray().map((node) => toMarkdown(node.children)).join('\n');
    if (!text) return '';
    return text
        .replace(/^Developer Comments:/, '**Developer Comments:**')
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
}

function joinParts(parts) {
    return parts.filter(Boolean).join('\n\n');
}

function parseHero($, heroEl, section) {
    const hero = $(heroEl);
    const abilities = hero.find('.PatchNotesAbilityUpdate').toArray().map((abilityEl) => {
        const ability = $(abilityEl);
        const name = escapeMarkdown(ability.find('.PatchNotesAbilityUpdate-name').text().trim());
        const details = toMarkdown(ability.find('.PatchNotesAbilityUpdate-detailList').toArray().flatMap((el) => el.children));
        return `**${name}**\n${details}`;
    });

    return {
        ...section,
        kind: 'hero',
        name: hero.find('.PatchNotesHeroUpdate-name').text().trim(),
        icon: hero.find('.PatchNotesHeroUpdate-icon').attr('src'),
        text: joinParts([
            devMarkdown($, hero.find('.PatchNotesHeroUpdate-dev')),
            toMarkdown(hero.find('.PatchNotesHeroUpdate-generalUpdates').toArray().flatMap((el) => el.children)),
            ...abilities
        ])
    };
}

function parsePatch($, patchEl) {
    const patch = $(patchEl);
    const anchor = patch.find('.anchor').attr('id') ?? '';
    const [, year, month] = anchor.match(/^patch-(\d{4})-(\d{2})/) ?? [];
    const entries = [];
    let group = 'core';
    let isHotfix = false;

    for (const sectionEl of patch.find('.PatchNotes-section').toArray()) {
        const sectionNode = $(sectionEl);
        const title = sectionNode.children('.PatchNotes-sectionTitle').text().trim();
        const sectionClass = sectionEl.attribs.class ?? '';
        const kind = sectionClass.includes('hero_update') ? 'hero' : sectionClass.includes('map_update') ? 'map' : 'generic';
        const intro = INTRO_PATTERN.test(title);
        if (intro && /hotfix/i.test(title)) isHotfix = true;

        // Hero sections under "Stadium Updates" are Stadium changes until the next main heading,
        // and everything after "Bug Fixes" is a bug fix
        if (/^bug fixes$/i.test(title)) group = 'bugfix';
        else if (group !== 'bugfix' && kind === 'generic' && title && !intro) group = /^stadium/i.test(title) ? 'stadium' : 'core';

        const section = { group, section: title, intro, role: ROLES.includes(title.toLowerCase()) ? title.toLowerCase() : null };

        if (kind === 'generic') {
            const text = joinParts([
                toMarkdown(sectionNode.children('.PatchNotes-sectionDescription').toArray().flatMap((el) => el.children)),
                devMarkdown($, sectionNode.children('.PatchNotes-dev'))
            ]);
            if (text) entries.push({ ...section, kind: 'section', title, text });
        }

        for (const heroEl of sectionNode.find('.PatchNotesHeroUpdate').toArray()) {
            entries.push(parseHero($, heroEl, section));
        }

        for (const updateEl of sectionNode.find('.PatchNotesGeneralUpdate').toArray()) {
            const update = $(updateEl);
            const updateTitle = update.find('.PatchNotesGeneralUpdate-title').text().trim();
            const description = update.find('.PatchNotesGeneralUpdate-description').get(0);
            entries.push({
                ...section,
                kind: 'update',
                title: updateTitle,
                text: joinParts([
                    description ? toMarkdown(description.children) : '',
                    devMarkdown($, update.find('.PatchNotesGeneralUpdate-dev'))
                ])
            });
        }

        for (const mapEl of sectionNode.find('.PatchNotesMapUpdate').toArray()) {
            const map = $(mapEl);
            entries.push({
                ...section,
                kind: 'map',
                title: map.find('.PatchNotesMapUpdate-name').text().trim(),
                text: toMarkdown(map.find('.PatchNotesMapUpdate-generalUpdates').toArray().flatMap((el) => el.children)),
                image: map.find('blz-image[slot="after"]').attr('src')
            });
        }
    }

    return {
        id: anchor,
        title: patch.find('.PatchNotes-patchTitle').text().trim(),
        date: patch.find('.PatchNotes-date').text().trim(),
        url: year ? `${PATCH_NOTES_URL}live/${year}/${month}#${anchor}` : PATCH_NOTES_URL,
        isHotfix,
        entries
    };
}

// Reads every patch on one month's page, plus the link to the month before it
function parseMonth(html) {
    const $ = cheerio.load(html);
    const previous = $('.PatchNotesPaginationLink--prev').first();
    const year = previous.attr('data-year');
    const month = previous.attr('data-month');

    return {
        patches: $('.PatchNotes-patch').toArray().map((patchEl) => parsePatch($, patchEl)),
        previousUrl: year && month ? `${PATCH_NOTES_URL}live/${year}/${month.padStart(2, '0')}` : null
    };
}

function parseHeroes(html) {
    const $ = cheerio.load(html);
    return $('a.hero-card').toArray().map((cardEl) => {
        const card = $(cardEl);
        return {
            name: card.find('h2[slot="heading"]').text().trim(),
            role: card.attr('data-role'),
            portrait: card.find('blz-image.heroCardPortrait').attr('src')
        };
    }).filter((hero) => hero.name && ROLES.includes(hero.role));
}

// Every hero with their role, read from the heroes page so new heroes show up without a code change
async function getHeroes() {
    return getParsedPage(HEROES_URL, parseHeroes, HEROES_CACHE_MS);
}

// The patches on the newest month's page, newest first
async function getLatestPatches() {
    return (await getParsedPage(PATCH_NOTES_URL, parseMonth)).patches;
}

// Searches from the newest patch backwards and returns the first one with matching changes,
// or only looks at one patch when given its id
async function findPatchNotes({ type, role, hero, patchId }) {
    const heroes = new Map((await getHeroes().catch(() => [])).map((info) => [normalizeName(info.name), info]));
    let url = PATCH_NOTES_URL;

    for (let i = 0; i < MONTHS_TO_SEARCH && url; i++) {
        const month = await getParsedPage(url, parseMonth);

        for (const patch of month.patches) {
            if (patchId && patch.id !== patchId) continue;

            let entries = patch.entries
                .filter((entry) => TYPE_FILTERS[type](entry, patch))
                .map((entry) => {
                    if (entry.kind !== 'hero') return entry;
                    const info = heroes.get(normalizeName(entry.name));
                    return { ...entry, role: entry.role ?? info?.role ?? null, icon: entry.icon ?? info?.portrait };
                });

            if (hero) entries = entries.filter((entry) => entry.kind === 'hero' && normalizeName(entry.name) === normalizeName(hero));
            else if (role) entries = entries.filter((entry) => entry.kind === 'hero' && entry.role === role);

            if (entries.length || patchId) return entries.length ? { patch, entries } : null;
        }

        url = month.previousUrl;
    }

    return null;
}

module.exports = { findPatchNotes, getLatestPatches, getHeroes, getParsedPage, normalizeName, MONTHS_TO_SEARCH, PATCH_NOTES_URL, SITE_URL };
