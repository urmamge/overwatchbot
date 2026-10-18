require("dotenv").config();

const { Client, GatewayIntentBits, SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require("discord.js");

const { findPatchNotes, getHeroes, normalizeName, HERO_FILTER_TYPES, MONTHS_TO_SEARCH } = require('./patchnotes');
const { buildPages, renderPage, ROLE_NAMES } = require('./format');
const TOKEN = process.env.DISCORD_TOKEN;



// Slash commands don't need to read messages, so only the Guilds intent is required
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

const SESSION_MS = 15 * 60 * 1000; // Page buttons stop working after 15 minutes
const AUTOCOMPLETE_LIMIT = 25; // Discord shows at most 25 suggestions

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

// Page lists for replies with page buttons, keyed by the command's interaction id
const sessions = new Map();

// Describes what was searched for, e.g. "Stadium changes for Tank heroes"
function describeQuery({ type, role, hero }) {
    if (!HERO_FILTER_TYPES.has(type)) return TYPE_NAMES[type];
    if (hero) return `${TYPE_NAMES[type]} for ${hero}`;
    if (role) return `${TYPE_NAMES[type]} for ${ROLE_NAMES[role]} heroes`;
    return TYPE_NAMES[type];
}

async function handlePatchNotes(interaction) {
    const query = {
        type: interaction.options.getString('type') ?? 'heroes',
        role: interaction.options.getString('role'),
        hero: interaction.options.getString('hero')
    };

    // Discord needs a reply within 3 seconds, and the scrape can take longer
    await interaction.deferReply();

    if (query.hero) {
        const heroes = await getHeroes().catch(() => []);
        const match = heroes.find((info) => normalizeName(info.name) === normalizeName(query.hero));
        if (match) query.hero = match.name;
        else if (heroes.length) return interaction.editReply(`I don't know a hero called "${query.hero}". Pick one from the list as you type.`);
    }

    const result = await findPatchNotes(query);
    if (!result) {
        return interaction.editReply(`Couldn't find any ${describeQuery(query)} in the last ${MONTHS_TO_SEARCH} months of patch notes.`);
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

client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // Registers /patchnotes for every server (the first time, it can take a few minutes to show up)
    await client.application.commands.set([patchnotesCommand]);
    console.log('Registered /patchnotes');

    // Downloads the hero list now so the first autocomplete answers within Discord's 3 second limit
    getHeroes().catch(console.error);
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isAutocomplete() && interaction.commandName === 'patchnotes') await handleHeroAutocomplete(interaction);
        else if (interaction.isChatInputCommand() && interaction.commandName === 'patchnotes') await handlePatchNotes(interaction);
        else if (interaction.isButton() && interaction.customId.startsWith('patchnotes:')) await handlePageButton(interaction);
    } catch (err) {
        console.error(err);
        if (interaction.deferred) await interaction.editReply('Failed to fetch the patch notes.').catch(console.error);
    }
});

// Log errors instead of letting them crash the bot
client.on('error', console.error);
process.on('unhandledRejection', console.error);

client.login(TOKEN);
