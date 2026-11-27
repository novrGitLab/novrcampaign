import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const art = new URL('../src/components/ui/kingfisher/', import.meta.url);
const publicDir = new URL('../public/', import.meta.url);
const source = await readFile(new URL('tab-mark.svg', art), 'utf8');

function png(size, wing = 0, bill = 0) {
  const pose = source
    .replace('rotate(0 53 38)', `rotate(${wing} 53 38)`)
    .replace('rotate(0 75 28)', `rotate(${bill} 75 28)`);
  return sharp(Buffer.from(pose), { density: 384 }).resize(size, size).png().toBuffer();
}

for (const [name, wing, bill] of [
  ['rest', 0, 0], ['lift', 38, 0], ['spread', 75, 0], ['call', 0, 23],
]) {
  await writeFile(new URL(name + '.png', art), await png(64, wing, bill));
}

const touch = await sharp(await png(154))
  .extend({ top: 13, bottom: 13, left: 13, right: 13, background: '#f8f6f0' })
  .flatten({ background: '#f8f6f0' }).png().toBuffer();
await writeFile(new URL('apple-touch-icon.png', publicDir), touch);

const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(size => png(size)));
const directory = Buffer.alloc(6 + images.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(images.length, 4);
let offset = directory.length;
for (const [i, image] of images.entries()) {
  const entry = 6 + i * 16;
  directory[entry] = directory[entry + 1] = sizes[i];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(image.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += image.length;
}
await writeFile(new URL('favicon.ico', publicDir), Buffer.concat([directory, ...images]));
