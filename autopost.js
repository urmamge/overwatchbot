const fs = require('fs');
const path = require('path');

const { findPatchNotes, getLatestPatches } = require('./patchnotes');
const { buildAnnouncement } = require('./format');

const DATA_FILE = path.join(__dirname, 'autopost.json'); // Survives restarts, so don't delete it
const CHECK_MS = 15 * 60 * 1000; // Matches how often the patch notes page is downloaded
const ANNOUNCEMENT_TYPES = ['heroes', 'stadium', 'general', 'maps', 'bugfixes']; // In the order they're listed

// Discord error codes meaning the channel is gone or the bot can no longer see it
const LOST_CHANNEL_ERRORS = new Set([10003, 50001]);

// { lastPatchId, servers: { [guildId]: { channelId, roleId } } }
let data = { lastPatchId: null, servers: {} };
try {
    data = { ...data, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
} catch (err) {
    if (err.code !== 'ENOENT') console.error(`Couldn't read ${DATA_FILE}`, err);
}

// Writes to a temporary file first so a crash mid-write can't leave the file half written
function save() {
    fs.writeFileSync(`${DATA_FILE}.tmp`, JSON.stringify(data, null, 2));
    fs.renameSync(`${DATA_FILE}.tmp`, DATA_FILE);
}

function getSubscription(guildId) {
    return data.servers[guildId] ?? null;
}

function subscribe(guildId, channelId, roleId) {
    data.servers[guildId] = { channelId, roleId };
    save();
}

function unsubscribe(guildId) {
    if (!data.servers[guildId]) return false;
    delete data.servers[guildId];
    save();
    return true;
}

// Collects each kind of change in one patch, for the announcement's summary and buttons
async function getAnnouncement(patch) {
    const sections = [];
    for (const type of ANNOUNCEMENT_TYPES) {
        const result = await findPatchNotes({ type, patchId: patch.id });
        if (result) sections.push({ type, entries: result.entries });
    }

    const intro = patch.entries.find((entry) => entry.intro && entry.text)?.text;
    return buildAnnouncement(patch, sections, intro);
}

async function postToServer(client, guildId, announcement) {
    const { channelId, roleId } = data.servers[guildId];

    try {
        const channel = await client.channels.fetch(channelId);
        await channel.send({
            ...announcement,
            content: roleId ? `<@&${roleId}>` : '',
            allowedMentions: { roles: roleId ? [roleId] : [] }
        });
    } catch (err) {
        console.error(`Couldn't post patch notes to channel ${channelId}`, err);
        if (LOST_CHANNEL_ERRORS.has(err.code)) unsubscribe(guildId);
    }
}

let checking = false;

// Posts any patches released since the last check to every subscribed channel, oldest first
async function checkForNewPatches(client) {
    if (checking) return;
    checking = true;

    try {
        const patches = await getLatestPatches();
        if (!patches.length) return;

        // The first time the bot runs, remember the current patch instead of posting old ones
        if (!data.lastPatchId) {
            data.lastPatchId = patches[0].id;
            save();
            return;
        }

        const lastIndex = patches.findIndex((patch) => patch.id === data.lastPatchId);
        const newPatches = (lastIndex === -1 ? patches : patches.slice(0, lastIndex)).reverse();

        for (const patch of newPatches) {
            const announcement = await getAnnouncement(patch);
            for (const guildId of Object.keys(data.servers)) {
                await postToServer(client, guildId, announcement);
            }
            data.lastPatchId = patch.id;
            save();
        }
    } catch (err) {
        console.error('Checking for new patch notes failed', err);
    } finally {
        checking = false;
    }
}

function startAutopost(client) {
    checkForNewPatches(client);
    setInterval(() => checkForNewPatches(client), CHECK_MS);
}

module.exports = { startAutopost, getAnnouncement, getSubscription, subscribe, unsubscribe };
