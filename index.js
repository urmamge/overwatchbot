require("dotenv").config();

const { Client, GatewayIntentBits, SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags, PermissionFlagsBits, ChannelType } = require("discord.js");

const { findPatchNotes, getLatestPatches, getHeroes, normalizeName, HERO_FILTER_TYPES, MONTHS_TO_SEARCH } = require('./patchnotes');
const { buildPages, renderPage, ROLE_NAMES } = require('./format');
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

const patchnotesCommand = new SlashCommandBuilder()
    .setName('patchnotes')
    .setDescription('Show the latest Overwatch patch notes')
    // Lets people add the bot to a server or to their own account, and use it in servers, DMs and group chats
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
    .addStringOption((option) => option
        .setName('type')
        .setDescription('Which kind of changes to show (default: Hero changes)')
        .addChoices(
            { name: 'Hero changes', value: 'heroes' },
            { name: 'Stadium', value: 'stadium' },
            { name: 'Hotfixes', value: 'hotfix' },
            { name: 'Bug fixes', value: 'bugfixes' },
            { name: 'General changes', value: 'general' },
            { name: 'Map changes', value: 'maps' }
        ))
    .addStringOption((option) => option
        .setName('role')
        .setDescription('Only show heroes in this role')
        .addChoices(
            { name: 'Tank', value: 'tank' },
            { name: 'Damage', value: 'damage' },
            { name: 'Support', value: 'support' }
        ))
    .addStringOption((option) => option
        .setName('hero')
        .setDescription('Only show changes for this hero')
        .setAutocomplete(true));

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
    if (!HERO_FILTER_TYPES.has(type)) return TYPE_NAMES[type];
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
        patch: result.patch,
        note: !HERO_FILTER_TYPES.has(query.type) && (query.role || query.hero)
            ? `Role and hero filters don't apply to ${TYPE_NAMES[query.type]}, so here's everything.`
            : null
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
    await client.application.commands.set([patchnotesCommand, autopostCommand]);
    console.log('Registered /patchnotes and /autopost');

    // Downloads the hero list now so the first autocomplete answers within Discord's 3 second limit
    getHeroes().catch(console.error);
    startAutopost(client);
});

// Stops trying to post in servers the bot was removed from
client.on('guildDelete', (guild) => unsubscribe(guild.id));

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isAutocomplete() && interaction.commandName === 'patchnotes') await handleHeroAutocomplete(interaction);
        else if (interaction.isChatInputCommand() && interaction.commandName === 'patchnotes') {
            await showPatchNotes(interaction, {
                type: interaction.options.getString('type') ?? 'heroes',
                role: interaction.options.getString('role'),
                hero: interaction.options.getString('hero')
            });
        }
        else if (interaction.isChatInputCommand() && interaction.commandName === 'autopost') await handleAutopost(interaction);
        else if (interaction.isButton() && interaction.customId.startsWith('patchnotes:')) await handlePageButton(interaction);
        else if (interaction.isButton() && interaction.customId.startsWith('autopost:')) await handleAnnouncementButton(interaction);
    } catch (err) {
        console.error(err);
        if (interaction.deferred) await interaction.editReply('Failed to fetch the patch notes.').catch(console.error);
    }
});

// Log errors instead of letting them crash the bot
client.on('error', console.error);
process.on('unhandledRejection', console.error);

client.login(TOKEN);
