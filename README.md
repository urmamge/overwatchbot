# overwatchbot
discord bot for overwatch

## Commands

`/patchnotes` shows the newest Overwatch patch notes as embeds styled like the patch notes page, with buttons to turn pages and open the notes on Blizzard's site. Every option is optional:

- `type` picks what to show: `Hero changes` (the default), `Stadium`, `Hotfixes`, `Bug fixes`, `General changes` or `Map changes`
- `role:<Tank|Damage|Support>` only shows heroes in that role
- `hero` only shows one hero, with suggestions as you type

If the newest patch has nothing matching, the bot looks back through up to 6 months of patch notes.

Examples:

- `/patchnotes role:Tank` shows the latest tank changes
- `/patchnotes type:Stadium role:Support` shows the latest Stadium support changes
- `/patchnotes hero:Juno` shows Juno's latest changes
- `/patchnotes type:Bug fixes hero:Hanzo` shows Hanzo's latest bug fixes

`/autopost` posts new patch notes in a channel as soon as they're released (checked every 15 minutes). Each post sums up what changed, with buttons that show the full changes to whoever clicks them. It needs the bot to be in the server and the Manage Server permission to set up:

- `/autopost on channel:#patch-notes ping:@role` starts posting, optionally pinging a role
- `/autopost off` stops posting
- `/autopost status` shows where it's posting

The channels are saved in `autopost.json` next to `index.js`, so keep that file when moving or redeploying the bot.

## Running it

1. Run `npm install`
2. Create a `.env` file containing `DISCORD_TOKEN=your-bot-token`
3. Run `npm start`
