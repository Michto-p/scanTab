// Proposition géométrique locale : les 18 mm ne suffisent pas à donner une
// échelle en pixels. Il faut aussi des séparations répétées visibles.
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};
const clamp = value => Math.max(0, Math.min(1, value));
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
};

function grayImage(image) {
  const { width, height, data } = image ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 32 || height < 32 || !data || data.length !== width * height * 4) return null;
  // Le calcul travaille sur un aperçu ; les coordonnées retournent à la
  // résolution originale et les vignettes restent découpées dans l'original.
  const factor = Math.max(1, Math.max(width, height) / 1100);
  const w = Math.round(width / factor), h = Math.round(height / factor);
  const pixels = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const source = (Math.min(height - 1, Math.floor((y + .5) * height / h)) * width + Math.min(width - 1, Math.floor((x + .5) * width / w))) * 4;
    const alpha = data[source + 3] / 255;
    pixels[y * w + x] = (.2126 * data[source] + .7152 * data[source + 1] + .0722 * data[source + 2]) * alpha + 255 * (1 - alpha);
  }
  return { pixels, width: w, height: h, scaleX: width / w, scaleY: height / h };
}

function rowBands({ pixels, width, height }) {
  const scores = [];
  for (let y = 0; y < height; y++) {
    let sum = 0, square = 0, edges = 0, count = 0;
    const start = Math.floor(width * .025), end = Math.ceil(width * .975);
    for (let x = start; x < end; x++) {
      const value = pixels[y * width + x];
      sum += value; square += value * value; count++;
      if (x > start) edges += Math.min(80, Math.abs(value - pixels[y * width + x - 1]));
    }
    scores.push(Math.sqrt(Math.max(0, square / count - (sum / count) ** 2)) + edges * 3 / count);
  }
  const baseline = percentile(scores, .2), peak = percentile(scores, .97);
  if (peak < 10 || peak - baseline < 7) return [];
  const threshold = baseline + Math.max(5, (peak - baseline) * .13);
  const active = scores.map(value => value > threshold);
  const join = Math.max(3, Math.round(height * .035));
  let previous = -1;
  for (let y = 0; y < active.length; y++) if (active[y]) {
    if (previous >= 0 && y - previous - 1 <= join) for (let middle = previous + 1; middle < y; middle++) active[middle] = true;
    previous = y;
  }
  const bands = []; let start = -1;
  for (let y = 0; y <= active.length; y++) {
    if (active[y] && start < 0) start = y;
    if (!active[y] && start >= 0) {
      if (y - start >= Math.max(24, height * .045)) bands.push({ top: start, bottom: y });
      start = -1;
    }
  }
  return bands;
}

function frontEdges(image, band) {
  const { pixels, width } = image, height = band.bottom - band.top;
  const strengths = new Float32Array(width);
  // Un marquage ou un levier ne traverse normalement pas toute la façade.
  // Une frontière retenue doit persister sur au moins 52 % de sa hauteur.
  for (let x = 2; x < width - 2; x++) {
    let persistent = 0, contrast = 0;
    for (let y = band.top + 2; y < band.bottom - 2; y++) {
      const difference = Math.abs(pixels[y * width + x + 1] - pixels[y * width + x - 1]);
      if (difference >= 14) persistent++;
      contrast += Math.min(110, difference);
    }
    const count = Math.max(1, height - 4);
    if (persistent / count >= .52) strengths[x] = contrast / count;
  }
  const maximum = Math.max(...strengths);
  if (maximum < 18) return [];
  const threshold = Math.max(17, maximum * .36), points = [];
  const join = Math.max(2, Math.round(height * .04));
  let cluster = [];
  const flush = () => {
    if (!cluster.length) return;
    let sum = 0, weight = 0;
    for (const x of cluster) { sum += x * strengths[x]; weight += strengths[x]; }
    points.push({ x: sum / weight, strength: weight / cluster.length });
    cluster = [];
  };
  for (let x = 2; x < width - 2; x++) if (strengths[x] >= threshold) {
    if (cluster.length && x - cluster.at(-1) > join) flush();
    cluster.push(x);
  }
  flush();
  return points;
}

