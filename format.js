const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Embed side colors, matching the role colors used in game where there is one
const COLORS = {
    tank: 0x4c8bf5,
    damage: 0xe5484d,
    support: 0x3db36b,
    stadium: 0xb57bff,
    bugfix: 0x8b8d98,
    map: 0x14a3a3,
    general: 0xf99e1a
};
const ROLE_NAMES = { tank: 'Tank', damage: 'Damage', support: 'Support' };
const GROUP_NAMES = { stadium: 'Stadium', bugfix: 'Bug Fixes' };
const RATE_NAMES = { winrate: 'win rate', pickrate: 'pick rate', banrate: 'ban rate' };
const TYPE_LABELS = { heroes: 'Hero changes', stadium: 'Stadium', general: 'General changes', maps: 'Map changes', bugfixes: 'Bug fixes' };

const DESCRIPTION_LIMIT = 4096; // Discord's limit for one embed's text
const TITLE_LIMIT = 256;
const MESSAGE_EMBED_LIMIT = 5800; // Discord allows 6000 characters across all embeds in a message
const EMBEDS_PER_PAGE = 4; // More than this is a wall of text, especially on phones
const FIELD_LIMIT = 1024; // Discord's limit for one embed field's text
const BUTTONS_PER_ROW = 5;

// Small label above the title, e.g. "Stadium · Tank" or "Support · Hero Updates"
function entryLabel(entry) {
    const parts = [];
    if (entry.kind === 'map') parts.push('Map');
    if (entry.kind === 'hero') parts.push(GROUP_NAMES[entry.group], ROLE_NAMES[entry.role]);
    parts.push(entry.section || GROUP_NAMES[entry.group]);

    const seen = new Set();
    return parts.filter((part) => {
        if (!part || seen.has(part.toLowerCase())) return false;
        seen.add(part.toLowerCase());
        return true;
    }).join(' · ');
}

function entryColor(entry) {
    if (entry.kind === 'hero' && COLORS[entry.role]) return COLORS[entry.role];
    if (entry.kind === 'map') return COLORS.map;
    return COLORS[entry.group] ?? COLORS.general;
}

