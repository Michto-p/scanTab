// Le détourage reste une proposition géométrique : aucun modèle n'identifie ici
// la silhouette d'un appareil. Un fond ambigu est conservé plutôt qu'effacé.
const MAX_PIXELS = 40_000_000;

function untouched(imageData, reason) {
  return {
    imageData, applied: false, confidence: 0, niveau: 'geometrie', reason,
    bounds: {x: 0, y: 0, width: imageData.width, height: imageData.height},
    removedFraction: 0,
  };
}

function distanceSquared(data, offset, color) {
  const r = data[offset] - color[0];
  const g = data[offset + 1] - color[1];
  const b = data[offset + 2] - color[2];
  return r * r + g * g + b * b;
}

function borderSamples(width, height, data) {
  const positions = [];
  const step = Math.max(1, Math.ceil((2 * width + 2 * height) / 4096));
  for (let x = 0; x < width; x += step) {
    positions.push(x * 4, ((height - 1) * width + x) * 4);
  }
  for (let y = 1; y < height - 1; y += step) {
    positions.push(y * width * 4, (y * width + width - 1) * 4);
  }
  const bins = new Map();
  for (const offset of positions) {
    // Un regroupement grossier évite de prendre une unique tache du bord
    // comme référence ; le contrôle de dispersion suit ce regroupement.
    const key = ((data[offset] >> 4) << 8)
      | ((data[offset + 1] >> 4) << 4) | (data[offset + 2] >> 4);
    bins.set(key, (bins.get(key) || 0) + 1);
  }
  const dominant = [...bins].sort((a, b) => b[1] - a[1])[0][0];
  const seed = [((dominant >> 8) & 15) * 16 + 8,
    ((dominant >> 4) & 15) * 16 + 8, (dominant & 15) * 16 + 8];
  let count = 0;
  const sum = [0, 0, 0];
  for (const offset of positions) {
    if (distanceSquared(data, offset, seed) > 30 * 30) continue;
    count++;
    for (let channel = 0; channel < 3; channel++) sum[channel] += data[offset + channel];
  }
  const color = sum.map(value => value / count);
  let variance = 0;
  for (const offset of positions) {
    if (distanceSquared(data, offset, seed) <= 30 * 30) {
      variance += distanceSquared(data, offset, color);
    }
  }
  return {color, agreement: count / positions.length,
    deviation: Math.sqrt(variance / count)};
}

/**
 * Propose un masque alpha, sans DOM, ni réduction de l'image.
 * Seul un fond homogène connecté au bord peut devenir transparent. Les pixels
 * RGB et les marques internes sont conservés. Le score est heuristique, pas une
 * mesure de précision évaluée sur un corpus de photos.
 *
 * Sans proposition suffisamment sûre, imageData est l'objet reçu. Avec une
 * proposition, imageData contient une nouvelle copie des pixels.
 */
export function suggestCutout(imageData) {
  const {width, height, data} = imageData || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || !data || data.length !== width * height * 4) {
    throw new TypeError('Une image RGBA de dimensions entières est nécessaire au détourage.');
  }
  if (width < 12 || height < 12) {
    return untouched(imageData, 'Image trop petite pour distinguer le fond de la façade.');
  }
  const count = width * height;
  if (count > MAX_PIXELS) {
    return untouched(imageData, 'Image trop grande pour ce détourage local ; la vignette originale est conservée.');
  }
  // Une transparence existante peut provenir d'une correction humaine : elle
  // n'est jamais recalculée ni écrasée.
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset] !== 255) {
      return untouched(imageData, 'Une transparence existe déjà ; elle est conservée.');
    }
  }

  const background = borderSamples(width, height, data);
  if (background.agreement < 0.85 || background.deviation > 13) {
    return untouched(imageData, 'Le fond au bord est trop variable pour un détourage fiable.');
  }
  const tolerance = Math.max(9, Math.min(26, 8 + 2.5 * background.deviation));
  const toleranceSquared = tolerance * tolerance;
  const separationSquared = Math.max(48, tolerance * 2.4) ** 2;
  let centralSamples = 0;
  let distinctSamples = 0;
  const sampleStep = Math.max(1, Math.floor(Math.min(width, height) / 80));
  const coreLeft = Math.floor(width * 0.3);
  const coreRight = Math.ceil(width * 0.7);
  const coreTop = Math.floor(height * 0.3);
  const coreBottom = Math.ceil(height * 0.7);
  for (let y = coreTop; y < coreBottom; y += sampleStep) {
    for (let x = coreLeft; x < coreRight; x += sampleStep) {
      centralSamples++;
      if (distanceSquared(data, (y * width + x) * 4, background.color) >= separationSquared) {
        distinctSamples++;
      }
    }
  }
  if (distinctSamples / centralSamples < 0.68) {
    return untouched(imageData, 'Le fond et la façade centrale ne sont pas assez distincts.');
  }

  const removed = new Uint8Array(count);
  const stack = [];
  const isBackground = index => !removed[index]
    && distanceSquared(data, index * 4, background.color) <= toleranceSquared;
  // Remplissage par segments : pas de file de largeur × hauteur entiers,
  // afin de limiter la mémoire sur les vignettes pleine résolution.
  for (let x = 0; x < width; x++) stack.push(x, (height - 1) * width + x);
  for (let y = 1; y < height - 1; y++) stack.push(y * width, (y + 1) * width - 1);
  let removedCount = 0;
  while (stack.length) {
    const seed = stack.pop();
    if (!isBackground(seed)) continue;
    const y = Math.floor(seed / width);
    const rowStart = y * width;
    const rowEnd = rowStart + width;
    let left = seed;
    let right = seed;
    while (left > rowStart && isBackground(left - 1)) left--;
    while (right + 1 < rowEnd && isBackground(right + 1)) right++;
    for (let index = left; index <= right; index++) {
      removed[index] = 1;
      removedCount++;
    }
    for (const delta of [-width, width]) {
      if (left + delta < 0 || right + delta >= count) continue;
      let inRun = false;
      for (let index = left + delta; index <= right + delta; index++) {
        if (isBackground(index)) {
          if (!inRun) stack.push(index);
          inRun = true;
        } else inRun = false;
      }
    }
  }
  const removedFraction = removedCount / count;
  if (removedFraction < 0.06 || removedFraction > 0.9) {
    return untouched(imageData, 'La surface de fond distincte est insuffisante ou la façade est trop petite.');
  }
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < count; index++) {
    if (removed[index]) continue;
    const y = Math.floor(index / width);
    const x = index - y * width;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const margin = Math.max(1, Math.floor(Math.min(width, height) * 0.01));
  if (minX < margin || minY < margin || maxX >= width - margin || maxY >= height - margin) {
    return untouched(imageData, 'La façade ou un élément touche le cadre ; les contours restent ambigus.');
  }
  if (maxX - minX + 1 < width * 0.2 || maxY - minY + 1 < height * 0.2) {
    return untouched(imageData, 'Aucune façade centrale suffisamment grande n’est isolée.');
  }

  const output = new Uint8ClampedArray(data);
  for (let index = 0; index < count; index++) {
    if (removed[index]) output[index * 4 + 3] = 0;
  }
  return {
    imageData: {width, height, data: output}, applied: true,
    confidence: Math.min(0.97, 0.78 + background.agreement * 0.1
      + (distinctSamples / centralSamples) * 0.07),
    niveau: 'geometrie', bounds: {x: minX, y: minY,
      width: maxX - minX + 1, height: maxY - minY + 1},
    removedFraction,
    reason: 'Fond homogène relié au bord retiré ; façade et inscriptions conservées. Proposition à vérifier.',
  };
}
