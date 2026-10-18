require("dotenv").config();

const { Client, GatewayIntentBits, SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags, PermissionFlagsBits, ChannelType } = require("discord.js");

const { findPatchNotes, getLatestPatches, getHeroes, normalizeName, MONTHS_TO_SEARCH } = require('./patchnotes');
const { buildPages, renderPage, buildTopHeroes, buildHeroStats, ROLE_NAMES } = require('./format');
const { getMaps, findMap, getTopHeroes, getHeroStats, statsPageUrl, MODES, INPUT_NAMES, REGION_NAMES, MODE_NAMES, RANK_NAMES } = require('./stats');
const { startAutopost, getAnnouncement, getSubscription, subscribe, unsubscribe } = require('./autopost');
const TOKEN = process.env.DISCORD_TOKEN;



// Slash commands don't need to read messages, so only the Guilds intent is required
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

const SESSION_MS = 15 * 60 * 1000; // Page buttons stop working after 15 minutes
const AUTOCOMPLETE_LIMIT = 25; // Discord shows at most 25 suggestions
const POST_PERMISSIONS = ['ViewChannel', 'SendMessages', 'EmbedLinks']; // What the bot needs to post in a channel

const TYPE_NAMES = {
    heroes: 'hero changes',
    stadium: 'Stadium changes',
    hotfix: 'hotfixes',
    bugfixes: 'bug fixes',
    general: 'general changes',
    maps: 'map changes'
};

function roleOption(option) {
    return option
        .setName('role')
        .setDescription('Only show heroes in this role')
        .addChoices(
            { name: 'Tank', value: 'tank' },
            { name: 'Damage', value: 'damage' },
            { name: 'Support', value: 'support' }
        );
}

