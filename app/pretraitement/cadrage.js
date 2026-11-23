import { analyzeLayout } from '../segmentation/automatic.js';
import { homography, mapPoint, rectifiedSize, validateQuad } from './geometry.js';

// Ce repérage décrit des bords visibles, jamais les dimensions physiques du
// tableau. Une proposition doit aussi contenir une rangée modulaire lisible.
const MAX_SIDE = 900;
const MIN_CONFIDENCE = .78;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function unknown(reason) {
  return { points: null, confiance: 0, niveau: 'geometrie', reason, warnings: [reason] };
}

function preview(source) {
  const { width, height, data } = source ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || !data || data.length !== width * height * 4) return null;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const w = Math.round(width * scale), h = Math.round(height * scale), gray = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sourceIndex = (Math.min(height - 1, Math.floor((y + .5) * height / h)) * width + Math.min(width - 1, Math.floor((x + .5) * width / w))) * 4;
    const alpha = data[sourceIndex + 3] / 255;
    gray[y * w + x] = Math.round((.2126 * data[sourceIndex] + .7152 * data[sourceIndex + 1] + .0722 * data[sourceIndex + 2]) * alpha + 255 * (1 - alpha));
  }
  // La moyenne 3 × 3 évite que le bruit d'un JPEG devienne un bord de coffret.
  const pixels = new Uint8Array(gray.length);
  pixels.set(gray);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += gray[(y + dy) * w + x + dx];
    pixels[y * w + x] = Math.round(sum / 9);
  }
  return { width: w, height: h, pixels, scaleX: width / w, scaleY: height / h };
}

function gradients(image) {
  const { width, height, pixels } = image;
  const horizontal = new Float32Array(pixels.length), vertical = new Float32Array(pixels.length);
  const points = { horizontal: [], vertical: [] };
  for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
    const index = y * width + x;
    const gx = pixels[index + 1] - pixels[index - 1], gy = pixels[index + width] - pixels[index - width];
    const ax = Math.abs(gx), ay = Math.abs(gy);
    if (ay >= 20 && ax <= ay * .6) {
      const weight = Math.min(100, ay);
      horizontal[index] = weight;
      // Une ligne horizontale s'écrit y = a x + b.
      points.horizontal.push({ x, y, weight, slope: -gx / gy });
    }
    if (ax >= 20 && ay <= ax * .6) {
      const weight = Math.min(100, ax);
      vertical[index] = weight;
      points.vertical.push({ x, y, weight, slope: -gy / gx });
    }
  }
  return { horizontal, vertical, points };
}

function dominantLines(image, gradient, direction) {
  const { width, height } = image;
  const vertical = direction === 'vertical', span = vertical ? height : width, extent = vertical ? width : height;
  const increment = .025, slopes = 29, offset = Math.ceil(span * .35) + 2, bins = extent + offset * 2;
  const votes = new Float32Array(slopes * bins);
  const points = gradient.points[direction];
  if (points.length < span * .24) return [];
  // Le voisinage de la normale du gradient borne le nombre de votes par pixel.
  // Aucun tableau proportionnel à la résolution originale n'est créé ici.
  for (const point of points) {
    const normal = vertical ? point.x : point.y, along = vertical ? point.y : point.x;
    const center = Math.round((point.slope + .35) / increment);
    for (let index = Math.max(0, center - 5); index <= Math.min(slopes - 1, center + 5); index++) {
      const a = index * increment - .35, b = Math.round(normal - a * along) + offset;
      if (b >= 0 && b < bins) votes[index * bins + b] += point.weight;
    }
  }
  const peaks = [];
  const threshold = span * 5;
  for (let index = 0; index < slopes; index++) for (let b = 1; b < bins - 1; b++) {
    const score = votes[index * bins + b];
    if (score >= threshold && score >= votes[index * bins + b - 1] && score >= votes[index * bins + b + 1]) peaks.push({ a: index * increment - .35, b: b - offset, score });
  }
  peaks.sort((a, b) => b.score - a.score);
  const lines = [];
  for (const peak of peaks) {
    if (lines.some(line => Math.abs(line.b - peak.b) < 5 && Math.abs(line.b + line.a * span - peak.b - peak.a * span) < 7)) continue;
    const samples = [];
    for (let along = 2; along < span - 2; along++) {
      const expected = peak.a * along + peak.b;
      let best = 0, coordinate = 0;
      for (let shift = -2; shift <= 2; shift++) {
        const normal = Math.round(expected + shift);
        if (normal < 2 || normal >= extent - 2) continue;
        const index = vertical ? along * width + normal : normal * width + along;
        const weight = gradient[direction][index];
        if (weight > best) { best = weight; coordinate = normal; }
      }
      if (best >= 20) samples.push({ along, normal: coordinate, weight: best });
    }
    if (samples.length < span * .26 || samples.at(-1).along - samples[0].along < span * .35) continue;
    const sum = samples.reduce((total, point) => total + point.weight, 0);
    const meanAlong = samples.reduce((total, point) => total + point.along * point.weight, 0) / sum;
    const meanNormal = samples.reduce((total, point) => total + point.normal * point.weight, 0) / sum;
    let numerator = 0, denominator = 0;
    for (const point of samples) { numerator += point.weight * (point.along - meanAlong) * (point.normal - meanNormal); denominator += point.weight * (point.along - meanAlong) ** 2; }
    if (!denominator) continue;
    const a = numerator / denominator, b = meanNormal - a * meanAlong;
    if (Math.abs(a) > .37) continue;
    lines.push({ a, b, score: peak.score });
    if (lines.length >= 14) break;
  }
  return lines;
}

