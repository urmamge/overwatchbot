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

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.content === "!getinfo") {
    try {
      const url = "https://overwatch.blizzard.com/en-us/news/patch-notes/"; // change this later
      const { data } = await axios.get(url);
      const $ = cheerio.load(data);

      const heading = $("h1").first().text(); // grab the first <h1>

      await message.channel.send(`Here’s what I found: **${heading}**`);
    } catch (error) {
      console.error(error);
      await message.channel.send("⚠️ Couldn't fetch data from the site.");
    }
  }
});

client.login(TOKEN);