function fitGrid(points, height) {
  if (points.length < 4) return null;
  const candidates = new Set();
  // La hauteur usuelle de façade aide à écarter les alias de pas ×2 ou ÷2.
  // Ce large intervalle reste une hypothèse géométrique, pas une mesure DIN.
  const minimum = Math.max(7, height / 6.2), maximum = height / 3.15;
  for (let i = 1; i < points.length; i++) {
    const distance = points[i].x - points[i - 1].x;
    for (let halves = 1; halves <= 12; halves++) {
      const pitch = distance * 2 / halves;
      if (pitch >= minimum && pitch <= maximum) candidates.add(Math.round(pitch * 10) / 10);
    }
  }
  let best = null;
  for (const initialPitch of candidates) for (const origin of points) {
    const matching = points.filter(point => Math.abs((point.x - origin.x) / initialPitch * 2 - Math.round((point.x - origin.x) / initialPitch * 2)) <= .19);
    if (matching.length < 4) continue;
    const first = matching[0].x;
    let indexed = normalizeGrid(matching.map(point => ({ ...point, module: Math.round((point.x - first) / initialPitch * 2) / 2 })));
    let fitted = regressGrid(indexed);
    if (!fitted) continue;
    // Le centre d'un joint de quelques pixels se décale au bord d'un fond
    // sombre. Une seconde passe récupère ce bord après ajustement du pas.
    indexed = normalizeGrid(points.map(point => ({ ...point, module: Math.round((point.x - fitted.intercept) / fitted.pitch * 2) / 2 })).filter(point => Math.abs(point.x - fitted.intercept - fitted.pitch * point.module) / fitted.pitch <= .12));
    fitted = regressGrid(indexed);
    if (!fitted) continue;
    const { pitch, intercept } = fitted;
    if (pitch < minimum || pitch > maximum) continue;
    const errors = indexed.map(point => Math.abs(point.x - intercept - pitch * point.module) / pitch);
    if (Math.max(...errors) > .14) continue;
    let single = 0, half = 0, invalid = false;
    for (let i = 1; i < indexed.length; i++) {
      const interval = indexed[i].module - indexed[i - 1].module;
      if (interval <= 0 || interval > 6) invalid = true;
      if (interval === 1) single++;
      if (interval === .5) half++;
    }
    const modules = indexed.at(-1).module;
    if (invalid || modules < 3 || modules > 54) continue;
    const alignment = 1 - median(errors) * 5;
    const support = indexed.length / points.length;
    // Des séparations à un module doivent réellement être observées : on
    // n'invente pas un appareil par module dans un différentiel de 2 ou 4.
    const anchor = Math.min(1, single / 3);
    const score = alignment * .4 + support * .25 + anchor * .3 + Math.min(.05, half * .01);
    if (!best || score > best.score) best = { pitch, intercept, indexed, score, single, alignment, support, modules };
  }
  return best;
}

function normalizeGrid(points) {
  if (!points.length) return points;
  let result = points;
  const odd = points.filter(point => Math.abs(Math.round(point.module * 2) % 2) === 1);
  const even = points.filter(point => Math.round(point.module * 2) % 2 === 0);
  const minority = odd.length < even.length ? odd : even;
  // Un bord de goulotte placé presque à un demi-module ne constitue pas à
  // lui seul la preuve d'un appareil supplémentaire en bout de rangée.
  if (minority.length > 0 && minority.every(point => point === points[0] || point === points.at(-1))) result = points.filter(point => !minority.includes(point));
  const origin = result[0]?.module ?? 0;
  return result.map(point => ({ ...point, module: point.module - origin }));
}