const patchnotesCommand = new SlashCommandBuilder()
    .setName('patchnotes')
    .setDescription('Show the latest Overwatch patch notes')
    // Lets people add the bot to a server or to their own account, and use it in servers, DMs and group chats
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
    // One subcommand per kind of change, so each only offers the options that make sense for it
    .addSubcommand((subcommand) => subcommand
        .setName('heroes')
        .setDescription('The latest hero changes')
        .addStringOption(roleOption))
    .addSubcommand((subcommand) => subcommand
        .setName('hero')
        .setDescription('The latest changes for one hero')
        .addStringOption((option) => option
            .setName('name')
            .setDescription('Which hero')
            .setRequired(true)
            .setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand
        .setName('stadium')
        .setDescription('The latest Stadium changes')
        .addStringOption(roleOption))
    .addSubcommand((subcommand) => subcommand
        .setName('hotfix')
        .setDescription('The newest hotfix'))
    .addSubcommand((subcommand) => subcommand
        .setName('bugfixes')
        .setDescription('The latest bug fixes'))
    .addSubcommand((subcommand) => subcommand
        .setName('general')
        .setDescription('The latest changes that aren\'t about one hero, like events and modes'))
    .addSubcommand((subcommand) => subcommand
        .setName('maps')
        .setDescription('The latest map changes'));

// The filters every /stats subcommand takes. Discord needs required options before optional ones
function statsFilters(subcommand) {
    return subcommand
        .addStringOption((option) => option
            .setName('input')
            .setDescription('Stats from players on this input')
            .setRequired(true)
            .addChoices(
                { name: 'Mouse & Keyboard', value: 'pc' },
                { name: 'Controller', value: 'controller' }
            ))
        .addStringOption((option) => option
            .setName('region')
            .setDescription('Stats from players in this region')
            .setRequired(true)
            .addChoices(
                { name: 'Europe', value: 'europe' },
                { name: 'Asia', value: 'asia' },
                { name: 'Americas', value: 'americas' }
            ))
        .addStringOption((option) => option
            .setName('mode')
            .setDescription('Quick Play or Competitive (Competitive if left out)')
            .addChoices(
                { name: 'Quick Play', value: 'quickplay' },
                { name: 'Competitive', value: 'competitive' }
            ))
        .addStringOption((option) => option
            .setName('map')
            .setDescription('Only stats from this map (all maps if left out)')
            .setAutocomplete(true))
        // Discord can't hide an option based on another one, so the rank suggestions don't appear when mode is Quick Play
        .addStringOption((option) => option
            .setName('rank')
            .setDescription('Only stats from this rank (Competitive only, all ranks if left out)')
            .setAutocomplete(true));
}

// A role's top 3, with the filters plus which rate to rank them by
function roleStats(subcommand, role) {
    return statsFilters(subcommand
        .setName(role)
        .setDescription(`The top 3 ${ROLE_NAMES[role]} heroes`))
        .addStringOption((option) => option
            .setName('sort')
            .setDescription('Which rate to rank the heroes by (win rate if left out)')
            .addChoices(
                { name: 'Win rate', value: 'winrate' },
                { name: 'Pick rate', value: 'pickrate' },
                { name: 'Ban rate (Competitive only)', value: 'banrate' }
            ));
}

const statsCommand = new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show hero win, pick and ban rates from the Overwatch hero stats page')
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
    .addSubcommand((subcommand) => roleStats(subcommand, 'tank'))
    .addSubcommand((subcommand) => roleStats(subcommand, 'damage'))
    .addSubcommand((subcommand) => roleStats(subcommand, 'support'))
    .addSubcommand((subcommand) => statsFilters(subcommand
        .setName('hero')
        .setDescription('One hero\'s win, pick and ban rates')
        .addStringOption((option) => option
            .setName('name')
            .setDescription('Which hero')
            .setRequired(true)
            .setAutocomplete(true))));

const autopostCommand = new SlashCommandBuilder()
    .setName('autopost')
    .setDescription('Post new Overwatch patch notes in a channel automatically')
    // Posting needs the bot to be in the server, and only server managers can set it up
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand
        .setName('on')
        .setDescription('Start posting new patch notes in a channel')
        .addChannelOption((option) => option
            .setName('channel')
            .setDescription('Where to post new patch notes')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addRoleOption((option) => option
            .setName('ping')
            .setDescription('A role to ping when new patch notes are posted')))
    .addSubcommand((subcommand) => subcommand
        .setName('off')
        .setDescription('Stop posting new patch notes in this server'))
    .addSubcommand((subcommand) => subcommand
        .setName('status')
        .setDescription('Show where new patch notes are posted'));

// Page lists for replies with page buttons, keyed by the interaction id that made them
const sessions = new Map();

// Describes what was searched for, e.g. "Stadium changes for Tank heroes"
function describeQuery({ type, role, hero }) {
    if (hero) return `${TYPE_NAMES[type]} for ${hero}`;
    if (role) return `${TYPE_NAMES[type]} for ${ROLE_NAMES[role]} heroes`;
    return TYPE_NAMES[type];
}

// Replies with the matching patch notes, split into pages with buttons when they're long
async function showPatchNotes(interaction, query, ephemeral = false) {
    // Discord needs a reply within 3 seconds, and the scrape can take longer
    await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});

    if (query.hero) {
        const heroes = await getHeroes().catch(() => []);
        const match = heroes.find((info) => normalizeName(info.name) === normalizeName(query.hero));
        if (match) query.hero = match.name;
        else if (heroes.length) return interaction.editReply(`I don't know a hero called "${query.hero}". Pick one from the list as you type.`);
    }

    const result = await findPatchNotes(query);
    if (!result) {
        return interaction.editReply(query.patchId
            ? 'Those changes are no longer on the patch notes page.'
            : `Couldn't find any ${describeQuery(query)} in the last ${MONTHS_TO_SEARCH} months of patch notes.`);
    }

    const session = {
        key: interaction.id,
        userId: interaction.user.id,
        pages: buildPages(result),
        patch: result.patch
    };

    if (session.pages.length > 1) {
        sessions.set(session.key, session);
        setTimeout(() => sessions.delete(session.key), SESSION_MS).unref();
    }

    await interaction.editReply(renderPage(session, 0));
}

async function handlePageButton(interaction) {
    const [, key, page] = interaction.customId.split(':');
    const session = sessions.get(key);

    if (!session) {
        return interaction.reply({ content: 'These buttons have expired. Run /patchnotes again to get fresh pages.', flags: MessageFlags.Ephemeral });
    }
    if (interaction.user.id !== session.userId) {
        return interaction.reply({ content: 'Only the person who ran this command can turn its pages. Run /patchnotes to get your own.', flags: MessageFlags.Ephemeral });
    }

    await interaction.update(renderPage(session, Number(page)));
}

// The buttons on an auto-posted patch show that patch's changes to whoever clicks, without cluttering the channel
async function handleAnnouncementButton(interaction) {
    const [, patchId, type] = interaction.customId.split(':');
    await showPatchNotes(interaction, { type, patchId }, true);
}

