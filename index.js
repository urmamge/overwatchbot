require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const cheerio = require("cheerio");
const TOKEN = "MTQxOTY3ODcwNTM1NzE2MDYwMA.Gazu6N.Xgd5zJ1D4_z7Y6tcELL4LsbMzhZ6hnpdNtmNFU";

const puppeteer = require('puppeteer');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const PATCH_NOTES_URL = 'https://overwatch.blizzard.com/en-us/news/patch-notes/';

client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.toLowerCase() === '!patchnotes') {
    try {
      const browser = await puppeteer.launch();
      const page = await browser.newPage();
      await page.goto(PATCH_NOTES_URL, { waitUntil: 'networkidle0' });

      // Extract latest patch title and date
      const latestPatch = await page.$eval(
        '.news-article__title',
        el => el.textContent.trim()
      );
      const latestDate = await page.$eval(
        '.news-article__date',
        el => el.textContent.trim()
      );

      await message.channel.send(
        `**Latest Overwatch 2 Patch Notes**\n**${latestPatch}**\n*Published on ${latestDate}*\n${PATCH_NOTES_URL}`
      );

      await browser.close();
    } catch (error) {
      console.error(error);
      await message.channel.send('⚠️ Could not fetch the latest patch notes.');
    }
  }
});

client.login(TOKEN);
