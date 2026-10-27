
const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, 'Frontend/src/locales');
const enPath = path.join(localesDir, 'en/translation.json');
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

const languages = ['rw', 'fr', 'sw'];

function getKeys(obj, prefix = '') {
    return Object.keys(obj).reduce((res, el) => {
        if (Array.isArray(obj[el])) {
            return res;
        } else if (typeof obj[el] === 'object' && obj[el] !== null) {
            return [...res, ...getKeys(obj[el], prefix + el + '.')];
        }
        return [...res, prefix + el];
    }, []);
}

const enKeys = getKeys(en);

languages.forEach(lang => {
    const langPath = path.join(localesDir, `${lang}/translation.json`);
    const data = JSON.parse(fs.readFileSync(langPath, 'utf8'));
    const keys = getKeys(data);

    const missing = enKeys.filter(k => !keys.includes(k));

    console.log(`--- Missing keys for ${lang} (${missing.length}) ---`);
    missing.forEach(k => console.log(k));
});