// Suggests hero names as the user types the hero option
async function handleHeroAutocomplete(interaction) {
    const typed = normalizeName(interaction.options.getFocused());
    const heroes = await getHeroes().catch(() => []);

    await interaction.respond(heroes
        .filter((info) => normalizeName(info.name).includes(typed))
        .sort((a, b) => normalizeName(b.name).startsWith(typed) - normalizeName(a.name).startsWith(typed))
        .slice(0, AUTOCOMPLETE_LIMIT)
        .map((info) => ({ name: `${info.name} (${ROLE_NAMES[info.role]})`, value: info.name })));
}

// Suggests map names as the user types the map option, leaving out maps without stats for the picked mode
async function handleMapAutocomplete(interaction) {
    const typed = normalizeName(interaction.options.getFocused());
    const mode = MODES[interaction.options.getString('mode') ?? 'competitive'];
    const maps = await getMaps().catch(() => []);

    await interaction.respond(maps
        .filter((map) => map.modes.includes(mode) && normalizeName(map.name).includes(typed))
        .sort((a, b) => normalizeName(b.name).startsWith(typed) - normalizeName(a.name).startsWith(typed))
        .slice(0, AUTOCOMPLETE_LIMIT)
        .map((map) => ({ name: map.name, value: map.value })));
}

// Only suggests ranks when mode is Competitive or left out, since Quick Play has no ranks
async function handleRankAutocomplete(interaction) {
    if (interaction.options.getString('mode') === 'quickplay') {
        return interaction.respond([{ name: 'Ranks only work with Competitive, not Quick Play', value: 'needs-competitive' }]);
    }

    const typed = normalizeName(interaction.options.getFocused());
    await interaction.respond(Object.entries(RANK_NAMES)
        .filter(([, name]) => normalizeName(name).includes(typed))
        .map(([value, name]) => ({ name, value })));
}

function handleStatsAutocomplete(interaction) {
    const focused = interaction.options.getFocused(true).name;
    if (focused === 'map') return handleMapAutocomplete(interaction);
    if (focused === 'rank') return handleRankAutocomplete(interaction);
    return handleHeroAutocomplete(interaction);
}

// Replies with the top 3 heroes in a role, or one hero's stats for "/stats hero"
async function handleStats(interaction) {
    await interaction.deferReply();

    const subcommand = interaction.options.getSubcommand();
    const filters = {
        input: interaction.options.getString('input', true),
        region: interaction.options.getString('region', true),
        mode: interaction.options.getString('mode') ?? 'competitive',
        map: null,
        rank: null
    };

    const typedMap = interaction.options.getString('map');
    if (typedMap) {
        filters.map = await findMap(typedMap);
        if (!filters.map) return interaction.editReply(`I don't know a map called "${typedMap}". Pick one from the list as you type.`);
        if (!filters.map.modes.includes(MODES[filters.mode])) return interaction.editReply(`There are no ${MODE_NAMES[filters.mode]} stats for ${filters.map.name}.`);
    }

    // A rank typed without picking a suggestion is matched by name, so "gm" or "Gold" still work
    const typedRank = interaction.options.getString('rank');
    if (typedRank) {
        if (filters.mode !== 'competitive') return interaction.editReply('Ranks only work with Competitive. Set mode to Competitive to pick a rank.');
        filters.rank = Object.keys(RANK_NAMES).find((value) => value === typedRank || normalizeName(RANK_NAMES[value]).startsWith(normalizeName(typedRank))) ?? null;
        if (!filters.rank) return interaction.editReply(`I don't know a rank called "${typedRank}". Pick one from the list as you type.`);
    }

    const details = {
        mode: filters.mode,
        url: statsPageUrl(filters),
        footer: [
            INPUT_NAMES[filters.input],
            REGION_NAMES[filters.region],
            MODE_NAMES[filters.mode],
            filters.mode === 'competitive' ? RANK_NAMES[filters.rank] ?? 'All Ranks' : null,
            filters.map?.name ?? 'All Maps'
        ].filter(Boolean).join(' · ')
    };

    if (subcommand !== 'hero') {
        const sort = interaction.options.getString('sort') ?? 'winrate';
        if (sort === 'banrate' && filters.mode !== 'competitive') return interaction.editReply('Quick Play has no bans. Set mode to Competitive to sort by ban rate.');

        const heroes = await getTopHeroes(filters, subcommand, sort);
        if (!heroes.length) return interaction.editReply(`The stats page has no ${ROLE_NAMES[subcommand]} stats for these filters right now.`);
        return interaction.editReply(buildTopHeroes(subcommand, heroes, sort, details));
    }

    const name = interaction.options.getString('name', true);
    const hero = await getHeroStats(filters, name);
    if (!hero) return interaction.editReply(`The stats page has no stats for a hero called "${name}" with these filters. Pick one from the list as you type.`);
    await interaction.editReply(buildHeroStats(hero, details));
}

