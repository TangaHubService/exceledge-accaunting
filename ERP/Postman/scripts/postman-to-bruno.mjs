// Converts a Postman collection (+ optional environment) into a Bruno .bru collection folder.
// Usage: node postman-to-bruno.mjs <postman-collection.json> <output-folder> [postman-environment.json]

import { postmanToBruno, postmanToBrunoEnvironment } from '@usebruno/converters';
import {
  stringifyCollection,
  stringifyFolder,
  stringifyRequest,
  stringifyEnvironment,
} from '@usebruno/filestore';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const [collectionFile, outputDir, environmentFile] = process.argv.slice(2);
if (!collectionFile || !outputDir) {
  console.error(
    'Usage: node postman-to-bruno.mjs <postman-collection.json> <output-folder> [postman-environment.json]'
  );
  process.exit(1);
}

const format = 'bru';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const safeName = (name) => name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-');
const write = async (file, content) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
};

const { collection, issues } = await postmanToBruno(await readJson(collectionFile));

if (!collection.environments) collection.environments = [];
if (environmentFile) {
  collection.environments.push(postmanToBrunoEnvironment(await readJson(environmentFile)));
}

const brunoConfig = {
  version: collection.version || '1',
  name: collection.name,
  type: 'collection',
  ignore: ['node_modules', '.git'],
};

const root = stringifyCollection(collection.root || {}, brunoConfig, { format });
await write(path.join(outputDir, 'bruno.json'), JSON.stringify(brunoConfig, null, 2));
await write(path.join(outputDir, 'collection.bru'), root);

for (const env of collection.environments || []) {
  await write(
    path.join(outputDir, 'environments', `${safeName(env.name)}.bru`),
    stringifyEnvironment(env, { format })
  );
}

const stack = (collection.items || []).map((item) => [item, outputDir]);
while (stack.length) {
  const [item, parent] = stack.pop();
  if (item.type === 'folder') {
    const folderDir = path.join(parent, safeName(item.name));
    await mkdir(folderDir, { recursive: true });
    if (item.root) {
      await write(path.join(folderDir, 'folder.bru'), stringifyFolder(item.root, { format }));
    }
    for (const child of item.items || []) stack.push([child, folderDir]);
  } else {
    await write(
      path.join(parent, `${safeName(item.name)}.bru`),
      stringifyRequest(item, { format })
    );
  }
}

console.log(`Collection written to ${outputDir}`);
for (const issue of issues || []) {
  console.warn(`${issue.severity}: ${issue.path}: ${issue.message}`);
}
