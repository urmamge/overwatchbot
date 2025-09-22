require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");

const cheerio = require("cheerio");
const TOKEN = process.env.DISCORD_TOKEN;



const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const PATCH_NOTES_JSON_URL = 'https://overwatch.blizzard.com/en-us/news/data/patch-notes.json';

client.once('clientReady', () => console.log(`Logged in as ${client.user.tag}`));

client.on('messageCreate', async (message) => {
    if (message.content === '!patchnotesTank') {
        try {
            const response = await fetch('https://overwatch.blizzard.com/en-us/news/patch-notes/'); // Website to scrape
            const html = await response.text();

            const $ = cheerio.load(html);

            // Example: get the text inside a <div id="data">
            const data = $('.PatchNotes-section.PatchNotes-section-hero_update').eq(0).text().trim();

            if (data) {
                message.channel.send(`${data}`);
            } else {
                message.channel.send('Could not find the data!');
            }
        } catch (err) {
            console.error(err);
            message.channel.send('Failed to fetch the website.');
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.content === '!patchnotesDamage') {
        try {
            const response = await fetch('https://overwatch.blizzard.com/en-us/news/patch-notes/'); // Website to scrape
            const html = await response.text();

            const $ = cheerio.load(html);

            // Example: get the text inside a <div id="data">
            const data = $('.PatchNotes-section.PatchNotes-section-hero_update').eq(1).text().trim();

            if (data) {
                message.channel.send(`${data}`);
            } else {
                message.channel.send('Could not find the data!');
            }
        } catch (err) {
            console.error(err);
            message.channel.send('Failed to fetch the website.');
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.content === '!patchnotesSupport') {
        try {
            const response = await fetch('https://overwatch.blizzard.com/en-us/news/patch-notes/'); // Website to scrape
            const html = await response.text();

            const $ = cheerio.load(html);

            // Example: get the text inside a <div id="data">
            const data = $('.PatchNotes-section.PatchNotes-section-hero_update').eq(2).text().trim();

            if (data) {
                message.channel.send(`${data}`);
            } else {
                message.channel.send('Could not find the data!');
            }
        } catch (err) {
            console.error(err);
            message.channel.send('Failed to fetch the website.');
        }
    }
});

client.login(TOKEN);