async function handleAutopost(interaction) {
    // A bot installed only to someone's account isn't in the server, so it can't post there
    if (!interaction.inCachedGuild()) {
        return interaction.reply({ content: 'Add the bot to this server first, then run /autopost again.', flags: MessageFlags.Ephemeral });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'status') {
        const subscription = getSubscription(interaction.guildId);
        return interaction.reply({
            content: subscription
                ? `New patch notes are posted in <#${subscription.channelId}>${subscription.roleId ? ` and ping <@&${subscription.roleId}>` : ''}.`
                : 'Auto-posting is off. Use /autopost on to pick a channel.',
            allowedMentions: { parse: [] },
            flags: MessageFlags.Ephemeral
        });
    }

    if (subcommand === 'off') {
        return interaction.reply({
            content: unsubscribe(interaction.guildId) ? 'Stopped posting new patch notes.' : 'Auto-posting was already off.',
            flags: MessageFlags.Ephemeral
        });
    }

    const channel = interaction.options.getChannel('channel', true);
    const role = interaction.options.getRole('ping');
    const me = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
    const permissions = channel.permissionsFor(me);

    const missing = POST_PERMISSIONS.filter((permission) => !permissions.has(permission));
    if (missing.length) {
        return interaction.reply({
            content: `I need these permissions in ${channel} first: ${missing.join(', ')}.`,
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    subscribe(interaction.guildId, channel.id, role?.id ?? null);

    const lines = [`Done! New patch notes will be posted in ${channel}${role ? ` and ping ${role}` : ''}.`];
    if (role && !role.mentionable && !permissions.has('MentionEveryone')) {
        lines.push(`${role} can't be pinged by me yet. Make it mentionable in its role settings, or give me the Mention Everyone permission.`);
    }

    // Shows what a post looks like using the newest patch
    const [latest] = await getLatestPatches().catch(() => []);
    const preview = latest ? await getAnnouncement(latest).catch(() => null) : null;
    if (preview) lines.push('Here\'s what the newest patch would have looked like:');

    await interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] }, ...preview });
}

client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // Registers the commands for every server (the first time, they can take a few minutes to show up)
    await client.application.commands.set([patchnotesCommand, statsCommand, autopostCommand]);
    console.log('Registered /patchnotes, /stats and /autopost');

    // Downloads the hero and map lists now so the first autocomplete answers within Discord's 3 second limit
    getHeroes().catch(console.error);
    getMaps().catch(console.error);
    startAutopost(client);
});

// Stops trying to post in servers the bot was removed from
client.on('guildDelete', (guild) => unsubscribe(guild.id));

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isAutocomplete() && interaction.commandName === 'patchnotes') await handleHeroAutocomplete(interaction);
        else if (interaction.isAutocomplete() && interaction.commandName === 'stats') await handleStatsAutocomplete(interaction);
        else if (interaction.isChatInputCommand() && interaction.commandName === 'stats') await handleStats(interaction);
        else if (interaction.isChatInputCommand() && interaction.commandName === 'patchnotes') {
            const subcommand = interaction.options.getSubcommand();
            await showPatchNotes(interaction, {
                // "/patchnotes hero" is hero changes for one hero, every other subcommand is its own type
                type: subcommand === 'hero' ? 'heroes' : subcommand,
                role: interaction.options.getString('role'),
                hero: interaction.options.getString('name')
            });
        }
        else if (interaction.isChatInputCommand() && interaction.commandName === 'autopost') await handleAutopost(interaction);
        else if (interaction.isButton() && interaction.customId.startsWith('patchnotes:')) await handlePageButton(interaction);
        else if (interaction.isButton() && interaction.customId.startsWith('autopost:')) await handleAnnouncementButton(interaction);
    } catch (err) {
        console.error(err);
        const what = interaction.commandName === 'stats' ? 'hero stats' : 'patch notes';
        if (interaction.deferred) await interaction.editReply(`Failed to fetch the ${what}.`).catch(console.error);
    }
});

// Log errors instead of letting them crash the bot
client.on('error', console.error);
process.on('unhandledRejection', console.error);

client.login(TOKEN);
