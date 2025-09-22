const cheerio = require('cheerio');

(async () => {
    const response = await fetch('https://overwatch.blizzard.com/en-us/news/patch-notes/');
    const html = await response.text();
    //console.log(html);
    const $ = cheerio.load(html);


    const elements = $('.PatchNotes-list');
    elements.each((i, el) => {
        console.log($(el).text().trim());
    });
})();