function intersection(vertical, horizontal) {
  const divisor = 1 - vertical.a * horizontal.a;
  return { x: (vertical.b + vertical.a * horizontal.b) / divisor, y: (horizontal.b + horizontal.a * vertical.b) / divisor };
}

function area(points) {
  return Math.abs(points.reduce((sum, point, index) => { const next = points[(index + 1) % 4]; return sum + point.x * next.y - point.y * next.x; }, 0)) / 2;
}

function support(a, b, direction, image, gradient) {
  const length = Math.hypot(b.x - a.x, b.y - a.y), count = Math.max(16, Math.round(length / 2));
  let hits = 0;
  for (let step = 1; step < count; step++) {
    const fraction = step / count, x = a.x + (b.x - a.x) * fraction, y = a.y + (b.y - a.y) * fraction;
    let strongest = 0;
    for (let shift = -2; shift <= 2; shift++) {
      const px = Math.round(x + (direction === 'vertical' ? shift : 0)), py = Math.round(y + (direction === 'horizontal' ? shift : 0));
      if (px >= 0 && py >= 0 && px < image.width && py < image.height) strongest = Math.max(strongest, gradient[direction][py * image.width + px]);
    }
    if (strongest >= 20) hits++;
  }
  return hits / (count - 1);
}

function candidates(image, gradient, verticals, horizontals) {
  const result = [];
  verticals.sort((a, b) => a.b + a.a * image.height / 2 - b.b - b.a * image.height / 2);
  horizontals.sort((a, b) => a.b + a.a * image.width / 2 - b.b - b.a * image.width / 2);
  for (let left = 0; left < verticals.length - 1; left++) for (let right = left + 1; right < verticals.length; right++) {
    const v0 = verticals[left], v1 = verticals[right];
    if (v1.b + v1.a * image.height / 2 - v0.b - v0.a * image.height / 2 < image.width * .3) continue;
    for (let top = 0; top < horizontals.length - 1; top++) for (let bottom = top + 1; bottom < horizontals.length; bottom++) {
      const h0 = horizontals[top], h1 = horizontals[bottom];
      if (h1.b + h1.a * image.width / 2 - h0.b - h0.a * image.width / 2 < image.height * .16) continue;
      const points = [intersection(v0, h0), intersection(v1, h0), intersection(v1, h1), intersection(v0, h1)];
      if (!validateQuad(points, image.width, image.height)) continue;
      const fraction = area(points) / (image.width * image.height);
      if (fraction < .12 || fraction > .96) continue;
      const edges = points.map((point, index) => support(point, points[(index + 1) % 4], index % 2 ? 'vertical' : 'horizontal', image, gradient));
      if (Math.min(...edges) < .64) continue;
      const mean = edges.reduce((sum, value) => sum + value, 0) / 4;
      const score = mean * .7 + Math.min(1, fraction / .55) * .3;
      if (result.some(candidate => candidate.points.every((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y) < 9))) continue;
      result.push({ points, score, edges, fraction });
    }
  }
  return result.sort((a, b) => b.score - a.score);
}

function rectifyPreview(image, points) {
  const size = rectifiedSize(points), transform = homography(points, size.width, size.height);
  const data = new Uint8ClampedArray(size.width * size.height * 4);
  for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
    const source = mapPoint(transform, x + .5, y + .5);
    const sx = clamp(Math.round(source.x - .5), 0, image.width - 1), sy = clamp(Math.round(source.y - .5), 0, image.height - 1);
    const gray = image.pixels[sy * image.width + sx], index = (y * size.width + x) * 4;
    data[index] = gray; data[index + 1] = gray; data[index + 2] = gray; data[index + 3] = 255;
  }
  return { ...size, data };
}

/** Propose les coins dans l'ordre HG, HD, BD, BG, dans la photo originale. */
export function detectPanelQuad(imageData) {
  const image = preview(imageData);
  if (!image) return unknown('Image trop petite ou invalide pour proposer un cadrage.');
  const gradient = gradients(image);
  const verticals = dominantLines(image, gradient, 'vertical'), horizontals = dominantLines(image, gradient, 'horizontal');
  if (verticals.length < 2 || horizontals.length < 2) return unknown('Les quatre bords du tableau ne sont pas suffisamment visibles. Le cadrage reste manuel.');
  const quads = candidates(image, gradient, verticals, horizontals);
  // Vérifier au plus six aperçus évite une recherche combinatoire sur mobile.
  // La simple présence d'un rectangle (porte, fenêtre...) ne suffit jamais.
  for (const candidate of quads.slice(0, 6)) {
    const rectified = rectifyPreview(image, candidate.points);
    const layout = analyzeLayout(rectified);
    if (!layout.rows.length) continue;
    const rowsArea = layout.rows.reduce((sum, row) => sum + (row.right - row.left) * (row.bottom - row.top), 0) / (rectified.width * rectified.height);
    if (rowsArea < .18) continue;
    const rowConfidence = Math.min(...layout.rows.map(row => row.confidence));
    const confidence = Math.min(.93, candidate.score * .65 + rowConfidence * .35);
    if (confidence < MIN_CONFIDENCE) continue;
    const points = candidate.points.map(point => ({ x: point.x * image.scaleX, y: point.y * image.scaleY }));
    return {
      points, confiance: confidence, niveau: 'geometrie',
      reason: 'Bords rectilignes et séparations modulaires visibles après redressement de l’aperçu.',
      warnings: ['Cadrage proposé par géométrie : vérifier les quatre coins ; aucune dimension physique n’est déduite de ces bords.']
    };
  }
  return unknown('Aucun contour de tableau confirmé par une rangée modulaire lisible. Conserver la photo ou corriger les coins.');
}
