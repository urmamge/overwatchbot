require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");

const cheerio = require("cheerio");
const TOKEN = process.env.DISCORD_TOKEN;



const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const PATCH_NOTES_URL = 'https://overwatch.blizzard.com/en-us/news/patch-notes/'; // Website to scrape
const MESSAGE_LIMIT = 1900; // Discord rejects messages over 2000 characters

// Finds the newest patch with a hero update section titled with the given role
async function getRoleNotes(role) {
    const response = await fetch(PATCH_NOTES_URL);
    const html = await response.text();

    const $ = cheerio.load(html);

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

client.once('clientReady', () => console.log(`Logged in as ${client.user.tag}`));

client.on('messageCreate', async (message) => {
    const match = message.content.match(/^!patchnotes(Tank|Damage|Support)$/);
    if (!match) return;

    try {
        const data = await getRoleNotes(match[1]);

        if (data) {
            for (const chunk of splitMessage(data)) {
                await message.channel.send(chunk);
            }
        } else {
            message.channel.send('Could not find the data!');
        }
    } catch (err) {
        console.error(err);
        message.channel.send('Failed to fetch the website.');
    }
});

client.login(TOKEN);