function regressGrid(points) {
  if (points.length < 4) return null;
  const meanX = points.reduce((sum, point) => sum + point.module, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  let numerator = 0, denominator = 0;
  for (const point of points) { numerator += (point.module - meanX) * (point.x - meanY); denominator += (point.module - meanX) ** 2; }
  if (!denominator) return null;
  const pitch = numerator / denominator;
  return { pitch, intercept: meanY - pitch * meanX };
}

export function analyzeLayout(imageData) {
  const image = grayImage(imageData);
  if (!image) return { rows: [], warnings: ['Image trop petite ou invalide pour proposer une échelle.'] };
  const rows = [], warnings = [];
  for (const band of rowBands(image)) {
    const edges = frontEdges(image, band), grid = fitGrid(edges, band.bottom - band.top);
    if (!grid || grid.single < 2 || grid.score < .78) {
      warnings.push('Une bande est visible, mais ses séparations ne permettent pas de déduire sûrement le pas de 18 mm.');
      continue;
    }
    const left = grid.intercept * image.scaleX;
    const right = (grid.intercept + grid.modules * grid.pitch) * image.scaleX;
    if (left < 0 || right > imageData.width) continue;
    const confidence = Math.min(.94, clamp(grid.score));
    rows.push({
      top: band.top * image.scaleY, bottom: band.bottom * image.scaleY,
      left, right, modules: grid.modules,
      cuts: grid.indexed.map(point => point.module), confidence,
      scale: { moduleMillimeters: 18, pixelsPerModule: grid.pitch * image.scaleX, pixelsPerMillimeter: grid.pitch * image.scaleX / 18, confidence, source: 'separations-visibles' }
    });
  }
  if (!rows.length && !warnings.length) warnings.push('Aucune rangée modulaire suffisamment lisible. Corriger le cadrage ou tracer les limites manuellement.');
  if (rows.length) warnings.push('Échelle et séparations proposées par géométrie : vérifier les bords et les appareils larges avant validation.');
  return { rows, warnings };
}

// Le repère est la largeur mesurée par l'utilisateur sur un appareil dont
// il connaît la largeur d'un module. La calibration n'identifie aucun appareil.
export function calibrateRow(imageData, row, pixelsPerModule) {
  const image = grayImage(imageData);
  if (!image) throw Error('Image invalide pour la calibration de 18 mm.');
  const left = row?.left ?? 0, right = row?.right ?? imageData.width;
  if (!row || ![row.top, row.bottom, left, right].every(Number.isFinite) || row.top < 0 || row.bottom > imageData.height || row.bottom <= row.top || left < 0 || right > imageData.width || right <= left) throw Error('La rangée à calibrer sort de l’image ou ses limites sont invalides.');
  if (!Number.isFinite(pixelsPerModule) || pixelsPerModule < 2 || pixelsPerModule > imageData.width * 2) throw Error('La largeur du repère de 18 mm est invalide.');
  const span = right - left, modules = Math.round(span / pixelsPerModule * 2) / 2;
  if (modules < .5 || modules > 100 || Math.abs(modules * pixelsPerModule - span) / span > .08) throw Error('Le repère de 18 mm est incohérent avec la largeur de la rangée. Vérifier les deux bords choisis.');
  const band = { top: Math.floor(row.top / image.scaleY), bottom: Math.min(image.height, Math.ceil(row.bottom / image.scaleY)) };
  const edges = frontEdges(image, band), cuts = new Set([0, modules]);
  for (const edge of edges) {
    const position = edge.x * image.scaleX;
    const module = Math.round((position - left) / pixelsPerModule * 2) / 2;
    if (module <= 0 || module >= modules) continue;
    if (Math.abs(position - left - module * pixelsPerModule) <= Math.max(2, pixelsPerModule * .12)) cuts.add(module);
  }
  const sortedCuts = [...cuts].sort((a, b) => a - b);
  const confidence = sortedCuts.length > 2 ? .85 : .45;
  return {
    ...row, left, right, modules, cuts: sortedCuts, confidence,
    scale: { moduleMillimeters: 18, pixelsPerModule, pixelsPerMillimeter: pixelsPerModule / 18, confidence: 1, source: 'repere-18-mm' }
  };
}
