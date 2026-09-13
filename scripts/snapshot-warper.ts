// Refreshes public/data/warper-maps-<city>.json, the fallback the app uses when the Warper API is unreachable.
// Run with `npm run snapshot:maps`.
import { mkdir, writeFile } from 'node:fs/promises';
import { CITIES } from '../src/config.ts';
import { fetchHistoricMaps } from '../src/warper.ts';

await mkdir('public/data', { recursive: true });
for (const city of CITIES) {
  const maps = await fetchHistoricMaps(city.bbox, {
    headers: { 'User-Agent': 'imaginewiki/0.1 (https://github.com/danlessa/imaginewiki)' },
  });
  await writeFile(`public/data/warper-maps-${city.id}.json`, `${JSON.stringify(maps, null, 2)}\n`);
  console.log(`${city.name}: saved ${maps.length} maps`);
}
