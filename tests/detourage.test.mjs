import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {suggestCutout} from '../app/segmentation/detourage.js';

const annotation = JSON.parse(await readFile(new URL('./photos/detourage-synthetique.annotations.json', import.meta.url), 'utf8'));

function paint(image, rect, scale = 1) {
  for (let y = rect.y * scale; y < (rect.y + rect.height) * scale; y++) {
    for (let x = rect.x * scale; x < (rect.x + rect.width) * scale; x++) {
      image.data.set([...rect.color, 255], (y * image.width + x) * 4);
    }
  }
}

function fixture(scale = 1, background = annotation.background) {
  const width = annotation.width * scale;
  const height = annotation.height * scale;
  const image = {width, height, data: new Uint8ClampedArray(width * height * 4)};
  paint(image, {x: 0, y: 0, width: annotation.width, height: annotation.height, color: background}, scale);
  paint(image, annotation.facade, scale);
  for (const rect of annotation.details) paint(image, rect, scale);
  return image;
}

test('Détourage annoté : fond connecté, pleine résolution et RGB conservés', () => {
  const image = fixture();
  const original = image.data.slice();
  const result = suggestCutout(image);
  assert.equal(result.applied, true);
  assert.equal(result.niveau, 'geometrie');
  assert.ok(result.confidence >= 0.8);
  assert.deepEqual(result.bounds, annotation.expectedBounds);
  assert.equal(result.imageData.width, image.width);
  assert.equal(result.imageData.height, image.height);
  assert.notEqual(result.imageData.data, image.data);
  assert.deepEqual(image.data, original);
  let removed = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4;
      assert.deepEqual(result.imageData.data.subarray(offset, offset + 3), original.subarray(offset, offset + 3));
      const {x: left, y: top, width, height} = annotation.expectedBounds;
      const outside = x < left || y < top || x >= left + width || y >= top + height;
      assert.equal(result.imageData.data[offset + 3], outside ? 0 : 255);
      if (outside) removed++;
    }
  }
  assert.equal(result.removedFraction, removed / (image.width * image.height));
});

test('Les inscriptions, le levier et les détails de la couleur du fond restent opaques', () => {
  const image = fixture();
  const result = suggestCutout(image);
  for (const [x, y] of annotation.protectedPoints) {
    const offset = (y * image.width + x) * 4;
    assert.deepEqual(result.imageData.data.subarray(offset, offset + 4), image.data.subarray(offset, offset + 4));
    assert.equal(result.imageData.data[offset + 3], 255);
  }
});

test('Fond semblable à la façade : absence de détourage plutôt qu’une silhouette inventée', () => {
  const image = fixture(1, [229, 231, 230]);
  const result = suggestCutout(image);
  assert.equal(result.applied, false);
  assert.equal(result.imageData, image);
  assert.match(result.reason, /pas assez distincts/);
});

test('Une façade qui touche le cadre conserve tous ses pixels', () => {
  const image = fixture();
  paint(image, {x: 0, y: 145, width: 25, height: 10, color: annotation.facade.color});
  const result = suggestCutout(image);
  assert.equal(result.applied, false);
  assert.equal(result.imageData, image);
  assert.match(result.reason, /touche le cadre/);
});

test('Un fond irrégulier aux bords ne devient pas artificiellement transparent', () => {
  const image = fixture();
  paint(image, {x: 0, y: 0, width: 180, height: 2, color: [230, 90, 40]});
  const result = suggestCutout(image);
  assert.equal(result.applied, false);
  assert.equal(result.imageData, image);
  assert.match(result.reason, /trop variable/);
});

test('Une transparence préexistante est respectée exactement', () => {
  const image = fixture();
  image.data[3] = 0;
  image.data[7] = 128;
  const original = image.data.slice();
  const result = suggestCutout(image);
  assert.equal(result.applied, false);
  assert.equal(result.imageData, image);
  assert.deepEqual(image.data, original);
  assert.match(result.reason, /transparence existe déjà/);
});

test('Fond uniforme et images invalides : aucun contour supposé', () => {
  const image = fixture();
  paint(image, {x: 0, y: 0, width: 180, height: 300, color: [240, 240, 240]});
  assert.equal(suggestCutout(image).applied, false);
  assert.throws(() => suggestCutout({width: 2, height: 2, data: []}), /RGBA/);
  const small = {width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255])};
  assert.equal(suggestCutout(small).imageData, small);
});

test('Les pixels d’une vignette haute résolution sont traités sans redimensionnement', () => {
  const image = fixture(8);
  const result = suggestCutout(image);
  assert.equal(result.applied, true);
  assert.equal(result.imageData.width, 1440);
  assert.equal(result.imageData.height, 2400);
  assert.deepEqual(result.bounds, {x: 192, y: 208, width: 1056, height: 1984});
  assert.equal(result.imageData.data.length, image.data.length);
});
