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

const DESCRIPTION_LIMIT = 4096; // Discord's limit for one embed's text
const TITLE_LIMIT = 256;
const MESSAGE_EMBED_LIMIT = 5800; // Discord allows 6000 characters across all embeds in a message
const EMBEDS_PER_PAGE = 4; // More than this is a wall of text, especially on phones

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
function renderPage({ key, pages, patch, note }, index) {
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
        content: note ?? '',
        embeds: pages[index],
        components: [new ActionRowBuilder().addComponents(buttons)]
    };
}

module.exports = { buildPages, renderPage, ROLE_NAMES };
