const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const sourceDir = path.join(projectRoot, 'Frontend/src');
const localesDir = path.join(sourceDir, 'locales');
const languages = ['en', 'rw', 'fr', 'sw'];

function flattenKeys(value, prefix = '', result = new Set()) {
    for (const [key, child] of Object.entries(value)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (child && typeof child === 'object' && !Array.isArray(child)) {
            flattenKeys(child, fullKey, result);
        } else {
            result.add(fullKey);
        }
    }
    return result;
}

function sourceFiles(directory, result = []) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) sourceFiles(fullPath, result);
        else if (/\.(ts|tsx)$/.test(entry.name)) result.push(fullPath);
    }
    return result;
}

// Static keys used as t('key'), i18n.t('key'), or i18next.t('key'). Dynamic
// template keys cannot be proven statically and are intentionally excluded.
const usedKeys = new Map();
const translationCall = /(?:\b|\.)(?:t)\(\s*(['"`])([^'"`${}]+)\1/g;
for (const file of sourceFiles(sourceDir)) {
    const source = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = translationCall.exec(source))) {
        const key = match[2];
        if (!usedKeys.has(key)) usedKeys.set(key, []);
        usedKeys.get(key).push(path.relative(projectRoot, file));
    }
}

let failures = 0;
const localeKeys = {};
for (const language of languages) {
    const localePath = path.join(localesDir, language, 'translation.json');
    const translations = JSON.parse(fs.readFileSync(localePath, 'utf8'));
    localeKeys[language] = flattenKeys(translations);
    const missing = [...usedKeys.keys()].filter(key => !localeKeys[language].has(key)).sort();
    console.log(`--- Missing used keys for ${language} (${missing.length}) ---`);
    for (const key of missing) {
        console.log(`${key}  [${usedKeys.get(key)[0]}]`);
    }
    failures += missing.length;
}

// Also ensure translated locales contain every English key, including keys
// that may currently only be referenced dynamically.
for (const language of languages.filter(language => language !== 'en')) {
    const missing = [...localeKeys.en].filter(key => !localeKeys[language].has(key)).sort();
    console.log(`--- Keys present in English but missing from ${language} (${missing.length}) ---`);
    for (const key of missing) console.log(key);
    failures += missing.length;
}

if (failures > 0) process.exitCode = 1;