function truncate(text, limit) {
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

// Splits text into chunks under the limit, breaking on lines where possible
function chunkText(text, limit) {
    const chunks = [];
    let current = '';

    for (let line of text.split('\n')) {
        while (line.length > limit) {
            if (current) chunks.push(current);
            current = '';
            chunks.push(line.slice(0, limit));
            line = line.slice(limit);
        }

        if (current && current.length + line.length + 1 > limit) {
            chunks.push(current);
            current = '';
        }
        current += current ? `\n${line}` : line;
    }

    if (current.trim()) chunks.push(current);
    return chunks;
}

// One embed per hero or update, laid out like its box on the patch notes page
function entryEmbeds(entry, patch) {
    const title = entry.kind === 'hero' ? entry.name : entry.title || entry.section || patch.title;
    const chunks = entry.text ? chunkText(entry.text, DESCRIPTION_LIMIT) : [''];

    return chunks.map((chunk, i) => {
        const embed = new EmbedBuilder()
            .setColor(entryColor(entry))
            .setTitle(truncate(i === 0 ? title : `${title} (continued)`, TITLE_LIMIT))
            .setURL(patch.url)
            .setFooter({ text: patch.title });

        const label = entryLabel(entry);
        if (label) embed.setAuthor({ name: truncate(label, TITLE_LIMIT) });
        if (chunk) embed.setDescription(chunk);
        if (entry.icon && i === 0) embed.setThumbnail(entry.icon);
        if (entry.image && i === chunks.length - 1) embed.setImage(entry.image);
        return embed;
    });
}

function embedLength(embed) {
    const { title = '', description = '', author, footer } = embed.data;
    return title.length + description.length + (author?.name.length ?? 0) + (footer?.text.length ?? 0);
}

// Groups the embeds into pages that each fit in one Discord message
function buildPages({ patch, entries }) {
    const pages = [];
    let page = [];
    let length = 0;

    for (const embed of entries.flatMap((entry) => entryEmbeds(entry, patch))) {
        const size = embedLength(embed);
        if (page.length && (page.length >= EMBEDS_PER_PAGE || length + size > MESSAGE_EMBED_LIMIT)) {
            pages.push(page);
            page = [];
            length = 0;
        }
        page.push(embed);
        length += size;
    }

    if (page.length) pages.push(page);
    return pages;
}

// The message for one page, with buttons to turn pages and open the patch notes
function renderPage({ key, pages, patch }, index) {
    const buttons = [];

    if (pages.length > 1) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`patchnotes:${key}:${index - 1}`)
                .setLabel('◀ Previous')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(index === 0),
            new ButtonBuilder()
                .setCustomId(`patchnotes:${key}:page`)
                .setLabel(`Page ${index + 1}/${pages.length}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`patchnotes:${key}:${index + 1}`)
                .setLabel('Next ▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(index === pages.length - 1)
        );
    }

    buttons.push(new ButtonBuilder().setLabel('Open patch notes').setStyle(ButtonStyle.Link).setURL(patch.url));

    return {
        content: '',
        embeds: pages[index],
        components: [new ActionRowBuilder().addComponents(buttons)]
    };
}

function unique(items) {
    return [...new Set(items.filter(Boolean))];
}

// Lists hero names by role, e.g. "**Tank:** Roadhog, D.Mon"
function heroesByRole(entries) {
    const heroes = entries.filter((entry) => entry.kind === 'hero');
    return [...Object.keys(ROLE_NAMES), null]
        .map((role) => {
            const names = unique(heroes.filter((entry) => (entry.role ?? null) === role).map((entry) => entry.name));
            return names.length ? `**${ROLE_NAMES[role] ?? 'Other'}:** ${names.join(', ')}` : null;
        })
        .filter(Boolean);
}

// One line summing up a kind of change, e.g. the hero names or the titles of the general updates
function summarize(type, entries) {
    const titles = unique(entries.filter((entry) => entry.kind !== 'hero').map((entry) => entry.title || entry.section));
    if (type === 'maps') return unique(entries.map((entry) => entry.section)).join(', ');
    if (type === 'heroes') return heroesByRole(entries).join('\n');
    return [titles.join(', '), ...heroesByRole(entries)].filter(Boolean).join('\n');
}

// The post for a new patch: what changed at a glance, with a button to see each kind of change
function buildAnnouncement(patch, sections, intro) {
    const embed = new EmbedBuilder()
        .setColor(patch.isHotfix ? COLORS.damage : COLORS.general)
        .setAuthor({ name: patch.isHotfix ? 'New Overwatch hotfix' : 'New Overwatch patch notes' })
        .setTitle(truncate(patch.title, TITLE_LIMIT))
        .setURL(patch.url)
        .setFooter({ text: 'Use the buttons to see the full changes' });

    if (intro) embed.setDescription(truncate(intro, DESCRIPTION_LIMIT));
    for (const { type, entries } of sections) {
        const value = summarize(type, entries);
        if (value) embed.addFields({ name: TYPE_LABELS[type], value: truncate(value, FIELD_LIMIT) });
    }

    const buttons = sections.map(({ type }) => new ButtonBuilder()
        .setCustomId(`autopost:${patch.id}:${type}`)
        .setLabel(TYPE_LABELS[type])
        .setStyle(ButtonStyle.Primary));
    buttons.push(new ButtonBuilder().setLabel('Open patch notes').setStyle(ButtonStyle.Link).setURL(patch.url));

    const components = [];
    for (let i = 0; i < buttons.length; i += BUTTONS_PER_ROW) {
        components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + BUTTONS_PER_ROW)));
    }

    return { embeds: [embed], components };
}

// Quick Play has no bans, so its ban rate is always 0 and is left out
function rateLine(hero, mode) {
    const rates = [`**${hero.winrate}%** win rate`, `**${hero.pickrate}%** pick rate`];
    if (mode === 'competitive') rates.push(`**${hero.banrate}%** ban rate`);
    return rates.join(' · ');
}

// The message for /stats, with a button to open the stats page with the same filters
function statsMessage(embed, { url, footer }) {
    embed.setURL(url).setFooter({ text: footer });
    const button = new ButtonBuilder().setLabel('Open hero stats').setStyle(ButtonStyle.Link).setURL(url);
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
}

// The heroes in a role with the highest of one rate, with the best one's portrait
function buildTopHeroes(role, heroes, sort, details) {
    const embed = new EmbedBuilder()
        .setColor(COLORS[role])
        .setAuthor({ name: 'Hero stats' })
        .setTitle(`Top ${heroes.length} ${ROLE_NAMES[role]} heroes by ${RATE_NAMES[sort]}`)
        .setDescription(heroes.map((hero, i) => `**${i + 1}. ${hero.name}**\n${rateLine(hero, details.mode)}`).join('\n\n'))
        .setThumbnail(heroes[0].portrait);

    return statsMessage(embed, details);
}

function buildHeroStats(hero, details) {
    const embed = new EmbedBuilder()
        .setColor(COLORS[hero.role])
        .setAuthor({ name: `Hero stats · ${ROLE_NAMES[hero.role]}` })
        .setTitle(hero.name)
        .setDescription(rateLine(hero, details.mode))
        .setThumbnail(hero.portrait);

    return statsMessage(embed, details);
}

module.exports = { buildPages, renderPage, buildAnnouncement, buildTopHeroes, buildHeroStats, ROLE_NAMES };
