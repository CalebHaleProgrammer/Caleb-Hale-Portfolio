import { readFile,writeFile } from 'node:fs/promises';
const items=[];
for(const name of ['mediabunny','soundtouchjs']){
  const pkg=JSON.parse(await readFile(`node_modules/${name}/package.json`,'utf8'));
  let license='';
  for(const file of ['LICENSE','LICENSE.txt','LICENSE.md']){try{license=await readFile(`node_modules/${name}/${file}`,'utf8');break;}catch{}}
  items.push(`${name} ${pkg.version}\n${pkg.repository?.url??''}\nLicense: ${pkg.license}\n\n${license}`);
}
await writeFile('dist/THIRD_PARTY_NOTICES.txt',items.join('\n\n----------------------------------------\n\n'));
