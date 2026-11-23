import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeLayout } from '../app/segmentation/automatic.js';
import { deviceRects, validateRow } from '../app/segmentation/rows.js';

const fixture = JSON.parse(await readFile(new URL('./photos/segmentation-variee.annotations.json', import.meta.url), 'utf8'));
function raster(scene, factor = 1) {
  const width = fixture.width * factor, height = fixture.height * factor;
  const data = new Uint8ClampedArray(width * height * 4);
  const fill = (left, top, span, extent, gray) => {
    for (let y = Math.round(top * factor); y < Math.round((top + extent) * factor); y++) for (let x = Math.round(left * factor); x < Math.round((left + span) * factor); x++) {
      const index = (y * width + x) * 4;
      data[index] = gray; data[index + 1] = gray; data[index + 2] = gray; data[index + 3] = 255;
    }
  };
  fill(0, 0, fixture.width, fixture.height, 198);
  let cursor = fixture.left;
  const expected = [];
  for (let index = 0; index < scene.widths.length; index++) {
    const span = scene.widths[index] * fixture.pitch, extent = fixture.bottom - fixture.top;
    fill(cursor, fixture.top, span, extent, 242);
    fill(cursor, fixture.top, 3, extent, 55);
    fill(cursor + span - 3, fixture.top, 3, extent, 55);
    // Les trous d'une prise et les leviers ne traversent pas la façade.
    fill(cursor + span * .3, fixture.top + 65, Math.max(4, span * .3), 35, 30);
    expected.push({ left: cursor * factor, right: (cursor + span) * factor });
    cursor += span + (scene.gaps?.[index] ?? 0) * fixture.pitch;
  }
  return { image: { width, height, data }, expected };
}

for (const scene of fixture.scenes) test(`Façades avant échelle : ${scene.nom}`, () => {
  const { image, expected } = raster(scene), result = analyzeLayout(image);
  assert.equal(result.candidates.length, scene.widths.length, JSON.stringify(result));
  assert.deepEqual(result.candidates.map(candidate => candidate.modules), scene.modules);
  result.candidates.forEach((candidate, index) => {
    assert.ok(Math.abs(candidate.left - expected[index].left) < 5, JSON.stringify(candidate));
    assert.ok(Math.abs(candidate.right - expected[index].right) < 5, JSON.stringify(candidate));
    assert.equal(candidate.niveau, 'geometrie');
    assert.ok(candidate.confiance >= .78 && candidate.confiance < 1);
    if (scene.unknown) {
      assert.equal(candidate.scale, null);
      assert.match(candidate.reason, /inconnue/);
    } else {
      assert.ok(Math.abs(candidate.scale.pixelsPerModule - fixture.pitch) < 1.5);
      assert.equal(candidate.scale.moduleMillimeters, 18);
    }
  });
  if (scene.unknown) {
    assert.equal(result.rows.length, 0);
    assert.match(result.warnings.join(' '), /pas de 18 mm/);
  } else {
    assert.equal(result.rows.length, scene.groups ?? 1);
    assert.deepEqual(result.rows.flatMap(row => deviceRects(row, image.width).map(rect => rect.modules)), scene.modules);
    for (const row of result.rows) assert.equal(validateRow(row, image.width, image.height), true);
  }
});

test('Les espaces entre groupes restent absents des appareils à pleine résolution', () => {
  const scene = fixture.scenes.find(value => value.nom === 'groupes-separes-sans-origine-commune');
  const { image, expected } = raster(scene, 3), result = analyzeLayout(image);
  assert.equal(result.candidates.length, 5);
  assert.deepEqual(result.candidates.map(candidate => candidate.modules), scene.modules);
  for (let index = 0; index < expected.length; index++) {
    assert.ok(Math.abs(result.candidates[index].left - expected[index].left) < 9);
    assert.ok(Math.abs(result.candidates[index].right - expected[index].right) < 9);
  }
  assert.equal(new Set(result.candidates.map(candidate => candidate.groupId)).size, 3);
});

test('Un fond vide et de simples traits verticaux ne deviennent pas des façades', () => {
  const width = 420, height = 300, data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) for (const x of [50, 100, 150, 200, 250]) {
    const index = (y * width + x) * 4;
    data[index] = 0; data[index + 1] = 0; data[index + 2] = 0;
  }
  const result = analyzeLayout({ width, height, data });
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.rows, []);
});

