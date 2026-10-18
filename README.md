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

## Running it

1. Run `npm install`
2. Create a `.env` file containing `DISCORD_TOKEN=your-bot-token`
3. Run `npm start`
