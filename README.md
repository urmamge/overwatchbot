# overwatchbot
discord bot for overwatch

Fan-made bot, not affiliated with or endorsed by Blizzard Entertainment. Overwatch is a trademark of Blizzard Entertainment, Inc.

## Commands

`/patchnotes` shows the newest Overwatch patch notes as embeds styled like the patch notes page, with buttons to turn pages and open the notes on Blizzard's site. Pick what to show with a subcommand:

- `/patchnotes heroes` shows the latest hero changes, or add `role:<Tank|Damage|Support>` for one role
- `/patchnotes hero name:<hero>` shows one hero's latest changes, with suggestions as you type
- `/patchnotes stadium` shows the latest Stadium changes, or add `role:<Tank|Damage|Support>` for one role's heroes
- `/patchnotes hotfix` shows the newest hotfix
- `/patchnotes bugfixes` shows the latest bug fixes
- `/patchnotes general` shows the latest changes that aren't about one hero, like events and modes
- `/patchnotes maps` shows the latest map changes

If the newest patch has nothing matching, the bot looks back through up to 6 months of patch notes.

`/stats` shows win rates and pick rates from Blizzard's [hero stats page](https://overwatch.blizzard.com/en-us/rates/), plus ban rates in Competitive:

- `/stats tank`, `/stats damage` and `/stats support` show the top 3 heroes in that role, ranked by `sort:<Win rate|Pick rate|Ban rate>` (win rate if left out, ban rate only in Competitive)
- `/stats hero name:<hero>` shows one hero's stats, with suggestions as you type

Every subcommand needs `input:<Mouse & Keyboard|Controller>` and `region:<Europe|Asia|Americas>`, and can be narrowed down with:

- `mode:<Quick Play|Competitive>` (Quick Play if left out)
- `map:<map>`, with suggestions as you type (all maps if left out)
- `rank:<rank>`, which only works with `mode:Competitive` (all ranks if left out)

`/autopost` posts new patch notes in a channel as soon as they're released (checked every 15 minutes). Each post sums up what changed, with buttons that show the full changes to whoever clicks them. It needs the bot to be in the server and the Manage Server permission to set up:

- `/autopost on channel:#patch-notes ping:@role` starts posting, optionally pinging a role
- `/autopost off` stops posting
- `/autopost status` shows where it's posting

The channels are saved in `autopost.json` next to `index.js`, so keep that file when moving or redeploying the bot.

## Privacy and terms

- [Privacy Policy](PRIVACY.md) ([on the website](https://matthewhearst.com/bots/overwatchbot/privacy-policy/))
- [Terms of Service](TERMS.md) ([on the website](https://matthewhearst.com/bots/overwatchbot/terms-of-service/))

## Running it

1. Run `npm install`
2. Create a `.env` file containing `DISCORD_TOKEN=your-bot-token`
3. Run `npm start`