function rasterRegression(scene) {
  const { width, height } = scene, data = new Uint8ClampedArray(width * height * 4);
  const pixel = (x, y, gray) => { if (x < 0 || y < 0 || x >= width || y >= height) return; const index = (y * width + x) * 4; data[index] = gray; data[index + 1] = gray; data[index + 2] = gray; data[index + 3] = 255; };
  const fill = (left, top, extent, span, gray) => { for (let y = top; y < top + span; y++) for (let x = left; x < left + extent; x++) pixel(x, y, gray); };
  fill(0, 0, width, height, 201);
  if (scene.clutter) {
    // Cet objet voisin occupe presque toute la hauteur ; sa projection
    // globale fusionne les deux rangées pourtant séparées à gauche.
    fill(Math.round(width * .7), 55, Math.round(width * .25), height - 110, 38);
    fill(Math.round(width * .72), 70, Math.round(width * .2), height - 140, 170);
    for (let top = 100; top < height - 80; top += 65) fill(Math.round(width * .73), top, Math.round(width * .18), 12, 55);
  }
  for (const row of scene.rows) {
    let cursor = scene.left;
    const rowWidth = row.widths.reduce((sum, value) => sum + value, 0) * scene.pitch;
    for (let device = 0; device < row.widths.length; device++) {
      const nominalExtent = Math.round(row.widths[device] * scene.pitch);
      // Le centre observé d'un joint peut se décaler de quelques pixels par
      // ombre ou flou ; la phase doit être ajustée sur l'ensemble des joints.
      const start = cursor + (scene.jitter?.[device] ?? 0);
      const extent = nominalExtent + (scene.jitter?.[device + 1] ?? 0) - (scene.jitter?.[device] ?? 0);
      for (let x = start; x < start + extent; x++) {
        const shift = Math.round((scene.slope ?? 0) * (x - scene.left) / rowWidth);
        for (let y = row.top + shift; y < row.bottom + shift; y++) {
          const seam = x < start + 2 || x >= start + extent - 2;
          let gray = seam ? (scene.weakSeams && device > 0 && device < row.widths.length - 1 ? 218 : 45) : 242;
          if (!seam && x > start + extent * .28 && x < start + extent * .7 && y >= row.top + shift + 28 && y < row.top + shift + 43) gray = 35;
          pixel(x, y, gray);
        }
      }
      cursor += nominalExtent;
    }
  }
  return { width, height, data };
}

for (const scene of fixture.regressions) test(`Localisation spatiale : ${scene.nom}`, () => {
  const image = rasterRegression(scene), result = analyzeLayout(image);
  assert.equal(result.rows.length, scene.rows.length, JSON.stringify(result));
  assert.deepEqual(result.candidates.map(candidate => candidate.modules), scene.rows.flatMap(row => row.widths), JSON.stringify(result));
  for (let index = 0; index < result.candidates.length; index++) {
    const candidate = result.candidates[index];
    assert.ok(candidate.left >= scene.left - 5);
    assert.ok(candidate.right < image.width * .65);
    assert.ok(candidate.scale?.confidence >= .78);
    assert.equal(candidate.rowIndex >= 0 && candidate.rowIndex < result.rows.length, true);
    for (const other of result.candidates.slice(index + 1)) {
      const overlap = Math.max(0, Math.min(candidate.right, other.right) - Math.max(candidate.left, other.left));
      const vertical = Math.max(0, Math.min(candidate.bottom, other.bottom) - Math.max(candidate.top, other.top));
      assert.ok(overlap <= 2 || vertical === 0, JSON.stringify([candidate, other]));
    }
  }
  result.rows.forEach(row => assert.equal(validateRow(row, image.width, image.height), true));
});

test('La recherche locale refuse un texte répétitif et des objets sans pas modulaire prouvé', () => {
  const width = 800, height = 500, data = new Uint8ClampedArray(width * height * 4).fill(255);
  const fill = (left, top, extent, span, gray) => { for (let y = top; y < top + span; y++) for (let x = left; x < left + extent; x++) { const index = (y * width + x) * 4; data[index] = gray; data[index + 1] = gray; data[index + 2] = gray; } };
  // Des H imprimés : les espaces entre les hampes ne possèdent pas deux
  // frontières horizontales de façade et ne sont pas des appareils.
  for (let left = 70; left < 500; left += 26) { fill(left, 140, 3, 38, 35); fill(left + 14, 140, 3, 38, 35); fill(left, 157, 17, 3, 35); }
  fill(570, 50, 120, 350, 120);
  fill(590, 80, 80, 290, 200);
  assert.deepEqual(analyzeLayout({ width, height, data }).rows, []);
});

test('La récupération des rangées conserve une façade isolée sans échelle', () => {
  const scene = fixture.unknownRegression, result = analyzeLayout(rasterRegression(scene));
  const unknown = result.candidates.filter(candidate => candidate.top < 200);
  const calibrated = result.candidates.filter(candidate => candidate.top > 200);
  assert.equal(unknown.length, 1, JSON.stringify(result));
  assert.equal(unknown[0].modules, null);
  assert.equal(unknown[0].scale, null);
  assert.equal(unknown[0].rowIndex, null);
  assert.deepEqual(calibrated.map(candidate => candidate.modules), scene.rows[1].widths);
  for (const candidate of calibrated) {
    const row = result.rows[candidate.rowIndex];
    assert.ok(row && candidate.groupId === row.groupId);
  }
});
