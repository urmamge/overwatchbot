require("dotenv").config();

const { Client, GatewayIntentBits, SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType } = require("discord.js");

const cheerio = require("cheerio");
const TOKEN = process.env.DISCORD_TOKEN;



// Slash commands don't need to read messages, so only the Guilds intent is required
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

const PATCH_NOTES_URL = 'https://overwatch.blizzard.com/en-us/news/patch-notes/'; // Website to scrape
const MESSAGE_LIMIT = 1900; // Discord rejects messages over 2000 characters
const CACHE_MS = 15 * 60 * 1000; // Download the website at most once every 15 minutes

const patchnotesCommand = new SlashCommandBuilder()
    .setName('patchnotes')
    .setDescription('Show the latest Overwatch hero changes for a role')
    // Lets people add the bot to a server or to their own account, and use it in servers, DMs and group chats
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
    .addStringOption((option) => option
        .setName('role')
        .setDescription('Which role to show')
        .setRequired(true)
        .addChoices(
            { name: 'Tank', value: 'Tank' },
            { name: 'Damage', value: 'Damage' },
            { name: 'Support', value: 'Support' }
        ));

let cachedHtml = null;
let cachedAt = 0;

// Reuses the last download so lots of servers using the bot don't flood Blizzard's website
async function getPatchNotesPage() {
    if (cachedHtml && Date.now() - cachedAt < CACHE_MS) return cachedHtml;

    const response = await fetch(PATCH_NOTES_URL);
    if (!response.ok) throw new Error(`Patch notes page returned ${response.status}`);

    cachedHtml = await response.text();
    cachedAt = Date.now();
    return cachedHtml;
}

// Finds the newest patch with a hero update section titled with the given role
async function getRoleNotes(role) {
    const $ = cheerio.load(await getPatchNotesPage());

    for (const patch of $('.PatchNotes-patch').toArray()) {
        const section = $(patch)
            .find('.PatchNotes-section.PatchNotes-section-hero_update')
            .filter((i, el) => $(el).find('.PatchNotes-sectionTitle').text().trim() === role)
            .first();

        if (section.length) {
            // The page has no line breaks between elements, so add them before reading the text
            section.find('h4, h5, p, li, .PatchNotesAbilityUpdate-name').append('\n');
            const lines = section.text().split('\n').map((line) => line.trim()).filter(Boolean);

            const title = $(patch).find('.PatchNotes-patchTitle').text().trim();
            return `**${title}**\n${lines.join('\n')}`;
        }
    }

    return null;
}

// Splits text into chunks that fit in a Discord message, breaking on lines where possible
function splitMessage(text) {
    const chunks = [];
    let current = '';

    for (let line of text.split('\n')) {
        while (line.length > MESSAGE_LIMIT) {
            if (current) chunks.push(current);
            current = '';
            chunks.push(line.slice(0, MESSAGE_LIMIT));
            line = line.slice(MESSAGE_LIMIT);
        }

        if (current.length + line.length + 1 > MESSAGE_LIMIT) {
            chunks.push(current);
            current = '';
        }
        current += `${line}\n`;
    }

    if (current.trim()) chunks.push(current);
    return chunks;
}

client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // Registers /patchnotes for every server (the first time, it can take a few minutes to show up)
    await client.application.commands.set([patchnotesCommand]);
    console.log('Registered /patchnotes');
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'patchnotes') return;

    // Discord needs a reply within 3 seconds, and the scrape can take longer
    await interaction.deferReply();

    try {
        const data = await getRoleNotes(interaction.options.getString('role', true));

        if (data) {
            const [first, ...rest] = splitMessage(data);
            await interaction.editReply(first);
            for (const chunk of rest) {
                await interaction.followUp(chunk);
            }
        } else {
            await interaction.editReply('Could not find the data!');
        }
    } catch (err) {
        console.error(err);
        await interaction.editReply('Failed to fetch the website.').catch(console.error);
    }
});

// Log errors instead of letting them crash the bot
client.on('error', console.error);
process.on('unhandledRejection', console.error);

client.login(TOKEN);
